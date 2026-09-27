import { describe, it, expect } from "vitest";
import { buildContext } from "../test-fixtures";
import deviationContractRule from "./deviation-contract";

describe("deviation-contract rule", () => {
  it("returns orange when the amount is 20% above the contract's expected amount", () => {
    const ctx = buildContext({ invoice: { amountExclVatCents: 120_000 } });
    const reason = deviationContractRule(ctx);
    expect(reason?.code).toBe("DEVIATION_CONTRACT");
    expect(reason?.level).toBe("orange");
  });

  it("returns red when the amount is 50% above the contract's expected amount", () => {
    const ctx = buildContext({ invoice: { amountExclVatCents: 150_000 } });
    const reason = deviationContractRule(ctx);
    expect(reason?.code).toBe("DEVIATION_CONTRACT_HIGH");
    expect(reason?.level).toBe("red");
  });

  it("does not trigger at exactly the orange threshold (15%)", () => {
    const ctx = buildContext({ invoice: { amountExclVatCents: 115_000 } });
    expect(deviationContractRule(ctx)).toBeNull();
  });

  it("does not trigger when there is no contract", () => {
    const ctx = buildContext({ invoice: { amountExclVatCents: 500_000, contractId: null }, contract: null });
    expect(deviationContractRule(ctx)).toBeNull();
  });
});
