// lib/rules/classify-all.ts
import "server-only";
import type { Client, InValue } from "@libsql/client";
import { loadContext, loadThresholds } from "./context";
import { classify } from "./engine";
import { RULES_VERSION } from "./thresholds";

interface WriteStatement {
  sql: string;
  args: InValue[];
}

export async function classifyAll(db: Client, today: Date = new Date()): Promise<void> {
  const pending = await db.execute("SELECT id FROM invoices WHERE status = 'pending'");
  const invoiceIds = pending.rows.map((row) => String(row.id));

  if (invoiceIds.length === 0) return;

  // Fetched once and reused for every invoice: thresholds don't vary per
  // invoice, and each fetch is a real network round trip against a remote
  // database — refetching per invoice was the dominant cost of a reset.
  const thresholds = await loadThresholds(db);

  // Independent per-invoice reads, so run them concurrently rather than
  // one network round trip at a time.
  const classifications = await Promise.all(
    invoiceIds.map(async (invoiceId) => {
      const ctx = await loadContext(db, invoiceId, today, thresholds);
      return { invoiceId, classification: classify(ctx, today) };
    })
  );

  const statements: WriteStatement[] = [];
  for (const { invoiceId, classification } of classifications) {
    statements.push({ sql: "DELETE FROM classifications WHERE invoice_id = ?", args: [invoiceId] });
    statements.push({
      sql: "INSERT INTO classifications (id, invoice_id, level, reasons, rules_version) VALUES (?, ?, ?, ?, ?)",
      args: [
        `cls-${invoiceId}`,
        invoiceId,
        classification.level,
        JSON.stringify(classification.reasons),
        RULES_VERSION,
      ],
    });
  }

  await db.batch(statements, "write");
}
