// lib/rules/rules/not-recurring.test.ts
import { describe, it, expect } from "vitest";
import { buildContext } from "../test-fixtures";
import notRecurringRule from "./not-recurring";

const invoiceAt = (entityId: string) => ({
  entityId,
  entityName: "Filiale",
  category: "maintenance",
  amountExclVatCents: 100_000,
  dueDate: "2026-01-15",
});

describe("not-recurring rule", () => {
  it("returns orange when the supplier is known group-wide but has fewer than 3 approved invoices at this subsidiary", () => {
    const ctx = buildContext({
      groupApprovedInvoices: [invoiceAt("ent-other"), invoiceAt("ent-other")],
    });
    const reason = notRecurringRule(ctx);
    expect(reason?.code).toBe("NOT_RECURRING");
    expect(reason?.level).toBe("orange");
  });

  it("does not trigger when there are at least 3 approved invoices at this subsidiary", () => {
    const ctx = buildContext({
      groupApprovedInvoices: [invoiceAt("ent-1"), invoiceAt("ent-1"), invoiceAt("ent-1")],
    });
    expect(notRecurringRule(ctx)).toBeNull();
  });

  it("does not trigger for a brand-new supplier (handled by new-supplier instead)", () => {
    const ctx = buildContext({ groupApprovedInvoices: [] });
    expect(notRecurringRule(ctx)).toBeNull();
  });

  it("uses a custom minimum from context instead of the default 3", () => {
    const ctx = buildContext({
      groupApprovedInvoices: [invoiceAt("ent-1"), invoiceAt("ent-1")],
      thresholds: { recurringMinInvoices: 2 },
    });
    expect(notRecurringRule(ctx)).toBeNull();
  });
});
