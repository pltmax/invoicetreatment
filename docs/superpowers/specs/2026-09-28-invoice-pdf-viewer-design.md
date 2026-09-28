# Invoice PDF storage & viewer — design

Date: 2026-09-28
Status: approved for planning

## Goal

Every invoice gets a generated, credible-looking PDF stored privately in
Vercel Blob. "Voir le PDF" on the invoice detail page and on each row of
a signed bordereau opens it — an iframe modal on mobile, a new tab on
desktop — always through a server route, never a direct Blob URL. The
storage/route design is built so a future drag-and-drop upload feature
can replace generation with a real `File` and change nothing else.

## Data model changes

Both land directly in `lib/db/schema.ts`'s `CREATE TABLE` statements —
this project resets its schema wholesale rather than running incremental
migrations, so there's no separate migration file to write.

```sql
-- suppliers
siret TEXT NOT NULL

-- invoices
pdf_blob_pathname TEXT
```

`siret` is a real field on `suppliers` (not derived at render time) —
SIREN + a 5-digit NIC, following the same "credible fake data" bar as
`generateValidSiren`. New `lib/checks/siret.ts`, mirroring
`lib/checks/siren.ts`:

```ts
import { isValidSiren } from "./siren";

function luhnValid14(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let value = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
  }
  return sum % 10 === 0;
}

export function isValidSiret(siret: string): boolean {
  if (!/^\d{14}$/.test(siret)) return false;
  if (!isValidSiren(siret.slice(0, 9))) return false;
  return luhnValid14(siret);
}

export function generateValidSiret(siren: string): string {
  if (!isValidSiren(siren)) {
    throw new Error("siren must already be a valid SIREN");
  }
  for (let nic = 1; nic <= 99999; nic++) {
    const candidate = siren + String(nic).padStart(5, "0");
    if (luhnValid14(candidate)) return candidate;
  }
  throw new Error("no valid NIC found");
}
```

`seed.ts`'s `buildSuppliers()` calls `generateValidSiret(siren)` and
stores it alongside `siren`/`vatNumber` on each `Supplier`; the INSERT
into `suppliers` gets the new column.

`pdf_blob_pathname` is nullable and untouched by `seed()`'s own inserts —
it's set afterward (see "Seed vs. PDF generation are two separate steps"
below), and by the future upload action once that exists.

## New dependencies

`@vercel/blob` and `@react-pdf/renderer` — neither is installed. Add via
`npm install @vercel/blob @react-pdf/renderer`.

`BLOB_READ_WRITE_TOKEN` — documented in `.env.example` (empty value,
matching `ANTHROPIC_API_KEY`'s pattern). The user creates a Vercel Blob
store and adds the real value to `.env.local` themselves.

## `lib/pdf/` module

Mirrors `lib/extraction/`'s shape: one file per responsibility, nothing
in here touches Next.js request/response concerns.

- **`document.tsx`** — the `@react-pdf/renderer` template
  (`InvoicePdfDocument`), pure presentation:

  ```tsx
  import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
  import { formatEuros, formatDateFr, formatIbanGrouped, formatCategory } from "@/lib/format";

  export interface InvoicePdfData {
    invoiceNumber: string;
    issueDate: string;
    dueDate: string;
    category: string;
    amountExclVatCents: number;
    amountInclVatCents: number;
    printedIban: string;
    printedSiren: string;
    printedVatNumber: string;
    supplierName: string;
    supplierSiret: string;
    entityName: string;
  }

  const styles = StyleSheet.create({
    page: { padding: 32, fontSize: 10, fontFamily: "Helvetica" },
    row: { flexDirection: "row", justifyContent: "space-between", marginBottom: 16 },
    label: { color: "#666", marginBottom: 2 },
    title: { fontSize: 14, marginBottom: 4 },
    table: { marginTop: 24, borderTop: 1, borderColor: "#ccc" },
    tableRow: { flexDirection: "row", borderBottom: 1, borderColor: "#eee", paddingVertical: 6 },
    cell: { flex: 1 },
    cellRight: { flex: 1, textAlign: "right" },
  });

  export function InvoicePdfDocument(data: InvoicePdfData) {
    return (
      <Document>
        <Page size="A4" style={styles.page}>
          <View style={styles.row}>
            <View>
              <Text style={styles.title}>{data.supplierName}</Text>
              <Text style={styles.label}>SIREN {data.printedSiren}</Text>
              <Text style={styles.label}>SIRET {data.supplierSiret}</Text>
              <Text style={styles.label}>TVA {data.printedVatNumber}</Text>
            </View>
            <View>
              <Text style={styles.label}>Facturé à</Text>
              <Text style={styles.title}>{data.entityName}</Text>
            </View>
          </View>

          <View style={styles.row}>
            <View>
              <Text style={styles.label}>Facture n°</Text>
              <Text>{data.invoiceNumber}</Text>
            </View>
            <View>
              <Text style={styles.label}>Émise le</Text>
              <Text>{formatDateFr(data.issueDate)}</Text>
            </View>
            <View>
              <Text style={styles.label}>Échéance</Text>
              <Text>{formatDateFr(data.dueDate)}</Text>
            </View>
          </View>

          <View style={styles.table}>
            <View style={styles.tableRow}>
              <Text style={styles.cell}>{formatCategory(data.category)}</Text>
              <Text style={styles.cellRight}>{formatEuros(data.amountExclVatCents)} HT</Text>
              <Text style={styles.cellRight}>{formatEuros(data.amountInclVatCents)} TTC</Text>
            </View>
          </View>

          <View style={{ marginTop: 24 }}>
            <Text style={styles.label}>IBAN</Text>
            <Text>{formatIbanGrouped(data.printedIban)}</Text>
          </View>
        </Page>
      </Document>
    );
  }
  ```

  SIREN/VAT/IBAN come from `printed_*` (invoice-level — this is what
  keeps a mismatch scenario visible on the PDF itself, per the brief);
  SIRET has no `printed_*` counterpart on `invoices` (nothing in the
  classification rules checks it), so it always comes from the supplier
  registry.

- **`generate.tsx`** — `.tsx`, not `.ts`: it uses JSX to build the
  element passed to `renderToBuffer`.

  ```tsx
  import { renderToBuffer } from "@react-pdf/renderer";
  import { InvoicePdfDocument, type InvoicePdfData } from "./document";

  export async function renderInvoicePdf(data: InvoicePdfData): Promise<Buffer> {
    return renderToBuffer(<InvoicePdfDocument {...data} />);
  }
  ```

- **`store.ts`** — the piece a future upload action reuses unchanged:

  ```ts
  import "server-only";
  import { put } from "@vercel/blob";
  import type { Client } from "@libsql/client";
  import { setInvoicePdfPathname } from "@/lib/db/queries";

  export async function storeInvoicePdf(db: Client, invoiceId: string, pdf: Buffer): Promise<void> {
    const pathname = `invoices/${invoiceId}.pdf`;
    await put(pathname, pdf, { access: "private" });
    await setInvoicePdfPathname(db, invoiceId, pathname);
  }
  ```

  All SQL stays in `lib/db/queries.ts` per CLAUDE.md — `store.ts` never
  writes SQL directly.

`document.tsx`/`generate.ts` use JSX, so this module needs a `.tsx` file
for the template; `renderToBuffer` runs in Node, not the browser or the
Next.js edge runtime. Nothing under `app/` imports `lib/pdf/` — the only
callers are the seed script (below) and, later, the upload action — so
`@react-pdf/renderer` never gets pulled into the Next.js client or server
bundle.

## Seed vs. PDF generation are two separate steps

`lib/db/seed.ts`'s `seed(db)` function is called two ways today: from
`scripts/seed.ts` (real Turso DB, CLI) **and directly by ~10 unit tests**
against an in-memory DB (`lib/db/queries.test.ts`, `lib/db/seed.test.ts`,
etc.). If PDF generation/upload lived inside `seed()`, every one of those
tests would make real network calls to Vercel Blob, need a real
`BLOB_READ_WRITE_TOKEN` in CI, and turn `npm test` from a fast local
suite into something slow and network-dependent. That's a real
compatibility problem with the existing test suite, not a style
preference — `seed()` stays exactly as fast and offline as it is today.

So PDF generation is a separate function, called only from the CLI
script, after `seed()` returns:

**`lib/db/queries.ts`** — new query, one row per invoice with everything
`InvoicePdfData` needs:

```ts
export interface InvoicePdfSourceRow extends InvoicePdfData {
  id: string;
}

export async function getAllInvoicesForPdfGeneration(db: Client): Promise<InvoicePdfSourceRow[]> {
  const result = await db.execute(`
    SELECT
      invoices.id AS id,
      invoices.invoice_number AS invoiceNumber,
      invoices.category AS category,
      invoices.amount_excl_vat_cents AS amountExclVatCents,
      invoices.amount_incl_vat_cents AS amountInclVatCents,
      invoices.issue_date AS issueDate,
      invoices.due_date AS dueDate,
      invoices.printed_iban AS printedIban,
      invoices.printed_siren AS printedSiren,
      invoices.printed_vat_number AS printedVatNumber,
      suppliers.name AS supplierName,
      suppliers.siret AS supplierSiret,
      entities.name AS entityName
    FROM invoices
    JOIN suppliers ON suppliers.id = invoices.supplier_id
    JOIN entities ON entities.id = invoices.entity_id
  `);
  return result.rows.map((row) => ({ ...row } as unknown as InvoicePdfSourceRow));
}

export async function setInvoicePdfPathname(db: Client, invoiceId: string, pathname: string): Promise<void> {
  await db.execute({
    sql: "UPDATE invoices SET pdf_blob_pathname = ? WHERE id = ?",
    args: [pathname, invoiceId],
  });
}

export async function getInvoicePdfPathname(db: Client, invoiceId: string): Promise<string | null> {
  const result = await db.execute({
    sql: "SELECT pdf_blob_pathname AS pathname FROM invoices WHERE id = ?",
    args: [invoiceId],
  });
  const row = result.rows[0];
  return row?.pathname ? String(row.pathname) : null;
}
```

**`lib/pdf/generate-all.ts`**:

```ts
import "server-only";
import type { Client } from "@libsql/client";
import { getAllInvoicesForPdfGeneration } from "@/lib/db/queries";
import { renderInvoicePdf } from "./generate";
import { storeInvoicePdf } from "./store";

const CONCURRENCY = 8;

export async function generateAllInvoicePdfs(db: Client): Promise<void> {
  const invoices = await getAllInvoicesForPdfGeneration(db);
  for (let i = 0; i < invoices.length; i += CONCURRENCY) {
    const chunk = invoices.slice(i, i + CONCURRENCY);
    await Promise.all(
      chunk.map(async (invoice) => {
        const pdf = await renderInvoicePdf(invoice);
        await storeInvoicePdf(db, invoice.id, pdf);
      })
    );
  }
}
```

**`scripts/seed.ts`** — one new line, after `seed(db)` resolves:

```ts
import { db } from "../lib/db/client";
import { seed } from "../lib/db/seed";
import { generateAllInvoicePdfs } from "../lib/pdf/generate-all";

async function main() {
  await seed(db);
  console.log("Seed complete.");
  console.log("Generating invoice PDFs…");
  await generateAllInvoicePdfs(db);
  console.log("PDFs uploaded.");
  db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

~155 invoices exist after seeding (13 pending + ~144 backfilled history
rows across 12 months), so this uploads ~155 PDFs on every
`npm run seed`. At concurrency 8 that's a real but bounded wait (roughly
a minute depending on network), not a hang — acceptable for a demo reset
that already regenerates all data from scratch. If `BLOB_READ_WRITE_TOKEN`
is missing, `put()` throws immediately on the first call with the SDK's
own clear error; `scripts/seed.ts` doesn't need to wrap it since this is
a developer-run CLI command, not end-user-facing UI (unlike the
`ANTHROPIC_API_KEY` case, which surfaces through a French error in the
browser).

## API route (`app/api/invoices/[id]/pdf/route.ts`)

First route under `app/api/` in this project.

```ts
import { NextResponse } from "next/server";
import { get } from "@vercel/blob";
import { db } from "@/lib/db/client";
import { getInvoicePdfPathname } from "@/lib/db/queries";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;

  // No user auth exists yet in this demo — once it does, this is where a
  // check belongs (verify the caller may view this invoice) before the
  // PDF is streamed back.
  const pathname = await getInvoicePdfPathname(db, id);
  if (!pathname) {
    return new NextResponse(null, { status: 404 });
  }

  const result = await get(pathname, { access: "private" });
  if (!result || result.statusCode !== 200) {
    return new NextResponse(null, { status: 404 });
  }

  return new NextResponse(result.stream, {
    headers: {
      "Content-Type": "application/pdf",
      "Cache-Control": "private, no-cache",
    },
  });
}
```

Verified against `@vercel/blob@2.8.0`'s actual type declarations (not
assumed): `get(urlOrPathname, { access: "private" })` returns
`{ statusCode: 200, stream: ReadableStream<Uint8Array>, blob, headers } | null`
— this is a direct implementation of that shape, not a guess.

## UI: `ViewPdfButton` (`components/view-pdf-button.tsx`)

One shared client component, used on the invoice detail page and once
per row on the bordereau — same component both places, per the brief.

```tsx
"use client";

import { useState } from "react";

// Matches this app's existing `sm:` Tailwind breakpoint (640px), used
// elsewhere for the same mobile/desktop split.
const DESKTOP_BREAKPOINT_PX = 640;

export function ViewPdfButton({ invoiceId, className = "" }: { invoiceId: string; className?: string }) {
  const [modalOpen, setModalOpen] = useState(false);
  const href = `/api/invoices/${invoiceId}/pdf`;

  function handleClick() {
    if (window.innerWidth < DESKTOP_BREAKPOINT_PX) {
      setModalOpen(true);
    } else {
      window.open(href, "_blank", "noopener,noreferrer");
    }
  }

  return (
    <>
      <button type="button" onClick={handleClick} className={className}>
        Voir le PDF
      </button>
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-white">
          <div className="flex items-center justify-between border-b border-gray-200 p-3">
            <span className="text-sm font-medium text-gray-900">Facture PDF</span>
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="min-h-[44px] px-3 text-sm font-medium text-blue-600"
            >
              Fermer
            </button>
          </div>
          <iframe src={href} title="Facture PDF" className="flex-1" />
        </div>
      )}
    </>
  );
}
```

**Invoice detail page** (`app/(app)/invoices/[id]/page.tsx`) — add
`<ViewPdfButton invoiceId={context.invoice.id} className="..." />` next
to the `<h1>`, styled like this page's other secondary actions.

**Bordereau** (`app/(app)/sessions/[id]/page.tsx`) — one `ViewPdfButton`
per row, in the existing decisions table (a new `<td>`, `no-print` class
since a PDF-viewer trigger is meaningless on a printed page — matching
how `PrintButton`/`CopyHashButton` already use `no-print`).

## `.env.example`

Add `BLOB_READ_WRITE_TOKEN=` alongside the existing three empty entries.

## CLAUDE.md changes

Under "Stack," add a line noting private PDF storage:
`- Invoice PDFs: private Vercel Blob store (@vercel/blob), never a public URL`.

## Testing

- `lib/checks/siret.test.ts`: `generateValidSiret` produces a value
  `isValidSiret` accepts; `isValidSiret` rejects a wrong-length string
  and a string with a flipped digit (Luhn trigger/non-trigger, same
  pattern as `siren.test.ts`).
- `lib/db/queries.test.ts`: add `setInvoicePdfPathname` +
  `getInvoicePdfPathname` round-trip (seed a DB, set a pathname on one
  seeded invoice id, read it back; a second invoice with no pathname set
  returns `null`). Add `getAllInvoicesForPdfGeneration` returning one row
  per seeded invoice with non-empty `supplierSiret`.
- `lib/pdf/generate.test.ts`: call `renderInvoicePdf` with a fixture
  `InvoicePdfData` and assert the result is a non-empty `Buffer` starting
  with the PDF magic bytes (`%PDF`) — cheap smoke test that the template
  actually renders, without asserting on visual layout.
- No test exercises `storeInvoicePdf`, `generateAllInvoicePdfs`, or the
  API route's `get()` call against real Vercel Blob (would need a real
  token and network access unavailable in CI) — covered by the manual
  verification steps in the implementation plan instead, same treatment
  as the extraction feature's Claude API call.
- `app/api/invoices/[id]/pdf/route.ts`: no unit test for the same
  reason; manual verification (below) covers the 404 and success paths.

## Done when

- `npm run lint`, `npx tsc --noEmit`, and `npm test` all pass — and
  `npm test` makes no network calls (confirms the seed/PDF-generation
  split held).
- `npm run seed` completes, logs progress, and every seeded invoice ends
  up with a non-null `pdf_blob_pathname`.
- On the invoice detail page, "Voir le PDF" at a 375px viewport opens an
  iframe modal in-page showing a readable fake invoice; at desktop width
  it opens the API route in a new tab instead.
- The rendered PDF shows the invoice's `printed_iban`/`printed_siren`
  (not the registry's) for at least one seeded mismatch scenario (e.g.
  `PEND-MERIDIAN-01`'s foreign IBAN, `PEND-ONDINE-01`'s mismatched
  SIREN) — confirms the "printed, not registry" requirement actually
  shows up, not just that the field is wired.
- Requesting `/api/invoices/<real-id>/pdf` returns a PDF with the right
  headers; requesting it for an invoice with no `pdf_blob_pathname`, or a
  nonexistent id, returns 404.
- Viewing a Blob URL directly (not through the API route) is not
  possible from the browser — the store is private and the client only
  ever sees `/api/invoices/[id]/pdf` URLs.
- Every row on a bordereau (`/sessions/[id]`) — both a live batch session
  and a backfilled `ses-hist-*` one — offers a working "Voir le PDF".
