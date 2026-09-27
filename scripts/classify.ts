import { db } from "../lib/db/client";
import { classifyAll } from "../lib/rules/classify-all";

async function main() {
  await classifyAll(db);
  console.log("Classification complete.");
  db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
