// lib/rules/engine.ts
import type { Classification, InvoiceContext, Reason, Level } from "./types";
import deviationHistoryRule from "./rules/deviation-history";
import deviationContractRule from "./rules/deviation-contract";
import deviationPeerRule from "./rules/deviation-peer";
import duplicateNumberRule from "./rules/duplicate-number";
import duplicateAmountRule from "./rules/duplicate-amount";
import ibanMismatchRule from "./rules/iban-mismatch";
import ibanRecentlyChangedRule from "./rules/iban-recently-changed";
import ibanForeignRule from "./rules/iban-foreign";
import identityMismatchRule from "./rules/identity-mismatch";
import exceptionalAmountRule from "./rules/exceptional-amount";
import newSupplierRule from "./rules/new-supplier";
import noContractRule from "./rules/no-contract";
import unusualCategoryRule from "./rules/unusual-category";
import notRecurringRule from "./rules/not-recurring";
import supplierRiskRule from "./rules/supplier-risk";

const RULES: Array<(ctx: InvoiceContext, today: Date) => Reason | null> = [
  deviationHistoryRule,
  deviationContractRule,
  deviationPeerRule,
  duplicateNumberRule,
  duplicateAmountRule,
  ibanMismatchRule,
  ibanRecentlyChangedRule,
  ibanForeignRule,
  identityMismatchRule,
  exceptionalAmountRule,
  newSupplierRule,
  noContractRule,
  unusualCategoryRule,
  notRecurringRule,
  supplierRiskRule,
];

const LEVEL_RANK: Record<Level, number> = { red: 3, orange: 2, green: 1 };

function buildAllChecksPassedReason(ctx: InvoiceContext): Reason {
  const sample = ctx.groupApprovedInvoices.filter(
    (i) => i.entityId === ctx.invoice.entityId && i.category === ctx.invoice.category
  );
  return {
    code: "ALL_CHECKS_PASSED",
    level: "green",
    message: "Toutes les vérifications sont conformes.",
    data: {
      contractId: ctx.contract?.id ?? null,
      historyCount: sample.length,
      amountExclVatCents: ctx.invoice.amountExclVatCents,
    },
  };
}

export function classify(ctx: InvoiceContext, today: Date): Classification {
  const reasons = RULES.map((rule) => rule(ctx, today)).filter((r): r is Reason => r !== null);

  if (reasons.length === 0) {
    reasons.push(buildAllChecksPassedReason(ctx));
  }

  reasons.sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level]);

  const level = reasons.reduce<Level>(
    (max, r) => (LEVEL_RANK[r.level] > LEVEL_RANK[max] ? r.level : max),
    "green"
  );

  return { level, reasons };
}
