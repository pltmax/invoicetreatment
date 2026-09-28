import { describe, it, expect } from "vitest";
import { renderInvoicePdf } from "./generate";
import type { InvoicePdfData } from "./document";

const FIXTURE: InvoicePdfData = {
  invoiceNumber: "TEST-0001",
  issueDate: "2026-08-01",
  dueDate: "2026-09-01",
  category: "consulting",
  amountExclVatCents: 150000,
  amountInclVatCents: 180000,
  printedIban: "FR7640100000010000000000001",
  printedSiren: "400000015",
  printedVatNumber: "FR32400000015",
  supplierName: "Fournisseur Fictif SAS",
  supplierSiret: "40000001500015",
  entityName: "Filiale Fictive",
};

describe("renderInvoicePdf", () => {
  it("renders a non-empty PDF buffer starting with the PDF magic bytes", async () => {
    const pdf = await renderInvoicePdf(FIXTURE);
    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.length).toBeGreaterThan(0);
    expect(pdf.subarray(0, 4).toString("ascii")).toBe("%PDF");
  });
});
