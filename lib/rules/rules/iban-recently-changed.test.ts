// lib/rules/rules/iban-recently-changed.test.ts
import { describe, it, expect } from "vitest";
import { buildContext } from "../test-fixtures";
import ibanRecentlyChangedRule from "./iban-recently-changed";

const TODAY = new Date("2026-06-15");

describe("iban-recently-changed rule", () => {
  it("returns red when the current IBAN took effect 5 days ago", () => {
    const ctx = buildContext({
      ibanHistory: [
        { iban: "FR1420041010050500013M02606", effectiveFrom: "2026-06-10" },
        { iban: "FR7630001007941234567890185", effectiveFrom: "2024-01-01" },
      ],
    });
    const reason = ibanRecentlyChangedRule(ctx, TODAY);
    expect(reason?.code).toBe("IBAN_RECENTLY_CHANGED");
    expect(reason?.level).toBe("red");
    expect(reason?.data?.daysAgo).toBe(5);
  });

  it("does not trigger when the current IBAN has been effective for over 90 days", () => {
    const ctx = buildContext({
      ibanHistory: [{ iban: "FR1420041010050500013M02606", effectiveFrom: "2024-01-01" }],
    });
    expect(ibanRecentlyChangedRule(ctx, TODAY)).toBeNull();
  });

  it("does not trigger at exactly 90 days after the change", () => {
    const ctx = buildContext({
      ibanHistory: [{ iban: "FR1420041010050500013M02606", effectiveFrom: "2026-03-17" }],
    });
    // 2026-03-17 -> 2026-06-15 is exactly 90 days.
    expect(ibanRecentlyChangedRule(ctx, TODAY)).not.toBeNull();
    const justOver = ibanRecentlyChangedRule(ctx, new Date("2026-06-16"));
    expect(justOver).toBeNull();
  });

  it("does not trigger when there is no IBAN history", () => {
    const ctx = buildContext({ ibanHistory: [] });
    expect(ibanRecentlyChangedRule(ctx, TODAY)).toBeNull();
  });
});
