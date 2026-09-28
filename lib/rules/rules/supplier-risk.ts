import type { InvoiceContext, Reason } from "../types";

function monthsBetween(from: Date, to: Date): number {
  return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
}

export default function supplierRiskRule(ctx: InvoiceContext, today: Date): Reason | null {
  const match = ctx.riskEvents.find((event) => {
    const months = monthsBetween(new Date(event.eventDate), today);
    return months >= 0 && months <= ctx.thresholds.riskWindowMonths;
  });
  if (!match) return null;

  const months = monthsBetween(new Date(match.eventDate), today);
  return {
    code: "SUPPLIER_RISK",
    level: "red",
    message: `Événement de risque signalé il y a ${months} mois : ${match.description}`,
    data: { eventDate: match.eventDate, description: match.description, monthsAgo: months },
  };
}
