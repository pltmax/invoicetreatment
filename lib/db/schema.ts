import "server-only";

export const SCHEMA_SQL = `
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
  issue_date TEXT NOT NULL,
  due_date TEXT NOT NULL,
  printed_iban TEXT NOT NULL,
  printed_siren TEXT NOT NULL,
  printed_vat_number TEXT NOT NULL,
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
  rules_version TEXT NOT NULL,
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
`;
