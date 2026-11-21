import { decodeLook, DEFAULT_LOOK, encodeLook, type Look } from "@owambe/engine";

/**
 * The player's outfit. Kept on this phone for now; it moves to the game server (keyed by Zend
 * user) when online rounds show outfits.
 */
const KEY = "owambe.look";

export function myLook(): Look {
  try {
    return decodeLook(localStorage.getItem(KEY)) ?? DEFAULT_LOOK;
  } catch {
    return DEFAULT_LOOK;
  }
}

export function hasDressed(): boolean {
  try {
    return decodeLook(localStorage.getItem(KEY)) !== null;
  } catch {
    return false;
  }
}

export function saveLook(l: Look): void {
  try {
    localStorage.setItem(KEY, encodeLook(l));
  } catch {
    // Private mode: the outfit lasts this visit only.
  }
}

export const myLookCode = () => encodeLook(myLook());
