// lib/rules/engine.test.ts
import { describe, it, expect } from "vitest";
import { classify } from "./engine";
import { buildContext } from "./test-fixtures";

const TODAY = new Date("2026-06-15");

describe("classify", () => {
  it("returns green with a single ALL_CHECKS_PASSED reason when nothing triggers", () => {
    const ctx = buildContext();
    const result = classify(ctx, TODAY);
    expect(result.level).toBe("green");
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0].code).toBe("ALL_CHECKS_PASSED");
  });

  it("takes the highest severity level when reasons of multiple levels fire", () => {
    const ctx = buildContext({
      invoice: { contractId: null, printedIban: "DE89370400440532013000" },
      contract: null,
    });
    const result = classify(ctx, TODAY);
    expect(result.level).toBe("red");
    const codes = result.reasons.map((r) => r.code);
    expect(codes).toContain("NO_CONTRACT");
    expect(codes).toContain("IBAN_FOREIGN");
  });

  it("sorts reasons red first, then orange, then green", () => {
    const ctx = buildContext({
      invoice: { contractId: null, printedIban: "DE89370400440532013000" },
      contract: null,
    });
    const result = classify(ctx, TODAY);
    const levels = result.reasons.map((r) => r.level);
    expect(levels.indexOf("red")).toBeLessThan(levels.indexOf("orange"));
  });
});
