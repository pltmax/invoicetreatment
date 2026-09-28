import type { InvoiceContext, Reason } from "../types";

const DAY_MS = 24 * 60 * 60 * 1000;

export default function ibanRecentlyChangedRule(ctx: InvoiceContext, today: Date): Reason | null {
  const current = ctx.ibanHistory[0];
  if (!current) return null;

  const daysAgo = Math.round((today.getTime() - new Date(current.effectiveFrom).getTime()) / DAY_MS);
  if (daysAgo < 0 || daysAgo > ctx.thresholds.ibanRecentChangeDays) return null;

  const previous = ctx.ibanHistory[1];
  const mask = (iban: string) => iban.slice(-4);
  const previousLabel = previous ? `…${mask(previous.iban)}` : "inconnu";
  const message = `IBAN modifié il y a ${daysAgo} jour${daysAgo === 1 ? "" : "s"} (ancien : ${previousLabel})`;
  return {
    code: "IBAN_RECENTLY_CHANGED",
    level: "red",
    message,
    data: { daysAgo, newIban: current.iban, previousIban: previous?.iban ?? null },
  };
}
