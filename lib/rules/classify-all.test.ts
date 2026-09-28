// lib/rules/classify-all.test.ts
import { describe, it, expect } from "vitest";
import { createClient } from "@libsql/client";
import { migrate } from "../db/migrate";
import { seed } from "../db/seed";
import { saveThresholds } from "../db/queries";
import { classifyAll } from "./classify-all";
import { DEFAULT_THRESHOLDS } from "./thresholds";

describe("classifyAll", () => {
  it("inserts one classification per pending invoice, stamped with the rules version", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db);
    await seed(db); // seed() already calls classifyAll internally

    const rows = await db.execute(`
      SELECT classifications.level as level, classifications.rules_version as rulesVersion
      FROM classifications
      JOIN invoices ON invoices.id = classifications.invoice_id
      WHERE invoices.status = 'pending'
    `);
    expect(rows.rows.length).toBe(13);
    for (const row of rows.rows) {
      expect(row.rulesVersion).toBe("1.0.0");
      expect(["green", "orange", "red"]).toContain(String(row.level));
    }

    db.close();
  });

  it("is idempotent: calling it again replaces rather than duplicates classifications", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db);
    await seed(db);

    await classifyAll(db, new Date("2026-09-27"));
    await classifyAll(db, new Date("2026-09-27"));

    const rows = await db.execute(`
      SELECT COUNT(*) as count FROM classifications
      JOIN invoices ON invoices.id = classifications.invoice_id
      WHERE invoices.status = 'pending'
    `);
    expect(Number(rows.rows[0].count)).toBe(13);

    db.close();
  });

  it("reclassifies pending invoices after a saved threshold change (DB -> context.ts -> rules)", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db);
    await seed(db); // seeds with DEFAULT_THRESHOLDS; PEND-NOVALINK-01 is green by default

    // Lower the exceptional-amount threshold far below PEND-NOVALINK-01's
    // amount (180 000 excl. VAT cents = 1 800 €), keeping every other
    // field at its default value.
    await saveThresholds(db, {
      ...DEFAULT_THRESHOLDS,
      exceptionalAmountCents: 100_000, // 1 000 €
    });

    await classifyAll(db);

    const rows = await db.execute({
      sql: `
        SELECT classifications.level as level, classifications.reasons as reasons
        FROM classifications
        JOIN invoices ON invoices.id = classifications.invoice_id
        WHERE invoices.invoice_number = ?
      `,
      args: ["PEND-NOVALINK-01"],
    });
    const row = rows.rows[0];
    expect(row).toBeDefined();
    expect(String(row.level)).toBe("red");
    const reasons = JSON.parse(String(row.reasons)) as { code: string }[];
    expect(reasons.map((r) => r.code)).toContain("EXCEPTIONAL_AMOUNT");

    db.close();
  });
});
