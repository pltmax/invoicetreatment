import { describe, it, expect } from "vitest";
import { DEFAULT_THRESHOLDS, RULES_VERSION } from "./thresholds";

describe("thresholds", () => {
  it("exposes the default value for every threshold", () => {
    expect(DEFAULT_THRESHOLDS.deviationOrange).toBe(0.15);
    expect(DEFAULT_THRESHOLDS.deviationRed).toBe(0.4);
    expect(DEFAULT_THRESHOLDS.newSupplierAmountCents).toBe(500_000);
    expect(DEFAULT_THRESHOLDS.exceptionalAmountCents).toBe(5_000_000);
    expect(DEFAULT_THRESHOLDS.ibanRecentChangeDays).toBe(90);
    expect(DEFAULT_THRESHOLDS.riskWindowMonths).toBe(12);
    expect(DEFAULT_THRESHOLDS.duplicateWindowDays).toBe(60);
    expect(DEFAULT_THRESHOLDS.recurringMinInvoices).toBe(3);
    expect(DEFAULT_THRESHOLDS.historySample).toBe(6);
    expect(RULES_VERSION).toBe("1.0.0");
  });
});
