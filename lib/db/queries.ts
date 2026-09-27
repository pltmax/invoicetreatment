import "server-only";
import type { Client } from "@libsql/client";

export interface PendingInvoiceRow {
  id: string;
  invoiceNumber: string;
  supplierName: string;
  entityName: string;
  amountInclVatCents: number;
  dueDate: string;
  category: string;
  level: "green" | "orange" | "red" | null;
  reasonMessages: string[];
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

  return result.rows.map((row) => ({
    id: String(row.id),
    invoiceNumber: String(row.invoiceNumber),
    supplierName: String(row.supplierName),
    entityName: String(row.entityName),
    amountInclVatCents: Number(row.amountInclVatCents),
    dueDate: String(row.dueDate),
    category: String(row.category),
    level: row.level === null ? null : (String(row.level) as "green" | "orange" | "red"),
    reasonMessages: row.reasons
      ? (JSON.parse(String(row.reasons)) as Array<{ message: string }>).map((r) => r.message)
      : [],
  }));
}
