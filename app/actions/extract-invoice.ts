"use server";

import "server-only";
import { randomUUID } from "node:crypto";
import type { Client } from "@libsql/client";
import type { ExtractedInvoice } from "../../lib/extraction/schema";

const MAX_PDF_BYTES = 10 * 1024 * 1024;

// The modules below ("next/navigation", the real db client, classifyAll,
// and the extraction call) are all imported dynamically inside
// extractInvoice rather than statically at the top of this file. That's
// deliberate: resolveSupplierId and findContractId are unit-tested by
// importing this module directly against an isolated in-memory db, and a
// static top-level import would pull in side effects neither function
// needs:
//   - "next/navigation" pulls in React's app-router context, which under
//     the "react-server" resolve condition (set in vitest.config.ts so a
//     plain "server-only" import doesn't throw during tests) resolves to
//     React's react-server build. That build's createContext doesn't
//     support what app-router-context needs and crashes at import time.
//   - `db` from lib/db/client.ts eagerly opens data/app.db via
//     createClient() at module load — a file that doesn't exist in a
//     fresh checkout/test environment (only `npm run seed` creates it),
//     so merely importing it throws ConnectionFailed.
// Deferring these to dynamic imports inside extractInvoice means loading
// them only happens when the server action itself runs, never when a
// test imports resolveSupplierId/findContractId.
export async function extractInvoice(formData: FormData): Promise<void> {
  const { redirect } = await import("next/navigation");
  const { db } = await import("../../lib/db/client");
  const { classifyAll } = await import("../../lib/rules/classify-all");
  const { extractInvoiceFromPdf, ExtractionError } = await import("../../lib/extraction/extract");

  const entityId = String(formData.get("entityId") ?? "");
  const file = formData.get("pdf");

  if (!entityId) {
    redirect("/extraction?error=missing-entity");
    return;
  }
  if (!(file instanceof File) || file.size === 0) {
    redirect("/extraction?error=missing-file");
    return;
  }
  if (file.type !== "application/pdf") {
    redirect("/extraction?error=not-pdf");
    return;
  }
  if (file.size > MAX_PDF_BYTES) {
    redirect("/extraction?error=too-large");
    return;
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
