/**
 * The shared pass tokens, imported from `apps/console/src/lib/pass-tokens.json`.
 *
 * Not copied: the console, the SVG renderer and this app all read one file, so a palette
 * or geometry change moves every surface together. The JSON is the contract; this module
 * only names it for TypeScript.
 */
import tokens from "../../../console/src/lib/pass-tokens.json";
import type { CSSProperties } from "react";

export const palette = tokens.palette;
export const posterTints = tokens.posterTints;
export const typeScale = tokens.type;
export const geometry = tokens.geometry;
export const spacing = tokens.spacing;
export const passState = tokens.state;

/** Expose the JSON as CSS custom properties, so Tailwind's @theme can reference them. */
export function tokenStyle(): CSSProperties {
  const style: Record<string, string> = {
    "--vg-ink": palette.ink,
    "--vg-paper": palette.paper,
    "--vg-deep": palette.deep,
    "--vg-gold": palette.gold,
    "--vg-muted": palette.muted,
    "--vg-red": palette.red,
    "--vg-dead-plate": passState.deadPlate,
  };
  posterTints.forEach((tint, index) => {
    style[`--vg-tint-${index + 1}`] = tint;
  });
  return style as CSSProperties;
}
