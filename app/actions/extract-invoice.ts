"use server";

import "server-only";
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import type { Client } from "@libsql/client";
import { db } from "../../lib/db/client";
import { classifyAll } from "../../lib/rules/classify-all";
import { extractInvoiceFromPdf, ExtractionError } from "../../lib/extraction/extract";
import type { ExtractedInvoice } from "../../lib/extraction/schema";

const MAX_PDF_BYTES = 10 * 1024 * 1024;

export async function extractInvoice(formData: FormData): Promise<void> {
  const entityId = String(formData.get("entityId") ?? "");
  const file = formData.get("pdf");

  if (!entityId) {
    redirect("/extraction?error=missing-entity");
  }
  if (!(file instanceof File) || file.size === 0) {
    redirect("/extraction?error=missing-file");
  }
  if (file.type !== "application/pdf") {
    redirect("/extraction?error=not-pdf");
  }
  if (file.size > MAX_PDF_BYTES) {
    redirect("/extraction?error=too-large");
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const base64 = buffer.toString("base64");

  let extracted: ExtractedInvoice;
  try {
    extracted = await extractInvoiceFromPdf(base64);
  } catch (err) {
    if (err instanceof ExtractionError) {
      redirect(`/extraction?error=extraction&message=${encodeURIComponent(err.message)}`);
    }
    throw err;
  }

  const supplierId = await resolveSupplierId(db, extracted);
  const contractId = await findContractId(db, entityId, supplierId);

  const invoiceId = `inv-extracted-${randomUUID()}`;
  await db.execute({
    sql: `INSERT INTO invoices
      (id, entity_id, supplier_id, contract_id, invoice_number, category, amount_excl_vat_cents, amount_incl_vat_cents, issue_date, due_date, printed_iban, printed_siren, printed_vat_number, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
    args: [
      invoiceId,
      entityId,
      supplierId,
      contractId,
      extracted.invoiceNumber,
      extracted.category,
      extracted.amountExclVatCents,
      extracted.amountInclVatCents,
      extracted.issueDate,
      extracted.dueDate,
      extracted.printedIban,
      extracted.printedSiren,
      extracted.printedVatNumber,
    ],
  });

  await classifyAll(db);

  redirect(`/invoices/${invoiceId}`);
}

export async function resolveSupplierId(db: Client, extracted: ExtractedInvoice): Promise<string> {
  const existing = await db.execute({
    sql: "SELECT id FROM suppliers WHERE siren = ? OR LOWER(name) = LOWER(?)",
    args: [extracted.printedSiren, extracted.supplierName],
  });
  if (existing.rows[0]) {
    return String(existing.rows[0].id);
  }

  const supplierId = `sup-extracted-${randomUUID()}`;
  const oneYearBeforeIssue = new Date(extracted.issueDate);
  oneYearBeforeIssue.setFullYear(oneYearBeforeIssue.getFullYear() - 1);

  await db.batch(
    [
      {
        sql: "INSERT INTO suppliers (id, name, siren, vat_number) VALUES (?, ?, ?, ?)",
        args: [supplierId, extracted.supplierName, extracted.printedSiren, extracted.printedVatNumber],
      },
      {
        sql: "INSERT INTO iban_history (id, supplier_id, iban, effective_from) VALUES (?, ?, ?, ?)",
        args: [
          `ibh-${supplierId}`,
          supplierId,
          extracted.printedIban,
          oneYearBeforeIssue.toISOString().slice(0, 10),
        ],
      },
    ],
    "write"
  );

  return supplierId;
}

export async function findContractId(db: Client, entityId: string, supplierId: string): Promise<string | null> {
  const result = await db.execute({
    sql: "SELECT id FROM contracts WHERE entity_id = ? AND supplier_id = ?",
    args: [entityId, supplierId],
  });
  return result.rows[0] ? String(result.rows[0].id) : null;
}
