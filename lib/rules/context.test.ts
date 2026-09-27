// lib/rules/context.test.ts
import { describe, it, expect } from "vitest";
import { createClient } from "@libsql/client";
import { migrate } from "../db/migrate";
import { seed } from "../db/seed";
import { loadContext } from "./context";

describe("loadContext", () => {
  it("loads the full context for a known pending invoice with a contract and group-wide history", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db);
    await seed(db);

    // Use the real current time, matching what seed() used internally to
    // generate the 12 months of history — see the "12-month boundary" note
    // in the Global Constraints / ledger for why groupApprovedInvoices is
    // asserted with a range rather than an exact 12: seed's history dates
    // are pinned to the 15th of each month, so whenever this test happens
    // to run after the 15th of the current month, the oldest (12-months-ago)
    // entry falls just outside the "last 12 months" cutoff and is correctly
    // excluded — that's the context loader working as specified, not a bug.
    const today = new Date();
    const ctx = await loadContext(db, "inv-pending-novalink", today);

    expect(ctx.invoice.invoiceNumber).toBe("PEND-NOVALINK-01");
    expect(ctx.invoice.entityName).toBe("Arcadia Télécom");
    expect(ctx.supplier.name).toBe("NovaLink Télécom");
    expect(ctx.contract?.id).toBe("con-novalink-telecom");
    expect(ctx.groupApprovedInvoices.length).toBeGreaterThanOrEqual(11);
    expect(ctx.groupApprovedInvoices.length).toBeLessThanOrEqual(12);
    expect(ctx.subsidiaryApprovedCategories).toContain("telecom_maintenance");
    expect(ctx.otherSupplierInvoices).toHaveLength(12);
    expect(ctx.ibanHistory.length).toBeGreaterThanOrEqual(1);
    expect(ctx.invoice.status).toBe("pending");

    db.close();
  });

  it("returns an empty group history and a null contract for a supplier with neither", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db);
    await seed(db);

    const ctx = await loadContext(db, "inv-pending-pixelforge", new Date());

    expect(ctx.invoice.contractId).toBeNull();
    expect(ctx.contract).toBeNull();
    expect(ctx.groupApprovedInvoices).toHaveLength(0);

    db.close();
  });
});
