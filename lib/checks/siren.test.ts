import { describe, it, expect } from "vitest";
import { isValidSiren, generateValidSiren } from "./siren";

describe("siren", () => {
  it("accepts a generated siren with a correct Luhn check digit", () => {
    const siren = generateValidSiren("40000001");
    expect(isValidSiren(siren)).toBe(true);
  });

  it("rejects a siren with an incorrect check digit", () => {
    const siren = generateValidSiren("40000001");
    const lastDigit = Number(siren[8]);
    const wrongDigit = (lastDigit + 1) % 10;
    const invalid = siren.slice(0, 8) + String(wrongDigit);
    expect(isValidSiren(invalid)).toBe(false);
  });

  it("rejects a value that isn't exactly 9 digits", () => {
    expect(isValidSiren("12345")).toBe(false);
    expect(isValidSiren("1234567890")).toBe(false);
  });
});
