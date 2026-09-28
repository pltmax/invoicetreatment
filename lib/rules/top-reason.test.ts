import { describe, it, expect } from "vitest";
import { topReason, topReasons } from "./top-reason";
import type { Reason } from "./types";

const green: Reason = { code: "ALL_CHECKS_PASSED", level: "green", message: "ok" };
const orange: Reason = { code: "NO_CONTRACT", level: "orange", message: "no contract" };
const red: Reason = { code: "IBAN_MISMATCH", level: "red", message: "iban" };

describe("topReason", () => {
  it("prefers the first red/orange reason over an earlier green one", () => {
    expect(topReason([green, orange, red])).toBe(orange);
  });

  it("falls back to the first reason when none is flagged", () => {
    expect(topReason([green])).toBe(green);
  });

  it("returns undefined for an empty list", () => {
    expect(topReason([])).toBeUndefined();
  });
});

describe("topReasons", () => {
  it("wraps the top reason in a single-item list, empty when there is none", () => {
    expect(topReasons([green, red])).toEqual([red]);
    expect(topReasons([])).toEqual([]);
  });
});
