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
  getNotifications,
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

describe("getNotifications", () => {
  it("returns nothing right after seeding, since no decision has been made yet", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db);
    await seed(db);

    const notifications = await getNotifications(db);
    expect(notifications).toEqual([]);

    db.close();
  });

  it("returns a notification for a decision made this session, excluding seeded history", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db);
    await seed(db);

    const rows = await getPendingInvoices(db);
    const novalink = rows.find((r) => r.invoiceNumber === "PEND-NOVALINK-01")!;
    await createSession(db, "batch", [
      {
        invoiceId: novalink.id,
        entityName: novalink.entityName,
        amountInclVatCents: novalink.amountInclVatCents,
        outcome: "approved",
        comment: null,
      },
    ]);

    const notifications = await getNotifications(db);
    expect(notifications).toHaveLength(1);
    expect(notifications[0].invoiceNumber).toBe("PEND-NOVALINK-01");
    expect(notifications[0].entityName).toBe("Arcadia Télécom");
    expect(notifications[0].level).toBe("green");
    expect(notifications[0].outcome).toBe("approved");

    db.close();
  });
});
