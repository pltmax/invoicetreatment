import "server-only";
import { put } from "@vercel/blob";
import type { Client } from "@libsql/client";
import { setInvoicePdfPathname } from "../db/queries";

export async function storeInvoicePdf(db: Client, invoiceId: string, pdf: Buffer): Promise<void> {
  const pathname = `invoices/${invoiceId}.pdf`;
  await put(pathname, pdf, { access: "private" });
  await setInvoicePdfPathname(db, invoiceId, pathname);
}
