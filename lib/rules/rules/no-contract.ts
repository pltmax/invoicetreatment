import type { InvoiceContext, Reason } from "../types";

export default function noContractRule(ctx: InvoiceContext): Reason | null {
  if (ctx.invoice.contractId !== null) return null;
  return {
    code: "NO_CONTRACT",
    level: "orange",
    message: "Aucun contrat associé à cette facture",
    data: {},
  };
}
