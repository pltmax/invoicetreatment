// lib/rules/classify-all.test.ts
import { describe, it, expect } from "vitest";
import { createClient } from "@libsql/client";
import { migrate } from "../db/migrate";
import { seed } from "../db/seed";
import { classifyAll } from "./classify-all";

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
});
