import { describe, it, expect } from "vitest";
import { buildContext } from "../test-fixtures";
import newSupplierRule from "./new-supplier";

describe("new-supplier rule", () => {
  it("returns orange for a new supplier at or below 5 000 € HT", () => {
    const ctx = buildContext({
      invoice: { amountExclVatCents: 300_000 },
      groupApprovedInvoices: [],
    });
    const reason = newSupplierRule(ctx);
    expect(reason?.code).toBe("NEW_SUPPLIER_SMALL");
    expect(reason?.level).toBe("orange");
  });

  it("returns red for a new supplier above 5 000 € HT", () => {
    const ctx = buildContext({
      invoice: { amountExclVatCents: 800_000 },
      groupApprovedInvoices: [],
    });
    const reason = newSupplierRule(ctx);
    expect(reason?.code).toBe("NEW_SUPPLIER_LARGE");
    expect(reason?.level).toBe("red");
  });

  it("does not trigger at exactly 5 000 € HT", () => {
    const ctx = buildContext({
      invoice: { amountExclVatCents: 500_000 },
      groupApprovedInvoices: [],
    });
    expect(newSupplierRule(ctx)?.code).toBe("NEW_SUPPLIER_SMALL");
  });

  it("does not trigger when the supplier already has approved invoices in the group", () => {
    const ctx = buildContext({ invoice: { amountExclVatCents: 800_000 } });
    expect(newSupplierRule(ctx)).toBeNull();
  });

  it("uses a custom threshold from context instead of the default 5 000 €", () => {
    const ctx = buildContext({
      invoice: { amountExclVatCents: 300_000 },
      groupApprovedInvoices: [],
      thresholds: { newSupplierAmountCents: 100_000 },
    });
    const reason = newSupplierRule(ctx);
    expect(reason?.code).toBe("NEW_SUPPLIER_LARGE");
    expect(reason?.level).toBe("red");
  });
});
