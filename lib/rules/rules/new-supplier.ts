import type { InvoiceContext, Reason } from "../types";
import { formatEuros } from "../../format";

export default function newSupplierRule(ctx: InvoiceContext): Reason | null {
  if (ctx.groupApprovedInvoices.length > 0) return null;

  const amount = ctx.invoice.amountExclVatCents;
  const message = `Nouveau fournisseur, ${formatEuros(amount)} HT`;
  const data = { amountExclVatCents: amount, threshold: ctx.thresholds.newSupplierAmountCents };

  if (amount > ctx.thresholds.newSupplierAmountCents) {
    return { code: "NEW_SUPPLIER_LARGE", level: "red", message, data };
  }
  return { code: "NEW_SUPPLIER_SMALL", level: "orange", message, data };
}
