/**
 * Play money as short text: 2M, 1.5B, 50B. Never with ₦: play money isn't Naira, and Zend's
 * copy rules keep ₦ for real Naira only. Screens put a "play money" label next to amounts.
 */
export function formatPlay(n: number): string {
  const sign = n < 0 ? "-" : "";
  const a = Math.abs(n);
  const short = (x: number, unit: string) => `${sign}${Number(x.toFixed(1))}${unit}`;
  if (a >= 999_950_000) return short(a / 1e9, "B");
  if (a >= 999_950) return short(a / 1e6, "M");
  if (a >= 1_000) return short(a / 1e3, "K");
  return `${sign}${Math.round(a)}`;
}
