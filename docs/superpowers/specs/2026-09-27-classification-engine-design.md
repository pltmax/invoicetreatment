# Classification engine — design

Date: 2026-09-27
Status: approved for planning

## Goal

Build the rules-based classification engine described in `CLAUDE.md`: pure
rule functions, a DB-backed context loader, persistence of classifications,
tests, and minimal updates to the verification page to show the result. No
new UI beyond the home table.

## Schema changes

`migrate.ts` drops and recreates all tables from `SCHEMA_SQL` on every run —
there is no incremental migration framework — so schema changes are made
directly in `lib/db/schema.ts`.

- `invoices` gains two columns:
  - `issue_date TEXT NOT NULL` — the rules spec's `DUPLICATE_AMOUNT` check
    compares "issue dates" between two invoices, and the schema had no such
    concept (only `due_date`). Seeded as `due_date` minus 30 days for every
    invoice (history and pending alike).
  - `printed_vat_number TEXT NOT NULL` — `IDENTITY_MISMATCH` checks the VAT
    number printed on the invoice against the registry; there was no column
    to hold it. Seeded as `supplier.vatNumber` by default, overridable per
    pending-invoice scenario the same way `printedIban`/`printedSiren`
    already are.
- `classifications` gains `rules_version TEXT NOT NULL`, populated from
  `RULES_VERSION` on every insert — including the 144 historical filler
  rows the seed writes directly (not through the engine), which must be
  updated to pass a value now that the column is `NOT NULL`.

No other schema changes. IBAN "current value" and "recently changed" are
derived from `iban_history` (latest row by `effective_from`), and supplier
risk is derived from `risk_events` (event within the risk window) — both
already modeled, no new columns needed.

## `lib/rules/thresholds.ts`

Exports every constant from the task spec verbatim (`DEVIATION_ORANGE`,
`DEVIATION_RED`, `NEW_SUPPLIER_AMOUNT`, `EXCEPTIONAL_AMOUNT`,
`IBAN_RECENT_CHANGE_DAYS`, `RISK_WINDOW_MONTHS`, `DUPLICATE_WINDOW_DAYS`,
`RECURRING_MIN_INVOICES`, `HISTORY_SAMPLE`) plus `RULES_VERSION = "1.0.0"`.

Note on `NEW_SUPPLIER_AMOUNT` (5,000€) vs `EXCEPTIONAL_AMOUNT` (50,000€):
these are two independent thresholds. `NEW_SUPPLIER_AMOUNT` splits the
*new-supplier* rule into its orange/red variants; `EXCEPTIONAL_AMOUNT` is an
unconditional red trigger regardless of supplier newness. Both can fire on
the same invoice (e.g. a large new-supplier invoice). This file is the
source of truth per `CLAUDE.md`; where CLAUDE.md's prose ("new supplier
> 50k€ = red") reads differently, the thresholds file wins.

## `lib/rules/types.ts`

```ts
type Level = "green" | "orange" | "red";

type ReasonCode =
  | "DEVIATION_HISTORY" | "DEVIATION_HISTORY_HIGH"
  | "DEVIATION_CONTRACT" | "DEVIATION_CONTRACT_HIGH"
  | "DEVIATION_PEER" | "DEVIATION_PEER_HIGH"
  | "DUPLICATE_NUMBER" | "DUPLICATE_AMOUNT"
  | "IBAN_MISMATCH" | "IBAN_RECENTLY_CHANGED" | "IBAN_FOREIGN"
  | "IDENTITY_MISMATCH"
  | "EXCEPTIONAL_AMOUNT"
  | "NEW_SUPPLIER_SMALL" | "NEW_SUPPLIER_LARGE"
  | "NO_CONTRACT" | "UNUSUAL_CATEGORY" | "NOT_RECURRING"
  | "SUPPLIER_RISK"
  | "ALL_CHECKS_PASSED";

interface Reason {
  code: ReasonCode;
  level: Level;
  message: string;
  data?: Record<string, unknown>;
}

interface Classification {
  level: Level;
  reasons: Reason[];
}
```

`InvoiceContext` — see "Context loading" below for the exact shape.

## `lib/rules/stats.ts`

One helper, not in the task's file list but needed by three rules:

```ts
function median(values: number[]): number | null
```

Pure, no I/O. Returns `null` for an empty array (rules treat that as "no
baseline, skip").

## Context loading (`lib/rules/context.ts`)

The only file in `lib/rules` that touches the DB. `loadContext(db, invoiceId)`
performs two round trips:

1. One `execute` for the invoice row itself (needed to know its
   `supplier_id`, `entity_id`, `contract_id` before the rest can be
   fetched).
2. One `db.batch` for everything that only depends on those ids: supplier
   row, full IBAN history for the supplier (ordered by `effective_from`
   desc — gives current + previous), risk events for the supplier, the
   linked contract (skipped if `contract_id` is null), approved invoices
   for this supplier across **all** entities in the last
   `RISK_WINDOW_MONTHS` (12 months) with `entity_id`, distinct categories
   *ever* approved at this subsidiary (no date bound — "ever" per spec,
   deliberately not limited to 12 months, unlike the group-approved list),
   and all other invoices from this supplier of any status (for duplicate
   detection).

```ts
interface InvoiceContext {
  invoice: {
    id: string; entityId: string; entityName: string; supplierId: string;
    contractId: string | null; invoiceNumber: string; category: string;
    amountExclVatCents: number; amountInclVatCents: number;
    dueDate: string; issueDate: string;
    printedIban: string; printedSiren: string; printedVatNumber: string;
  };
  supplier: { id: string; name: string; siren: string; vatNumber: string };
  ibanHistory: { iban: string; effectiveFrom: string }[]; // desc
  riskEvents: { eventDate: string; description: string }[];
  contract: {
    id: string; category: string; expectedAmountCents: number | null;
  } | null;
  groupApprovedInvoices: {
    entityId: string; entityName: string; category: string;
    amountExclVatCents: number; dueDate: string;
  }[]; // this supplier, all entities, approved, last 12 months
  subsidiaryApprovedCategories: string[]; // this entity, approved, all time
  otherSupplierInvoices: {
    id: string; invoiceNumber: string; status: string;
    amountInclVatCents: number; issueDate: string; entityId: string;
  }[]; // this supplier, any status, excluding the invoice itself
}
```

Known simplification: "new to the group" and the recurring/peer counts all
read from `groupApprovedInvoices` (the same 12-month window). A supplier
with no approved invoice in the last 12 months but one 13+ months ago would
read as "new" again. Not exercised by any of the 13 seed scenarios (longest
history is exactly 12 months); acceptable for the demo.

## Rules (`lib/rules/rules/*.ts`)

Each file exports a default `(ctx: InvoiceContext, today: Date) => Reason | null`.
Deviation comparisons only ever look at *upward* deviation (`amount_ht` above
the baseline) — a cheaper-than-usual invoice never triggers.

1. **deviation-history** — median of the last `HISTORY_SAMPLE` (6) approved
   invoices from `groupApprovedInvoices` filtered to same entity + category
   as this invoice (skip if the filtered list is empty). `> DEVIATION_RED`
   → red `DEVIATION_HISTORY_HIGH`; `> DEVIATION_ORANGE` → orange
   `DEVIATION_HISTORY`.
2. **deviation-contract** — same comparison against `contract.expectedAmountCents`
   (skip if no contract or no expected amount). `DEVIATION_CONTRACT_HIGH` /
   `DEVIATION_CONTRACT`.
3. **deviation-peer** — median of `groupApprovedInvoices` filtered to
   *other* entities + same category (skip if empty). `DEVIATION_PEER_HIGH` /
   `DEVIATION_PEER`.
4. **duplicate-number** — any entry in `otherSupplierInvoices` with the same
   `invoiceNumber` → red `DUPLICATE_NUMBER`.
5. **duplicate-amount** — any entry in `otherSupplierInvoices` with the same
   `amountInclVatCents`, same `entityId`, and `issueDate` within
   `DUPLICATE_WINDOW_DAYS` (60) of this invoice's `issueDate` → red
   `DUPLICATE_AMOUNT`.
6. **iban-mismatch** — `printedIban` ≠ current registered IBAN (first entry
   of `ibanHistory`) → red `IBAN_MISMATCH`.
7. **iban-recently-changed** — current IBAN's `effectiveFrom` within
   `IBAN_RECENT_CHANGE_DAYS` (90) of `today` → red `IBAN_RECENTLY_CHANGED`.
8. **iban-foreign** — `printedIban` country code (first two characters) ≠
   `"FR"` → red `IBAN_FOREIGN`.
9. **identity-mismatch** — fires red `IDENTITY_MISMATCH` if any of: printed
   SIREN ≠ registry SIREN; printed VAT ≠ registry VAT; or (when the printed
   SIREN is a well-formed 9-digit number) `computeVatKey(printedSiren)` ≠
   the two-digit key embedded in `printedVatNumber`. One reason, message
   describes whichever check(s) failed; `data` carries all four raw values
   regardless.
10. **exceptional-amount** — `amountExclVatCents > EXCEPTIONAL_AMOUNT` → red.
11. **new-supplier** — `groupApprovedInvoices` is empty for this supplier →
    `amountExclVatCents > NEW_SUPPLIER_AMOUNT` ? red `NEW_SUPPLIER_LARGE` :
    orange `NEW_SUPPLIER_SMALL`.
12. **no-contract** — `contractId === null` → orange `NO_CONTRACT`.
13. **unusual-category** — `category` not in `subsidiaryApprovedCategories`
    → orange `UNUSUAL_CATEGORY`.
14. **not-recurring** — only when the supplier is *not* new (i.e.
    `groupApprovedInvoices` is non-empty): count entries in
    `groupApprovedInvoices` matching this entity < `RECURRING_MIN_INVOICES`
    (3) → orange `NOT_RECURRING`.
15. **supplier-risk** — any `riskEvents` entry with `eventDate` within
    `RISK_WINDOW_MONTHS` (12) of `today` → red `SUPPLIER_RISK`.

Messages are French, short, concrete, with numbers, formatted via
`lib/format.ts`, e.g.:
- `"Montant 4 200 € HT, 20 % au-dessus de l'historique (médiane 3 500 € HT sur 6 factures)"`
- `"IBAN modifié il y a 5 jours (ancien : FR76 …1234)"`
- `"Même numéro de facture que HIST-AQUA-REALESTATE-M6, validée le 15/03"`

Exact wording is not test-asserted (tests check level + code), so minor
phrasing is at implementation time, following these examples and CLAUDE.md's.

## `lib/rules/engine.ts`

`classify(ctx, today)`: run all 15 rule functions, collect non-null reasons.
If empty, append one informational green `ALL_CHECKS_PASSED` reason with
`data` summarizing whatever baseline was available (contract label, history
sample count + median, deviation % — best-effort, since by definition
nothing breached threshold). `level` = highest severity present among
reasons (red > orange > green). Reasons sorted red-first, stable within a
level (rule execution order).

## `lib/rules/classify-all.ts`

For every invoice with `status = 'pending'`: `loadContext`, `classify`,
then delete any existing `classifications` row for that `invoice_id` and
insert a fresh one (`id`, `invoice_id`, `level`, `reasons` as JSON,
`rules_version`). All deletes+inserts across all pending invoices run in one
`db.batch` at the end, so rerunning `classify-all` (e.g. after a rules
change) is idempotent without a full reseed.

`lib/db/seed.ts`'s `seed()` calls `classifyAll(db)` at the end, so
`npm run seed` / `resetDemo` always leave pending invoices classified.
`scripts/classify.ts` (new, same pattern as `migrate.ts`/`seed.ts`) exposes
it standalone as `npm run classify`.

## Seed changes

`ExpectedClassification` gains `expectedCode: ReasonCode`. All 13 existing
pending scenarios map to a distinct rule code with **no seed data changes**:

| Invoice | Level | Code |
|---|---|---|
| PEND-NOVALINK-01 | green | `ALL_CHECKS_PASSED` |
| PEND-CLOUDNIMBUS-01 | green | `ALL_CHECKS_PASSED` |
| PEND-FONTAINE-01 | orange | `DEVIATION_HISTORY` |
| PEND-PIXELFORGE-01 | orange | `NEW_SUPPLIER_SMALL` |
| PEND-TRANSLOGISTIQUE-01 | orange | `NO_CONTRACT` |
| PEND-KLAXON-01 | orange | `UNUSUAL_CATEGORY` |
| HIST-AQUA-REALESTATE-M6 | red | `DUPLICATE_NUMBER` |
| PEND-GREENWAVE-01 | red | `IBAN_RECENTLY_CHANGED` |
| PEND-MERIDIAN-01 | red | `IBAN_FOREIGN` |
| PEND-ONDINE-01 | red | `IDENTITY_MISMATCH` |
| PEND-ATLAS-01 | red | `EXCEPTIONAL_AMOUNT` |
| PEND-SOLSTICE-01 | red | `DEVIATION_PEER_HIGH` |
| PEND-CORVUS-01 | red | `SUPPLIER_RISK` |

Several invoices trigger more than one reason (e.g. Klaxon also gets
`NO_CONTRACT` alongside `UNUSUAL_CATEGORY`); the integration test asserts
the expected code is *present*, not that it's the only one.

## Verification page

`getPendingInvoices` (or a new query) joins the stored `classifications`
row. `app/page.tsx` adds two columns: a colored dot for `level` (green /
orange / red) and the reason messages (one per line), keeping the existing
due-date sort.

## Testing

- 15 rule test files (one per rule file): a triggering context, one just
  below threshold that doesn't trigger, and the documented edge cases (no
  history, no contract, no peers, etc).
- `engine.test.ts`: level aggregation (red beats orange beats green) and
  reason ordering.
- `classify-all.test.ts` (integration): fresh in-memory libSQL DB
  (`createClient({ url: ":memory:" })`), `migrate` + `seed`, then assert
  each of the 13 scenarios (named after `scenario`) has the expected level
  and that `expectedCode` is present among its reasons.

## Done when

- `npm test` passes, including all 13 scenario assertions.
- `npm run build` has no type errors.
- Home page shows 2 green, 4 orange, 7 red.
- No seed data changes were needed to hit the expected level/code per
  scenario (documented above) — schema changes (`issue_date`,
  `printed_vat_number`, `rules_version`) were needed instead, per the
  discussion in "Schema changes".
