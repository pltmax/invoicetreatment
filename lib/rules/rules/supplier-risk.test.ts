// lib/rules/rules/supplier-risk.test.ts
import { describe, it, expect } from "vitest";
import { buildContext } from "../test-fixtures";
import supplierRiskRule from "./supplier-risk";

const TODAY = new Date("2026-06-15");

describe("supplier-risk rule", () => {
  it("returns red for a risk event 2 months ago", () => {
    const ctx = buildContext({
      riskEvents: [{ eventDate: "2026-04-15", description: "Alerte conformité interne." }],
    });
    const reason = supplierRiskRule(ctx, TODAY);
    expect(reason?.code).toBe("SUPPLIER_RISK");
    expect(reason?.level).toBe("red");
    expect(reason?.data?.monthsAgo).toBe(2);
  });

  it("does not trigger for a risk event more than 12 months ago", () => {
    const ctx = buildContext({
      riskEvents: [{ eventDate: "2025-01-15", description: "Ancien incident." }],
    });
    expect(supplierRiskRule(ctx, TODAY)).toBeNull();
  });

  it("does not trigger when there are no risk events", () => {
    const ctx = buildContext({ riskEvents: [] });
    expect(supplierRiskRule(ctx, TODAY)).toBeNull();
  });
});
