import "server-only";
import { put } from "@vercel/blob";
import type { Client } from "@libsql/client";
import { setInvoicePdfPathname } from "../db/queries";

export async function storeInvoicePdf(db: Client, invoiceId: string, pdf: Buffer): Promise<void> {
  const pathname = `invoices/${invoiceId}.pdf`;
  // Seeded invoice ids are deterministic, so re-running `npm run seed` reuses
  // the same pathnames. @vercel/blob defaults allowOverwrite to false and would
  // reject with "blob already exists", so overwriting must be explicit.
  await put(pathname, pdf, { access: "private", allowOverwrite: true });
  await setInvoicePdfPathname(db, invoiceId, pathname);
}
