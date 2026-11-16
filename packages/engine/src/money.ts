/**
 * Play money as short text without ₦: 2M, 1.5B, 50B. For text that shows up inside Zend itself
 * (feed cards, chat lines), where it sits next to real ₦ payments.
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

/**
 * Play money inside the game: ₦50B, ₦1.5B. Like Lagos Life's naira, it's fake: every screen that
 * shows it also says it's play money and not real.
 */
export function formatPlayNaira(n: number): string {
  return n < 0 ? `-₦${formatPlay(-n)}` : `₦${formatPlay(n)}`;
}
