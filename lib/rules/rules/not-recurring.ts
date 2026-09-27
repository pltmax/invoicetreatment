import type { InvoiceContext, Reason } from "../types";
import { RECURRING_MIN_INVOICES } from "../thresholds";

export default function notRecurringRule(ctx: InvoiceContext): Reason | null {
  if (ctx.groupApprovedInvoices.length === 0) return null;

  const countAtSubsidiary = ctx.groupApprovedInvoices.filter(
    (i) => i.entityId === ctx.invoice.entityId
  ).length;
  if (countAtSubsidiary >= RECURRING_MIN_INVOICES) return null;

  return {
    code: "NOT_RECURRING",
    level: "orange",
    message: `Seulement ${countAtSubsidiary} facture${countAtSubsidiary === 1 ? "" : "s"} approuvée${countAtSubsidiary === 1 ? "" : "s"} pour cette filiale sur 12 mois`,
    data: { countAtSubsidiary, threshold: RECURRING_MIN_INVOICES },
  };
}
