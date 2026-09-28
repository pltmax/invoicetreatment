import type { InvoiceContext, Reason } from "../types";

export default function notRecurringRule(ctx: InvoiceContext): Reason | null {
  if (ctx.groupApprovedInvoices.length === 0) return null;

  const countAtSubsidiary = ctx.groupApprovedInvoices.filter(
    (i) => i.entityId === ctx.invoice.entityId
  ).length;
  if (countAtSubsidiary >= ctx.thresholds.recurringMinInvoices) return null;

  return {
    code: "NOT_RECURRING",
    level: "orange",
    message: `${countAtSubsidiary} facture${countAtSubsidiary === 1 ? "" : "s"} approuvée${countAtSubsidiary === 1 ? "" : "s"} pour cette filiale sur 12 mois`,
    data: { countAtSubsidiary, threshold: ctx.thresholds.recurringMinInvoices },
  };
}
