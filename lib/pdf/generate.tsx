import { buildInvoicePdfDocument, type InvoicePdfData } from "./document";

export async function renderInvoicePdf(data: InvoicePdfData): Promise<Buffer> {
  // Dynamic import on purpose — see the note in ./document about
  // @react-pdf/hyphenate's ESM-only exports map and CJS resolution under tsx.
  const { renderToBuffer } = await import("@react-pdf/renderer");
  return renderToBuffer(await buildInvoicePdfDocument(data));
}
