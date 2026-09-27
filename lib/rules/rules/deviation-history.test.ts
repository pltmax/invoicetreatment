import { describe, it, expect } from "vitest";
import { buildContext } from "../test-fixtures";
import deviationHistoryRule from "./deviation-history";

describe("deviation-history rule", () => {
  it("returns orange when the amount is 20% above the historical median", () => {
    const ctx = buildContext({ invoice: { amountExclVatCents: 120_000 } });
    const reason = deviationHistoryRule(ctx);
    expect(reason?.code).toBe("DEVIATION_HISTORY");
    expect(reason?.level).toBe("orange");
  });

  it("returns red when the amount is 50% above the historical median", () => {
    const ctx = buildContext({ invoice: { amountExclVatCents: 150_000 } });
    const reason = deviationHistoryRule(ctx);
    expect(reason?.code).toBe("DEVIATION_HISTORY_HIGH");
    expect(reason?.level).toBe("red");
  });

  it("does not trigger at exactly the orange threshold (15%)", () => {
    const ctx = buildContext({ invoice: { amountExclVatCents: 115_000 } });
    expect(deviationHistoryRule(ctx)).toBeNull();
  });

  it("does not trigger when there is no history for this entity/category", () => {
    const ctx = buildContext({
      invoice: { amountExclVatCents: 500_000 },
      groupApprovedInvoices: [
        {
          entityId: "ent-other",
          entityName: "Autre filiale",
          category: "maintenance",
          amountExclVatCents: 100_000,
          dueDate: "2026-01-15",
        },
      ],
    });
    expect(deviationHistoryRule(ctx)).toBeNull();
  });
});
