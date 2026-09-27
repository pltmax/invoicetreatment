import { db } from "../lib/db/client";
import { seed } from "../lib/db/seed";

async function main() {
  await seed(db);
  console.log("Seed complete.");
  db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
