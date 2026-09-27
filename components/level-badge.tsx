import type { Level } from "@/lib/rules/types";

const LEVEL_COLOR: Record<Level, string> = {
  green: "bg-green-500",
  orange: "bg-orange-500",
  red: "bg-red-500",
};

const LEVEL_LABEL: Record<Level, string> = {
  green: "Vert",
  orange: "Orange",
  red: "Rouge",
};

export function LevelBadge({ level }: { level: Level }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span
        className={`inline-block h-3 w-3 rounded-full ${LEVEL_COLOR[level]}`}
        aria-hidden="true"
      />
      <span className="text-sm text-gray-700">{LEVEL_LABEL[level]}</span>
    </span>
  );
}
