import { describe, it, expect, vi, beforeEach } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { extractInvoiceFromPdf, ExtractionError } from "./extract";

const mockParse = vi.hoisted(() => vi.fn());

vi.mock("@anthropic-ai/sdk", async () => {
  const actual = await vi.importActual<typeof import("@anthropic-ai/sdk")>("@anthropic-ai/sdk");
  const MockAnthropic = vi.fn(() => ({ messages: { parse: mockParse } })) as unknown as typeof actual.default;
  Object.setPrototypeOf(MockAnthropic, actual.default);
  return { ...actual, default: MockAnthropic };
});

vi.mock("@anthropic-ai/sdk/helpers/zod", () => ({
  zodOutputFormat: vi.fn(() => ({})),
}));

beforeEach(() => {
  mockParse.mockReset();
});

const FAKE_EXTRACTION = {
  supplierName: "Test Supplier",
  printedSiren: "123456789",
  printedVatNumber: "FR12345678901",
  printedIban: "FR1234567890123456789012345",
  invoiceNumber: "INV-001",
  category: "consulting" as const,
  amountExclVatCents: 100000,
  amountInclVatCents: 120000,
  issueDate: "2026-06-01",
  dueDate: "2026-07-01",
};

describe("extractInvoiceFromPdf", () => {
  it("returns the parsed output on success", async () => {
    mockParse.mockResolvedValue({ parsed_output: FAKE_EXTRACTION });

    const result = await extractInvoiceFromPdf("base64-pdf-data");
    expect(result).toEqual(FAKE_EXTRACTION);
  });

  it("throws ExtractionError with a French message on AuthenticationError", async () => {
    mockParse.mockRejectedValue(
      new Anthropic.AuthenticationError(401, {}, "invalid x-api-key", new Headers())
    );

    await expect(extractInvoiceFromPdf("base64-pdf-data")).rejects.toThrow(ExtractionError);
    await expect(extractInvoiceFromPdf("base64-pdf-data")).rejects.toThrow(/ANTHROPIC_API_KEY/);
  });

  it("throws ExtractionError with the API's own message on other API errors", async () => {
    mockParse.mockRejectedValue(
      new Anthropic.BadRequestError(400, undefined, "model not found", new Headers())
    );

    await expect(extractInvoiceFromPdf("base64-pdf-data")).rejects.toThrow(ExtractionError);
    await expect(extractInvoiceFromPdf("base64-pdf-data")).rejects.toThrow(/model not found/);
  });

  it("throws ExtractionError when parsed_output is null", async () => {
    mockParse.mockResolvedValue({ parsed_output: null });

    await expect(extractInvoiceFromPdf("base64-pdf-data")).rejects.toThrow(ExtractionError);
    await expect(extractInvoiceFromPdf("base64-pdf-data")).rejects.toThrow(/Impossible d'extraire/);
  });
});
