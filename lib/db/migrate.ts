import "server-only";
import type { Client } from "@libsql/client";
import { SCHEMA_SQL } from "./schema";

export async function migrate(db: Client): Promise<void> {
  await db.executeMultiple(SCHEMA_SQL);
}
