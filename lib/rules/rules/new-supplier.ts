import type { InvoiceContext, Reason } from "../types";
import { NEW_SUPPLIER_AMOUNT } from "../thresholds";
import { formatEuros } from "../../format";

export default function newSupplierRule(ctx: InvoiceContext): Reason | null {
  if (ctx.groupApprovedInvoices.length > 0) return null;

  const amount = ctx.invoice.amountExclVatCents;
  const message = `Nouveau fournisseur, ${formatEuros(amount)} HT`;
  const data = { amountExclVatCents: amount, threshold: NEW_SUPPLIER_AMOUNT };

  if (amount > NEW_SUPPLIER_AMOUNT) {
    return { code: "NEW_SUPPLIER_LARGE", level: "red", message, data };
  }
  return { code: "NEW_SUPPLIER_SMALL", level: "orange", message, data };
}
