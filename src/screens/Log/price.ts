/** The optional RM price box on Review and Plate. */

/** "9.50" for the input; "" when there's no price. (Display copy uses fmtRm.) */
export function priceText(rm: number | undefined): string {
  return rm === undefined ? '' : rm.toFixed(2);
}

/** The typed price in RM, or undefined when empty or not a number. */
export function parsePrice(text: string): number | undefined {
  const clean = text.replace(/[^\d.,]/g, '').replace(',', '.');
  if (!clean) return undefined;
  const value = Number(clean);
  return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) / 100 : undefined;
}

/** Keeps digits and one decimal separator while typing. */
export function cleanPriceInput(text: string): string {
  return text.replace(/[^\d.,]/g, '').slice(0, 8);
}
