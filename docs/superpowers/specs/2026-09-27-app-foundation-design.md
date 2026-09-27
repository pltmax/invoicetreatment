# App foundation: scaffold, DB layer, schema, demo seed

Date: 2026-09-27
Status: approved

## Scope

Set up the foundation of the invoice-approval app described in `CLAUDE.md`:
project scaffold, async DB layer over libSQL, schema, and a deterministic demo
seed. No rules engine, no real UI — just a plain verification page.

## Stack

- Next.js 15, App Router, TypeScript strict, Tailwind
- `@libsql/client` (not better-sqlite3 — no persistent filesystem on Vercel)
- Vitest for unit tests
- npm as package manager
- tsx for running DB scripts

## DB client

`lib/db/client.ts`:
- Single exported client: `createClient({ url: process.env.TURSO_DATABASE_URL ?? "file:data/app.db", authToken: process.env.TURSO_AUTH_TOKEN })`
- `import "server-only"` at the top of every file under `lib/db/`
- All access is async
- Multi-statement writes go through `db.batch([...], "write")` for atomicity
- Schema application (`schema.sql`) uses `client.executeMultiple()` — DDL statements aren't transactional in SQLite regardless, so batch isn't needed there

## Schema (`lib/db/schema.sql`)

Exactly these tables, `DROP TABLE IF EXISTS` (reverse dependency order) then
`CREATE TABLE` for a clean migrate:

- **entities**: `id, name, sector` — sector is one of telecom/media/real_estate/services
- **suppliers**: `id, name, siren (unique), vat_number` — no `iban` column. The
  registered IBAN is derived (latest row in `iban_history`), so there's one
  source of truth instead of a column that can drift out of sync with history.
- **iban_history**: `id, supplier_id, iban, effective_from` — first row per
  supplier is the original registration; later rows are changes. This is what
  lets the (future) rules engine detect "IBAN changed N days ago."
- **risk_events**: `id, supplier_id, event_date, description` — no boolean
  flag on suppliers; "active risk flag" is simply "a recent row exists here."
- **contracts**: `id, entity_id, supplier_id, category, expected_amount_cents
  (nullable), start_date, end_date (nullable)` — scoped to entity+supplier+category,
  which is what allows one supplier to serve multiple subsidiaries at
  different rates (needed for the "subsidiary A pays 2x subsidiary B" scenario).
- **invoices**: `id, entity_id, supplier_id, contract_id (nullable),
  invoice_number, category, amount_excl_vat_cents, amount_incl_vat_cents,
  due_date, printed_iban, printed_siren, status (pending/approved/rejected)`
- **classifications**: `id, invoice_id (unique), level, reasons (JSON array),
  created_at` — populated only for already-decided invoices (the 12 months of
  seeded history). Pending demo invoices get no row here; their expected
  level/scenario live only in the seed's separate exported array.
- **sessions**: `id, kind (batch/single), content_hash (SHA-256), signed_at` —
  a "batch" session is one bordereau covering many green/orange invoices; a
  "single" session is one bordereau per red invoice (one signature per invoice).
- **decisions**: `id, session_id, invoice_id (unique), outcome
  (approved/rejected)` — links invoices to the session that decided them.

Bordereau content hash: SHA-256 over canonical JSON
`{sessionId, decisions:[{invoiceId, outcome}], signedAt}`. Seed history uses
the same construction as the real signing flow will, so history stays coherent.

## Checks (`lib/checks/`)

Pure functions, unit tested, reused later by the rules engine:
- `siren.ts`: Luhn validation/generation for 9-digit SIREN
- `vat.ts`: FR VAT key = `(12 + 3 * (SIREN mod 97)) mod 97`, zero-padded to 2
  digits; builds `FR{key}{siren}`
- `iban.ts`: general IBAN mod-97 check-digit algorithm (not just the French RIB
  key), so it can also produce the "foreign printed IBAN" scenario (e.g. a
  syntactically valid DE IBAN)

## Scripts

`package.json`:
- `db:migrate` — applies `schema.sql` (drop + recreate all tables)
- `db:seed` — inserts demo data
- `db:reset` — migrate then seed

All three run via `tsx -r dotenv/config`, with `DOTENV_CONFIG_PATH=.env.local`.
dotenv silently no-ops when the file doesn't exist, so one invocation works
identically against the local file or Turso without depending on Node-version
support for `--env-file-if-exists`.

`.env.example` lists both `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` (empty).
`data/` and `.env*.local` are gitignored.

## Seed (`lib/db/seed.ts`)

`export async function seed(db)` — callable from the script and from a server
action. Deterministic: a single `today` reference computed once per run, all
dates derived from it, no unseeded randomness.

- 4 fictional entities, one per sector (telecom, media, real_estate, services)
- ~10 fictional suppliers with Luhn-valid SIRENs, computed VAT numbers,
  mod-97-valid French IBANs (registered via `iban_history`)
- 12 months of approved history for recurring suppliers: matching contracts,
  ±5% variance, each with a `classifications` row (green, reasons filled in by
  hand since the rules engine doesn't exist yet), and a signed `sessions` +
  `decisions` row so the history is fully coherent
- 13 pending invoices, due dates spread over the next 3 weeks (so sorting by
  due date is visible), each triggering exactly one scenario:

| Scenario | Expected level |
|---|---|
| Recurring telecom maintenance matching contract | green |
| Recurring cloud hosting matching contract | green |
| Known supplier, +20% vs its history | orange |
| New supplier, 3 000 € HT | orange |
| Known supplier, no contract attached | orange |
| Marketing spend at the telecom subsidiary (category never seen there) | orange |
| Same supplier and invoice number as an already approved one | red |
| Known supplier whose registered IBAN changed 5 days ago | red |
| FR supplier with a foreign printed IBAN | red |
| Printed SIREN differs from the registry | red |
| 80 000 € HT equipment purchase | red |
| Same supplier and category, subsidiary A billed 2x what subsidiary B pays | red |
| Supplier with a risk event 2 months ago | red |

- `export const expectedClassifications: Array<{ invoiceNumber: string; scenario: string; expectedLevel: "green" | "orange" | "red" }>` keyed by `invoiceNumber` (matches `invoices.invoice_number`) — not written to the DB, just exported for future rules-engine tests to assert against.

## Server action

`app/actions/demo.ts`: `resetDemo()` calls migrate then seed.

## Verification page

Replace the default home page (`app/page.tsx`) with a server-rendered table of
the 13 pending invoices — supplier, subsidiary, amount TTC, due date, scenario
— sorted by due date, plus a "Réinitialiser la démo" button wired to
`resetDemo()`. Minimal styling, readability only.

## Testing

Vitest unit tests for `lib/checks/`: Luhn (trigger + non-trigger), VAT key
computation, IBAN checksum (valid + invalid cases).

## Out of scope (unchanged from CLAUDE.md)

Rules engine, real UI, email ingestion, e-signature provider, notifications,
non-FR suppliers, accounting integrations.

## Done when

- `npm run db:reset` works with and without Turso env vars
- `npm test` passes
- `npm run build` passes with no type errors
- The home page lists all 13 pending invoices sorted by due date
