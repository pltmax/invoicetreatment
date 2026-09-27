import type { InvoiceContext, Reason } from "../types";
import { DUPLICATE_WINDOW_DAYS } from "../thresholds";
import { formatEuros } from "../../format";

const DAY_MS = 24 * 60 * 60 * 1000;

function daysBetween(a: string, b: string): number {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / DAY_MS;
}

export default function duplicateAmountRule(
  ctx: InvoiceContext
): Reason | null {
  const match = ctx.otherSupplierInvoices.find(
    (i) =>
      i.entityId === ctx.invoice.entityId &&
      i.amountInclVatCents === ctx.invoice.amountInclVatCents &&
      daysBetween(i.issueDate, ctx.invoice.issueDate) <= DUPLICATE_WINDOW_DAYS
  );
  if (!match) return null;

  const days = Math.round(
    daysBetween(match.issueDate, ctx.invoice.issueDate)
  );
  const message = `Facture ${match.invoiceNumber}, même montant TTC (${formatEuros(match.amountInclVatCents)}) émise ${days} jour${days === 1 ? "" : "s"} plus tôt`;
  return {
    code: "DUPLICATE_AMOUNT",
    level: "red",
    message,
    data: {
      otherInvoiceId: match.id,
      otherInvoiceNumber: match.invoiceNumber,
      amountInclVatCents: match.amountInclVatCents,
      daysApart: days,
    },
  };
}
