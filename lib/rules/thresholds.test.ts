import { describe, it, expect } from "vitest";
import * as thresholds from "./thresholds";

describe("thresholds", () => {
  it("exposes every constant from the spec with the exact values", () => {
    expect(thresholds.DEVIATION_ORANGE).toBe(0.15);
    expect(thresholds.DEVIATION_RED).toBe(0.4);
    expect(thresholds.NEW_SUPPLIER_AMOUNT).toBe(500_000);
    expect(thresholds.EXCEPTIONAL_AMOUNT).toBe(5_000_000);
    expect(thresholds.IBAN_RECENT_CHANGE_DAYS).toBe(90);
    expect(thresholds.RISK_WINDOW_MONTHS).toBe(12);
    expect(thresholds.DUPLICATE_WINDOW_DAYS).toBe(60);
    expect(thresholds.RECURRING_MIN_INVOICES).toBe(3);
    expect(thresholds.HISTORY_SAMPLE).toBe(6);
    expect(thresholds.RULES_VERSION).toBe("1.0.0");
  });
});
