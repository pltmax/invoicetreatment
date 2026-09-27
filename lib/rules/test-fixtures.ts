// lib/rules/test-fixtures.ts
import { generateValidSiren } from "../checks/siren";
import { computeVatNumber } from "../checks/vat";
import { buildIban } from "../checks/iban";
import type { InvoiceContext } from "./types";

const DEFAULT_SIREN = generateValidSiren("55210055");
const DEFAULT_VAT = computeVatNumber(DEFAULT_SIREN);
const DEFAULT_IBAN = buildIban("FR", "40100000010000000001200");

const DEFAULT_HISTORY_DUE_DATES = [
  "2025-10-15",
  "2025-11-15",
  "2025-12-15",
  "2026-01-15",
  "2026-02-15",
  "2026-03-15",
];

interface ContextOverrides {
  invoice?: Partial<InvoiceContext["invoice"]>;
  supplier?: Partial<InvoiceContext["supplier"]>;
  ibanHistory?: InvoiceContext["ibanHistory"];
  riskEvents?: InvoiceContext["riskEvents"];
  contract?: InvoiceContext["contract"];
  groupApprovedInvoices?: InvoiceContext["groupApprovedInvoices"];
  subsidiaryApprovedCategories?: InvoiceContext["subsidiaryApprovedCategories"];
  otherSupplierInvoices?: InvoiceContext["otherSupplierInvoices"];
}

export function buildContext(overrides: ContextOverrides = {}): InvoiceContext {
  const invoice = {
    id: "inv-1",
    entityId: "ent-1",
    entityName: "Filiale Test",
    supplierId: "sup-1",
    contractId: "con-1",
    invoiceNumber: "INV-001",
    category: "maintenance",
    amountExclVatCents: 100_000,
    amountInclVatCents: 120_000,
    dueDate: "2026-06-30",
    issueDate: "2026-05-31",
    printedIban: DEFAULT_IBAN,
    printedSiren: DEFAULT_SIREN,
    printedVatNumber: DEFAULT_VAT,
    ...overrides.invoice,
  };

  return {
    invoice,
    supplier: {
      id: "sup-1",
      name: "Fournisseur Test",
      siren: DEFAULT_SIREN,
      vatNumber: DEFAULT_VAT,
      ...overrides.supplier,
    },
    ibanHistory: overrides.ibanHistory ?? [{ iban: DEFAULT_IBAN, effectiveFrom: "2024-01-01" }],
    riskEvents: overrides.riskEvents ?? [],
    contract:
      overrides.contract !== undefined
        ? overrides.contract
        : { id: "con-1", category: invoice.category, expectedAmountCents: 100_000 },
    groupApprovedInvoices:
      overrides.groupApprovedInvoices ??
      DEFAULT_HISTORY_DUE_DATES.map((dueDate) => ({
        entityId: invoice.entityId,
        entityName: invoice.entityName,
        category: invoice.category,
        amountExclVatCents: 100_000,
        dueDate,
      })),
    subsidiaryApprovedCategories: overrides.subsidiaryApprovedCategories ?? [invoice.category],
    otherSupplierInvoices: overrides.otherSupplierInvoices ?? [],
  };
}
