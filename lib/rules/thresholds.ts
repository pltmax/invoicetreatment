export interface Thresholds {
  deviationOrange: number;
  deviationRed: number;
  newSupplierAmountCents: number;
  exceptionalAmountCents: number;
  ibanRecentChangeDays: number;
  riskWindowMonths: number;
  duplicateWindowDays: number;
  recurringMinInvoices: number;
  historySample: number;
}

// Default values, used to seed the `thresholds` DB row and as the shape
// tests build contexts against. The live values a running app uses come
// from that DB row (editable via the /rules page), not from this object —
// see lib/rules/context.ts.
export const DEFAULT_THRESHOLDS: Thresholds = {
  deviationOrange: 0.15,
  deviationRed: 0.4,
  newSupplierAmountCents: 5_000_00,
  exceptionalAmountCents: 50_000_00,
  ibanRecentChangeDays: 90,
  riskWindowMonths: 12,
  duplicateWindowDays: 60,
  recurringMinInvoices: 3,
  historySample: 6,
};

export const RULES_VERSION = "1.0.0";
