import { describe, it, expect } from "vitest";
import { createClient } from "@libsql/client";
import { migrate } from "./migrate";
import { seed } from "./seed";
import {
  getPendingInvoices,
  getClassification,
  getInvoicesByIds,
  getDecisionSessionId,
  getSessionWithDecisions,
  getInboxInvoices,
  listSessionsWithDecisions,
  getThresholds,
  saveThresholds,
  getEntities,
  getAllInvoicesForPdfGeneration,
  setInvoicePdfPathname,
  getInvoicePdfPathname,
} from "./queries";
import { createSession } from "../sessions";

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

describe("getDecisionSessionId", () => {
  it("returns null for an invoice with no decision yet", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db);
    await seed(db);
    const rows = await getPendingInvoices(db);
    const sessionId = await getDecisionSessionId(db, rows[0].id);
    expect(sessionId).toBeNull();
    db.close();
  });

  it("returns the session id once a decision exists", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db);
    await seed(db);
    const rows = await getPendingInvoices(db);
    const invoice = rows[0];
    const created = await createSession(db, "batch", [
      {
        invoiceId: invoice.id,
        entityName: invoice.entityName,
        amountInclVatCents: invoice.amountInclVatCents,
        outcome: "approved",
        comment: null,
      },
    ]);
    const sessionId = await getDecisionSessionId(db, invoice.id);
    expect(sessionId).toBe(created.sessionId);
    db.close();
  });
});

describe("getSessionWithDecisions", () => {
  it("returns the session header and every decision, joined to level and identity", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db);
    await seed(db);
    const rows = await getPendingInvoices(db);
    const invoice = rows.find((r) => r.invoiceNumber === "PEND-NOVALINK-01")!;
    const created = await createSession(db, "batch", [
      {
        invoiceId: invoice.id,
        entityName: invoice.entityName,
        amountInclVatCents: invoice.amountInclVatCents,
        outcome: "approved",
        comment: "Conforme au contrat.",
      },
    ]);

    const session = await getSessionWithDecisions(db, created.sessionId);
    expect(session?.kind).toBe("batch");
    expect(session?.contentHash).toBe(created.contentHash);
    expect(session?.decisions).toHaveLength(1);
    expect(session?.decisions[0].invoiceNumber).toBe("PEND-NOVALINK-01");
    expect(session?.decisions[0].level).toBe("green");
    expect(session?.decisions[0].comment).toBe("Conforme au contrat.");

    db.close();
  });

  it("returns null for a nonexistent session", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db);
    const session = await getSessionWithDecisions(db, "does-not-exist");
    expect(session).toBeNull();
    db.close();
  });
});

describe("getInboxInvoices", () => {
  it("returns all 13 pending invoices sorted by received date descending", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db);
    await seed(db);

    const rows = await getInboxInvoices(db);
    expect(rows.length).toBe(13);

    const receivedAts = rows.map((r) => r.receivedAt);
    const sorted = [...receivedAts].sort().reverse();
    expect(receivedAts).toEqual(sorted);

    db.close();
  });
});

describe("listSessionsWithDecisions", () => {
  it("returns every seeded session ordered by signed_at descending, each with its decisions", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db);
    await seed(db);

    const sessions = await listSessionsWithDecisions(db);
    expect(sessions).toHaveLength(13);

    const signedDates = sessions.map((s) => s.signedAt);
    expect(signedDates).toEqual([...signedDates].sort().reverse());

    const extra = sessions.find((s) => s.id === "ses-hist-2026-09-26");
    expect(extra?.kind).toBe("batch");
    expect(extra?.decisions).toHaveLength(3);
    expect(extra?.decisions.map((d) => d.invoiceNumber)).toContain("SES-2026-09-26-ORION-01");

    db.close();
  });

  it("includes a session created live, with its decisions and level", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db);
    await seed(db);

    const rows = await getPendingInvoices(db);
    const novalink = rows.find((r) => r.invoiceNumber === "PEND-NOVALINK-01")!;
    const created = await createSession(db, "batch", [
      {
        invoiceId: novalink.id,
        entityName: novalink.entityName,
        amountInclVatCents: novalink.amountInclVatCents,
        outcome: "approved",
        comment: null,
      },
    ]);

    const sessions = await listSessionsWithDecisions(db);
    expect(sessions).toHaveLength(14);

    const live = sessions.find((s) => s.id === created.sessionId);
    expect(live?.decisions).toHaveLength(1);
    expect(live?.decisions[0].invoiceNumber).toBe("PEND-NOVALINK-01");
    expect(live?.decisions[0].level).toBe("green");
    expect(live?.decisions[0].outcome).toBe("approved");

    db.close();
  });
});

describe("getThresholds", () => {
  it("returns the seeded default thresholds", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db);
    await seed(db);

    const thresholds = await getThresholds(db);
    expect(thresholds.deviationOrange).toBe(0.15);
    expect(thresholds.deviationRed).toBe(0.4);
    expect(thresholds.exceptionalAmountCents).toBe(50_000_00);
    expect(thresholds.newSupplierAmountCents).toBe(5_000_00);
    expect(thresholds.historySample).toBe(6);

    db.close();
  });
});

describe("saveThresholds", () => {
  it("persists new threshold values, overwriting the seeded defaults", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db);
    await seed(db);

    await saveThresholds(db, {
      deviationOrange: 0.2,
      deviationRed: 0.5,
      newSupplierAmountCents: 10_000_00,
      exceptionalAmountCents: 75_000_00,
      ibanRecentChangeDays: 45,
      riskWindowMonths: 6,
      duplicateWindowDays: 30,
      recurringMinInvoices: 4,
      historySample: 8,
    });

    const thresholds = await getThresholds(db);
    expect(thresholds).toEqual({
      deviationOrange: 0.2,
      deviationRed: 0.5,
      newSupplierAmountCents: 10_000_00,
      exceptionalAmountCents: 75_000_00,
      ibanRecentChangeDays: 45,
      riskWindowMonths: 6,
      duplicateWindowDays: 30,
      recurringMinInvoices: 4,
      historySample: 8,
    });

    db.close();
  });
});

describe("getEntities", () => {
  it("returns all 4 seeded entities sorted by name", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db);
    await seed(db);

    const entities = await getEntities(db);
    expect(entities).toHaveLength(4);
    const names = entities.map((e) => e.name);
    expect(names).toEqual([...names].sort());
    expect(names).toContain("Arcadia Télécom");

    db.close();
  });
});

describe("getInvoicePdfPathname / setInvoicePdfPathname", () => {
  it("returns null until a pathname is set, then returns what was set", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db);
    await seed(db);

    expect(await getInvoicePdfPathname(db, "inv-pending-novalink")).toBeNull();

    await setInvoicePdfPathname(db, "inv-pending-novalink", "invoices/inv-pending-novalink.pdf");

    expect(await getInvoicePdfPathname(db, "inv-pending-novalink")).toBe(
      "invoices/inv-pending-novalink.pdf"
    );
    // A different invoice is unaffected.
    expect(await getInvoicePdfPathname(db, "inv-pending-cloudnimbus")).toBeNull();

    db.close();
  });
});

describe("getAllInvoicesForPdfGeneration", () => {
  it("returns one row per invoice with the supplier's real SIRET and correct cent amounts", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db);
    await seed(db);

    const rows = await getAllInvoicesForPdfGeneration(db);
    const countResult = await db.execute("SELECT COUNT(*) AS count FROM invoices");
    expect(rows.length).toBe(Number(countResult.rows[0].count));

    const novalink = rows.find((row) => row.id === "inv-pending-novalink");
    expect(novalink).toBeDefined();
    expect(novalink?.invoiceNumber).toBe("PEND-NOVALINK-01");
    expect(novalink?.supplierName).toBe("NovaLink Télécom");
    expect(novalink?.supplierSiret).toHaveLength(14);
    expect(novalink?.entityName).toBe("Arcadia Télécom");
    expect(typeof novalink?.amountExclVatCents).toBe("number");
    expect(novalink?.amountExclVatCents).toBe(180000);

    db.close();
  });
});
