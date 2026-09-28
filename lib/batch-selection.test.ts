// lib/batch-selection.test.ts
import { describe, it, expect } from "vitest";
import { parseBatchIds, invoiceDetailHref, batchReviewHref } from "./batch-selection";

describe("parseBatchIds", () => {
  it("splits a comma-separated list", () => {
    expect(parseBatchIds("a,b,c")).toEqual(["a", "b", "c"]);
  });

  it("returns an empty list when the param is absent or empty", () => {
    expect(parseBatchIds(undefined)).toEqual([]);
    expect(parseBatchIds("")).toEqual([]);
  });

  it("trims whitespace and drops empty entries", () => {
    expect(parseBatchIds(" a, ,b,,")).toEqual(["a", "b"]);
  });

  it("removes duplicates, keeping first occurrence order", () => {
    expect(parseBatchIds("a,b,a,c,b")).toEqual(["a", "b", "c"]);
  });
});

describe("invoiceDetailHref", () => {
  it("carries the batch selection as a query param", () => {
    expect(invoiceDetailHref("inv-1", ["inv-1", "inv-2"])).toBe("/invoices/inv-1?batch=inv-1%2Cinv-2");
  });

  it("is the plain detail URL when there is no batch selection", () => {
    expect(invoiceDetailHref("inv-1", [])).toBe("/invoices/inv-1");
  });

  it("round-trips through parseBatchIds", () => {
    const href = invoiceDetailHref("inv-1", ["inv-1", "inv-2"]);
    const raw = new URL(href, "http://localhost").searchParams.get("batch") ?? undefined;
    expect(parseBatchIds(raw)).toEqual(["inv-1", "inv-2"]);
  });
});

describe("batchReviewHref", () => {
  it("points to the batch session with the given ids", () => {
    expect(batchReviewHref(["inv-1", "inv-2"])).toBe("/sessions/new?ids=inv-1%2Cinv-2");
  });
});
