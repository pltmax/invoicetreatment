import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { InvoicePdfDocument, type InvoicePdfData } from "./document";

export async function renderInvoicePdf(data: InvoicePdfData): Promise<Buffer> {
  return renderToBuffer(<InvoicePdfDocument {...data} />);
}
