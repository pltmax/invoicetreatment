// lib/rules/context.ts
import "server-only";
import type { Client } from "@libsql/client";
import type { InvoiceContext } from "./types";
import type { Thresholds } from "./thresholds";

function monthsAgoIso(today: Date, months: number): string {
  const d = new Date(today);
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

// Split out from loadContext so classifyAll() can fetch this once per run
// instead of once per invoice — thresholds don't vary per invoice, and each
// fetch is a real network round trip against a remote (Turso) database.
export async function loadThresholds(db: Client): Promise<Thresholds> {
  const thresholdsResult = await db.execute(
    "SELECT deviation_orange AS deviationOrange, deviation_red AS deviationRed, new_supplier_amount_cents AS newSupplierAmountCents, exceptional_amount_cents AS exceptionalAmountCents, iban_recent_change_days AS ibanRecentChangeDays, risk_window_months AS riskWindowMonths, duplicate_window_days AS duplicateWindowDays, recurring_min_invoices AS recurringMinInvoices, history_sample AS historySample FROM thresholds WHERE id = 'default'"
  );
  const thresholdsRow = thresholdsResult.rows[0];
  if (!thresholdsRow) {
    throw new Error("thresholds row not found — did seed() run?");
  }
  return {
    deviationOrange: Number(thresholdsRow.deviationOrange),
    deviationRed: Number(thresholdsRow.deviationRed),
    newSupplierAmountCents: Number(thresholdsRow.newSupplierAmountCents),
    exceptionalAmountCents: Number(thresholdsRow.exceptionalAmountCents),
    ibanRecentChangeDays: Number(thresholdsRow.ibanRecentChangeDays),
    riskWindowMonths: Number(thresholdsRow.riskWindowMonths),
    duplicateWindowDays: Number(thresholdsRow.duplicateWindowDays),
    recurringMinInvoices: Number(thresholdsRow.recurringMinInvoices),
    historySample: Number(thresholdsRow.historySample),
  };
}

export async function loadContext(
  db: Client,
  invoiceId: string,
  today: Date,
  preloadedThresholds?: Thresholds
): Promise<InvoiceContext> {
  // Fetched concurrently: neither query depends on the other's result, and
  // each db.execute() is a real network round trip against a remote
  // (Turso) database in production — running them one after another would
  // add their latencies instead of overlapping them.
  const [invoiceResult, thresholds] = await Promise.all([
    db.execute({
      sql: `
        SELECT
          invoices.id AS id,
          invoices.entity_id AS entityId,
          entities.name AS entityName,
          invoices.supplier_id AS supplierId,
          invoices.contract_id AS contractId,
          invoices.invoice_number AS invoiceNumber,
          invoices.category AS category,
          invoices.amount_excl_vat_cents AS amountExclVatCents,
          invoices.amount_incl_vat_cents AS amountInclVatCents,
          invoices.due_date AS dueDate,
          invoices.issue_date AS issueDate,
          invoices.printed_iban AS printedIban,
          invoices.printed_siren AS printedSiren,
          invoices.printed_vat_number AS printedVatNumber,
          invoices.status AS status
        FROM invoices
        JOIN entities ON entities.id = invoices.entity_id
        WHERE invoices.id = ?
      `,
      args: [invoiceId],
    }),
    preloadedThresholds ?? loadThresholds(db),
  ]);
  const invoiceRow = invoiceResult.rows[0];
  if (!invoiceRow) {
    throw new Error(`invoice not found: ${invoiceId}`);
  }

  const invoice = {
    id: String(invoiceRow.id),
    entityId: String(invoiceRow.entityId),
    entityName: String(invoiceRow.entityName),
    supplierId: String(invoiceRow.supplierId),
    contractId: invoiceRow.contractId === null ? null : String(invoiceRow.contractId),
    invoiceNumber: String(invoiceRow.invoiceNumber),
    category: String(invoiceRow.category),
    amountExclVatCents: Number(invoiceRow.amountExclVatCents),
    amountInclVatCents: Number(invoiceRow.amountInclVatCents),
    dueDate: String(invoiceRow.dueDate),
    issueDate: String(invoiceRow.issueDate),
    printedIban: String(invoiceRow.printedIban),
    printedSiren: String(invoiceRow.printedSiren),
    printedVatNumber: String(invoiceRow.printedVatNumber),
    status: String(invoiceRow.status),
  };

  const cutoff = monthsAgoIso(today, thresholds.riskWindowMonths);
  const hasContract = invoice.contractId !== null;

  const statements = [
    {
      sql: "SELECT id, name, siren, vat_number AS vatNumber FROM suppliers WHERE id = ?",
      args: [invoice.supplierId],
    },
    {
      sql: "SELECT iban, effective_from AS effectiveFrom FROM iban_history WHERE supplier_id = ? ORDER BY effective_from DESC",
      args: [invoice.supplierId],
    },
    {
      sql: "SELECT event_date AS eventDate, description FROM risk_events WHERE supplier_id = ?",
      args: [invoice.supplierId],
    },
    {
      // Rules (deviation-history.ts's historySample slice) depend on this DESC ordering to mean "most recent".
      sql: `
        SELECT invoices.entity_id AS entityId, entities.name AS entityName, invoices.category AS category,
               invoices.amount_excl_vat_cents AS amountExclVatCents, invoices.due_date AS dueDate
        FROM invoices
        JOIN entities ON entities.id = invoices.entity_id
        WHERE invoices.supplier_id = ? AND invoices.status = 'approved' AND invoices.due_date >= ? AND invoices.id != ?
        ORDER BY invoices.due_date DESC
      `,
      args: [invoice.supplierId, cutoff, invoice.id],
    },
    {
      sql: "SELECT DISTINCT category FROM invoices WHERE entity_id = ? AND status = 'approved'",
      args: [invoice.entityId],
    },
    {
      sql: `
        SELECT id, invoice_number AS invoiceNumber, status, amount_incl_vat_cents AS amountInclVatCents,
               issue_date AS issueDate, entity_id AS entityId
        FROM invoices
        WHERE supplier_id = ? AND id != ?
      `,
      args: [invoice.supplierId, invoice.id],
    },
    ...(hasContract
      ? [
          {
            sql: "SELECT id, category, expected_amount_cents AS expectedAmountCents FROM contracts WHERE id = ?",
            args: [invoice.contractId as string],
          },
        ]
      : []),
  ];

  const results = await db.batch(statements, "read");

  const supplierRow = results[0].rows[0];
  const ibanRows = results[1].rows;
  const riskRows = results[2].rows;
  const groupApprovedRows = results[3].rows;
  const categoryRows = results[4].rows;
  const otherInvoiceRows = results[5].rows;
  const contractRow = hasContract ? results[6].rows[0] : undefined;

  return {
    invoice,
    supplier: {
      id: String(supplierRow.id),
      name: String(supplierRow.name),
      siren: String(supplierRow.siren),
      vatNumber: String(supplierRow.vatNumber),
    },
    ibanHistory: ibanRows.map((row) => ({
      iban: String(row.iban),
      effectiveFrom: String(row.effectiveFrom),
    })),
    riskEvents: riskRows.map((row) => ({
      eventDate: String(row.eventDate),
      description: String(row.description),
    })),
    contract: contractRow
      ? {
          id: String(contractRow.id),
          category: String(contractRow.category),
          expectedAmountCents:
            contractRow.expectedAmountCents === null ? null : Number(contractRow.expectedAmountCents),
        }
      : null,
    groupApprovedInvoices: groupApprovedRows.map((row) => ({
      entityId: String(row.entityId),
      entityName: String(row.entityName),
      category: String(row.category),
      amountExclVatCents: Number(row.amountExclVatCents),
      dueDate: String(row.dueDate),
    })),
    subsidiaryApprovedCategories: categoryRows.map((row) => String(row.category)),
    otherSupplierInvoices: otherInvoiceRows.map((row) => ({
      id: String(row.id),
      invoiceNumber: String(row.invoiceNumber),
      status: String(row.status),
      amountInclVatCents: Number(row.amountInclVatCents),
      issueDate: String(row.issueDate),
      entityId: String(row.entityId),
    })),
    thresholds,
  };
}
