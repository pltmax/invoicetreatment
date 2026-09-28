# Editable classification thresholds — design

Date: 2026-09-28
Status: approved for planning

## Goal

Give the CEO a "Règles" tab that lists every classification rule, grouped by
severity (Rouge / Orange), showing its current threshold value in the right
unit, editable inline. Saving writes the new thresholds and immediately
reclassifies pending invoices against them. No auth/audit — consistent with
the rest of the demo's scope (CLAUDE.md: "Out of scope: ... Auth / login").

## Why this touches the rules engine

`lib/rules/thresholds.ts` currently exports 9 plain constants
(`DEVIATION_ORANGE`, `DEVIATION_RED`, `NEW_SUPPLIER_AMOUNT`,
`EXCEPTIONAL_AMOUNT`, `IBAN_RECENT_CHANGE_DAYS`, `RISK_WINDOW_MONTHS`,
`DUPLICATE_WINDOW_DAYS`, `RECURRING_MIN_INVOICES`, `HISTORY_SAMPLE`) imported
directly by 9 rule files, by `context.ts` (for its cutoff query), and by the
invoice detail page (for its history-table slice). Making them
user-editable means moving the *values* into the DB; the rule functions stay
pure by reading them off `ctx.thresholds` instead of importing a constant —
`context.ts` already does DB I/O to assemble everything else a rule needs, so
loading thresholds there is consistent with the existing architecture, not a
new exception to it.

`RULES_VERSION` is not part of this — it versions the rule *engine code*,
not a tunable business value, and stays a static constant.

## Schema changes

New singleton-row table, one column per constant:

```sql
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
```

Row id is the literal string `'default'`. `seed.ts` inserts it with the
current hardcoded values, so "Réinitialiser la démo" also resets thresholds
— no special-casing needed, it falls out of the existing reset flow.

## `lib/rules/thresholds.ts`

Becomes the type + default values, not the live values:

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

export const RULES_VERSION = "1.0.0"; // unchanged, unrelated to thresholds
```

## `lib/rules/types.ts`

`InvoiceContext` gains `thresholds: Thresholds`.

## `lib/rules/context.ts`

`loadContext` fetches the `thresholds` row first (new
`SELECT * FROM thresholds WHERE id = 'default'`, mapped to `Thresholds`),
uses `thresholds.riskWindowMonths` in place of the current
`RISK_WINDOW_MONTHS` import for the `cutoff` calculation, and includes
`thresholds` in the returned object.

## Rule files — exact changes

Each swaps its `thresholds.ts` import for reading off `ctx.thresholds`:

| File | Constant(s) → context field |
|---|---|
| `deviation-history.ts` | `DEVIATION_ORANGE`/`DEVIATION_RED`/`HISTORY_SAMPLE` → `ctx.thresholds.deviationOrange`/`.deviationRed`/`.historySample` |
| `deviation-contract.ts` | `DEVIATION_ORANGE`/`DEVIATION_RED` → same fields |
| `deviation-peer.ts` | `DEVIATION_ORANGE`/`DEVIATION_RED` → same fields |
| `duplicate-amount.ts` | `DUPLICATE_WINDOW_DAYS` → `ctx.thresholds.duplicateWindowDays` |
| `iban-recently-changed.ts` | `IBAN_RECENT_CHANGE_DAYS` → `ctx.thresholds.ibanRecentChangeDays` |
| `exceptional-amount.ts` | `EXCEPTIONAL_AMOUNT` → `ctx.thresholds.exceptionalAmountCents` |
| `new-supplier.ts` | `NEW_SUPPLIER_AMOUNT` → `ctx.thresholds.newSupplierAmountCents` |
| `not-recurring.ts` | `RECURRING_MIN_INVOICES` → `ctx.thresholds.recurringMinInvoices` |
| `supplier-risk.ts` | `RISK_WINDOW_MONTHS` → `ctx.thresholds.riskWindowMonths` |

No other rule files change (`duplicate-number`, `iban-mismatch`,
`iban-foreign`, `identity-mismatch`, `no-contract`, `unusual-category` have
no threshold dependency).

## `app/(app)/invoices/[id]/page.tsx`

Drops its `import { HISTORY_SAMPLE } from "@/lib/rules/thresholds"` and uses
`context.thresholds.historySample` instead — `context` is already in scope
from its existing `loadContext` call.

## `lib/db/queries.ts`

New `getThresholds(db)` returning the row mapped to `Thresholds` (camelCase),
reused by the `/rules` page and by a shared helper `context.ts` also calls
(single query implementation, not duplicated).

## Settings page — `app/(app)/rules/page.tsx`

Nav gains a fourth item, "Règles" (between Notifications and the gear icon),
using a simple scale/balance-style inline icon consistent with the other
three.

Page layout mirrors the approved mockup: two sections, "Rouge" and "Orange"
headed the same way group headers are on the dashboard (colored dot +
`LevelBadge`-style label, reusing the component). One `<form>` wraps every
field:

- **Rouge**
  - Montant exceptionnel (€, `exceptionalAmountCents`)
  - Écart vs historique/contrat/filiale — rouge (%, `deviationRed`)
  - IBAN modifié récemment (jours, `ibanRecentChangeDays`)
  - Événement de risque fournisseur (mois, `riskWindowMonths`)
  - Facture en double — fenêtre (jours, `duplicateWindowDays`)
- **Orange**
  - Écart vs historique/contrat/filiale — orange (%, `deviationOrange`)
  - Nouveau fournisseur — seuil (€, `newSupplierAmountCents`)
  - Minimum de factures pour être "récurrent" (nombre, `recurringMinInvoices`)
  - Taille de l'échantillon d'historique (nombre, `historySample`)

Each row: label, one-line caption of what it controls (reusing the rule's
existing message wording as a guide), and a right-aligned input sized to its
unit. € inputs are plain `<input type="number" step="1">` in whole euros
(converted to/from cents at the form boundary, matching how
`session-review.tsx` already keeps euros in the UI and cents in the DB);
% inputs are whole numbers (`15` meaning 15%, converted to/from the `0.15`
ratio the engine uses); day/month/count inputs are plain integers.

One submit button, "Enregistrer les règles". A confirmation
(`revalidatePath` + a `?saved=1`-style flash, matching no existing pattern
exactly — simplest is a `searchParams`-driven banner like other pages
already do with plain state) shows after a successful save.

## Server action — `app/actions/thresholds.ts`

```ts
export async function updateThresholds(formData: FormData): Promise<void>
```

- Parses all 9 fields as numbers; any that fail `Number.isFinite` or are
  `<= 0` (all thresholds are meaningfully positive) redirects back to
  `/rules?error=invalid`.
- Validates `deviationRed > deviationOrange` (strictly — if red's cutoff
  isn't above orange's, the orange band becomes unreachable); violation
  redirects to `/rules?error=order`.
- Converts € fields to cents (`Math.round(value * 100)`) and % fields to
  ratios (`value / 100`).
- `UPDATE thresholds SET ... WHERE id = 'default'`.
- Calls `classifyAll(db)` so pending invoices reflect the new rules
  immediately (same call `seed()` already makes).
- `revalidatePath("/rules")`, `revalidatePath("/")`, redirect to
  `/rules?saved=1`.

The `/rules` page reads `searchParams` for `saved`/`error` and shows a small
inline banner — no new UI component needed, same pattern as existing pages
reading query state.

## Testing

- `lib/rules/test-fixtures.ts`: its context-builder gains
  `thresholds: DEFAULT_THRESHOLDS` so all 15 existing rule test files keep
  passing with zero changes to their own code.
- One new test per rule that reads a threshold (9 files): construct a
  context with a *non-default* threshold and assert the rule's outcome
  changes accordingly (e.g. `exceptional-amount.test.ts` gets a case where
  a normally-fine amount trips red because the test context lowers
  `exceptionalAmountCents`).
- `lib/db/queries.test.ts`: `getThresholds` returns the seeded defaults.
- New `app/actions/thresholds.test.ts` (or colocated logic test if the
  validation is extracted to a plain function — preferred, keeps the
  validation unit-testable without a DB): rejects `deviationRed <=
  deviationOrange`, rejects non-positive values, accepts a valid update.
- `lib/db/seed.test.ts`: assert the `thresholds` row exists post-seed with
  the documented defaults.

## Done when

- `npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run build` all pass.
- `/rules` shows all 9 values grouped Rouge/Orange, matching the seeded
  defaults right after a reset.
- Editing `exceptionalAmountCents` down and saving immediately changes which
  pending invoices show red on the dashboard, without a manual reset.
- `npm run demo:check` (or `/demo-check`) still passes right after
  "Réinitialiser la démo" — thresholds reset to defaults along with
  everything else.
- Full click-through (dashboard → Règles → edit → save → dashboard) shows
  no console errors.
