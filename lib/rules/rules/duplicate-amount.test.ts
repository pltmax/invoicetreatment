import { describe, it, expect } from "vitest";
import { buildContext } from "../test-fixtures";
import duplicateAmountRule from "./duplicate-amount";

describe("duplicate-amount rule", () => {
  it("returns red for a same-amount, same-subsidiary invoice issued 10 days apart", () => {
    const ctx = buildContext({
      invoice: { issueDate: "2026-05-31", amountInclVatCents: 120_000 },
      otherSupplierInvoices: [
        {
          id: "inv-other",
          invoiceNumber: "INV-999",
          status: "approved",
          amountInclVatCents: 120_000,
          issueDate: "2026-05-21",
          entityId: "ent-1",
        },
      ],
    });
    const reason = duplicateAmountRule(ctx);
    expect(reason?.code).toBe("DUPLICATE_AMOUNT");
    expect(reason?.level).toBe("red");
  });

  it("does not trigger when the matching amount is issued outside the 60-day window", () => {
    const ctx = buildContext({
      invoice: { issueDate: "2026-05-31", amountInclVatCents: 120_000 },
      otherSupplierInvoices: [
        {
          id: "inv-other",
          invoiceNumber: "INV-999",
          status: "approved",
          amountInclVatCents: 120_000,
          issueDate: "2026-03-01",
          entityId: "ent-1",
        },
      ],
    });
    expect(duplicateAmountRule(ctx)).toBeNull();
  });

  it("does not trigger when the amount matches but the subsidiary differs", () => {
    const ctx = buildContext({
      invoice: { issueDate: "2026-05-31", amountInclVatCents: 120_000 },
      otherSupplierInvoices: [
        {
          id: "inv-other",
          invoiceNumber: "INV-999",
          status: "approved",
          amountInclVatCents: 120_000,
          issueDate: "2026-05-21",
          entityId: "ent-other",
        },
      ],
    });
    expect(duplicateAmountRule(ctx)).toBeNull();
  });

  it("uses a custom window from context instead of the default 60 days", () => {
    const ctx = buildContext({
      invoice: { issueDate: "2026-05-31", amountInclVatCents: 120_000 },
      otherSupplierInvoices: [
        {
          id: "inv-other",
          invoiceNumber: "INV-999",
          status: "approved",
          amountInclVatCents: 120_000,
          // 77 days before 2026-05-31 — outside the default 60-day window,
          // inside a custom 90-day one.
          issueDate: "2026-03-15",
          entityId: "ent-1",
        },
      ],
      thresholds: { duplicateWindowDays: 90 },
    });
    const reason = duplicateAmountRule(ctx);
    expect(reason?.code).toBe("DUPLICATE_AMOUNT");
    expect(reason?.level).toBe("red");
  });
});
