import { describe, it, expect, vi, beforeEach } from "vitest";
import { createClient } from "@libsql/client";
import { migrate } from "../db/migrate";
import { seed } from "../db/seed";
import { getInvoicePdfPathname } from "../db/queries";
import { storeInvoicePdf } from "./store";

const putMock = vi.fn();
vi.mock("@vercel/blob", () => ({
  put: (...args: unknown[]) => putMock(...args),
}));

describe("storeInvoicePdf", () => {
  beforeEach(() => {
    putMock.mockReset();
    putMock.mockResolvedValue({
      url: "https://example.blob.vercel-storage.com/invoices/inv-pending-novalink.pdf",
    });
  });

  it("uploads the PDF as a private blob and records its pathname on the invoice", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db);
    await seed(db);

    const pdf = Buffer.from("%PDF-fake");
    await storeInvoicePdf(db, "inv-pending-novalink", pdf);

    expect(putMock).toHaveBeenCalledWith("invoices/inv-pending-novalink.pdf", pdf, {
      access: "private",
    });

    const pathname = await getInvoicePdfPathname(db, "inv-pending-novalink");
    expect(pathname).toBe("invoices/inv-pending-novalink.pdf");

    db.close();
  });
});
