import { describe, it, expect } from "vitest";
import { buildContext } from "../test-fixtures";
import deviationPeerRule from "./deviation-peer";

const peersAt = (entityId: string, entityName: string, amountExclVatCents: number) => [
  { entityId, entityName, category: "maintenance", amountExclVatCents, dueDate: "2026-01-15" },
  { entityId, entityName, category: "maintenance", amountExclVatCents, dueDate: "2026-02-15" },
];

describe("deviation-peer rule", () => {
  it("returns orange when the amount is 20% above the median at other subsidiaries", () => {
    const ctx = buildContext({
      invoice: { amountExclVatCents: 120_000 },
      groupApprovedInvoices: peersAt("ent-other", "Filiale Voisine", 100_000),
    });
    const reason = deviationPeerRule(ctx);
    expect(reason?.code).toBe("DEVIATION_PEER");
    expect(reason?.level).toBe("orange");
  });

  it("returns red when the amount is 2x the median at other subsidiaries", () => {
    const ctx = buildContext({
      invoice: { amountExclVatCents: 200_000 },
      groupApprovedInvoices: peersAt("ent-other", "Filiale Voisine", 100_000),
    });
    const reason = deviationPeerRule(ctx);
    expect(reason?.code).toBe("DEVIATION_PEER_HIGH");
    expect(reason?.level).toBe("red");
  });

  it("does not trigger at exactly the orange threshold (15%)", () => {
    const ctx = buildContext({
      invoice: { amountExclVatCents: 115_000 },
      groupApprovedInvoices: peersAt("ent-other", "Filiale Voisine", 100_000),
    });
    expect(deviationPeerRule(ctx)).toBeNull();
  });

  it("does not trigger when there are no peers at other subsidiaries", () => {
    const ctx = buildContext({
      invoice: { amountExclVatCents: 500_000 },
      groupApprovedInvoices: peersAt("ent-1", "Filiale Test", 100_000),
    });
    expect(deviationPeerRule(ctx)).toBeNull();
  });

  it("uses a custom orange threshold from context instead of the default 15%", () => {
    const ctx = buildContext({
      invoice: { amountExclVatCents: 110_000 },
      groupApprovedInvoices: peersAt("ent-other", "Filiale Voisine", 100_000),
      thresholds: { deviationOrange: 0.05 },
    });
    const reason = deviationPeerRule(ctx);
    expect(reason?.code).toBe("DEVIATION_PEER");
    expect(reason?.level).toBe("orange");
  });
});
