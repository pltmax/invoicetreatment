export function computeVatKey(siren: string): string {
  if (!/^\d{9}$/.test(siren)) {
    throw new Error("siren must be exactly 9 digits");
  }
  const key = (12 + 3 * (Number(siren) % 97)) % 97;
  return String(key).padStart(2, "0");
}

export function computeVatNumber(siren: string): string {
  return `FR${computeVatKey(siren)}${siren}`;
}
