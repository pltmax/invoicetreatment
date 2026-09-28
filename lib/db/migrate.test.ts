import { describe, it, expect } from "vitest";
import { createClient } from "@libsql/client";
import { migrate } from "./migrate";

describe("migrate", () => {
  it("creates all ten tables", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db);

    const result = await db.execute(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
    );
    const tableNames = result.rows.map((row) => String(row.name));

    expect(tableNames).toEqual([
      "classifications",
      "contracts",
      "decisions",
      "entities",
      "iban_history",
      "invoices",
      "risk_events",
      "sessions",
      "suppliers",
      "thresholds",
    ]);

    db.close();
  });
});
