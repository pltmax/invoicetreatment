# App Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the project scaffold, async libSQL DB layer, full schema, and a deterministic demo seed for the invoice-approval app, plus a plain verification page — no rules engine, no real UI.

**Architecture:** Next.js 15 App Router server components talk to a single libSQL client (`lib/db/client.ts`). All SQL lives under `lib/db/` (`schema.sql`, `migrate.ts`, `seed.ts`, `queries.ts`), all pure validation helpers under `lib/checks/`. A deterministic seed builds 4 entities, 13 fictional suppliers, 12 contracts, 12 months of coherent approved history, and 13 pending invoices — each triggering exactly one classification scenario from CLAUDE.md's domain rules. A plain server-rendered page lists the pending invoices; a server action resets the demo.

**Tech Stack:** Next.js 15 (App Router, TS strict), Tailwind, `@libsql/client`, Vitest, tsx, dotenv.

**Spec:** `docs/superpowers/specs/2026-09-27-app-foundation-design.md`

## Global Constraints

- Database: libSQL via `@libsql/client` only — never better-sqlite3 (no persistent filesystem on Vercel serverless).
- `lib/db/client.ts` exports one client: `url: process.env.TURSO_DATABASE_URL ?? "file:data/app.db"`, `authToken: process.env.TURSO_AUTH_TOKEN`.
- Every file under `lib/db/` starts with `import "server-only"`.
- All DB access is async.
- Multi-statement writes use `db.batch([...], "write")` for atomicity.
- `data/` and `.env*.local` are gitignored; `.env.example` lists `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`.
- Seed is deterministic: one `today` reference per run, all dates derived from it, no unseeded randomness.
- All seed data is fictional; SIRENs pass Luhn, VAT numbers follow `FR{key}{siren}` with `key = (12 + 3 * (siren mod 97)) mod 97`, IBANs pass the general mod-97 checksum.
- UI copy in French; code and comments in English.
- Amounts stored as integer cents.
- `classifications` rows exist only for already-decided (historical) invoices — pending demo invoices carry their expected level only in the seed's exported `expectedClassifications` array, never in the DB.

---

## Task 1: Project scaffold and tooling config

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `next-env.d.ts`
- Create: `next.config.ts`
- Create: `tailwind.config.ts`
- Create: `postcss.config.js`
- Create: `vitest.config.ts`
- Create: `eslint.config.mjs`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `app/layout.tsx`
- Create: `app/globals.css`
- Create: `app/page.tsx` (placeholder, replaced in Task 10)

**Interfaces:**
- Produces: a working `npm run build` / `npm test` / `npm run dev` toolchain that every later task relies on.

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "invoice-treatment",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint .",
    "test": "vitest run",
    "db:migrate": "DOTENV_CONFIG_PATH=.env.local tsx -r dotenv/config scripts/migrate.ts",
    "db:seed": "DOTENV_CONFIG_PATH=.env.local tsx -r dotenv/config scripts/seed.ts",
    "db:reset": "npm run db:migrate && npm run db:seed"
  },
  "dependencies": {
    "@libsql/client": "^0.14.0",
    "next": "^15.1.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "server-only": "^0.0.1"
  },
  "devDependencies": {
    "@eslint/eslintrc": "^3.2.0",
    "@types/node": "^22.10.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "autoprefixer": "^10.4.20",
    "dotenv": "^16.4.7",
    "eslint": "^9.17.0",
    "eslint-config-next": "^15.1.0",
    "postcss": "^8.4.49",
    "tailwindcss": "^3.4.17",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Write `next-env.d.ts`**

```ts
/// <reference types="next" />
/// <reference types="next/image-types/global" />
```

- [ ] **Step 4: Write `next.config.ts`**

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {};

export default nextConfig;
```

- [ ] **Step 5: Write `tailwind.config.ts`**

```ts
import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}"],
  theme: { extend: {} },
  plugins: [],
};

export default config;
```

- [ ] **Step 6: Write `postcss.config.js`**

```js
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 7: Write `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
  },
});
```

- [ ] **Step 8: Write `eslint.config.mjs`**

```js
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

export default [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  { ignores: [".next/**", "data/**"] },
];
```

- [ ] **Step 9: Write `.gitignore`**

```
node_modules/
.next/
data/
.env*.local
```

- [ ] **Step 10: Write `.env.example`**

```
TURSO_DATABASE_URL=
TURSO_AUTH_TOKEN=
```

- [ ] **Step 11: Write `app/globals.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

- [ ] **Step 12: Write `app/layout.tsx`**

```tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Approbation des factures",
  description: "Démo d'approbation centralisée des factures",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 13: Write a placeholder `app/page.tsx`** (Task 10 replaces this)

```tsx
export default function Home() {
  return <main className="p-8">Fondations en cours de construction.</main>;
}
```

- [ ] **Step 14: Install dependencies**

Run: `npm install`
Expected: exits 0, `node_modules/` created.

- [ ] **Step 15: Verify the build**

Run: `npm run build`
Expected: exits 0, no type errors.

- [ ] **Step 16: Commit**

```bash
git add package.json package-lock.json tsconfig.json next-env.d.ts next.config.ts tailwind.config.ts postcss.config.js vitest.config.ts eslint.config.mjs .gitignore .env.example app/
git commit -m "$(cat <<'EOF'
Scaffold Next.js 15 project with TypeScript, Tailwind, and Vitest

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LEEb7f2rr9ykD3iUMNRGLA
EOF
)"
```

---

## Task 2: DB client, schema, and migration

**Files:**
- Create: `lib/db/client.ts`
- Create: `lib/db/schema.sql`
- Create: `lib/db/migrate.ts`
- Create: `lib/db/migrate.test.ts`
- Create: `scripts/migrate.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `db: Client` (the shared libSQL client, from `lib/db/client.ts`); `migrate(db: Client): Promise<void>` (from `lib/db/migrate.ts`) — applies `schema.sql`, dropping and recreating all nine tables. Later tasks import both.

- [ ] **Step 1: Write `lib/db/client.ts`**

```ts
import "server-only";
import { createClient } from "@libsql/client";

export const db = createClient({
  url: process.env.TURSO_DATABASE_URL ?? "file:data/app.db",
  authToken: process.env.TURSO_AUTH_TOKEN,
});
```

- [ ] **Step 2: Write `lib/db/schema.sql`**

```sql
DROP TABLE IF EXISTS decisions;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS classifications;
DROP TABLE IF EXISTS invoices;
DROP TABLE IF EXISTS contracts;
DROP TABLE IF EXISTS risk_events;
DROP TABLE IF EXISTS iban_history;
DROP TABLE IF EXISTS suppliers;
DROP TABLE IF EXISTS entities;

CREATE TABLE entities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sector TEXT NOT NULL CHECK (sector IN ('telecom', 'media', 'real_estate', 'services')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE suppliers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  siren TEXT NOT NULL UNIQUE,
  vat_number TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE iban_history (
  id TEXT PRIMARY KEY,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id),
  iban TEXT NOT NULL,
  effective_from TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_iban_history_supplier ON iban_history(supplier_id, effective_from);

CREATE TABLE risk_events (
  id TEXT PRIMARY KEY,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id),
  event_date TEXT NOT NULL,
  description TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_risk_events_supplier ON risk_events(supplier_id);

CREATE TABLE contracts (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL REFERENCES entities(id),
  supplier_id TEXT NOT NULL REFERENCES suppliers(id),
  category TEXT NOT NULL,
  expected_amount_cents INTEGER,
  start_date TEXT NOT NULL,
  end_date TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_contracts_entity_supplier ON contracts(entity_id, supplier_id);

CREATE TABLE invoices (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL REFERENCES entities(id),
  supplier_id TEXT NOT NULL REFERENCES suppliers(id),
  contract_id TEXT REFERENCES contracts(id),
  invoice_number TEXT NOT NULL,
  category TEXT NOT NULL,
  amount_excl_vat_cents INTEGER NOT NULL,
  amount_incl_vat_cents INTEGER NOT NULL,
  due_date TEXT NOT NULL,
  printed_iban TEXT NOT NULL,
  printed_siren TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')) DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_invoices_status_due ON invoices(status, due_date);
CREATE INDEX idx_invoices_supplier ON invoices(supplier_id);

CREATE TABLE classifications (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL UNIQUE REFERENCES invoices(id),
  level TEXT NOT NULL CHECK (level IN ('green', 'orange', 'red')),
  reasons TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('batch', 'single')),
  content_hash TEXT NOT NULL,
  signed_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE decisions (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  invoice_id TEXT NOT NULL UNIQUE REFERENCES invoices(id),
  outcome TEXT NOT NULL CHECK (outcome IN ('approved', 'rejected')) DEFAULT 'approved',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_decisions_session ON decisions(session_id);
```

- [ ] **Step 3: Write `lib/db/migrate.ts`**

```ts
import "server-only";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { Client } from "@libsql/client";

const SCHEMA_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "schema.sql");

export async function migrate(db: Client): Promise<void> {
  const schema = readFileSync(SCHEMA_PATH, "utf-8");
  await db.executeMultiple(schema);
}
```

- [ ] **Step 4: Write the failing test `lib/db/migrate.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { createClient } from "@libsql/client";
import { migrate } from "./migrate";

describe("migrate", () => {
  it("creates all nine tables", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db);

    const result = await db.execute(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
    );
    const tableNames = result.rows.map((row) => String(row.name));

    expect(tableNames).toEqual([
      "classifications",
      "contracts",
      "decisions",
      "entities",
      "iban_history",
      "invoices",
      "risk_events",
      "sessions",
      "suppliers",
    ]);

    db.close();
  });
});
```

- [ ] **Step 5: Run the test**

Run: `npx vitest run lib/db/migrate.test.ts`
Expected: PASS (schema.sql already exists, so this confirms it's well-formed rather than failing-first).

- [ ] **Step 6: Write `scripts/migrate.ts`**

```ts
import { mkdirSync } from "node:fs";
import { db } from "../lib/db/client";
import { migrate } from "../lib/db/migrate";

async function main() {
  if (!process.env.TURSO_DATABASE_URL) {
    mkdirSync("data", { recursive: true });
  }
  await migrate(db);
  console.log("Migration complete.");
  db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 7: Run the migration against the local file**

Run: `npx tsx scripts/migrate.ts`
Expected: prints "Migration complete.", creates `data/app.db`.

- [ ] **Step 8: Commit**

```bash
git add lib/db/client.ts lib/db/schema.sql lib/db/migrate.ts lib/db/migrate.test.ts scripts/migrate.ts
git commit -m "$(cat <<'EOF'
Add libSQL client, schema, and migration script

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LEEb7f2rr9ykD3iUMNRGLA
EOF
)"
```

---

## Task 3: SIREN Luhn check

**Files:**
- Create: `lib/checks/siren.ts`
- Test: `lib/checks/siren.test.ts`

**Interfaces:**
- Produces: `isValidSiren(siren: string): boolean`; `generateValidSiren(base8: string): string` — appends the Luhn check digit to an 8-digit base. Reused by `lib/db/seed.ts` (Task 6) and, later, the rules engine.

- [ ] **Step 1: Write the failing test `lib/checks/siren.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { isValidSiren, generateValidSiren } from "./siren";

describe("siren", () => {
  it("accepts a generated siren with a correct Luhn check digit", () => {
    const siren = generateValidSiren("40000001");
    expect(isValidSiren(siren)).toBe(true);
  });

  it("rejects a siren with an incorrect check digit", () => {
    const siren = generateValidSiren("40000001");
    const lastDigit = Number(siren[8]);
    const wrongDigit = (lastDigit + 1) % 10;
    const invalid = siren.slice(0, 8) + String(wrongDigit);
    expect(isValidSiren(invalid)).toBe(false);
  });

  it("rejects a value that isn't exactly 9 digits", () => {
    expect(isValidSiren("12345")).toBe(false);
    expect(isValidSiren("1234567890")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/checks/siren.test.ts`
Expected: FAIL — `Cannot find module './siren'`.

- [ ] **Step 3: Write `lib/checks/siren.ts`**

```ts
function luhnRemainder(digits: string): number {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let value = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
  }
  return sum % 10;
}

export function isValidSiren(siren: string): boolean {
  if (!/^\d{9}$/.test(siren)) return false;
  return luhnRemainder(siren) === 0;
}

export function generateValidSiren(base8: string): string {
  if (!/^\d{8}$/.test(base8)) {
    throw new Error("base8 must be exactly 8 digits");
  }
  for (let check = 0; check <= 9; check++) {
    const candidate = base8 + String(check);
    if (isValidSiren(candidate)) return candidate;
  }
  throw new Error("no valid Luhn check digit found");
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/checks/siren.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/checks/siren.ts lib/checks/siren.test.ts
git commit -m "$(cat <<'EOF'
Add SIREN Luhn validation and generation

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LEEb7f2rr9ykD3iUMNRGLA
EOF
)"
```

---

## Task 4: FR VAT key

**Files:**
- Create: `lib/checks/vat.ts`
- Test: `lib/checks/vat.test.ts`

**Interfaces:**
- Consumes: `generateValidSiren` from `lib/checks/siren.ts` (Task 3), test-only.
- Produces: `computeVatKey(siren: string): string`; `computeVatNumber(siren: string): string` returning `FR{key}{siren}`. Reused by `lib/db/seed.ts` (Task 6).

- [ ] **Step 1: Write the failing test `lib/checks/vat.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { computeVatKey, computeVatNumber } from "./vat";
import { generateValidSiren } from "./siren";

describe("vat", () => {
  it("computes the FR VAT key as (12 + 3 * (siren mod 97)) mod 97, zero-padded", () => {
    const siren = generateValidSiren("40000001");
    const sirenMod97 = Number(siren) % 97;
    const expectedKey = String((12 + 3 * sirenMod97) % 97).padStart(2, "0");
    expect(computeVatKey(siren)).toBe(expectedKey);
    expect(computeVatKey(siren)).toHaveLength(2);
  });

  it("builds the vat number as FR + key + siren", () => {
    const siren = generateValidSiren("40000001");
    const key = computeVatKey(siren);
    expect(computeVatNumber(siren)).toBe(`FR${key}${siren}`);
  });

  it("rejects a siren that isn't exactly 9 digits", () => {
    expect(() => computeVatKey("123")).toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/checks/vat.test.ts`
Expected: FAIL — `Cannot find module './vat'`.

- [ ] **Step 3: Write `lib/checks/vat.ts`**

```ts
export function computeVatKey(siren: string): string {
  if (!/^\d{9}$/.test(siren)) {
    throw new Error("siren must be exactly 9 digits");
  }
  const key = (12 + 3 * (Number(siren) % 97)) % 97;
  return String(key).padStart(2, "0");
}

export function computeVatNumber(siren: string): string {
  return `FR${computeVatKey(siren)}${siren}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/checks/vat.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/checks/vat.ts lib/checks/vat.test.ts
git commit -m "$(cat <<'EOF'
Add FR VAT key computation

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LEEb7f2rr9ykD3iUMNRGLA
EOF
)"
```

---

## Task 5: IBAN mod-97 checksum

**Files:**
- Create: `lib/checks/iban.ts`
- Test: `lib/checks/iban.test.ts`

**Interfaces:**
- Produces: `buildIban(countryCode: string, bban: string): string`; `isValidIban(iban: string): boolean`. Reused by `lib/db/seed.ts` (Task 6) to produce French and foreign (DE) IBANs.

- [ ] **Step 1: Write the failing test `lib/checks/iban.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { buildIban, isValidIban } from "./iban";

describe("iban", () => {
  it("builds a French IBAN with a valid mod-97 checksum", () => {
    const iban = buildIban("FR", "30001000640000012345D6700");
    expect(iban.startsWith("FR")).toBe(true);
    expect(isValidIban(iban)).toBe(true);
  });

  it("builds a German IBAN with a valid mod-97 checksum", () => {
    const iban = buildIban("DE", "370400440532013000");
    expect(iban.startsWith("DE")).toBe(true);
    expect(isValidIban(iban)).toBe(true);
  });

  it("rejects an IBAN with a corrupted check digit", () => {
    const iban = buildIban("FR", "30001000640000012345D6700");
    const corrupted = iban.slice(0, 2) + "00" + iban.slice(4);
    expect(isValidIban(corrupted)).toBe(false);
  });

  it("rejects a malformed value", () => {
    expect(isValidIban("not-an-iban")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/checks/iban.test.ts`
Expected: FAIL — `Cannot find module './iban'`.

- [ ] **Step 3: Write `lib/checks/iban.ts`**

```ts
const LETTER_VALUES: Record<string, string> = {};
for (let i = 0; i < 26; i++) {
  LETTER_VALUES[String.fromCharCode(65 + i)] = String(10 + i);
}

function ibanNumericString(iban: string): string {
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  return rearranged
    .split("")
    .map((ch) => (/[A-Z]/.test(ch) ? LETTER_VALUES[ch] : ch))
    .join("");
}

function mod97(numeric: string): number {
  let remainder = 0;
  for (const digit of numeric) {
    remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder;
}

export function isValidIban(iban: string): boolean {
  const compact = iban.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(compact)) return false;
  return mod97(ibanNumericString(compact)) === 1;
}

export function buildIban(countryCode: string, bban: string): string {
  if (!/^[A-Z]{2}$/.test(countryCode)) {
    throw new Error("countryCode must be exactly 2 letters");
  }
  const provisional = `${countryCode}00${bban}`;
  const remainder = mod97(ibanNumericString(provisional));
  const checkDigits = String(98 - remainder).padStart(2, "0");
  return `${countryCode}${checkDigits}${bban}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/checks/iban.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/checks/iban.ts lib/checks/iban.test.ts
git commit -m "$(cat <<'EOF'
Add general IBAN mod-97 checksum validation and generation

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LEEb7f2rr9ykD3iUMNRGLA
EOF
)"
```

---

## Task 6: Seed — entities, suppliers, contracts, 12-month history

**Files:**
- Create: `lib/db/seed.ts`
- Create: `lib/db/seed.test.ts`

**Interfaces:**
- Consumes: `generateValidSiren` (Task 3), `computeVatNumber` (Task 4), `buildIban` (Task 5), `Client` type from `@libsql/client`.
- Produces: `seed(db: Client): Promise<void>` — at the end of this task it writes entities, suppliers, `iban_history`, one `risk_events` row, contracts, and 12 months of approved history (invoices + classifications + sessions + decisions). Task 7 extends this same function to also write the 13 pending invoices and adds the `expectedClassifications` export.

- [ ] **Step 1: Write `lib/db/seed.ts`**

```ts
import "server-only";
import { createHash } from "node:crypto";
import type { Client } from "@libsql/client";
import { generateValidSiren } from "../checks/siren";
import { computeVatNumber } from "../checks/vat";
import { buildIban } from "../checks/iban";

export type ClassificationLevel = "green" | "orange" | "red";

export interface ExpectedClassification {
  invoiceNumber: string;
  scenario: string;
  expectedLevel: ClassificationLevel;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const VARIANCE = [0.97, 1.02, 0.98, 1.04, 0.96, 1.01, 0.99, 1.03, 0.95, 1.02, 0.97, 1.0];

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(base: Date, offsetDays: number): Date {
  return new Date(base.getTime() + offsetDays * DAY_MS);
}

function monthsBefore(base: Date, months: number): Date {
  const result = new Date(base);
  result.setDate(15);
  result.setMonth(result.getMonth() - months);
  return result;
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function frenchIban(bbanIndex: number, branchCode = "00001"): string {
  const bankCode = "40100";
  const account = String(bbanIndex).padStart(11, "0");
  const ribKey = "00";
  return buildIban("FR", `${bankCode}${branchCode}${account}${ribKey}`);
}

function foreignIban(bbanIndex: number): string {
  const bankCode = "37040044";
  const account = String(bbanIndex).padStart(10, "0");
  return buildIban("DE", `${bankCode}${account}`);
}

interface EntitySeed {
  id: string;
  name: string;
  sector: "telecom" | "media" | "real_estate" | "services";
}

const entities: EntitySeed[] = [
  { id: "ent-telecom", name: "Arcadia Télécom", sector: "telecom" },
  { id: "ent-media", name: "Lumen Média Group", sector: "media" },
  { id: "ent-realestate", name: "Bastide Immobilier", sector: "real_estate" },
  { id: "ent-services", name: "Verdan Services", sector: "services" },
];

interface SupplierSeed {
  id: string;
  name: string;
  base8: string;
  bbanIndex: number;
}

const supplierSeeds: SupplierSeed[] = [
  { id: "sup-novalink", name: "NovaLink Télécom", base8: "40000001", bbanIndex: 1 },
  { id: "sup-cloudnimbus", name: "CloudNimbus SAS", base8: "40000002", bbanIndex: 2 },
  { id: "sup-fontaine", name: "Bureau Fontaine Conseil", base8: "40000003", bbanIndex: 3 },
  { id: "sup-pixelforge", name: "Pixel Forge Studio", base8: "40000004", bbanIndex: 4 },
  { id: "sup-translogistique", name: "Trans Logistique Ouest", base8: "40000005", bbanIndex: 5 },
  { id: "sup-klaxon", name: "Klaxon Marketing", base8: "40000006", bbanIndex: 6 },
  { id: "sup-aqua", name: "Aqua Facilities Maintenance", base8: "40000007", bbanIndex: 7 },
  { id: "sup-greenwave", name: "GreenWave Énergie", base8: "40000008", bbanIndex: 8 },
  { id: "sup-meridian", name: "Meridian Fleet Services", base8: "40000009", bbanIndex: 9 },
  { id: "sup-ondine", name: "Ondine Papeterie", base8: "40000010", bbanIndex: 10 },
  { id: "sup-atlas", name: "Atlas Industrial Equipment", base8: "40000011", bbanIndex: 11 },
  { id: "sup-solstice", name: "Solstice Maintenance Group", base8: "40000012", bbanIndex: 12 },
  { id: "sup-corvus", name: "Corvus Systems Intégration", base8: "40000013", bbanIndex: 13 },
];

interface Supplier {
  id: string;
  name: string;
  siren: string;
  vatNumber: string;
  registeredIban: string;
}

function buildSuppliers(): Supplier[] {
  return supplierSeeds.map((s) => {
    const siren = generateValidSiren(s.base8);
    return {
      id: s.id,
      name: s.name,
      siren,
      vatNumber: computeVatNumber(siren),
      registeredIban: frenchIban(s.bbanIndex),
    };
  });
}

interface ContractSeed {
  id: string;
  entityId: string;
  supplierId: string;
  category: string;
  expectedAmountCents: number;
  hasHistory: boolean;
}

const contracts: ContractSeed[] = [
  { id: "con-novalink-telecom", entityId: "ent-telecom", supplierId: "sup-novalink", category: "telecom_maintenance", expectedAmountCents: 180000, hasHistory: true },
  { id: "con-cloudnimbus-services", entityId: "ent-services", supplierId: "sup-cloudnimbus", category: "cloud_hosting", expectedAmountCents: 220000, hasHistory: true },
  { id: "con-fontaine-media", entityId: "ent-media", supplierId: "sup-fontaine", category: "consulting", expectedAmountCents: 150000, hasHistory: true },
  { id: "con-klaxon-media", entityId: "ent-media", supplierId: "sup-klaxon", category: "marketing", expectedAmountCents: 90000, hasHistory: true },
  { id: "con-klaxon-services", entityId: "ent-services", supplierId: "sup-klaxon", category: "marketing", expectedAmountCents: 110000, hasHistory: true },
  { id: "con-aqua-realestate", entityId: "ent-realestate", supplierId: "sup-aqua", category: "facilities", expectedAmountCents: 200000, hasHistory: true },
  { id: "con-greenwave-services", entityId: "ent-services", supplierId: "sup-greenwave", category: "utilities", expectedAmountCents: 260000, hasHistory: true },
  { id: "con-meridian-realestate", entityId: "ent-realestate", supplierId: "sup-meridian", category: "fleet", expectedAmountCents: 175000, hasHistory: true },
  { id: "con-ondine-media", entityId: "ent-media", supplierId: "sup-ondine", category: "office_supplies", expectedAmountCents: 40000, hasHistory: true },
  { id: "con-solstice-services", entityId: "ent-services", supplierId: "sup-solstice", category: "maintenance", expectedAmountCents: 200000, hasHistory: true },
  { id: "con-solstice-realestate", entityId: "ent-realestate", supplierId: "sup-solstice", category: "maintenance", expectedAmountCents: 400000, hasHistory: false },
  { id: "con-corvus-telecom", entityId: "ent-telecom", supplierId: "sup-corvus", category: "it_integration", expectedAmountCents: 300000, hasHistory: true },
];

// Trans Logistique Ouest is a recurring, known supplier that has deliberately
// never been put on a formal contract.
const TRANS_LOGISTIQUE = {
  entityId: "ent-services",
  supplierId: "sup-translogistique",
  category: "logistics",
  baseAmountCents: 130000,
};

interface WriteStatement {
  sql: string;
  args: unknown[];
}

interface HistoryInvoice {
  id: string;
  entityId: string;
  supplierId: string;
  contractId: string | null;
  invoiceNumber: string;
  category: string;
  amountExclVatCents: number;
  amountInclVatCents: number;
  dueDate: string;
  printedIban: string;
  printedSiren: string;
  monthsAgo: number;
}

function buildHistoryInvoices(
  idPrefix: string,
  entityId: string,
  supplierId: string,
  contractId: string | null,
  category: string,
  baseAmountCents: number,
  registeredIban: string,
  registeredSiren: string,
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
      dueDate: isoDate(dueDate),
      printedIban: registeredIban,
      printedSiren: registeredSiren,
      monthsAgo,
    });
  }
  return rows;
}

export async function seed(db: Client): Promise<void> {
  const today = new Date();
  const suppliers = buildSuppliers();
  const supplierById = new Map(suppliers.map((s) => [s.id, s]));

  const statements: WriteStatement[] = [];

  for (const entity of entities) {
    statements.push({
      sql: "INSERT INTO entities (id, name, sector) VALUES (?, ?, ?)",
      args: [entity.id, entity.name, entity.sector],
    });
  }

  for (const supplier of suppliers) {
    statements.push({
      sql: "INSERT INTO suppliers (id, name, siren, vat_number) VALUES (?, ?, ?, ?)",
      args: [supplier.id, supplier.name, supplier.siren, supplier.vatNumber],
    });
    statements.push({
      sql: "INSERT INTO iban_history (id, supplier_id, iban, effective_from) VALUES (?, ?, ?, ?)",
      args: [`ibh-${supplier.id}-orig`, supplier.id, supplier.registeredIban, isoDate(monthsBefore(today, 30))],
    });
  }

  // GreenWave Énergie's registered IBAN changed 5 days ago.
  const greenwaveNewIban = frenchIban(8, "00099");
  statements.push({
    sql: "INSERT INTO iban_history (id, supplier_id, iban, effective_from) VALUES (?, ?, ?, ?)",
    args: ["ibh-sup-greenwave-new", "sup-greenwave", greenwaveNewIban, isoDate(addDays(today, -5))],
  });

  // Corvus Systems Intégration has a risk event flagged 2 months ago.
  statements.push({
    sql: "INSERT INTO risk_events (id, supplier_id, event_date, description) VALUES (?, ?, ?, ?)",
    args: [
      "risk-sup-corvus-1",
      "sup-corvus",
      isoDate(monthsBefore(today, 2)),
      "Alerte conformité interne suite à un signalement fournisseur.",
    ],
  });

  for (const contract of contracts) {
    statements.push({
      sql: "INSERT INTO contracts (id, entity_id, supplier_id, category, expected_amount_cents, start_date, end_date) VALUES (?, ?, ?, ?, ?, ?, ?)",
      args: [
        contract.id,
        contract.entityId,
        contract.supplierId,
        contract.category,
        contract.expectedAmountCents,
        isoDate(monthsBefore(today, 30)),
        null,
      ],
    });
  }

  const historyInvoices: HistoryInvoice[] = [];
  for (const contract of contracts) {
    if (!contract.hasHistory) continue;
    const supplier = supplierById.get(contract.supplierId);
    if (!supplier) throw new Error(`unknown supplier ${contract.supplierId}`);
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
        today
      )
    );
  }
  {
    const supplier = supplierById.get(TRANS_LOGISTIQUE.supplierId);
    if (!supplier) throw new Error("unknown supplier sup-translogistique");
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
        today
      )
    );
  }

  for (const invoice of historyInvoices) {
    statements.push({
      sql: `INSERT INTO invoices
        (id, entity_id, supplier_id, contract_id, invoice_number, category, amount_excl_vat_cents, amount_incl_vat_cents, due_date, printed_iban, printed_siren, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved')`,
      args: [
        invoice.id,
        invoice.entityId,
        invoice.supplierId,
        invoice.contractId,
        invoice.invoiceNumber,
        invoice.category,
        invoice.amountExclVatCents,
        invoice.amountInclVatCents,
        invoice.dueDate,
        invoice.printedIban,
        invoice.printedSiren,
      ],
    });
    statements.push({
      sql: "INSERT INTO classifications (id, invoice_id, level, reasons) VALUES (?, ?, 'green', ?)",
      args: [
        `cls-${invoice.id}`,
        invoice.id,
        JSON.stringify(["Fournisseur récurrent, historique conforme au contrat."]),
      ],
    });
  }

  const invoicesByMonth = new Map<number, HistoryInvoice[]>();
  for (const invoice of historyInvoices) {
    const list = invoicesByMonth.get(invoice.monthsAgo) ?? [];
    list.push(invoice);
    invoicesByMonth.set(invoice.monthsAgo, list);
  }
  for (const [monthsAgo, invoicesThisMonth] of invoicesByMonth) {
    const sessionId = `ses-hist-m${monthsAgo}`;
    const signedAt = isoDate(addDays(monthsBefore(today, monthsAgo), 3));
    const contentHash = sha256Hex(
      JSON.stringify({
        sessionId,
        decisions: invoicesThisMonth.map((i) => ({ invoiceId: i.id, outcome: "approved" })),
        signedAt,
      })
    );
    statements.push({
      sql: "INSERT INTO sessions (id, kind, content_hash, signed_at) VALUES (?, 'batch', ?, ?)",
      args: [sessionId, contentHash, signedAt],
    });
    for (const invoice of invoicesThisMonth) {
      statements.push({
        sql: "INSERT INTO decisions (id, session_id, invoice_id, outcome) VALUES (?, ?, ?, 'approved')",
        args: [`dec-${invoice.id}`, sessionId, invoice.id],
      });
    }
  }

  await db.batch(
    statements.map((s) => ({ sql: s.sql, args: s.args })),
    "write"
  );
}
```

- [ ] **Step 2: Write the failing test `lib/db/seed.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { createClient } from "@libsql/client";
import { migrate } from "./migrate";
import { seed } from "./seed";

describe("seed - history", () => {
  it("creates 13 suppliers, 12 contracts, and 12 months of green history", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db);
    await seed(db);

    const suppliers = await db.execute("SELECT COUNT(*) as count FROM suppliers");
    expect(Number(suppliers.rows[0].count)).toBe(13);

    const contracts = await db.execute("SELECT COUNT(*) as count FROM contracts");
    expect(Number(contracts.rows[0].count)).toBe(12);

    const approvedNovalink = await db.execute({
      sql: "SELECT COUNT(*) as count FROM invoices WHERE supplier_id = ? AND status = 'approved'",
      args: ["sup-novalink"],
    });
    expect(Number(approvedNovalink.rows[0].count)).toBe(12);

    const sessions = await db.execute("SELECT COUNT(*) as count FROM sessions");
    expect(Number(sessions.rows[0].count)).toBe(12);

    // 11 contracts with hasHistory=true, x12 months, + 12 months for Trans Logistique (no contract).
    const greenClassifications = await db.execute(
      "SELECT COUNT(*) as count FROM classifications WHERE level = 'green'"
    );
    expect(Number(greenClassifications.rows[0].count)).toBe(144);

    const greenwaveIbanRows = await db.execute({
      sql: "SELECT COUNT(*) as count FROM iban_history WHERE supplier_id = ?",
      args: ["sup-greenwave"],
    });
    expect(Number(greenwaveIbanRows.rows[0].count)).toBe(2);

    const corvusRiskEvents = await db.execute({
      sql: "SELECT COUNT(*) as count FROM risk_events WHERE supplier_id = ?",
      args: ["sup-corvus"],
    });
    expect(Number(corvusRiskEvents.rows[0].count)).toBe(1);

    db.close();
  });
});
```

- [ ] **Step 3: Run the test**

Run: `npx vitest run lib/db/seed.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/db/seed.ts lib/db/seed.test.ts
git commit -m "$(cat <<'EOF'
Add seed data for entities, suppliers, contracts, and 12-month history

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LEEb7f2rr9ykD3iUMNRGLA
EOF
)"
```

---

## Task 7: Seed — 13 pending scenario invoices and `expectedClassifications`

**Files:**
- Modify: `lib/db/seed.ts`
- Modify: `lib/db/seed.test.ts`

**Interfaces:**
- Consumes: everything from Task 6 (`entities`, `supplierSeeds`, `buildSuppliers`, `Supplier`, `frenchIban`, `foreignIban`, `isoDate`, `addDays`, `generateValidSiren`, `WriteStatement`, the `seed()` function body).
- Produces: `expectedClassifications: ExpectedClassification[]` (exported from `lib/db/seed.ts`) — consumed by `app/page.tsx` in Task 10 and by the future rules-engine tests.

- [ ] **Step 1: Add `buildPendingInvoiceStatements` and call it from `seed()`**

Add this function above `export async function seed` in `lib/db/seed.ts`:

```ts
function buildPendingInvoiceStatements(
  today: Date,
  supplierById: Map<string, Supplier>
): WriteStatement[] {
  const statements: WriteStatement[] = [];
  const mismatchedSiren = generateValidSiren("40000099");

  interface PendingSeed {
    id: string;
    entityId: string;
    supplierId: string;
    contractId: string | null;
    invoiceNumber: string;
    category: string;
    amountExclVatCents: number;
    dueInDays: number;
    printedIban?: string;
    printedSiren?: string;
  }

  const pending: PendingSeed[] = [
    {
      id: "inv-pending-novalink",
      entityId: "ent-telecom",
      supplierId: "sup-novalink",
      contractId: "con-novalink-telecom",
      invoiceNumber: "PEND-NOVALINK-01",
      category: "telecom_maintenance",
      amountExclVatCents: 180000,
      dueInDays: 2,
    },
    {
      id: "inv-pending-cloudnimbus",
      entityId: "ent-services",
      supplierId: "sup-cloudnimbus",
      contractId: "con-cloudnimbus-services",
      invoiceNumber: "PEND-CLOUDNIMBUS-01",
      category: "cloud_hosting",
      amountExclVatCents: 220000,
      dueInDays: 3,
    },
    {
      id: "inv-pending-fontaine",
      entityId: "ent-media",
      supplierId: "sup-fontaine",
      contractId: "con-fontaine-media",
      invoiceNumber: "PEND-FONTAINE-01",
      category: "consulting",
      amountExclVatCents: 180000,
      dueInDays: 4,
    },
    {
      id: "inv-pending-pixelforge",
      entityId: "ent-realestate",
      supplierId: "sup-pixelforge",
      contractId: null,
      invoiceNumber: "PEND-PIXELFORGE-01",
      category: "design",
      amountExclVatCents: 300000,
      dueInDays: 5,
    },
    {
      id: "inv-pending-translogistique",
      entityId: "ent-services",
      supplierId: "sup-translogistique",
      contractId: null,
      invoiceNumber: "PEND-TRANSLOGISTIQUE-01",
      category: "logistics",
      amountExclVatCents: 132000,
      dueInDays: 6,
    },
    {
      id: "inv-pending-klaxon",
      entityId: "ent-telecom",
      supplierId: "sup-klaxon",
      contractId: null,
      invoiceNumber: "PEND-KLAXON-01",
      category: "marketing",
      amountExclVatCents: 95000,
      dueInDays: 7,
    },
    {
      id: "inv-pending-aqua",
      entityId: "ent-realestate",
      supplierId: "sup-aqua",
      contractId: "con-aqua-realestate",
      invoiceNumber: "HIST-AQUA-REALESTATE-M6",
      category: "facilities",
      amountExclVatCents: 200000,
      dueInDays: 8,
    },
    {
      id: "inv-pending-greenwave",
      entityId: "ent-services",
      supplierId: "sup-greenwave",
      contractId: "con-greenwave-services",
      invoiceNumber: "PEND-GREENWAVE-01",
      category: "utilities",
      amountExclVatCents: 260000,
      dueInDays: 9,
      printedIban: frenchIban(8),
    },
    {
      id: "inv-pending-meridian",
      entityId: "ent-realestate",
      supplierId: "sup-meridian",
      contractId: "con-meridian-realestate",
      invoiceNumber: "PEND-MERIDIAN-01",
      category: "fleet",
      amountExclVatCents: 175000,
      dueInDays: 10,
      printedIban: foreignIban(9),
    },
    {
      id: "inv-pending-ondine",
      entityId: "ent-media",
      supplierId: "sup-ondine",
      contractId: "con-ondine-media",
      invoiceNumber: "PEND-ONDINE-01",
      category: "office_supplies",
      amountExclVatCents: 40000,
      dueInDays: 12,
      printedSiren: mismatchedSiren,
    },
    {
      id: "inv-pending-atlas",
      entityId: "ent-realestate",
      supplierId: "sup-atlas",
      contractId: null,
      invoiceNumber: "PEND-ATLAS-01",
      category: "equipment",
      amountExclVatCents: 8000000,
      dueInDays: 14,
    },
    {
      id: "inv-pending-solstice",
      entityId: "ent-realestate",
      supplierId: "sup-solstice",
      contractId: "con-solstice-realestate",
      invoiceNumber: "PEND-SOLSTICE-01",
      category: "maintenance",
      amountExclVatCents: 400000,
      dueInDays: 17,
    },
    {
      id: "inv-pending-corvus",
      entityId: "ent-telecom",
      supplierId: "sup-corvus",
      contractId: "con-corvus-telecom",
      invoiceNumber: "PEND-CORVUS-01",
      category: "it_integration",
      amountExclVatCents: 300000,
      dueInDays: 20,
    },
  ];

  for (const invoice of pending) {
    const supplier = supplierById.get(invoice.supplierId);
    if (!supplier) throw new Error(`unknown supplier ${invoice.supplierId}`);
    statements.push({
      sql: `INSERT INTO invoices
        (id, entity_id, supplier_id, contract_id, invoice_number, category, amount_excl_vat_cents, amount_incl_vat_cents, due_date, printed_iban, printed_siren, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      args: [
        invoice.id,
        invoice.entityId,
        invoice.supplierId,
        invoice.contractId,
        invoice.invoiceNumber,
        invoice.category,
        invoice.amountExclVatCents,
        Math.round(invoice.amountExclVatCents * 1.2),
        isoDate(addDays(today, invoice.dueInDays)),
        invoice.printedIban ?? supplier.registeredIban,
        invoice.printedSiren ?? supplier.siren,
      ],
    });
  }

  return statements;
}

export const expectedClassifications: ExpectedClassification[] = [
  { invoiceNumber: "PEND-NOVALINK-01", scenario: "Maintenance télécom récurrente conforme au contrat", expectedLevel: "green" },
  { invoiceNumber: "PEND-CLOUDNIMBUS-01", scenario: "Hébergement cloud récurrent conforme au contrat", expectedLevel: "green" },
  { invoiceNumber: "PEND-FONTAINE-01", scenario: "Fournisseur connu, +20% vs historique", expectedLevel: "orange" },
  { invoiceNumber: "PEND-PIXELFORGE-01", scenario: "Nouveau fournisseur, 3 000 € HT", expectedLevel: "orange" },
  { invoiceNumber: "PEND-TRANSLOGISTIQUE-01", scenario: "Fournisseur connu, aucun contrat associé", expectedLevel: "orange" },
  { invoiceNumber: "PEND-KLAXON-01", scenario: "Catégorie inhabituelle pour la filiale télécom", expectedLevel: "orange" },
  { invoiceNumber: "HIST-AQUA-REALESTATE-M6", scenario: "Même fournisseur et même numéro de facture qu'une facture déjà approuvée", expectedLevel: "red" },
  { invoiceNumber: "PEND-GREENWAVE-01", scenario: "IBAN enregistré du fournisseur modifié il y a 5 jours", expectedLevel: "red" },
  { invoiceNumber: "PEND-MERIDIAN-01", scenario: "Fournisseur FR avec un IBAN imprimé étranger", expectedLevel: "red" },
  { invoiceNumber: "PEND-ONDINE-01", scenario: "SIREN imprimé différent du registre", expectedLevel: "red" },
  { invoiceNumber: "PEND-ATLAS-01", scenario: "Achat d'équipement de 80 000 € HT", expectedLevel: "red" },
  { invoiceNumber: "PEND-SOLSTICE-01", scenario: "Même fournisseur et catégorie, filiale facturée 2x plus qu'une autre", expectedLevel: "red" },
  { invoiceNumber: "PEND-CORVUS-01", scenario: "Fournisseur avec un événement de risque il y a 2 mois", expectedLevel: "red" },
];
```

Then, inside `export async function seed`, right before the `await db.batch(...)` call, add:

```ts
  statements.push(...buildPendingInvoiceStatements(today, supplierById));

```

- [ ] **Step 2: Extend `lib/db/seed.test.ts`**

Add `expectedClassifications` to the existing import from `"./seed"`, then append these test blocks inside the existing `describe("seed - history", ...)` or a new `describe`:

```ts
describe("seed - pending scenarios", () => {
  it("creates exactly 13 pending invoices matching expectedClassifications", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db);
    await seed(db);

    const pending = await db.execute(
      "SELECT invoice_number as invoiceNumber FROM invoices WHERE status = 'pending' ORDER BY due_date ASC"
    );
    expect(pending.rows.length).toBe(13);

    const pendingNumbers = new Set(pending.rows.map((row) => String(row.invoiceNumber)));
    expect(expectedClassifications.length).toBe(13);
    for (const expected of expectedClassifications) {
      expect(pendingNumbers.has(expected.invoiceNumber)).toBe(true);
    }

    db.close();
  });

  it("prints a foreign IBAN on the Meridian invoice despite its FR registration", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db);
    await seed(db);

    const row = await db.execute({
      sql: "SELECT printed_iban as printedIban FROM invoices WHERE invoice_number = ?",
      args: ["PEND-MERIDIAN-01"],
    });
    expect(String(row.rows[0].printedIban).startsWith("DE")).toBe(true);

    db.close();
  });

  it("reuses an already-approved invoice number for the Aqua duplicate scenario", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db);
    await seed(db);

    const matches = await db.execute({
      sql: "SELECT status FROM invoices WHERE invoice_number = ? ORDER BY status",
      args: ["HIST-AQUA-REALESTATE-M6"],
    });
    expect(matches.rows.map((r) => String(r.status))).toEqual(["approved", "pending"]);

    db.close();
  });
});
```

- [ ] **Step 3: Run the tests**

Run: `npx vitest run lib/db/seed.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/db/seed.ts lib/db/seed.test.ts
git commit -m "$(cat <<'EOF'
Add 13 pending demo invoices covering every classification scenario

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LEEb7f2rr9ykD3iUMNRGLA
EOF
)"
```

---

## Task 8: Seed script and npm wiring

**Files:**
- Create: `scripts/seed.ts`

**Interfaces:**
- Consumes: `db` from `lib/db/client.ts` (Task 2), `seed` from `lib/db/seed.ts` (Tasks 6-7).
- Produces: a working `npm run db:seed` and `npm run db:reset` (the latter already wired in Task 1's `package.json`).

- [ ] **Step 1: Write `scripts/seed.ts`**

```ts
import { db } from "../lib/db/client";
import { seed } from "../lib/db/seed";

async function main() {
  await seed(db);
  console.log("Seed complete.");
  db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run the full reset against the local file**

Run: `npm run db:reset`
Expected: prints "Migration complete." then "Seed complete.", exits 0.

- [ ] **Step 3: Run it again to confirm idempotency (drop + recreate)**

Run: `npm run db:reset`
Expected: same output, exits 0 — confirms `db:migrate` cleanly drops and recreates before `db:seed` re-inserts.

- [ ] **Step 4: Commit**

```bash
git add scripts/seed.ts
git commit -m "$(cat <<'EOF'
Add seed script and wire up db:seed / db:reset

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LEEb7f2rr9ykD3iUMNRGLA
EOF
)"
```

---

## Task 9: `resetDemo` server action

**Files:**
- Create: `app/actions/demo.ts`

**Interfaces:**
- Consumes: `db` from `lib/db/client.ts` (Task 2), `migrate` from `lib/db/migrate.ts` (Task 2), `seed` from `lib/db/seed.ts` (Tasks 6-7).
- Produces: `resetDemo(): Promise<void>` — a server action, consumed by `app/page.tsx` in Task 10.

- [ ] **Step 1: Write `app/actions/demo.ts`**

```ts
"use server";

import "server-only";
import { db } from "@/lib/db/client";
import { migrate } from "@/lib/db/migrate";
import { seed } from "@/lib/db/seed";

export async function resetDemo(): Promise<void> {
  await migrate(db);
  await seed(db);
}
```

Next.js re-renders the current route's server components automatically after a form action completes, so no explicit `revalidatePath` call is needed here — the verification page will show fresh data right after the button click.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (Functional verification of the button happens end-to-end in Task 11.)

- [ ] **Step 3: Commit**

```bash
git add app/actions/demo.ts
git commit -m "$(cat <<'EOF'
Add resetDemo server action

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LEEb7f2rr9ykD3iUMNRGLA
EOF
)"
```

---

## Task 10: Verification page

**Files:**
- Create: `lib/db/queries.ts`
- Create: `lib/db/queries.test.ts`
- Modify: `app/page.tsx` (replace the Task 1 placeholder)

**Interfaces:**
- Consumes: `db` (Task 2), `expectedClassifications` (Task 7), `resetDemo` (Task 9).
- Produces: `getPendingInvoices(db: Client): Promise<PendingInvoiceRow[]>`, sorted by `due_date` ascending.

- [ ] **Step 1: Write the failing test `lib/db/queries.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { createClient } from "@libsql/client";
import { migrate } from "./migrate";
import { seed } from "./seed";
import { getPendingInvoices } from "./queries";

describe("getPendingInvoices", () => {
  it("returns all 13 pending invoices sorted by due date ascending", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db);
    await seed(db);

    const rows = await getPendingInvoices(db);
    expect(rows.length).toBe(13);

    const dueDates = rows.map((r) => r.dueDate);
    const sorted = [...dueDates].sort();
    expect(dueDates).toEqual(sorted);

    expect(rows[0].invoiceNumber).toBe("PEND-NOVALINK-01");
    expect(rows[0].supplierName).toBe("NovaLink Télécom");
    expect(rows[0].entityName).toBe("Arcadia Télécom");

    db.close();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/db/queries.test.ts`
Expected: FAIL — `Cannot find module './queries'`.

- [ ] **Step 3: Write `lib/db/queries.ts`**

```ts
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
      invoices.category AS category
    FROM invoices
    JOIN suppliers ON suppliers.id = invoices.supplier_id
    JOIN entities ON entities.id = invoices.entity_id
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
  }));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/db/queries.test.ts`
Expected: PASS.

- [ ] **Step 5: Replace `app/page.tsx`**

```tsx
import { db } from "@/lib/db/client";
import { getPendingInvoices } from "@/lib/db/queries";
import { expectedClassifications } from "@/lib/db/seed";
import { resetDemo } from "@/app/actions/demo";

function formatEuros(cents: number): string {
  return (cents / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR");
}

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
            <th className="border border-gray-300 p-2 text-left">Scénario</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((invoice) => (
            <tr key={invoice.id}>
              <td className="border border-gray-300 p-2">{invoice.supplierName}</td>
              <td className="border border-gray-300 p-2">{invoice.entityName}</td>
              <td className="border border-gray-300 p-2">{formatEuros(invoice.amountInclVatCents)}</td>
              <td className="border border-gray-300 p-2">{formatDate(invoice.dueDate)}</td>
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

- [ ] **Step 6: Commit**

```bash
git add lib/db/queries.ts lib/db/queries.test.ts app/page.tsx
git commit -m "$(cat <<'EOF'
Add pending invoices query and replace placeholder home page

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LEEb7f2rr9ykD3iUMNRGLA
EOF
)"
```

---

## Task 11: Final integration verification

**Files:**
- None created or modified — this task only runs and checks.

**Interfaces:**
- Consumes: everything from Tasks 1-10.

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all suites pass (siren, vat, iban, migrate, seed x2, queries).

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: no errors (warnings acceptable).

- [ ] **Step 4: Reset the demo against the local file**

Run: `npm run db:reset`
Expected: exits 0.

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: exits 0, no type errors.

- [ ] **Step 6: Confirm `db:reset` also works without a local file present (Turso-less first run)**

Run: `rm -rf data && npm run db:reset`
Expected: exits 0, recreates `data/app.db`.

- [ ] **Step 7: Start the built app and verify the home page**

Run (background): `npm run start &`
Then: `sleep 2 && curl -s http://localhost:3000/ > /tmp/home.html && grep -c '<tr>' /tmp/home.html`
Expected: `14` (13 data rows + 1 header row), and `grep "NovaLink Télécom" /tmp/home.html` / `grep "Réinitialiser la démo" /tmp/home.html` both match.
Then: stop the server (`kill %1` or equivalent).

- [ ] **Step 8: Confirm `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN` are read when present**

Run: `TURSO_DATABASE_URL="file:data/turso-check.db" npm run db:migrate`
Expected: exits 0 and creates `data/turso-check.db` instead of `data/app.db`, proving the env var is honored. Then remove it: `rm -f data/turso-check.db`.

- [ ] **Step 9: Final commit (if any verification step required fixes)**

```bash
git add -A
git commit -m "$(cat <<'EOF'
Fix issues found during final integration verification

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LEEb7f2rr9ykD3iUMNRGLA
EOF
)"
```

(Skip this step if Steps 1-8 all passed without changes.)
