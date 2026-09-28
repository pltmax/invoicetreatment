import { describe, it, expect, vi } from "vitest";
import { createClient } from "@libsql/client";
import { migrate } from "../db/migrate";
import { seed } from "../db/seed";
import { getAllInvoicesForPdfGeneration } from "../db/queries";
import { generateAllInvoicePdfs } from "./generate-all";

const renderMock = vi.fn().mockResolvedValue(Buffer.from("%PDF-fake"));
const storeMock = vi.fn().mockResolvedValue(undefined);
vi.mock("./generate", () => ({ renderInvoicePdf: (...args: unknown[]) => renderMock(...args) }));
vi.mock("./store", () => ({ storeInvoicePdf: (...args: unknown[]) => storeMock(...args) }));

describe("generateAllInvoicePdfs", () => {
  it("renders and stores a PDF for every invoice in the database", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db);
    await seed(db);

    const invoices = await getAllInvoicesForPdfGeneration(db);
    expect(invoices.length).toBeGreaterThan(0);

    await generateAllInvoicePdfs(db);

    expect(renderMock).toHaveBeenCalledTimes(invoices.length);
    expect(storeMock).toHaveBeenCalledTimes(invoices.length);
    // Each store call got the invoice id that matches what render produced for it.
    const storedIds = storeMock.mock.calls.map((call) => call[1]);
    expect(new Set(storedIds).size).toBe(invoices.length);

    db.close();
  });
});
