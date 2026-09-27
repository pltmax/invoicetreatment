// lib/rules/rules/identity-mismatch.test.ts
import { describe, it, expect } from "vitest";
import { generateValidSiren } from "../../checks/siren";
import { computeVatNumber } from "../../checks/vat";
import { buildContext } from "../test-fixtures";
import identityMismatchRule from "./identity-mismatch";

describe("identity-mismatch rule", () => {
  it("returns red when the printed SIREN differs from the registry", () => {
    const otherSiren = generateValidSiren("40000099");
    const ctx = buildContext({ invoice: { printedSiren: otherSiren } });
    const reason = identityMismatchRule(ctx);
    expect(reason?.code).toBe("IDENTITY_MISMATCH");
    expect(reason?.level).toBe("red");
    expect(reason?.data?.sirenMismatch).toBe(true);
  });

  it("returns red when the printed VAT number differs from the registry", () => {
    const otherVat = computeVatNumber(generateValidSiren("40000099"));
    const ctx = buildContext({ invoice: { printedVatNumber: otherVat } });
    const reason = identityMismatchRule(ctx);
    expect(reason?.code).toBe("IDENTITY_MISMATCH");
    expect(reason?.data?.vatMismatch).toBe(true);
  });

  it("returns red when the VAT key is inconsistent with the printed SIREN", () => {
    const ctx = buildContext({ invoice: { printedVatNumber: "FR00999999999" } });
    const reason = identityMismatchRule(ctx);
    expect(reason?.code).toBe("IDENTITY_MISMATCH");
    expect(reason?.data?.keyInconsistent).toBe(true);
  });

  it("does not trigger when SIREN and VAT both match the registry", () => {
    const ctx = buildContext();
    expect(identityMismatchRule(ctx)).toBeNull();
  });
});
