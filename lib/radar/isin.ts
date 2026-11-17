/** ISIN check-digit validation (ISO 6166, Luhn on the digit-expanded code). */
export function isValidIsin(isin: string): boolean {
  if (!/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(isin)) return false;
  const digits = isin
    .slice(0, -1)
    .split("")
    .map((c) => Number.parseInt(c, 36).toString())
    .join("");
  let total = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    total += d;
  }
  return (10 - (total % 10)) % 10 === Number(isin[isin.length - 1]);
}
