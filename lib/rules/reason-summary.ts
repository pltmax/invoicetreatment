// lib/rules/reason-summary.ts
import type { Reason, ReasonCode } from "./types";
import { formatPercent } from "../format";

// Short labels for compact views (phone lists). The full message stays on the detail page.
const SUMMARY: Record<ReasonCode, string> = {
  DEVIATION_HISTORY: "Écart vs historique",
  DEVIATION_HISTORY_HIGH: "Écart vs historique",
  DEVIATION_CONTRACT: "Écart vs contrat",
  DEVIATION_CONTRACT_HIGH: "Écart vs contrat",
  DEVIATION_PEER: "Écart vs autres filiales",
  DEVIATION_PEER_HIGH: "Écart vs autres filiales",
  DUPLICATE_NUMBER: "Doublon (n° de facture)",
  DUPLICATE_AMOUNT: "Doublon (même montant)",
  IBAN_MISMATCH: "IBAN différent",
  IBAN_RECENTLY_CHANGED: "IBAN modifié récemment",
  IBAN_FOREIGN: "IBAN étranger",
  IDENTITY_MISMATCH: "Identité incohérente",
  EXCEPTIONAL_AMOUNT: "Montant exceptionnel",
  NEW_SUPPLIER_SMALL: "Nouveau fournisseur",
  NEW_SUPPLIER_LARGE: "Nouveau fournisseur",
  NO_CONTRACT: "Sans contrat",
  UNUSUAL_CATEGORY: "Catégorie inhabituelle",
  NOT_RECURRING: "Dépense non récurrente",
  SUPPLIER_RISK: "Fournisseur à risque",
  ALL_CHECKS_PASSED: "Conforme",
};

export const REASON_SUMMARY_CODES = Object.keys(SUMMARY) as ReasonCode[];

const DEVIATION_TARGET: Partial<Record<ReasonCode, string>> = {
  DEVIATION_HISTORY: "historique",
  DEVIATION_HISTORY_HIGH: "historique",
  DEVIATION_CONTRACT: "contrat",
  DEVIATION_CONTRACT_HIGH: "contrat",
  DEVIATION_PEER: "autres filiales",
  DEVIATION_PEER_HIGH: "autres filiales",
};

export function summarizeReason(reason: Reason): string {
  const target = DEVIATION_TARGET[reason.code];
  const pct = reason.data?.deviationPct;
  if (target && typeof pct === "number") {
    return `+${formatPercent(pct)} vs ${target}`;
  }
  return SUMMARY[reason.code];
}
