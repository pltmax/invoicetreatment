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

// Every category value the seed data uses (lib/db/seed.ts). Invoices are
// mocked, not user-entered, so this closed list covers all of them —
// unknown values fall back to the raw string rather than crashing.
const CATEGORY_LABELS: Record<string, string> = {
  cloud_hosting: "Hébergement cloud",
  consulting: "Conseil",
  design: "Design",
  equipment: "Équipement",
  facilities: "Entretien des locaux",
  fleet: "Flotte automobile",
  it_integration: "Intégration informatique",
  logistics: "Logistique",
  maintenance: "Maintenance",
  marketing: "Marketing",
  office_supplies: "Fournitures de bureau",
  telecom_maintenance: "Maintenance télécom",
  utilities: "Énergie et fluides",
};

export function formatCategory(category: string): string {
  return CATEGORY_LABELS[category] ?? category;
}
