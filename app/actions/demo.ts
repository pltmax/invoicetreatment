"use server";

import "server-only";
import { db } from "@/lib/db/client";
import { migrate } from "@/lib/db/migrate";
import { seed } from "@/lib/db/seed";

export async function resetDemo(): Promise<void> {
  await migrate(db);
  await seed(db);
}
