/**
 * Preferences: the smallest thing a sign-in is allowed to be for (#173).
 *
 * Theme and language are local by default — no account, no network, no record. This module is the
 * optional half: one row per wallet, written only after a human signed a message, read only for the
 * device that presents that session. It has no idea what a payment is, and nothing in the tool, API or
 * receipt path may consult it.
 *
 * The merge rule is deliberately dumb and stated here rather than discovered later: **local wins when
 * local has a value, remote fills an empty device.** That is what makes the second-browser case work
 * (empty → remote applies) without inventing a clock comparison between two machines.
 */

export const THEMES = ["system", "light", "dark"] as const;
export const LANGUAGES = ["en", "zh"] as const;

export type PrefTheme = (typeof THEMES)[number];
export type PrefLanguage = (typeof LANGUAGES)[number];

export interface Prefs {
  theme: PrefTheme;
  language: PrefLanguage;
}

export const DEFAULT_PREFS: Prefs = { theme: "system", language: "en" };

export function isTheme(value: unknown): value is PrefTheme {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value);
}

export function isLanguage(value: unknown): value is PrefLanguage {
  return typeof value === "string" && (LANGUAGES as readonly string[]).includes(value);
}

/** Validate a request body. Returns null rather than a coerced default: a bad body is a 400, not a guess. */
export function parsePrefs(input: unknown): Prefs | null {
  if (input === null || typeof input !== "object") return null;
  const { theme, language } = input as Record<string, unknown>;
  if (!isTheme(theme) || !isLanguage(language)) return null;
  return { theme, language };
}

/**
 * Which preference to actually render, given what this device has and what the wallet remembers.
 *
 * `local` is what the browser found in localStorage (null when nothing was ever chosen here). A local
 * choice is never overwritten by the server — a person who set light mode on this laptop did not ask to be
 * flipped back by a row from six weeks ago.
 */
export function resolvePrefs(local: Partial<Prefs> | null, remote: Prefs | null): Prefs {
  const base = remote ?? DEFAULT_PREFS;
  return {
    theme: isTheme(local?.theme) ? local.theme : base.theme,
    language: isLanguage(local?.language) ? local.language : base.language,
  };
}

/** True when the device has nothing of its own, which is the case a sync exists to fill. */
export function isEmptyLocal(local: Partial<Prefs> | null): boolean {
  return !isTheme(local?.theme) && !isLanguage(local?.language);
}
