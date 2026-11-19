import { NextResponse } from "next/server";
import { BUILD_INFO } from "@/lib/build-info.generated";

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
  // Read from the generated module rather than process.env: the Worker runs without the environment that built it, and a null SHA
  // from CI was exactly that mistake.
  return NextResponse.json(BUILD_INFO);
}
