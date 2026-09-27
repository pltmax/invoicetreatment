// lib/format.test.ts
import { describe, it, expect } from "vitest";
import { formatEuros, formatPercent, formatDateFr, formatIbanGrouped } from "./format";

describe("formatEuros", () => {
  it("shows cents below 1 000 €", () => {
    expect(formatEuros(95_000)).toBe(
      (950).toLocaleString("fr-FR", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 })
    );
  });

  it("hides cents above 1 000 €", () => {
    expect(formatEuros(420_000)).toBe(
      (4200).toLocaleString("fr-FR", { style: "currency", currency: "EUR", minimumFractionDigits: 0, maximumFractionDigits: 0 })
    );
  });

  it("hides cents at exactly 1 000 €", () => {
    expect(formatEuros(100_000)).toBe(
      (1000).toLocaleString("fr-FR", { style: "currency", currency: "EUR", minimumFractionDigits: 0, maximumFractionDigits: 0 })
    );
  });
});

describe("formatPercent", () => {
  it("rounds a ratio to the nearest whole percent", () => {
    expect(formatPercent(0.203)).toBe("20 %");
    expect(formatPercent(0.4001)).toBe("40 %");
  });
});

describe("formatDateFr", () => {
  it("formats an ISO date using the fr-FR locale", () => {
    expect(formatDateFr("2026-03-12")).toBe(new Date("2026-03-12").toLocaleDateString("fr-FR"));
  });
});

describe("formatIbanGrouped", () => {
  it("groups an IBAN into 4-character blocks", () => {
    expect(formatIbanGrouped("FR1420041010050500013M02606")).toBe("FR14 2004 1010 0505 0001 3M02 606");
  });
});
