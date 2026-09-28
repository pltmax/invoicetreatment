import { describe, it, expect } from "vitest";
import colors from "tailwindcss/colors";
import { REASON_STYLE } from "./reason-style";
import type { Level } from "@/lib/rules/types";

type Rgb = [number, number, number];

function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Resolves a Tailwind text color class like "text-orange-800" to rgb.
function resolveText(cls: string): Rgb {
  const match = cls.match(/^text-([a-z]+)-(\d+)$/);
  if (!match) throw new Error(`Unparseable color class: ${cls}`);
  const [, name, shade] = match;
  return hexToRgb((colors as unknown as Record<string, Record<string, string>>)[name][shade]);
}

function luminance([r, g, b]: Rgb): number {
  const [R, G, B] = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function textColorClass(style: string): string {
  const cls = style.split(/\s+/).find((c) => /^text-[a-z]+-\d+$/.test(c));
  if (!cls) throw new Error(`No text color class in "${style}"`);
  return cls;
}

const WHITE: Rgb = [255, 255, 255];

describe("REASON_STYLE", () => {
  it.each<Level>(["green", "orange", "red"])("renders %s reasons as plain text, without a box", (level) => {
    expect(REASON_STYLE[level]).not.toMatch(/\bbg-/);
    expect(REASON_STYLE[level]).not.toMatch(/\bborder\b/);
  });

  it("tints orange and red reasons with their own hue", () => {
    expect(textColorClass(REASON_STYLE.orange)).toMatch(/^text-orange-/);
    expect(textColorClass(REASON_STYLE.red)).toMatch(/^text-red-/);
  });

  it.each<Level>(["green", "orange", "red"])("keeps %s text at WCAG AA contrast on white (>= 4.5:1)", (level) => {
    const fg = resolveText(textColorClass(REASON_STYLE[level]));
    expect(contrast(fg, WHITE)).toBeGreaterThanOrEqual(4.5);
  });
});
