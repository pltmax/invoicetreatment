import { describe, it, expect } from "vitest";
import { buildContext } from "../test-fixtures";
import ibanForeignRule from "./iban-foreign";

describe("iban-foreign rule", () => {
  it("returns red when the printed IBAN is not French", () => {
    const ctx = buildContext({ invoice: { printedIban: "DE89370400440532013000" } });
    const reason = ibanForeignRule(ctx);
    expect(reason?.code).toBe("IBAN_FOREIGN");
    expect(reason?.level).toBe("red");
    expect(reason?.data?.countryCode).toBe("DE");
  });

  it("does not trigger for a French IBAN", () => {
    const ctx = buildContext({ invoice: { printedIban: "FR1420041010050500013M02606" } });
    expect(ibanForeignRule(ctx)).toBeNull();
  });
});
