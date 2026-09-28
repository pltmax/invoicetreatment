"use server";

import "server-only";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db/client";
import { migrate } from "@/lib/db/migrate";
import { seed } from "@/lib/db/seed";
import { generateAllInvoicePdfs } from "@/lib/pdf/generate-all";

export async function resetDemo(): Promise<void> {
  await migrate(db);
  await seed(db);
  // Store every invoice's PDF up front, same as the CLI's npm run seed —
  // the PDF route's render-on-demand fallback stays in place as a safety
  // net (e.g. if this times out on a low-duration-limit deployment), but
  // it shouldn't normally be needed after a reset.
  await generateAllInvoicePdfs(db);
  revalidatePath("/");
}
