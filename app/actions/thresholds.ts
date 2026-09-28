// app/actions/thresholds.ts
"use server";

import "server-only";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db/client";
import { classifyAll } from "@/lib/rules/classify-all";
import { parseThresholdsForm, isValidThresholdOrder } from "@/lib/rules/threshold-form";

export async function updateThresholds(formData: FormData): Promise<void> {
  const parsed = parseThresholdsForm(formData);
  if (!parsed) {
    redirect("/rules?error=invalid");
  }
  if (!isValidThresholdOrder(parsed)) {
    redirect("/rules?error=order");
  }

  await db.execute({
    sql: `UPDATE thresholds SET
      deviation_orange = ?, deviation_red = ?, new_supplier_amount_cents = ?,
      exceptional_amount_cents = ?, iban_recent_change_days = ?, risk_window_months = ?,
      duplicate_window_days = ?, recurring_min_invoices = ?, history_sample = ?,
      updated_at = datetime('now')
      WHERE id = 'default'`,
    args: [
      parsed.deviationOrange,
      parsed.deviationRed,
      parsed.newSupplierAmountCents,
      parsed.exceptionalAmountCents,
      parsed.ibanRecentChangeDays,
      parsed.riskWindowMonths,
      parsed.duplicateWindowDays,
      parsed.recurringMinInvoices,
      parsed.historySample,
    ],
  });

  await classifyAll(db);

  revalidatePath("/rules");
  revalidatePath("/");
  redirect("/rules?saved=1");
}
