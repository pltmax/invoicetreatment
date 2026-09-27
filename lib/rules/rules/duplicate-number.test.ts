// lib/rules/rules/duplicate-number.test.ts
import { describe, it, expect } from "vitest";
import { buildContext } from "../test-fixtures";
import duplicateNumberRule from "./duplicate-number";

describe("duplicate-number rule", () => {
  it("returns red when another invoice from the same supplier shares the invoice number", () => {
    const ctx = buildContext({
      otherSupplierInvoices: [
        {
          id: "inv-other",
          invoiceNumber: "INV-001",
          status: "approved",
          amountInclVatCents: 120_000,
          issueDate: "2026-03-01",
          entityId: "ent-1",
        },
      ],
    });
    const reason = duplicateNumberRule(ctx);
    expect(reason?.code).toBe("DUPLICATE_NUMBER");
    expect(reason?.level).toBe("red");
  });

  it("does not trigger when no other invoice shares the number", () => {
    const ctx = buildContext({
      otherSupplierInvoices: [
        {
          id: "inv-other",
          invoiceNumber: "INV-002",
          status: "approved",
          amountInclVatCents: 120_000,
          issueDate: "2026-03-01",
          entityId: "ent-1",
        },
      ],
    });
    expect(duplicateNumberRule(ctx)).toBeNull();
  });

  it("does not trigger when there are no other invoices from this supplier", () => {
    const ctx = buildContext({ otherSupplierInvoices: [] });
    expect(duplicateNumberRule(ctx)).toBeNull();
  });
});
