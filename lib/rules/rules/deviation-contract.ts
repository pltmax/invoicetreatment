import type { InvoiceContext, Reason } from "../types";
import { formatEuros, formatPercent } from "../../format";

export default function deviationContractRule(ctx: InvoiceContext): Reason | null {
  const expected = ctx.contract?.expectedAmountCents;
  if (expected === null || expected === undefined || expected === 0) return null;

  const amount = ctx.invoice.amountExclVatCents;
  const deviation = (amount - expected) / expected;
  if (deviation <= ctx.thresholds.deviationOrange) return null;

  const message = `Montant ${formatEuros(amount)} HT, ${formatPercent(deviation)} au-dessus du contrat (${formatEuros(expected)} HT attendu)`;
  const data = { amountExclVatCents: amount, expectedAmountCents: expected, deviationPct: deviation };

  if (deviation > ctx.thresholds.deviationRed) {
    return { code: "DEVIATION_CONTRACT_HIGH", level: "red", message, data };
  }
  return { code: "DEVIATION_CONTRACT", level: "orange", message, data };
}
