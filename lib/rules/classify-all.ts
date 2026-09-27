// lib/rules/classify-all.ts
import "server-only";
import type { Client, InValue } from "@libsql/client";
import { loadContext } from "./context";
import { classify } from "./engine";
import { RULES_VERSION } from "./thresholds";

interface WriteStatement {
  sql: string;
  args: InValue[];
}

export async function classifyAll(db: Client, today: Date = new Date()): Promise<void> {
  const pending = await db.execute("SELECT id FROM invoices WHERE status = 'pending'");
  const invoiceIds = pending.rows.map((row) => String(row.id));

  const statements: WriteStatement[] = [];
  for (const invoiceId of invoiceIds) {
    const ctx = await loadContext(db, invoiceId, today);
    const classification = classify(ctx, today);

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

  if (statements.length > 0) {
    await db.batch(statements, "write");
  }
}
