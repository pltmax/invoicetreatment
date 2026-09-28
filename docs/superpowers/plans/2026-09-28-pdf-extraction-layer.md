# PDF Extraction Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Couche d'extraction" tab where the CEO can drag a PDF invoice onto the page, have Claude Sonnet 5 extract its data, and have a new pending invoice created and classified from it — dramatizing what a real background email-ingestion pipeline would do automatically.

**Architecture:** A Zod schema constrains Claude's structured output to exactly the fields the `invoices` table needs. A server action reads the uploaded PDF into memory, sends it to Claude as an inline base64 document (never the Files API, never written to disk), matches the extracted supplier against existing data (creating a new supplier only if nothing matches), inserts the invoice, classifies it, and redirects to its existing detail page.

**Tech Stack:** Next.js server actions, `@anthropic-ai/sdk` (`client.messages.parse` + `zodOutputFormat`), `zod`, `@libsql/client`.

**Spec:** `docs/superpowers/specs/2026-09-28-pdf-extraction-layer-design.md`

## Global Constraints

- Model is `claude-sonnet-5` (user explicitly named "sonnet") — never substitute another model.
- The PDF is sent inline as base64 (`{type: "document", source: {type: "base64", ...}}`), never uploaded via the Files API, never written to disk or the database. Only the fields Claude extracts get persisted.
- `ANTHROPIC_API_KEY` is read via the SDK's default credential resolution (`new Anthropic()`, no explicit `apiKey:`) — document it in `.env.example`, never hardcode it.
- A brand-new (unmatched) supplier's IBAN history row is backdated ~1 year before the invoice's `issueDate`, not dated "today" — this avoids `iban-recently-changed.ts` firing redundantly alongside `new-supplier.ts` on every new-supplier upload.
- UI copy in French, code and comments in English (project convention).
- Amounts are stored as integer cents; the extraction schema asks Claude for cents directly (not euros), avoiding an LLM-performed unit conversion.
- Every DB-facing function other code needs to test takes `db: Client` as an explicit parameter (matching `getThresholds(db)`, `loadContext(db, ...)`, etc. already in this codebase) — this refines the spec's `resolveSupplierId`/`findContractId` snippets, which closed over a module-level `db` import; parameterizing them is required for them to be testable against an isolated in-memory DB.
- No test calls the real Claude API (no key in CI, non-deterministic, costs money). `extract.ts`'s tests mock `@anthropic-ai/sdk`; end-to-end extraction is verified manually in Task 6 using the real key already in `.env.local`.

---

### Task 1: Dependencies, category label, and env docs

**Files:**
- Modify: `package.json` (dependencies)
- Modify: `lib/format.ts`
- Modify: `lib/format.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces: `@anthropic-ai/sdk` and `zod` available as dependencies; `formatCategory("autre")` returns `"Autre"`.

- [ ] **Step 1: Install dependencies**

Run: `npm install @anthropic-ai/sdk zod`

(If already installed — `package.json` already lists `@anthropic-ai/sdk` and `zod` under `dependencies` — this is a no-op; confirm with `cat package.json` rather than re-running blindly.)

- [ ] **Step 2: Add the failing test for the new category label**

In `lib/format.test.ts`, inside the existing `describe("formatCategory", ...)` block's first `it`, add one more assertion at the end of the list (right before the closing `});` of that `it`):

```ts
    expect(formatCategory("autre")).toBe("Autre");
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run lib/format.test.ts`
Expected: FAIL — `formatCategory("autre")` currently returns the raw string `"autre"` (the fallback path), not `"Autre"`.

- [ ] **Step 4: Add the label**

In `lib/format.ts`, find the `CATEGORY_LABELS` object and add one entry (order doesn't matter, but adding it at the end keeps the diff small):

```ts
  utilities: "Énergie et fluides",
  autre: "Autre",
};
```

(This replaces the existing `utilities: "Énergie et fluides",\n};` two-line ending with the three-line version above — the `utilities` line is unchanged, `autre` is the only addition.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run lib/format.test.ts`
Expected: PASS

- [ ] **Step 6: Document the new environment variable**

In `.env.example`, add a third line:

```
ANTHROPIC_API_KEY=
```

So the full file reads:

```
TURSO_DATABASE_URL=
TURSO_AUTH_TOKEN=
ANTHROPIC_API_KEY=
```

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json lib/format.ts lib/format.test.ts .env.example
git commit -m "Add Anthropic SDK, zod, and the 'autre' category label"
```

---

### Task 2: `getEntities` query

**Files:**
- Modify: `lib/db/queries.ts`
- Modify: `lib/db/queries.test.ts`

**Interfaces:**
- Produces: `export interface EntityRow { id: string; name: string }` and `export async function getEntities(db: Client): Promise<EntityRow[]>` from `lib/db/queries.ts`.

- [ ] **Step 1: Write the failing test**

Add to `lib/db/queries.test.ts` (add `getEntities` to the existing import from `"./queries"` at the top of the file, alongside the other imported query functions):

```ts
describe("getEntities", () => {
  it("returns all 4 seeded entities sorted by name", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db);
    await seed(db);

    const entities = await getEntities(db);
    expect(entities).toHaveLength(4);
    const names = entities.map((e) => e.name);
    expect(names).toEqual([...names].sort());
    expect(names).toContain("Arcadia Télécom");

    db.close();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/db/queries.test.ts`
Expected: FAIL — `getEntities` is not exported yet.

- [ ] **Step 3: Implement `getEntities`**

Add to `lib/db/queries.ts` (anywhere in the file, e.g. at the end):

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

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/db/queries.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/db/queries.ts lib/db/queries.test.ts
git commit -m "Add getEntities query"
```

---

### Task 3: Extraction schema and Claude API call

**Files:**
- Create: `lib/extraction/schema.ts`
- Create: `lib/extraction/extract.ts`
- Create: `lib/extraction/extract.test.ts`

**Interfaces:**
- Consumes: `@anthropic-ai/sdk` (`Anthropic` default export, `zodOutputFormat` from `@anthropic-ai/sdk/helpers/zod`), `zod`.
- Produces:
  - `export const EXTRACTION_CATEGORIES` (readonly string tuple) from `lib/extraction/schema.ts`
  - `export const ExtractedInvoiceSchema` (Zod object schema) from `lib/extraction/schema.ts`
  - `export type ExtractedInvoice` from `lib/extraction/schema.ts`
  - `export class ExtractionError extends Error {}` from `lib/extraction/extract.ts`
  - `export async function extractInvoiceFromPdf(pdfBase64: string): Promise<ExtractedInvoice>` from `lib/extraction/extract.ts`

- [ ] **Step 1: Write the schema**

Create `lib/extraction/schema.ts`:

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
  amountExclVatCents: z.number().int().describe("Amount excl. VAT, in integer cents"),
  amountInclVatCents: z.number().int().describe("Amount incl. VAT, in integer cents"),
  issueDate: z.string().describe("Invoice issue date, ISO 8601 (YYYY-MM-DD)"),
  dueDate: z.string().describe("Payment due date, ISO 8601 (YYYY-MM-DD)"),
});

export type ExtractedInvoice = z.infer<typeof ExtractedInvoiceSchema>;
```

- [ ] **Step 2: Write the extraction call**

Create `lib/extraction/extract.ts`:

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

- [ ] **Step 3: Write the tests**

Create `lib/extraction/extract.test.ts`. This mocks `@anthropic-ai/sdk` so no real API call happens. The mock keeps every real export (including the real `AuthenticationError`/`APIError`/`BadRequestError` classes, via `vi.importActual` + `Object.assign`) and only replaces the default-exported `Anthropic` constructor's *instance* behavior (`messages.parse`) — this is what lets both this test file and `extract.ts` itself reference the exact same real error classes for `instanceof` checks to work correctly. `mockParse` is allowed to be referenced inside the hoisted `vi.mock` factory because Vitest special-cases variable names starting with `mock`.

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { extractInvoiceFromPdf, ExtractionError } from "./extract";

const mockParse = vi.fn();

vi.mock("@anthropic-ai/sdk", async () => {
  const actual = await vi.importActual<typeof import("@anthropic-ai/sdk")>("@anthropic-ai/sdk");
  const MockAnthropic = vi.fn(() => ({ messages: { parse: mockParse } })) as unknown as typeof actual.default;
  Object.assign(MockAnthropic, actual.default);
  return { ...actual, default: MockAnthropic };
});

vi.mock("@anthropic-ai/sdk/helpers/zod", () => ({
  zodOutputFormat: vi.fn(() => ({})),
}));

beforeEach(() => {
  mockParse.mockReset();
});

const FAKE_EXTRACTION = {
  supplierName: "Test Supplier",
  printedSiren: "123456789",
  printedVatNumber: "FR12345678901",
  printedIban: "FR1234567890123456789012345",
  invoiceNumber: "INV-001",
  category: "consulting" as const,
  amountExclVatCents: 100000,
  amountInclVatCents: 120000,
  issueDate: "2026-06-01",
  dueDate: "2026-07-01",
};

describe("extractInvoiceFromPdf", () => {
  it("returns the parsed output on success", async () => {
    mockParse.mockResolvedValue({ parsed_output: FAKE_EXTRACTION });

    const result = await extractInvoiceFromPdf("base64-pdf-data");
    expect(result).toEqual(FAKE_EXTRACTION);
  });

  it("throws ExtractionError with a French message on AuthenticationError", async () => {
    mockParse.mockRejectedValue(
      new Anthropic.AuthenticationError(401, {}, "invalid x-api-key", new Headers())
    );

    await expect(extractInvoiceFromPdf("base64-pdf-data")).rejects.toThrow(ExtractionError);
    await expect(extractInvoiceFromPdf("base64-pdf-data")).rejects.toThrow(/ANTHROPIC_API_KEY/);
  });

  it("throws ExtractionError with the API's own message on other API errors", async () => {
    mockParse.mockRejectedValue(
      new Anthropic.BadRequestError(400, {}, "model not found", new Headers())
    );

    await expect(extractInvoiceFromPdf("base64-pdf-data")).rejects.toThrow(ExtractionError);
    await expect(extractInvoiceFromPdf("base64-pdf-data")).rejects.toThrow(/model not found/);
  });

  it("throws ExtractionError when parsed_output is null", async () => {
    mockParse.mockResolvedValue({ parsed_output: null });

    await expect(extractInvoiceFromPdf("base64-pdf-data")).rejects.toThrow(ExtractionError);
    await expect(extractInvoiceFromPdf("base64-pdf-data")).rejects.toThrow(/Impossible d'extraire/);
  });
});
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run lib/extraction/extract.test.ts`
Expected: PASS (4 tests). If the mock setup doesn't behave as expected (e.g. `instanceof` checks fail), the most likely cause is the `Object.assign(MockAnthropic, actual.default)` line not running before `extract.ts` reads `Anthropic.AuthenticationError` at module-eval time — double check the mock factory is returning the assigned `MockAnthropic` as `default`, not the original.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/extraction/
git commit -m "Add PDF extraction schema and Claude API call"
```

---

### Task 4: Server action — supplier matching and invoice creation

**Files:**
- Create: `app/actions/extract-invoice.ts`
- Create: `app/actions/extract-invoice.test.ts`

**Interfaces:**
- Consumes: `extractInvoiceFromPdf`, `ExtractionError` from `lib/extraction/extract.ts` (Task 3); `ExtractedInvoice` type from `lib/extraction/schema.ts` (Task 3); `classifyAll` from `lib/rules/classify-all.ts` (existing, unchanged); `db` from `lib/db/client.ts` (existing).
- Produces:
  - `export async function extractInvoice(formData: FormData): Promise<void>` from `app/actions/extract-invoice.ts` — the server action, expects a `entityId` field and a `pdf` file field on the `FormData`.
  - `export async function resolveSupplierId(db: Client, extracted: ExtractedInvoice): Promise<string>` from `app/actions/extract-invoice.ts`
  - `export async function findContractId(db: Client, entityId: string, supplierId: string): Promise<string | null>` from `app/actions/extract-invoice.ts`

Later tasks (Task 5) need the exact `FormData` field names `extractInvoice` reads: `entityId` and `pdf`.

- [ ] **Step 1: Write the failing tests**

Create `app/actions/extract-invoice.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createClient } from "@libsql/client";
import { migrate } from "@/lib/db/migrate";
import { seed } from "@/lib/db/seed";
import { resolveSupplierId, findContractId } from "./extract-invoice";
import type { ExtractedInvoice } from "@/lib/extraction/schema";

function fixture(overrides: Partial<ExtractedInvoice> = {}): ExtractedInvoice {
  return {
    supplierName: "Not A Real Match",
    printedSiren: "000000000",
    printedVatNumber: "FR00000000000",
    printedIban: "FR0000000000000000000000000",
    invoiceNumber: "TEST-001",
    category: "telecom_maintenance",
    amountExclVatCents: 100000,
    amountInclVatCents: 120000,
    issueDate: "2026-06-01",
    dueDate: "2026-07-01",
    ...overrides,
  };
}

describe("resolveSupplierId", () => {
  it("matches an existing supplier by SIREN", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db);
    await seed(db);

    const existing = await db.execute("SELECT siren FROM suppliers WHERE id = 'sup-novalink'");
    const siren = String(existing.rows[0].siren);

    const supplierId = await resolveSupplierId(db, fixture({ printedSiren: siren }));
    expect(supplierId).toBe("sup-novalink");

    const count = await db.execute("SELECT COUNT(*) as n FROM suppliers");
    expect(Number(count.rows[0].n)).toBe(13);

    db.close();
  });

  it("matches an existing supplier by case-insensitive name", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db);
    await seed(db);

    const supplierId = await resolveSupplierId(db, fixture({ supplierName: "novalink télécom" }));
    expect(supplierId).toBe("sup-novalink");

    db.close();
  });

  it("creates a new supplier with one backdated IBAN history row when nothing matches", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db);
    await seed(db);

    const supplierId = await resolveSupplierId(
      db,
      fixture({
        supplierName: "Brand New Fournisseur",
        printedSiren: "999999999",
        printedIban: "FR9999999999999999999999999",
        issueDate: "2026-06-15",
      })
    );

    expect(supplierId).not.toBe("sup-novalink");

    const supplierRow = await db.execute({
      sql: "SELECT name FROM suppliers WHERE id = ?",
      args: [supplierId],
    });
    expect(supplierRow.rows[0].name).toBe("Brand New Fournisseur");

    const ibanRows = await db.execute({
      sql: "SELECT iban, effective_from as effectiveFrom FROM iban_history WHERE supplier_id = ?",
      args: [supplierId],
    });
    expect(ibanRows.rows).toHaveLength(1);
    expect(ibanRows.rows[0].effectiveFrom).toBe("2025-06-15");

    db.close();
  });
});

describe("findContractId", () => {
  it("returns the contract id for a known entity+supplier pair", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db);
    await seed(db);

    const contractId = await findContractId(db, "ent-telecom", "sup-novalink");
    expect(contractId).toBe("con-novalink-telecom");

    db.close();
  });

  it("returns null when no contract exists for the pair", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db);
    await seed(db);

    const contractId = await findContractId(db, "ent-media", "sup-novalink");
    expect(contractId).toBeNull();

    db.close();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run app/actions/extract-invoice.test.ts`
Expected: FAIL — the file doesn't exist yet.

- [ ] **Step 3: Implement the server action**

Create `app/actions/extract-invoice.ts`:

```ts
"use server";

import "server-only";
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import type { Client } from "@libsql/client";
import { db } from "@/lib/db/client";
import { classifyAll } from "@/lib/rules/classify-all";
import { extractInvoiceFromPdf, ExtractionError } from "@/lib/extraction/extract";
import type { ExtractedInvoice } from "@/lib/extraction/schema";

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

  let extracted: ExtractedInvoice;
  try {
    extracted = await extractInvoiceFromPdf(base64);
  } catch (err) {
    if (err instanceof ExtractionError) {
      redirect(`/extraction?error=extraction&message=${encodeURIComponent(err.message)}`);
    }
    throw err;
  }

  const supplierId = await resolveSupplierId(db, extracted);
  const contractId = await findContractId(db, entityId, supplierId);

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

export async function resolveSupplierId(db: Client, extracted: ExtractedInvoice): Promise<string> {
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

export async function findContractId(db: Client, entityId: string, supplierId: string): Promise<string | null> {
  const result = await db.execute({
    sql: "SELECT id FROM contracts WHERE entity_id = ? AND supplier_id = ?",
    args: [entityId, supplierId],
  });
  return result.rows[0] ? String(result.rows[0].id) : null;
}
```

Note the deviation from the spec's snippet: `resolveSupplierId` and `findContractId` both take `db: Client` as an explicit first parameter (imported as `import type { Client } from "@libsql/client"`) instead of closing over the module-level `db` import — this is what makes them callable from the test above against an isolated in-memory database. The main `extractInvoice` action passes its own imported `db` explicitly when calling them.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run app/actions/extract-invoice.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add app/actions/extract-invoice.ts app/actions/extract-invoice.test.ts
git commit -m "Add extractInvoice server action with supplier matching"
```

---

### Task 5: Extraction page and drag-and-drop upload form

**Files:**
- Create: `app/(app)/extraction/page.tsx`
- Create: `app/(app)/extraction/_components/upload-form.tsx`

**Interfaces:**
- Consumes: `getEntities` from `lib/db/queries.ts` (Task 2); `extractInvoice` from `app/actions/extract-invoice.ts` (Task 4), which expects `FormData` fields named `entityId` and `pdf`.
- Produces: a page at `/extraction`.

- [ ] **Step 1: Write the upload form client component**

Create `app/(app)/extraction/_components/upload-form.tsx`:

```tsx
"use client";

import { useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { extractInvoice } from "@/app/actions/extract-invoice";
import type { EntityRow } from "@/lib/db/queries";

const MAX_PDF_BYTES = 10 * 1024 * 1024;

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className="min-h-[44px] w-full rounded bg-blue-600 px-4 text-sm font-semibold text-white disabled:opacity-50 sm:w-auto sm:px-8"
    >
      {pending ? "Extraction en cours…" : "Extraire la facture"}
    </button>
  );
}

export function UploadForm({ entities }: { entities: EntityRow[] }) {
  const [entityId, setEntityId] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function acceptFile(file: File) {
    if (file.type !== "application/pdf") {
      setLocalError("Le fichier doit être un PDF.");
      setFileName(null);
      return;
    }
    if (file.size > MAX_PDF_BYTES) {
      setLocalError("Le fichier dépasse 10 Mo.");
      setFileName(null);
      return;
    }
    setLocalError(null);
    setFileName(file.name);

    if (fileInputRef.current) {
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      fileInputRef.current.files = dataTransfer.files;
    }
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) acceptFile(file);
  }

  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) acceptFile(file);
  }

  return (
    <form action={extractInvoice} className="space-y-4">
      <div>
        <label htmlFor="entityId" className="mb-1 block text-sm font-medium text-gray-900">
          Filiale destinataire
        </label>
        <select
          id="entityId"
          name="entityId"
          value={entityId}
          onChange={(e) => setEntityId(e.target.value)}
          className="w-full rounded border border-gray-300 p-2"
        >
          <option value="">Choisir une filiale…</option>
          {entities.map((entity) => (
            <option key={entity.id} value={entity.id}>
              {entity.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <span className="mb-1 block text-sm font-medium text-gray-900">Facture PDF</span>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`flex min-h-[120px] cursor-pointer flex-col items-center justify-center rounded border-2 border-dashed p-4 text-center text-sm ${
            isDragging ? "border-blue-600 bg-blue-50" : "border-gray-300 text-gray-500"
          }`}
        >
          {fileName ? (
            <span className="font-medium text-gray-900">{fileName}</span>
          ) : (
            <span>Déposez un PDF ici, ou cliquez pour en choisir un</span>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          name="pdf"
          accept="application/pdf"
          className="hidden"
          onChange={handleFileInputChange}
        />
      </div>

      {localError && <p className="text-sm text-red-700">{localError}</p>}

      <SubmitButton disabled={!entityId || !fileName} />
    </form>
  );
}
```

- [ ] **Step 2: Write the page**

Create `app/(app)/extraction/page.tsx`:

```tsx
import { db } from "@/lib/db/client";
import { getEntities } from "@/lib/db/queries";
import { UploadForm } from "./_components/upload-form";

export const dynamic = "force-dynamic";

const ERROR_MESSAGES: Record<string, string> = {
  "missing-entity": "Choisissez une filiale destinataire.",
  "missing-file": "Choisissez un fichier PDF.",
  "not-pdf": "Le fichier doit être un PDF.",
  "too-large": "Le fichier dépasse 10 Mo.",
};

export default async function ExtractionPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; message?: string }>;
}) {
  const { error, message } = await searchParams;
  const entities = await getEntities(db);

  const errorText = error === "extraction" ? message : error ? ERROR_MESSAGES[error] : undefined;

  return (
    <div className="space-y-6 px-4 py-4">
      <div>
        <h1 className="text-lg font-semibold text-gray-900">Couche d&apos;extraction</h1>
      </div>

      <div className="space-y-3 rounded border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
        <p className="font-medium text-gray-900">Comment ça marche en production</p>
        <p>
          Chaque facture reçue par email à invoices@holding.com serait captée par un webhook de
          réception : la pièce jointe PDF est récupérée automatiquement, puis envoyée à Claude
          pour une extraction structurée des données (fournisseur, montants, dates, IBAN...). La
          facture apparaît alors directement dans la file d&apos;attente, classée et prête à être
          examinée — sans aucune intervention humaine.
        </p>
        <p>
          Pour cette démo, vous pouvez déclencher cette même étape manuellement : choisissez la
          filiale destinataire et déposez un PDF de facture ci-dessous. Le PDF n&apos;est jamais
          stocké : il est transmis à Claude pour extraction, puis immédiatement oublié — seules
          les données extraites sont conservées.
        </p>
        <p className="text-gray-500">Utilisez uniquement des factures fictives (aucune donnée réelle).</p>
      </div>

      {errorText && (
        <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{errorText}</p>
      )}

      <UploadForm entities={entities} />
    </div>
  );
}
```

- [ ] **Step 3: Typecheck, lint, build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: all clean. (`npm run build` will fail fast if `ANTHROPIC_API_KEY` or any import is wrong — `lib/extraction/extract.ts` constructs `new Anthropic()` at module load, which does not require a key to succeed, only to make a request, so the build should not need `.env.local` set.)

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/extraction"
git commit -m "Add extraction page and drag-and-drop upload form"
```

---

### Task 6: Nav link, CLAUDE.md update, and full manual verification

**Files:**
- Modify: `app/(app)/_components/nav.tsx`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: everything from Tasks 1-5.
- Produces: `/extraction` reachable from the nav; a working end-to-end extraction verified against the real Claude API.

- [ ] **Step 1: Add the nav link**

In `app/(app)/_components/nav.tsx`, add a fifth entry to the `LINKS` array, after the `/rules` entry:

```ts
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
  {
    href: "/extraction",
    label: "Couche d'extraction",
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 4v10m0 0-3.5-3.5M12 14l3.5-3.5M5 16v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2"
      />
    ),
  },
];
```

(This replaces the existing `/rules` entry followed by the array's closing `];` — the `/rules` entry itself is unchanged, the new `/extraction` entry and the closing bracket are what's added.)

- [ ] **Step 2: Update CLAUDE.md's scope line**

In `CLAUDE.md`, under "## Scope for the demo", find this line:

```
- Mocked: email ingestion (invoices@holding.com), e-signature provider, notifications
```

Replace it with:

```
- Mocked: email ingestion (invoices@holding.com) — except the PDF-extraction step itself, which makes a real Claude Sonnet 5 call (see /extraction); only the email transport and webhook are mocked — e-signature provider, notifications
```

- [ ] **Step 3: Run the full automated verification**

Run: `npm test && npx tsc --noEmit && npm run lint && npm run build`
Expected: all clean.

- [ ] **Step 4: Manual end-to-end verification against the real Claude API**

`.env.local` already has `ANTHROPIC_API_KEY` set (confirm with `grep ANTHROPIC_API_KEY .env.local` — do not print the value). You'll need one small fictional test PDF invoice for this step — if none exists in the repo already, create a minimal one (any PDF generator or even a plain-text-to-PDF conversion is fine) naming a **known seed supplier** (e.g. "NovaLink Télécom") with a plausible amount, dates, and a SIREN/IBAN (fictional, don't need to be valid-looking).

1. Reset the DB: `DOTENV_CONFIG_PATH=.env.local NODE_OPTIONS=--conditions=react-server npx tsx -r dotenv/config scripts/migrate.ts && DOTENV_CONFIG_PATH=.env.local NODE_OPTIONS=--conditions=react-server npx tsx -r dotenv/config scripts/seed.ts`
2. Start the dev server: `npm run dev`
3. Navigate to `/extraction`, confirm the explanation renders and the entity dropdown lists all 4 subsidiaries.
4. Select a subsidiary, drag your test PDF onto the drop zone, confirm the filename appears and the submit button enables.
5. Submit. Confirm the button shows "Extraction en cours…" while pending, then the browser redirects to `/invoices/[some-id]`.
6. On the invoice detail page, confirm the extracted fields (supplier name, amounts, dates) look correct and a classification level is shown.
7. Repeat with a second test PDF naming a supplier **not** in the seed data. Confirm it creates a new supplier (check via `turso db shell invoice-desk "SELECT name FROM suppliers ORDER BY created_at DESC LIMIT 1"` or equivalent against whichever DB `.env.local` points at) and that the resulting invoice's reasons include `NEW_SUPPLIER_SMALL` or `NEW_SUPPLIER_LARGE`, and do **not** include `IBAN_RECENTLY_CHANGED`.
8. Try submitting a non-PDF file (e.g. rename a `.txt` file to try dropping it) — confirm the drop zone's client-side check rejects it before submission.
9. Stop the dev server. Reset the DB again to leave it clean: repeat step 1's two commands.

If any step fails, do not proceed to Step 5 — fix the root cause (see `superpowers:systematic-debugging` if the failure isn't immediately obvious) and re-run from Step 1.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/_components/nav.tsx" CLAUDE.md
git commit -m "Add extraction tab to nav and update CLAUDE.md scope"
```
