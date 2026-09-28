import { describe, it, expect } from "vitest";
import { summarizeReason, REASON_SUMMARY_CODES } from "./reason-summary";
import type { Reason, ReasonCode } from "./types";

const reason = (code: ReasonCode, data?: Record<string, unknown>): Reason => ({
  code,
  level: "orange",
  message: "long message",
  data,
});

describe("summarizeReason", () => {
  it.each(REASON_SUMMARY_CODES)("gives %s a short non-empty summary", (code) => {
    const summary = summarizeReason(reason(code, { deviationPct: 0.21 }));
    expect(summary.length).toBeGreaterThan(0);
    expect(summary.length).toBeLessThanOrEqual(30);
  });

  it.each([
    ["DEVIATION_HISTORY", "+21 % vs historique"],
    ["DEVIATION_HISTORY_HIGH", "+21 % vs historique"],
    ["DEVIATION_CONTRACT", "+21 % vs contrat"],
    ["DEVIATION_CONTRACT_HIGH", "+21 % vs contrat"],
    ["DEVIATION_PEER", "+21 % vs autres filiales"],
    ["DEVIATION_PEER_HIGH", "+21 % vs autres filiales"],
  ] as const)("includes the deviation percentage for %s", (code, expected) => {
    expect(summarizeReason(reason(code, { deviationPct: 0.21 }))).toBe(expected);
  });

  it("falls back to the plain label when deviation data is missing", () => {
    expect(summarizeReason(reason("DEVIATION_HISTORY"))).toBe("Écart vs historique");
    expect(summarizeReason(reason("DEVIATION_PEER", { deviationPct: "n/a" }))).toBe(
      "Écart vs autres filiales"
    );
  });

  it("summarizes non-deviation codes with a fixed label", () => {
    expect(summarizeReason(reason("IBAN_MISMATCH"))).toBe("IBAN différent");
    expect(summarizeReason(reason("NO_CONTRACT"))).toBe("Sans contrat");
  });
});
