function luhnRemainder(digits: string): number {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let value = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
  }
  return sum % 10;
}

export function isValidSiren(siren: string): boolean {
  if (!/^\d{9}$/.test(siren)) return false;
  return luhnRemainder(siren) === 0;
}

export function generateValidSiren(base8: string): string {
  if (!/^\d{8}$/.test(base8)) {
    throw new Error("base8 must be exactly 8 digits");
  }
  for (let check = 0; check <= 9; check++) {
    const candidate = base8 + String(check);
    if (isValidSiren(candidate)) return candidate;
  }
  throw new Error("no valid Luhn check digit found");
}
