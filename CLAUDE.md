# Project

Centralized invoice approval for a holding CEO. Subsidiaries' invoices arrive by email, get classified green / orange / red, and are approved in sessions that produce a signed, timestamped bordereau.

## Stack
- Next.js (App Router, TypeScript, server actions), Tailwind
- SQLite via better-sqlite3, single file at `data/app.db`
- Vitest for tests
- Invoice PDFs: private Vercel Blob store (`@vercel/blob`), never a public URL — see `/api/invoices/[id]/pdf`

## Commands
- `npm run dev`: start the app
- `npm run seed`: reset the DB and load demo data
- `npm test`: run unit tests
- `npm run lint && npx tsc --noEmit`: run before calling a task done

## Architecture
- `lib/db/`: schema, queries, seed. All SQL lives here, nowhere else.
- `lib/rules/`: classification engine. Pure functions, no DB or I/O. Input is an invoiceplus its context (supplier, history, contracts, other entities); output is `{ level, reasons[] }`.
- `lib/checks/`: SIREN (Luhn), FR VAT key, IBAN validation
- `app/`: pages and server actions. Mobile first: the CEO decides from his phone.

## Domain rules (defaults source of truth: lib/rules/thresholds.ts; live values: the thresholds DB row, editable at /rules)
- Red if any: deviation > Y% vs history, contract or another subsidiary on a similar service; suspected duplicate (same number, or same amount within N days); IBAN changed or different from the registered one; foreign IBAN for an FR supplier; SIREN/VAT inconsistent with the company name; new supplier with amount > 50k€; active supplier risk flag
- Orange if any: deviation from contract or history > 5%; new supplier with amount ≤ 50k€; no contract attached; unusual category for the subsidiary
- Green only if: known supplier, no risk history, matches an active contract, recurring spend
- Every classification must carry human-readable reasons. Never a level without a reason.
- Red always wins over orange, and orange over green.
- Thresholds live in the thresholds DB table (defaults defined once in lib/rules/thresholds.ts), editable via the /rules page — never hardcoded elsewhere.

## Decision flow
- Pending invoices sorted by payment due date
- Green + orange: decided in one batch session, one bordereau, one signature
- Red: one signature per invoice
- A bordereau is immutable once signed: store timestamp and SHA-256 of its content
- After signing, notify the owner of each invoice (mocked: log only)

## Scope for the demo
- Mocked: email ingestion (invoices@holding.com) — except the PDF-extraction step itself, which makes a real Claude Sonnet 5 call (see /extraction); only the email transport and webhook are mocked
- Also mocked: e-signature provider, notifications
- Out of scope: accounting tool integrations, non-FR suppliers
- All data is fictional. Never use real company names, SIRENs or IBANs.

## Conventions
- UI copy in French, code and comments in English
- Amounts stored as integer cents, excl. VAT and incl. VAT in separate columns
- Dates stored as ISO strings
- Keep modules small with one clear responsibility
- Every new rule gets a unit test covering the trigger and the non-trigger case