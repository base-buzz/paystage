import { NextResponse } from "next/server";

export const dynamic = "force-static";

/**
 * What commit is actually serving this page?
 *
 * The deploy pipeline can be green on a commit that never left the machine — that happened on 2026-11-19: a heredoc swallowed
 * `git push`, CI and the deploy ran on the previous commit, and the site was reported live while missing the change. Nothing in
 * the smoke test could tell, because every path answered 200 from the older build.
 *
 * The SHA is baked in at build time from the environment CI sets. Absent means the build did not come from CI, which is itself
 * worth knowing rather than hiding.
 */
export async function GET() {
  const sha = process.env.PAYSTAGE_BUILD_SHA ?? process.env.GITHUB_SHA ?? null;
  return NextResponse.json({
    sha,
    // `CI` is set by GitHub Actions; it is a better provenance signal than the SHA alone being present.
    source: process.env.CI === "true" || process.env.CI === "1" ? "ci" : "local",
    built_at: process.env.PAYSTAGE_BUILD_AT ?? null,
  });
}
