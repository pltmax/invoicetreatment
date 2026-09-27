// app/actions/sign.ts
"use server";

import "server-only";
import { redirect } from "next/navigation";
import { db } from "@/lib/db/client";
import { getClassification, getInvoicesByIds } from "@/lib/db/queries";
import { createSession } from "@/lib/sessions";
import { loadContext } from "@/lib/rules/context";

export async function createBatchSession(formData: FormData): Promise<void> {
  const ids = formData.getAll("ids").map((value) => String(value));
  const invoices = await getInvoicesByIds(db, ids);
  if (invoices.length === 0) {
    redirect("/");
  }

  const { sessionId } = await createSession(
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

  const { sessionId } = await createSession(db, kind, [
    {
      invoiceId,
      entityName: context.invoice.entityName,
      amountInclVatCents: context.invoice.amountInclVatCents,
      outcome,
      comment,
    },
  ]);

  redirect(`/sessions/${sessionId}`);
}
