// app/actions/thresholds.ts
"use server";

import "server-only";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db/client";
import { saveThresholds } from "@/lib/db/queries";
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

  await saveThresholds(db, parsed);

  await classifyAll(db);

  revalidatePath("/rules");
  revalidatePath("/");
  redirect("/rules?saved=1");
}
