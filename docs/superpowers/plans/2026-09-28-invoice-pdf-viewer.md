# Invoice PDF Storage & Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every invoice gets a generated, credible fake PDF stored privately in Vercel Blob; "Voir le PDF" on the invoice detail page and on every row of a bordereau opens it (iframe modal on mobile, new tab on desktop) through a server route that never exposes a Blob URL.

**Architecture:** A new `lib/pdf/` module renders invoices to PDF (`@react-pdf/renderer`) and uploads them (`@vercel/blob`, private access). PDF generation runs as a separate step after `seed()` (not inside it), so the ~10 existing unit tests that call `seed()` directly against an in-memory DB stay network-free. `app/api/invoices/[id]/pdf/route.ts` is the only thing that ever reads the blob back, streaming it through — the client never sees a Blob URL. A shared `ViewPdfButton` client component picks iframe-modal vs. new-tab based on viewport width.

**Tech Stack:** Next.js App Router (route handler), `@vercel/blob`, `@react-pdf/renderer`, `@libsql/client`, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-28-invoice-pdf-viewer-design.md`

## Global Constraints

- UI copy in French; code and comments in English.
- Amounts stored as integer cents; the PDF template must not do float math on them.
- Dates stored/passed as ISO strings; format only at render time via `lib/format.ts`.
- All SQL lives in `lib/db/` — `lib/pdf/` never writes SQL directly, it calls `lib/db/queries.ts` functions.
- Never use real company names, SIRENs, VAT numbers, or IBANs anywhere, including test fixtures.
- Keep modules small, one clear responsibility per file.
- Mobile-first: interactive elements are at least 44px tall (`min-h-[44px]`), matching existing buttons.
- Within `lib/`, import across subfolders with relative paths (`../format`, `../../checks/iban`), matching the existing convention — not the `@/lib/...` alias. Within `app/` and `components/`, use the `@/...` alias, matching existing files there.
- `lib/db/seed.ts`'s exported `seed(db)` function must keep making zero network calls beyond the DB itself — it's called directly by many unit tests against an in-memory DB. PDF generation/upload is wired in only at the `scripts/seed.ts` CLI-script level, never inside `seed()`.

---

## Task 1: SIRET check and generator (`lib/checks/siret.ts`)

**Files:**
- Create: `lib/checks/siret.ts`
- Test: `lib/checks/siret.test.ts`

**Interfaces:**
- Consumes: `isValidSiren` from `lib/checks/siren.ts` (already exists: `isValidSiren(siren: string): boolean`).
- Produces: `isValidSiret(siret: string): boolean`, `generateValidSiret(siren: string): string` — both used by Task 3 (`lib/db/seed.ts`).

- [ ] **Step 1: Write the failing test**

```ts
// lib/checks/siret.test.ts
import { describe, it, expect } from "vitest";
import { generateValidSiren } from "./siren";
import { isValidSiret, generateValidSiret } from "./siret";

describe("siret", () => {
  it("generates a SIRET that isValidSiret accepts and that starts with the given SIREN", () => {
    const siren = generateValidSiren("40000001");
    const siret = generateValidSiret(siren);
    expect(siret).toHaveLength(14);
    expect(siret.startsWith(siren)).toBe(true);
    expect(isValidSiret(siret)).toBe(true);
  });

  it("rejects a SIRET with an incorrect check digit", () => {
    const siren = generateValidSiren("40000001");
    const siret = generateValidSiret(siren);
    const lastDigit = Number(siret[13]);
    const wrongDigit = (lastDigit + 1) % 10;
    const invalid = siret.slice(0, 13) + String(wrongDigit);
    expect(isValidSiret(invalid)).toBe(false);
  });

  it("rejects a value that isn't exactly 14 digits", () => {
    expect(isValidSiret("12345")).toBe(false);
    expect(isValidSiret("123456789012345")).toBe(false);
  });

  it("throws if given something that isn't already a valid SIREN", () => {
    expect(() => generateValidSiret("123456789")).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/checks/siret.test.ts`
Expected: FAIL — `Cannot find module './siret'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/checks/siret.ts
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

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/checks/siret.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/checks/siret.ts lib/checks/siret.test.ts
git commit -m "Add SIRET generation and validation"
```

---

## Task 2: Schema — add `suppliers.siret` and `invoices.pdf_blob_pathname`

**Files:**
- Modify: `lib/db/schema.ts`
- Test: `lib/db/migrate.test.ts`

**Interfaces:**
- Produces: two new columns other tasks depend on — `suppliers.siret TEXT NOT NULL` (Task 3, Task 5), `invoices.pdf_blob_pathname TEXT` nullable (Task 5, Task 9).

- [ ] **Step 1: Write the failing test**

Add to `lib/db/migrate.test.ts` (new `it` inside the existing `describe("migrate", ...)` block, after the "creates all ten tables" test):

```ts
  it("adds siret to suppliers and pdf_blob_pathname to invoices", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db);

    const supplierColumns = await db.execute("PRAGMA table_info(suppliers)");
    const supplierColumnNames = supplierColumns.rows.map((row) => String(row.name));
    expect(supplierColumnNames).toContain("siret");

    const invoiceColumns = await db.execute("PRAGMA table_info(invoices)");
    const invoiceColumnNames = invoiceColumns.rows.map((row) => String(row.name));
    expect(invoiceColumnNames).toContain("pdf_blob_pathname");

    db.close();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/db/migrate.test.ts`
Expected: FAIL — `supplierColumnNames` does not contain `"siret"`.

- [ ] **Step 3: Write minimal implementation**

In `lib/db/schema.ts`, change the `suppliers` table:

```sql
CREATE TABLE suppliers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  siren TEXT NOT NULL UNIQUE,
  siret TEXT NOT NULL,
  vat_number TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

And the `invoices` table (add `pdf_blob_pathname` after `status`):

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
  pdf_blob_pathname TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/db/migrate.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Run the full suite to check nothing else broke**

Run: `npm test`
Expected: PASS — `lib/db/seed.test.ts`'s suppliers/invoices INSERTs don't list columns by position for these two tables (they use explicit column lists), so this is additive and shouldn't break existing tests. Confirm the run is green before moving on.

- [ ] **Step 6: Commit**

```bash
git add lib/db/schema.ts lib/db/migrate.test.ts
git commit -m "Add suppliers.siret and invoices.pdf_blob_pathname columns"
```

---

## Task 3: Wire SIRET generation into `seed.ts`

**Files:**
- Modify: `lib/db/seed.ts`
- Test: `lib/db/seed.test.ts`

**Interfaces:**
- Consumes: `generateValidSiret` from Task 1, `siret` column from Task 2.
- Produces: every seeded supplier now has a real, stored `siret` — relied on by Task 5's `getAllInvoicesForPdfGeneration`.

- [ ] **Step 1: Write the failing test**

Add to `lib/db/seed.test.ts`, inside the existing `describe("seed - history", ...)` block (add the import at the top of the file too):

```ts
import { isValidSiret } from "../checks/siret";
```

```ts
  it("generates a valid, credible SIRET for every supplier", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db);
    await seed(db);

    const rows = await db.execute("SELECT siren, siret FROM suppliers");
    expect(rows.rows.length).toBe(13);
    for (const row of rows.rows) {
      const siren = String(row.siren);
      const siret = String(row.siret);
      expect(siret.startsWith(siren)).toBe(true);
      expect(isValidSiret(siret)).toBe(true);
    }

    db.close();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/db/seed.test.ts`
Expected: FAIL — `siret` column read comes back `null`/`undefined`, `String(row.siret)` is `"null"` or `"undefined"`, `isValidSiret` returns `false`.

- [ ] **Step 3: Write minimal implementation**

In `lib/db/seed.ts`, add the import near the other `lib/checks` imports:

```ts
import { generateValidSiret } from "../checks/siret";
```

Update the `Supplier` interface:

```ts
interface Supplier {
  id: string;
  name: string;
  siren: string;
  siret: string;
  vatNumber: string;
  registeredIban: string;
}
```

Update `buildSuppliers()`:

```ts
function buildSuppliers(): Supplier[] {
  return supplierSeeds.map((s) => {
    const siren = generateValidSiren(s.base8);
    return {
      id: s.id,
      name: s.name,
      siren,
      siret: generateValidSiret(siren),
      vatNumber: computeVatNumber(siren),
      registeredIban: frenchIban(s.bbanIndex),
    };
  });
}
```

Update the supplier INSERT statement inside `seed()`:

```ts
  for (const supplier of suppliers) {
    statements.push({
      sql: "INSERT INTO suppliers (id, name, siren, siret, vat_number) VALUES (?, ?, ?, ?, ?)",
      args: [supplier.id, supplier.name, supplier.siren, supplier.siret, supplier.vatNumber],
    });
```

(the `iban_history` INSERT right after it is unchanged.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/db/seed.test.ts`
Expected: PASS (all tests in the file, including the new one)

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add lib/db/seed.ts lib/db/seed.test.ts
git commit -m "Generate a real SIRET for every seeded supplier"
```

---

## Task 4: PDF template and renderer (`lib/pdf/document.tsx`, `lib/pdf/generate.tsx`)

**Files:**
- Create: `lib/pdf/document.tsx`
- Create: `lib/pdf/generate.tsx`
- Test: `lib/pdf/generate.test.ts`

**Interfaces:**
- Produces: `InvoicePdfData` interface and `InvoicePdfDocument` component (from `document.tsx`), `renderInvoicePdf(data: InvoicePdfData): Promise<Buffer>` (from `generate.tsx`) — consumed by Task 5 (`InvoicePdfSourceRow extends InvoicePdfData`) and Task 7 (`generate-all.ts`).

- [ ] **Step 1: Install the new dependency**

Run: `npm install @react-pdf/renderer`

- [ ] **Step 2: Write the failing test**

```ts
// lib/pdf/generate.test.ts
import { describe, it, expect } from "vitest";
import { renderInvoicePdf } from "./generate";
import type { InvoicePdfData } from "./document";

const FIXTURE: InvoicePdfData = {
  invoiceNumber: "TEST-0001",
  issueDate: "2026-08-01",
  dueDate: "2026-09-01",
  category: "consulting",
  amountExclVatCents: 150000,
  amountInclVatCents: 180000,
  printedIban: "FR7640100000010000000000001",
  printedSiren: "400000015",
  printedVatNumber: "FR32400000015",
  supplierName: "Fournisseur Fictif SAS",
  supplierSiret: "40000001500015",
  entityName: "Filiale Fictive",
};

describe("renderInvoicePdf", () => {
  it("renders a non-empty PDF buffer starting with the PDF magic bytes", async () => {
    const pdf = await renderInvoicePdf(FIXTURE);
    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.length).toBeGreaterThan(0);
    expect(pdf.subarray(0, 4).toString("ascii")).toBe("%PDF");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run lib/pdf/generate.test.ts`
Expected: FAIL — `Cannot find module './generate'`.

- [ ] **Step 4: Write minimal implementation**

```tsx
// lib/pdf/document.tsx
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import { formatEuros, formatDateFr, formatIbanGrouped, formatCategory } from "../format";

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
  label: { color: "#666666", marginBottom: 2 },
  title: { fontSize: 14, marginBottom: 4 },
  table: { marginTop: 24, borderTop: 1, borderColor: "#cccccc" },
  tableRow: { flexDirection: "row", borderBottom: 1, borderColor: "#eeeeee", paddingVertical: 6 },
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

```tsx
// lib/pdf/generate.tsx
import { renderToBuffer } from "@react-pdf/renderer";
import { InvoicePdfDocument, type InvoicePdfData } from "./document";

export async function renderInvoicePdf(data: InvoicePdfData): Promise<Buffer> {
  return renderToBuffer(<InvoicePdfDocument {...data} />);
}
```

Note: SIREN/VAT/IBAN come from the invoice's `printed_*` values (passed in by the caller), never the supplier registry — that's what keeps a deliberate mismatch scenario (e.g. a foreign IBAN, a wrong SIREN) visible on the rendered PDF itself. SIRET has no `printed_*` counterpart on `invoices` (no classification rule checks it), so it always comes from the supplier registry — that's `supplierSiret` here.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run lib/pdf/generate.test.ts`
Expected: PASS. If it fails with a module resolution error related to `react-server` (this project's `vitest.config.ts` sets `resolve: { conditions: ["react-server"] }`), that means `@react-pdf/renderer` or `react`'s package exports don't have a `react-server` entry and Vitest isn't falling back — if that happens, this is a real environment issue to resolve before continuing (do not skip the test or mock around it); check `@react-pdf/renderer`'s installed `package.json` `exports` field for what conditions it does define.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json lib/pdf/document.tsx lib/pdf/generate.tsx lib/pdf/generate.test.ts
git commit -m "Add invoice PDF template and renderer"
```

---

## Task 5: DB queries for PDF pathname and generation source data

**Files:**
- Modify: `lib/db/queries.ts`
- Test: `lib/db/queries.test.ts`

**Interfaces:**
- Consumes: `InvoicePdfData` from Task 4 (`../pdf/document`), `siret`/`pdf_blob_pathname` columns from Task 2, seeded `siret` values from Task 3.
- Produces: `getAllInvoicesForPdfGeneration(db): Promise<InvoicePdfSourceRow[]>`, `setInvoicePdfPathname(db, invoiceId, pathname): Promise<void>`, `getInvoicePdfPathname(db, invoiceId): Promise<string | null>` — consumed by Task 6 (`store.ts`), Task 7 (`generate-all.ts`), and Task 9 (the API route).

- [ ] **Step 1: Write the failing test**

Add to `lib/db/queries.test.ts`. First, extend the existing import block:

```ts
import {
  getPendingInvoices,
  getClassification,
  getInvoicesByIds,
  getDecisionSessionId,
  getSessionWithDecisions,
  getInboxInvoices,
  getNotifications,
  getThresholds,
  saveThresholds,
  getEntities,
  getAllInvoicesForPdfGeneration,
  setInvoicePdfPathname,
  getInvoicePdfPathname,
} from "./queries";
```

Then add these new `describe` blocks at the end of the file:

```ts
describe("getInvoicePdfPathname / setInvoicePdfPathname", () => {
  it("returns null until a pathname is set, then returns what was set", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db);
    await seed(db);

    expect(await getInvoicePdfPathname(db, "inv-pending-novalink")).toBeNull();

    await setInvoicePdfPathname(db, "inv-pending-novalink", "invoices/inv-pending-novalink.pdf");

    expect(await getInvoicePdfPathname(db, "inv-pending-novalink")).toBe(
      "invoices/inv-pending-novalink.pdf"
    );
    // A different invoice is unaffected.
    expect(await getInvoicePdfPathname(db, "inv-pending-cloudnimbus")).toBeNull();

    db.close();
  });
});

describe("getAllInvoicesForPdfGeneration", () => {
  it("returns one row per invoice with the supplier's real SIRET and correct cent amounts", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db);
    await seed(db);

    const rows = await getAllInvoicesForPdfGeneration(db);
    const countResult = await db.execute("SELECT COUNT(*) AS count FROM invoices");
    expect(rows.length).toBe(Number(countResult.rows[0].count));

    const novalink = rows.find((row) => row.id === "inv-pending-novalink");
    expect(novalink).toBeDefined();
    expect(novalink?.invoiceNumber).toBe("PEND-NOVALINK-01");
    expect(novalink?.supplierName).toBe("NovaLink Télécom");
    expect(novalink?.supplierSiret).toHaveLength(14);
    expect(novalink?.entityName).toBe("Arcadia Télécom");
    expect(typeof novalink?.amountExclVatCents).toBe("number");
    expect(novalink?.amountExclVatCents).toBe(180000);

    db.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/db/queries.test.ts`
Expected: FAIL — `getAllInvoicesForPdfGeneration`, `setInvoicePdfPathname`, `getInvoicePdfPathname` are not exported from `./queries`.

- [ ] **Step 3: Write minimal implementation**

At the top of `lib/db/queries.ts`, add the import:

```ts
import type { InvoicePdfData } from "../pdf/document";
```

At the end of `lib/db/queries.ts` (after `getEntities`), add:

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
  return result.rows.map((row) => ({
    id: String(row.id),
    invoiceNumber: String(row.invoiceNumber),
    category: String(row.category),
    amountExclVatCents: Number(row.amountExclVatCents),
    amountInclVatCents: Number(row.amountInclVatCents),
    issueDate: String(row.issueDate),
    dueDate: String(row.dueDate),
    printedIban: String(row.printedIban),
    printedSiren: String(row.printedSiren),
    printedVatNumber: String(row.printedVatNumber),
    supplierName: String(row.supplierName),
    supplierSiret: String(row.supplierSiret),
    entityName: String(row.entityName),
  }));
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

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/db/queries.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add lib/db/queries.ts lib/db/queries.test.ts
git commit -m "Add DB queries for invoice PDF pathname and generation source data"
```

---

## Task 6: Blob storage (`lib/pdf/store.ts`)

**Files:**
- Create: `lib/pdf/store.ts`
- Test: `lib/pdf/store.test.ts`

**Interfaces:**
- Consumes: `setInvoicePdfPathname` from Task 5.
- Produces: `storeInvoicePdf(db: Client, invoiceId: string, pdf: Buffer): Promise<void>` — consumed by Task 7 (`generate-all.ts`), and reused unchanged by any future upload feature.

- [ ] **Step 1: Install the new dependency**

Run: `npm install @vercel/blob`

- [ ] **Step 2: Write the failing test**

```ts
// lib/pdf/store.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createClient } from "@libsql/client";
import { migrate } from "../db/migrate";
import { seed } from "../db/seed";
import { getInvoicePdfPathname } from "../db/queries";
import { storeInvoicePdf } from "./store";

const putMock = vi.fn();
vi.mock("@vercel/blob", () => ({
  put: (...args: unknown[]) => putMock(...args),
}));

describe("storeInvoicePdf", () => {
  beforeEach(() => {
    putMock.mockReset();
    putMock.mockResolvedValue({
      url: "https://example.blob.vercel-storage.com/invoices/inv-pending-novalink.pdf",
    });
  });

  it("uploads the PDF as a private blob and records its pathname on the invoice", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db);
    await seed(db);

    const pdf = Buffer.from("%PDF-fake");
    await storeInvoicePdf(db, "inv-pending-novalink", pdf);

    expect(putMock).toHaveBeenCalledWith("invoices/inv-pending-novalink.pdf", pdf, {
      access: "private",
    });

    const pathname = await getInvoicePdfPathname(db, "inv-pending-novalink");
    expect(pathname).toBe("invoices/inv-pending-novalink.pdf");

    db.close();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run lib/pdf/store.test.ts`
Expected: FAIL — `Cannot find module './store'`.

- [ ] **Step 4: Write minimal implementation**

```ts
// lib/pdf/store.ts
import "server-only";
import { put } from "@vercel/blob";
import type { Client } from "@libsql/client";
import { setInvoicePdfPathname } from "../db/queries";

export async function storeInvoicePdf(db: Client, invoiceId: string, pdf: Buffer): Promise<void> {
  const pathname = `invoices/${invoiceId}.pdf`;
  await put(pathname, pdf, { access: "private" });
  await setInvoicePdfPathname(db, invoiceId, pathname);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run lib/pdf/store.test.ts`
Expected: PASS

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS — confirms `vi.mock("@vercel/blob", ...)` in this one test file doesn't leak into other test files (Vitest scopes `vi.mock` per test file by default).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json lib/pdf/store.ts lib/pdf/store.test.ts
git commit -m "Add private Blob storage for invoice PDFs"
```

---

## Task 7: PDF generation orchestrator (`lib/pdf/generate-all.ts`)

**Files:**
- Create: `lib/pdf/generate-all.ts`
- Test: `lib/pdf/generate-all.test.ts`

**Interfaces:**
- Consumes: `getAllInvoicesForPdfGeneration` from Task 5, `renderInvoicePdf` from Task 4, `storeInvoicePdf` from Task 6.
- Produces: `generateAllInvoicePdfs(db: Client): Promise<void>` — consumed by Task 8 (`scripts/seed.ts`).

- [ ] **Step 1: Write the failing test**

```ts
// lib/pdf/generate-all.test.ts
import { describe, it, expect, vi } from "vitest";
import { createClient } from "@libsql/client";
import { migrate } from "../db/migrate";
import { seed } from "../db/seed";
import { getAllInvoicesForPdfGeneration } from "../db/queries";
import { generateAllInvoicePdfs } from "./generate-all";

const renderMock = vi.fn().mockResolvedValue(Buffer.from("%PDF-fake"));
const storeMock = vi.fn().mockResolvedValue(undefined);
vi.mock("./generate", () => ({ renderInvoicePdf: (...args: unknown[]) => renderMock(...args) }));
vi.mock("./store", () => ({ storeInvoicePdf: (...args: unknown[]) => storeMock(...args) }));

describe("generateAllInvoicePdfs", () => {
  it("renders and stores a PDF for every invoice in the database", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db);
    await seed(db);

    const invoices = await getAllInvoicesForPdfGeneration(db);
    expect(invoices.length).toBeGreaterThan(0);

    await generateAllInvoicePdfs(db);

    expect(renderMock).toHaveBeenCalledTimes(invoices.length);
    expect(storeMock).toHaveBeenCalledTimes(invoices.length);
    // Each store call got the invoice id that matches what render produced for it.
    const storedIds = storeMock.mock.calls.map((call) => call[1]);
    expect(new Set(storedIds).size).toBe(invoices.length);

    db.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/pdf/generate-all.test.ts`
Expected: FAIL — `Cannot find module './generate-all'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/pdf/generate-all.ts
import "server-only";
import type { Client } from "@libsql/client";
import { getAllInvoicesForPdfGeneration } from "../db/queries";
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

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/pdf/generate-all.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add lib/pdf/generate-all.ts lib/pdf/generate-all.test.ts
git commit -m "Add orchestrator to generate and store a PDF for every invoice"
```

---

## Task 8: Wire PDF generation into the seed script

**Files:**
- Modify: `scripts/seed.ts`

**Interfaces:**
- Consumes: `generateAllInvoicePdfs` from Task 7.

No unit test for this task — it's a thin CLI wrapper around the real Turso DB and the real Vercel Blob network call, which needs a real `BLOB_READ_WRITE_TOKEN` (see the "Manual verification" step). This mirrors how the existing `ANTHROPIC_API_KEY`/Claude call in this codebase has no automated test either.

- [ ] **Step 1: Modify the script**

```ts
// scripts/seed.ts
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

- [ ] **Step 2: Add `BLOB_READ_WRITE_TOKEN` to `.env.example`**

In `.env.example`, add a line after the existing three:

```
TURSO_DATABASE_URL=
TURSO_AUTH_TOKEN=
ANTHROPIC_API_KEY=
BLOB_READ_WRITE_TOKEN=
```

- [ ] **Step 3: Manual verification (requires a real Vercel Blob store)**

This step needs `BLOB_READ_WRITE_TOKEN` set in `.env.local` to a real token from a Vercel Blob store (create one at vercel.com if you haven't already, per the earlier design discussion). With it set:

Run: `npm run seed`

Expected: the console prints `Seed complete.`, then `Generating invoice PDFs…`, then (after a real but bounded wait — roughly a minute, uploading ~155 PDFs at concurrency 8) `PDFs uploaded.`, with no errors. If `BLOB_READ_WRITE_TOKEN` is missing or wrong, `npm run seed` will fail with `@vercel/blob`'s own error after `Seed complete.` prints — that's expected and not a bug to fix, just confirmation the token needs to be set.

Then confirm every invoice got a pathname:

Run: `TURSO_DATABASE_URL= TURSO_AUTH_TOKEN= npx tsx -e "
import { createClient } from '@libsql/client';
const db = createClient({ url: 'file:data/app.db' });
const total = await db.execute('SELECT COUNT(*) AS c FROM invoices');
const withPdf = await db.execute('SELECT COUNT(*) AS c FROM invoices WHERE pdf_blob_pathname IS NOT NULL');
console.log({ total: total.rows[0].c, withPdf: withPdf.rows[0].c });
"`

Expected: `total` and `withPdf` are equal.

- [ ] **Step 4: Commit**

```bash
git add scripts/seed.ts .env.example
git commit -m "Generate and upload every invoice's PDF at seed time"
```

---

## Task 9: API route (`app/api/invoices/[id]/pdf/route.ts`)

**Files:**
- Create: `app/api/invoices/[id]/pdf/route.ts`

**Interfaces:**
- Consumes: `getInvoicePdfPathname` from Task 5, `get` from `@vercel/blob` (already installed in Task 6).

No unit test for this task (same reasoning as Task 8 — needs a real Blob store and network access). Verified manually below, and this is also the first thing Task 11's browser check exercises end to end.

- [ ] **Step 1: Write the route**

```ts
// app/api/invoices/[id]/pdf/route.ts
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

- [ ] **Step 2: Manual verification**

Requires Task 8's manual verification to already have run (`npm run seed` with a real token, so `data/app.db` has real pathnames pointing at real uploaded blobs).

Start the dev server if it isn't already running: `npm run dev`

Run:
```bash
curl -s -o /dev/null -w "known invoice -> HTTP %{http_code}, content-type: %{content_type}\n" \
  http://localhost:3000/api/invoices/inv-pending-novalink/pdf
curl -s -o /dev/null -w "unknown invoice -> HTTP %{http_code}\n" \
  http://localhost:3000/api/invoices/does-not-exist/pdf
```

Expected: first line `HTTP 200, content-type: application/pdf`; second line `HTTP 404`.

- [ ] **Step 3: Commit**

```bash
git add app/api/invoices/[id]/pdf/route.ts
git commit -m "Add API route that streams an invoice's private PDF"
```

---

## Task 10: `ViewPdfButton` component

**Files:**
- Create: `components/view-pdf-button.tsx`

**Interfaces:**
- Produces: `ViewPdfButton({ invoiceId, className }: { invoiceId: string; className?: string })` — consumed by Task 11 (invoice detail page) and Task 12 (bordereau page).

No automated test — this codebase has no client-component test setup (no `components/*.test.tsx` exist, `vitest.config.ts` runs in the `"node"` environment, not `jsdom`), and adding one just for this button would be new test infrastructure out of scope for this feature. Verified manually in Task 11/12's browser checks.

- [ ] **Step 1: Write the component**

```tsx
// components/view-pdf-button.tsx
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

- [ ] **Step 2: Run type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/view-pdf-button.tsx
git commit -m "Add shared ViewPdfButton component"
```

---

## Task 11: Wire `ViewPdfButton` into the invoice detail page

**Files:**
- Modify: `app/(app)/invoices/[id]/page.tsx`

**Interfaces:**
- Consumes: `ViewPdfButton` from Task 10.

- [ ] **Step 1: Add the import**

In `app/(app)/invoices/[id]/page.tsx`, add near the other component imports:

```ts
import { ViewPdfButton } from "@/components/view-pdf-button";
```

- [ ] **Step 2: Add the button next to the invoice number heading**

Replace:

```tsx
      <div>
        <h1 className="text-lg font-semibold text-gray-900">{context.invoice.invoiceNumber}</h1>
        <dl className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
```

With:

```tsx
      <div>
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-lg font-semibold text-gray-900">{context.invoice.invoiceNumber}</h1>
          <ViewPdfButton
            invoiceId={context.invoice.id}
            className="min-h-[44px] shrink-0 rounded border border-gray-300 px-3 text-sm font-medium text-gray-700"
          />
        </div>
        <dl className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
```

- [ ] **Step 3: Run type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual verification in the browser**

Requires Task 8/9's manual verification already done (real PDFs uploaded, route working). Start `npm run dev` if not already running.

1. Open `http://localhost:3000/invoices/inv-pending-novalink`.
2. Resize the browser (or use device toolbar) to 375px wide. Click "Voir le PDF". Expected: an in-page modal opens showing the PDF in an iframe, with a working "Fermer" button.
3. Resize to desktop width (≥ 640px, e.g. 1200px). Click "Voir le PDF" again. Expected: the PDF opens in a new browser tab instead of a modal.
4. In the rendered PDF, confirm it shows `context.invoice.printedIban`/`printedSiren` (the values already visible elsewhere on this same page under "Identité du fournisseur"), not the supplier registry's — this is easiest to see on an invoice with a known mismatch, e.g. `http://localhost:3000/invoices/inv-pending-meridian` (foreign IBAN) or `http://localhost:3000/invoices/inv-pending-ondine` (mismatched SIREN).

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/invoices/[id]/page.tsx"
git commit -m "Add Voir le PDF button to the invoice detail page"
```

---

## Task 12: Wire `ViewPdfButton` into the bordereau

**Files:**
- Modify: `app/(app)/sessions/[id]/page.tsx`

**Interfaces:**
- Consumes: `ViewPdfButton` from Task 10.

- [ ] **Step 1: Add the import**

In `app/(app)/sessions/[id]/page.tsx`, add near the other component imports:

```ts
import { ViewPdfButton } from "@/components/view-pdf-button";
```

- [ ] **Step 2: Add a PDF column to the decisions table**

Replace the table header:

```tsx
        <thead>
          <tr className="border-b border-gray-200 text-left text-gray-500">
            <th className="py-2 pr-4 font-normal">Facture</th>
            <th className="py-2 pr-4 font-normal">Fournisseur</th>
            <th className="py-2 pr-4 font-normal">Filiale</th>
            <th className="py-2 pr-4 text-right font-normal">Montant</th>
            <th className="py-2 pr-4 font-normal">Niveau</th>
            <th className="py-2 pr-4 font-normal">Décision</th>
            <th className="py-2 font-normal">Commentaire</th>
          </tr>
        </thead>
```

With:

```tsx
        <thead>
          <tr className="border-b border-gray-200 text-left text-gray-500">
            <th className="py-2 pr-4 font-normal">Facture</th>
            <th className="py-2 pr-4 font-normal">Fournisseur</th>
            <th className="py-2 pr-4 font-normal">Filiale</th>
            <th className="py-2 pr-4 text-right font-normal">Montant</th>
            <th className="py-2 pr-4 font-normal">Niveau</th>
            <th className="py-2 pr-4 font-normal">Décision</th>
            <th className="py-2 pr-4 font-normal">Commentaire</th>
            <th className="no-print py-2 font-normal">PDF</th>
          </tr>
        </thead>
```

Replace each decision row:

```tsx
          {session.decisions.map((decision) => (
            <tr key={decision.invoiceId} className="border-b border-gray-100">
              <td className="py-2 pr-4 text-gray-900">{decision.invoiceNumber}</td>
              <td className="py-2 pr-4 text-gray-900">{decision.supplierName}</td>
              <td className="py-2 pr-4 text-gray-900">{decision.entityName}</td>
              <td className="py-2 pr-4 text-right">
                <Amount cents={decision.amountInclVatCents} />
              </td>
              <td className="py-2 pr-4">{decision.level && <LevelBadge level={decision.level} />}</td>
              <td className="py-2 pr-4 text-gray-900">{decision.outcome === "approved" ? "Approuvée" : "Rejetée"}</td>
              <td className="py-2 text-gray-600">{decision.comment ?? "—"}</td>
            </tr>
          ))}
```

With:

```tsx
          {session.decisions.map((decision) => (
            <tr key={decision.invoiceId} className="border-b border-gray-100">
              <td className="py-2 pr-4 text-gray-900">{decision.invoiceNumber}</td>
              <td className="py-2 pr-4 text-gray-900">{decision.supplierName}</td>
              <td className="py-2 pr-4 text-gray-900">{decision.entityName}</td>
              <td className="py-2 pr-4 text-right">
                <Amount cents={decision.amountInclVatCents} />
              </td>
              <td className="py-2 pr-4">{decision.level && <LevelBadge level={decision.level} />}</td>
              <td className="py-2 pr-4 text-gray-900">{decision.outcome === "approved" ? "Approuvée" : "Rejetée"}</td>
              <td className="py-2 pr-4 text-gray-600">{decision.comment ?? "—"}</td>
              <td className="no-print py-2">
                <ViewPdfButton invoiceId={decision.invoiceId} className="text-sm text-blue-600 underline" />
              </td>
            </tr>
          ))}
```

And the total row (the trailing empty `<td>`'s `colSpan` grows from 3 to 4 to cover the new PDF column):

```tsx
          <tr className="font-medium text-gray-900">
            <td className="py-2 pr-4" colSpan={3}>
              Total
            </td>
            <td className="py-2 pr-4 text-right">
              <Amount cents={total} />
            </td>
            <td colSpan={4} />
          </tr>
```

- [ ] **Step 3: Run type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual verification in the browser**

Requires Task 8/9 already done. With the dev server running, open any bordereau, e.g. sign a batch from `/` first, or navigate directly to a backfilled historical one — get a real id by running:

```bash
TURSO_DATABASE_URL= TURSO_AUTH_TOKEN= npx tsx -e "
import { createClient } from '@libsql/client';
const db = createClient({ url: 'file:data/app.db' });
const row = await db.execute(\"SELECT id FROM sessions WHERE id LIKE 'ses-hist-%' LIMIT 1\");
console.log(row.rows[0].id);
"
```

Open `http://localhost:3000/sessions/<that id>`. Expected: a "PDF" column with a working "Voir le PDF" link on every row, behaving the same as Task 11 (iframe modal at 375px, new tab at desktop width). Also confirm the page still prints cleanly (`Imprimer` button) — the new "PDF" column should disappear from the print layout, since it's marked `no-print` like the existing `PrintButton`/`CopyHashButton`.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/sessions/[id]/page.tsx"
git commit -m "Add Voir le PDF link to every bordereau row"
```

---

## Task 13: Document the new dependency in CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the Stack section**

In `CLAUDE.md`, under `## Stack`, add a line after the existing three:

```markdown
## Stack
- Next.js (App Router, TypeScript, server actions), Tailwind
- SQLite via better-sqlite3, single file at `data/app.db`
- Vitest for tests
- Invoice PDFs: private Vercel Blob store (`@vercel/blob`), never a public URL — see `/api/invoices/[id]/pdf`
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "Document invoice PDF storage in CLAUDE.md"
```

---

## Done when

- `npm run lint`, `npx tsc --noEmit`, and `npm test` all pass, and `npm test` makes no network calls (confirmed by Task 6/7's mocked tests passing without a real `BLOB_READ_WRITE_TOKEN` set).
- `npm run seed` (with a real `BLOB_READ_WRITE_TOKEN` in `.env.local`) completes and every invoice ends up with a non-null `pdf_blob_pathname`.
- `/invoices/[id]` shows a working "Voir le PDF" — iframe modal at 375px, new tab at desktop width — and the rendered PDF shows the invoice's `printed_iban`/`printed_siren`, not the registry's, on a known-mismatch invoice.
- `/sessions/[id]` shows the same working link on every row, for both a live batch session and a backfilled `ses-hist-*` one, and the column disappears when printed.
- `/api/invoices/<id>/pdf` returns a PDF with `Content-Type: application/pdf` for a real invoice and 404 for an unknown one or one with no PDF.
- No Blob URL is ever visible to the client — only `/api/invoices/[id]/pdf` links.
