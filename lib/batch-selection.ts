// lib/batch-selection.ts
// The batch selection travels in the URL so it survives navigation and refresh.

export const BATCH_PARAM = "batch";

export function parseBatchIds(raw: string | undefined): string[] {
  if (!raw) return [];
  const ids = raw
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  return [...new Set(ids)];
}

export function invoiceDetailHref(invoiceId: string, batchIds: string[]): string {
  const base = `/invoices/${invoiceId}`;
  if (batchIds.length === 0) return base;
  return `${base}?${new URLSearchParams({ [BATCH_PARAM]: batchIds.join(",") })}`;
}

export function batchReviewHref(ids: string[]): string {
  return `/sessions/new?${new URLSearchParams({ ids: ids.join(",") })}`;
}
