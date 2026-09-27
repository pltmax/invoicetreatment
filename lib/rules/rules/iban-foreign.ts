import type { InvoiceContext, Reason } from "../types";
import { ibanCountryCode } from "../../checks/iban";

export default function ibanForeignRule(ctx: InvoiceContext): Reason | null {
  const countryCode = ibanCountryCode(ctx.invoice.printedIban);
  if (countryCode === "FR") return null;

  const message = `IBAN étranger (${countryCode}) pour un fournisseur français`;
  return {
    code: "IBAN_FOREIGN",
    level: "red",
    message,
    data: { countryCode, printedIban: ctx.invoice.printedIban },
  };
}
