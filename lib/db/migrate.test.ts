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

  it("adds siret to suppliers and pdf_blob_pathname to invoices", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db);

    const supplierColumns = await db.execute("PRAGMA table_info(suppliers)");
    const supplierColumnNames = supplierColumns.rows.map((row) => String(row.name));
    expect(supplierColumnNames).toContain("siret");

    const invoiceColumns = await db.execute("PRAGMA table_info(invoices)");
    const invoiceColumnNames = invoiceColumns.rows.map((row) => String(row.name));
    expect(invoiceColumnNames).toContain("pdf_blob_pathname");

    db.close();
  });
});
