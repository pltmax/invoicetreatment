import { describe, it, expect } from "vitest";
import { createClient } from "@libsql/client";
import { createHash } from "node:crypto";
import { migrate } from "./db/migrate";
import { seed } from "./db/seed";
import { createSession, slug, notificationEmail } from "./sessions";

describe("createSession", () => {
  it("creates a batch session with a verifiable hash and flips invoice status to approved", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db);
    await seed(db);

    const pending = await db.execute(
      "SELECT id, amount_incl_vat_cents as amountInclVatCents FROM invoices WHERE status = 'pending' LIMIT 2"
    );
    const decisions = pending.rows.map((row) => ({
      invoiceId: String(row.id),
      entityName: "Filiale Test",
      amountInclVatCents: Number(row.amountInclVatCents),
      outcome: "approved" as const,
      comment: null,
    }));

    const result = await createSession(db, "batch", decisions);

    const expectedHash = createHash("sha256")
      .update(
        JSON.stringify({
          sessionId: result.sessionId,
          kind: "batch",
          decisions: [...decisions]
            .sort((a, b) => a.invoiceId.localeCompare(b.invoiceId))
            .map((d) => ({
              invoiceId: d.invoiceId,
              amountInclVatCents: d.amountInclVatCents,
              outcome: d.outcome,
            })),
          signedAt: result.signedAt,
        })
      )
      .digest("hex");
    expect(result.contentHash).toBe(expectedHash);
    expect(result.signatureRef.startsWith("MOCK-")).toBe(true);

    const sessionRows = await db.execute({
      sql: "SELECT kind, content_hash as contentHash FROM sessions WHERE id = ?",
      args: [result.sessionId],
    });
    expect(sessionRows.rows[0].kind).toBe("batch");
    expect(sessionRows.rows[0].contentHash).toBe(result.contentHash);

    const decisionRows = await db.execute({
      sql: "SELECT COUNT(*) as count FROM decisions WHERE session_id = ?",
      args: [result.sessionId],
    });
    expect(Number(decisionRows.rows[0].count)).toBe(2);

    for (const decision of decisions) {
      const invoiceRow = await db.execute({
        sql: "SELECT status FROM invoices WHERE id = ?",
        args: [decision.invoiceId],
      });
      expect(invoiceRow.rows[0].status).toBe("approved");
    }

    db.close();
  });

  it("creates a single-kind session for one rejected decision, storing the comment", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db);
    await seed(db);

    const pending = await db.execute(
      "SELECT id, amount_incl_vat_cents as amountInclVatCents FROM invoices WHERE status = 'pending' LIMIT 1"
    );
    const invoiceId = String(pending.rows[0].id);

    const result = await createSession(db, "single", [
      {
        invoiceId,
        entityName: "Filiale Test",
        amountInclVatCents: Number(pending.rows[0].amountInclVatCents),
        outcome: "rejected",
        comment: "Montant incohérent avec le contrat.",
      },
    ]);

    const decisionRow = await db.execute({
      sql: "SELECT outcome, comment FROM decisions WHERE session_id = ?",
      args: [result.sessionId],
    });
    expect(decisionRow.rows[0].outcome).toBe("rejected");
    expect(decisionRow.rows[0].comment).toBe("Montant incohérent avec le contrat.");

    const invoiceRow = await db.execute({
      sql: "SELECT status FROM invoices WHERE id = ?",
      args: [invoiceId],
    });
    expect(invoiceRow.rows[0].status).toBe("rejected");

    db.close();
  });

  it("throws when given no decisions", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db);
    await expect(createSession(db, "batch", [])).rejects.toThrow();
    db.close();
  });
});

describe("slug", () => {
  it("lowercases, strips accents, and hyphenates", () => {
    expect(slug("Arcadia Télécom")).toBe("arcadia-telecom");
  });
});

describe("notificationEmail", () => {
  it("builds a mocked address from the entity name", () => {
    expect(notificationEmail("Arcadia Télécom")).toBe("finance@arcadia-telecom.interne");
  });
});
