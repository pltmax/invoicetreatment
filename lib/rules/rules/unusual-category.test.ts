import { describe, it, expect } from "vitest";
import { buildContext } from "../test-fixtures";
import unusualCategoryRule from "./unusual-category";

describe("unusual-category rule", () => {
  it("returns orange when the category has never been approved at this subsidiary", () => {
    const ctx = buildContext({
      invoice: { category: "marketing" },
      subsidiaryApprovedCategories: ["maintenance", "facilities"],
    });
    const reason = unusualCategoryRule(ctx);
    expect(reason?.code).toBe("UNUSUAL_CATEGORY");
    expect(reason?.level).toBe("orange");
  });

  it("does not trigger when the category has been approved before", () => {
    const ctx = buildContext({
      invoice: { category: "maintenance" },
      subsidiaryApprovedCategories: ["maintenance", "facilities"],
    });
    expect(unusualCategoryRule(ctx)).toBeNull();
  });

  it("does not trigger when no categories have been approved yet but this one matches by default", () => {
    const ctx = buildContext();
    expect(unusualCategoryRule(ctx)).toBeNull();
  });
});
