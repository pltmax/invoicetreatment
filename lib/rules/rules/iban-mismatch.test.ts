// lib/rules/rules/iban-mismatch.test.ts
import { describe, it, expect } from "vitest";
import { buildContext } from "../test-fixtures";
import ibanMismatchRule from "./iban-mismatch";

describe("iban-mismatch rule", () => {
  it("returns red when the printed IBAN differs from the current registered one", () => {
    const ctx = buildContext({
      invoice: { printedIban: "FR7630001007941234567890185" },
      ibanHistory: [{ iban: "FR1420041010050500013M02606", effectiveFrom: "2024-01-01" }],
    });
    const reason = ibanMismatchRule(ctx);
    expect(reason?.code).toBe("IBAN_MISMATCH");
    expect(reason?.level).toBe("red");
  });

  it("does not trigger when the printed IBAN matches the current registered one", () => {
    const ctx = buildContext({
      invoice: { printedIban: "FR1420041010050500013M02606" },
      ibanHistory: [{ iban: "FR1420041010050500013M02606", effectiveFrom: "2024-01-01" }],
    });
    expect(ibanMismatchRule(ctx)).toBeNull();
  });

  it("does not trigger when there is no IBAN history", () => {
    const ctx = buildContext({ ibanHistory: [] });
    expect(ibanMismatchRule(ctx)).toBeNull();
  });
});
