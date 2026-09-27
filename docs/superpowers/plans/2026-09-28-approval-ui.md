# Approval UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the four-screen approval flow (dashboard, invoice detail, batch session review, bordereau) that lets the CEO decide on pending invoices from his phone, per `CLAUDE.md` and the approved design spec.

**Architecture:** Server components fetch via `lib/db/queries.ts` and `lib/rules/context.ts`; the only client components are the ones that need real interactivity (dashboard checkboxes + sticky bar, the removable batch-review list, copy/print buttons on the bordereau). Every mutation goes through a server action in `app/actions/sign.ts`, which calls one new orchestration function, `lib/sessions.ts`'s `createSession`, the single place a session is ever written.

**Tech Stack:** Next.js 15 App Router, TypeScript, Tailwind CSS v3, `@libsql/client`, Vitest. No new npm dependencies.

**Spec:** `docs/superpowers/specs/2026-09-28-approval-ui-design.md`

## Global Constraints

- UI copy is French; code and comments are English.
- Every mutation (approve, reject, sign) is a server action (`"use server"`), never a client-side `fetch`.
- Money/date formatting exclusively via `lib/format.ts` (`formatEuros`, `formatDateFr`, `formatPercent`, and the new `formatIbanGrouped`) — never inline `toLocaleString` elsewhere.
- Amounts are right-aligned with `tabular-nums`, always through the shared `<Amount>` component.
- Screen 2 shows the **persisted** `classifications` row as the authoritative level/reasons; `loadContext` is called again only to hydrate supporting display data (history, peers, identity, IBAN history) — never recompute a classification live in the UI.
- **Tailwind spacing:** the utility number is ¼ of the pixel value. To hit the fixed 4/8/12/16/24/32px scale use exactly `-1/-2/-3/-4/-6/-8` (e.g. `p-6` = 24px, `p-8` = 32px) — never `-16/-24/-32`, which are 64/96/128px.
- **Border radius:** every container uses the bare `rounded` class (overridden to 8px in `tailwind.config.ts`) — never `rounded-sm/md/lg/xl`. The one exception is `rounded-full` on the level-badge dot itself.
- One accent color, `blue-600`, for primary actions (Signer, Approuver, submit buttons) only. Everything else is Tailwind's gray scale plus green/orange/red for classification level. No gradients, no shadow beyond `shadow-sm` on the sticky bars, no emoji.
- Every list has an explicit empty state; no bare empty `<table>`/`<ul>`.
- Interactive tap targets (checkboxes, primary buttons in sticky bars) are at least 44px tall.
- Before calling any task done: the task's own verification (test, or `tsc`/`build` for UI-only tasks) passes. Before calling the whole plan done: `npm test`, `npm run lint`, `npx tsc --noEmit`, and `npm run build` all pass clean, plus the manual end-to-end walkthrough in Task 14.

---

### Task 1: Schema additions + `status` on `InvoiceContext`

**Files:**
- Modify: `lib/db/schema.ts` (`sessions`, `decisions` tables)
- Modify: `lib/db/seed.ts` (backfill `signature_ref` on the 12 historical sessions)
- Modify: `lib/rules/types.ts` (`InvoiceContextInvoice` gains `status`)
- Modify: `lib/rules/context.ts` (select + map the new field)
- Test: `lib/db/seed.test.ts` (extend), `lib/rules/context.test.ts` (extend)

**Interfaces:**
- Produces: `sessions.signature_ref TEXT NOT NULL`, `decisions.comment TEXT`,
  `InvoiceContextInvoice.status: string` — consumed by Task 8 (`app/actions/sign.ts`'s
  `signSingleDecision`) and Task 11 (Screen 2's "already decided" check).

- [ ] **Step 1: Write the failing tests**

Add to `lib/db/seed.test.ts` (new `describe`, after the existing ones):

```ts
describe("seed - session signature_ref", () => {
  it("backfills every historical session with a mocked signature_ref", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db);
    await seed(db);

    const rows = await db.execute("SELECT signature_ref as signatureRef FROM sessions");
    expect(rows.rows.length).toBeGreaterThan(0);
    for (const row of rows.rows) {
      expect(String(row.signatureRef).startsWith("MOCK-")).toBe(true);
    }

    db.close();
  });
});
```

Add to `lib/rules/context.test.ts` (extend the first existing test):

```ts
    expect(ctx.invoice.status).toBe("pending");
```

(add this line inside the existing `"loads the full context for a known pending invoice..."` test, right after the other `ctx.invoice.*` assertions).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/db/seed.test.ts lib/rules/context.test.ts`
Expected: FAIL — `SQLITE_ERROR: no such column: signature_ref` and `ctx.invoice.status` is `undefined`.

- [ ] **Step 3: Add the columns to the schema**

In `lib/db/schema.ts`, replace the `sessions` and `decisions` table definitions:

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('batch', 'single')),
  content_hash TEXT NOT NULL,
  signature_ref TEXT NOT NULL,
  signed_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE decisions (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  invoice_id TEXT NOT NULL UNIQUE REFERENCES invoices(id),
  outcome TEXT NOT NULL CHECK (outcome IN ('approved', 'rejected')) DEFAULT 'approved',
  comment TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

- [ ] **Step 4: Backfill `signature_ref` in `lib/db/seed.ts`**

Find the historical-session insert (inside the `for (const [monthsAgo, invoicesThisMonth] of invoicesByMonth)` loop) and change:

```ts
    statements.push({
      sql: "INSERT INTO sessions (id, kind, content_hash, signed_at) VALUES (?, 'batch', ?, ?)",
      args: [sessionId, contentHash, signedAt],
    });
```

to:

```ts
    statements.push({
      sql: "INSERT INTO sessions (id, kind, content_hash, signature_ref, signed_at) VALUES (?, 'batch', ?, ?, ?)",
      args: [sessionId, contentHash, `MOCK-${sessionId}`, signedAt],
    });
```

(the `decisions` insert in that same loop is unaffected — `comment` is nullable and can be omitted from an `INSERT` column list).

- [ ] **Step 5: Add `status` to `InvoiceContextInvoice`**

In `lib/rules/types.ts`, add one field to the interface:

```ts
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
  status: string;
}
```

- [ ] **Step 6: Select and map `status` in `lib/rules/context.ts`**

In the invoice `SELECT`, add one column (after `printed_vat_number`):

```ts
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
```

And in the `invoice` object construction, add:

```ts
    printedVatNumber: String(invoiceRow.printedVatNumber),
    status: String(invoiceRow.status),
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run lib/db lib/rules`
Expected: PASS (all of `lib/db/*.test.ts` and `lib/rules/**/*.test.ts` — this is a shared-file change, run the full affected directories, not just the two edited files).

- [ ] **Step 8: Commit**

```bash
git add lib/db/schema.ts lib/db/seed.ts lib/db/seed.test.ts lib/rules/types.ts lib/rules/context.ts lib/rules/context.test.ts
git commit -m "Add signature_ref, comment columns and expose invoice status in InvoiceContext"
```

---

### Task 2: Design system setup

**Files:**
- Modify: `tailwind.config.ts`
- Modify: `app/layout.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- Produces: the `rounded` class resolving to 8px everywhere, `font-sans` resolving to
  Inter, `.no-print` utility for print layout — consumed by every component task from
  here on.

There is no automated test for this task (pure config/CSS) — verification is
`npm run build` succeeding and the values being visible in the built config.

- [ ] **Step 1: Update `tailwind.config.ts`**

```ts
import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      borderRadius: {
        DEFAULT: "8px",
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
```

- [ ] **Step 2: Wire Inter into the root layout**

Replace `app/layout.tsx`:

```tsx
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "Approbation des factures",
  description: "Démo d'approbation centralisée des factures",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={inter.variable}>
      <body className="font-sans text-gray-900 antialiased">{children}</body>
    </html>
  );
}
```

- [ ] **Step 3: Add print rules to `app/globals.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@media print {
  .no-print {
    display: none !important;
  }
}
```

- [ ] **Step 4: Verify the build**

Run: `npm run build`
Expected: succeeds (the existing `app/page.tsx` still compiles at this point — it isn't touched until Task 10).

- [ ] **Step 5: Commit**

```bash
git add tailwind.config.ts app/layout.tsx app/globals.css
git commit -m "Set up design tokens: Inter font, 8px radius, print rules"
```

---

### Task 3: Shared display components

**Files:**
- Create: `components/level-badge.tsx`
- Create: `components/amount.tsx`
- Create: `components/reason-list.tsx`

**Interfaces:**
- Consumes: `Level`, `Reason` from `lib/rules/types.ts` (existing); `formatEuros`,
  `formatPercent` from `lib/format.ts` (existing).
- Produces: `<LevelBadge level={Level} />`, `<Amount cents={number} className?={string} />`,
  `<ReasonList reasons={Reason[]} />` — consumed by Tasks 10-13.

No automated test (pure presentational) — verification is `npx tsc --noEmit`.

- [ ] **Step 1: `components/level-badge.tsx`**

```tsx
import type { Level } from "@/lib/rules/types";

const LEVEL_COLOR: Record<Level, string> = {
  green: "bg-green-500",
  orange: "bg-orange-500",
  red: "bg-red-500",
};

const LEVEL_LABEL: Record<Level, string> = {
  green: "Vert",
  orange: "Orange",
  red: "Rouge",
};

export function LevelBadge({ level }: { level: Level }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span
        className={`inline-block h-3 w-3 rounded-full ${LEVEL_COLOR[level]}`}
        aria-hidden="true"
      />
      <span className="text-sm text-gray-700">{LEVEL_LABEL[level]}</span>
    </span>
  );
}
```

- [ ] **Step 2: `components/amount.tsx`**

```tsx
import { formatEuros } from "@/lib/format";

export function Amount({ cents, className = "" }: { cents: number; className?: string }) {
  return <span className={`tabular-nums ${className}`}>{formatEuros(cents)}</span>;
}
```

- [ ] **Step 3: `components/reason-list.tsx`**

```tsx
import type { Reason } from "@/lib/rules/types";
import { formatEuros, formatPercent } from "@/lib/format";

function formatReasonDetail(reason: Reason): string | null {
  const data = reason.data;
  if (!data) return null;
  const parts: string[] = [];
  if (typeof data.deviationPct === "number") {
    parts.push(formatPercent(data.deviationPct));
  }
  if (typeof data.amountExclVatCents === "number") {
    parts.push(formatEuros(data.amountExclVatCents));
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function ReasonList({ reasons }: { reasons: Reason[] }) {
  if (reasons.length === 0) {
    return <p className="text-sm text-gray-500">Aucun motif enregistré.</p>;
  }
  return (
    <ul className="space-y-2">
      {reasons.map((reason, index) => {
        const detail = formatReasonDetail(reason);
        return (
          <li key={index} className="text-sm text-gray-800">
            <span>{reason.message}</span>
            {detail && <span className="ml-2 text-gray-500">({detail})</span>}
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add components/level-badge.tsx components/amount.tsx components/reason-list.tsx
git commit -m "Add shared level-badge, amount, and reason-list components"
```

---

### Task 4: `getPendingInvoices` — full `Reason[]` shape

**Files:**
- Modify: `lib/db/queries.ts`
- Modify: `lib/db/queries.test.ts`

**Interfaces:**
- Produces: `PendingInvoiceRow.reasons: Reason[]` (was `reasonMessages: string[]`),
  `PendingInvoiceRow.level: Level | null` — consumed by Task 5 (`getInvoicesByIds`
  shares this shape) and every screen task (10-13).

- [ ] **Step 1: Update the failing test**

In `lib/db/queries.test.ts`, replace the assertion on the old shape:

```ts
  const novalink = rows.find((r) => r.invoiceNumber === "PEND-NOVALINK-01");
  expect(novalink?.level).toBe("green");
  expect(novalink?.reasonMessages.length).toBeGreaterThan(0);
```

with:

```ts
  const novalink = rows.find((r) => r.invoiceNumber === "PEND-NOVALINK-01");
  expect(novalink?.level).toBe("green");
  expect(novalink?.reasons.length).toBeGreaterThan(0);
  expect(novalink?.reasons[0].code).toBe("ALL_CHECKS_PASSED");
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/db/queries.test.ts`
Expected: FAIL — `novalink?.reasons` is `undefined`.

- [ ] **Step 3: Update `lib/db/queries.ts`**

```ts
import "server-only";
import type { Client } from "@libsql/client";
import type { Level, Reason } from "../rules/types";

export interface PendingInvoiceRow {
  id: string;
  invoiceNumber: string;
  supplierName: string;
  entityName: string;
  amountInclVatCents: number;
  dueDate: string;
  category: string;
  level: Level | null;
  reasons: Reason[];
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
    level: row.level === null ? null : (String(row.level) as Level),
    reasons: row.reasons ? (JSON.parse(String(row.reasons)) as Reason[]) : [],
  }));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/db/queries.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/db/queries.ts lib/db/queries.test.ts
git commit -m "Change getPendingInvoices to return full Reason[] instead of message strings"
```

---

### Task 5: `getClassification` + `getInvoicesByIds`

**Files:**
- Modify: `lib/db/queries.ts`
- Modify: `lib/db/queries.test.ts`

**Interfaces:**
- Consumes: `PendingInvoiceRow` (Task 4).
- Produces: `getClassification(db, invoiceId): Promise<ClassificationRow | null>`,
  `getInvoicesByIds(db, ids: string[]): Promise<PendingInvoiceRow[]>` — consumed by
  Task 8 (`signSingleDecision` uses `getClassification`), Task 11 (Screen 2 uses
  `getClassification`), Task 12 (Screen 3 uses `getInvoicesByIds`).

This task also extracts the row-mapping logic `getPendingInvoices` and
`getInvoicesByIds` share into one private helper, now that there are two callers.

- [ ] **Step 1: Write the failing tests**

Add to `lib/db/queries.test.ts`:

```ts
import { getClassification, getInvoicesByIds } from "./queries";

describe("getClassification", () => {
  it("returns the persisted level, reasons, and rules version for a classified invoice", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db);
    await seed(db);

    const rows = await getPendingInvoices(db);
    const novalink = rows.find((r) => r.invoiceNumber === "PEND-NOVALINK-01");

    const classification = await getClassification(db, novalink!.id);
    expect(classification?.level).toBe("green");
    expect(classification?.reasons[0].code).toBe("ALL_CHECKS_PASSED");
    expect(classification?.rulesVersion).toBe("1.0.0");

    db.close();
  });

  it("returns null for an invoice with no classification row", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db); // schema only, no seed — no invoices exist at all
    const classification = await getClassification(db, "does-not-exist");
    expect(classification).toBeNull();
    db.close();
  });
});

describe("getInvoicesByIds", () => {
  it("returns only the requested, still-pending, green/orange invoices", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db);
    await seed(db);

    const all = await getPendingInvoices(db);
    const novalink = all.find((r) => r.invoiceNumber === "PEND-NOVALINK-01")!; // green
    const atlas = all.find((r) => r.invoiceNumber === "PEND-ATLAS-01")!; // red

    const result = await getInvoicesByIds(db, [novalink.id, atlas.id]);
    expect(result.map((r) => r.id)).toEqual([novalink.id]);

    db.close();
  });

  it("returns an empty array for an empty id list", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db);
    const result = await getInvoicesByIds(db, []);
    expect(result).toEqual([]);
    db.close();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run lib/db/queries.test.ts`
Expected: FAIL — `getClassification`/`getInvoicesByIds` are not exported.

- [ ] **Step 3: Add the functions to `lib/db/queries.ts`**

First, extract the shared row mapper (replace the `return result.rows.map(...)` body of
`getPendingInvoices` with a call to it):

```ts
function mapPendingInvoiceRow(row: Record<string, unknown>): PendingInvoiceRow {
  return {
    id: String(row.id),
    invoiceNumber: String(row.invoiceNumber),
    supplierName: String(row.supplierName),
    entityName: String(row.entityName),
    amountInclVatCents: Number(row.amountInclVatCents),
    dueDate: String(row.dueDate),
    category: String(row.category),
    level: row.level === null ? null : (String(row.level) as Level),
    reasons: row.reasons ? (JSON.parse(String(row.reasons)) as Reason[]) : [],
  };
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

  return result.rows.map(mapPendingInvoiceRow);
}

export interface ClassificationRow {
  level: Level;
  reasons: Reason[];
  rulesVersion: string;
  createdAt: string;
}

export async function getClassification(
  db: Client,
  invoiceId: string
): Promise<ClassificationRow | null> {
  const result = await db.execute({
    sql: "SELECT level, reasons, rules_version AS rulesVersion, created_at AS createdAt FROM classifications WHERE invoice_id = ?",
    args: [invoiceId],
  });
  const row = result.rows[0];
  if (!row) return null;
  return {
    level: String(row.level) as Level,
    reasons: JSON.parse(String(row.reasons)) as Reason[],
    rulesVersion: String(row.rulesVersion),
    createdAt: String(row.createdAt),
  };
}

export async function getInvoicesByIds(db: Client, ids: string[]): Promise<PendingInvoiceRow[]> {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(", ");
  const result = await db.execute({
    sql: `
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
        AND invoices.id IN (${placeholders})
        AND classifications.level IN ('green', 'orange')
      ORDER BY invoices.due_date ASC
    `,
    args: ids,
  });

  return result.rows.map(mapPendingInvoiceRow);
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run lib/db/queries.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/db/queries.ts lib/db/queries.test.ts
git commit -m "Add getClassification and getInvoicesByIds, extract shared row mapper"
```

---

### Task 7: `getDecisionSessionId` + `getSessionWithDecisions`

**Files:**
- Modify: `lib/db/queries.ts`
- Modify: `lib/db/queries.test.ts`

**Interfaces:**
- Consumes: `Level` from `lib/rules/types.ts`; `createSession` from `lib/sessions.ts` (Task 6, test-only).
- Produces: `getDecisionSessionId(db, invoiceId): Promise<string | null>`,
  `getSessionWithDecisions(db, sessionId): Promise<BordereauSessionRow | null>` —
  consumed by Task 11 (Screen 2's "already decided" link) and Task 13 (Screen 4).

- [ ] **Step 1: Write the failing tests**

Add to `lib/db/queries.test.ts`:

```ts
import { getDecisionSessionId, getSessionWithDecisions } from "./queries";
import { createSession } from "../sessions";

describe("getDecisionSessionId", () => {
  it("returns null for an invoice with no decision yet", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db);
    await seed(db);
    const rows = await getPendingInvoices(db);
    const sessionId = await getDecisionSessionId(db, rows[0].id);
    expect(sessionId).toBeNull();
    db.close();
  });

  it("returns the session id once a decision exists", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db);
    await seed(db);
    const rows = await getPendingInvoices(db);
    const invoice = rows[0];
    const created = await createSession(db, "batch", [
      {
        invoiceId: invoice.id,
        entityName: invoice.entityName,
        amountInclVatCents: invoice.amountInclVatCents,
        outcome: "approved",
        comment: null,
      },
    ]);
    const sessionId = await getDecisionSessionId(db, invoice.id);
    expect(sessionId).toBe(created.sessionId);
    db.close();
  });
});

describe("getSessionWithDecisions", () => {
  it("returns the session header and every decision, joined to level and identity", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db);
    await seed(db);
    const rows = await getPendingInvoices(db);
    const invoice = rows.find((r) => r.invoiceNumber === "PEND-NOVALINK-01")!;
    const created = await createSession(db, "batch", [
      {
        invoiceId: invoice.id,
        entityName: invoice.entityName,
        amountInclVatCents: invoice.amountInclVatCents,
        outcome: "approved",
        comment: "Conforme au contrat.",
      },
    ]);

    const session = await getSessionWithDecisions(db, created.sessionId);
    expect(session?.kind).toBe("batch");
    expect(session?.contentHash).toBe(created.contentHash);
    expect(session?.decisions).toHaveLength(1);
    expect(session?.decisions[0].invoiceNumber).toBe("PEND-NOVALINK-01");
    expect(session?.decisions[0].level).toBe("green");
    expect(session?.decisions[0].comment).toBe("Conforme au contrat.");

    db.close();
  });

  it("returns null for a nonexistent session", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db);
    const session = await getSessionWithDecisions(db, "does-not-exist");
    expect(session).toBeNull();
    db.close();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run lib/db/queries.test.ts`
Expected: FAIL — `getDecisionSessionId`/`getSessionWithDecisions` are not exported.
(`../sessions` already exists by this point — Task 6 created it — so this should be a
clean "not exported" failure, not an import error. If you see an import error for
`../sessions`, stop: Task 6 was not actually completed first.)

- [ ] **Step 3: Add the functions to `lib/db/queries.ts`**

```ts
export async function getDecisionSessionId(db: Client, invoiceId: string): Promise<string | null> {
  const result = await db.execute({
    sql: "SELECT session_id AS sessionId FROM decisions WHERE invoice_id = ?",
    args: [invoiceId],
  });
  const row = result.rows[0];
  return row ? String(row.sessionId) : null;
}

export interface BordereauDecisionRow {
  invoiceId: string;
  invoiceNumber: string;
  supplierName: string;
  entityName: string;
  amountInclVatCents: number;
  level: Level | null;
  outcome: "approved" | "rejected";
  comment: string | null;
}

export interface BordereauSessionRow {
  id: string;
  kind: "batch" | "single";
  contentHash: string;
  signatureRef: string;
  signedAt: string;
  decisions: BordereauDecisionRow[];
}

export async function getSessionWithDecisions(
  db: Client,
  sessionId: string
): Promise<BordereauSessionRow | null> {
  const sessionResult = await db.execute({
    sql: "SELECT id, kind, content_hash AS contentHash, signature_ref AS signatureRef, signed_at AS signedAt FROM sessions WHERE id = ?",
    args: [sessionId],
  });
  const sessionRow = sessionResult.rows[0];
  if (!sessionRow) return null;

  const decisionsResult = await db.execute({
    sql: `
      SELECT
        decisions.invoice_id AS invoiceId,
        invoices.invoice_number AS invoiceNumber,
        suppliers.name AS supplierName,
        entities.name AS entityName,
        invoices.amount_incl_vat_cents AS amountInclVatCents,
        classifications.level AS level,
        decisions.outcome AS outcome,
        decisions.comment AS comment
      FROM decisions
      JOIN invoices ON invoices.id = decisions.invoice_id
      JOIN suppliers ON suppliers.id = invoices.supplier_id
      JOIN entities ON entities.id = invoices.entity_id
      LEFT JOIN classifications ON classifications.invoice_id = invoices.id
      WHERE decisions.session_id = ?
      ORDER BY invoices.due_date ASC
    `,
    args: [sessionId],
  });

  return {
    id: String(sessionRow.id),
    kind: String(sessionRow.kind) as "batch" | "single",
    contentHash: String(sessionRow.contentHash),
    signatureRef: String(sessionRow.signatureRef),
    signedAt: String(sessionRow.signedAt),
    decisions: decisionsResult.rows.map((row) => ({
      invoiceId: String(row.invoiceId),
      invoiceNumber: String(row.invoiceNumber),
      supplierName: String(row.supplierName),
      entityName: String(row.entityName),
      amountInclVatCents: Number(row.amountInclVatCents),
      level: row.level === null ? null : (String(row.level) as Level),
      outcome: String(row.outcome) as "approved" | "rejected",
      comment: row.comment === null ? null : String(row.comment),
    })),
  };
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run lib/db/queries.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/db/queries.ts lib/db/queries.test.ts
git commit -m "Add getDecisionSessionId and getSessionWithDecisions"
```

---

### Task 6: `lib/sessions.ts` — the single place a session is created

**Files:**
- Create: `lib/sessions.ts`
- Create: `lib/sessions.test.ts`

**Interfaces:**
- Produces: `DecisionInput`, `CreatedSession`,
  `createSession(db, kind, decisions): Promise<CreatedSession>`, `slug(value): string`,
  `notificationEmail(entityName): string` — consumed by Task 7 (`getSessionWithDecisions`'s
  own tests call `createSession` to set up fixtures), Task 8 (`app/actions/sign.ts`),
  and Task 13 (Screen 4 re-derives notification lines via `notificationEmail`).

- [ ] **Step 1: Write the failing tests**

```ts
// lib/sessions.test.ts
import { describe, it, expect } from "vitest";
import { createClient } from "@libsql/client";
import { createHash } from "node:crypto";
import { migrate } from "./db/migrate";
import { seed } from "./db/seed";
import { createSession, slug, notificationEmail } from "./sessions";

describe("createSession", () => {
  it("creates a batch session with a verifiable hash and flips invoice status to approved", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db);
    await seed(db);

    const pending = await db.execute(
      "SELECT id, amount_incl_vat_cents as amountInclVatCents FROM invoices WHERE status = 'pending' LIMIT 2"
    );
    const decisions = pending.rows.map((row) => ({
      invoiceId: String(row.id),
      entityName: "Filiale Test",
      amountInclVatCents: Number(row.amountInclVatCents),
      outcome: "approved" as const,
      comment: null,
    }));

    const result = await createSession(db, "batch", decisions);

    const expectedHash = createHash("sha256")
      .update(
        JSON.stringify({
          sessionId: result.sessionId,
          kind: "batch",
          decisions: [...decisions]
            .sort((a, b) => a.invoiceId.localeCompare(b.invoiceId))
            .map((d) => ({
              invoiceId: d.invoiceId,
              amountInclVatCents: d.amountInclVatCents,
              outcome: d.outcome,
            })),
          signedAt: result.signedAt,
        })
      )
      .digest("hex");
    expect(result.contentHash).toBe(expectedHash);
    expect(result.signatureRef.startsWith("MOCK-")).toBe(true);

    const sessionRows = await db.execute({
      sql: "SELECT kind, content_hash as contentHash FROM sessions WHERE id = ?",
      args: [result.sessionId],
    });
    expect(sessionRows.rows[0].kind).toBe("batch");
    expect(sessionRows.rows[0].contentHash).toBe(result.contentHash);

    const decisionRows = await db.execute({
      sql: "SELECT COUNT(*) as count FROM decisions WHERE session_id = ?",
      args: [result.sessionId],
    });
    expect(Number(decisionRows.rows[0].count)).toBe(2);

    for (const decision of decisions) {
      const invoiceRow = await db.execute({
        sql: "SELECT status FROM invoices WHERE id = ?",
        args: [decision.invoiceId],
      });
      expect(invoiceRow.rows[0].status).toBe("approved");
    }

    db.close();
  });

  it("creates a single-kind session for one rejected decision, storing the comment", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db);
    await seed(db);

    const pending = await db.execute(
      "SELECT id, amount_incl_vat_cents as amountInclVatCents FROM invoices WHERE status = 'pending' LIMIT 1"
    );
    const invoiceId = String(pending.rows[0].id);

    const result = await createSession(db, "single", [
      {
        invoiceId,
        entityName: "Filiale Test",
        amountInclVatCents: Number(pending.rows[0].amountInclVatCents),
        outcome: "rejected",
        comment: "Montant incohérent avec le contrat.",
      },
    ]);

    const decisionRow = await db.execute({
      sql: "SELECT outcome, comment FROM decisions WHERE session_id = ?",
      args: [result.sessionId],
    });
    expect(decisionRow.rows[0].outcome).toBe("rejected");
    expect(decisionRow.rows[0].comment).toBe("Montant incohérent avec le contrat.");

    const invoiceRow = await db.execute({
      sql: "SELECT status FROM invoices WHERE id = ?",
      args: [invoiceId],
    });
    expect(invoiceRow.rows[0].status).toBe("rejected");

    db.close();
  });

  it("throws when given no decisions", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db);
    await expect(createSession(db, "batch", [])).rejects.toThrow();
    db.close();
  });
});

describe("slug", () => {
  it("lowercases, strips accents, and hyphenates", () => {
    expect(slug("Arcadia Télécom")).toBe("arcadia-telecom");
  });
});

describe("notificationEmail", () => {
  it("builds a mocked address from the entity name", () => {
    expect(notificationEmail("Arcadia Télécom")).toBe("finance@arcadia-telecom.interne");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/sessions.test.ts`
Expected: FAIL — `Cannot find module './sessions'`

- [ ] **Step 3: Write the implementation**

```ts
// lib/sessions.ts
import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { Client, InValue } from "@libsql/client";

export interface DecisionInput {
  invoiceId: string;
  entityName: string;
  amountInclVatCents: number;
  outcome: "approved" | "rejected";
  comment: string | null;
}

export interface CreatedSession {
  sessionId: string;
  contentHash: string;
  signatureRef: string;
  signedAt: string;
}

interface WriteStatement {
  sql: string;
  args: InValue[];
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function slug(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function notificationEmail(entityName: string): string {
  return `finance@${slug(entityName)}.interne`;
}

export async function createSession(
  db: Client,
  kind: "batch" | "single",
  decisions: DecisionInput[]
): Promise<CreatedSession> {
  if (decisions.length === 0) {
    throw new Error("createSession requires at least one decision");
  }

  const sessionId = `ses-${randomUUID()}`;
  const signedAt = new Date().toISOString();
  const signatureRef = `MOCK-${randomUUID()}`;

  const contentHash = sha256Hex(
    JSON.stringify({
      sessionId,
      kind,
      decisions: [...decisions]
        .sort((a, b) => a.invoiceId.localeCompare(b.invoiceId))
        .map((d) => ({
          invoiceId: d.invoiceId,
          amountInclVatCents: d.amountInclVatCents,
          outcome: d.outcome,
        })),
      signedAt,
    })
  );

  const statements: WriteStatement[] = [
    {
      sql: "INSERT INTO sessions (id, kind, content_hash, signature_ref, signed_at) VALUES (?, ?, ?, ?, ?)",
      args: [sessionId, kind, contentHash, signatureRef, signedAt],
    },
  ];

  for (const decision of decisions) {
    statements.push({
      sql: "INSERT INTO decisions (id, session_id, invoice_id, outcome, comment) VALUES (?, ?, ?, ?, ?)",
      args: [`dec-${randomUUID()}`, sessionId, decision.invoiceId, decision.outcome, decision.comment],
    });
    statements.push({
      sql: "UPDATE invoices SET status = ? WHERE id = ?",
      args: [decision.outcome, decision.invoiceId],
    });
  }

  await db.batch(statements, "write");

  for (const decision of decisions) {
    console.log(`Notification envoyée à ${notificationEmail(decision.entityName)}`);
  }

  return { sessionId, contentHash, signatureRef, signedAt };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/sessions.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/sessions.ts lib/sessions.test.ts
git commit -m "Add lib/sessions.ts: the single place a session and its decisions are written"
```

---

### Task 8: `app/actions/sign.ts`

**Files:**
- Create: `app/actions/sign.ts`

**Interfaces:**
- Consumes: `getInvoicesByIds`, `getClassification` (Task 5), `createSession` (Task 6).
- Produces: `createBatchSession(formData): Promise<void>`,
  `signSingleDecision(formData): Promise<void>` — consumed by Task 10 (dashboard sticky
  bar form), Task 11 (Screen 2's approve/reject form), Task 12 (Screen 3's sign form).

No dedicated unit test — server actions that call `redirect()` are awkward to unit test
in isolation (Next.js's `redirect()` throws a special control-flow signal outside a real
request), and the underlying logic they call (`createSession`, `getInvoicesByIds`,
`getClassification`) is already covered by Tasks 5-7's tests. This action is verified by
the end-to-end walkthrough in Task 14.

- [ ] **Step 1: Write the implementation**

```ts
// app/actions/sign.ts
"use server";

import "server-only";
import { redirect } from "next/navigation";
import { db } from "@/lib/db/client";
import { getClassification, getInvoicesByIds } from "@/lib/db/queries";
import { createSession } from "@/lib/sessions";
import { loadContext } from "@/lib/rules/context";

export async function createBatchSession(formData: FormData): Promise<void> {
  const ids = formData.getAll("ids").map((value) => String(value));
  const invoices = await getInvoicesByIds(db, ids);
  if (invoices.length === 0) {
    redirect("/");
  }

  const { sessionId } = await createSession(
    db,
    "batch",
    invoices.map((invoice) => ({
      invoiceId: invoice.id,
      entityName: invoice.entityName,
      amountInclVatCents: invoice.amountInclVatCents,
      outcome: "approved",
      comment: null,
    }))
  );

  redirect(`/sessions/${sessionId}`);
}

export async function signSingleDecision(formData: FormData): Promise<void> {
  const invoiceId = String(formData.get("invoiceId"));
  const outcome = String(formData.get("outcome")) as "approved" | "rejected";
  const commentRaw = String(formData.get("comment") ?? "").trim();
  const comment = commentRaw.length > 0 ? commentRaw : null;

  const context = await loadContext(db, invoiceId, new Date());
  if (context.invoice.status !== "pending") {
    redirect(`/invoices/${invoiceId}`);
  }

  const classification = await getClassification(db, invoiceId);
  const kind = classification?.level === "red" ? "single" : "batch";

  const { sessionId } = await createSession(db, kind, [
    {
      invoiceId,
      entityName: context.invoice.entityName,
      amountInclVatCents: context.invoice.amountInclVatCents,
      outcome,
      comment,
    },
  ]);

  redirect(`/sessions/${sessionId}`);
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/actions/sign.ts
git commit -m "Add createBatchSession and signSingleDecision server actions"
```

---

### Task 9: `app/(app)/layout.tsx`

**Files:**
- Create: `app/(app)/layout.tsx`

**Interfaces:**
- Consumes: `resetDemo` from `app/actions/demo.ts` (existing).
- Produces: shared chrome (title + reset link) wrapping every screen created in Tasks
  10-13.

- [ ] **Step 1: Write the implementation**

```tsx
// app/(app)/layout.tsx
import Link from "next/link";
import { resetDemo } from "@/app/actions/demo";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-white">
      <header className="no-print flex items-center justify-between border-b border-gray-200 px-4 py-3">
        <Link href="/" className="text-base font-semibold text-gray-900">
          Approbation des factures
        </Link>
        <form action={resetDemo}>
          <button type="submit" className="text-sm text-gray-500 underline">
            Réinitialiser
          </button>
        </form>
      </header>
      <main className="pb-24">{children}</main>
    </div>
  );
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors (this layout has no page under it yet, so nothing renders it until
Task 10 — that's fine, it still type-checks standalone).

- [ ] **Step 3: Commit**

```bash
git add "app/(app)/layout.tsx"
git commit -m "Add shared (app) route group layout"
```

---

### Task 10: Screen 1 — Dashboard

**Files:**
- Delete: `app/page.tsx` (the old debug table — superseded by the dashboard below;
  deleting it here, not earlier, avoids an intermediate state with no page at `/` at
  all)
- Create: `app/(app)/page.tsx`
- Create: `app/(app)/_components/invoice-list.tsx`

**Interfaces:**
- Consumes: `getPendingInvoices` (Task 4/5), `LevelBadge`/`Amount` (Task 3),
  `createBatchSession` (Task 8), `formatDateFr` (existing `lib/format.ts`).
- Produces: the dashboard screen. Nothing downstream consumes this beyond the browser.

No automated test (UI) — verification is `npx tsc --noEmit`; the full click-through is
Task 14.

- [ ] **Step 1: Delete the old root page**

```bash
git rm app/page.tsx
```

- [ ] **Step 2: `app/(app)/page.tsx`**

```tsx
import { db } from "@/lib/db/client";
import { getPendingInvoices } from "@/lib/db/queries";
import { InvoiceList } from "./_components/invoice-list";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const invoices = await getPendingInvoices(db);
  return (
    <div className="px-4 py-4">
      <InvoiceList invoices={invoices} />
    </div>
  );
}
```

- [ ] **Step 3: `app/(app)/_components/invoice-list.tsx`**

```tsx
"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { LevelBadge } from "@/components/level-badge";
import { Amount } from "@/components/amount";
import { createBatchSession } from "@/app/actions/sign";
import type { PendingInvoiceRow } from "@/lib/db/queries";
import { formatDateFr } from "@/lib/format";
import type { Level } from "@/lib/rules/types";

const LEVEL_ORDER: Level[] = ["red", "orange", "green"];

function topReasonMessage(invoice: PendingInvoiceRow): string {
  const flagged = invoice.reasons.find((r) => r.level === "red" || r.level === "orange");
  return flagged?.message ?? invoice.reasons[0]?.message ?? "Conforme";
}

export function InvoiceList({ invoices }: { invoices: PendingInvoiceRow[] }) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const groups = useMemo(() => {
    const byLevel = new Map<Level, PendingInvoiceRow[]>();
    for (const level of LEVEL_ORDER) byLevel.set(level, []);
    for (const invoice of invoices) {
      const level = invoice.level ?? "orange";
      byLevel.get(level)?.push(invoice);
    }
    return LEVEL_ORDER.map((level) => ({ level, rows: byLevel.get(level) ?? [] }));
  }, [invoices]);

  const stats = useMemo(() => {
    const counts: Record<Level, number> = { green: 0, orange: 0, red: 0 };
    let total = 0;
    for (const invoice of invoices) {
      const level = invoice.level ?? "orange";
      counts[level] += 1;
      total += invoice.amountInclVatCents;
    }
    return { counts, total };
  }, [invoices]);

  const selected = useMemo(
    () => invoices.filter((invoice) => selectedIds.has(invoice.id)),
    [invoices, selectedIds]
  );
  const selectedTotal = selected.reduce((sum, invoice) => sum + invoice.amountInclVatCents, 0);

  function toggle(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (invoices.length === 0) {
    return <p className="text-sm text-gray-500">Aucune facture en attente.</p>;
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap gap-4 text-sm text-gray-600">
        <span>
          {stats.counts.red} rouge · {stats.counts.orange} orange · {stats.counts.green} vert
        </span>
        <span>
          Total en attente : <Amount cents={stats.total} className="font-medium text-gray-900" />
        </span>
      </div>

      {groups.map(({ level, rows }) =>
        rows.length === 0 ? null : (
          <div key={level} className="mb-8">
            <h2 className="mb-2">
              <LevelBadge level={level} />
            </h2>
            <ul className="divide-y divide-gray-200 rounded border border-gray-200">
              {rows.map((invoice) => (
                <li key={invoice.id} className="flex items-start gap-3 p-4">
                  {level !== "red" && (
                    <input
                      type="checkbox"
                      className="mt-1 h-5 w-5 shrink-0"
                      checked={selectedIds.has(invoice.id)}
                      onChange={() => toggle(invoice.id)}
                      aria-label={`Sélectionner la facture ${invoice.invoiceNumber}`}
                    />
                  )}
                  <Link href={`/invoices/${invoice.id}`} className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate font-medium text-gray-900">{invoice.supplierName}</span>
                      <Amount
                        cents={invoice.amountInclVatCents}
                        className="shrink-0 font-medium text-gray-900"
                      />
                    </div>
                    <div className="mt-1 text-sm text-gray-500">
                      {invoice.entityName} · {formatDateFr(invoice.dueDate)}
                    </div>
                    <div className="mt-1 truncate text-sm text-gray-600">{topReasonMessage(invoice)}</div>
                  </Link>
                  {level === "red" && (
                    <Link
                      href={`/invoices/${invoice.id}`}
                      className="shrink-0 self-center rounded border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700"
                    >
                      Examiner
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )
      )}

      {selected.length > 0 && (
        <form
          action={createBatchSession}
          className="fixed inset-x-0 bottom-0 flex items-center justify-between gap-4 border-t border-gray-200 bg-white p-4 shadow-sm"
        >
          {selected.map((invoice) => (
            <input key={invoice.id} type="hidden" name="ids" value={invoice.id} />
          ))}
          <span className="text-sm text-gray-700">
            {selected.length} facture{selected.length === 1 ? "" : "s"} ·{" "}
            <Amount cents={selectedTotal} />
          </span>
          <button
            type="submit"
            className="min-h-[44px] shrink-0 rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white"
          >
            Approuver la sélection en lot
          </button>
        </form>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add -A app/page.tsx "app/(app)/page.tsx" "app/(app)/_components/invoice-list.tsx"
git commit -m "Add dashboard: grouped invoice list, checkboxes, sticky batch-approve bar"
```

---

### Task 11: Screen 2 — Invoice detail

**Files:**
- Modify: `lib/format.ts` (add `formatIbanGrouped`)
- Modify: `lib/format.test.ts` (add a test for it)
- Create: `app/(app)/invoices/[id]/page.tsx`

**Interfaces:**
- Consumes: `loadContext` (existing, extended in Task 1), `getClassification`,
  `getDecisionSessionId` (Task 5/6), `LevelBadge`/`Amount`/`ReasonList` (Task 3),
  `signSingleDecision` (Task 8), `median` from `lib/rules/stats.ts` (existing —
  **reuse it, do not reimplement**), `HISTORY_SAMPLE` from `lib/rules/thresholds.ts`
  (existing).
- Produces: the invoice detail screen.

- [ ] **Step 1: Write the failing test for `formatIbanGrouped`**

Add to `lib/format.test.ts`:

```ts
describe("formatIbanGrouped", () => {
  it("groups an IBAN into 4-character blocks", () => {
    expect(formatIbanGrouped("FR1420041010050500013M02606")).toBe("FR14 2004 1010 0505 0001 3M02 606");
  });
});
```

(add the import: `import { ..., formatIbanGrouped } from "./format";` alongside the
existing imports in that file).

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/format.test.ts`
Expected: FAIL — `formatIbanGrouped` is not exported.

- [ ] **Step 3: Add `formatIbanGrouped` to `lib/format.ts`**

```ts
export function formatIbanGrouped(iban: string): string {
  return iban.replace(/\s+/g, "").match(/.{1,4}/g)?.join(" ") ?? iban;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/format.test.ts`
Expected: PASS

- [ ] **Step 5: `app/(app)/invoices/[id]/page.tsx`**

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db/client";
import { loadContext } from "@/lib/rules/context";
import { getClassification, getDecisionSessionId } from "@/lib/db/queries";
import { HISTORY_SAMPLE } from "@/lib/rules/thresholds";
import { median } from "@/lib/rules/stats";
import { LevelBadge } from "@/components/level-badge";
import { Amount } from "@/components/amount";
import { ReasonList } from "@/components/reason-list";
import { formatDateFr, formatEuros, formatIbanGrouped } from "@/lib/format";
import { signSingleDecision } from "@/app/actions/sign";

export const dynamic = "force-dynamic";

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let context;
  try {
    context = await loadContext(db, id, new Date());
  } catch {
    notFound();
  }

  const classification = await getClassification(db, id);
  const isDecided = context.invoice.status !== "pending";
  const existingSessionId = isDecided ? await getDecisionSessionId(db, id) : null;

  const historyRows = context.groupApprovedInvoices
    .filter(
      (row) => row.entityId === context.invoice.entityId && row.category === context.invoice.category
    )
    .slice(0, HISTORY_SAMPLE);

  const peerByEntity = new Map<string, { entityName: string; amounts: number[] }>();
  for (const row of context.groupApprovedInvoices) {
    if (row.entityId === context.invoice.entityId) continue;
    if (row.category !== context.invoice.category) continue;
    const entry = peerByEntity.get(row.entityId) ?? { entityName: row.entityName, amounts: [] };
    entry.amounts.push(row.amountExclVatCents);
    peerByEntity.set(row.entityId, entry);
  }
  const peerRows = [...peerByEntity.entries()]
    .map(([entityId, entry]) => ({
      entityId,
      entityName: entry.entityName,
      medianAmount: median(entry.amounts) ?? 0,
    }))
    .sort((a, b) => b.medianAmount - a.medianAmount);
  const maxPeerAmount = Math.max(
    context.invoice.amountExclVatCents,
    ...peerRows.map((r) => r.medianAmount),
    1
  );

  const currentIban = context.ibanHistory[0]?.iban ?? null;
  const sirenMismatch = context.invoice.printedSiren !== context.supplier.siren;
  const vatMismatch = context.invoice.printedVatNumber !== context.supplier.vatNumber;
  const ibanMismatch = currentIban !== null && context.invoice.printedIban !== currentIban;

  return (
    <div className="space-y-8 px-4 py-4">
      <div>
        <h1 className="text-lg font-semibold text-gray-900">{context.invoice.invoiceNumber}</h1>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-gray-500">Fournisseur</dt>
            <dd className="text-gray-900">{context.supplier.name}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Filiale</dt>
            <dd className="text-gray-900">{context.invoice.entityName}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Montant HT</dt>
            <dd className="text-gray-900">
              <Amount cents={context.invoice.amountExclVatCents} />
            </dd>
          </div>
          <div>
            <dt className="text-gray-500">Montant TTC</dt>
            <dd className="text-gray-900">
              <Amount cents={context.invoice.amountInclVatCents} />
            </dd>
          </div>
          <div>
            <dt className="text-gray-500">Émise le</dt>
            <dd className="text-gray-900">{formatDateFr(context.invoice.issueDate)}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Échéance</dt>
            <dd className="text-gray-900">{formatDateFr(context.invoice.dueDate)}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Catégorie</dt>
            <dd className="text-gray-900">{context.invoice.category}</dd>
          </div>
        </dl>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-gray-900">Classification</h2>
        {classification ? (
          <div>
            <LevelBadge level={classification.level} />
            <div className="mt-3">
              <ReasonList reasons={classification.reasons} />
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-500">Aucune classification disponible.</p>
        )}
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-gray-900">Historique à cette filiale</h2>
        {historyRows.length === 0 ? (
          <p className="text-sm text-gray-500">
            Aucun historique disponible pour ce fournisseur à cette filiale.
          </p>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              <tr className="border-b border-gray-200 bg-gray-50 font-medium text-gray-900">
                <td className="py-2">Facture actuelle</td>
                <td className="py-2 text-right">
                  <Amount cents={context.invoice.amountExclVatCents} />
                </td>
              </tr>
              {historyRows.map((row, index) => (
                <tr key={index} className="border-b border-gray-100 text-gray-600">
                  <td className="py-2">{formatDateFr(row.dueDate)}</td>
                  <td className="py-2 text-right">
                    <Amount cents={row.amountExclVatCents} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-gray-900">Comparaison entre filiales</h2>
        {peerRows.length === 0 ? (
          <p className="text-sm text-gray-500">Aucune facture comparable dans les autres filiales.</p>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <span className="w-32 shrink-0 truncate text-sm font-medium text-gray-900">
                {context.invoice.entityName} (actuelle)
              </span>
              <div className="h-2 flex-1 rounded bg-gray-100">
                <div
                  className="h-2 rounded bg-blue-600"
                  style={{ width: `${(context.invoice.amountExclVatCents / maxPeerAmount) * 100}%` }}
                />
              </div>
              <Amount
                cents={context.invoice.amountExclVatCents}
                className="w-24 shrink-0 text-right text-sm"
              />
            </div>
            {peerRows.map((row) => (
              <div key={row.entityId} className="flex items-center gap-3">
                <span className="w-32 shrink-0 truncate text-sm text-gray-600">{row.entityName}</span>
                <div className="h-2 flex-1 rounded bg-gray-100">
                  <div
                    className="h-2 rounded bg-gray-400"
                    style={{ width: `${(row.medianAmount / maxPeerAmount) * 100}%` }}
                  />
                </div>
                <Amount cents={row.medianAmount} className="w-24 shrink-0 text-right text-sm text-gray-600" />
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-gray-900">Contrat</h2>
        {context.contract ? (
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-gray-500">Catégorie</dt>
              <dd className="text-gray-900">{context.contract.category}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Montant attendu HT</dt>
              <dd className="text-gray-900">
                {context.contract.expectedAmountCents !== null
                  ? formatEuros(context.contract.expectedAmountCents)
                  : "—"}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="text-sm text-gray-500">Aucun contrat rattaché.</p>
        )}
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-gray-900">Identité du fournisseur</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500">
              <th className="py-1 font-normal"></th>
              <th className="py-1 font-normal">Registre</th>
              <th className="py-1 font-normal">Facture</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-gray-100">
              <td className="py-2 text-gray-500">SIREN</td>
              <td className="py-2 text-gray-900">{context.supplier.siren}</td>
              <td className={`py-2 ${sirenMismatch ? "bg-red-50 font-medium text-red-700" : "text-gray-900"}`}>
                {context.invoice.printedSiren}
              </td>
            </tr>
            <tr className="border-t border-gray-100">
              <td className="py-2 text-gray-500">TVA</td>
              <td className="py-2 text-gray-900">{context.supplier.vatNumber}</td>
              <td className={`py-2 ${vatMismatch ? "bg-red-50 font-medium text-red-700" : "text-gray-900"}`}>
                {context.invoice.printedVatNumber}
              </td>
            </tr>
            <tr className="border-t border-gray-100">
              <td className="py-2 text-gray-500">IBAN</td>
              <td className="py-2 text-gray-900">{currentIban ? formatIbanGrouped(currentIban) : "—"}</td>
              <td className={`py-2 ${ibanMismatch ? "bg-red-50 font-medium text-red-700" : "text-gray-900"}`}>
                {formatIbanGrouped(context.invoice.printedIban)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-gray-900">Historique IBAN</h2>
        <ul className="divide-y divide-gray-100 text-sm">
          {context.ibanHistory.map((entry, index) => (
            <li key={index} className="flex items-center justify-between py-2">
              <span className="text-gray-900">{formatIbanGrouped(entry.iban)}</span>
              <span className="text-gray-500">
                {formatDateFr(entry.effectiveFrom)}
                {index === 0 && <span className="ml-2 text-green-700">Actif</span>}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-gray-900">Décision</h2>
        {isDecided ? (
          <p className="text-sm text-gray-600">
            Facture déjà traitée.{" "}
            {existingSessionId && (
              <Link href={`/sessions/${existingSessionId}`} className="text-blue-600 underline">
                Voir le bordereau
              </Link>
            )}
          </p>
        ) : (
          <form action={signSingleDecision} className="space-y-3">
            <input type="hidden" name="invoiceId" value={context.invoice.id} />
            <textarea
              name="comment"
              rows={3}
              placeholder="Commentaire (facultatif)"
              className="w-full rounded border border-gray-300 p-3 text-sm"
            />
            <div className="flex gap-3">
              <button
                type="submit"
                name="outcome"
                value="approved"
                className="min-h-[44px] flex-1 rounded bg-blue-600 px-4 text-sm font-semibold text-white"
              >
                Approuver
              </button>
              <button
                type="submit"
                name="outcome"
                value="rejected"
                className="min-h-[44px] flex-1 rounded border border-gray-300 px-4 text-sm font-semibold text-gray-700"
              >
                Rejeter
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add lib/format.ts lib/format.test.ts "app/(app)/invoices/[id]/page.tsx"
git commit -m "Add invoice detail screen: history, cross-entity comparison, identity, IBAN, decision"
```

---

### Task 12: Screen 3 — Batch session review

**Files:**
- Create: `app/(app)/sessions/new/page.tsx`
- Create: `app/(app)/sessions/new/_components/session-review.tsx`

**Interfaces:**
- Consumes: `getInvoicesByIds` (Task 5), `LevelBadge`/`Amount` (Task 3),
  `createBatchSession` (Task 8).
- Produces: the batch review screen.

- [ ] **Step 1: `app/(app)/sessions/new/page.tsx`**

```tsx
import Link from "next/link";
import { db } from "@/lib/db/client";
import { getInvoicesByIds } from "@/lib/db/queries";
import { SessionReview } from "./_components/session-review";

export const dynamic = "force-dynamic";

export default async function NewSessionPage({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string }>;
}) {
  const { ids: idsParam } = await searchParams;
  const ids = idsParam ? idsParam.split(",").filter(Boolean) : [];
  const invoices = await getInvoicesByIds(db, ids);

  if (invoices.length === 0) {
    return (
      <div className="px-4 py-4">
        <p className="text-sm text-gray-500">Aucune facture sélectionnée n&apos;est plus éligible.</p>
        <Link href="/" className="mt-3 inline-block text-sm text-blue-600 underline">
          Retour au tableau de bord
        </Link>
      </div>
    );
  }

  return (
    <div className="px-4 py-4">
      <h1 className="mb-4 text-lg font-semibold text-gray-900">Validation en lot</h1>
      <SessionReview invoices={invoices} />
    </div>
  );
}
```

- [ ] **Step 2: `app/(app)/sessions/new/_components/session-review.tsx`**

```tsx
"use client";

import { useState } from "react";
import { LevelBadge } from "@/components/level-badge";
import { Amount } from "@/components/amount";
import { createBatchSession } from "@/app/actions/sign";
import type { PendingInvoiceRow } from "@/lib/db/queries";

export function SessionReview({ invoices }: { invoices: PendingInvoiceRow[] }) {
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());
  const remaining = invoices.filter((invoice) => !removedIds.has(invoice.id));
  const total = remaining.reduce((sum, invoice) => sum + invoice.amountInclVatCents, 0);

  if (remaining.length === 0) {
    return <p className="text-sm text-gray-500">Toutes les factures ont été retirées de la sélection.</p>;
  }

  return (
    <div>
      <ul className="divide-y divide-gray-200 rounded border border-gray-200">
        {remaining.map((invoice) => (
          <li key={invoice.id} className="flex items-center gap-3 p-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate font-medium text-gray-900">{invoice.supplierName}</span>
                <Amount cents={invoice.amountInclVatCents} className="shrink-0 font-medium text-gray-900" />
              </div>
              <div className="mt-1 flex items-center gap-2 text-sm text-gray-500">
                {invoice.level && <LevelBadge level={invoice.level} />}
                <span className="truncate">{invoice.reasons[0]?.message ?? "Conforme"}</span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setRemovedIds((prev) => new Set(prev).add(invoice.id))}
              className="shrink-0 text-sm text-gray-400 underline"
            >
              Retirer
            </button>
          </li>
        ))}
      </ul>

      <form
        action={createBatchSession}
        className="fixed inset-x-0 bottom-0 flex items-center justify-between gap-4 border-t border-gray-200 bg-white p-4 shadow-sm"
      >
        {remaining.map((invoice) => (
          <input key={invoice.id} type="hidden" name="ids" value={invoice.id} />
        ))}
        <span className="text-sm text-gray-700">
          {remaining.length} facture{remaining.length === 1 ? "" : "s"} · <Amount cents={total} />
        </span>
        <button
          type="submit"
          className="min-h-[44px] shrink-0 rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white"
        >
          Signer et valider
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/sessions/new/page.tsx" "app/(app)/sessions/new/_components/session-review.tsx"
git commit -m "Add batch session review screen with removable list"
```

---

### Task 13: Screen 4 — Bordereau

**Files:**
- Create: `app/(app)/sessions/[id]/page.tsx`
- Create: `app/(app)/sessions/[id]/_components/copy-hash-button.tsx`
- Create: `app/(app)/sessions/[id]/_components/print-button.tsx`

**Interfaces:**
- Consumes: `getSessionWithDecisions` (Task 7), `notificationEmail` (Task 6),
  `LevelBadge`/`Amount` (Task 3).
- Produces: the bordereau screen — the terminal page of both signing flows.

- [ ] **Step 1: `app/(app)/sessions/[id]/_components/copy-hash-button.tsx`**

```tsx
"use client";

import { useState } from "react";

export function CopyHashButton({ hash }: { hash: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="no-print text-sm text-blue-600 underline"
      onClick={async () => {
        await navigator.clipboard.writeText(hash);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? "Copié" : "Copier"}
    </button>
  );
}
```

- [ ] **Step 2: `app/(app)/sessions/[id]/_components/print-button.tsx`**

```tsx
"use client";

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="no-print rounded border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700"
    >
      Imprimer
    </button>
  );
}
```

- [ ] **Step 3: `app/(app)/sessions/[id]/page.tsx`**

```tsx
import { notFound } from "next/navigation";
import { db } from "@/lib/db/client";
import { getSessionWithDecisions } from "@/lib/db/queries";
import { notificationEmail } from "@/lib/sessions";
import { Amount } from "@/components/amount";
import { LevelBadge } from "@/components/level-badge";
import { formatDateFr } from "@/lib/format";
import { CopyHashButton } from "./_components/copy-hash-button";
import { PrintButton } from "./_components/print-button";

export const dynamic = "force-dynamic";

export default async function BordereauPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSessionWithDecisions(db, id);
  if (!session) notFound();

  const total = session.decisions.reduce((sum, d) => sum + d.amountInclVatCents, 0);

  return (
    <div className="space-y-6 px-4 py-4">
      <div className="no-print flex justify-end gap-3">
        <PrintButton />
      </div>

      <div>
        <h1 className="text-lg font-semibold text-gray-900">Bordereau {session.id}</h1>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-gray-500">Signé le</dt>
            <dd className="text-gray-900">{formatDateFr(session.signedAt)}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Signataire</dt>
            <dd className="text-gray-900">PDG</dd>
          </div>
          <div>
            <dt className="text-gray-500">Type</dt>
            <dd className="text-gray-900">{session.kind === "batch" ? "Lot" : "Individuelle"}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Nombre de factures</dt>
            <dd className="text-gray-900">{session.decisions.length}</dd>
          </div>
        </dl>
      </div>

      <div className="no-print rounded border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">
        <p className="mb-1 font-medium text-gray-900">Notifications envoyées</p>
        {session.decisions.map((decision) => (
          <p key={decision.invoiceId}>Notification envoyée à {notificationEmail(decision.entityName)}</p>
        ))}
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-left text-gray-500">
            <th className="py-2 font-normal">Facture</th>
            <th className="py-2 font-normal">Fournisseur</th>
            <th className="py-2 font-normal">Filiale</th>
            <th className="py-2 text-right font-normal">Montant</th>
            <th className="py-2 font-normal">Niveau</th>
            <th className="py-2 font-normal">Décision</th>
            <th className="py-2 font-normal">Commentaire</th>
          </tr>
        </thead>
        <tbody>
          {session.decisions.map((decision) => (
            <tr key={decision.invoiceId} className="border-b border-gray-100">
              <td className="py-2 text-gray-900">{decision.invoiceNumber}</td>
              <td className="py-2 text-gray-900">{decision.supplierName}</td>
              <td className="py-2 text-gray-900">{decision.entityName}</td>
              <td className="py-2 text-right">
                <Amount cents={decision.amountInclVatCents} />
              </td>
              <td className="py-2">{decision.level && <LevelBadge level={decision.level} />}</td>
              <td className="py-2 text-gray-900">{decision.outcome === "approved" ? "Approuvée" : "Rejetée"}</td>
              <td className="py-2 text-gray-600">{decision.comment ?? "—"}</td>
            </tr>
          ))}
          <tr className="font-medium text-gray-900">
            <td className="py-2" colSpan={3}>
              Total
            </td>
            <td className="py-2 text-right">
              <Amount cents={total} />
            </td>
            <td colSpan={3} />
          </tr>
        </tbody>
      </table>

      <div className="rounded border border-gray-200 p-3 text-sm">
        <p className="text-gray-500">Empreinte d&apos;intégrité (SHA-256)</p>
        <div className="mt-1 flex items-center gap-2">
          <code className="text-gray-900">
            {session.contentHash.slice(0, 12)}…{session.contentHash.slice(-4)}
          </code>
          <CopyHashButton hash={session.contentHash} />
        </div>
      </div>

      <p className="text-sm text-gray-500">
        Ce bordereau est immuable une fois signé. Aucune action de modification n&apos;existe sur cette
        page.
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/sessions/[id]/page.tsx" "app/(app)/sessions/[id]/_components/copy-hash-button.tsx" "app/(app)/sessions/[id]/_components/print-button.tsx"
git commit -m "Add bordereau screen: decisions table, integrity hash, print layout"
```

---

### Task 14: Final verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all suites pass.

- [ ] **Step 2: Lint and type-check**

Run: `npm run lint && npx tsc --noEmit`
Expected: 0 errors (the one pre-existing unrelated `eslint.config.mjs` warning is fine).

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 4: Reset the demo data**

Run: `npm run db:reset`
Expected: 13 pending invoices (2 green, 4 orange, 7 red), as established by the
classification-engine feature.

- [ ] **Step 5: Walk the batch flow end to end**

Start the app (`npm run dev` or `npm run build && npm run start`). On the dashboard,
select 3 green/orange invoices via their checkboxes, confirm the sticky bar shows the
right count/total, submit "Approuver la sélection en lot". Confirm you land on
`/sessions/[id]` showing exactly 3 decisions, all `Approuvée`, with a content hash and
"Copier" button that works.

- [ ] **Step 6: Walk the single red-invoice flow end to end**

Return to the dashboard, click "Examiner" on a red invoice, fill in a comment, click
"Approuver" (or "Rejeter"). Confirm you land on a bordereau with exactly 1 decision,
`kind = Individuelle`.

- [ ] **Step 7: Confirm the remaining count**

Return to the dashboard. Expected: 10 pending invoices (13 − 3 − 1).

- [ ] **Step 8: Mobile usability check**

Resize the browser (or use device emulation) to 375px wide. Confirm every screen is
usable without horizontal scroll, and that the sticky action bar's button is reachable
without stretching (bottom of the viewport, not clipped, ≥44px tall).

- [ ] **Step 9: Report**

Confirm to the user: `npm run build` has no type errors, both end-to-end flows work as
specified, the dashboard shows 10 pending invoices afterward, and every screen is usable
at 375px. Report any deviation from the original prompt discovered during
implementation, with the reason for it (the spec's "Mismatches" and "Resolved design
decisions" sections already cover the ones found during design — flag anything new
found only once code was written).
