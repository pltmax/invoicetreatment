import { describe, it, expect } from "vitest";
import { generateValidSiren } from "./siren";
import { isValidSiret, generateValidSiret } from "./siret";

describe("siret", () => {
  it("generates a SIRET that isValidSiret accepts and that starts with the given SIREN", () => {
    const siren = generateValidSiren("40000001");
    const siret = generateValidSiret(siren);
    expect(siret).toHaveLength(14);
    expect(siret.startsWith(siren)).toBe(true);
    expect(isValidSiret(siret)).toBe(true);
  });

  it("rejects a SIRET with an incorrect check digit", () => {
    const siren = generateValidSiren("40000001");
    const siret = generateValidSiret(siren);
    const lastDigit = Number(siret[13]);
    const wrongDigit = (lastDigit + 1) % 10;
    const invalid = siret.slice(0, 13) + String(wrongDigit);
    expect(isValidSiret(invalid)).toBe(false);
  });

  it("rejects a value that isn't exactly 14 digits", () => {
    expect(isValidSiret("12345")).toBe(false);
    expect(isValidSiret("123456789012345")).toBe(false);
  });

  it("throws if given something that isn't already a valid SIREN", () => {
    expect(() => generateValidSiret("123456789")).toThrow();
  });
});
