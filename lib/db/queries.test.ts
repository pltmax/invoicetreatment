import { describe, it, expect } from "vitest";
import { createClient } from "@libsql/client";
import { migrate } from "./migrate";
import { seed } from "./seed";
import { getPendingInvoices } from "./queries";

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
});
