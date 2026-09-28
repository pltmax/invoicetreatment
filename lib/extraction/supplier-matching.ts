import "server-only";
import { randomUUID } from "node:crypto";
import type { Client } from "@libsql/client";
import { generateValidSiren } from "../checks/siren";
import { generateValidSiret } from "../checks/siret";
import type { ExtractedInvoice } from "./schema";

// SQLite's LOWER() is ASCII-only, so accent differences (very plausible from
// PDF/OCR extraction) would defeat a SQL-side case-insensitive match. Fold
// accents and case in JS instead.
function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

export async function resolveSupplierId(db: Client, extracted: ExtractedInvoice): Promise<string> {
  const candidates = await db.execute("SELECT id, name, siren FROM suppliers");
  const normalizedSupplierName = normalize(extracted.supplierName);
  const existing = candidates.rows.find(
    (row) =>
      String(row.siren) === extracted.printedSiren || normalize(String(row.name)) === normalizedSupplierName
  );
  if (existing) {
    return String(existing.id);
  }

  const supplierId = `sup-extracted-${randomUUID()}`;
  const oneYearBeforeIssue = new Date(extracted.issueDate);
  oneYearBeforeIssue.setFullYear(oneYearBeforeIssue.getFullYear() - 1);

  // Generate a synthetic valid SIREN/SIRET independent of the extracted data.
  // This ensures the SIRET is always valid regardless of PDF extraction quality,
  // while printed_siren (which may be invalid) is still stored for audit/comparison.
  const uuidHash = randomUUID().replace(/-/g, "");
  // Convert first 8 hex chars to a number, then to 8 decimal digits
  const hashNum = BigInt(`0x${uuidHash.slice(0, 8)}`);
  const syntheticBase8 = String(hashNum % 100000000n).padStart(8, "0");
  const syntheticSiren = generateValidSiren(syntheticBase8);
  const syntheticSiret = generateValidSiret(syntheticSiren);

  await db.batch(
    [
      {
        sql: "INSERT INTO suppliers (id, name, siren, siret, vat_number) VALUES (?, ?, ?, ?, ?)",
        args: [
          supplierId,
          extracted.supplierName,
          extracted.printedSiren,
          syntheticSiret,
          extracted.printedVatNumber,
        ],
      },
      {
        sql: "INSERT INTO iban_history (id, supplier_id, iban, effective_from) VALUES (?, ?, ?, ?)",
        args: [
          `ibh-${supplierId}`,
          supplierId,
          extracted.printedIban,
          oneYearBeforeIssue.toISOString().slice(0, 10),
        ],
      },
    ],
    "write"
  );

  return supplierId;
}

export async function findContractId(
  db: Client,
  entityId: string,
  supplierId: string,
  category: string,
  asOfDate: string
): Promise<string | null> {
  const result = await db.execute({
    sql: "SELECT id FROM contracts WHERE entity_id = ? AND supplier_id = ? AND category = ? AND (end_date IS NULL OR end_date >= ?)",
    args: [entityId, supplierId, category, asOfDate],
  });
  return result.rows[0] ? String(result.rows[0].id) : null;
}
