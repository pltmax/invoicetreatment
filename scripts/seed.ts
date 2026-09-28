import { db } from "../lib/db/client";
import { seed } from "../lib/db/seed";
import { generateAllInvoicePdfs } from "../lib/pdf/generate-all";

async function main() {
  await seed(db);
  console.log("Seed complete.");
  console.log("Generating invoice PDFs…");
  await generateAllInvoicePdfs(db);
  console.log("PDFs uploaded.");
  db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
