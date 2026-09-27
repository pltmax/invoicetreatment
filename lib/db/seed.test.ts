import { describe, it, expect } from "vitest";
import { createClient } from "@libsql/client";
import { migrate } from "./migrate";
import { seed, expectedClassifications } from "./seed";

describe("seed - history", () => {
  it("creates 13 suppliers, 12 contracts, and 12 months of green history", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db);
    await seed(db);

    const suppliers = await db.execute("SELECT COUNT(*) as count FROM suppliers");
    expect(Number(suppliers.rows[0].count)).toBe(13);

    const contracts = await db.execute("SELECT COUNT(*) as count FROM contracts");
    expect(Number(contracts.rows[0].count)).toBe(12);

    const approvedNovalink = await db.execute({
      sql: "SELECT COUNT(*) as count FROM invoices WHERE supplier_id = ? AND status = 'approved'",
      args: ["sup-novalink"],
    });
    expect(Number(approvedNovalink.rows[0].count)).toBe(12);

    const sessions = await db.execute("SELECT COUNT(*) as count FROM sessions");
    expect(Number(sessions.rows[0].count)).toBe(12);

    // 11 contracts with hasHistory=true, x12 months, + 12 months for Trans Logistique (no contract).
    const greenClassifications = await db.execute(
      "SELECT COUNT(*) as count FROM classifications WHERE level = 'green'"
    );
    expect(Number(greenClassifications.rows[0].count)).toBe(144);

    const greenwaveIbanRows = await db.execute({
      sql: "SELECT COUNT(*) as count FROM iban_history WHERE supplier_id = ?",
      args: ["sup-greenwave"],
    });
    expect(Number(greenwaveIbanRows.rows[0].count)).toBe(2);

    const corvusRiskEvents = await db.execute({
      sql: "SELECT COUNT(*) as count FROM risk_events WHERE supplier_id = ?",
      args: ["sup-corvus"],
    });
    expect(Number(corvusRiskEvents.rows[0].count)).toBe(1);

    db.close();
  });
});

describe("seed - pending scenarios", () => {
  it("creates exactly 13 pending invoices matching expectedClassifications", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db);
    await seed(db);

    const pending = await db.execute(
      "SELECT invoice_number as invoiceNumber FROM invoices WHERE status = 'pending' ORDER BY due_date ASC"
    );
    expect(pending.rows.length).toBe(13);

    const pendingNumbers = new Set(pending.rows.map((row) => String(row.invoiceNumber)));
    expect(expectedClassifications.length).toBe(13);
    for (const expected of expectedClassifications) {
      expect(pendingNumbers.has(expected.invoiceNumber)).toBe(true);
    }

    db.close();
  });

  it("prints a foreign IBAN on the Meridian invoice despite its FR registration", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db);
    await seed(db);

    const row = await db.execute({
      sql: "SELECT printed_iban as printedIban FROM invoices WHERE invoice_number = ?",
      args: ["PEND-MERIDIAN-01"],
    });
    expect(String(row.rows[0].printedIban).startsWith("DE")).toBe(true);

    db.close();
  });

  it("reuses an already-approved invoice number for the Aqua duplicate scenario", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db);
    await seed(db);

    const matches = await db.execute({
      sql: "SELECT status FROM invoices WHERE invoice_number = ? ORDER BY status",
      args: ["HIST-AQUA-REALESTATE-M6"],
    });
    expect(matches.rows.map((r) => String(r.status))).toEqual(["approved", "pending"]);

    db.close();
  });
});

describe("seed - schema additions", () => {
  it("populates issue_date (before due_date) and printed_vat_number for every invoice", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db);
    await seed(db);

    const rows = await db.execute(
      "SELECT issue_date as issueDate, printed_vat_number as printedVatNumber, due_date as dueDate FROM invoices"
    );
    expect(rows.rows.length).toBeGreaterThan(0);
    for (const row of rows.rows) {
      expect(row.issueDate).not.toBeNull();
      expect(row.printedVatNumber).not.toBeNull();
      expect(String(row.issueDate) < String(row.dueDate)).toBe(true);
    }

    db.close();
  });

  it("stamps every classification with the current rules version", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db);
    await seed(db);

    const rows = await db.execute("SELECT rules_version as rulesVersion FROM classifications");
    expect(rows.rows.length).toBeGreaterThan(0);
    for (const row of rows.rows) {
      expect(row.rulesVersion).toBe("1.0.0");
    }

    db.close();
  });
});
