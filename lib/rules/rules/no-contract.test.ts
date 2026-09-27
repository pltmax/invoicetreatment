import { describe, it, expect } from "vitest";
import { buildContext } from "../test-fixtures";
import noContractRule from "./no-contract";

describe("no-contract rule", () => {
  it("returns orange when the invoice has no contract_id", () => {
    const ctx = buildContext({ invoice: { contractId: null }, contract: null });
    const reason = noContractRule(ctx);
    expect(reason?.code).toBe("NO_CONTRACT");
    expect(reason?.level).toBe("orange");
  });

  it("does not trigger when the invoice has a contract_id", () => {
    const ctx = buildContext();
    expect(noContractRule(ctx)).toBeNull();
  });
});
