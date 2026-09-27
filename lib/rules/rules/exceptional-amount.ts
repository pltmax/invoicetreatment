import type { InvoiceContext, Reason } from "../types";
import { EXCEPTIONAL_AMOUNT } from "../thresholds";
import { formatEuros } from "../../format";

export default function exceptionalAmountRule(ctx: InvoiceContext): Reason | null {
  const amount = ctx.invoice.amountExclVatCents;
  if (amount <= EXCEPTIONAL_AMOUNT) return null;

  const message = `Montant exceptionnel : ${formatEuros(amount)} HT (seuil ${formatEuros(EXCEPTIONAL_AMOUNT)})`;
  return {
    code: "EXCEPTIONAL_AMOUNT",
    level: "red",
    message,
    data: { amountExclVatCents: amount, threshold: EXCEPTIONAL_AMOUNT },
  };
}
