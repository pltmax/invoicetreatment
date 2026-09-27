import { describe, it, expect } from "vitest";
import { createClient } from "@libsql/client";
import { migrate } from "./migrate";
import { seed } from "./seed";
import { getPendingInvoices, getClassification, getInvoicesByIds } from "./queries";

describe("getPendingInvoices", () => {
  it("returns all 13 pending invoices sorted by due date ascending", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db);
    await seed(db);

    const rows = await getPendingInvoices(db);
    expect(rows.length).toBe(13);

    const dueDates = rows.map((r) => r.dueDate);
    const sorted = [...dueDates].sort();
    expect(dueDates).toEqual(sorted);

    expect(rows[0].invoiceNumber).toBe("PEND-NOVALINK-01");
    expect(rows[0].supplierName).toBe("NovaLink Télécom");
    expect(rows[0].entityName).toBe("Arcadia Télécom");

    db.close();
  });

  it("includes the stored classification level and reason messages", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db);
    await seed(db);

    const rows = await getPendingInvoices(db);
    const novalink = rows.find((r) => r.invoiceNumber === "PEND-NOVALINK-01");
    expect(novalink?.level).toBe("green");
    expect(novalink?.reasons.length).toBeGreaterThan(0);
    expect(novalink?.reasons[0].code).toBe("ALL_CHECKS_PASSED");

    db.close();
  });
});

describe("getClassification", () => {
  it("returns the persisted level, reasons, and rules version for a classified invoice", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db);
    await seed(db);

    const rows = await getPendingInvoices(db);
    const novalink = rows.find((r) => r.invoiceNumber === "PEND-NOVALINK-01");

    const classification = await getClassification(db, novalink!.id);
    expect(classification?.level).toBe("green");
    expect(classification?.reasons[0].code).toBe("ALL_CHECKS_PASSED");
    expect(classification?.rulesVersion).toBe("1.0.0");

    db.close();
  });

  it("returns null for an invoice with no classification row", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db); // schema only, no seed — no invoices exist at all
    const classification = await getClassification(db, "does-not-exist");
    expect(classification).toBeNull();
    db.close();
  });
});

describe("getInvoicesByIds", () => {
  it("returns only the requested, still-pending, green/orange invoices", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db);
    await seed(db);

    const all = await getPendingInvoices(db);
    const novalink = all.find((r) => r.invoiceNumber === "PEND-NOVALINK-01")!; // green
    const atlas = all.find((r) => r.invoiceNumber === "PEND-ATLAS-01")!; // red

    const result = await getInvoicesByIds(db, [novalink.id, atlas.id]);
    expect(result.map((r) => r.id)).toEqual([novalink.id]);

    db.close();
  });

  it("returns an empty array for an empty id list", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db);
    const result = await getInvoicesByIds(db, []);
    expect(result).toEqual([]);
    db.close();
  });
});
