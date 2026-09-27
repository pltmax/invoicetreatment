# Approval UI — design

Date: 2026-09-28
Status: approved for planning

## Goal

Build the four-screen approval flow described in `CLAUDE.md` and the task prompt: a
mobile-first dashboard, invoice detail, batch session review, and an immutable signed
bordereau — the actual decision tool a holding CEO uses from his phone, not a demo
page. No auth, no real e-signature, no real notifications (all explicitly mocked per
`CLAUDE.md`).

## Mismatches with the prompt (resolved here, not questions)

- `lib/db/schema.sql` doesn't exist — schema lives in `lib/db/schema.ts` as an exported
  `SCHEMA_SQL` string. `migrate()` drops and recreates every table on each run (no
  migration framework), so schema changes are made directly in that file, as before.
- `sessions.signature_ref` and `decisions.comment` don't exist yet — added below.
- No `owner_email` anywhere in the data model (no users/contacts table — single-CEO,
  no-auth demo). Mocked deterministically from the subsidiary: `finance@{entity-slug}.interne`.
- `nanoid` is not installed. Per user decision: use `crypto.randomUUID()` instead —
  zero new dependency, same mocked-signature intent.
- No `components/` directory, no `(app)` route group, no shadcn/ui, no font wiring —
  all created fresh here.
- Current `app/page.tsx` (the old debug table with a "Scénario" column) is deleted
  outright, replaced by the new dashboard. The `(app)` route group doesn't change the
  URL — `app/(app)/page.tsx` still serves `/`.

## Resolved design decisions (confirmed with the user)

- **Screen 2's green/orange approve/reject** creates its own `kind='batch'` session
  containing exactly one decision (comment included), signed immediately — the same
  mechanics as red's individual path, just tagged `batch` instead of `single`. The
  dashboard's checkbox multi-select + Screen 3 is the *other*, independent way to batch
  multiple invoices into one session. Both are valid batch bordereaux; red never uses
  either — it only ever gets `kind='single'`.
- **Screen 3 is approve-only.** The dashboard button says "Approuver la sélection," and
  Screen 3 "marks each invoice approved" — there is no reject path through the
  multi-select flow. A rejection (rare for green/orange) goes through Screen 2's
  single-item path instead. No comment field on Screen 3 itself.
- **Dashboard selection is ephemeral client state**, not persisted across navigation or
  refresh — matches how Ramp/Brex queues actually behave; nothing in the prompt asks
  for cross-page persistence.
- **Signature ref:** `crypto.randomUUID()`, not `nanoid`.

## Schema changes (`lib/db/schema.ts`)

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

`lib/db/seed.ts`'s 12 historical batch-session inserts (one per month of history) gain a
deterministic `signature_ref` — `` `MOCK-${sessionId}` `` — since seed data must stay
reproducible; no real randomness there. Live sessions created by the app use
`` `MOCK-${crypto.randomUUID()}` ``.

`lib/rules/context.ts`'s `InvoiceContextInvoice` gains one field, `status`, from one
extra column in its existing invoice `SELECT` (`invoices.status AS status`). Nothing
downstream currently reads it; this only enables Screen 2 to detect an already-decided
invoice without a second query.

## Data layer

### `lib/db/queries.ts`

- `getPendingInvoices(db)` — **change**: `reasonMessages: string[]` becomes
  `reasons: Reason[]` (full shape, so the dashboard can pick the first red/orange reason
  by level and Screen 3 can re-derive the same top-reason display). Update
  `queries.test.ts`'s one assertion on the old shape.
- `getClassification(db, invoiceId): Promise<{level: Level; reasons: Reason[]; rulesVersion: string; createdAt: string} | null>` — new.
- `getInvoicesByIds(db, ids: string[]): Promise<PendingInvoiceRow[]>` — new. Same shape
  as `getPendingInvoices`, filtered to the given ids AND `status = 'pending'` — this is
  Screen 3's authoritative re-fetch; never trust the ids a client sent without
  re-checking eligibility server-side.
- `getDecisionSessionId(db, invoiceId): Promise<string | null>` — new. For Screen 2's
  "already decided" state (link to the existing bordereau instead of an action form).
- `getSessionWithDecisions(db, sessionId): Promise<BordereauData | null>` — new. Session
  row (`id, kind, content_hash, signature_ref, signed_at`) joined to every decision,
  each decision joined to its invoice/supplier/entity and to `classifications` (via
  `invoice_id`) for the level *at decision time* — which is exactly the invoice's frozen
  classification row, since `classifyAll` only ever touches `status = 'pending'`
  invoices and this one no longer is.

### `lib/sessions.ts` (new)

The only place that creates a session. Both server actions call this — the
atomicity/hashing logic exists exactly once.

```ts
interface DecisionInput {
  invoiceId: string;
  amountInclVatCents: number;
  outcome: "approved" | "rejected";
  comment: string | null;
}

export async function createSession(
  db: Client,
  kind: "batch" | "single",
  decisions: DecisionInput[]
): Promise<{ sessionId: string; contentHash: string; signatureRef: string; signedAt: string }>
```

- Generates `sessionId` (`` `ses-${crypto.randomUUID()}` ``), `signedAt` (`new Date().toISOString()`),
  `signatureRef` (`` `MOCK-${crypto.randomUUID()}` ``).
- Canonical hash input (mirrors the precedent already in `seed.ts`):
  ```ts
  JSON.stringify({
    sessionId,
    kind,
    decisions: [...decisions]
      .sort((a, b) => a.invoiceId.localeCompare(b.invoiceId))
      .map((d) => ({ invoiceId: d.invoiceId, amountInclVatCents: d.amountInclVatCents, outcome: d.outcome })),
    signedAt,
  })
  ```
  hashed with the existing `sha256Hex` pattern (SHA-256, hex).
- One `db.batch(..., "write")`: insert the `sessions` row, one `decisions` row per
  input, and one `UPDATE invoices SET status = ? WHERE id = ?` per input (`'approved'`
  or `'rejected'` matching that decision's outcome) — the bordereau must never be
  partially written.
- Console.logs `Notification envoyée à {email}` per decision (mocked), where `email` is
  derived from the invoice's subsidiary: `` `finance@${slug(entityName)}.interne` ``,
  with `slug()` = lowercase, strip accents (`normalize("NFD")` + strip combining marks),
  replace every run of non-alphanumeric characters with a single `-`, trim leading/
  trailing `-` (e.g. "Arcadia Télécom" → "arcadia-telecom"). Screen 4 re-derives and
  displays the same lines (see below) — no state needs to travel through the redirect.

### `app/actions/sign.ts` (new)

Two thin server actions, both calling `createSession` then `redirect(`/sessions/${sessionId}`)`:

- `createBatchSession(formData)` — reads a repeated `ids` field, calls
  `getInvoicesByIds`, builds one `approved` decision per invoice (no comment), calls
  `createSession(db, "batch", decisions)`.
- `signSingleDecision(formData)` — reads `invoiceId`, `outcome`, `comment`. Re-fetches
  that invoice's current classification level to pick `kind` (`red` → `"single"`,
  else `"batch"`), calls `createSession(db, kind, [oneDecision])`.

Both re-validate `status === 'pending'` server-side before writing (defends against a
stale page / double-submit).

## Routes

```
app/(app)/layout.tsx              — minimal shared chrome: title, small "Réinitialiser" link
app/(app)/page.tsx                — Screen 1
app/(app)/invoices/[id]/page.tsx  — Screen 2
app/(app)/sessions/new/page.tsx   — Screen 3
app/(app)/sessions/[id]/page.tsx  — Screen 4
app/actions/sign.ts               — new
app/actions/demo.ts               — unchanged (resetDemo), now surfaced from the shared layout
```

`app/page.tsx` (old debug table) is deleted.

## Shared components (`components/`)

- `level-badge.tsx` — `<LevelBadge level="red" />`. Colored dot + French label
  (Vert/Orange/Rouge), reused verbatim from the existing `page.tsx` logic being deleted.
- `amount.tsx` — `<Amount cents={...} />`, right-aligned, `tabular-nums`, uses
  `formatEuros` from `lib/format.ts`.
- `reason-list.tsx` — `<ReasonList reasons={Reason[]} />`, one line per reason with its
  message; when `data` carries recognizable numeric fields (deviation %, amounts), format
  them via `lib/format.ts` inline rather than dumping raw JSON.

Screen-specific interactive pieces (checkbox+sticky-bar on the dashboard, the removable
list on Screen 3, the copy-hash and print buttons on Screen 4) are client components
local to their own route folder — they are not reused elsewhere, so they don't belong
in `components/`.

## Visual system

- Inter via `next/font/google`, wired into the root `app/layout.tsx`.
- `tailwind.config.ts`: add `"./components/**/*.{ts,tsx}"` to `content`; override
  `theme.borderRadius.DEFAULT` to `"8px"`. Every container in every screen uses the bare
  `rounded` class — never `rounded-sm/md/lg/xl`. The one exception is `rounded-full` on
  the level-badge dot itself (a status dot is legitimately circular, not a container).
- Tailwind's default spacing scale already is 4/8/12/16/24/32 (`p-1..p-8` etc.) — no
  config change, just discipline in which utilities get used.
- One accent, `blue-600`, for primary actions only (Signer, Approuver la sélection).
  Everything else is the Tailwind gray scale plus green/orange/red for level meaning.
  No gradients, no shadows beyond `shadow-sm` at most (elevation for the sticky bar
  only), no emoji.
- Screen 1 is a **list**, not a `<table>` — a `<table>` cannot reflow at 375px without
  horizontal scroll, and the brief requires full usability at that width. Each row is a
  flex column that stacks: line 1 = level dot + supplier name + right-aligned amount;
  line 2 = subsidiary · due date; line 3 = top reason (truncated). Divided by
  `border-b`, no per-row shadow/radius — this is a list, not cards.
- The bottom action bar is `fixed bottom-0 inset-x-0`, only rendered once
  `selectedIds.length > 0`, safe-area-aware padding, button height ≥44px (one-thumb
  reachable).

## Screen 1 — Dashboard

- Server component fetches `getPendingInvoices(db)` (already sorted `due_date ASC`).
- Renders a client component `InvoiceList` that:
  - Groups the already-date-sorted array by level in JS order **rouge → orange → vert**
    (a stable partition preserves each group's existing due-date order — no re-sort
    needed).
  - Header stats: count per level + total `amountInclVatCents` pending, computed by
    reducing the same array (no new query).
  - Renders a checkbox only on green/orange rows; red rows get an "Examiner" button
    instead (no checkbox). Row click (outside the checkbox's own hit area, which
    stops propagation) navigates to `/invoices/[id]` for every row, red included.
  - Sticky bottom bar appears once ≥1 row is selected: "Approuver la sélection en lot
    (N factures, X €)" — a `<form action={createBatchSession}>` with one hidden `ids`
    input per selected id, submitting via the bound server action.
- Empty state: "Aucune facture en attente." when the list is empty.

## Screen 2 — Invoice detail

Server component. Fetches, in parallel: `loadContext(db, id, new Date())`,
`getClassification(db, id)`, and (only if `context.invoice.status !== 'pending'`)
`getDecisionSessionId(db, id)`.

1. **Essentials** — from `context.invoice`/`context.supplier`: supplier, subsidiary
   (`entityName`), amount HT/TTC (`<Amount>`), issue/due dates, category.
2. **Classification** — `<LevelBadge>` + `<ReasonList reasons={classification.reasons}>`.
3. **History** — filter `context.groupApprovedInvoices` to
   `entityId === context.invoice.entityId && category === context.invoice.category`
   (the same two conditions `deviation-history.ts` uses internally — the display must
   match what actually drove the classification), take the first `HISTORY_SAMPLE`
   (already ordered newest-first by the loader), render as a small right-aligned table
   (due date, amount HT), with the current invoice's amount shown as a highlighted
   comparison row above it.
4. **Cross-entity comparison (flagship)** — filter `context.groupApprovedInvoices` to
   `entityId !== context.invoice.entityId && category === context.invoice.category`
   (matching `deviation-peer.ts`'s own filter exactly), group the result by `entityId`,
   take each entity's median `amountExclVatCents` (HT — same basis `deviation-peer.ts`
   computes its deviation against). Render as a horizontal bar list (entity name,
   right-aligned median amount HT, a bar scaled to the largest value present) plus the
   current invoice's own `amountExclVatCents` marked distinctly (a differently-colored
   bar or an inline marker on the scale) so the deviation reads at a glance — not just
   as a number, as the actual visual gap.
5. **Contract** — `context.contract`'s label/category/expected amount, or an explicit
   "Aucun contrat rattaché" state when `null`.
6. **Identity** — `context.supplier.siren/vatNumber` vs. `context.invoice.printedSiren/printedVatNumber`,
   and the current IBAN (`context.ibanHistory[0]`) vs. `context.invoice.printedIban`,
   side by side; any mismatch highlighted (red text/background on the differing cell).
7. **IBAN history** — `context.ibanHistory` (already newest-first), each row's IBAN
   grouped in 4-character blocks for readability, dates via `formatDateFr`; the first
   entry marked "Actif".
8. **Action** —
   - If already decided (`status !== 'pending'`): a static "Déjà traitée" notice linking
     to `/sessions/${sessionId}`. No form.
   - Else: a comment `<textarea>` plus two buttons ("Approuver" / "Rejeter"), each a
     `<form action={signSingleDecision}>` submitting `invoiceId`, the chosen `outcome`,
     and the comment. No client JS required for this — plain progressive-enhancement
     forms, per the "server actions, not client fetches" rule.

Empty-state text for sections 3/4 when there is no history / no peers ("Aucun
historique disponible pour ce fournisseur à cette filiale." / "Aucune facture
comparable dans les autres filiales.").

## Screen 3 — Batch session review

Server component reads `ids` from `searchParams` (comma-separated), calls
`getInvoicesByIds(db, ids)` — the authoritative, re-verified list (silently drops any
id that's no longer pending/green/orange, since dashboard state could be stale).

Renders a client component for the removable list (each row: level badge, supplier,
amount, top reason, a remove button that just filters local state — nothing is
persisted until submit) plus a running total/count. "Signer et valider" is a
`<form action={createBatchSession}>` with hidden `ids` inputs reflecting the
current (possibly reduced) client-side list.

Empty state: if `ids` resolves to nothing eligible, show "Aucune facture sélectionnée
n'est plus éligible." with a link back to the dashboard, no submit button.

## Screen 4 — Bordereau

Server component, `getSessionWithDecisions(db, id)`.

- Header: session id, `signed_at` (formatted), a static signer label ("PDG" — no
  auth/user concept exists in this app), kind (`"Lot"` / `"Individuelle"`).
- Notifications block: re-derives `Notification envoyée à {email}` per decision from
  the same subsidiary-email mock `createSession` used server-side at signing time —
  rendered as a persistent small notice list (not an ephemeral toast: this is the audit
  page, it should still show these lines on a page refresh).
- Table of every decision: invoice number, supplier, subsidiary, amount, level at
  decision (from the joined `classifications` row), outcome, comment.
- `content_hash` shown truncated (first 12 + "…" + last 4 chars) with a "Copier" button
  (`navigator.clipboard.writeText`, a small client island).
- Explicit immutability statement ("Ce bordereau est immuable une fois signé.") — no
  edit/delete/undo control exists anywhere on this page, full stop.
- `@media print` rules in `globals.css` hide the layout chrome/buttons (`.no-print`)
  and print a clean table — this is the artifact the CEO would actually forward.

## Red invoices: individual signature

Screen 2's action section is the *only* place a red invoice gets decided.
`signSingleDecision` always resolves `kind = 'single'` for a red invoice's current
classification level, and there is no code path anywhere that lets a red invoice enter
`createBatchSession` (that action only ever fetches green/orange via
`getInvoicesByIds`'s underlying query, and the dashboard never renders a checkbox on a
red row in the first place).

## Testing

Consistent with the codebase's existing pattern (Vitest, in-memory libSQL for anything
touching the DB):

- `lib/sessions.test.ts` — `createSession` for both kinds: correct hash (recomputed
  independently in the test and compared), correct row counts, invoice status flips,
  idempotency is not a concern here (unlike `classifyAll`, a session is created once,
  never re-run).
- `lib/db/queries.test.ts` — extend for the four new/changed query functions.
- No component/UI tests — this codebase has no component-testing setup, and adding one
  is out of scope for this feature. Verification of the four screens is manual
  (`npm run dev`, walk the two end-to-end flows the prompt's "Done when" section
  specifies) plus `npm run build` for type-checking.

## Done when

- `npm run build` passes with no type errors.
- End-to-end: dashboard → select 3 green/orange → sign → bordereau shows the correct
  hash and all 3 decisions.
- End-to-end: one red invoice → detail → sign individually → bordereau.
- After both flows, the dashboard shows 10 pending invoices (13 − 3 − 1).
- Every screen usable at 375px width, bottom action bar reachable one-thumb.
- Any further deviation from the prompt discovered during implementation is reported,
  not silently patched around.
