const LETTER_VALUES: Record<string, string> = {};
for (let i = 0; i < 26; i++) {
  LETTER_VALUES[String.fromCharCode(65 + i)] = String(10 + i);
}

function ibanNumericString(iban: string): string {
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  return rearranged
    .split("")
    .map((ch) => (/[A-Z]/.test(ch) ? LETTER_VALUES[ch] : ch))
    .join("");
}

function mod97(numeric: string): number {
  let remainder = 0;
  for (const digit of numeric) {
    remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder;
}

export function isValidIban(iban: string): boolean {
  const compact = iban.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(compact)) return false;
  return mod97(ibanNumericString(compact)) === 1;
}

export function buildIban(countryCode: string, bban: string): string {
  if (!/^[A-Z]{2}$/.test(countryCode)) {
    throw new Error("countryCode must be exactly 2 letters");
  }
  const provisional = `${countryCode}00${bban}`;
  const remainder = mod97(ibanNumericString(provisional));
  const checkDigits = String(98 - remainder).padStart(2, "0");
  return `${countryCode}${checkDigits}${bban}`;
}
