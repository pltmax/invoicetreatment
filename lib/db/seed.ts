import "server-only";
import { createHash } from "node:crypto";
import type { Client, InValue } from "@libsql/client";
import { generateValidSiren } from "../checks/siren";
import { computeVatNumber } from "../checks/vat";
import { buildIban } from "../checks/iban";
import { RULES_VERSION, DEFAULT_THRESHOLDS } from "../rules/thresholds";
import { classifyAll } from "../rules/classify-all";

export type ClassificationLevel = "green" | "orange" | "red";

// Session id prefix for the 12-month approval history this seed backfills.
// Queries use it to exclude that backfill from anything meant to reflect
// decisions made during the live demo (e.g. notifications, demo-check).
export const SEED_HISTORY_SESSION_PREFIX = "ses-hist-";

export interface ExpectedClassification {
  invoiceNumber: string;
  scenario: string;
  expectedLevel: ClassificationLevel;
  expectedCode: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const VARIANCE = [0.97, 1.02, 0.98, 1.04, 0.96, 1.01, 0.99, 1.03, 0.95, 1.02, 0.97, 0.99];

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
  args: InValue[];
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
  issueDate: string;
  dueDate: string;
  printedIban: string;
  printedSiren: string;
  printedVatNumber: string;
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
  registeredVatNumber: string,
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
      issueDate: isoDate(addDays(dueDate, -30)),
      dueDate: isoDate(dueDate),
      printedIban: registeredIban,
      printedSiren: registeredSiren,
      printedVatNumber: registeredVatNumber,
      monthsAgo,
    });
  }
  return rows;
}

function buildPendingInvoiceStatements(
  today: Date,
  supplierById: Map<string, Supplier>
): WriteStatement[] {
  const statements: WriteStatement[] = [];
  const mismatchedSiren = generateValidSiren("40000099");

  interface PendingSeed {
    id: string;
    entityId: string;
    supplierId: string;
    contractId: string | null;
    invoiceNumber: string;
    category: string;
    amountExclVatCents: number;
    dueInDays: number;
    printedIban?: string;
    printedSiren?: string;
  }

  const pending: PendingSeed[] = [
    {
      id: "inv-pending-novalink",
      entityId: "ent-telecom",
      supplierId: "sup-novalink",
      contractId: "con-novalink-telecom",
      invoiceNumber: "PEND-NOVALINK-01",
      category: "telecom_maintenance",
      amountExclVatCents: 180000,
      dueInDays: 2,
    },
    {
      id: "inv-pending-cloudnimbus",
      entityId: "ent-services",
      supplierId: "sup-cloudnimbus",
      contractId: "con-cloudnimbus-services",
      invoiceNumber: "PEND-CLOUDNIMBUS-01",
      category: "cloud_hosting",
      amountExclVatCents: 220000,
      dueInDays: 3,
    },
    {
      id: "inv-pending-fontaine",
      entityId: "ent-media",
      supplierId: "sup-fontaine",
      contractId: "con-fontaine-media",
      invoiceNumber: "PEND-FONTAINE-01",
      category: "consulting",
      amountExclVatCents: 180000,
      dueInDays: 4,
    },
    {
      id: "inv-pending-pixelforge",
      entityId: "ent-realestate",
      supplierId: "sup-pixelforge",
      contractId: null,
      invoiceNumber: "PEND-PIXELFORGE-01",
      category: "design",
      amountExclVatCents: 300000,
      dueInDays: 5,
    },
    {
      id: "inv-pending-translogistique",
      entityId: "ent-services",
      supplierId: "sup-translogistique",
      contractId: null,
      invoiceNumber: "PEND-TRANSLOGISTIQUE-01",
      category: "logistics",
      amountExclVatCents: 132000,
      dueInDays: 6,
    },
    {
      id: "inv-pending-klaxon",
      entityId: "ent-telecom",
      supplierId: "sup-klaxon",
      contractId: null,
      invoiceNumber: "PEND-KLAXON-01",
      category: "marketing",
      amountExclVatCents: 95000,
      dueInDays: 7,
    },
    {
      id: "inv-pending-aqua",
      entityId: "ent-realestate",
      supplierId: "sup-aqua",
      contractId: "con-aqua-realestate",
      invoiceNumber: "HIST-AQUA-REALESTATE-M6",
      category: "facilities",
      amountExclVatCents: 200000,
      dueInDays: 8,
    },
    {
      id: "inv-pending-greenwave",
      entityId: "ent-services",
      supplierId: "sup-greenwave",
      contractId: "con-greenwave-services",
      invoiceNumber: "PEND-GREENWAVE-01",
      category: "utilities",
      amountExclVatCents: 260000,
      dueInDays: 9,
      printedIban: frenchIban(8),
    },
    {
      id: "inv-pending-meridian",
      entityId: "ent-realestate",
      supplierId: "sup-meridian",
      contractId: "con-meridian-realestate",
      invoiceNumber: "PEND-MERIDIAN-01",
      category: "fleet",
      amountExclVatCents: 175000,
      dueInDays: 10,
      printedIban: foreignIban(9),
    },
    {
      id: "inv-pending-ondine",
      entityId: "ent-media",
      supplierId: "sup-ondine",
      contractId: "con-ondine-media",
      invoiceNumber: "PEND-ONDINE-01",
      category: "office_supplies",
      amountExclVatCents: 40000,
      dueInDays: 12,
      printedSiren: mismatchedSiren,
    },
    {
      id: "inv-pending-atlas",
      entityId: "ent-realestate",
      supplierId: "sup-atlas",
      contractId: null,
      invoiceNumber: "PEND-ATLAS-01",
      category: "equipment",
      amountExclVatCents: 8000000,
      dueInDays: 14,
    },
    {
      id: "inv-pending-solstice",
      entityId: "ent-realestate",
      supplierId: "sup-solstice",
      contractId: "con-solstice-realestate",
      invoiceNumber: "PEND-SOLSTICE-01",
      category: "maintenance",
      amountExclVatCents: 400000,
      dueInDays: 17,
    },
    {
      id: "inv-pending-corvus",
      entityId: "ent-telecom",
      supplierId: "sup-corvus",
      contractId: "con-corvus-telecom",
      invoiceNumber: "PEND-CORVUS-01",
      category: "it_integration",
      amountExclVatCents: 300000,
      dueInDays: 20,
    },
  ];

  for (const invoice of pending) {
    const supplier = supplierById.get(invoice.supplierId);
    if (!supplier) throw new Error(`unknown supplier ${invoice.supplierId}`);
    const dueDate = addDays(today, invoice.dueInDays);
    statements.push({
      sql: `INSERT INTO invoices
        (id, entity_id, supplier_id, contract_id, invoice_number, category, amount_excl_vat_cents, amount_incl_vat_cents, issue_date, due_date, printed_iban, printed_siren, printed_vat_number, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      args: [
        invoice.id,
        invoice.entityId,
        invoice.supplierId,
        invoice.contractId,
        invoice.invoiceNumber,
        invoice.category,
        invoice.amountExclVatCents,
        Math.round(invoice.amountExclVatCents * 1.2),
        isoDate(addDays(dueDate, -30)),
        isoDate(dueDate),
        invoice.printedIban ?? supplier.registeredIban,
        invoice.printedSiren ?? supplier.siren,
        supplier.vatNumber,
      ],
    });
  }

  return statements;
}

export const expectedClassifications: ExpectedClassification[] = [
  { invoiceNumber: "PEND-NOVALINK-01", scenario: "Maintenance télécom récurrente conforme au contrat", expectedLevel: "green", expectedCode: "ALL_CHECKS_PASSED" },
  { invoiceNumber: "PEND-CLOUDNIMBUS-01", scenario: "Hébergement cloud récurrent conforme au contrat", expectedLevel: "green", expectedCode: "ALL_CHECKS_PASSED" },
  { invoiceNumber: "PEND-FONTAINE-01", scenario: "Fournisseur connu, +20% vs historique", expectedLevel: "orange", expectedCode: "DEVIATION_HISTORY" },
  { invoiceNumber: "PEND-PIXELFORGE-01", scenario: "Nouveau fournisseur, 3 000 € HT", expectedLevel: "orange", expectedCode: "NEW_SUPPLIER_SMALL" },
  { invoiceNumber: "PEND-TRANSLOGISTIQUE-01", scenario: "Fournisseur connu, aucun contrat associé", expectedLevel: "orange", expectedCode: "NO_CONTRACT" },
  { invoiceNumber: "PEND-KLAXON-01", scenario: "Catégorie inhabituelle pour la filiale télécom", expectedLevel: "orange", expectedCode: "UNUSUAL_CATEGORY" },
  { invoiceNumber: "HIST-AQUA-REALESTATE-M6", scenario: "Même fournisseur et même numéro de facture qu'une facture déjà approuvée", expectedLevel: "red", expectedCode: "DUPLICATE_NUMBER" },
  { invoiceNumber: "PEND-GREENWAVE-01", scenario: "IBAN enregistré du fournisseur modifié il y a 5 jours", expectedLevel: "red", expectedCode: "IBAN_RECENTLY_CHANGED" },
  { invoiceNumber: "PEND-MERIDIAN-01", scenario: "Fournisseur FR avec un IBAN imprimé étranger", expectedLevel: "red", expectedCode: "IBAN_FOREIGN" },
  { invoiceNumber: "PEND-ONDINE-01", scenario: "SIREN imprimé différent du registre", expectedLevel: "red", expectedCode: "IDENTITY_MISMATCH" },
  { invoiceNumber: "PEND-ATLAS-01", scenario: "Achat d'équipement de 80 000 € HT", expectedLevel: "red", expectedCode: "EXCEPTIONAL_AMOUNT" },
  { invoiceNumber: "PEND-SOLSTICE-01", scenario: "Même fournisseur et catégorie, filiale facturée 2x plus qu'une autre", expectedLevel: "red", expectedCode: "DEVIATION_PEER_HIGH" },
  { invoiceNumber: "PEND-CORVUS-01", scenario: "Fournisseur avec un événement de risque il y a 2 mois", expectedLevel: "red", expectedCode: "SUPPLIER_RISK" },
];

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

  statements.push({
    sql: `INSERT INTO thresholds
      (id, deviation_orange, deviation_red, new_supplier_amount_cents, exceptional_amount_cents, iban_recent_change_days, risk_window_months, duplicate_window_days, recurring_min_invoices, history_sample)
      VALUES ('default', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      DEFAULT_THRESHOLDS.deviationOrange,
      DEFAULT_THRESHOLDS.deviationRed,
      DEFAULT_THRESHOLDS.newSupplierAmountCents,
      DEFAULT_THRESHOLDS.exceptionalAmountCents,
      DEFAULT_THRESHOLDS.ibanRecentChangeDays,
      DEFAULT_THRESHOLDS.riskWindowMonths,
      DEFAULT_THRESHOLDS.duplicateWindowDays,
      DEFAULT_THRESHOLDS.recurringMinInvoices,
      DEFAULT_THRESHOLDS.historySample,
    ],
  });

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
        supplier.vatNumber,
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
        supplier.vatNumber,
        today
      )
    );
  }

  for (const invoice of historyInvoices) {
    statements.push({
      sql: `INSERT INTO invoices
        (id, entity_id, supplier_id, contract_id, invoice_number, category, amount_excl_vat_cents, amount_incl_vat_cents, issue_date, due_date, printed_iban, printed_siren, printed_vat_number, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved')`,
      args: [
        invoice.id,
        invoice.entityId,
        invoice.supplierId,
        invoice.contractId,
        invoice.invoiceNumber,
        invoice.category,
        invoice.amountExclVatCents,
        invoice.amountInclVatCents,
        invoice.issueDate,
        invoice.dueDate,
        invoice.printedIban,
        invoice.printedSiren,
        invoice.printedVatNumber,
      ],
    });
    statements.push({
      sql: "INSERT INTO classifications (id, invoice_id, level, reasons, rules_version) VALUES (?, ?, 'green', ?, ?)",
      args: [
        `cls-${invoice.id}`,
        invoice.id,
        JSON.stringify([
          {
            code: "ALL_CHECKS_PASSED",
            level: "green",
            message: "Fournisseur récurrent, historique conforme au contrat.",
            data: {},
          },
        ]),
        RULES_VERSION,
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
    const sessionId = `${SEED_HISTORY_SESSION_PREFIX}m${monthsAgo}`;
    const signedAt = isoDate(addDays(monthsBefore(today, monthsAgo), 3));
    const contentHash = sha256Hex(
      JSON.stringify({
        sessionId,
        decisions: invoicesThisMonth.map((i) => ({ invoiceId: i.id, outcome: "approved" })),
        signedAt,
      })
    );
    statements.push({
      sql: "INSERT INTO sessions (id, kind, content_hash, signature_ref, signed_at) VALUES (?, 'batch', ?, ?, ?)",
      args: [sessionId, contentHash, `MOCK-YOUSIGN-${sessionId}`, signedAt],
    });
    for (const invoice of invoicesThisMonth) {
      statements.push({
        sql: "INSERT INTO decisions (id, session_id, invoice_id, outcome) VALUES (?, ?, ?, 'approved')",
        args: [`dec-${invoice.id}`, sessionId, invoice.id],
      });
    }
  }

  statements.push(...buildPendingInvoiceStatements(today, supplierById));

  await db.batch(
    statements.map((s) => ({ sql: s.sql, args: s.args })),
    "write"
  );

  await classifyAll(db, today);
}
