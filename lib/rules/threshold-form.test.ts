import { describe, it, expect } from "vitest";
import { parseThresholdsForm, isValidThresholdOrder } from "./threshold-form";

function formWith(overrides: Record<string, string>): FormData {
  const defaults: Record<string, string> = {
    deviationOrangePct: "15",
    deviationRedPct: "40",
    newSupplierAmountEuros: "5000",
    exceptionalAmountEuros: "50000",
    ibanRecentChangeDays: "90",
    riskWindowMonths: "12",
    duplicateWindowDays: "60",
    recurringMinInvoices: "3",
    historySample: "6",
    ...overrides,
  };
  const formData = new FormData();
  for (const [key, value] of Object.entries(defaults)) {
    formData.set(key, value);
  }
  return formData;
}

describe("parseThresholdsForm", () => {
  it("converts euros to cents and percentages to ratios", () => {
    const parsed = parseThresholdsForm(formWith({}));
    expect(parsed).toEqual({
      deviationOrange: 0.15,
      deviationRed: 0.4,
      newSupplierAmountCents: 500_000,
      exceptionalAmountCents: 5_000_000,
      ibanRecentChangeDays: 90,
      riskWindowMonths: 12,
      duplicateWindowDays: 60,
      recurringMinInvoices: 3,
      historySample: 6,
    });
  });

  it("returns null when a field is zero, negative, or not a number", () => {
    expect(parseThresholdsForm(formWith({ exceptionalAmountEuros: "0" }))).toBeNull();
    expect(parseThresholdsForm(formWith({ recurringMinInvoices: "-1" }))).toBeNull();
    expect(parseThresholdsForm(formWith({ historySample: "abc" }))).toBeNull();
  });

  it("returns null when a count/day/month field is not an integer", () => {
    expect(parseThresholdsForm(formWith({ historySample: "2.5" }))).toBeNull();
    expect(parseThresholdsForm(formWith({ ibanRecentChangeDays: "90.5" }))).toBeNull();
    expect(parseThresholdsForm(formWith({ riskWindowMonths: "12.1" }))).toBeNull();
    expect(parseThresholdsForm(formWith({ duplicateWindowDays: "60.9" }))).toBeNull();
    expect(parseThresholdsForm(formWith({ recurringMinInvoices: "3.5" }))).toBeNull();
  });

  it("still accepts non-integer values for percent/amount fields", () => {
    const parsed = parseThresholdsForm(
      formWith({ deviationOrangePct: "12.5", exceptionalAmountEuros: "1500.50" })
    );
    expect(parsed).not.toBeNull();
    expect(parsed!.deviationOrange).toBeCloseTo(0.125);
    expect(parsed!.exceptionalAmountCents).toBe(150050);
  });
});

describe("isValidThresholdOrder", () => {
  it("accepts a valid ordering where red is above orange", () => {
    const parsed = parseThresholdsForm(formWith({}));
    expect(parsed).not.toBeNull();
    expect(isValidThresholdOrder(parsed!)).toBe(true);
  });

  it("flags an invalid ordering where red is not above orange", () => {
    const parsed = parseThresholdsForm(formWith({ deviationOrangePct: "40", deviationRedPct: "40" }));
    expect(parsed).not.toBeNull();
    expect(isValidThresholdOrder(parsed!)).toBe(false);
  });
});
