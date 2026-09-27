// lib/rules/rules/identity-mismatch.ts
import type { InvoiceContext, Reason } from "../types";
import { computeVatKey } from "../../checks/vat";

export default function identityMismatchRule(ctx: InvoiceContext): Reason | null {
  const { printedSiren, printedVatNumber } = ctx.invoice;
  const { siren, vatNumber } = ctx.supplier;

  const sirenMismatch = printedSiren !== siren;
  const vatMismatch = printedVatNumber !== vatNumber;
  let keyInconsistent = false;
  if (/^\d{9}$/.test(printedSiren)) {
    const expectedKey = computeVatKey(printedSiren);
    const printedKey = printedVatNumber.slice(2, 4);
    keyInconsistent = expectedKey !== printedKey;
  }

  if (!sirenMismatch && !vatMismatch && !keyInconsistent) return null;

  let message: string;
  if (sirenMismatch) {
    message = `SIREN imprimé (${printedSiren}) différent du registre (${siren})`;
  } else if (vatMismatch) {
    message = `Numéro de TVA imprimé (${printedVatNumber}) différent du registre (${vatNumber})`;
  } else {
    message = `Clé de TVA incohérente avec le SIREN imprimé (${printedSiren})`;
  }

  return {
    code: "IDENTITY_MISMATCH",
    level: "red",
    message,
    data: {
      printedSiren,
      registrySiren: siren,
      printedVatNumber,
      registryVatNumber: vatNumber,
      sirenMismatch,
      vatMismatch,
      keyInconsistent,
    },
  };
}
