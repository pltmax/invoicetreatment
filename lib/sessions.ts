import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { Client, InValue } from "@libsql/client";

export interface DecisionInput {
  invoiceId: string;
  entityName: string;
  amountInclVatCents: number;
  outcome: "approved" | "rejected";
  comment: string | null;
}

export interface CreatedSession {
  sessionId: string;
  contentHash: string;
  signatureRef: string;
  signedAt: string;
}

interface WriteStatement {
  sql: string;
  args: InValue[];
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function slug(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function notificationEmail(entityName: string): string {
  return `finance@${slug(entityName)}.interne`;
}

export async function createSession(
  db: Client,
  kind: "batch" | "single",
  decisions: DecisionInput[]
): Promise<CreatedSession> {
  if (decisions.length === 0) {
    throw new Error("createSession requires at least one decision");
  }

  const sessionId = `ses-${randomUUID()}`;
  const signedAt = new Date().toISOString();
  const signatureRef = `MOCK-${randomUUID()}`;

  const contentHash = sha256Hex(
    JSON.stringify({
      sessionId,
      kind,
      decisions: [...decisions]
        .sort((a, b) => a.invoiceId.localeCompare(b.invoiceId))
        .map((d) => ({
          invoiceId: d.invoiceId,
          amountInclVatCents: d.amountInclVatCents,
          outcome: d.outcome,
        })),
      signedAt,
    })
  );

  const statements: WriteStatement[] = [
    {
      sql: "INSERT INTO sessions (id, kind, content_hash, signature_ref, signed_at) VALUES (?, ?, ?, ?, ?)",
      args: [sessionId, kind, contentHash, signatureRef, signedAt],
    },
  ];

  for (const decision of decisions) {
    statements.push({
      sql: "INSERT INTO decisions (id, session_id, invoice_id, outcome, comment) VALUES (?, ?, ?, ?, ?)",
      args: [`dec-${randomUUID()}`, sessionId, decision.invoiceId, decision.outcome, decision.comment],
    });
    statements.push({
      sql: "UPDATE invoices SET status = ? WHERE id = ?",
      args: [decision.outcome, decision.invoiceId],
    });
  }

  await db.batch(statements, "write");

  for (const decision of decisions) {
    console.log(`Notification envoyée à ${notificationEmail(decision.entityName)}`);
  }

  return { sessionId, contentHash, signatureRef, signedAt };
}
