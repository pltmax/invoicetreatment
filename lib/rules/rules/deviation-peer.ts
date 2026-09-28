import type { InvoiceContext, Reason } from "../types";
import { median } from "../stats";
import { formatEuros, formatPercent } from "../../format";

export default function deviationPeerRule(ctx: InvoiceContext): Reason | null {
  const peers = ctx.groupApprovedInvoices.filter(
    (i) => i.entityId !== ctx.invoice.entityId && i.category === ctx.invoice.category
  );
  if (peers.length === 0) return null;

  const baseline = median(peers.map((i) => i.amountExclVatCents));
  if (baseline === null || baseline === 0) return null;

  const amount = ctx.invoice.amountExclVatCents;
  const deviation = (amount - baseline) / baseline;
  if (deviation <= ctx.thresholds.deviationOrange) return null;

  const otherEntities = [...new Set(peers.map((i) => i.entityName))];
  const message = `Montant ${formatEuros(amount)} HT, ${formatPercent(deviation)} au-dessus des autres filiales (${otherEntities.join(", ")} : médiane ${formatEuros(baseline)} HT)`;
  const data = {
    amountExclVatCents: amount,
    medianExclVatCents: baseline,
    deviationPct: deviation,
    otherEntities,
  };

  if (deviation > ctx.thresholds.deviationRed) {
    return { code: "DEVIATION_PEER_HIGH", level: "red", message, data };
  }
  return { code: "DEVIATION_PEER", level: "orange", message, data };
}
