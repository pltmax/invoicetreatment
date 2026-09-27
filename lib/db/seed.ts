import "server-only";
import { createHash } from "node:crypto";
import type { Client } from "@libsql/client";
import { generateValidSiren } from "../checks/siren";
import { computeVatNumber } from "../checks/vat";
import { buildIban } from "../checks/iban";

export type ClassificationLevel = "green" | "orange" | "red";

export interface ExpectedClassification {
  invoiceNumber: string;
  scenario: string;
  expectedLevel: ClassificationLevel;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const VARIANCE = [0.97, 1.02, 0.98, 1.04, 0.96, 1.01, 0.99, 1.03, 0.95, 1.02, 0.97, 1.0];

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(base: Date, offsetDays: number): Date {
  return new Date(base.getTime() + offsetDays * DAY_MS);
}

function monthsBefore(base: Date, months: number): Date {
  const result = new Date(base);
  result.setDate(15);
  result.setMonth(result.getMonth() - months);
  return result;
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function frenchIban(bbanIndex: number, branchCode = "00001"): string {
  const bankCode = "40100";
  const account = String(bbanIndex).padStart(11, "0");
  const ribKey = "00";
  return buildIban("FR", `${bankCode}${branchCode}${account}${ribKey}`);
}

function foreignIban(bbanIndex: number): string {
  const bankCode = "37040044";
  const account = String(bbanIndex).padStart(10, "0");
  return buildIban("DE", `${bankCode}${account}`);
}

interface EntitySeed {
  id: string;
  name: string;
  sector: "telecom" | "media" | "real_estate" | "services";
}

const entities: EntitySeed[] = [
  { id: "ent-telecom", name: "Arcadia Télécom", sector: "telecom" },
  { id: "ent-media", name: "Lumen Média Group", sector: "media" },
  { id: "ent-realestate", name: "Bastide Immobilier", sector: "real_estate" },
  { id: "ent-services", name: "Verdan Services", sector: "services" },
];

interface SupplierSeed {
  id: string;
  name: string;
  base8: string;
  bbanIndex: number;
}

const supplierSeeds: SupplierSeed[] = [
  { id: "sup-novalink", name: "NovaLink Télécom", base8: "40000001", bbanIndex: 1 },
  { id: "sup-cloudnimbus", name: "CloudNimbus SAS", base8: "40000002", bbanIndex: 2 },
  { id: "sup-fontaine", name: "Bureau Fontaine Conseil", base8: "40000003", bbanIndex: 3 },
  { id: "sup-pixelforge", name: "Pixel Forge Studio", base8: "40000004", bbanIndex: 4 },
  { id: "sup-translogistique", name: "Trans Logistique Ouest", base8: "40000005", bbanIndex: 5 },
  { id: "sup-klaxon", name: "Klaxon Marketing", base8: "40000006", bbanIndex: 6 },
  { id: "sup-aqua", name: "Aqua Facilities Maintenance", base8: "40000007", bbanIndex: 7 },
  { id: "sup-greenwave", name: "GreenWave Énergie", base8: "40000008", bbanIndex: 8 },
  { id: "sup-meridian", name: "Meridian Fleet Services", base8: "40000009", bbanIndex: 9 },
  { id: "sup-ondine", name: "Ondine Papeterie", base8: "40000010", bbanIndex: 10 },
  { id: "sup-atlas", name: "Atlas Industrial Equipment", base8: "40000011", bbanIndex: 11 },
  { id: "sup-solstice", name: "Solstice Maintenance Group", base8: "40000012", bbanIndex: 12 },
  { id: "sup-corvus", name: "Corvus Systems Intégration", base8: "40000013", bbanIndex: 13 },
];

interface Supplier {
  id: string;
  name: string;
  siren: string;
  vatNumber: string;
  registeredIban: string;
}

function buildSuppliers(): Supplier[] {
  return supplierSeeds.map((s) => {
    const siren = generateValidSiren(s.base8);
    return {
      id: s.id,
      name: s.name,
      siren,
      vatNumber: computeVatNumber(siren),
      registeredIban: frenchIban(s.bbanIndex),
    };
  });
}

interface ContractSeed {
  id: string;
  entityId: string;
  supplierId: string;
  category: string;
  expectedAmountCents: number;
  hasHistory: boolean;
}

const contracts: ContractSeed[] = [
  { id: "con-novalink-telecom", entityId: "ent-telecom", supplierId: "sup-novalink", category: "telecom_maintenance", expectedAmountCents: 180000, hasHistory: true },
  { id: "con-cloudnimbus-services", entityId: "ent-services", supplierId: "sup-cloudnimbus", category: "cloud_hosting", expectedAmountCents: 220000, hasHistory: true },
  { id: "con-fontaine-media", entityId: "ent-media", supplierId: "sup-fontaine", category: "consulting", expectedAmountCents: 150000, hasHistory: true },
  { id: "con-klaxon-media", entityId: "ent-media", supplierId: "sup-klaxon", category: "marketing", expectedAmountCents: 90000, hasHistory: true },
  { id: "con-klaxon-services", entityId: "ent-services", supplierId: "sup-klaxon", category: "marketing", expectedAmountCents: 110000, hasHistory: true },
  { id: "con-aqua-realestate", entityId: "ent-realestate", supplierId: "sup-aqua", category: "facilities", expectedAmountCents: 200000, hasHistory: true },
  { id: "con-greenwave-services", entityId: "ent-services", supplierId: "sup-greenwave", category: "utilities", expectedAmountCents: 260000, hasHistory: true },
  { id: "con-meridian-realestate", entityId: "ent-realestate", supplierId: "sup-meridian", category: "fleet", expectedAmountCents: 175000, hasHistory: true },
  { id: "con-ondine-media", entityId: "ent-media", supplierId: "sup-ondine", category: "office_supplies", expectedAmountCents: 40000, hasHistory: true },
  { id: "con-solstice-services", entityId: "ent-services", supplierId: "sup-solstice", category: "maintenance", expectedAmountCents: 200000, hasHistory: true },
  { id: "con-solstice-realestate", entityId: "ent-realestate", supplierId: "sup-solstice", category: "maintenance", expectedAmountCents: 400000, hasHistory: false },
  { id: "con-corvus-telecom", entityId: "ent-telecom", supplierId: "sup-corvus", category: "it_integration", expectedAmountCents: 300000, hasHistory: true },
];

// Trans Logistique Ouest is a recurring, known supplier that has deliberately
// never been put on a formal contract.
const TRANS_LOGISTIQUE = {
  entityId: "ent-services",
  supplierId: "sup-translogistique",
  category: "logistics",
  baseAmountCents: 130000,
};

interface WriteStatement {
  sql: string;
  args: unknown[];
}

interface HistoryInvoice {
  id: string;
  entityId: string;
  supplierId: string;
  contractId: string | null;
  invoiceNumber: string;
  category: string;
  amountExclVatCents: number;
  amountInclVatCents: number;
  dueDate: string;
  printedIban: string;
  printedSiren: string;
  monthsAgo: number;
}

function buildHistoryInvoices(
  idPrefix: string,
  entityId: string,
  supplierId: string,
  contractId: string | null,
  category: string,
  baseAmountCents: number,
  registeredIban: string,
  registeredSiren: string,
  today: Date
): HistoryInvoice[] {
  const rows: HistoryInvoice[] = [];
  for (let monthsAgo = 12; monthsAgo >= 1; monthsAgo--) {
    const dueDate = monthsBefore(today, monthsAgo);
    const amount = Math.round(baseAmountCents * VARIANCE[(12 - monthsAgo) % VARIANCE.length]);
    rows.push({
      id: `${idPrefix}-m${monthsAgo}`,
      entityId,
      supplierId,
      contractId,
      invoiceNumber: `${idPrefix.toUpperCase()}-M${monthsAgo}`,
      category,
      amountExclVatCents: amount,
      amountInclVatCents: Math.round(amount * 1.2),
      dueDate: isoDate(dueDate),
      printedIban: registeredIban,
      printedSiren: registeredSiren,
      monthsAgo,
    });
  }
  return rows;
}

export async function seed(db: Client): Promise<void> {
  const today = new Date();
  const suppliers = buildSuppliers();
  const supplierById = new Map(suppliers.map((s) => [s.id, s]));

  const statements: WriteStatement[] = [];

  for (const entity of entities) {
    statements.push({
      sql: "INSERT INTO entities (id, name, sector) VALUES (?, ?, ?)",
      args: [entity.id, entity.name, entity.sector],
    });
  }

  for (const supplier of suppliers) {
    statements.push({
      sql: "INSERT INTO suppliers (id, name, siren, vat_number) VALUES (?, ?, ?, ?)",
      args: [supplier.id, supplier.name, supplier.siren, supplier.vatNumber],
    });
    statements.push({
      sql: "INSERT INTO iban_history (id, supplier_id, iban, effective_from) VALUES (?, ?, ?, ?)",
      args: [`ibh-${supplier.id}-orig`, supplier.id, supplier.registeredIban, isoDate(monthsBefore(today, 30))],
    });
  }

  // GreenWave Énergie's registered IBAN changed 5 days ago.
  const greenwaveNewIban = frenchIban(8, "00099");
  statements.push({
    sql: "INSERT INTO iban_history (id, supplier_id, iban, effective_from) VALUES (?, ?, ?, ?)",
    args: ["ibh-sup-greenwave-new", "sup-greenwave", greenwaveNewIban, isoDate(addDays(today, -5))],
  });

  // Corvus Systems Intégration has a risk event flagged 2 months ago.
  statements.push({
    sql: "INSERT INTO risk_events (id, supplier_id, event_date, description) VALUES (?, ?, ?, ?)",
    args: [
      "risk-sup-corvus-1",
      "sup-corvus",
      isoDate(monthsBefore(today, 2)),
      "Alerte conformité interne suite à un signalement fournisseur.",
    ],
  });

  for (const contract of contracts) {
    statements.push({
      sql: "INSERT INTO contracts (id, entity_id, supplier_id, category, expected_amount_cents, start_date, end_date) VALUES (?, ?, ?, ?, ?, ?, ?)",
      args: [
        contract.id,
        contract.entityId,
        contract.supplierId,
        contract.category,
        contract.expectedAmountCents,
        isoDate(monthsBefore(today, 30)),
        null,
      ],
    });
  }

  const historyInvoices: HistoryInvoice[] = [];
  for (const contract of contracts) {
    if (!contract.hasHistory) continue;
    const supplier = supplierById.get(contract.supplierId);
    if (!supplier) throw new Error(`unknown supplier ${contract.supplierId}`);
    historyInvoices.push(
      ...buildHistoryInvoices(
        `hist-${contract.supplierId.replace("sup-", "")}-${contract.entityId.replace("ent-", "")}`,
        contract.entityId,
        contract.supplierId,
        contract.id,
        contract.category,
        contract.expectedAmountCents,
        supplier.registeredIban,
        supplier.siren,
        today
      )
    );
  }
  {
    const supplier = supplierById.get(TRANS_LOGISTIQUE.supplierId);
    if (!supplier) throw new Error("unknown supplier sup-translogistique");
    historyInvoices.push(
      ...buildHistoryInvoices(
        "hist-translogistique",
        TRANS_LOGISTIQUE.entityId,
        TRANS_LOGISTIQUE.supplierId,
        null,
        TRANS_LOGISTIQUE.category,
        TRANS_LOGISTIQUE.baseAmountCents,
        supplier.registeredIban,
        supplier.siren,
        today
      )
    );
  }

  for (const invoice of historyInvoices) {
    statements.push({
      sql: `INSERT INTO invoices
        (id, entity_id, supplier_id, contract_id, invoice_number, category, amount_excl_vat_cents, amount_incl_vat_cents, due_date, printed_iban, printed_siren, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved')`,
      args: [
        invoice.id,
        invoice.entityId,
        invoice.supplierId,
        invoice.contractId,
        invoice.invoiceNumber,
        invoice.category,
        invoice.amountExclVatCents,
        invoice.amountInclVatCents,
        invoice.dueDate,
        invoice.printedIban,
        invoice.printedSiren,
      ],
    });
    statements.push({
      sql: "INSERT INTO classifications (id, invoice_id, level, reasons) VALUES (?, ?, 'green', ?)",
      args: [
        `cls-${invoice.id}`,
        invoice.id,
        JSON.stringify(["Fournisseur récurrent, historique conforme au contrat."]),
      ],
    });
  }

  const invoicesByMonth = new Map<number, HistoryInvoice[]>();
  for (const invoice of historyInvoices) {
    const list = invoicesByMonth.get(invoice.monthsAgo) ?? [];
    list.push(invoice);
    invoicesByMonth.set(invoice.monthsAgo, list);
  }
  for (const [monthsAgo, invoicesThisMonth] of invoicesByMonth) {
    const sessionId = `ses-hist-m${monthsAgo}`;
    const signedAt = isoDate(addDays(monthsBefore(today, monthsAgo), 3));
    const contentHash = sha256Hex(
      JSON.stringify({
        sessionId,
        decisions: invoicesThisMonth.map((i) => ({ invoiceId: i.id, outcome: "approved" })),
        signedAt,
      })
    );
    statements.push({
      sql: "INSERT INTO sessions (id, kind, content_hash, signed_at) VALUES (?, 'batch', ?, ?)",
      args: [sessionId, contentHash, signedAt],
    });
    for (const invoice of invoicesThisMonth) {
      statements.push({
        sql: "INSERT INTO decisions (id, session_id, invoice_id, outcome) VALUES (?, ?, ?, 'approved')",
        args: [`dec-${invoice.id}`, sessionId, invoice.id],
      });
    }
  }

  await db.batch(
    statements.map((s) => ({ sql: s.sql, args: s.args })),
    "write"
  );
}
