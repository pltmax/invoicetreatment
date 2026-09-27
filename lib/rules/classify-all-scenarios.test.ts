// lib/rules/classify-all-scenarios.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { createClient, type Client } from "@libsql/client";
import { migrate } from "../db/migrate";
import { seed, expectedClassifications } from "../db/seed";

describe("classify-all integration — all 13 seed scenarios", () => {
  let db: Client;

  beforeAll(async () => {
    db = createClient({ url: ":memory:" });
    await migrate(db);
    await seed(db);
  });

  it.each(expectedClassifications)(
    "$scenario ($invoiceNumber)",
    async ({ invoiceNumber, expectedLevel, expectedCode }) => {
      // Filtered to status = 'pending': the HIST-AQUA-REALESTATE-M6 scenario
      // deliberately reuses the invoice_number of an already-approved history
      // invoice to trigger DUPLICATE_NUMBER, so matching on invoice_number
      // alone would return both the approved and the pending row.
      const row = await db.execute({
        sql: `
          SELECT classifications.level AS level, classifications.reasons AS reasons
          FROM classifications
          JOIN invoices ON invoices.id = classifications.invoice_id
          WHERE invoices.invoice_number = ? AND invoices.status = 'pending'
        `,
        args: [invoiceNumber],
      });
      expect(row.rows.length).toBe(1);

      const level = String(row.rows[0].level);
      const reasons = JSON.parse(String(row.rows[0].reasons)) as Array<{ code: string }>;

      expect(level).toBe(expectedLevel);
      expect(reasons.some((r) => r.code === expectedCode)).toBe(true);
    }
  );
});
