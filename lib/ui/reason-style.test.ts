import { describe, it, expect } from "vitest";
import colors from "tailwindcss/colors";
import { REASON_STYLE } from "./reason-style";
import type { Level } from "@/lib/rules/types";

type Rgb = [number, number, number];

function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Resolves a Tailwind class like "bg-orange-500/80" or "text-gray-900" to rgb + alpha.
function resolve(cls: string): { rgb: Rgb; alpha: number } {
  const match = cls.match(/^(?:bg|text)-([a-z]+)-(\d+)(?:\/(\d+))?$/);
  if (!match) throw new Error(`Unparseable color class: ${cls}`);
  const [, name, shade, alpha] = match;
  const hex = (colors as unknown as Record<string, Record<string, string>>)[name][shade];
  return { rgb: hexToRgb(hex), alpha: alpha ? Number(alpha) / 100 : 1 };
}

function blendOverWhite({ rgb, alpha }: { rgb: Rgb; alpha: number }): Rgb {
  return rgb.map((c) => Math.round(alpha * c + (1 - alpha) * 255)) as Rgb;
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

function classOf(style: string, prefix: "bg" | "text"): string {
  const cls = style.split(/\s+/).find((c) => new RegExp(`^${prefix}-[a-z]+-\\d+`).test(c));
  if (!cls) throw new Error(`No ${prefix} class in "${style}"`);
  return cls;
}

describe("REASON_STYLE", () => {
  it("renders green reasons without a box", () => {
    expect(REASON_STYLE.green).not.toMatch(/\bbg-/);
    expect(REASON_STYLE.green).not.toMatch(/\bborder\b/);
  });

  it.each<Level>(["orange", "red"])("boxes %s reasons at 80%% opacity", (level) => {
    expect(classOf(REASON_STYLE[level], "bg")).toMatch(/\/80$/);
  });

  it.each<Level>(["orange", "red"])("keeps %s text at WCAG AA contrast (>= 4.5:1)", (level) => {
    const bg = blendOverWhite(resolve(classOf(REASON_STYLE[level], "bg")));
    const fg = resolve(classOf(REASON_STYLE[level], "text")).rgb;
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });
});
