export function formatEuros(cents: number): string {
  const euros = cents / 100;
  const fractionDigits = Math.abs(euros) >= 1000 ? 0 : 2;
  return euros.toLocaleString("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

export function formatPercent(ratio: number): string {
  return `${Math.round(ratio * 100)} %`;
}

export function formatDateFr(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR");
}

export function formatDateTimeFr(iso: string): string {
  return new Date(iso).toLocaleString("fr-FR");
}

export function formatIbanGrouped(iban: string): string {
  return iban.replace(/\s+/g, "").match(/.{1,4}/g)?.join(" ") ?? iban;
}
