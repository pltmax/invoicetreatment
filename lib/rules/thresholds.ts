// Upward deviation vs. history/contract/peer median that pushes a classification
// to orange, and further to red. Downward deviation never triggers a reason.
export const DEVIATION_ORANGE = 0.15;
export const DEVIATION_RED = 0.4;

// Cents, HT. Orange/red split for the "new supplier" rule.
export const NEW_SUPPLIER_AMOUNT = 5_000_00;

// Cents, HT. Unconditional red trigger regardless of supplier newness.
export const EXCEPTIONAL_AMOUNT = 50_000_00;

export const IBAN_RECENT_CHANGE_DAYS = 90;
export const RISK_WINDOW_MONTHS = 12;
export const DUPLICATE_WINDOW_DAYS = 60;
export const RECURRING_MIN_INVOICES = 3;
export const HISTORY_SAMPLE = 6;

export const RULES_VERSION = "1.0.0";
