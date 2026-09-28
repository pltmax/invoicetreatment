// app/actions/sign.ts
"use server";

import "server-only";
import { redirect } from "next/navigation";
import { db } from "@/lib/db/client";
import { getClassification, getDecisionSessionId, getInvoicesByIds } from "@/lib/db/queries";
import { createSession } from "@/lib/sessions";
import { loadContext } from "@/lib/rules/context";

export async function createBatchSession(formData: FormData): Promise<void> {
  const ids = formData.getAll("ids").map((value) => String(value));
  const invoices = await getInvoicesByIds(db, ids);
  if (invoices.length === 0) {
    redirect("/");
  }

  let sessionId: string;
  try {
    const created = await createSession(
      db,
      "batch",
      invoices.map((invoice) => ({
        invoiceId: invoice.id,
        entityName: invoice.entityName,
        amountInclVatCents: invoice.amountInclVatCents,
        outcome: "approved",
        comment: null,
      }))
    );
    sessionId = created.sessionId;
  } catch {
    // Concurrent double-submit (double-click, or the same batch submitted from
    // two tabs): one of the writes here hits the decisions.invoice_id UNIQUE
    // constraint because another request already recorded a decision for one
    // of these invoices. Several sessions could now be involved, so unlike
    // signSingleDecision there is no single existing session id to resolve to
    // — fall back to the dashboard instead of letting the raw SQLite error
    // propagate.
    redirect("/");
    return;
  }

  redirect(`/sessions/${sessionId}`);
}

export async function signSingleDecision(formData: FormData): Promise<void> {
  const invoiceId = String(formData.get("invoiceId"));
  const outcome = String(formData.get("outcome")) as "approved" | "rejected";
  const commentRaw = String(formData.get("comment") ?? "").trim();
  const comment = commentRaw.length > 0 ? commentRaw : null;

  const context = await loadContext(db, invoiceId, new Date());
  if (context.invoice.status !== "pending") {
    redirect(`/invoices/${invoiceId}`);
  }

  const classification = await getClassification(db, invoiceId);
  const kind = classification?.level === "red" ? "single" : "batch";

  let sessionId: string;
  try {
    const created = await createSession(db, kind, [
      {
        invoiceId,
        entityName: context.invoice.entityName,
        amountInclVatCents: context.invoice.amountInclVatCents,
        outcome,
        comment,
      },
    ]);
    sessionId = created.sessionId;
  } catch {
    // Concurrent double-submit (double-click, or the same invoice open in two
    // tabs): both requests' loadContext reads resolved "pending" before
    // either wrote, so the second createSession here hits the
    // decisions.invoice_id UNIQUE constraint. The other request already
    // recorded a decision for this invoice — redirect to its session instead
    // of letting the raw SQLite error propagate.
    const existingSessionId = await getDecisionSessionId(db, invoiceId);
    redirect(existingSessionId ? `/sessions/${existingSessionId}` : `/invoices/${invoiceId}`);
  }

  redirect(`/sessions/${sessionId}`);
}
