import "server-only";
import type { Client } from "@libsql/client";
import type { Level, Reason } from "../rules/types";

export interface PendingInvoiceRow {
  id: string;
  invoiceNumber: string;
  supplierName: string;
  entityName: string;
  amountInclVatCents: number;
  dueDate: string;
  category: string;
  level: Level | null;
  reasons: Reason[];
}

function mapPendingInvoiceRow(row: Record<string, unknown>): PendingInvoiceRow {
  return {
    id: String(row.id),
    invoiceNumber: String(row.invoiceNumber),
    supplierName: String(row.supplierName),
    entityName: String(row.entityName),
    amountInclVatCents: Number(row.amountInclVatCents),
    dueDate: String(row.dueDate),
    category: String(row.category),
    level: row.level === null ? null : (String(row.level) as Level),
    reasons: row.reasons ? (JSON.parse(String(row.reasons)) as Reason[]) : [],
  };
}

export async function getPendingInvoices(db: Client): Promise<PendingInvoiceRow[]> {
  const result = await db.execute(`
    SELECT
      invoices.id AS id,
      invoices.invoice_number AS invoiceNumber,
      suppliers.name AS supplierName,
      entities.name AS entityName,
      invoices.amount_incl_vat_cents AS amountInclVatCents,
      invoices.due_date AS dueDate,
      invoices.category AS category,
      classifications.level AS level,
      classifications.reasons AS reasons
    FROM invoices
    JOIN suppliers ON suppliers.id = invoices.supplier_id
    JOIN entities ON entities.id = invoices.entity_id
    LEFT JOIN classifications ON classifications.invoice_id = invoices.id
    WHERE invoices.status = 'pending'
    ORDER BY invoices.due_date ASC
  `);

  return result.rows.map(mapPendingInvoiceRow);
}

export interface ClassificationRow {
  level: Level;
  reasons: Reason[];
  rulesVersion: string;
  createdAt: string;
}

export async function getClassification(
  db: Client,
  invoiceId: string
): Promise<ClassificationRow | null> {
  const result = await db.execute({
    sql: "SELECT level, reasons, rules_version AS rulesVersion, created_at AS createdAt FROM classifications WHERE invoice_id = ?",
    args: [invoiceId],
  });
  const row = result.rows[0];
  if (!row) return null;
  return {
    level: String(row.level) as Level,
    reasons: JSON.parse(String(row.reasons)) as Reason[],
    rulesVersion: String(row.rulesVersion),
    createdAt: String(row.createdAt),
  };
}

export async function getInvoicesByIds(db: Client, ids: string[]): Promise<PendingInvoiceRow[]> {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(", ");
  const result = await db.execute({
    sql: `
      SELECT
        invoices.id AS id,
        invoices.invoice_number AS invoiceNumber,
        suppliers.name AS supplierName,
        entities.name AS entityName,
        invoices.amount_incl_vat_cents AS amountInclVatCents,
        invoices.due_date AS dueDate,
        invoices.category AS category,
        classifications.level AS level,
        classifications.reasons AS reasons
      FROM invoices
      JOIN suppliers ON suppliers.id = invoices.supplier_id
      JOIN entities ON entities.id = invoices.entity_id
      LEFT JOIN classifications ON classifications.invoice_id = invoices.id
      WHERE invoices.status = 'pending'
        AND invoices.id IN (${placeholders})
        AND classifications.level IN ('green', 'orange')
      ORDER BY invoices.due_date ASC
    `,
    args: ids,
  });

  return result.rows.map(mapPendingInvoiceRow);
}
