import "server-only";
import type { Client } from "@libsql/client";
import type { Level, Reason } from "../rules/types";
import type { Thresholds } from "../rules/thresholds";
import { SEED_HISTORY_SESSION_PREFIX } from "./seed";

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

export async function getDecisionSessionId(db: Client, invoiceId: string): Promise<string | null> {
  const result = await db.execute({
    sql: "SELECT session_id AS sessionId FROM decisions WHERE invoice_id = ?",
    args: [invoiceId],
  });
  const row = result.rows[0];
  return row ? String(row.sessionId) : null;
}

export interface BordereauDecisionRow {
  invoiceId: string;
  invoiceNumber: string;
  supplierName: string;
  entityName: string;
  amountInclVatCents: number;
  level: Level | null;
  outcome: "approved" | "rejected";
  comment: string | null;
}

export interface BordereauSessionRow {
  id: string;
  kind: "batch" | "single";
  contentHash: string;
  signatureRef: string;
  signedAt: string;
  decisions: BordereauDecisionRow[];
}

export async function getSessionWithDecisions(
  db: Client,
  sessionId: string
): Promise<BordereauSessionRow | null> {
  const sessionResult = await db.execute({
    sql: "SELECT id, kind, content_hash AS contentHash, signature_ref AS signatureRef, signed_at AS signedAt FROM sessions WHERE id = ?",
    args: [sessionId],
  });
  const sessionRow = sessionResult.rows[0];
  if (!sessionRow) return null;

  const decisionsResult = await db.execute({
    sql: `
      SELECT
        decisions.invoice_id AS invoiceId,
        invoices.invoice_number AS invoiceNumber,
        suppliers.name AS supplierName,
        entities.name AS entityName,
        invoices.amount_incl_vat_cents AS amountInclVatCents,
        classifications.level AS level,
        decisions.outcome AS outcome,
        decisions.comment AS comment
      FROM decisions
      JOIN invoices ON invoices.id = decisions.invoice_id
      JOIN suppliers ON suppliers.id = invoices.supplier_id
      JOIN entities ON entities.id = invoices.entity_id
      LEFT JOIN classifications ON classifications.invoice_id = invoices.id
      WHERE decisions.session_id = ?
      ORDER BY invoices.due_date ASC
    `,
    args: [sessionId],
  });

  return {
    id: String(sessionRow.id),
    kind: String(sessionRow.kind) as "batch" | "single",
    contentHash: String(sessionRow.contentHash),
    signatureRef: String(sessionRow.signatureRef),
    signedAt: String(sessionRow.signedAt),
    decisions: decisionsResult.rows.map((row) => ({
      invoiceId: String(row.invoiceId),
      invoiceNumber: String(row.invoiceNumber),
      supplierName: String(row.supplierName),
      entityName: String(row.entityName),
      amountInclVatCents: Number(row.amountInclVatCents),
      level: row.level === null ? null : (String(row.level) as Level),
      outcome: String(row.outcome) as "approved" | "rejected",
      comment: row.comment === null ? null : String(row.comment),
    })),
  };
}

export interface InboxInvoiceRow {
  id: string;
  invoiceNumber: string;
  supplierName: string;
  entityName: string;
  amountInclVatCents: number;
  receivedAt: string;
}

export async function getInboxInvoices(db: Client): Promise<InboxInvoiceRow[]> {
  const result = await db.execute(`
    SELECT
      invoices.id AS id,
      invoices.invoice_number AS invoiceNumber,
      suppliers.name AS supplierName,
      entities.name AS entityName,
      invoices.amount_incl_vat_cents AS amountInclVatCents,
      invoices.created_at AS receivedAt
    FROM invoices
    JOIN suppliers ON suppliers.id = invoices.supplier_id
    JOIN entities ON entities.id = invoices.entity_id
    WHERE invoices.status = 'pending'
    ORDER BY invoices.created_at DESC
  `);

  return result.rows.map((row) => ({
    id: String(row.id),
    invoiceNumber: String(row.invoiceNumber),
    supplierName: String(row.supplierName),
    entityName: String(row.entityName),
    amountInclVatCents: Number(row.amountInclVatCents),
    receivedAt: String(row.receivedAt),
  }));
}

export interface NotificationRow {
  invoiceId: string;
  invoiceNumber: string;
  entityName: string;
  amountInclVatCents: number;
  level: Level | null;
  outcome: "approved" | "rejected";
  sentAt: string;
}

export async function getNotifications(db: Client): Promise<NotificationRow[]> {
  const result = await db.execute({
    sql: `
      SELECT
        decisions.invoice_id AS invoiceId,
        invoices.invoice_number AS invoiceNumber,
        entities.name AS entityName,
        invoices.amount_incl_vat_cents AS amountInclVatCents,
        classifications.level AS level,
        decisions.outcome AS outcome,
        decisions.created_at AS sentAt
      FROM decisions
      JOIN invoices ON invoices.id = decisions.invoice_id
      JOIN entities ON entities.id = invoices.entity_id
      LEFT JOIN classifications ON classifications.invoice_id = invoices.id
      -- Excludes seed.ts's backfilled 12-month approval history, which
      -- never sent a real notification.
      WHERE decisions.session_id NOT LIKE ?
      ORDER BY decisions.created_at DESC
    `,
    args: [`${SEED_HISTORY_SESSION_PREFIX}%`],
  });

  return result.rows.map((row) => ({
    invoiceId: String(row.invoiceId),
    invoiceNumber: String(row.invoiceNumber),
    entityName: String(row.entityName),
    amountInclVatCents: Number(row.amountInclVatCents),
    level: row.level === null ? null : (String(row.level) as Level),
    outcome: String(row.outcome) as "approved" | "rejected",
    sentAt: String(row.sentAt),
  }));
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

export async function getThresholds(db: Client): Promise<Thresholds> {
  const result = await db.execute(
    "SELECT deviation_orange AS deviationOrange, deviation_red AS deviationRed, new_supplier_amount_cents AS newSupplierAmountCents, exceptional_amount_cents AS exceptionalAmountCents, iban_recent_change_days AS ibanRecentChangeDays, risk_window_months AS riskWindowMonths, duplicate_window_days AS duplicateWindowDays, recurring_min_invoices AS recurringMinInvoices, history_sample AS historySample FROM thresholds WHERE id = 'default'"
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error("thresholds row not found — did seed() run?");
  }
  return {
    deviationOrange: Number(row.deviationOrange),
    deviationRed: Number(row.deviationRed),
    newSupplierAmountCents: Number(row.newSupplierAmountCents),
    exceptionalAmountCents: Number(row.exceptionalAmountCents),
    ibanRecentChangeDays: Number(row.ibanRecentChangeDays),
    riskWindowMonths: Number(row.riskWindowMonths),
    duplicateWindowDays: Number(row.duplicateWindowDays),
    recurringMinInvoices: Number(row.recurringMinInvoices),
    historySample: Number(row.historySample),
  };
}
