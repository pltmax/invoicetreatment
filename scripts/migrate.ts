import { mkdirSync } from "node:fs";

async function main() {
  if (!process.env.TURSO_DATABASE_URL) {
    mkdirSync("data", { recursive: true });
  }

  const { db } = await import("../lib/db/client");
  const { migrate } = await import("../lib/db/migrate");

  await migrate(db);
  console.log("Migration complete.");
  db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
