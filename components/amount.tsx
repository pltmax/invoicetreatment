import { formatEuros } from "@/lib/format";

export function Amount({ cents, className = "" }: { cents: number; className?: string }) {
  return <span className={`tabular-nums ${className}`}>{formatEuros(cents)}</span>;
}
