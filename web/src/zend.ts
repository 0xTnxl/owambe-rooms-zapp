import { init } from "@zendfi/appkit";

const origins = ((import.meta.env.VITE_ZEND_ORIGINS as string | undefined) ?? "https://app.usezend.app").split(",").map((s) => s.trim());

export const zend = init({ zendOrigins: origins });
export const inZend = zend.environment !== "external";
export const SLUG = (import.meta.env.VITE_ZEND_SLUG as string | undefined) ?? "owambe";

/** Zend's link to this app, e.g. with `{ room: "KQ7M2D" }`: works signed out, keeps the room. */
export function appLink(params: Record<string, string> = {}): string {
  const q = new URLSearchParams(params).toString();
  return `https://app.usezend.app/apps/${SLUG}${q ? `?${q}` : ""}`;
}

export const code = (e: unknown) => (e as { code?: string } | null)?.code ?? "";

/** Share through Zend's share sheet; outside Zend, the browser's, else copy. */
export async function share(text: string, url: string): Promise<"shared" | "dismissed" | "copied" | "failed"> {
  if (inZend) {
    try {
      return (await zend.share({ text, url })).status;
    } catch (e) {
      if (code(e) !== "UNKNOWN_METHOD") return "failed";
    }
  }
  try {
    if (navigator.share) {
      await navigator.share({ text, url });
      return "shared";
    }
  } catch (e) {
    if ((e as Error).name === "AbortError") return "dismissed";
  }
  try {
    await navigator.clipboard.writeText(`${text}\n${url}`);
    return "copied";
  } catch {
    return "failed";
  }
}
