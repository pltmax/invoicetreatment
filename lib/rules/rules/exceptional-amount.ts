import type { InvoiceContext, Reason } from "../types";
import { formatEuros } from "../../format";

export default function exceptionalAmountRule(ctx: InvoiceContext): Reason | null {
  const amount = ctx.invoice.amountExclVatCents;
  if (amount <= ctx.thresholds.exceptionalAmountCents) return null;

  const message = `Montant exceptionnel : ${formatEuros(amount)} HT (seuil ${formatEuros(ctx.thresholds.exceptionalAmountCents)})`;
  return {
    code: "EXCEPTIONAL_AMOUNT",
    level: "red",
    message,
    data: { amountExclVatCents: amount, threshold: ctx.thresholds.exceptionalAmountCents },
  };
}
