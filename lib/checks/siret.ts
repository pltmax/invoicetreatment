import { isValidSiren } from "./siren";

function luhnValid14(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let value = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
  }
  return sum % 10 === 0;
}

export function isValidSiret(siret: string): boolean {
  if (!/^\d{14}$/.test(siret)) return false;
  if (!isValidSiren(siret.slice(0, 9))) return false;
  return luhnValid14(siret);
}

export function generateValidSiret(siren: string): string {
  if (!isValidSiren(siren)) {
    throw new Error("siren must already be a valid SIREN");
  }
  for (let nic = 1; nic <= 99999; nic++) {
    const candidate = siren + String(nic).padStart(5, "0");
    if (luhnValid14(candidate)) return candidate;
  }
  throw new Error("no valid NIC found");
}
