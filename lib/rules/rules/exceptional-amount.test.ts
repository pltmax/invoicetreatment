import { describe, it, expect } from "vitest";
import { buildContext } from "../test-fixtures";
import exceptionalAmountRule from "./exceptional-amount";

describe("exceptional-amount rule", () => {
  it("returns red when the amount HT exceeds 50 000 €", () => {
    const ctx = buildContext({ invoice: { amountExclVatCents: 60_000_00 } });
    const reason = exceptionalAmountRule(ctx);
    expect(reason?.code).toBe("EXCEPTIONAL_AMOUNT");
    expect(reason?.level).toBe("red");
  });

  it("does not trigger at exactly 50 000 €", () => {
    const ctx = buildContext({ invoice: { amountExclVatCents: 50_000_00 } });
    expect(exceptionalAmountRule(ctx)).toBeNull();
  });

  it("does not trigger for a normal amount", () => {
    const ctx = buildContext({ invoice: { amountExclVatCents: 100_000 } });
    expect(exceptionalAmountRule(ctx)).toBeNull();
  });
});
