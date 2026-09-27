# Classification Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the rules-based invoice classification engine described in `CLAUDE.md`: pure rule functions, a DB-backed context loader, persistence of classifications, tests for all of it, and minimal updates to the home page to show the result.

**Architecture:** A pure `classify(ctx, today)` function in `lib/rules/engine.ts` runs 15 independent rule functions (`lib/rules/rules/*.ts`) over an `InvoiceContext` and aggregates their `Reason`s into a `Classification`. `lib/rules/context.ts` is the only file that touches the database, building an `InvoiceContext` from a `pending` invoice's id. `lib/rules/classify-all.ts` orchestrates: load context → classify → persist, for every pending invoice, and is wired into both `npm run seed` and a standalone `npm run classify`.

**Tech Stack:** TypeScript, `@libsql/client` (SQLite-compatible, in-memory `:memory:` for tests), Vitest, Next.js App Router.

**Spec:** `docs/superpowers/specs/2026-09-27-classification-engine-design.md`

## Global Constraints

- All thresholds live in `lib/rules/thresholds.ts` and are imported everywhere else — never inlined (per `CLAUDE.md`).
- Rules and the engine are pure: no DB access, no `Date.now()` / `new Date()` internally — `today` is always passed in as a parameter.
- `lib/rules/context.ts` is the only file in `lib/rules/` that touches the database.
- UI copy and rule messages are in French; code and comments are in English.
- Amounts are stored and computed as integer cents, HT (`amount_excl_vat_cents`) and TTC (`amount_incl_vat_cents`) in separate columns.
- Dates are stored as ISO strings (`YYYY-MM-DD`).
- Every classification carries at least one human-readable `Reason`; red always outranks orange, orange always outranks green.
- Money is formatted fr-FR/€ via `lib/format.ts`, with no cents shown once the amount is ≥ 1 000 €.
- Never use real company names, SIRENs, or IBANs — only the existing fictional seed data and generated values (`generateValidSiren`, `computeVatNumber`, `buildIban`).
- Before calling any task done: the task's own tests pass. Before calling the whole plan done: `npm test`, `npm run lint`, `npx tsc --noEmit` all pass clean.

---

### Task 1: `lib/rules/thresholds.ts`

**Files:**
- Create: `lib/rules/thresholds.ts`
- Test: `lib/rules/thresholds.test.ts`

**Interfaces:**
- Produces: `DEVIATION_ORANGE`, `DEVIATION_RED`, `NEW_SUPPLIER_AMOUNT`, `EXCEPTIONAL_AMOUNT`, `IBAN_RECENT_CHANGE_DAYS`, `RISK_WINDOW_MONTHS`, `DUPLICATE_WINDOW_DAYS`, `RECURRING_MIN_INVOICES`, `HISTORY_SAMPLE`, `RULES_VERSION` (all `number` except `RULES_VERSION: string`).

- [ ] **Step 1: Write the failing test**

```ts
// lib/rules/thresholds.test.ts
import { describe, it, expect } from "vitest";
import * as thresholds from "./thresholds";

describe("thresholds", () => {
  it("exposes every constant from the spec with the exact values", () => {
    expect(thresholds.DEVIATION_ORANGE).toBe(0.15);
    expect(thresholds.DEVIATION_RED).toBe(0.4);
    expect(thresholds.NEW_SUPPLIER_AMOUNT).toBe(500_000);
    expect(thresholds.EXCEPTIONAL_AMOUNT).toBe(5_000_000);
    expect(thresholds.IBAN_RECENT_CHANGE_DAYS).toBe(90);
    expect(thresholds.RISK_WINDOW_MONTHS).toBe(12);
    expect(thresholds.DUPLICATE_WINDOW_DAYS).toBe(60);
    expect(thresholds.RECURRING_MIN_INVOICES).toBe(3);
    expect(thresholds.HISTORY_SAMPLE).toBe(6);
    expect(thresholds.RULES_VERSION).toBe("1.0.0");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/rules/thresholds.test.ts`
Expected: FAIL — `Cannot find module './thresholds'`

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/rules/thresholds.ts

// Upward deviation vs. history/contract/peer median that pushes a classification
// to orange, and further to red. Downward deviation never triggers a reason.
export const DEVIATION_ORANGE = 0.15;
export const DEVIATION_RED = 0.4;

// Cents, HT. Orange/red split for the "new supplier" rule.
export const NEW_SUPPLIER_AMOUNT = 5_000_00;

// Cents, HT. Unconditional red trigger regardless of supplier newness.
export const EXCEPTIONAL_AMOUNT = 50_000_00;

export const IBAN_RECENT_CHANGE_DAYS = 90;
export const RISK_WINDOW_MONTHS = 12;
export const DUPLICATE_WINDOW_DAYS = 60;
export const RECURRING_MIN_INVOICES = 3;
export const HISTORY_SAMPLE = 6;

export const RULES_VERSION = "1.0.0";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/rules/thresholds.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/rules/thresholds.ts lib/rules/thresholds.test.ts
git commit -m "Add classification engine thresholds"
```

---

### Task 2: Schema additions + seed wiring (`issue_date`, `printed_vat_number`, `rules_version`)

**Files:**
- Modify: `lib/db/schema.ts` (invoices and classifications tables)
- Modify: `lib/db/seed.ts` (populate the new columns)
- Test: `lib/db/seed.test.ts` (extend)

**Interfaces:**
- Consumes: `RULES_VERSION` from Task 1 (`lib/rules/thresholds.ts`).
- Produces: `invoices.issue_date`, `invoices.printed_vat_number`, `classifications.rules_version` columns, populated for every seeded invoice/classification. Later tasks (context loader, classify-all) read these columns.

- [ ] **Step 1: Write the failing test**

Add to `lib/db/seed.test.ts` (new `describe` block, after the existing ones):

```ts
describe("seed - schema additions", () => {
  it("populates issue_date (before due_date) and printed_vat_number for every invoice", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db);
    await seed(db);

    const rows = await db.execute(
      "SELECT issue_date as issueDate, printed_vat_number as printedVatNumber, due_date as dueDate FROM invoices"
    );
    expect(rows.rows.length).toBeGreaterThan(0);
    for (const row of rows.rows) {
      expect(row.issueDate).not.toBeNull();
      expect(row.printedVatNumber).not.toBeNull();
      expect(String(row.issueDate) < String(row.dueDate)).toBe(true);
    }

    db.close();
  });

  it("stamps every classification with the current rules version", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db);
    await seed(db);

    const rows = await db.execute("SELECT rules_version as rulesVersion FROM classifications");
    expect(rows.rows.length).toBeGreaterThan(0);
    for (const row of rows.rows) {
      expect(row.rulesVersion).toBe("1.0.0");
    }

    db.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/db/seed.test.ts`
Expected: FAIL — `SQLITE_ERROR: no such column: issue_date` (or `printed_vat_number` / `rules_version`)

- [ ] **Step 3: Add the columns to the schema**

In `lib/db/schema.ts`, replace the `invoices` table definition:

```sql
CREATE TABLE invoices (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL REFERENCES entities(id),
  supplier_id TEXT NOT NULL REFERENCES suppliers(id),
  contract_id TEXT REFERENCES contracts(id),
  invoice_number TEXT NOT NULL,
  category TEXT NOT NULL,
  amount_excl_vat_cents INTEGER NOT NULL,
  amount_incl_vat_cents INTEGER NOT NULL,
  issue_date TEXT NOT NULL,
  due_date TEXT NOT NULL,
  printed_iban TEXT NOT NULL,
  printed_siren TEXT NOT NULL,
  printed_vat_number TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')) DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

And the `classifications` table definition:

```sql
CREATE TABLE classifications (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL UNIQUE REFERENCES invoices(id),
  level TEXT NOT NULL CHECK (level IN ('green', 'orange', 'red')),
  reasons TEXT NOT NULL,
  rules_version TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

- [ ] **Step 4: Update `lib/db/seed.ts` to populate the new columns**

Add the import (near the top, with the other imports):

```ts
import { RULES_VERSION } from "../rules/thresholds";
```

Update the `HistoryInvoice` interface:

```ts
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
```

Update `buildHistoryInvoices` to take a `registeredVatNumber` parameter and fill `issueDate`/`printedVatNumber`:

```ts
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
```

Update both call sites of `buildHistoryInvoices` to pass `supplier.vatNumber` before `today`:

```ts
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
```

```ts
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
```

Update the history-invoice insert loop:

```ts
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
        JSON.stringify(["Fournisseur récurrent, historique conforme au contrat."]),
        RULES_VERSION,
      ],
    });
  }
```

Update `buildPendingInvoiceStatements`'s insert loop:

```ts
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run lib/db`
Expected: PASS (all of `seed.test.ts`, `migrate.test.ts`, `queries.test.ts`)

- [ ] **Step 6: Commit**

```bash
git add lib/db/schema.ts lib/db/seed.ts lib/db/seed.test.ts
git commit -m "Add issue_date, printed_vat_number, and rules_version columns"
```

---

### Task 3: `lib/format.ts`

**Files:**
- Create: `lib/format.ts`
- Test: `lib/format.test.ts`

**Interfaces:**
- Produces: `formatEuros(cents: number): string`, `formatPercent(ratio: number): string`, `formatDateFr(iso: string): string`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/format.test.ts
import { describe, it, expect } from "vitest";
import { formatEuros, formatPercent, formatDateFr } from "./format";

describe("formatEuros", () => {
  it("shows cents below 1 000 €", () => {
    expect(formatEuros(95_000)).toBe(
      (950).toLocaleString("fr-FR", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 })
    );
  });

  it("hides cents above 1 000 €", () => {
    expect(formatEuros(420_000)).toBe(
      (4200).toLocaleString("fr-FR", { style: "currency", currency: "EUR", minimumFractionDigits: 0, maximumFractionDigits: 0 })
    );
  });

  it("hides cents at exactly 1 000 €", () => {
    expect(formatEuros(100_000)).toBe(
      (1000).toLocaleString("fr-FR", { style: "currency", currency: "EUR", minimumFractionDigits: 0, maximumFractionDigits: 0 })
    );
  });
});

describe("formatPercent", () => {
  it("rounds a ratio to the nearest whole percent", () => {
    expect(formatPercent(0.203)).toBe("20 %");
    expect(formatPercent(0.4001)).toBe("40 %");
  });
});

describe("formatDateFr", () => {
  it("formats an ISO date using the fr-FR locale", () => {
    expect(formatDateFr("2026-03-12")).toBe(new Date("2026-03-12").toLocaleDateString("fr-FR"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/format.test.ts`
Expected: FAIL — `Cannot find module './format'`

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/format.ts

export function formatEuros(cents: number): string {
  const euros = cents / 100;
  const fractionDigits = Math.abs(euros) >= 1000 ? 0 : 2;
  return euros.toLocaleString("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

export function formatPercent(ratio: number): string {
  return `${Math.round(ratio * 100)} %`;
}

export function formatDateFr(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/format.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/format.ts lib/format.test.ts
git commit -m "Add fr-FR money/percent/date formatting helpers"
```

---

### Task 4: `ibanCountryCode` in `lib/checks/iban.ts`

**Files:**
- Modify: `lib/checks/iban.ts`
- Modify: `lib/checks/iban.test.ts`

**Interfaces:**
- Produces: `ibanCountryCode(iban: string): string` — used by the `iban-foreign` rule (Task 16).

- [ ] **Step 1: Write the failing test**

Append to `lib/checks/iban.test.ts` (update the import line and add a new `describe`):

```ts
import { describe, it, expect } from "vitest";
import { buildIban, isValidIban, ibanCountryCode } from "./iban";

// ...(existing "iban" describe block stays as-is)...

describe("ibanCountryCode", () => {
  it("extracts the two-letter country code, case- and whitespace-insensitive", () => {
    expect(ibanCountryCode("FR7640100000000000001")).toBe("FR");
    expect(ibanCountryCode("de1234")).toBe("DE");
    expect(ibanCountryCode("FR76 4010 0000 0000 0000 1")).toBe("FR");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/checks/iban.test.ts`
Expected: FAIL — `ibanCountryCode is not a function` (or not exported)

- [ ] **Step 3: Write minimal implementation**

Append to `lib/checks/iban.ts`:

```ts
export function ibanCountryCode(iban: string): string {
  return iban.replace(/\s+/g, "").toUpperCase().slice(0, 2);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/checks/iban.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/checks/iban.ts lib/checks/iban.test.ts
git commit -m "Add ibanCountryCode helper"
```

---

### Task 5: `lib/rules/types.ts`

**Files:**
- Create: `lib/rules/types.ts`

**Interfaces:**
- Produces: `Level`, `ReasonCode`, `Reason`, `Classification`, `InvoiceContext` (and its nested field types) — consumed by every remaining task in `lib/rules/`.

There is no dedicated test file for this task — it's types only, no runtime behavior. The "test" is `npx tsc --noEmit` succeeding, which happens naturally once Task 7 (`test-fixtures.ts`) and Task 8 (`context.ts`) import from it in the very next steps.

- [ ] **Step 1: Write the implementation**

```ts
// lib/rules/types.ts

export type Level = "green" | "orange" | "red";

export type ReasonCode =
  | "DEVIATION_HISTORY"
  | "DEVIATION_HISTORY_HIGH"
  | "DEVIATION_CONTRACT"
  | "DEVIATION_CONTRACT_HIGH"
  | "DEVIATION_PEER"
  | "DEVIATION_PEER_HIGH"
  | "DUPLICATE_NUMBER"
  | "DUPLICATE_AMOUNT"
  | "IBAN_MISMATCH"
  | "IBAN_RECENTLY_CHANGED"
  | "IBAN_FOREIGN"
  | "IDENTITY_MISMATCH"
  | "EXCEPTIONAL_AMOUNT"
  | "NEW_SUPPLIER_SMALL"
  | "NEW_SUPPLIER_LARGE"
  | "NO_CONTRACT"
  | "UNUSUAL_CATEGORY"
  | "NOT_RECURRING"
  | "SUPPLIER_RISK"
  | "ALL_CHECKS_PASSED";

export interface Reason {
  code: ReasonCode;
  level: Level;
  message: string;
  data?: Record<string, unknown>;
}

export interface Classification {
  level: Level;
  reasons: Reason[];
}

export interface InvoiceContextInvoice {
  id: string;
  entityId: string;
  entityName: string;
  supplierId: string;
  contractId: string | null;
  invoiceNumber: string;
  category: string;
  amountExclVatCents: number;
  amountInclVatCents: number;
  dueDate: string;
  issueDate: string;
  printedIban: string;
  printedSiren: string;
  printedVatNumber: string;
}

export interface InvoiceContextSupplier {
  id: string;
  name: string;
  siren: string;
  vatNumber: string;
}

export interface IbanHistoryEntry {
  iban: string;
  effectiveFrom: string;
}

export interface RiskEventEntry {
  eventDate: string;
  description: string;
}

export interface ContractInfo {
  id: string;
  category: string;
  expectedAmountCents: number | null;
}

export interface GroupApprovedInvoice {
  entityId: string;
  entityName: string;
  category: string;
  amountExclVatCents: number;
  dueDate: string;
}

export interface OtherSupplierInvoice {
  id: string;
  invoiceNumber: string;
  status: string;
  amountInclVatCents: number;
  issueDate: string;
  entityId: string;
}

export interface InvoiceContext {
  invoice: InvoiceContextInvoice;
  supplier: InvoiceContextSupplier;
  ibanHistory: IbanHistoryEntry[];
  riskEvents: RiskEventEntry[];
  contract: ContractInfo | null;
  groupApprovedInvoices: GroupApprovedInvoice[];
  subsidiaryApprovedCategories: string[];
  otherSupplierInvoices: OtherSupplierInvoice[];
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/rules/types.ts
git commit -m "Add classification engine types"
```

---

### Task 6: `lib/rules/stats.ts`

**Files:**
- Create: `lib/rules/stats.ts`
- Test: `lib/rules/stats.test.ts`

**Interfaces:**
- Produces: `median(values: number[]): number | null` — consumed by the three deviation rules (Tasks 9-11).

- [ ] **Step 1: Write the failing test**

```ts
// lib/rules/stats.test.ts
import { describe, it, expect } from "vitest";
import { median } from "./stats";

describe("median", () => {
  it("returns null for an empty array", () => {
    expect(median([])).toBeNull();
  });

  it("returns the middle value for an odd-length array, regardless of input order", () => {
    expect(median([5, 1, 3])).toBe(3);
  });

  it("averages the two middle values for an even-length array", () => {
    expect(median([10, 20, 30, 40])).toBe(25);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/rules/stats.test.ts`
Expected: FAIL — `Cannot find module './stats'`

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/rules/stats.ts

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/rules/stats.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/rules/stats.ts lib/rules/stats.test.ts
git commit -m "Add median helper for deviation rules"
```

---

### Task 7: `lib/rules/test-fixtures.ts` (shared rule-test fixture)

**Files:**
- Create: `lib/rules/test-fixtures.ts`
- Test: `lib/rules/test-fixtures.test.ts`

**Interfaces:**
- Consumes: `InvoiceContext` (Task 5), `generateValidSiren` / `computeVatNumber` / `buildIban` (existing `lib/checks/*`).
- Produces: `buildContext(overrides?: ContextOverrides): InvoiceContext` — a context that passes every rule by default (known supplier, matching contract, 6 months of matching history, no IBAN/identity/risk issues). Every rule test (Tasks 9-23) and the engine test (Task 24) build on this.

The default context returned by `buildContext()`: `invoice.amountExclVatCents` (100 000) exactly matches both `contract.expectedAmountCents` (100 000) and the median of `groupApprovedInvoices` (6 entries at 100 000) — so no deviation rule fires; `groupApprovedInvoices` has 6 entries at this same entity, so `NEW_SUPPLIER_*` and `NOT_RECURRING` don't fire; `invoice.category` is in `subsidiaryApprovedCategories`; `invoice.contractId` is non-null; the printed IBAN/SIREN/VAT all match the registry; `riskEvents` is empty.

- [ ] **Step 1: Write the failing test**

```ts
// lib/rules/test-fixtures.test.ts
import { describe, it, expect } from "vitest";
import { buildContext } from "./test-fixtures";

describe("buildContext", () => {
  it("builds a self-consistent default context with 6 months of matching history", () => {
    const ctx = buildContext();
    expect(ctx.invoice.category).toBe(ctx.contract?.category);
    expect(ctx.groupApprovedInvoices).toHaveLength(6);
    expect(ctx.supplier.siren).toBe(ctx.invoice.printedSiren);
    expect(ctx.supplier.vatNumber).toBe(ctx.invoice.printedVatNumber);
  });

  it("allows overriding a single invoice field without losing the rest", () => {
    const ctx = buildContext({ invoice: { amountExclVatCents: 999 } });
    expect(ctx.invoice.amountExclVatCents).toBe(999);
    expect(ctx.invoice.category).toBe("maintenance");
  });

  it("allows explicitly overriding contract to null", () => {
    const ctx = buildContext({ contract: null });
    expect(ctx.contract).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/rules/test-fixtures.test.ts`
Expected: FAIL — `Cannot find module './test-fixtures'`

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/rules/test-fixtures.ts
import { generateValidSiren } from "../checks/siren";
import { computeVatNumber } from "../checks/vat";
import { buildIban } from "../checks/iban";
import type { InvoiceContext } from "./types";

const DEFAULT_SIREN = generateValidSiren("55210055");
const DEFAULT_VAT = computeVatNumber(DEFAULT_SIREN);
const DEFAULT_IBAN = buildIban("FR", "40100000010000000001200");

const DEFAULT_HISTORY_DUE_DATES = [
  "2025-10-15",
  "2025-11-15",
  "2025-12-15",
  "2026-01-15",
  "2026-02-15",
  "2026-03-15",
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
}

export function buildContext(overrides: ContextOverrides = {}): InvoiceContext {
  const invoice = {
    id: "inv-1",
    entityId: "ent-1",
    entityName: "Filiale Test",
    supplierId: "sup-1",
    contractId: "con-1",
    invoiceNumber: "INV-001",
    category: "maintenance",
    amountExclVatCents: 100_000,
    amountInclVatCents: 120_000,
    dueDate: "2026-06-30",
    issueDate: "2026-05-31",
    printedIban: DEFAULT_IBAN,
    printedSiren: DEFAULT_SIREN,
    printedVatNumber: DEFAULT_VAT,
    ...overrides.invoice,
  };

  return {
    invoice,
    supplier: {
      id: "sup-1",
      name: "Fournisseur Test",
      siren: DEFAULT_SIREN,
      vatNumber: DEFAULT_VAT,
      ...overrides.supplier,
    },
    ibanHistory: overrides.ibanHistory ?? [{ iban: DEFAULT_IBAN, effectiveFrom: "2024-01-01" }],
    riskEvents: overrides.riskEvents ?? [],
    contract:
      overrides.contract !== undefined
        ? overrides.contract
        : { id: "con-1", category: invoice.category, expectedAmountCents: 100_000 },
    groupApprovedInvoices:
      overrides.groupApprovedInvoices ??
      DEFAULT_HISTORY_DUE_DATES.map((dueDate) => ({
        entityId: invoice.entityId,
        entityName: invoice.entityName,
        category: invoice.category,
        amountExclVatCents: 100_000,
        dueDate,
      })),
    subsidiaryApprovedCategories: overrides.subsidiaryApprovedCategories ?? [invoice.category],
    otherSupplierInvoices: overrides.otherSupplierInvoices ?? [],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/rules/test-fixtures.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/rules/test-fixtures.ts lib/rules/test-fixtures.test.ts
git commit -m "Add shared rule-test context fixture"
```

---

### Task 8: `lib/rules/context.ts`

**Files:**
- Create: `lib/rules/context.ts`
- Test: `lib/rules/context.test.ts`

**Interfaces:**
- Consumes: `InvoiceContext` (Task 5), `RISK_WINDOW_MONTHS` (Task 1), the seeded DB (Task 2's schema, `lib/db/migrate.ts`, `lib/db/seed.ts`).
- Produces: `loadContext(db: Client, invoiceId: string, today: Date): Promise<InvoiceContext>` — consumed by `classify-all.ts` (Task 25).

- [ ] **Step 1: Write the failing test**

```ts
// lib/rules/context.test.ts
import { describe, it, expect } from "vitest";
import { createClient } from "@libsql/client";
import { migrate } from "../db/migrate";
import { seed } from "../db/seed";
import { loadContext } from "./context";

describe("loadContext", () => {
  it("loads the full context for a known pending invoice with a contract and group-wide history", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db);
    await seed(db);

    // Use the real current time, matching what seed() used internally to
    // generate the 12 months of history — see the "12-month boundary" note
    // in the Global Constraints / ledger for why groupApprovedInvoices is
    // asserted with a range rather than an exact 12: seed's history dates
    // are pinned to the 15th of each month, so whenever this test happens
    // to run after the 15th of the current month, the oldest (12-months-ago)
    // entry falls just outside the "last 12 months" cutoff and is correctly
    // excluded — that's the context loader working as specified, not a bug.
    const today = new Date();
    const ctx = await loadContext(db, "inv-pending-novalink", today);

    expect(ctx.invoice.invoiceNumber).toBe("PEND-NOVALINK-01");
    expect(ctx.invoice.entityName).toBe("Arcadia Télécom");
    expect(ctx.supplier.name).toBe("NovaLink Télécom");
    expect(ctx.contract?.id).toBe("con-novalink-telecom");
    expect(ctx.groupApprovedInvoices.length).toBeGreaterThanOrEqual(11);
    expect(ctx.groupApprovedInvoices.length).toBeLessThanOrEqual(12);
    expect(ctx.subsidiaryApprovedCategories).toContain("telecom_maintenance");
    expect(ctx.otherSupplierInvoices).toHaveLength(12);
    expect(ctx.ibanHistory.length).toBeGreaterThanOrEqual(1);

    db.close();
  });

  it("returns an empty group history and a null contract for a supplier with neither", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db);
    await seed(db);

    const ctx = await loadContext(db, "inv-pending-pixelforge", new Date());

    expect(ctx.invoice.contractId).toBeNull();
    expect(ctx.contract).toBeNull();
    expect(ctx.groupApprovedInvoices).toHaveLength(0);

    db.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/rules/context.test.ts`
Expected: FAIL — `Cannot find module './context'`

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/rules/context.ts
import "server-only";
import type { Client } from "@libsql/client";
import { RISK_WINDOW_MONTHS } from "./thresholds";
import type { InvoiceContext } from "./types";

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
        invoices.printed_vat_number AS printedVatNumber
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
  };

  const cutoff = monthsAgoIso(today, RISK_WINDOW_MONTHS);
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
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/rules/context.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/rules/context.ts lib/rules/context.test.ts
git commit -m "Add DB-backed InvoiceContext loader"
```

---

### Task 9: Rule — `deviation-history`

**Files:**
- Create: `lib/rules/rules/deviation-history.ts`
- Test: `lib/rules/rules/deviation-history.test.ts`

**Interfaces:**
- Consumes: `InvoiceContext`, `Reason` (Task 5); `median` (Task 6); `DEVIATION_ORANGE`, `DEVIATION_RED`, `HISTORY_SAMPLE` (Task 1); `formatEuros`, `formatPercent` (Task 3); `buildContext` (Task 7, test only).
- Produces: `export default function deviationHistoryRule(ctx: InvoiceContext): Reason | null` — consumed by the engine (Task 24).

- [ ] **Step 1: Write the failing test**

```ts
// lib/rules/rules/deviation-history.test.ts
import { describe, it, expect } from "vitest";
import { buildContext } from "../test-fixtures";
import deviationHistoryRule from "./deviation-history";

describe("deviation-history rule", () => {
  it("returns orange when the amount is 20% above the historical median", () => {
    const ctx = buildContext({ invoice: { amountExclVatCents: 120_000 } });
    const reason = deviationHistoryRule(ctx);
    expect(reason?.code).toBe("DEVIATION_HISTORY");
    expect(reason?.level).toBe("orange");
  });

  it("returns red when the amount is 50% above the historical median", () => {
    const ctx = buildContext({ invoice: { amountExclVatCents: 150_000 } });
    const reason = deviationHistoryRule(ctx);
    expect(reason?.code).toBe("DEVIATION_HISTORY_HIGH");
    expect(reason?.level).toBe("red");
  });

  it("does not trigger at exactly the orange threshold (15%)", () => {
    const ctx = buildContext({ invoice: { amountExclVatCents: 115_000 } });
    expect(deviationHistoryRule(ctx)).toBeNull();
  });

  it("does not trigger when there is no history for this entity/category", () => {
    const ctx = buildContext({
      invoice: { amountExclVatCents: 500_000 },
      groupApprovedInvoices: [
        {
          entityId: "ent-other",
          entityName: "Autre filiale",
          category: "maintenance",
          amountExclVatCents: 100_000,
          dueDate: "2026-01-15",
        },
      ],
    });
    expect(deviationHistoryRule(ctx)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/rules/rules/deviation-history.test.ts`
Expected: FAIL — `Cannot find module './deviation-history'`

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/rules/rules/deviation-history.ts
import type { InvoiceContext, Reason } from "../types";
import { median } from "../stats";
import { DEVIATION_ORANGE, DEVIATION_RED, HISTORY_SAMPLE } from "../thresholds";
import { formatEuros, formatPercent } from "../../format";

export default function deviationHistoryRule(ctx: InvoiceContext): Reason | null {
  const sample = ctx.groupApprovedInvoices
    .filter((i) => i.entityId === ctx.invoice.entityId && i.category === ctx.invoice.category)
    .slice(0, HISTORY_SAMPLE)
    .map((i) => i.amountExclVatCents);

  const baseline = median(sample);
  if (baseline === null || baseline === 0) return null;

  const amount = ctx.invoice.amountExclVatCents;
  const deviation = (amount - baseline) / baseline;
  if (deviation <= DEVIATION_ORANGE) return null;

  const message = `Montant ${formatEuros(amount)} HT, ${formatPercent(deviation)} au-dessus de l'historique (médiane ${formatEuros(baseline)} HT sur ${sample.length} factures)`;
  const data = {
    amountExclVatCents: amount,
    medianExclVatCents: baseline,
    deviationPct: deviation,
    sampleCount: sample.length,
  };

  if (deviation > DEVIATION_RED) {
    return { code: "DEVIATION_HISTORY_HIGH", level: "red", message, data };
  }
  return { code: "DEVIATION_HISTORY", level: "orange", message, data };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/rules/rules/deviation-history.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/rules/rules/deviation-history.ts lib/rules/rules/deviation-history.test.ts
git commit -m "Add deviation-history rule"
```

---

### Task 10: Rule — `deviation-contract`

**Files:**
- Create: `lib/rules/rules/deviation-contract.ts`
- Test: `lib/rules/rules/deviation-contract.test.ts`

**Interfaces:**
- Consumes: same as Task 9, minus `median`/`HISTORY_SAMPLE`.
- Produces: `export default function deviationContractRule(ctx: InvoiceContext): Reason | null`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/rules/rules/deviation-contract.test.ts
import { describe, it, expect } from "vitest";
import { buildContext } from "../test-fixtures";
import deviationContractRule from "./deviation-contract";

describe("deviation-contract rule", () => {
  it("returns orange when the amount is 20% above the contract's expected amount", () => {
    const ctx = buildContext({ invoice: { amountExclVatCents: 120_000 } });
    const reason = deviationContractRule(ctx);
    expect(reason?.code).toBe("DEVIATION_CONTRACT");
    expect(reason?.level).toBe("orange");
  });

  it("returns red when the amount is 50% above the contract's expected amount", () => {
    const ctx = buildContext({ invoice: { amountExclVatCents: 150_000 } });
    const reason = deviationContractRule(ctx);
    expect(reason?.code).toBe("DEVIATION_CONTRACT_HIGH");
    expect(reason?.level).toBe("red");
  });

  it("does not trigger at exactly the orange threshold (15%)", () => {
    const ctx = buildContext({ invoice: { amountExclVatCents: 115_000 } });
    expect(deviationContractRule(ctx)).toBeNull();
  });

  it("does not trigger when there is no contract", () => {
    const ctx = buildContext({ invoice: { amountExclVatCents: 500_000, contractId: null }, contract: null });
    expect(deviationContractRule(ctx)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/rules/rules/deviation-contract.test.ts`
Expected: FAIL — `Cannot find module './deviation-contract'`

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/rules/rules/deviation-contract.ts
import type { InvoiceContext, Reason } from "../types";
import { DEVIATION_ORANGE, DEVIATION_RED } from "../thresholds";
import { formatEuros, formatPercent } from "../../format";

export default function deviationContractRule(ctx: InvoiceContext): Reason | null {
  const expected = ctx.contract?.expectedAmountCents;
  if (expected === null || expected === undefined || expected === 0) return null;

  const amount = ctx.invoice.amountExclVatCents;
  const deviation = (amount - expected) / expected;
  if (deviation <= DEVIATION_ORANGE) return null;

  const message = `Montant ${formatEuros(amount)} HT, ${formatPercent(deviation)} au-dessus du contrat (${formatEuros(expected)} HT attendu)`;
  const data = { amountExclVatCents: amount, expectedAmountCents: expected, deviationPct: deviation };

  if (deviation > DEVIATION_RED) {
    return { code: "DEVIATION_CONTRACT_HIGH", level: "red", message, data };
  }
  return { code: "DEVIATION_CONTRACT", level: "orange", message, data };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/rules/rules/deviation-contract.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/rules/rules/deviation-contract.ts lib/rules/rules/deviation-contract.test.ts
git commit -m "Add deviation-contract rule"
```

---

### Task 11: Rule — `deviation-peer`

**Files:**
- Create: `lib/rules/rules/deviation-peer.ts`
- Test: `lib/rules/rules/deviation-peer.test.ts`

**Interfaces:**
- Consumes: same as Task 9.
- Produces: `export default function deviationPeerRule(ctx: InvoiceContext): Reason | null`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/rules/rules/deviation-peer.test.ts
import { describe, it, expect } from "vitest";
import { buildContext } from "../test-fixtures";
import deviationPeerRule from "./deviation-peer";

const peersAt = (entityId: string, entityName: string, amountExclVatCents: number) => [
  { entityId, entityName, category: "maintenance", amountExclVatCents, dueDate: "2026-01-15" },
  { entityId, entityName, category: "maintenance", amountExclVatCents, dueDate: "2026-02-15" },
];

describe("deviation-peer rule", () => {
  it("returns orange when the amount is 20% above the median at other subsidiaries", () => {
    const ctx = buildContext({
      invoice: { amountExclVatCents: 120_000 },
      groupApprovedInvoices: peersAt("ent-other", "Filiale Voisine", 100_000),
    });
    const reason = deviationPeerRule(ctx);
    expect(reason?.code).toBe("DEVIATION_PEER");
    expect(reason?.level).toBe("orange");
  });

  it("returns red when the amount is 2x the median at other subsidiaries", () => {
    const ctx = buildContext({
      invoice: { amountExclVatCents: 200_000 },
      groupApprovedInvoices: peersAt("ent-other", "Filiale Voisine", 100_000),
    });
    const reason = deviationPeerRule(ctx);
    expect(reason?.code).toBe("DEVIATION_PEER_HIGH");
    expect(reason?.level).toBe("red");
  });

  it("does not trigger at exactly the orange threshold (15%)", () => {
    const ctx = buildContext({
      invoice: { amountExclVatCents: 115_000 },
      groupApprovedInvoices: peersAt("ent-other", "Filiale Voisine", 100_000),
    });
    expect(deviationPeerRule(ctx)).toBeNull();
  });

  it("does not trigger when there are no peers at other subsidiaries", () => {
    const ctx = buildContext({
      invoice: { amountExclVatCents: 500_000 },
      groupApprovedInvoices: peersAt("ent-1", "Filiale Test", 100_000),
    });
    expect(deviationPeerRule(ctx)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/rules/rules/deviation-peer.test.ts`
Expected: FAIL — `Cannot find module './deviation-peer'`

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/rules/rules/deviation-peer.ts
import type { InvoiceContext, Reason } from "../types";
import { median } from "../stats";
import { DEVIATION_ORANGE, DEVIATION_RED } from "../thresholds";
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
  if (deviation <= DEVIATION_ORANGE) return null;

  const otherEntities = [...new Set(peers.map((i) => i.entityName))];
  const message = `Montant ${formatEuros(amount)} HT, ${formatPercent(deviation)} au-dessus des autres filiales (${otherEntities.join(", ")} : médiane ${formatEuros(baseline)} HT)`;
  const data = {
    amountExclVatCents: amount,
    medianExclVatCents: baseline,
    deviationPct: deviation,
    otherEntities,
  };

  if (deviation > DEVIATION_RED) {
    return { code: "DEVIATION_PEER_HIGH", level: "red", message, data };
  }
  return { code: "DEVIATION_PEER", level: "orange", message, data };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/rules/rules/deviation-peer.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/rules/rules/deviation-peer.ts lib/rules/rules/deviation-peer.test.ts
git commit -m "Add deviation-peer rule"
```

---

### Task 12: Rule — `duplicate-number`

**Files:**
- Create: `lib/rules/rules/duplicate-number.ts`
- Test: `lib/rules/rules/duplicate-number.test.ts`

**Interfaces:**
- Consumes: `InvoiceContext`, `Reason` (Task 5); `formatDateFr` (Task 3).
- Produces: `export default function duplicateNumberRule(ctx: InvoiceContext): Reason | null`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/rules/rules/duplicate-number.test.ts
import { describe, it, expect } from "vitest";
import { buildContext } from "../test-fixtures";
import duplicateNumberRule from "./duplicate-number";

describe("duplicate-number rule", () => {
  it("returns red when another invoice from the same supplier shares the invoice number", () => {
    const ctx = buildContext({
      otherSupplierInvoices: [
        {
          id: "inv-other",
          invoiceNumber: "INV-001",
          status: "approved",
          amountInclVatCents: 120_000,
          issueDate: "2026-03-01",
          entityId: "ent-1",
        },
      ],
    });
    const reason = duplicateNumberRule(ctx);
    expect(reason?.code).toBe("DUPLICATE_NUMBER");
    expect(reason?.level).toBe("red");
  });

  it("does not trigger when no other invoice shares the number", () => {
    const ctx = buildContext({
      otherSupplierInvoices: [
        {
          id: "inv-other",
          invoiceNumber: "INV-002",
          status: "approved",
          amountInclVatCents: 120_000,
          issueDate: "2026-03-01",
          entityId: "ent-1",
        },
      ],
    });
    expect(duplicateNumberRule(ctx)).toBeNull();
  });

  it("does not trigger when there are no other invoices from this supplier", () => {
    const ctx = buildContext({ otherSupplierInvoices: [] });
    expect(duplicateNumberRule(ctx)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/rules/rules/duplicate-number.test.ts`
Expected: FAIL — `Cannot find module './duplicate-number'`

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/rules/rules/duplicate-number.ts
import type { InvoiceContext, Reason } from "../types";
import { formatDateFr } from "../../format";

export default function duplicateNumberRule(ctx: InvoiceContext): Reason | null {
  const match = ctx.otherSupplierInvoices.find((i) => i.invoiceNumber === ctx.invoice.invoiceNumber);
  if (!match) return null;

  const statusLabel = match.status === "approved" ? "validée le" : `statut ${match.status}, émise le`;
  const message = `Même numéro de facture que ${match.invoiceNumber}, ${statusLabel} ${formatDateFr(match.issueDate)}`;
  return {
    code: "DUPLICATE_NUMBER",
    level: "red",
    message,
    data: { otherInvoiceId: match.id, otherInvoiceNumber: match.invoiceNumber, otherStatus: match.status },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/rules/rules/duplicate-number.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/rules/rules/duplicate-number.ts lib/rules/rules/duplicate-number.test.ts
git commit -m "Add duplicate-number rule"
```

---

### Task 13: Rule — `duplicate-amount`

**Files:**
- Create: `lib/rules/rules/duplicate-amount.ts`
- Test: `lib/rules/rules/duplicate-amount.test.ts`

**Interfaces:**
- Consumes: `InvoiceContext`, `Reason` (Task 5); `DUPLICATE_WINDOW_DAYS` (Task 1); `formatEuros` (Task 3).
- Produces: `export default function duplicateAmountRule(ctx: InvoiceContext): Reason | null`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/rules/rules/duplicate-amount.test.ts
import { describe, it, expect } from "vitest";
import { buildContext } from "../test-fixtures";
import duplicateAmountRule from "./duplicate-amount";

describe("duplicate-amount rule", () => {
  it("returns red for a same-amount, same-subsidiary invoice issued 10 days apart", () => {
    const ctx = buildContext({
      invoice: { issueDate: "2026-05-31", amountInclVatCents: 120_000 },
      otherSupplierInvoices: [
        {
          id: "inv-other",
          invoiceNumber: "INV-999",
          status: "approved",
          amountInclVatCents: 120_000,
          issueDate: "2026-05-21",
          entityId: "ent-1",
        },
      ],
    });
    const reason = duplicateAmountRule(ctx);
    expect(reason?.code).toBe("DUPLICATE_AMOUNT");
    expect(reason?.level).toBe("red");
  });

  it("does not trigger when the matching amount is issued outside the 60-day window", () => {
    const ctx = buildContext({
      invoice: { issueDate: "2026-05-31", amountInclVatCents: 120_000 },
      otherSupplierInvoices: [
        {
          id: "inv-other",
          invoiceNumber: "INV-999",
          status: "approved",
          amountInclVatCents: 120_000,
          issueDate: "2026-03-01",
          entityId: "ent-1",
        },
      ],
    });
    expect(duplicateAmountRule(ctx)).toBeNull();
  });

  it("does not trigger when the amount matches but the subsidiary differs", () => {
    const ctx = buildContext({
      invoice: { issueDate: "2026-05-31", amountInclVatCents: 120_000 },
      otherSupplierInvoices: [
        {
          id: "inv-other",
          invoiceNumber: "INV-999",
          status: "approved",
          amountInclVatCents: 120_000,
          issueDate: "2026-05-21",
          entityId: "ent-other",
        },
      ],
    });
    expect(duplicateAmountRule(ctx)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/rules/rules/duplicate-amount.test.ts`
Expected: FAIL — `Cannot find module './duplicate-amount'`

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/rules/rules/duplicate-amount.ts
import type { InvoiceContext, Reason } from "../types";
import { DUPLICATE_WINDOW_DAYS } from "../thresholds";
import { formatEuros } from "../../format";

const DAY_MS = 24 * 60 * 60 * 1000;

function daysBetween(a: string, b: string): number {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / DAY_MS;
}

export default function duplicateAmountRule(ctx: InvoiceContext): Reason | null {
  const match = ctx.otherSupplierInvoices.find(
    (i) =>
      i.entityId === ctx.invoice.entityId &&
      i.amountInclVatCents === ctx.invoice.amountInclVatCents &&
      daysBetween(i.issueDate, ctx.invoice.issueDate) <= DUPLICATE_WINDOW_DAYS
  );
  if (!match) return null;

  const days = Math.round(daysBetween(match.issueDate, ctx.invoice.issueDate));
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

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/rules/rules/duplicate-amount.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/rules/rules/duplicate-amount.ts lib/rules/rules/duplicate-amount.test.ts
git commit -m "Add duplicate-amount rule"
```

---

### Task 14: Rule — `iban-mismatch`

**Files:**
- Create: `lib/rules/rules/iban-mismatch.ts`
- Test: `lib/rules/rules/iban-mismatch.test.ts`

**Interfaces:**
- Consumes: `InvoiceContext`, `Reason` (Task 5).
- Produces: `export default function ibanMismatchRule(ctx: InvoiceContext): Reason | null`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/rules/rules/iban-mismatch.test.ts
import { describe, it, expect } from "vitest";
import { buildContext } from "../test-fixtures";
import ibanMismatchRule from "./iban-mismatch";

describe("iban-mismatch rule", () => {
  it("returns red when the printed IBAN differs from the current registered one", () => {
    const ctx = buildContext({
      invoice: { printedIban: "FR7630001007941234567890185" },
      ibanHistory: [{ iban: "FR1420041010050500013M02606", effectiveFrom: "2024-01-01" }],
    });
    const reason = ibanMismatchRule(ctx);
    expect(reason?.code).toBe("IBAN_MISMATCH");
    expect(reason?.level).toBe("red");
  });

  it("does not trigger when the printed IBAN matches the current registered one", () => {
    const ctx = buildContext({
      invoice: { printedIban: "FR1420041010050500013M02606" },
      ibanHistory: [{ iban: "FR1420041010050500013M02606", effectiveFrom: "2024-01-01" }],
    });
    expect(ibanMismatchRule(ctx)).toBeNull();
  });

  it("does not trigger when there is no IBAN history", () => {
    const ctx = buildContext({ ibanHistory: [] });
    expect(ibanMismatchRule(ctx)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/rules/rules/iban-mismatch.test.ts`
Expected: FAIL — `Cannot find module './iban-mismatch'`

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/rules/rules/iban-mismatch.ts
import type { InvoiceContext, Reason } from "../types";

export default function ibanMismatchRule(ctx: InvoiceContext): Reason | null {
  const current = ctx.ibanHistory[0];
  if (!current) return null;
  if (ctx.invoice.printedIban === current.iban) return null;

  const mask = (iban: string) => iban.slice(-4);
  const message = `IBAN imprimé différent de l'IBAN enregistré (…${mask(ctx.invoice.printedIban)} vs …${mask(current.iban)})`;
  return {
    code: "IBAN_MISMATCH",
    level: "red",
    message,
    data: { printedIban: ctx.invoice.printedIban, registeredIban: current.iban },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/rules/rules/iban-mismatch.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/rules/rules/iban-mismatch.ts lib/rules/rules/iban-mismatch.test.ts
git commit -m "Add iban-mismatch rule"
```

---

### Task 15: Rule — `iban-recently-changed`

**Files:**
- Create: `lib/rules/rules/iban-recently-changed.ts`
- Test: `lib/rules/rules/iban-recently-changed.test.ts`

**Interfaces:**
- Consumes: `InvoiceContext`, `Reason` (Task 5); `IBAN_RECENT_CHANGE_DAYS` (Task 1).
- Produces: `export default function ibanRecentlyChangedRule(ctx: InvoiceContext, today: Date): Reason | null`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/rules/rules/iban-recently-changed.test.ts
import { describe, it, expect } from "vitest";
import { buildContext } from "../test-fixtures";
import ibanRecentlyChangedRule from "./iban-recently-changed";

const TODAY = new Date("2026-06-15");

describe("iban-recently-changed rule", () => {
  it("returns red when the current IBAN took effect 5 days ago", () => {
    const ctx = buildContext({
      ibanHistory: [
        { iban: "FR1420041010050500013M02606", effectiveFrom: "2026-06-10" },
        { iban: "FR7630001007941234567890185", effectiveFrom: "2024-01-01" },
      ],
    });
    const reason = ibanRecentlyChangedRule(ctx, TODAY);
    expect(reason?.code).toBe("IBAN_RECENTLY_CHANGED");
    expect(reason?.level).toBe("red");
    expect(reason?.data?.daysAgo).toBe(5);
  });

  it("does not trigger when the current IBAN has been effective for over 90 days", () => {
    const ctx = buildContext({
      ibanHistory: [{ iban: "FR1420041010050500013M02606", effectiveFrom: "2024-01-01" }],
    });
    expect(ibanRecentlyChangedRule(ctx, TODAY)).toBeNull();
  });

  it("does not trigger at exactly 90 days after the change", () => {
    const ctx = buildContext({
      ibanHistory: [{ iban: "FR1420041010050500013M02606", effectiveFrom: "2026-03-17" }],
    });
    // 2026-03-17 -> 2026-06-15 is exactly 90 days.
    expect(ibanRecentlyChangedRule(ctx, TODAY)).not.toBeNull();
    const justOver = ibanRecentlyChangedRule(ctx, new Date("2026-06-16"));
    expect(justOver).toBeNull();
  });

  it("does not trigger when there is no IBAN history", () => {
    const ctx = buildContext({ ibanHistory: [] });
    expect(ibanRecentlyChangedRule(ctx, TODAY)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/rules/rules/iban-recently-changed.test.ts`
Expected: FAIL — `Cannot find module './iban-recently-changed'`

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/rules/rules/iban-recently-changed.ts
import type { InvoiceContext, Reason } from "../types";
import { IBAN_RECENT_CHANGE_DAYS } from "../thresholds";

const DAY_MS = 24 * 60 * 60 * 1000;

export default function ibanRecentlyChangedRule(ctx: InvoiceContext, today: Date): Reason | null {
  const current = ctx.ibanHistory[0];
  if (!current) return null;

  const daysAgo = Math.round((today.getTime() - new Date(current.effectiveFrom).getTime()) / DAY_MS);
  if (daysAgo < 0 || daysAgo > IBAN_RECENT_CHANGE_DAYS) return null;

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

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/rules/rules/iban-recently-changed.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/rules/rules/iban-recently-changed.ts lib/rules/rules/iban-recently-changed.test.ts
git commit -m "Add iban-recently-changed rule"
```

---

### Task 16: Rule — `iban-foreign`

**Files:**
- Create: `lib/rules/rules/iban-foreign.ts`
- Test: `lib/rules/rules/iban-foreign.test.ts`

**Interfaces:**
- Consumes: `InvoiceContext`, `Reason` (Task 5); `ibanCountryCode` (Task 4).
- Produces: `export default function ibanForeignRule(ctx: InvoiceContext): Reason | null`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/rules/rules/iban-foreign.test.ts
import { describe, it, expect } from "vitest";
import { buildContext } from "../test-fixtures";
import ibanForeignRule from "./iban-foreign";

describe("iban-foreign rule", () => {
  it("returns red when the printed IBAN is not French", () => {
    const ctx = buildContext({ invoice: { printedIban: "DE89370400440532013000" } });
    const reason = ibanForeignRule(ctx);
    expect(reason?.code).toBe("IBAN_FOREIGN");
    expect(reason?.level).toBe("red");
    expect(reason?.data?.countryCode).toBe("DE");
  });

  it("does not trigger for a French IBAN", () => {
    const ctx = buildContext({ invoice: { printedIban: "FR1420041010050500013M02606" } });
    expect(ibanForeignRule(ctx)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/rules/rules/iban-foreign.test.ts`
Expected: FAIL — `Cannot find module './iban-foreign'`

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/rules/rules/iban-foreign.ts
import type { InvoiceContext, Reason } from "../types";
import { ibanCountryCode } from "../../checks/iban";

export default function ibanForeignRule(ctx: InvoiceContext): Reason | null {
  const countryCode = ibanCountryCode(ctx.invoice.printedIban);
  if (countryCode === "FR") return null;

  const message = `IBAN étranger (${countryCode}) pour un fournisseur français`;
  return {
    code: "IBAN_FOREIGN",
    level: "red",
    message,
    data: { countryCode, printedIban: ctx.invoice.printedIban },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/rules/rules/iban-foreign.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/rules/rules/iban-foreign.ts lib/rules/rules/iban-foreign.test.ts
git commit -m "Add iban-foreign rule"
```

---

### Task 17: Rule — `identity-mismatch`

**Files:**
- Create: `lib/rules/rules/identity-mismatch.ts`
- Test: `lib/rules/rules/identity-mismatch.test.ts`

**Interfaces:**
- Consumes: `InvoiceContext`, `Reason` (Task 5); `computeVatKey` (existing `lib/checks/vat.ts`).
- Produces: `export default function identityMismatchRule(ctx: InvoiceContext): Reason | null`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/rules/rules/identity-mismatch.test.ts
import { describe, it, expect } from "vitest";
import { generateValidSiren } from "../../checks/siren";
import { computeVatNumber } from "../../checks/vat";
import { buildContext } from "../test-fixtures";
import identityMismatchRule from "./identity-mismatch";

describe("identity-mismatch rule", () => {
  it("returns red when the printed SIREN differs from the registry", () => {
    const otherSiren = generateValidSiren("40000099");
    const ctx = buildContext({ invoice: { printedSiren: otherSiren } });
    const reason = identityMismatchRule(ctx);
    expect(reason?.code).toBe("IDENTITY_MISMATCH");
    expect(reason?.level).toBe("red");
    expect(reason?.data?.sirenMismatch).toBe(true);
  });

  it("returns red when the printed VAT number differs from the registry", () => {
    const otherVat = computeVatNumber(generateValidSiren("40000099"));
    const ctx = buildContext({ invoice: { printedVatNumber: otherVat } });
    const reason = identityMismatchRule(ctx);
    expect(reason?.code).toBe("IDENTITY_MISMATCH");
    expect(reason?.data?.vatMismatch).toBe(true);
  });

  it("returns red when the VAT key is inconsistent with the printed SIREN", () => {
    const ctx = buildContext({ invoice: { printedVatNumber: "FR00999999999" } });
    const reason = identityMismatchRule(ctx);
    expect(reason?.code).toBe("IDENTITY_MISMATCH");
    expect(reason?.data?.keyInconsistent).toBe(true);
  });

  it("does not trigger when SIREN and VAT both match the registry", () => {
    const ctx = buildContext();
    expect(identityMismatchRule(ctx)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/rules/rules/identity-mismatch.test.ts`
Expected: FAIL — `Cannot find module './identity-mismatch'`

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/rules/rules/identity-mismatch.ts
import type { InvoiceContext, Reason } from "../types";
import { computeVatKey } from "../../checks/vat";

export default function identityMismatchRule(ctx: InvoiceContext): Reason | null {
  const { printedSiren, printedVatNumber } = ctx.invoice;
  const { siren, vatNumber } = ctx.supplier;

  const sirenMismatch = printedSiren !== siren;
  const vatMismatch = printedVatNumber !== vatNumber;
  let keyInconsistent = false;
  if (/^\d{9}$/.test(printedSiren)) {
    const expectedKey = computeVatKey(printedSiren);
    const printedKey = printedVatNumber.slice(2, 4);
    keyInconsistent = expectedKey !== printedKey;
  }

  if (!sirenMismatch && !vatMismatch && !keyInconsistent) return null;

  let message: string;
  if (sirenMismatch) {
    message = `SIREN imprimé (${printedSiren}) différent du registre (${siren})`;
  } else if (vatMismatch) {
    message = `Numéro de TVA imprimé (${printedVatNumber}) différent du registre (${vatNumber})`;
  } else {
    message = `Clé de TVA incohérente avec le SIREN imprimé (${printedSiren})`;
  }

  return {
    code: "IDENTITY_MISMATCH",
    level: "red",
    message,
    data: {
      printedSiren,
      registrySiren: siren,
      printedVatNumber,
      registryVatNumber: vatNumber,
      sirenMismatch,
      vatMismatch,
      keyInconsistent,
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/rules/rules/identity-mismatch.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/rules/rules/identity-mismatch.ts lib/rules/rules/identity-mismatch.test.ts
git commit -m "Add identity-mismatch rule"
```

---

### Task 18: Rule — `exceptional-amount`

**Files:**
- Create: `lib/rules/rules/exceptional-amount.ts`
- Test: `lib/rules/rules/exceptional-amount.test.ts`

**Interfaces:**
- Consumes: `InvoiceContext`, `Reason` (Task 5); `EXCEPTIONAL_AMOUNT` (Task 1); `formatEuros` (Task 3).
- Produces: `export default function exceptionalAmountRule(ctx: InvoiceContext): Reason | null`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/rules/rules/exceptional-amount.test.ts
import { describe, it, expect } from "vitest";
import { buildContext } from "../test-fixtures";
import exceptionalAmountRule from "./exceptional-amount";

describe("exceptional-amount rule", () => {
  it("returns red when the amount HT exceeds 50 000 €", () => {
    const ctx = buildContext({ invoice: { amountExclVatCents: 60_000_00 } });
    const reason = exceptionalAmountRule(ctx);
    expect(reason?.code).toBe("EXCEPTIONAL_AMOUNT");
    expect(reason?.level).toBe("red");
  });

  it("does not trigger at exactly 50 000 €", () => {
    const ctx = buildContext({ invoice: { amountExclVatCents: 50_000_00 } });
    expect(exceptionalAmountRule(ctx)).toBeNull();
  });

  it("does not trigger for a normal amount", () => {
    const ctx = buildContext({ invoice: { amountExclVatCents: 100_000 } });
    expect(exceptionalAmountRule(ctx)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/rules/rules/exceptional-amount.test.ts`
Expected: FAIL — `Cannot find module './exceptional-amount'`

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/rules/rules/exceptional-amount.ts
import type { InvoiceContext, Reason } from "../types";
import { EXCEPTIONAL_AMOUNT } from "../thresholds";
import { formatEuros } from "../../format";

export default function exceptionalAmountRule(ctx: InvoiceContext): Reason | null {
  const amount = ctx.invoice.amountExclVatCents;
  if (amount <= EXCEPTIONAL_AMOUNT) return null;

  const message = `Montant exceptionnel : ${formatEuros(amount)} HT (seuil ${formatEuros(EXCEPTIONAL_AMOUNT)})`;
  return {
    code: "EXCEPTIONAL_AMOUNT",
    level: "red",
    message,
    data: { amountExclVatCents: amount, threshold: EXCEPTIONAL_AMOUNT },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/rules/rules/exceptional-amount.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/rules/rules/exceptional-amount.ts lib/rules/rules/exceptional-amount.test.ts
git commit -m "Add exceptional-amount rule"
```

---

### Task 19: Rule — `new-supplier`

**Files:**
- Create: `lib/rules/rules/new-supplier.ts`
- Test: `lib/rules/rules/new-supplier.test.ts`

**Interfaces:**
- Consumes: `InvoiceContext`, `Reason` (Task 5); `NEW_SUPPLIER_AMOUNT` (Task 1); `formatEuros` (Task 3).
- Produces: `export default function newSupplierRule(ctx: InvoiceContext): Reason | null`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/rules/rules/new-supplier.test.ts
import { describe, it, expect } from "vitest";
import { buildContext } from "../test-fixtures";
import newSupplierRule from "./new-supplier";

describe("new-supplier rule", () => {
  it("returns orange for a new supplier at or below 5 000 € HT", () => {
    const ctx = buildContext({
      invoice: { amountExclVatCents: 300_000 },
      groupApprovedInvoices: [],
    });
    const reason = newSupplierRule(ctx);
    expect(reason?.code).toBe("NEW_SUPPLIER_SMALL");
    expect(reason?.level).toBe("orange");
  });

  it("returns red for a new supplier above 5 000 € HT", () => {
    const ctx = buildContext({
      invoice: { amountExclVatCents: 800_000 },
      groupApprovedInvoices: [],
    });
    const reason = newSupplierRule(ctx);
    expect(reason?.code).toBe("NEW_SUPPLIER_LARGE");
    expect(reason?.level).toBe("red");
  });

  it("does not trigger at exactly 5 000 € HT", () => {
    const ctx = buildContext({
      invoice: { amountExclVatCents: 500_000 },
      groupApprovedInvoices: [],
    });
    expect(newSupplierRule(ctx)?.code).toBe("NEW_SUPPLIER_SMALL");
  });

  it("does not trigger when the supplier already has approved invoices in the group", () => {
    const ctx = buildContext({ invoice: { amountExclVatCents: 800_000 } });
    expect(newSupplierRule(ctx)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/rules/rules/new-supplier.test.ts`
Expected: FAIL — `Cannot find module './new-supplier'`

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/rules/rules/new-supplier.ts
import type { InvoiceContext, Reason } from "../types";
import { NEW_SUPPLIER_AMOUNT } from "../thresholds";
import { formatEuros } from "../../format";

export default function newSupplierRule(ctx: InvoiceContext): Reason | null {
  if (ctx.groupApprovedInvoices.length > 0) return null;

  const amount = ctx.invoice.amountExclVatCents;
  const message = `Nouveau fournisseur, ${formatEuros(amount)} HT`;
  const data = { amountExclVatCents: amount, threshold: NEW_SUPPLIER_AMOUNT };

  if (amount > NEW_SUPPLIER_AMOUNT) {
    return { code: "NEW_SUPPLIER_LARGE", level: "red", message, data };
  }
  return { code: "NEW_SUPPLIER_SMALL", level: "orange", message, data };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/rules/rules/new-supplier.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/rules/rules/new-supplier.ts lib/rules/rules/new-supplier.test.ts
git commit -m "Add new-supplier rule"
```

---

### Task 20: Rule — `no-contract`

**Files:**
- Create: `lib/rules/rules/no-contract.ts`
- Test: `lib/rules/rules/no-contract.test.ts`

**Interfaces:**
- Consumes: `InvoiceContext`, `Reason` (Task 5).
- Produces: `export default function noContractRule(ctx: InvoiceContext): Reason | null`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/rules/rules/no-contract.test.ts
import { describe, it, expect } from "vitest";
import { buildContext } from "../test-fixtures";
import noContractRule from "./no-contract";

describe("no-contract rule", () => {
  it("returns orange when the invoice has no contract_id", () => {
    const ctx = buildContext({ invoice: { contractId: null }, contract: null });
    const reason = noContractRule(ctx);
    expect(reason?.code).toBe("NO_CONTRACT");
    expect(reason?.level).toBe("orange");
  });

  it("does not trigger when the invoice has a contract_id", () => {
    const ctx = buildContext();
    expect(noContractRule(ctx)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/rules/rules/no-contract.test.ts`
Expected: FAIL — `Cannot find module './no-contract'`

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/rules/rules/no-contract.ts
import type { InvoiceContext, Reason } from "../types";

export default function noContractRule(ctx: InvoiceContext): Reason | null {
  if (ctx.invoice.contractId !== null) return null;
  return {
    code: "NO_CONTRACT",
    level: "orange",
    message: "Aucun contrat associé à cette facture",
    data: {},
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/rules/rules/no-contract.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/rules/rules/no-contract.ts lib/rules/rules/no-contract.test.ts
git commit -m "Add no-contract rule"
```

---

### Task 21: Rule — `unusual-category`

**Files:**
- Create: `lib/rules/rules/unusual-category.ts`
- Test: `lib/rules/rules/unusual-category.test.ts`

**Interfaces:**
- Consumes: `InvoiceContext`, `Reason` (Task 5).
- Produces: `export default function unusualCategoryRule(ctx: InvoiceContext): Reason | null`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/rules/rules/unusual-category.test.ts
import { describe, it, expect } from "vitest";
import { buildContext } from "../test-fixtures";
import unusualCategoryRule from "./unusual-category";

describe("unusual-category rule", () => {
  it("returns orange when the category has never been approved at this subsidiary", () => {
    const ctx = buildContext({
      invoice: { category: "marketing" },
      subsidiaryApprovedCategories: ["maintenance", "facilities"],
    });
    const reason = unusualCategoryRule(ctx);
    expect(reason?.code).toBe("UNUSUAL_CATEGORY");
    expect(reason?.level).toBe("orange");
  });

  it("does not trigger when the category has been approved before", () => {
    const ctx = buildContext({
      invoice: { category: "maintenance" },
      subsidiaryApprovedCategories: ["maintenance", "facilities"],
    });
    expect(unusualCategoryRule(ctx)).toBeNull();
  });

  it("does not trigger when no categories have been approved yet but this one matches by default", () => {
    const ctx = buildContext();
    expect(unusualCategoryRule(ctx)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/rules/rules/unusual-category.test.ts`
Expected: FAIL — `Cannot find module './unusual-category'`

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/rules/rules/unusual-category.ts
import type { InvoiceContext, Reason } from "../types";

export default function unusualCategoryRule(ctx: InvoiceContext): Reason | null {
  if (ctx.subsidiaryApprovedCategories.includes(ctx.invoice.category)) return null;
  return {
    code: "UNUSUAL_CATEGORY",
    level: "orange",
    message: `Catégorie inhabituelle pour la filiale : ${ctx.invoice.category}`,
    data: { category: ctx.invoice.category, knownCategories: ctx.subsidiaryApprovedCategories },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/rules/rules/unusual-category.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/rules/rules/unusual-category.ts lib/rules/rules/unusual-category.test.ts
git commit -m "Add unusual-category rule"
```

---

### Task 22: Rule — `not-recurring`

**Files:**
- Create: `lib/rules/rules/not-recurring.ts`
- Test: `lib/rules/rules/not-recurring.test.ts`

**Interfaces:**
- Consumes: `InvoiceContext`, `Reason` (Task 5); `RECURRING_MIN_INVOICES` (Task 1).
- Produces: `export default function notRecurringRule(ctx: InvoiceContext): Reason | null`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/rules/rules/not-recurring.test.ts
import { describe, it, expect } from "vitest";
import { buildContext } from "../test-fixtures";
import notRecurringRule from "./not-recurring";

const invoiceAt = (entityId: string) => ({
  entityId,
  entityName: "Filiale",
  category: "maintenance",
  amountExclVatCents: 100_000,
  dueDate: "2026-01-15",
});

describe("not-recurring rule", () => {
  it("returns orange when the supplier is known group-wide but has fewer than 3 approved invoices at this subsidiary", () => {
    const ctx = buildContext({
      groupApprovedInvoices: [invoiceAt("ent-other"), invoiceAt("ent-other")],
    });
    const reason = notRecurringRule(ctx);
    expect(reason?.code).toBe("NOT_RECURRING");
    expect(reason?.level).toBe("orange");
  });

  it("does not trigger when there are at least 3 approved invoices at this subsidiary", () => {
    const ctx = buildContext({
      groupApprovedInvoices: [invoiceAt("ent-1"), invoiceAt("ent-1"), invoiceAt("ent-1")],
    });
    expect(notRecurringRule(ctx)).toBeNull();
  });

  it("does not trigger for a brand-new supplier (handled by new-supplier instead)", () => {
    const ctx = buildContext({ groupApprovedInvoices: [] });
    expect(notRecurringRule(ctx)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/rules/rules/not-recurring.test.ts`
Expected: FAIL — `Cannot find module './not-recurring'`

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/rules/rules/not-recurring.ts
import type { InvoiceContext, Reason } from "../types";
import { RECURRING_MIN_INVOICES } from "../thresholds";

export default function notRecurringRule(ctx: InvoiceContext): Reason | null {
  if (ctx.groupApprovedInvoices.length === 0) return null;

  const countAtSubsidiary = ctx.groupApprovedInvoices.filter(
    (i) => i.entityId === ctx.invoice.entityId
  ).length;
  if (countAtSubsidiary >= RECURRING_MIN_INVOICES) return null;

  return {
    code: "NOT_RECURRING",
    level: "orange",
    message: `Seulement ${countAtSubsidiary} facture${countAtSubsidiary === 1 ? "" : "s"} approuvée${countAtSubsidiary === 1 ? "" : "s"} pour cette filiale sur 12 mois`,
    data: { countAtSubsidiary, threshold: RECURRING_MIN_INVOICES },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/rules/rules/not-recurring.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/rules/rules/not-recurring.ts lib/rules/rules/not-recurring.test.ts
git commit -m "Add not-recurring rule"
```

---

### Task 23: Rule — `supplier-risk`

**Files:**
- Create: `lib/rules/rules/supplier-risk.ts`
- Test: `lib/rules/rules/supplier-risk.test.ts`

**Interfaces:**
- Consumes: `InvoiceContext`, `Reason` (Task 5); `RISK_WINDOW_MONTHS` (Task 1).
- Produces: `export default function supplierRiskRule(ctx: InvoiceContext, today: Date): Reason | null`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/rules/rules/supplier-risk.test.ts
import { describe, it, expect } from "vitest";
import { buildContext } from "../test-fixtures";
import supplierRiskRule from "./supplier-risk";

const TODAY = new Date("2026-06-15");

describe("supplier-risk rule", () => {
  it("returns red for a risk event 2 months ago", () => {
    const ctx = buildContext({
      riskEvents: [{ eventDate: "2026-04-15", description: "Alerte conformité interne." }],
    });
    const reason = supplierRiskRule(ctx, TODAY);
    expect(reason?.code).toBe("SUPPLIER_RISK");
    expect(reason?.level).toBe("red");
    expect(reason?.data?.monthsAgo).toBe(2);
  });

  it("does not trigger for a risk event more than 12 months ago", () => {
    const ctx = buildContext({
      riskEvents: [{ eventDate: "2025-01-15", description: "Ancien incident." }],
    });
    expect(supplierRiskRule(ctx, TODAY)).toBeNull();
  });

  it("does not trigger when there are no risk events", () => {
    const ctx = buildContext({ riskEvents: [] });
    expect(supplierRiskRule(ctx, TODAY)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/rules/rules/supplier-risk.test.ts`
Expected: FAIL — `Cannot find module './supplier-risk'`

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/rules/rules/supplier-risk.ts
import type { InvoiceContext, Reason } from "../types";
import { RISK_WINDOW_MONTHS } from "../thresholds";

function monthsBetween(from: Date, to: Date): number {
  return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
}

export default function supplierRiskRule(ctx: InvoiceContext, today: Date): Reason | null {
  const match = ctx.riskEvents.find((event) => {
    const months = monthsBetween(new Date(event.eventDate), today);
    return months >= 0 && months <= RISK_WINDOW_MONTHS;
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

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/rules/rules/supplier-risk.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/rules/rules/supplier-risk.ts lib/rules/rules/supplier-risk.test.ts
git commit -m "Add supplier-risk rule"
```

---

### Task 24: `lib/rules/engine.ts`

**Files:**
- Create: `lib/rules/engine.ts`
- Test: `lib/rules/engine.test.ts`

**Interfaces:**
- Consumes: all 15 rule modules (Tasks 9-23), `Classification`, `InvoiceContext`, `Reason`, `Level` (Task 5), `buildContext` (Task 7, test only).
- Produces: `export function classify(ctx: InvoiceContext, today: Date): Classification` — consumed by `classify-all.ts` (Task 25).

- [ ] **Step 1: Write the failing test**

```ts
// lib/rules/engine.test.ts
import { describe, it, expect } from "vitest";
import { classify } from "./engine";
import { buildContext } from "./test-fixtures";

const TODAY = new Date("2026-06-15");

describe("classify", () => {
  it("returns green with a single ALL_CHECKS_PASSED reason when nothing triggers", () => {
    const ctx = buildContext();
    const result = classify(ctx, TODAY);
    expect(result.level).toBe("green");
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0].code).toBe("ALL_CHECKS_PASSED");
  });

  it("takes the highest severity level when reasons of multiple levels fire", () => {
    const ctx = buildContext({
      invoice: { contractId: null, printedIban: "DE89370400440532013000" },
      contract: null,
    });
    const result = classify(ctx, TODAY);
    expect(result.level).toBe("red");
    const codes = result.reasons.map((r) => r.code);
    expect(codes).toContain("NO_CONTRACT");
    expect(codes).toContain("IBAN_FOREIGN");
  });

  it("sorts reasons red first, then orange, then green", () => {
    const ctx = buildContext({
      invoice: { contractId: null, printedIban: "DE89370400440532013000" },
      contract: null,
    });
    const result = classify(ctx, TODAY);
    const levels = result.reasons.map((r) => r.level);
    expect(levels.indexOf("red")).toBeLessThan(levels.indexOf("orange"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/rules/engine.test.ts`
Expected: FAIL — `Cannot find module './engine'`

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/rules/engine.ts
import type { Classification, InvoiceContext, Reason, Level } from "./types";
import deviationHistoryRule from "./rules/deviation-history";
import deviationContractRule from "./rules/deviation-contract";
import deviationPeerRule from "./rules/deviation-peer";
import duplicateNumberRule from "./rules/duplicate-number";
import duplicateAmountRule from "./rules/duplicate-amount";
import ibanMismatchRule from "./rules/iban-mismatch";
import ibanRecentlyChangedRule from "./rules/iban-recently-changed";
import ibanForeignRule from "./rules/iban-foreign";
import identityMismatchRule from "./rules/identity-mismatch";
import exceptionalAmountRule from "./rules/exceptional-amount";
import newSupplierRule from "./rules/new-supplier";
import noContractRule from "./rules/no-contract";
import unusualCategoryRule from "./rules/unusual-category";
import notRecurringRule from "./rules/not-recurring";
import supplierRiskRule from "./rules/supplier-risk";

const RULES: Array<(ctx: InvoiceContext, today: Date) => Reason | null> = [
  deviationHistoryRule,
  deviationContractRule,
  deviationPeerRule,
  duplicateNumberRule,
  duplicateAmountRule,
  ibanMismatchRule,
  ibanRecentlyChangedRule,
  ibanForeignRule,
  identityMismatchRule,
  exceptionalAmountRule,
  newSupplierRule,
  noContractRule,
  unusualCategoryRule,
  notRecurringRule,
  supplierRiskRule,
];

const LEVEL_RANK: Record<Level, number> = { red: 3, orange: 2, green: 1 };

function buildAllChecksPassedReason(ctx: InvoiceContext): Reason {
  const sample = ctx.groupApprovedInvoices.filter(
    (i) => i.entityId === ctx.invoice.entityId && i.category === ctx.invoice.category
  );
  return {
    code: "ALL_CHECKS_PASSED",
    level: "green",
    message: "Toutes les vérifications sont conformes.",
    data: {
      contractId: ctx.contract?.id ?? null,
      historyCount: sample.length,
      amountExclVatCents: ctx.invoice.amountExclVatCents,
    },
  };
}

export function classify(ctx: InvoiceContext, today: Date): Classification {
  const reasons = RULES.map((rule) => rule(ctx, today)).filter((r): r is Reason => r !== null);

  if (reasons.length === 0) {
    reasons.push(buildAllChecksPassedReason(ctx));
  }

  reasons.sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level]);

  const level = reasons.reduce<Level>(
    (max, r) => (LEVEL_RANK[r.level] > LEVEL_RANK[max] ? r.level : max),
    "green"
  );

  return { level, reasons };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/rules/engine.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/rules/engine.ts lib/rules/engine.test.ts
git commit -m "Add classification engine aggregation"
```

---

### Task 25: `lib/rules/classify-all.ts` + `npm run classify` + seed wiring

**Files:**
- Create: `lib/rules/classify-all.ts`
- Create: `scripts/classify.ts`
- Modify: `lib/db/seed.ts` (call `classifyAll` at the end of `seed()`)
- Modify: `package.json` (add `classify` script)
- Test: `lib/rules/classify-all.test.ts`

**Interfaces:**
- Consumes: `loadContext` (Task 8), `classify` (Task 24), `RULES_VERSION` (Task 1).
- Produces: `export async function classifyAll(db: Client, today?: Date): Promise<void>` — consumed by `seed()` and `scripts/classify.ts`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/rules/classify-all.test.ts
import { describe, it, expect } from "vitest";
import { createClient } from "@libsql/client";
import { migrate } from "../db/migrate";
import { seed } from "../db/seed";
import { classifyAll } from "./classify-all";

describe("classifyAll", () => {
  it("inserts one classification per pending invoice, stamped with the rules version", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db);
    await seed(db); // seed() already calls classifyAll internally

    const rows = await db.execute(`
      SELECT classifications.level as level, classifications.rules_version as rulesVersion
      FROM classifications
      JOIN invoices ON invoices.id = classifications.invoice_id
      WHERE invoices.status = 'pending'
    `);
    expect(rows.rows.length).toBe(13);
    for (const row of rows.rows) {
      expect(row.rulesVersion).toBe("1.0.0");
      expect(["green", "orange", "red"]).toContain(String(row.level));
    }

    db.close();
  });

  it("is idempotent: calling it again replaces rather than duplicates classifications", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db);
    await seed(db);

    await classifyAll(db, new Date("2026-09-27"));
    await classifyAll(db, new Date("2026-09-27"));

    const rows = await db.execute(`
      SELECT COUNT(*) as count FROM classifications
      JOIN invoices ON invoices.id = classifications.invoice_id
      WHERE invoices.status = 'pending'
    `);
    expect(Number(rows.rows[0].count)).toBe(13);

    db.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/rules/classify-all.test.ts`
Expected: FAIL — `Cannot find module './classify-all'`

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/rules/classify-all.ts
import "server-only";
import type { Client, InValue } from "@libsql/client";
import { loadContext } from "./context";
import { classify } from "./engine";
import { RULES_VERSION } from "./thresholds";

interface WriteStatement {
  sql: string;
  args: InValue[];
}

export async function classifyAll(db: Client, today: Date = new Date()): Promise<void> {
  const pending = await db.execute("SELECT id FROM invoices WHERE status = 'pending'");
  const invoiceIds = pending.rows.map((row) => String(row.id));

  const statements: WriteStatement[] = [];
  for (const invoiceId of invoiceIds) {
    const ctx = await loadContext(db, invoiceId, today);
    const classification = classify(ctx, today);

    statements.push({ sql: "DELETE FROM classifications WHERE invoice_id = ?", args: [invoiceId] });
    statements.push({
      sql: "INSERT INTO classifications (id, invoice_id, level, reasons, rules_version) VALUES (?, ?, ?, ?, ?)",
      args: [
        `cls-${invoiceId}`,
        invoiceId,
        classification.level,
        JSON.stringify(classification.reasons),
        RULES_VERSION,
      ],
    });
  }

  if (statements.length > 0) {
    await db.batch(statements, "write");
  }
}
```

Wire it into `lib/db/seed.ts`: add the import near the top —

```ts
import { classifyAll } from "../rules/classify-all";
```

— and, at the very end of the `seed` function (right after the existing `await db.batch(statements.map((s) => ({ sql: s.sql, args: s.args })), "write");` call), add:

```ts
  await classifyAll(db, today);
```

Create `scripts/classify.ts` (mirrors `scripts/seed.ts`):

```ts
// scripts/classify.ts
import { db } from "../lib/db/client";
import { classifyAll } from "../lib/rules/classify-all";

async function main() {
  await classifyAll(db);
  console.log("Classification complete.");
  db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

Add to `package.json`'s `scripts` block (alongside `db:seed`):

```json
    "classify": "DOTENV_CONFIG_PATH=.env.local NODE_OPTIONS=--conditions=react-server tsx -r dotenv/config scripts/classify.ts",
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/rules/classify-all.test.ts lib/db/seed.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/rules/classify-all.ts lib/rules/classify-all.test.ts scripts/classify.ts lib/db/seed.ts package.json
git commit -m "Add classify-all orchestration, wire into seed, add npm run classify"
```

---

### Task 26: Seed `expectedCode` + full-scenario integration test

**Files:**
- Modify: `lib/db/seed.ts` (`ExpectedClassification` interface + `expectedClassifications` array)
- Test: `lib/rules/classify-all-scenarios.test.ts`

**Interfaces:**
- Consumes: `expectedClassifications` (modified), `ReasonCode` (Task 5).
- Produces: nothing new for later tasks — this is the spec's required "13 scenario assertions."

- [ ] **Step 1: Update `ExpectedClassification` and the scenario table**

In `lib/db/seed.ts`, update the interface:

```ts
export interface ExpectedClassification {
  invoiceNumber: string;
  scenario: string;
  expectedLevel: ClassificationLevel;
  expectedCode: string;
}
```

And the array — add `expectedCode` to each entry (no other values change):

```ts
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
```

- [ ] **Step 2: Write the integration test**

```ts
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
      const row = await db.execute({
        sql: `
          SELECT classifications.level AS level, classifications.reasons AS reasons
          FROM classifications
          JOIN invoices ON invoices.id = classifications.invoice_id
          WHERE invoices.invoice_number = ?
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
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `npx vitest run lib/rules/classify-all-scenarios.test.ts`
Expected: PASS — 13 tests, one per scenario. If any fails, the failure message names the scenario and shows the actual level/reasons — compare against the rule that should have fired (see the mapping table in the design spec) rather than adjusting seed data; every one of these 13 scenarios is designed to pass with the seed data as-is.

- [ ] **Step 4: Commit**

```bash
git add lib/db/seed.ts lib/rules/classify-all-scenarios.test.ts
git commit -m "Add expectedCode to seed scenarios and the full-scenario integration test"
```

---

### Task 27: Verification page — level dot + reasons columns

**Files:**
- Modify: `lib/db/queries.ts`
- Modify: `lib/db/queries.test.ts` (extend)
- Modify: `app/page.tsx`

**Interfaces:**
- Consumes: `formatEuros`, `formatDateFr` (Task 3); the `classifications` table (populated since Task 25/26).
- Produces: `PendingInvoiceRow` gains `level: "green" | "orange" | "red" | null` and `reasonMessages: string[]`.

- [ ] **Step 1: Write the failing test**

Add to `lib/db/queries.test.ts`:

```ts
it("includes the stored classification level and reason messages", async () => {
  const db = createClient({ url: ":memory:" });
  await migrate(db);
  await seed(db);

  const rows = await getPendingInvoices(db);
  const novalink = rows.find((r) => r.invoiceNumber === "PEND-NOVALINK-01");
  expect(novalink?.level).toBe("green");
  expect(novalink?.reasonMessages.length).toBeGreaterThan(0);

  db.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/db/queries.test.ts`
Expected: FAIL — `novalink?.level` is `undefined`

- [ ] **Step 3: Update `lib/db/queries.ts`**

```ts
// lib/db/queries.ts
import "server-only";
import type { Client } from "@libsql/client";

export interface PendingInvoiceRow {
  id: string;
  invoiceNumber: string;
  supplierName: string;
  entityName: string;
  amountInclVatCents: number;
  dueDate: string;
  category: string;
  level: "green" | "orange" | "red" | null;
  reasonMessages: string[];
}

export async function getPendingInvoices(db: Client): Promise<PendingInvoiceRow[]> {
  const result = await db.execute(`
    SELECT
      invoices.id AS id,
      invoices.invoice_number AS invoiceNumber,
      suppliers.name AS supplierName,
      entities.name AS entityName,
      invoices.amount_incl_vat_cents AS amountInclVatCents,
      invoices.due_date AS dueDate,
      invoices.category AS category,
      classifications.level AS level,
      classifications.reasons AS reasons
    FROM invoices
    JOIN suppliers ON suppliers.id = invoices.supplier_id
    JOIN entities ON entities.id = invoices.entity_id
    LEFT JOIN classifications ON classifications.invoice_id = invoices.id
    WHERE invoices.status = 'pending'
    ORDER BY invoices.due_date ASC
  `);

  return result.rows.map((row) => ({
    id: String(row.id),
    invoiceNumber: String(row.invoiceNumber),
    supplierName: String(row.supplierName),
    entityName: String(row.entityName),
    amountInclVatCents: Number(row.amountInclVatCents),
    dueDate: String(row.dueDate),
    category: String(row.category),
    level: row.level === null ? null : (String(row.level) as "green" | "orange" | "red"),
    reasonMessages: row.reasons
      ? (JSON.parse(String(row.reasons)) as Array<{ message: string }>).map((r) => r.message)
      : [],
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/db/queries.test.ts`
Expected: PASS

- [ ] **Step 5: Update `app/page.tsx`**

```tsx
// app/page.tsx
import { db } from "@/lib/db/client";
import { getPendingInvoices } from "@/lib/db/queries";
import { expectedClassifications } from "@/lib/db/seed";
import { resetDemo } from "@/app/actions/demo";
import { formatEuros, formatDateFr } from "@/lib/format";

export const dynamic = "force-dynamic";

const LEVEL_COLOR: Record<string, string> = {
  green: "bg-green-500",
  orange: "bg-orange-500",
  red: "bg-red-500",
};

export default async function Home() {
  const invoices = await getPendingInvoices(db);
  const scenarioByInvoiceNumber = new Map(
    expectedClassifications.map((entry) => [entry.invoiceNumber, entry.scenario])
  );

  return (
    <main className="p-8 font-sans">
      <h1 className="text-xl font-semibold">Factures en attente</h1>
      <form action={resetDemo} className="mt-4">
        <button type="submit" className="border border-gray-400 px-3 py-1 rounded">
          Réinitialiser la démo
        </button>
      </form>
      <table className="mt-6 w-full border-collapse">
        <thead>
          <tr>
            <th className="border border-gray-300 p-2 text-left">Fournisseur</th>
            <th className="border border-gray-300 p-2 text-left">Filiale</th>
            <th className="border border-gray-300 p-2 text-left">Montant TTC</th>
            <th className="border border-gray-300 p-2 text-left">Échéance</th>
            <th className="border border-gray-300 p-2 text-left">Niveau</th>
            <th className="border border-gray-300 p-2 text-left">Motifs</th>
            <th className="border border-gray-300 p-2 text-left">Scénario</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((invoice) => (
            <tr key={invoice.id}>
              <td className="border border-gray-300 p-2">{invoice.supplierName}</td>
              <td className="border border-gray-300 p-2">{invoice.entityName}</td>
              <td className="border border-gray-300 p-2">{formatEuros(invoice.amountInclVatCents)}</td>
              <td className="border border-gray-300 p-2">{formatDateFr(invoice.dueDate)}</td>
              <td className="border border-gray-300 p-2">
                {invoice.level && (
                  <span
                    className={`inline-block w-3 h-3 rounded-full ${LEVEL_COLOR[invoice.level]}`}
                    title={invoice.level}
                  />
                )}
              </td>
              <td className="border border-gray-300 p-2">
                {invoice.reasonMessages.map((message, index) => (
                  <div key={index}>{message}</div>
                ))}
              </td>
              <td className="border border-gray-300 p-2">
                {scenarioByInvoiceNumber.get(invoice.invoiceNumber) ?? "-"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
```

- [ ] **Step 6: Manually verify in the browser**

Run: `npm run dev`, open `http://localhost:3000`, click "Réinitialiser la démo," and confirm:
- 13 rows, sorted by due date ascending.
- Colored dots: 2 green, 4 orange, 7 red.
- The "Motifs" column shows at least one French message per row.

Stop the dev server when done.

- [ ] **Step 7: Commit**

```bash
git add lib/db/queries.ts lib/db/queries.test.ts app/page.tsx
git commit -m "Show classification level and reasons on the home page"
```

---

### Task 28: Final verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all suites pass, including 13/13 in `classify-all-scenarios.test.ts`.

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 3: Run the type checker**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Run the production build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Confirm the home page counts**

Run: `npm run dev`, open `http://localhost:3000`, reset the demo, and count the colored dots: 2 green, 4 orange, 7 red. Stop the dev server.

- [ ] **Step 6: Report**

Confirm to the user: `npm test` passes (including all 13 scenario assertions), `npm run build` has no type errors, and the home page shows 2 green / 4 orange / 7 red — and that no seed data changes were needed to hit the expected level/code per scenario (three schema columns were added instead: `issue_date`, `printed_vat_number`, `rules_version` — see the design spec's "Schema changes" section for why).
