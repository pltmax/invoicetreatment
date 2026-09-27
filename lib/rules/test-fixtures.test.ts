// lib/rules/test-fixtures.test.ts
import { describe, it, expect } from "vitest";
import { buildContext } from "./test-fixtures";

describe("buildContext", () => {
  it("builds a self-consistent default context with 6 months of matching history", () => {
    const ctx = buildContext();
    expect(ctx.invoice.category).toBe(ctx.contract?.category);
    expect(ctx.groupApprovedInvoices).toHaveLength(6);
    expect(ctx.supplier.siren).toBe(ctx.invoice.printedSiren);
    expect(ctx.supplier.vatNumber).toBe(ctx.invoice.printedVatNumber);
  });

  it("allows overriding a single invoice field without losing the rest", () => {
    const ctx = buildContext({ invoice: { amountExclVatCents: 999 } });
    expect(ctx.invoice.amountExclVatCents).toBe(999);
    expect(ctx.invoice.category).toBe("maintenance");
  });

  it("allows explicitly overriding contract to null", () => {
    const ctx = buildContext({ contract: null });
    expect(ctx.contract).toBeNull();
  });
});
