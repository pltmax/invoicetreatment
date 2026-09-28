import type { InvoiceContext, Reason } from "../types";
import { median } from "../stats";
import { formatEuros, formatPercent } from "../../format";

export default function deviationHistoryRule(ctx: InvoiceContext): Reason | null {
  // Depends on groupApprovedInvoices being ordered newest-first (see context.ts's ORDER BY due_date DESC).
  const sample = ctx.groupApprovedInvoices
    .filter((i) => i.entityId === ctx.invoice.entityId && i.category === ctx.invoice.category)
    .slice(0, ctx.thresholds.historySample)
    .map((i) => i.amountExclVatCents);

  const baseline = median(sample);
  if (baseline === null || baseline === 0) return null;

  const amount = ctx.invoice.amountExclVatCents;
  const deviation = (amount - baseline) / baseline;
  if (deviation <= ctx.thresholds.deviationOrange) return null;

  const message = `Montant ${formatEuros(amount)} HT, ${formatPercent(deviation)} au-dessus de l'historique (médiane ${formatEuros(baseline)} HT sur ${sample.length} factures)`;
  const data = {
    amountExclVatCents: amount,
    medianExclVatCents: baseline,
    deviationPct: deviation,
    sampleCount: sample.length,
  };

  if (deviation > ctx.thresholds.deviationRed) {
    return { code: "DEVIATION_HISTORY_HIGH", level: "red", message, data };
  }
  return { code: "DEVIATION_HISTORY", level: "orange", message, data };
}
