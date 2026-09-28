import type { Thresholds } from "./thresholds";

export type ParsedThresholdsInput = Thresholds;

// Reads the raw form fields (euros/percent, matching what the /rules page
// displays), validates they're all finite positive numbers, and converts
// to the ratio/cents units the rules engine and DB use. Returns null if
// any field is missing or not a positive number.
export function parseThresholdsForm(formData: FormData): ParsedThresholdsInput | null {
  const deviationOrangePct = Number(formData.get("deviationOrangePct"));
  const deviationRedPct = Number(formData.get("deviationRedPct"));
  const newSupplierAmountEuros = Number(formData.get("newSupplierAmountEuros"));
  const exceptionalAmountEuros = Number(formData.get("exceptionalAmountEuros"));
  const ibanRecentChangeDays = Number(formData.get("ibanRecentChangeDays"));
  const riskWindowMonths = Number(formData.get("riskWindowMonths"));
  const duplicateWindowDays = Number(formData.get("duplicateWindowDays"));
  const recurringMinInvoices = Number(formData.get("recurringMinInvoices"));
  const historySample = Number(formData.get("historySample"));

  const rawValues = [
    deviationOrangePct,
    deviationRedPct,
    newSupplierAmountEuros,
    exceptionalAmountEuros,
    ibanRecentChangeDays,
    riskWindowMonths,
    duplicateWindowDays,
    recurringMinInvoices,
    historySample,
  ];
  if (rawValues.some((value) => !Number.isFinite(value) || value <= 0)) {
    return null;
  }

  const integerValues = [
    ibanRecentChangeDays,
    riskWindowMonths,
    duplicateWindowDays,
    recurringMinInvoices,
    historySample,
  ];
  if (integerValues.some((value) => !Number.isInteger(value))) {
    return null;
  }

  return {
    deviationOrange: deviationOrangePct / 100,
    deviationRed: deviationRedPct / 100,
    newSupplierAmountCents: Math.round(newSupplierAmountEuros * 100),
    exceptionalAmountCents: Math.round(exceptionalAmountEuros * 100),
    ibanRecentChangeDays,
    riskWindowMonths,
    duplicateWindowDays,
    recurringMinInvoices,
    historySample,
  };
}

// A rule engine where "red" isn't strictly above "orange" makes the
// orange band unreachable — every invoice that crosses orange would
// immediately read as red.
export function isValidThresholdOrder(parsed: ParsedThresholdsInput): boolean {
  return parsed.deviationRed > parsed.deviationOrange;
}
