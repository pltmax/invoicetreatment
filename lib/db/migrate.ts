import "server-only";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { Client } from "@libsql/client";

const SCHEMA_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "schema.sql");

export async function migrate(db: Client): Promise<void> {
  const schema = readFileSync(SCHEMA_PATH, "utf-8");
  await db.executeMultiple(schema);
}
