import { z } from "zod";

// Mirrors lib/format.ts's CATEGORY_LABELS keys, plus a catch-all. Kept as
// a literal tuple (not derived from CATEGORY_LABELS) so this schema has
// no import-time dependency on lib/format.ts — the enum is the contract
// Claude is constrained to, CATEGORY_LABELS is the display layer for it.
export const EXTRACTION_CATEGORIES = [
  "cloud_hosting",
  "consulting",
  "design",
  "equipment",
  "facilities",
  "fleet",
  "it_integration",
  "logistics",
  "maintenance",
  "marketing",
  "office_supplies",
  "telecom_maintenance",
  "utilities",
  "autre",
] as const;

export const ExtractedInvoiceSchema = z.object({
  supplierName: z.string().describe("Supplier's name exactly as printed on the invoice"),
  printedSiren: z.string().describe("Supplier's SIREN as printed (digits only, no spaces)"),
  printedVatNumber: z.string().describe("Supplier's French VAT number as printed (e.g. FR12345678901)"),
  printedIban: z.string().describe("Supplier's IBAN as printed, no spaces"),
  invoiceNumber: z.string().describe("The invoice's own reference number"),
  category: z.enum(EXTRACTION_CATEGORIES).describe(
    "Best-fitting category for what's being billed. Use \"autre\" only if none of the others fit."
  ),
  amountExclVatCents: z.number().int().describe("Amount excl. VAT, in integer cents"),
  amountInclVatCents: z.number().int().describe("Amount incl. VAT, in integer cents"),
  issueDate: z.string().describe("Invoice issue date, ISO 8601 (YYYY-MM-DD)"),
  dueDate: z.string().describe("Payment due date, ISO 8601 (YYYY-MM-DD)"),
});

export type ExtractedInvoice = z.infer<typeof ExtractedInvoiceSchema>;
