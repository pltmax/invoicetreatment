import { describe, it, expect } from "vitest";
import { buildIban, isValidIban, ibanCountryCode } from "./iban";

describe("iban", () => {
  it("builds a French IBAN with a valid mod-97 checksum", () => {
    const iban = buildIban("FR", "30001000640000012345D6700");
    expect(iban.startsWith("FR")).toBe(true);
    expect(isValidIban(iban)).toBe(true);
  });

  it("builds a German IBAN with a valid mod-97 checksum", () => {
    const iban = buildIban("DE", "370400440532013000");
    expect(iban.startsWith("DE")).toBe(true);
    expect(isValidIban(iban)).toBe(true);
  });

  it("rejects an IBAN with a corrupted check digit", () => {
    const iban = buildIban("FR", "30001000640000012345D6700");
    const corrupted = iban.slice(0, 2) + "00" + iban.slice(4);
    expect(isValidIban(corrupted)).toBe(false);
  });

  it("rejects a malformed value", () => {
    expect(isValidIban("not-an-iban")).toBe(false);
  });
});

describe("ibanCountryCode", () => {
  it("extracts the two-letter country code, case- and whitespace-insensitive", () => {
    expect(ibanCountryCode("FR7640100000000000001")).toBe("FR");
    expect(ibanCountryCode("de1234")).toBe("DE");
    expect(ibanCountryCode("FR76 4010 0000 0000 0000 1")).toBe("FR");
  });
});
