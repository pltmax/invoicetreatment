import type { InvoiceContext, Reason } from "../types";

export default function ibanMismatchRule(ctx: InvoiceContext): Reason | null {
  const current = ctx.ibanHistory[0];
  if (!current) return null;
  if (ctx.invoice.printedIban === current.iban) return null;

  const mask = (iban: string) => iban.slice(-4);
  const message = `IBAN imprimé différent de l'IBAN enregistré (…${mask(ctx.invoice.printedIban)} vs …${mask(current.iban)})`;
  return {
    code: "IBAN_MISMATCH",
    level: "red",
    message,
    data: { printedIban: ctx.invoice.printedIban, registeredIban: current.iban },
  };
}
