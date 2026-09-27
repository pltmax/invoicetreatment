import { describe, it, expect } from "vitest";
import { createClient } from "@libsql/client";
import { migrate } from "./migrate";
import { seed } from "./seed";

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
