import { describe, it, expect, vi } from "vitest";
import { createClient } from "@libsql/client";

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("../../lib/db/client", () => ({ db: {} }));

import { migrate } from "../../lib/db/migrate";
import { seed } from "../../lib/db/seed";
import { resolveSupplierId, findContractId } from "../../lib/extraction/supplier-matching";
import { generateValidSiren } from "../../lib/checks/siren";
import type { ExtractedInvoice } from "../../lib/extraction/schema";

function fixture(overrides: Partial<ExtractedInvoice> = {}): ExtractedInvoice {
  return {
    supplierName: "Not A Real Match",
    printedSiren: generateValidSiren("40000099"),
    printedVatNumber: "FR00000000000",
    printedIban: "FR0000000000000000000000000",
    invoiceNumber: "TEST-001",
    category: "telecom_maintenance",
    amountExclVatCents: 100000,
    amountInclVatCents: 120000,
    issueDate: "2026-06-01",
    dueDate: "2026-07-01",
    ...overrides,
  };
}

describe("resolveSupplierId", () => {
  it("matches an existing supplier by SIREN", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db);
    await seed(db);

    const existing = await db.execute("SELECT siren FROM suppliers WHERE id = 'sup-novalink'");
    const siren = String(existing.rows[0].siren);

    const supplierId = await resolveSupplierId(db, fixture({ printedSiren: siren }));
    expect(supplierId).toBe("sup-novalink");

    const count = await db.execute("SELECT COUNT(*) as n FROM suppliers");
    expect(Number(count.rows[0].n)).toBe(13);

    db.close();
  });

  it("matches an existing supplier by case-insensitive name", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db);
    await seed(db);

    const supplierId = await resolveSupplierId(db, fixture({ supplierName: "novalink télécom" }));
    expect(supplierId).toBe("sup-novalink");

    db.close();
  });

  it("matches an existing supplier by name when accents are missing (accent-folded)", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db);
    await seed(db);

    const supplierId = await resolveSupplierId(db, fixture({ supplierName: "NovaLink Telecom" }));
    expect(supplierId).toBe("sup-novalink");

    db.close();
  });

  it("creates a new supplier with one backdated IBAN history row when nothing matches", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db);
    await seed(db);

    const supplierId = await resolveSupplierId(
      db,
      fixture({
        supplierName: "Brand New Fournisseur",
        printedSiren: generateValidSiren("99999999"),
        printedIban: "FR9999999999999999999999999",
        issueDate: "2026-06-15",
      })
    );

    expect(supplierId).not.toBe("sup-novalink");

    const supplierRow = await db.execute({
      sql: "SELECT name FROM suppliers WHERE id = ?",
      args: [supplierId],
    });
    expect(supplierRow.rows[0].name).toBe("Brand New Fournisseur");

    const ibanRows = await db.execute({
      sql: "SELECT iban, effective_from as effectiveFrom FROM iban_history WHERE supplier_id = ?",
      args: [supplierId],
    });
    expect(ibanRows.rows).toHaveLength(1);
    expect(ibanRows.rows[0].effectiveFrom).toBe("2025-06-15");

    db.close();
  });

  it("handles an invalid/non-Luhn printed SIREN by generating a synthetic SIRET", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db);
    await seed(db);

    // "999999999" fails Luhn validation and would have crashed under the old code
    const supplierId = await resolveSupplierId(
      db,
      fixture({
        supplierName: "Supplier With Bad SIREN",
        printedSiren: "999999999",
        printedIban: "FR9999999999999999999999999",
        issueDate: "2026-06-15",
      })
    );

    expect(supplierId).not.toBe("");

    const supplierRow = await db.execute({
      sql: "SELECT name, siren, siret FROM suppliers WHERE id = ?",
      args: [supplierId],
    });
    expect(supplierRow.rows).toHaveLength(1);
    expect(supplierRow.rows[0].name).toBe("Supplier With Bad SIREN");
    expect(supplierRow.rows[0].siren).toBe("999999999"); // stores the bad SIREN as-is
    expect(supplierRow.rows[0].siret).toBeTruthy(); // SIRET is generated synthetically
    expect(String(supplierRow.rows[0].siret)).toMatch(/^\d{14}$/); // SIRET is 14 digits

    db.close();
  });
});

describe("findContractId", () => {
  it("returns the contract id for a known entity+supplier+category triple", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db);
    await seed(db);

    const contractId = await findContractId(db, "ent-telecom", "sup-novalink", "telecom_maintenance", "2026-06-01");
    expect(contractId).toBe("con-novalink-telecom");

    db.close();
  });

  it("returns null when no contract exists for the pair", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db);
    await seed(db);

    const contractId = await findContractId(db, "ent-media", "sup-novalink", "telecom_maintenance", "2026-06-01");
    expect(contractId).toBeNull();

    db.close();
  });

  it("returns null when the category doesn't match the contract's category", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db);
    await seed(db);

    const contractId = await findContractId(db, "ent-telecom", "sup-novalink", "equipment", "2026-06-01");
    expect(contractId).toBeNull();

    db.close();
  });
});
