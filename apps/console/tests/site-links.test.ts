import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * A link in the footer is a route claim.
 *
 * The site shipped `/terms`, `/support` and `/contact` links from the landing footer while none of those
 * pages existed — three 404s on the front page, found by a directory that wanted all four legal URLs. No
 * check caught it because every route check looked at the hosted API's `app.ts`, and this is a console
 * page. This test resolves every literal internal `href` in the footer, the header and the legal pages
 * against the real route tree, and keeps the sitemap honest about the same paths.
 */
const CONSOLE = join(import.meta.dirname, "..");
const APP = join(CONSOLE, "src/app");
const PUBLIC = join(CONSOLE, "public");
const SITEMAP = readFileSync(join(PUBLIC, "sitemap.xml"), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/** Every path the App Router serves, from page.tsx and route.ts files. */
const routes = new Set<string>();
for (const file of walk(APP)) {
  const rel = file.slice(APP.length).replaceAll("\\", "/");
  if (rel.endsWith("/page.tsx")) routes.add(rel.slice(0, -"/page.tsx".length) || "/");
  else if (rel.endsWith("/route.ts")) routes.add(rel.slice(0, -"/route.ts".length) || "/");
}

/** Static assets served from `public/` — `/llms.txt` is a route, `/sitemap.xml` is a file. */
const assets = new Set(walk(PUBLIC).map((file) => file.slice(PUBLIC.length).replaceAll("\\", "/")));

function resolves(href: string): boolean {
  const path = href.split("#")[0] || "/";
  const clean = path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
  return routes.has(clean) || assets.has(clean);
}

const LEGAL = ["terms", "support", "contact"] as const;
const LINK_SOURCES = [
  join(APP, "page.tsx"),
  join(CONSOLE, "src/components/SiteHeader.tsx"),
  ...LEGAL.map((route) => join(APP, route, "page.tsx")),
];

describe("site links resolve", () => {
  it("every literal internal href in the footer, header and legal pages has a route or asset behind it", () => {
    const dead: string[] = [];
    for (const file of LINK_SOURCES) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/href="(\/[^"]*)"/g)) {
        if (!resolves(match[1])) dead.push(`${file.replace(`${CONSOLE}/`, "")} -> ${match[1]}`);
      }
    }
    expect(dead).toEqual([]);
  });

  it("the sitemap lists every legal route the footer links", () => {
    for (const route of ["privacy", ...LEGAL]) {
      expect(SITEMAP).toContain(`<loc>https://paystage.xyz/${route}</loc>`);
    }
  });

  it("each legal page links the other two and privacy", () => {
    for (const route of LEGAL) {
      const source = readFileSync(join(APP, route, "page.tsx"), "utf8");
      for (const target of ["privacy", ...LEGAL.filter((other) => other !== route)]) {
        expect(source).toContain(`href="/${target}"`);
      }
    }
  });
});
