import type { InvoiceContext, Reason } from "../types";
import { formatDateFr } from "../../format";

export default function duplicateNumberRule(ctx: InvoiceContext): Reason | null {
  const match = ctx.otherSupplierInvoices.find((i) => i.invoiceNumber === ctx.invoice.invoiceNumber);
  if (!match) return null;

  const statusLabel = match.status === "approved" ? "déjà approuvée" : `statut : ${match.status}`;
  const message = `Même numéro de facture que ${match.invoiceNumber} (${statusLabel}), émise le ${formatDateFr(match.issueDate)}`;
  return {
    code: "DUPLICATE_NUMBER",
    level: "red",
    message,
    data: { otherInvoiceId: match.id, otherInvoiceNumber: match.invoiceNumber, otherStatus: match.status },
  };
}
