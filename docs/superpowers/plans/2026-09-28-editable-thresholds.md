# Editable Classification Thresholds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Règles" tab where the CEO can see every classification rule grouped by severity and edit its threshold value, with edits immediately reclassifying pending invoices.

**Architecture:** Move the 9 threshold constants from `lib/rules/thresholds.ts` into a new singleton-row `thresholds` DB table. `lib/rules/context.ts` (the existing DB-I/O boundary for building an `InvoiceContext`) loads that row and attaches it as `ctx.thresholds`; all 9 rule functions read `ctx.thresholds.x` instead of importing a constant, staying pure functions of `(ctx, today)`. A new `/rules` page reads and writes the table via a server action that validates input, saves, and re-runs `classifyAll`.

**Tech Stack:** Next.js App Router, TypeScript, `@libsql/client`, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-28-editable-thresholds-design.md`

## Global Constraints

- UI copy in French, code and comments in English (CLAUDE.md convention).
- Amounts are entered in the `/rules` UI as whole euros and converted to
  integer cents at the form boundary; percentages are entered as whole
  numbers (`15` meaning 15%) and converted to ratios (`0.15`).
- `migrate.ts` drops and recreates every table from `SCHEMA_SQL` on each
  run — there is no incremental migration framework. Schema changes go
  directly in `lib/db/schema.ts`.
- No auth/login gate on `/rules` — matches the rest of the demo's declared
  out-of-scope list.
- `RULES_VERSION` is unrelated to thresholds (it versions the rule engine
  code, not a tunable value) and does not change as part of this feature.
- Saving new thresholds must immediately call `classifyAll(db)` — pending
  invoices must never be left classified under a stale rule set.
- `lib/rules/` rule functions stay pure: no DB access and no import of a
  thresholds constant; every runtime value comes from `ctx.thresholds`,
  populated once by `context.ts`.
- **Deviation from the spec's "single query implementation" note:**
  `lib/db/queries.ts` already imports from `lib/db/seed.ts`
  (`SEED_HISTORY_SESSION_PREFIX`), and `seed.ts` imports `classifyAll` from
  `lib/rules/classify-all.ts`, which imports `lib/rules/context.ts`. If
  `context.ts` imported a `getThresholds` helper from `queries.ts`, that
  would close an import cycle
  (`context.ts` → `queries.ts` → `seed.ts` → `classify-all.ts` →
  `context.ts`). `context.ts` already writes its own raw SQL for
  everything else it needs (it never calls into `queries.ts`), so Task 3
  keeps that existing pattern: `context.ts` fetches the thresholds row
  with its own `db.execute` call. Task 4 adds a separate, independent
  `getThresholds` in `queries.ts` for the `/rules` page. The SQL is
  duplicated between the two call sites — deliberately, to avoid the cycle.

---

### Task 1: Schema — add the `thresholds` table

**Files:**
- Modify: `lib/db/schema.ts`
- Modify: `lib/db/migrate.test.ts`

**Interfaces:**
- Produces: a `thresholds` table with columns `id` (PK, text), `deviation_orange` (real), `deviation_red` (real), `new_supplier_amount_cents` (integer), `exceptional_amount_cents` (integer), `iban_recent_change_days` (integer), `risk_window_months` (integer), `duplicate_window_days` (integer), `recurring_min_invoices` (integer), `history_sample` (integer), `updated_at` (text). No row is inserted by this task — that's Task 2.

- [ ] **Step 1: Add the table to `SCHEMA_SQL`**

In `lib/db/schema.ts`, add a drop line at the very top of the `DROP TABLE` block (order doesn't matter for this table — nothing references it via foreign key):

```ts
export const SCHEMA_SQL = `
DROP TABLE IF EXISTS thresholds;
DROP TABLE IF EXISTS decisions;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS classifications;
DROP TABLE IF EXISTS invoices;
DROP TABLE IF EXISTS contracts;
DROP TABLE IF EXISTS risk_events;
DROP TABLE IF EXISTS iban_history;
DROP TABLE IF EXISTS suppliers;
DROP TABLE IF EXISTS entities;

CREATE TABLE thresholds (
  id TEXT PRIMARY KEY,
  deviation_orange REAL NOT NULL,
  deviation_red REAL NOT NULL,
  new_supplier_amount_cents INTEGER NOT NULL,
  exceptional_amount_cents INTEGER NOT NULL,
  iban_recent_change_days INTEGER NOT NULL,
  risk_window_months INTEGER NOT NULL,
  duplicate_window_days INTEGER NOT NULL,
  recurring_min_invoices INTEGER NOT NULL,
  history_sample INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE entities (
```

Leave everything from `CREATE TABLE entities (` onward exactly as it already is — only the two blocks above are new.

- [ ] **Step 2: Update `migrate.test.ts`'s table-count assertion**

In `lib/db/migrate.test.ts`, the test currently asserts exactly 9 table names. Replace the whole `it` block:

```ts
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
```

- [ ] **Step 3: Run the test**

Run: `npx vitest run lib/db/migrate.test.ts`
Expected: PASS (1 test).

- [ ] **Step 4: Commit**

```bash
git add lib/db/schema.ts lib/db/migrate.test.ts
git commit -m "Add thresholds table to schema"
```

---

### Task 2: Seed — insert the default thresholds row

**Files:**
- Modify: `lib/db/seed.ts`
- Modify: `lib/db/seed.test.ts`

**Interfaces:**
- Consumes: the `thresholds` table from Task 1.
- Produces: after `seed(db)` runs, exactly one row in `thresholds` with `id = 'default'` holding the current hardcoded rule values (deviation_orange 0.15, deviation_red 0.4, new_supplier_amount_cents 500000, exceptional_amount_cents 5000000, iban_recent_change_days 90, risk_window_months 12, duplicate_window_days 60, recurring_min_invoices 3, history_sample 6).

- [ ] **Step 1: Insert the row in `seed()`**

In `lib/db/seed.ts`, find this import line near the top:

```ts
import { RULES_VERSION } from "../rules/thresholds";
```

Replace it with:

```ts
import { RULES_VERSION, DEFAULT_THRESHOLDS } from "../rules/thresholds";
```

(This import will only resolve once Task 3 adds `DEFAULT_THRESHOLDS` to `thresholds.ts`. That's fine — Task 3 must land before this task's tests are run standalone; see the note at the end of this task.)

Then, inside `export async function seed(db: Client): Promise<void> {`, right after the `for (const entity of entities) { ... }` loop that inserts entities, add:

```ts
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
```

So the start of `seed()` reads:

```ts
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
```

(unchanged from here on).

- [ ] **Step 2: Add the seed test**

In `lib/db/seed.test.ts`, add a new `describe` block at the end of the file:

```ts
describe("seed - thresholds", () => {
  it("inserts the default thresholds row", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db);
    await seed(db);

    const rows = await db.execute(
      "SELECT deviation_orange as deviationOrange, deviation_red as deviationRed, exceptional_amount_cents as exceptionalAmountCents FROM thresholds WHERE id = 'default'"
    );
    expect(rows.rows.length).toBe(1);
    expect(Number(rows.rows[0].deviationOrange)).toBe(0.15);
    expect(Number(rows.rows[0].deviationRed)).toBe(0.4);
    expect(Number(rows.rows[0].exceptionalAmountCents)).toBe(50_000_00);

    db.close();
  });
});
```

- [ ] **Step 3: Note on running this task's test in isolation**

This task's test will not pass until Task 3 adds `DEFAULT_THRESHOLDS` to
`lib/rules/thresholds.ts` (the import added in Step 1 won't resolve
otherwise). If executing tasks in strict order, do Task 3 before running
this task's test — or do Task 3 first and come back to write this task's
changes. Either order is fine; just don't consider Task 2 "done" (tests
green) until Task 3 has also landed.

- [ ] **Step 4: Run the test (after Task 3 is also done)**

Run: `npx vitest run lib/db/seed.test.ts`
Expected: PASS (all `seed` describe blocks, including the new one).

- [ ] **Step 5: Commit**

```bash
git add lib/db/seed.ts lib/db/seed.test.ts
git commit -m "Seed the default thresholds row"
```

---

### Task 3: Rules engine — thread `Thresholds` through `InvoiceContext`

This is one task, not several, because the changes below are mutually
dependent: `thresholds.ts`'s constants disappear in the same step that
`InvoiceContext` gains a `thresholds` field, which is the same step every
rule file's import must change — leaving any subset done and the rest
undone means the project does not compile. All of it lands together.

**Files:**
- Modify: `lib/rules/thresholds.ts`
- Modify: `lib/rules/thresholds.test.ts`
- Modify: `lib/rules/types.ts`
- Modify: `lib/rules/test-fixtures.ts`
- Modify: `lib/rules/context.ts`
- Modify: `lib/rules/context.test.ts`
- Modify: `lib/rules/rules/deviation-history.ts` + `.test.ts`
- Modify: `lib/rules/rules/deviation-contract.ts` + `.test.ts`
- Modify: `lib/rules/rules/deviation-peer.ts` + `.test.ts`
- Modify: `lib/rules/rules/duplicate-amount.ts` + `.test.ts`
- Modify: `lib/rules/rules/iban-recently-changed.ts` + `.test.ts`
- Modify: `lib/rules/rules/exceptional-amount.ts` + `.test.ts`
- Modify: `lib/rules/rules/new-supplier.ts` + `.test.ts`
- Modify: `lib/rules/rules/not-recurring.ts` + `.test.ts`
- Modify: `lib/rules/rules/supplier-risk.ts` + `.test.ts`
- Modify: `app/(app)/invoices/[id]/page.tsx`

**Interfaces:**
- Consumes: the `thresholds` table (Task 1) and its seeded default row
  (Task 2) — `context.ts`'s new DB read needs both to exist for its own
  tests to pass.
- Produces:
  - `export interface Thresholds { deviationOrange: number; deviationRed: number; newSupplierAmountCents: number; exceptionalAmountCents: number; ibanRecentChangeDays: number; riskWindowMonths: number; duplicateWindowDays: number; recurringMinInvoices: number; historySample: number; }` from `lib/rules/thresholds.ts`
  - `export const DEFAULT_THRESHOLDS: Thresholds` from `lib/rules/thresholds.ts`
  - `InvoiceContext.thresholds: Thresholds` (new field)
  - `buildContext(overrides)` in `test-fixtures.ts` now accepts `overrides.thresholds?: Partial<Thresholds>`, merged onto `DEFAULT_THRESHOLDS`

- [ ] **Step 1: Rewrite `lib/rules/thresholds.ts`**

Replace the entire file:

```ts
export interface Thresholds {
  deviationOrange: number;
  deviationRed: number;
  newSupplierAmountCents: number;
  exceptionalAmountCents: number;
  ibanRecentChangeDays: number;
  riskWindowMonths: number;
  duplicateWindowDays: number;
  recurringMinInvoices: number;
  historySample: number;
}

// Default values, used to seed the `thresholds` DB row and as the shape
// tests build contexts against. The live values a running app uses come
// from that DB row (editable via the /rules page), not from this object —
// see lib/rules/context.ts.
export const DEFAULT_THRESHOLDS: Thresholds = {
  deviationOrange: 0.15,
  deviationRed: 0.4,
  newSupplierAmountCents: 5_000_00,
  exceptionalAmountCents: 50_000_00,
  ibanRecentChangeDays: 90,
  riskWindowMonths: 12,
  duplicateWindowDays: 60,
  recurringMinInvoices: 3,
  historySample: 6,
};

export const RULES_VERSION = "1.0.0";
```

- [ ] **Step 2: Rewrite `lib/rules/thresholds.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { DEFAULT_THRESHOLDS, RULES_VERSION } from "./thresholds";

describe("thresholds", () => {
  it("exposes the default value for every threshold", () => {
    expect(DEFAULT_THRESHOLDS.deviationOrange).toBe(0.15);
    expect(DEFAULT_THRESHOLDS.deviationRed).toBe(0.4);
    expect(DEFAULT_THRESHOLDS.newSupplierAmountCents).toBe(500_000);
    expect(DEFAULT_THRESHOLDS.exceptionalAmountCents).toBe(5_000_000);
    expect(DEFAULT_THRESHOLDS.ibanRecentChangeDays).toBe(90);
    expect(DEFAULT_THRESHOLDS.riskWindowMonths).toBe(12);
    expect(DEFAULT_THRESHOLDS.duplicateWindowDays).toBe(60);
    expect(DEFAULT_THRESHOLDS.recurringMinInvoices).toBe(3);
    expect(DEFAULT_THRESHOLDS.historySample).toBe(6);
    expect(RULES_VERSION).toBe("1.0.0");
  });
});
```

- [ ] **Step 3: Add `thresholds` to `InvoiceContext` in `lib/rules/types.ts`**

Add this import near the top of the file, after the existing content starts (the file currently has no imports — add one as the first line):

```ts
// lib/rules/types.ts
import type { Thresholds } from "./thresholds";

export type Level = "green" | "orange" | "red";
```

Then find the `InvoiceContext` interface at the end of the file and add the new field as its last member:

```ts
export interface InvoiceContext {
  invoice: InvoiceContextInvoice;
  supplier: InvoiceContextSupplier;
  ibanHistory: IbanHistoryEntry[];
  riskEvents: RiskEventEntry[];
  contract: ContractInfo | null;
  groupApprovedInvoices: GroupApprovedInvoice[];
  subsidiaryApprovedCategories: string[];
  otherSupplierInvoices: OtherSupplierInvoice[];
  thresholds: Thresholds;
}
```

- [ ] **Step 4: Update `lib/rules/test-fixtures.ts`**

Add an import and a `thresholds` field to both the overrides interface and
the returned context. Replace the top of the file through the
`ContextOverrides` interface:

```ts
// lib/rules/test-fixtures.ts
import { generateValidSiren } from "../checks/siren";
import { computeVatNumber } from "../checks/vat";
import { buildIban } from "../checks/iban";
import { DEFAULT_THRESHOLDS, type Thresholds } from "./thresholds";
import type { InvoiceContext } from "./types";

const DEFAULT_SIREN = generateValidSiren("55210055");
const DEFAULT_VAT = computeVatNumber(DEFAULT_SIREN);
const DEFAULT_IBAN = buildIban("FR", "40100000010000000001200");

// Must stay newest-first, matching context.ts's real `ORDER BY due_date DESC`.
const DEFAULT_HISTORY_DUE_DATES = [
  "2026-03-15",
  "2026-02-15",
  "2026-01-15",
  "2025-12-15",
  "2025-11-15",
  "2025-10-15",
];

interface ContextOverrides {
  invoice?: Partial<InvoiceContext["invoice"]>;
  supplier?: Partial<InvoiceContext["supplier"]>;
  ibanHistory?: InvoiceContext["ibanHistory"];
  riskEvents?: InvoiceContext["riskEvents"];
  contract?: InvoiceContext["contract"];
  groupApprovedInvoices?: InvoiceContext["groupApprovedInvoices"];
  subsidiaryApprovedCategories?: InvoiceContext["subsidiaryApprovedCategories"];
  otherSupplierInvoices?: InvoiceContext["otherSupplierInvoices"];
  thresholds?: Partial<Thresholds>;
}
```

Then, in `buildContext`, add the `thresholds` field to the returned object
(as the last field, right after `otherSupplierInvoices`):

```ts
    otherSupplierInvoices: overrides.otherSupplierInvoices ?? [],
    thresholds: { ...DEFAULT_THRESHOLDS, ...overrides.thresholds },
  };
}
```

- [ ] **Step 5: Update `lib/rules/context.ts`**

Replace the whole file:

```ts
// lib/rules/context.ts
import "server-only";
import type { Client } from "@libsql/client";
import type { InvoiceContext } from "./types";
import type { Thresholds } from "./thresholds";

function monthsAgoIso(today: Date, months: number): string {
  const d = new Date(today);
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

export async function loadContext(
  db: Client,
  invoiceId: string,
  today: Date
): Promise<InvoiceContext> {
  const invoiceResult = await db.execute({
    sql: `
      SELECT
        invoices.id AS id,
        invoices.entity_id AS entityId,
        entities.name AS entityName,
        invoices.supplier_id AS supplierId,
        invoices.contract_id AS contractId,
        invoices.invoice_number AS invoiceNumber,
        invoices.category AS category,
        invoices.amount_excl_vat_cents AS amountExclVatCents,
        invoices.amount_incl_vat_cents AS amountInclVatCents,
        invoices.due_date AS dueDate,
        invoices.issue_date AS issueDate,
        invoices.printed_iban AS printedIban,
        invoices.printed_siren AS printedSiren,
        invoices.printed_vat_number AS printedVatNumber,
        invoices.status AS status
      FROM invoices
      JOIN entities ON entities.id = invoices.entity_id
      WHERE invoices.id = ?
    `,
    args: [invoiceId],
  });
  const invoiceRow = invoiceResult.rows[0];
  if (!invoiceRow) {
    throw new Error(`invoice not found: ${invoiceId}`);
  }

  const invoice = {
    id: String(invoiceRow.id),
    entityId: String(invoiceRow.entityId),
    entityName: String(invoiceRow.entityName),
    supplierId: String(invoiceRow.supplierId),
    contractId: invoiceRow.contractId === null ? null : String(invoiceRow.contractId),
    invoiceNumber: String(invoiceRow.invoiceNumber),
    category: String(invoiceRow.category),
    amountExclVatCents: Number(invoiceRow.amountExclVatCents),
    amountInclVatCents: Number(invoiceRow.amountInclVatCents),
    dueDate: String(invoiceRow.dueDate),
    issueDate: String(invoiceRow.issueDate),
    printedIban: String(invoiceRow.printedIban),
    printedSiren: String(invoiceRow.printedSiren),
    printedVatNumber: String(invoiceRow.printedVatNumber),
    status: String(invoiceRow.status),
  };

  const thresholdsResult = await db.execute(
    "SELECT deviation_orange AS deviationOrange, deviation_red AS deviationRed, new_supplier_amount_cents AS newSupplierAmountCents, exceptional_amount_cents AS exceptionalAmountCents, iban_recent_change_days AS ibanRecentChangeDays, risk_window_months AS riskWindowMonths, duplicate_window_days AS duplicateWindowDays, recurring_min_invoices AS recurringMinInvoices, history_sample AS historySample FROM thresholds WHERE id = 'default'"
  );
  const thresholdsRow = thresholdsResult.rows[0];
  if (!thresholdsRow) {
    throw new Error("thresholds row not found — did seed() run?");
  }
  const thresholds: Thresholds = {
    deviationOrange: Number(thresholdsRow.deviationOrange),
    deviationRed: Number(thresholdsRow.deviationRed),
    newSupplierAmountCents: Number(thresholdsRow.newSupplierAmountCents),
    exceptionalAmountCents: Number(thresholdsRow.exceptionalAmountCents),
    ibanRecentChangeDays: Number(thresholdsRow.ibanRecentChangeDays),
    riskWindowMonths: Number(thresholdsRow.riskWindowMonths),
    duplicateWindowDays: Number(thresholdsRow.duplicateWindowDays),
    recurringMinInvoices: Number(thresholdsRow.recurringMinInvoices),
    historySample: Number(thresholdsRow.historySample),
  };

  const cutoff = monthsAgoIso(today, thresholds.riskWindowMonths);
  const hasContract = invoice.contractId !== null;

  const statements = [
    {
      sql: "SELECT id, name, siren, vat_number AS vatNumber FROM suppliers WHERE id = ?",
      args: [invoice.supplierId],
    },
    {
      sql: "SELECT iban, effective_from AS effectiveFrom FROM iban_history WHERE supplier_id = ? ORDER BY effective_from DESC",
      args: [invoice.supplierId],
    },
    {
      sql: "SELECT event_date AS eventDate, description FROM risk_events WHERE supplier_id = ?",
      args: [invoice.supplierId],
    },
    {
      // Rules (deviation-history.ts's historySample slice) depend on this DESC ordering to mean "most recent".
      sql: `
        SELECT invoices.entity_id AS entityId, entities.name AS entityName, invoices.category AS category,
               invoices.amount_excl_vat_cents AS amountExclVatCents, invoices.due_date AS dueDate
        FROM invoices
        JOIN entities ON entities.id = invoices.entity_id
        WHERE invoices.supplier_id = ? AND invoices.status = 'approved' AND invoices.due_date >= ? AND invoices.id != ?
        ORDER BY invoices.due_date DESC
      `,
      args: [invoice.supplierId, cutoff, invoice.id],
    },
    {
      sql: "SELECT DISTINCT category FROM invoices WHERE entity_id = ? AND status = 'approved'",
      args: [invoice.entityId],
    },
    {
      sql: `
        SELECT id, invoice_number AS invoiceNumber, status, amount_incl_vat_cents AS amountInclVatCents,
               issue_date AS issueDate, entity_id AS entityId
        FROM invoices
        WHERE supplier_id = ? AND id != ?
      `,
      args: [invoice.supplierId, invoice.id],
    },
    ...(hasContract
      ? [
          {
            sql: "SELECT id, category, expected_amount_cents AS expectedAmountCents FROM contracts WHERE id = ?",
            args: [invoice.contractId as string],
          },
        ]
      : []),
  ];

  const results = await db.batch(statements, "read");

  const supplierRow = results[0].rows[0];
  const ibanRows = results[1].rows;
  const riskRows = results[2].rows;
  const groupApprovedRows = results[3].rows;
  const categoryRows = results[4].rows;
  const otherInvoiceRows = results[5].rows;
  const contractRow = hasContract ? results[6].rows[0] : undefined;

  return {
    invoice,
    supplier: {
      id: String(supplierRow.id),
      name: String(supplierRow.name),
      siren: String(supplierRow.siren),
      vatNumber: String(supplierRow.vatNumber),
    },
    ibanHistory: ibanRows.map((row) => ({
      iban: String(row.iban),
      effectiveFrom: String(row.effectiveFrom),
    })),
    riskEvents: riskRows.map((row) => ({
      eventDate: String(row.eventDate),
      description: String(row.description),
    })),
    contract: contractRow
      ? {
          id: String(contractRow.id),
          category: String(contractRow.category),
          expectedAmountCents:
            contractRow.expectedAmountCents === null ? null : Number(contractRow.expectedAmountCents),
        }
      : null,
    groupApprovedInvoices: groupApprovedRows.map((row) => ({
      entityId: String(row.entityId),
      entityName: String(row.entityName),
      category: String(row.category),
      amountExclVatCents: Number(row.amountExclVatCents),
      dueDate: String(row.dueDate),
    })),
    subsidiaryApprovedCategories: categoryRows.map((row) => String(row.category)),
    otherSupplierInvoices: otherInvoiceRows.map((row) => ({
      id: String(row.id),
      invoiceNumber: String(row.invoiceNumber),
      status: String(row.status),
      amountInclVatCents: Number(row.amountInclVatCents),
      issueDate: String(row.issueDate),
      entityId: String(row.entityId),
    })),
    thresholds,
  };
}
```

(Only changes: the import line at the top now imports `Thresholds` as a
type instead of `RISK_WINDOW_MONTHS` as a value; a new thresholds fetch is
inserted right after the `invoice` object is built; `cutoff` now reads
`thresholds.riskWindowMonths`; the returned object gains `thresholds,` as
its last field. Every SQL string and every other field is byte-for-byte
the same as before.)

- [ ] **Step 6: Add a thresholds assertion to `context.test.ts`**

In `lib/rules/context.test.ts`, in the first test (`"loads the full context
for a known pending invoice..."`), add one line right after the existing
`expect(ctx.invoice.status).toBe("pending");` line:

```ts
    expect(ctx.invoice.status).toBe("pending");
    expect(ctx.thresholds.riskWindowMonths).toBe(12);
```

- [ ] **Step 7: Update the 9 rule files that read thresholds**

For each file below, remove its `thresholds.ts` import and replace every
usage of the named constant with the matching `ctx.thresholds.x` field.
Replace each file's entire contents with the version shown.

`lib/rules/rules/deviation-history.ts`:

```ts
import type { InvoiceContext, Reason } from "../types";
import { median } from "../stats";
import { formatEuros, formatPercent } from "../../format";

export default function deviationHistoryRule(ctx: InvoiceContext): Reason | null {
  // Depends on groupApprovedInvoices being ordered newest-first (see context.ts's ORDER BY due_date DESC).
  const sample = ctx.groupApprovedInvoices
    .filter((i) => i.entityId === ctx.invoice.entityId && i.category === ctx.invoice.category)
    .slice(0, ctx.thresholds.historySample)
    .map((i) => i.amountExclVatCents);

  const baseline = median(sample);
  if (baseline === null || baseline === 0) return null;

  const amount = ctx.invoice.amountExclVatCents;
  const deviation = (amount - baseline) / baseline;
  if (deviation <= ctx.thresholds.deviationOrange) return null;

  const message = `Montant ${formatEuros(amount)} HT, ${formatPercent(deviation)} au-dessus de l'historique (médiane ${formatEuros(baseline)} HT sur ${sample.length} factures)`;
  const data = {
    amountExclVatCents: amount,
    medianExclVatCents: baseline,
    deviationPct: deviation,
    sampleCount: sample.length,
  };

  if (deviation > ctx.thresholds.deviationRed) {
    return { code: "DEVIATION_HISTORY_HIGH", level: "red", message, data };
  }
  return { code: "DEVIATION_HISTORY", level: "orange", message, data };
}
```

`lib/rules/rules/deviation-contract.ts`:

```ts
import type { InvoiceContext, Reason } from "../types";
import { formatEuros, formatPercent } from "../../format";

export default function deviationContractRule(ctx: InvoiceContext): Reason | null {
  const expected = ctx.contract?.expectedAmountCents;
  if (expected === null || expected === undefined || expected === 0) return null;

  const amount = ctx.invoice.amountExclVatCents;
  const deviation = (amount - expected) / expected;
  if (deviation <= ctx.thresholds.deviationOrange) return null;

  const message = `Montant ${formatEuros(amount)} HT, ${formatPercent(deviation)} au-dessus du contrat (${formatEuros(expected)} HT attendu)`;
  const data = { amountExclVatCents: amount, expectedAmountCents: expected, deviationPct: deviation };

  if (deviation > ctx.thresholds.deviationRed) {
    return { code: "DEVIATION_CONTRACT_HIGH", level: "red", message, data };
  }
  return { code: "DEVIATION_CONTRACT", level: "orange", message, data };
}
```

`lib/rules/rules/deviation-peer.ts`:

```ts
import type { InvoiceContext, Reason } from "../types";
import { median } from "../stats";
import { formatEuros, formatPercent } from "../../format";

export default function deviationPeerRule(ctx: InvoiceContext): Reason | null {
  const peers = ctx.groupApprovedInvoices.filter(
    (i) => i.entityId !== ctx.invoice.entityId && i.category === ctx.invoice.category
  );
  if (peers.length === 0) return null;

  const baseline = median(peers.map((i) => i.amountExclVatCents));
  if (baseline === null || baseline === 0) return null;

  const amount = ctx.invoice.amountExclVatCents;
  const deviation = (amount - baseline) / baseline;
  if (deviation <= ctx.thresholds.deviationOrange) return null;

  const otherEntities = [...new Set(peers.map((i) => i.entityName))];
  const message = `Montant ${formatEuros(amount)} HT, ${formatPercent(deviation)} au-dessus des autres filiales (${otherEntities.join(", ")} : médiane ${formatEuros(baseline)} HT)`;
  const data = {
    amountExclVatCents: amount,
    medianExclVatCents: baseline,
    deviationPct: deviation,
    otherEntities,
  };

  if (deviation > ctx.thresholds.deviationRed) {
    return { code: "DEVIATION_PEER_HIGH", level: "red", message, data };
  }
  return { code: "DEVIATION_PEER", level: "orange", message, data };
}
```

`lib/rules/rules/duplicate-amount.ts`:

```ts
import type { InvoiceContext, Reason } from "../types";
import { formatEuros } from "../../format";

const DAY_MS = 24 * 60 * 60 * 1000;

function daysBetween(a: string, b: string): number {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / DAY_MS;
}

export default function duplicateAmountRule(
  ctx: InvoiceContext
): Reason | null {
  const match = ctx.otherSupplierInvoices.find(
    (i) =>
      i.entityId === ctx.invoice.entityId &&
      i.amountInclVatCents === ctx.invoice.amountInclVatCents &&
      daysBetween(i.issueDate, ctx.invoice.issueDate) <= ctx.thresholds.duplicateWindowDays
  );
  if (!match) return null;

  const days = Math.round(
    daysBetween(match.issueDate, ctx.invoice.issueDate)
  );
  const message = `Facture ${match.invoiceNumber}, même montant TTC (${formatEuros(match.amountInclVatCents)}) émise ${days} jour${days === 1 ? "" : "s"} plus tôt`;
  return {
    code: "DUPLICATE_AMOUNT",
    level: "red",
    message,
    data: {
      otherInvoiceId: match.id,
      otherInvoiceNumber: match.invoiceNumber,
      amountInclVatCents: match.amountInclVatCents,
      daysApart: days,
    },
  };
}
```

`lib/rules/rules/iban-recently-changed.ts`:

```ts
import type { InvoiceContext, Reason } from "../types";

const DAY_MS = 24 * 60 * 60 * 1000;

export default function ibanRecentlyChangedRule(ctx: InvoiceContext, today: Date): Reason | null {
  const current = ctx.ibanHistory[0];
  if (!current) return null;

  const daysAgo = Math.round((today.getTime() - new Date(current.effectiveFrom).getTime()) / DAY_MS);
  if (daysAgo < 0 || daysAgo > ctx.thresholds.ibanRecentChangeDays) return null;

  const previous = ctx.ibanHistory[1];
  const mask = (iban: string) => iban.slice(-4);
  const previousLabel = previous ? `…${mask(previous.iban)}` : "inconnu";
  const message = `IBAN modifié il y a ${daysAgo} jour${daysAgo === 1 ? "" : "s"} (ancien : ${previousLabel})`;
  return {
    code: "IBAN_RECENTLY_CHANGED",
    level: "red",
    message,
    data: { daysAgo, newIban: current.iban, previousIban: previous?.iban ?? null },
  };
}
```

`lib/rules/rules/exceptional-amount.ts`:

```ts
import type { InvoiceContext, Reason } from "../types";
import { formatEuros } from "../../format";

export default function exceptionalAmountRule(ctx: InvoiceContext): Reason | null {
  const amount = ctx.invoice.amountExclVatCents;
  if (amount <= ctx.thresholds.exceptionalAmountCents) return null;

  const message = `Montant exceptionnel : ${formatEuros(amount)} HT (seuil ${formatEuros(ctx.thresholds.exceptionalAmountCents)})`;
  return {
    code: "EXCEPTIONAL_AMOUNT",
    level: "red",
    message,
    data: { amountExclVatCents: amount, threshold: ctx.thresholds.exceptionalAmountCents },
  };
}
```

`lib/rules/rules/new-supplier.ts`:

```ts
import type { InvoiceContext, Reason } from "../types";
import { formatEuros } from "../../format";

export default function newSupplierRule(ctx: InvoiceContext): Reason | null {
  if (ctx.groupApprovedInvoices.length > 0) return null;

  const amount = ctx.invoice.amountExclVatCents;
  const message = `Nouveau fournisseur, ${formatEuros(amount)} HT`;
  const data = { amountExclVatCents: amount, threshold: ctx.thresholds.newSupplierAmountCents };

  if (amount > ctx.thresholds.newSupplierAmountCents) {
    return { code: "NEW_SUPPLIER_LARGE", level: "red", message, data };
  }
  return { code: "NEW_SUPPLIER_SMALL", level: "orange", message, data };
}
```

`lib/rules/rules/not-recurring.ts`:

```ts
import type { InvoiceContext, Reason } from "../types";

export default function notRecurringRule(ctx: InvoiceContext): Reason | null {
  if (ctx.groupApprovedInvoices.length === 0) return null;

  const countAtSubsidiary = ctx.groupApprovedInvoices.filter(
    (i) => i.entityId === ctx.invoice.entityId
  ).length;
  if (countAtSubsidiary >= ctx.thresholds.recurringMinInvoices) return null;

  return {
    code: "NOT_RECURRING",
    level: "orange",
    message: `Seulement ${countAtSubsidiary} facture${countAtSubsidiary === 1 ? "" : "s"} approuvée${countAtSubsidiary === 1 ? "" : "s"} pour cette filiale sur 12 mois`,
    data: { countAtSubsidiary, threshold: ctx.thresholds.recurringMinInvoices },
  };
}
```

`lib/rules/rules/supplier-risk.ts`:

```ts
import type { InvoiceContext, Reason } from "../types";

function monthsBetween(from: Date, to: Date): number {
  return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
}

export default function supplierRiskRule(ctx: InvoiceContext, today: Date): Reason | null {
  const match = ctx.riskEvents.find((event) => {
    const months = monthsBetween(new Date(event.eventDate), today);
    return months >= 0 && months <= ctx.thresholds.riskWindowMonths;
  });
  if (!match) return null;

  const months = monthsBetween(new Date(match.eventDate), today);
  return {
    code: "SUPPLIER_RISK",
    level: "red",
    message: `Événement de risque signalé il y a ${months} mois : ${match.description}`,
    data: { eventDate: match.eventDate, description: match.description, monthsAgo: months },
  };
}
```

- [ ] **Step 8: Add one "custom threshold changes the outcome" test per rule**

Append each `it` block below to the end of its file's existing `describe`
block (right before the closing `});`).

`lib/rules/rules/deviation-history.test.ts`:

```ts
  it("uses a custom orange threshold from context instead of the default 15%", () => {
    const ctx = buildContext({
      invoice: { amountExclVatCents: 110_000 },
      thresholds: { deviationOrange: 0.05 },
    });
    const reason = deviationHistoryRule(ctx);
    expect(reason?.code).toBe("DEVIATION_HISTORY");
    expect(reason?.level).toBe("orange");
  });
```

`lib/rules/rules/deviation-contract.test.ts`:

```ts
  it("uses a custom orange threshold from context instead of the default 15%", () => {
    const ctx = buildContext({
      invoice: { amountExclVatCents: 110_000 },
      thresholds: { deviationOrange: 0.05 },
    });
    const reason = deviationContractRule(ctx);
    expect(reason?.code).toBe("DEVIATION_CONTRACT");
    expect(reason?.level).toBe("orange");
  });
```

`lib/rules/rules/deviation-peer.test.ts`:

```ts
  it("uses a custom orange threshold from context instead of the default 15%", () => {
    const ctx = buildContext({
      invoice: { amountExclVatCents: 110_000 },
      groupApprovedInvoices: peersAt("ent-other", "Filiale Voisine", 100_000),
      thresholds: { deviationOrange: 0.05 },
    });
    const reason = deviationPeerRule(ctx);
    expect(reason?.code).toBe("DEVIATION_PEER");
    expect(reason?.level).toBe("orange");
  });
```

`lib/rules/rules/duplicate-amount.test.ts`:

```ts
  it("uses a custom window from context instead of the default 60 days", () => {
    const ctx = buildContext({
      invoice: { issueDate: "2026-05-31", amountInclVatCents: 120_000 },
      otherSupplierInvoices: [
        {
          id: "inv-other",
          invoiceNumber: "INV-999",
          status: "approved",
          amountInclVatCents: 120_000,
          // 77 days before 2026-05-31 — outside the default 60-day window,
          // inside a custom 90-day one.
          issueDate: "2026-03-15",
          entityId: "ent-1",
        },
      ],
      thresholds: { duplicateWindowDays: 90 },
    });
    const reason = duplicateAmountRule(ctx);
    expect(reason?.code).toBe("DUPLICATE_AMOUNT");
    expect(reason?.level).toBe("red");
  });
```

`lib/rules/rules/iban-recently-changed.test.ts`:

```ts
  it("uses a custom window from context instead of the default 90 days", () => {
    const ctx = buildContext({
      ibanHistory: [{ iban: "FR1420041010050500013M02606", effectiveFrom: "2026-02-15" }],
      thresholds: { ibanRecentChangeDays: 120 },
    });
    // 2026-02-15 -> 2026-06-15 is exactly 120 days; the default 90-day window would miss it.
    const reason = ibanRecentlyChangedRule(ctx, TODAY);
    expect(reason?.code).toBe("IBAN_RECENTLY_CHANGED");
    expect(reason?.level).toBe("red");
  });
```

`lib/rules/rules/exceptional-amount.test.ts`:

```ts
  it("uses a custom threshold from context instead of the default 50 000 €", () => {
    const ctx = buildContext({
      invoice: { amountExclVatCents: 100_000 },
      thresholds: { exceptionalAmountCents: 50_000 },
    });
    const reason = exceptionalAmountRule(ctx);
    expect(reason?.code).toBe("EXCEPTIONAL_AMOUNT");
    expect(reason?.level).toBe("red");
  });
```

`lib/rules/rules/new-supplier.test.ts`:

```ts
  it("uses a custom threshold from context instead of the default 5 000 €", () => {
    const ctx = buildContext({
      invoice: { amountExclVatCents: 300_000 },
      groupApprovedInvoices: [],
      thresholds: { newSupplierAmountCents: 100_000 },
    });
    const reason = newSupplierRule(ctx);
    expect(reason?.code).toBe("NEW_SUPPLIER_LARGE");
    expect(reason?.level).toBe("red");
  });
```

`lib/rules/rules/not-recurring.test.ts`:

```ts
  it("uses a custom minimum from context instead of the default 3", () => {
    const ctx = buildContext({
      groupApprovedInvoices: [invoiceAt("ent-1"), invoiceAt("ent-1")],
      thresholds: { recurringMinInvoices: 2 },
    });
    expect(notRecurringRule(ctx)).toBeNull();
  });
```

`lib/rules/rules/supplier-risk.test.ts`:

```ts
  it("uses a custom window from context instead of the default 12 months", () => {
    const ctx = buildContext({
      riskEvents: [{ eventDate: "2025-01-15", description: "Ancien incident." }],
      thresholds: { riskWindowMonths: 18 },
    });
    // 2025-01-15 -> 2026-06-15 is 17 months; the default 12-month window would miss it.
    const reason = supplierRiskRule(ctx, TODAY);
    expect(reason?.code).toBe("SUPPLIER_RISK");
    expect(reason?.level).toBe("red");
  });
```

- [ ] **Step 9: Update `app/(app)/invoices/[id]/page.tsx`**

Remove the import:

```ts
import { HISTORY_SAMPLE } from "@/lib/rules/thresholds";
```

And change this line (it slices `context.groupApprovedInvoices` for the
"Historique à cette filiale" table):

```ts
    .slice(0, HISTORY_SAMPLE);
```

to:

```ts
    .slice(0, context.thresholds.historySample);
```

- [ ] **Step 10: Run the full test suite**

Run: `npm test`
Expected: PASS, all test files including every rule's `.test.ts`,
`thresholds.test.ts`, `context.test.ts`, `engine.test.ts`, and
`classify-all.test.ts` (which re-runs all 13 seed scenarios end to end
against the real seeded thresholds row).

- [ ] **Step 11: Typecheck and build**

Run: `npx tsc --noEmit && npm run build`
Expected: no errors.

- [ ] **Step 12: Commit**

```bash
git add lib/rules app/\(app\)/invoices/\[id\]/page.tsx
git commit -m "Thread thresholds through InvoiceContext instead of static imports"
```

---

### Task 4: `getThresholds` query for the settings page

**Files:**
- Modify: `lib/db/queries.ts`
- Modify: `lib/db/queries.test.ts`

**Interfaces:**
- Consumes: `Thresholds` type from `lib/rules/thresholds.ts` (Task 3); the
  seeded `thresholds` row (Task 2).
- Produces: `export async function getThresholds(db: Client): Promise<Thresholds>` from `lib/db/queries.ts`.

- [ ] **Step 1: Add the import**

In `lib/db/queries.ts`, add to the top of the file:

```ts
import type { Thresholds } from "../rules/thresholds";
```

so the imports read:

```ts
import "server-only";
import type { Client } from "@libsql/client";
import type { Level, Reason } from "../rules/types";
import type { Thresholds } from "../rules/thresholds";
import { SEED_HISTORY_SESSION_PREFIX } from "./seed";
```

- [ ] **Step 2: Add `getThresholds`**

Add this function anywhere in `lib/db/queries.ts` (e.g. at the end of the
file):

```ts
export async function getThresholds(db: Client): Promise<Thresholds> {
  const result = await db.execute(
    "SELECT deviation_orange AS deviationOrange, deviation_red AS deviationRed, new_supplier_amount_cents AS newSupplierAmountCents, exceptional_amount_cents AS exceptionalAmountCents, iban_recent_change_days AS ibanRecentChangeDays, risk_window_months AS riskWindowMonths, duplicate_window_days AS duplicateWindowDays, recurring_min_invoices AS recurringMinInvoices, history_sample AS historySample FROM thresholds WHERE id = 'default'"
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error("thresholds row not found — did seed() run?");
  }
  return {
    deviationOrange: Number(row.deviationOrange),
    deviationRed: Number(row.deviationRed),
    newSupplierAmountCents: Number(row.newSupplierAmountCents),
    exceptionalAmountCents: Number(row.exceptionalAmountCents),
    ibanRecentChangeDays: Number(row.ibanRecentChangeDays),
    riskWindowMonths: Number(row.riskWindowMonths),
    duplicateWindowDays: Number(row.duplicateWindowDays),
    recurringMinInvoices: Number(row.recurringMinInvoices),
    historySample: Number(row.historySample),
  };
}
```

- [ ] **Step 3: Write the test**

Add to `lib/db/queries.test.ts`:

```ts
describe("getThresholds", () => {
  it("returns the seeded default thresholds", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db);
    await seed(db);

    const thresholds = await getThresholds(db);
    expect(thresholds.deviationOrange).toBe(0.15);
    expect(thresholds.deviationRed).toBe(0.4);
    expect(thresholds.exceptionalAmountCents).toBe(50_000_00);
    expect(thresholds.newSupplierAmountCents).toBe(5_000_00);
    expect(thresholds.historySample).toBe(6);

    db.close();
  });
});
```

And add `getThresholds` to the existing import from `"./queries"` at the
top of the test file.

- [ ] **Step 4: Run the test**

Run: `npx vitest run lib/db/queries.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/db/queries.ts lib/db/queries.test.ts
git commit -m "Add getThresholds query"
```

---

### Task 5: Form parsing/validation + server action

**Files:**
- Create: `lib/rules/threshold-form.ts`
- Create: `lib/rules/threshold-form.test.ts`
- Create: `app/actions/thresholds.ts`

**Interfaces:**
- Consumes: `classifyAll` from `lib/rules/classify-all.ts` (existing,
  unchanged signature `(db: Client, today?: Date) => Promise<void>`); `db`
  from `lib/db/client.ts`.
- Produces:
  - `export interface ParsedThresholdsInput { deviationOrange: number; deviationRed: number; newSupplierAmountCents: number; exceptionalAmountCents: number; ibanRecentChangeDays: number; riskWindowMonths: number; duplicateWindowDays: number; recurringMinInvoices: number; historySample: number; }` from `lib/rules/threshold-form.ts`
  - `export function parseThresholdsForm(formData: FormData): ParsedThresholdsInput | null` from `lib/rules/threshold-form.ts`
  - `export function isValidThresholdOrder(parsed: ParsedThresholdsInput): boolean` from `lib/rules/threshold-form.ts`
  - `export async function updateThresholds(formData: FormData): Promise<void>` from `app/actions/thresholds.ts`

Form field names `updateThresholds`/`parseThresholdsForm` expect (Task 6's
page must name its inputs exactly this way): `deviationOrangePct`,
`deviationRedPct`, `newSupplierAmountEuros`, `exceptionalAmountEuros`,
`ibanRecentChangeDays`, `riskWindowMonths`, `duplicateWindowDays`,
`recurringMinInvoices`, `historySample`.

A Next.js file with a top-level `"use server"` directive may only export
`async` functions — that's why the parsing/validation logic below lives in
a plain module (`lib/rules/threshold-form.ts`, no directive, fully unit
testable) that `app/actions/thresholds.ts` imports, rather than living
directly in the action file.

- [ ] **Step 1: Write `lib/rules/threshold-form.ts`**

```ts
export interface ParsedThresholdsInput {
  deviationOrange: number;
  deviationRed: number;
  newSupplierAmountCents: number;
  exceptionalAmountCents: number;
  ibanRecentChangeDays: number;
  riskWindowMonths: number;
  duplicateWindowDays: number;
  recurringMinInvoices: number;
  historySample: number;
}

// Reads the raw form fields (euros/percent, matching what the /rules page
// displays), validates they're all finite positive numbers, and converts
// to the ratio/cents units the rules engine and DB use. Returns null if
// any field is missing or not a positive number.
export function parseThresholdsForm(formData: FormData): ParsedThresholdsInput | null {
  const deviationOrangePct = Number(formData.get("deviationOrangePct"));
  const deviationRedPct = Number(formData.get("deviationRedPct"));
  const newSupplierAmountEuros = Number(formData.get("newSupplierAmountEuros"));
  const exceptionalAmountEuros = Number(formData.get("exceptionalAmountEuros"));
  const ibanRecentChangeDays = Number(formData.get("ibanRecentChangeDays"));
  const riskWindowMonths = Number(formData.get("riskWindowMonths"));
  const duplicateWindowDays = Number(formData.get("duplicateWindowDays"));
  const recurringMinInvoices = Number(formData.get("recurringMinInvoices"));
  const historySample = Number(formData.get("historySample"));

  const rawValues = [
    deviationOrangePct,
    deviationRedPct,
    newSupplierAmountEuros,
    exceptionalAmountEuros,
    ibanRecentChangeDays,
    riskWindowMonths,
    duplicateWindowDays,
    recurringMinInvoices,
    historySample,
  ];
  if (rawValues.some((value) => !Number.isFinite(value) || value <= 0)) {
    return null;
  }

  return {
    deviationOrange: deviationOrangePct / 100,
    deviationRed: deviationRedPct / 100,
    newSupplierAmountCents: Math.round(newSupplierAmountEuros * 100),
    exceptionalAmountCents: Math.round(exceptionalAmountEuros * 100),
    ibanRecentChangeDays,
    riskWindowMonths,
    duplicateWindowDays,
    recurringMinInvoices,
    historySample,
  };
}

// A rule engine where "red" isn't strictly above "orange" makes the
// orange band unreachable — every invoice that crosses orange would
// immediately read as red.
export function isValidThresholdOrder(parsed: ParsedThresholdsInput): boolean {
  return parsed.deviationRed > parsed.deviationOrange;
}
```

- [ ] **Step 2: Write `lib/rules/threshold-form.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { parseThresholdsForm, isValidThresholdOrder } from "./threshold-form";

function formWith(overrides: Record<string, string>): FormData {
  const defaults: Record<string, string> = {
    deviationOrangePct: "15",
    deviationRedPct: "40",
    newSupplierAmountEuros: "5000",
    exceptionalAmountEuros: "50000",
    ibanRecentChangeDays: "90",
    riskWindowMonths: "12",
    duplicateWindowDays: "60",
    recurringMinInvoices: "3",
    historySample: "6",
    ...overrides,
  };
  const formData = new FormData();
  for (const [key, value] of Object.entries(defaults)) {
    formData.set(key, value);
  }
  return formData;
}

describe("parseThresholdsForm", () => {
  it("converts euros to cents and percentages to ratios", () => {
    const parsed = parseThresholdsForm(formWith({}));
    expect(parsed).toEqual({
      deviationOrange: 0.15,
      deviationRed: 0.4,
      newSupplierAmountCents: 500_000,
      exceptionalAmountCents: 5_000_000,
      ibanRecentChangeDays: 90,
      riskWindowMonths: 12,
      duplicateWindowDays: 60,
      recurringMinInvoices: 3,
      historySample: 6,
    });
  });

  it("returns null when a field is zero, negative, or not a number", () => {
    expect(parseThresholdsForm(formWith({ exceptionalAmountEuros: "0" }))).toBeNull();
    expect(parseThresholdsForm(formWith({ recurringMinInvoices: "-1" }))).toBeNull();
    expect(parseThresholdsForm(formWith({ historySample: "abc" }))).toBeNull();
  });
});

describe("isValidThresholdOrder", () => {
  it("accepts a valid ordering where red is above orange", () => {
    const parsed = parseThresholdsForm(formWith({}));
    expect(parsed).not.toBeNull();
    expect(isValidThresholdOrder(parsed!)).toBe(true);
  });

  it("flags an invalid ordering where red is not above orange", () => {
    const parsed = parseThresholdsForm(formWith({ deviationOrangePct: "40", deviationRedPct: "40" }));
    expect(parsed).not.toBeNull();
    expect(isValidThresholdOrder(parsed!)).toBe(false);
  });
});
```

- [ ] **Step 3: Run the tests**

Run: `npx vitest run lib/rules/threshold-form.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 4: Write `app/actions/thresholds.ts`**

```ts
// app/actions/thresholds.ts
"use server";

import "server-only";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db/client";
import { classifyAll } from "@/lib/rules/classify-all";
import { parseThresholdsForm, isValidThresholdOrder } from "@/lib/rules/threshold-form";

export async function updateThresholds(formData: FormData): Promise<void> {
  const parsed = parseThresholdsForm(formData);
  if (!parsed) {
    redirect("/rules?error=invalid");
  }
  if (!isValidThresholdOrder(parsed)) {
    redirect("/rules?error=order");
  }

  await db.execute({
    sql: `UPDATE thresholds SET
      deviation_orange = ?, deviation_red = ?, new_supplier_amount_cents = ?,
      exceptional_amount_cents = ?, iban_recent_change_days = ?, risk_window_months = ?,
      duplicate_window_days = ?, recurring_min_invoices = ?, history_sample = ?,
      updated_at = datetime('now')
      WHERE id = 'default'`,
    args: [
      parsed.deviationOrange,
      parsed.deviationRed,
      parsed.newSupplierAmountCents,
      parsed.exceptionalAmountCents,
      parsed.ibanRecentChangeDays,
      parsed.riskWindowMonths,
      parsed.duplicateWindowDays,
      parsed.recurringMinInvoices,
      parsed.historySample,
    ],
  });

  await classifyAll(db);

  revalidatePath("/rules");
  revalidatePath("/");
  redirect("/rules?saved=1");
}
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (`redirect()` has return type `never`, so TypeScript
narrows `parsed` to non-null after the `if (!parsed) { redirect(...); }`
block — the same pattern already used in `app/actions/sign.ts`.)

- [ ] **Step 6: Commit**

```bash
git add lib/rules/threshold-form.ts lib/rules/threshold-form.test.ts app/actions/thresholds.ts
git commit -m "Add threshold form validation and the updateThresholds server action"
```

---

### Task 6: `/rules` settings page + nav link

**Files:**
- Create: `app/(app)/rules/page.tsx`
- Modify: `app/(app)/_components/nav.tsx`

**Interfaces:**
- Consumes: `getThresholds` from `lib/db/queries.ts` (Task 4);
  `updateThresholds` from `app/actions/thresholds.ts` (Task 5); `LevelBadge`
  from `components/level-badge.tsx` (existing, already supports an optional
  `label` override prop — used elsewhere by `app/(app)/_components/invoice-list.tsx`).
- Produces: a page at `/rules`, reachable from a new "Règles" nav link.

- [ ] **Step 1: Write `app/(app)/rules/page.tsx`**

```tsx
import { db } from "@/lib/db/client";
import { getThresholds } from "@/lib/db/queries";
import { LevelBadge } from "@/components/level-badge";
import { updateThresholds } from "@/app/actions/thresholds";

export const dynamic = "force-dynamic";

export default async function RulesPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { saved, error } = await searchParams;
  const thresholds = await getThresholds(db);

  return (
    <div className="space-y-8 px-4 py-4">
      <div>
        <h1 className="text-lg font-semibold text-gray-900">Règles de classification</h1>
        <p className="mt-1 text-sm text-gray-500">
          Modifier un seuil reclasse immédiatement les factures en attente.
        </p>
      </div>

      {saved === "1" && (
        <p className="rounded border border-green-200 bg-green-50 p-3 text-sm text-green-800">
          Règles enregistrées et factures en attente reclassées.
        </p>
      )}
      {error === "invalid" && (
        <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          Toutes les valeurs doivent être des nombres positifs.
        </p>
      )}
      {error === "order" && (
        <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          Le seuil rouge de l&apos;écart doit être supérieur au seuil orange.
        </p>
      )}

      <form action={updateThresholds} className="space-y-8">
        <div>
          <h2 className="mb-3">
            <LevelBadge level="red" label="Rouge" />
          </h2>
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-900">
                Montant exceptionnel
              </label>
              <p className="mb-1 text-sm text-gray-500">
                Facture HT au-dessus de ce montant, quel que soit le fournisseur.
              </p>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  name="exceptionalAmountEuros"
                  defaultValue={thresholds.exceptionalAmountCents / 100}
                  min="1"
                  step="1"
                  className="w-32 rounded border border-gray-300 p-2 text-right"
                />
                <span className="text-sm text-gray-500">€ HT</span>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-900">
                Écart vs historique / contrat / filiale — rouge
              </label>
              <p className="mb-1 text-sm text-gray-500">
                Au-delà de ce pourcentage d&apos;écart, la facture passe au rouge.
              </p>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  name="deviationRedPct"
                  defaultValue={Math.round(thresholds.deviationRed * 100)}
                  min="1"
                  step="1"
                  className="w-32 rounded border border-gray-300 p-2 text-right"
                />
                <span className="text-sm text-gray-500">%</span>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-900">
                IBAN modifié récemment
              </label>
              <p className="mb-1 text-sm text-gray-500">
                Facture rouge si l&apos;IBAN du fournisseur a changé il y a moins de ce
                nombre de jours.
              </p>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  name="ibanRecentChangeDays"
                  defaultValue={thresholds.ibanRecentChangeDays}
                  min="1"
                  step="1"
                  className="w-32 rounded border border-gray-300 p-2 text-right"
                />
                <span className="text-sm text-gray-500">jours</span>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-900">
                Événement de risque fournisseur
              </label>
              <p className="mb-1 text-sm text-gray-500">
                Facture rouge si un événement de risque a été signalé il y a moins de ce
                nombre de mois.
              </p>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  name="riskWindowMonths"
                  defaultValue={thresholds.riskWindowMonths}
                  min="1"
                  step="1"
                  className="w-32 rounded border border-gray-300 p-2 text-right"
                />
                <span className="text-sm text-gray-500">mois</span>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-900">
                Facture en double — fenêtre
              </label>
              <p className="mb-1 text-sm text-gray-500">
                Même montant, même filiale, émise à moins de ce nombre de jours d&apos;une
                autre facture déjà connue.
              </p>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  name="duplicateWindowDays"
                  defaultValue={thresholds.duplicateWindowDays}
                  min="1"
                  step="1"
                  className="w-32 rounded border border-gray-300 p-2 text-right"
                />
                <span className="text-sm text-gray-500">jours</span>
              </div>
            </div>
          </div>
        </div>

        <div>
          <h2 className="mb-3">
            <LevelBadge level="orange" label="Orange" />
          </h2>
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-900">
                Écart vs historique / contrat / filiale — orange
              </label>
              <p className="mb-1 text-sm text-gray-500">
                Au-delà de ce pourcentage d&apos;écart, la facture passe à l&apos;orange.
              </p>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  name="deviationOrangePct"
                  defaultValue={Math.round(thresholds.deviationOrange * 100)}
                  min="1"
                  step="1"
                  className="w-32 rounded border border-gray-300 p-2 text-right"
                />
                <span className="text-sm text-gray-500">%</span>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-900">
                Nouveau fournisseur — seuil
              </label>
              <p className="mb-1 text-sm text-gray-500">
                Première facture d&apos;un fournisseur : orange en dessous de ce montant HT,
                rouge au-dessus.
              </p>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  name="newSupplierAmountEuros"
                  defaultValue={thresholds.newSupplierAmountCents / 100}
                  min="1"
                  step="1"
                  className="w-32 rounded border border-gray-300 p-2 text-right"
                />
                <span className="text-sm text-gray-500">€ HT</span>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-900">
                Minimum de factures pour être « récurrent »
              </label>
              <p className="mb-1 text-sm text-gray-500">
                En dessous de ce nombre de factures approuvées pour cette filiale, la
                facture passe à l&apos;orange.
              </p>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  name="recurringMinInvoices"
                  defaultValue={thresholds.recurringMinInvoices}
                  min="1"
                  step="1"
                  className="w-32 rounded border border-gray-300 p-2 text-right"
                />
                <span className="text-sm text-gray-500">factures</span>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-900">
                Taille de l&apos;échantillon d&apos;historique
              </label>
              <p className="mb-1 text-sm text-gray-500">
                Nombre de factures récentes utilisées pour calculer la médiane de
                comparaison.
              </p>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  name="historySample"
                  defaultValue={thresholds.historySample}
                  min="1"
                  step="1"
                  className="w-32 rounded border border-gray-300 p-2 text-right"
                />
                <span className="text-sm text-gray-500">factures</span>
              </div>
            </div>
          </div>
        </div>

        <button
          type="submit"
          className="min-h-[44px] w-full rounded bg-blue-600 px-4 text-sm font-semibold text-white sm:w-auto sm:px-8"
        >
          Enregistrer les règles
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Add the nav link**

In `app/(app)/_components/nav.tsx`, add a fourth entry to the `LINKS`
array, right after the `"/notifications"` entry:

```ts
  {
    href: "/notifications",
    label: "Notifications",
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M6 9a6 6 0 1 1 12 0c0 3.5 1 5 2 6H4c1-1 2-2.5 2-6ZM10 19a2 2 0 0 0 4 0"
      />
    ),
  },
  {
    href: "/rules",
    label: "Règles",
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4 7h10M4 12h16M4 17h7"
      />
    ),
  },
];
```

Nothing else in `nav.tsx` changes — the existing `.map()` over `LINKS`
already renders whatever is in the array.

- [ ] **Step 3: Typecheck and build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: no errors, no new lint issues.

- [ ] **Step 4: Full test suite**

Run: `npm test`
Expected: every test file passes.

- [ ] **Step 5: Manual verification**

1. Reset the demo DB directly (bypassing the UI, matching how this
   project's own sessions have verified changes before):
   ```bash
   DOTENV_CONFIG_PATH=.env.local NODE_OPTIONS=--conditions=react-server npx tsx -r dotenv/config scripts/migrate.ts
   DOTENV_CONFIG_PATH=.env.local NODE_OPTIONS=--conditions=react-server npx tsx -r dotenv/config scripts/seed.ts
   ```
2. Start the dev server (`npm run dev`) and open `/rules`. Confirm all 9
   fields show the seeded defaults (Montant exceptionnel 50000,
   écart rouge 40, IBAN 90, risque 12, doublon 60, écart orange 15,
   nouveau fournisseur 5000, minimum récurrent 3, échantillon 6), grouped
   Rouge/Orange.
3. Note the dashboard's red/orange/green counts (should be 7/4/2 on a
   fresh seed).
4. On `/rules`, change "Montant exceptionnel" from 50000 to 5 and save.
   Confirm the page redirects to `/rules?saved=1` and shows the
   confirmation banner.
5. Go to the dashboard. Confirm invoices that were previously
   green/orange but are now above 5€ HT show red, and the red count has
   increased — proving `classifyAll` ran against the new threshold
   without a manual reset.
6. Go back to `/rules`, set "Écart... rouge" to the same value as
   "Écart... orange" (e.g. both 15), submit, and confirm it redirects to
   `/rules?error=order` and shows the ordering-error banner, with the
   thresholds unchanged in the DB (reload `/rules` and confirm the red
   value is still whatever it was before this attempt).
7. Reset the demo via the nav's gear icon. Reload `/rules` and confirm
   every value is back to the seeded defaults (50000, 40, 90, 12, 60, 15,
   5000, 3, 6).
8. Check the browser console for errors across this whole click-through
   (dashboard → Règles → edit → save → dashboard → Règles → invalid save
   → reset).

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/rules" "app/(app)/_components/nav.tsx"
git commit -m "Add /rules settings page and nav link"
```
