# PDF extraction layer — design

Date: 2026-09-28
Status: approved for planning

## Goal

Add a "Couche d'extraction" tab that dramatizes the real ingestion pipeline
this demo mocks elsewhere (`invoices@holding.com`, per CLAUDE.md's "Scope
for the demo"). The page explains how production ingestion would actually
work, and lets the CEO simulate it: pick a subsidiary, drag a PDF invoice
onto the page, and a real Claude Sonnet 5 call extracts the invoice's
fields, creates a new pending invoice, classifies it, and hands the CEO
straight to its detail page — the same review flow every other pending
invoice already goes through. The PDF itself is never persisted anywhere;
it exists only in memory for the duration of the one request that extracts
it.

This is the first place in the app that creates an invoice at runtime
rather than from `seed.ts`, so it's also the first place that may need to
create a brand-new supplier (with no history) on the fly.

## Why this reverses a documented scope boundary

CLAUDE.md's current "Out of scope" line doesn't actually mention PDF/OCR
(it lists "accounting tool integrations, non-FR suppliers") — "Real PDF
parsing or OCR" was scoped out in an earlier block's inline prompt, not in
CLAUDE.md itself. But `/inbox`'s caption ("Extraction automatique déjà
effectuée") was deliberately written to read as an intentional boundary,
and CLAUDE.md's "Mocked" line currently implies email ingestion is mocked
end-to-end. The user explicitly asked to reverse that for one
tightly-scoped feature. CLAUDE.md gets a small update as part of this work
(see "CLAUDE.md changes" below) so the next session doesn't read the
"Mocked" line as covering more than it now does.

## New dependencies

`@anthropic-ai/sdk` and `zod` — neither is currently installed. Add via
`npm install @anthropic-ai/sdk zod`.

`ANTHROPIC_API_KEY` — documented in `.env.example` (empty value, matching
the existing `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN` pattern). The user
adds the real value to `.env.local` themselves; nothing in this feature
reads or writes that value except the SDK's own default credential
resolution (`new Anthropic()` reads `ANTHROPIC_API_KEY` from the
environment automatically — no explicit `apiKey:` needed).

## Data flow

1. CEO opens `/extraction`, picks a subsidiary from a dropdown, drags a
   PDF onto the page.
2. Client-side validation: file must be `application/pdf`, under 10 MB.
   (Anthropic's own PDF limits are far higher — 32 MB request, 600 pages —
   this cap is just a sane demo-scale guard, not a platform limit.)
3. Form submits (native `<form action={extractInvoice}>`) to a server
   action. The uploaded `File` arrives via `FormData` — Next.js server
   actions support `File` values in `FormData` natively.
4. The action reads the file into a `Buffer`, base64-encodes it, and calls
   `client.messages.parse()` on `claude-sonnet-5` with the PDF as an
   inline `document` content block (base64, no Files API — inline is what
   makes "never stored" true: nothing is uploaded to Anthropic's Files
   storage, the bytes exist only in this request) plus a Zod schema
   constraining the structured output.
5. The Buffer and base64 string go out of scope when the action returns;
   nothing touches disk or the database except the fields Claude
   extracted.
6. Server-side (not Claude): match the extracted supplier against the
   `suppliers` table by SIREN first, then case-insensitive name. No match
   → create a new supplier (+ one backdated `iban_history` row). Look up
   a matching contract for (entity, supplier), if any.
7. Insert the new `invoices` row as `pending`, classify just that
   invoice, redirect to `/invoices/[newId]`.

## Zod extraction schema (`lib/extraction/schema.ts`)

New file — the schema needs to be importable both by the server action
(to build `zodOutputFormat`) and by its test (to validate fixture data),
so it doesn't belong inside the action file itself.

```ts
import { z } from "zod";

// Mirrors lib/format.ts's CATEGORY_LABELS keys, plus a catch-all. Kept as
// a literal tuple (not derived from CATEGORY_LABELS) so this schema has
// no import-time dependency on lib/format.ts — the enum is the contract
// Claude is constrained to, CATEGORY_LABELS is the display layer for it.
export const EXTRACTION_CATEGORIES = [
  "cloud_hosting",
  "consulting",
  "design",
  "equipment",
  "facilities",
  "fleet",
  "it_integration",
  "logistics",
  "maintenance",
  "marketing",
  "office_supplies",
  "telecom_maintenance",
  "utilities",
  "autre",
] as const;

export const ExtractedInvoiceSchema = z.object({
  supplierName: z.string().describe("Supplier's name exactly as printed on the invoice"),
  printedSiren: z.string().describe("Supplier's SIREN as printed (digits only, no spaces)"),
  printedVatNumber: z.string().describe("Supplier's French VAT number as printed (e.g. FR12345678901)"),
  printedIban: z.string().describe("Supplier's IBAN as printed, no spaces"),
  invoiceNumber: z.string().describe("The invoice's own reference number"),
  category: z.enum(EXTRACTION_CATEGORIES).describe(
    "Best-fitting category for what's being billed. Use \"autre\" only if none of the others fit."
  ),
  amountExclVatCents: z.number().int().describe("Amount excl. VAT, in cents"),
  amountInclVatCents: z.number().int().describe("Amount incl. VAT, in cents"),
  issueDate: z.string().describe("Invoice issue date, ISO 8601 (YYYY-MM-DD)"),
  dueDate: z.string().describe("Payment due date, ISO 8601 (YYYY-MM-DD)"),
});

export type ExtractedInvoice = z.infer<typeof ExtractedInvoiceSchema>;
```

Amounts come back in cents directly (not euros) — the schema's own
description strings tell Claude the unit, which is simpler and removes a
euros→cents conversion step that would otherwise need its own rounding
logic. Dates come back as plain ISO strings, matching how every other date
in this schema (`due_date`, `issue_date`) is already stored — no
conversion needed at the insert site either.

`formatCategory()` in `lib/format.ts` needs one addition: `autre: "Autre"`
in `CATEGORY_LABELS`, so the one schema value that isn't already a display
key resolves to a real label instead of falling back to the raw string.

## Extraction call (`lib/extraction/extract.ts`)

New file — server-only, isolates the Anthropic SDK call from the DB-write
logic in the server action (same separation-of-concerns reasoning as
`lib/rules/threshold-form.ts` vs `app/actions/thresholds.ts`: one file
owns "talk to an external system", the other owns "what to do with the
result").

```ts
import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { ExtractedInvoiceSchema, EXTRACTION_CATEGORIES, type ExtractedInvoice } from "./schema";

const client = new Anthropic();

export class ExtractionError extends Error {}

export async function extractInvoiceFromPdf(pdfBase64: string): Promise<ExtractedInvoice> {
  let response;
  try {
    response = await client.messages.parse({
      model: "claude-sonnet-5",
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: { type: "base64", media_type: "application/pdf", data: pdfBase64 },
            },
            {
              type: "text",
              text: `Extract this invoice's data. If a field is genuinely unreadable, make your best reasonable estimate rather than leaving it blank. For "category", choose the closest fit from: ${EXTRACTION_CATEGORIES.join(", ")}.`,
            },
          ],
        },
      ],
      output_config: { format: zodOutputFormat(ExtractedInvoiceSchema) },
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      throw new ExtractionError(
        "Clé API Anthropic manquante ou invalide — ajoutez ANTHROPIC_API_KEY dans .env.local."
      );
    }
    if (err instanceof Anthropic.APIError) {
      throw new ExtractionError(`Erreur de l'API Claude : ${err.message}`);
    }
    throw err;
  }

  if (!response.parsed_output) {
    throw new ExtractionError(
      "Impossible d'extraire les données de ce PDF. Vérifiez qu'il s'agit bien d'une facture lisible."
    );
  }

  return response.parsed_output;
}
```

No `thinking`/`effort` override — Sonnet 5 runs adaptive thinking by
default, and this is a single well-defined extraction call, not a
cost-sensitive high-volume route, so the defaults are the right choice
(per the claude-api skill's guidance: routes like this "do well at low"
effort *when it's been measured to hold quality* — for a one-off demo
feature where correctness matters more than shaving cost, leaving the
default is the safer call, not a premature optimization).

## Supplier matching + invoice creation (`app/actions/extract-invoice.ts`)

New server action file (`"use server"` + `import "server-only"`, matching
`app/actions/thresholds.ts`'s shape).

```ts
"use server";

import "server-only";
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { db } from "@/lib/db/client";
import { classifyAll } from "@/lib/rules/classify-all";
import { extractInvoiceFromPdf, ExtractionError } from "@/lib/extraction/extract";

const MAX_PDF_BYTES = 10 * 1024 * 1024;

export async function extractInvoice(formData: FormData): Promise<void> {
  const entityId = String(formData.get("entityId") ?? "");
  const file = formData.get("pdf");

  if (!entityId) {
    redirect("/extraction?error=missing-entity");
  }
  if (!(file instanceof File) || file.size === 0) {
    redirect("/extraction?error=missing-file");
  }
  if (file.type !== "application/pdf") {
    redirect("/extraction?error=not-pdf");
  }
  if (file.size > MAX_PDF_BYTES) {
    redirect("/extraction?error=too-large");
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const base64 = buffer.toString("base64");

  let extracted;
  try {
    extracted = await extractInvoiceFromPdf(base64);
  } catch (err) {
    if (err instanceof ExtractionError) {
      redirect(`/extraction?error=extraction&message=${encodeURIComponent(err.message)}`);
    }
    throw err;
  }

  const supplierId = await resolveSupplierId(extracted);
  const contractId = await findContractId(entityId, supplierId);

  const invoiceId = `inv-extracted-${randomUUID()}`;
  await db.execute({
    sql: `INSERT INTO invoices
      (id, entity_id, supplier_id, contract_id, invoice_number, category, amount_excl_vat_cents, amount_incl_vat_cents, issue_date, due_date, printed_iban, printed_siren, printed_vat_number, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
    args: [
      invoiceId,
      entityId,
      supplierId,
      contractId,
      extracted.invoiceNumber,
      extracted.category,
      extracted.amountExclVatCents,
      extracted.amountInclVatCents,
      extracted.issueDate,
      extracted.dueDate,
      extracted.printedIban,
      extracted.printedSiren,
      extracted.printedVatNumber,
    ],
  });

  await classifyAll(db);

  redirect(`/invoices/${invoiceId}`);
}

async function resolveSupplierId(extracted: Awaited<ReturnType<typeof extractInvoiceFromPdf>>): Promise<string> {
  const existing = await db.execute({
    sql: "SELECT id FROM suppliers WHERE siren = ? OR LOWER(name) = LOWER(?)",
    args: [extracted.printedSiren, extracted.supplierName],
  });
  if (existing.rows[0]) {
    return String(existing.rows[0].id);
  }

  const supplierId = `sup-extracted-${randomUUID()}`;
  const oneYearBeforeIssue = new Date(extracted.issueDate);
  oneYearBeforeIssue.setFullYear(oneYearBeforeIssue.getFullYear() - 1);

  await db.batch(
    [
      {
        sql: "INSERT INTO suppliers (id, name, siren, vat_number) VALUES (?, ?, ?, ?)",
        args: [supplierId, extracted.supplierName, extracted.printedSiren, extracted.printedVatNumber],
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

async function findContractId(entityId: string, supplierId: string): Promise<string | null> {
  const result = await db.execute({
    sql: "SELECT id FROM contracts WHERE entity_id = ? AND supplier_id = ?",
    args: [entityId, supplierId],
  });
  return result.rows[0] ? String(result.rows[0].id) : null;
}
```

Notes on choices already made here, so the plan doesn't re-litigate them:

- **New supplier's IBAN is backdated ~1 year, not "today."** If it were
  "today," `iban-recently-changed.ts` would fire red on every single
  brand-new-supplier upload ("IBAN modifié il y a 0 jours") on top of the
  `new-supplier` rule already firing — redundant and misleading, since
  nothing actually *changed*; we've simply never seen this supplier
  before. Backdating means only `new-supplier` (and, naturally,
  `no-contract`, and possibly `unusual-category`) fire, which is the
  correct signal for "we've never dealt with this supplier."
- **`classifyAll(db)` runs, not a narrower single-invoice classify.** It's
  already idempotent and cheap for 13-14 invoices (see the
  editable-thresholds performance fix), and reusing it avoids writing a
  third code path that duplicates `classify-all.ts`'s DELETE+INSERT
  pattern for one row.
- **IDs use fixed prefixes (`inv-extracted-`, `sup-extracted-`)** matching
  the existing convention (`inv-pending-*`, `sup-*`) well enough to be
  recognizable in the DB during a demo, while staying distinguishable
  from seed data.
- **No supplier fuzzy-matching beyond exact SIREN / case-insensitive
  name.** A typo'd or OCR-mangled supplier name on a test PDF will create
  a duplicate supplier rather than match an existing one — acceptable for
  a demo feature; the failure mode is "an extra supplier appears," not
  data corruption.

## `getEntities` query (`lib/db/queries.ts`)

No existing query returns the plain entity list (every existing query
joins through `invoices`). New addition:

```ts
export interface EntityRow {
  id: string;
  name: string;
}

export async function getEntities(db: Client): Promise<EntityRow[]> {
  const result = await db.execute("SELECT id, name FROM entities ORDER BY name");
  return result.rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
  }));
}
```

## Page (`app/(app)/extraction/page.tsx`)

Server component. Fetches `getEntities(db)`, renders the explanation and
the upload form, and reads `searchParams` for the `error`/`message` query
params the action redirects with on failure (same pattern as `/rules`).

Explanation copy (French, matching the project's established tone —
`/inbox`'s "this is deliberately mocked" framing):

> **Comment ça marche en production**
>
> Chaque facture reçue par email à invoices@holding.com serait captée par
> un webhook de réception : la pièce jointe PDF est récupérée
> automatiquement, puis envoyée à Claude pour une extraction structurée
> des données (fournisseur, montants, dates, IBAN...). La facture apparaît
> alors directement dans la file d'attente, classée et prête à être
> examinée — sans aucune intervention humaine.
>
> Pour cette démo, vous pouvez déclencher cette même étape manuellement :
> choisissez la filiale destinataire et déposez un PDF de facture
> ci-dessous. Le PDF n'est jamais stocké : il est transmis à Claude pour
> extraction, puis immédiatement oublié — seules les données extraites
> sont conservées.
>
> Utilisez uniquement des factures fictives (aucune donnée réelle).

## Upload form (`app/(app)/extraction/_components/upload-form.tsx`)

Client component (`"use client"`). Renders the entity `<select>`, a
drop-zone `<div>` with `onDragOver`/`onDrop` handlers that assign the
dropped file to a hidden `<input type="file" name="pdf" accept="application/pdf">`
via `DataTransfer`, and a submit button. Submission stays a normal
`<form action={extractInvoice}>` — no client-side `FormData` construction,
no `fetch` call. A small child component using `useFormStatus()` (from
`react-dom`) shows "Extraction en cours…" and disables the button while
the action is pending, following the same pattern as this codebase's
other pending-state buttons.

Client-side guard before submit: reject non-PDF or >10MB files with an
inline message, so the CEO doesn't wait for a round trip to find out —
the server action re-checks the same constraints regardless, since
client-side validation is never trusted as the real boundary.

## Nav (`app/(app)/_components/nav.tsx`)

One new `LINKS` entry for `/extraction`, labeled "Couche d'extraction",
between `/rules` and the closing bracket — 5th tab, same pattern as the
other four. Icon: a simple upload glyph (arrow into a tray), matching the
existing single-`<path>`, `strokeLinecap`/`strokeLinejoin` "round" style.

## CLAUDE.md changes

Under "Scope for the demo," reword the "Mocked" bullet so it no longer
implies email ingestion is mocked end-to-end:

- `Mocked: email ingestion (invoices@holding.com), e-signature provider, notifications` becomes `Mocked: email ingestion (invoices@holding.com) — except the PDF-extraction step itself, which makes a real Claude Sonnet 5 call (see /extraction); only the email transport and webhook are mocked — e-signature provider, notifications`.
- The "Out of scope" line is unaffected (it never mentioned PDF/OCR).

## Testing

- `lib/extraction/schema.ts`: no dedicated test file — it's a pure schema
  declaration, exercised indirectly by the extract/action tests below.
- `lib/extraction/extract.test.ts`: cannot call the real Claude API in a
  unit test (no key in CI, non-deterministic, costs money per run).
  Instead, test the error-mapping logic in isolation: construct a fake
  `Anthropic.AuthenticationError` / generic `Anthropic.APIError` and
  assert `extractInvoiceFromPdf` rethrows as `ExtractionError` with the
  expected French message. This requires either mocking the `Anthropic`
  client's `messages.parse` (e.g. via `vi.mock("@anthropic-ai/sdk")`) or
  restructuring `extractInvoiceFromPdf` to accept an injected client —
  prefer the `vi.mock` approach to avoid changing the function's public
  signature for testability alone.
- `app/actions/extract-invoice.ts`: the DB-facing helpers
  (`resolveSupplierId`, `findContractId`) are the part worth testing
  without touching the network. Export them (not just the default action)
  so a test can seed a DB, call `resolveSupplierId` with a fixture
  `ExtractedInvoice` twice — once matching an existing seeded supplier by
  SIREN, once with a SIREN/name matching nothing — and assert: (a) the
  existing-match case returns the seeded supplier's real ID and inserts
  no new row; (b) the no-match case creates a new supplier row, exactly
  one `iban_history` row backdated one year before `issueDate`, and
  returns the new ID. Similarly test `findContractId` against seeded
  contract data (a known entity+supplier pair with a contract, and one
  without).
- `lib/format.test.ts`: add `expect(formatCategory("autre")).toBe("Autre")`.
- `lib/db/queries.test.ts`: add a `getEntities` test asserting all 4
  seeded entities come back, sorted by name.

No test exercises the full extraction call end-to-end (would require a
real API key and network access, which CI doesn't have) — the manual
verification step in the implementation plan covers that instead, using a
real (fictional) test PDF once `ANTHROPIC_API_KEY` is set.

## Done when

- `npm run seed`, `npm test`, `npm run lint`, `npx tsc --noEmit`,
  `npm run build` all pass.
- `/extraction` shows the explanation, the entity dropdown (4 entities),
  and a working drag-and-drop zone.
- Dropping a fictional test invoice PDF for an existing seeded supplier
  (matched by SIREN or name) creates a new pending invoice linked to that
  supplier's real history, classifies it, and lands on its detail page.
- Dropping a fictional test invoice PDF for a supplier not in the seed
  data creates a new supplier + one backdated IBAN history row, and the
  resulting invoice classifies as at least `NEW_SUPPLIER_SMALL` or
  `NEW_SUPPLIER_LARGE` (never `IBAN_RECENTLY_CHANGED`, since nothing
  "changed").
- Uploading a non-PDF file, an oversized file, or submitting with no
  subsidiary selected each surface a clear French error without crashing.
- The PDF's bytes are never written to `data/`, the Turso database, or
  any file on disk — verified by reading `extract.ts`/`extract-invoice.ts`
  end to end and confirming no `fs.write*` / `files.upload` call exists
  anywhere in the new code.
- Nav shows 5 tabs + gear and still fits at 375px.
- CLAUDE.md's scope section reflects the new reality.
