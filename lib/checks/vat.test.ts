import { describe, it, expect } from "vitest";
import { computeVatKey, computeVatNumber } from "./vat";
import { generateValidSiren } from "./siren";

describe("vat", () => {
  it("computes the FR VAT key as (12 + 3 * (siren mod 97)) mod 97, zero-padded", () => {
    const siren = generateValidSiren("40000001");
    const sirenMod97 = Number(siren) % 97;
    const expectedKey = String((12 + 3 * sirenMod97) % 97).padStart(2, "0");
    expect(computeVatKey(siren)).toBe(expectedKey);
    expect(computeVatKey(siren)).toHaveLength(2);
  });

  it("builds the vat number as FR + key + siren", () => {
    const siren = generateValidSiren("40000001");
    const key = computeVatKey(siren);
    expect(computeVatNumber(siren)).toBe(`FR${key}${siren}`);
  });

  it("rejects a siren that isn't exactly 9 digits", () => {
    expect(() => computeVatKey("123")).toThrow();
  });
});
