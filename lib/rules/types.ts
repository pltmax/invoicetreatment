// lib/rules/types.ts

export type Level = "green" | "orange" | "red";

export type ReasonCode =
  | "DEVIATION_HISTORY"
  | "DEVIATION_HISTORY_HIGH"
  | "DEVIATION_CONTRACT"
  | "DEVIATION_CONTRACT_HIGH"
  | "DEVIATION_PEER"
  | "DEVIATION_PEER_HIGH"
  | "DUPLICATE_NUMBER"
  | "DUPLICATE_AMOUNT"
  | "IBAN_MISMATCH"
  | "IBAN_RECENTLY_CHANGED"
  | "IBAN_FOREIGN"
  | "IDENTITY_MISMATCH"
  | "EXCEPTIONAL_AMOUNT"
  | "NEW_SUPPLIER_SMALL"
  | "NEW_SUPPLIER_LARGE"
  | "NO_CONTRACT"
  | "UNUSUAL_CATEGORY"
  | "NOT_RECURRING"
  | "SUPPLIER_RISK"
  | "ALL_CHECKS_PASSED";

export interface Reason {
  code: ReasonCode;
  level: Level;
  message: string;
  data?: Record<string, unknown>;
}

export interface Classification {
  level: Level;
  reasons: Reason[];
}

export interface InvoiceContextInvoice {
  id: string;
  entityId: string;
  entityName: string;
  supplierId: string;
  contractId: string | null;
  invoiceNumber: string;
  category: string;
  amountExclVatCents: number;
  amountInclVatCents: number;
  dueDate: string;
  issueDate: string;
  printedIban: string;
  printedSiren: string;
  printedVatNumber: string;
}

export interface InvoiceContextSupplier {
  id: string;
  name: string;
  siren: string;
  vatNumber: string;
}

export interface IbanHistoryEntry {
  iban: string;
  effectiveFrom: string;
}

export interface RiskEventEntry {
  eventDate: string;
  description: string;
}

export interface ContractInfo {
  id: string;
  category: string;
  expectedAmountCents: number | null;
}

export interface GroupApprovedInvoice {
  entityId: string;
  entityName: string;
  category: string;
  amountExclVatCents: number;
  dueDate: string;
}

export interface OtherSupplierInvoice {
  id: string;
  invoiceNumber: string;
  status: string;
  amountInclVatCents: number;
  issueDate: string;
  entityId: string;
}

export interface InvoiceContext {
  invoice: InvoiceContextInvoice;
  supplier: InvoiceContextSupplier;
  ibanHistory: IbanHistoryEntry[];
  riskEvents: RiskEventEntry[];
  contract: ContractInfo | null;
  groupApprovedInvoices: GroupApprovedInvoice[];
  subsidiaryApprovedCategories: string[];
  otherSupplierInvoices: OtherSupplierInvoice[];
}
