"use server";

import "server-only";
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { db } from "../../lib/db/client";
import { classifyAll } from "../../lib/rules/classify-all";
import { extractInvoiceFromPdf, ExtractionError } from "../../lib/extraction/extract";
import { resolveSupplierId, findContractId } from "../../lib/extraction/supplier-matching";
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
  const contractId = await findContractId(db, entityId, supplierId, extracted.category, extracted.issueDate);

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
