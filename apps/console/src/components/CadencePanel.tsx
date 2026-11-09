/**
 * Cadence panel — the human view of the numbers in `@/lib/cadence`.
 *
 * Everything it renders comes from the shared loader, so the panel and
 * `/v1/public/cadence.json` cannot disagree.
 */
import { getCadence, REPO, WEEKS } from "@/lib/cadence";

export async function CadencePanel() {
  const data = await getCadence();
  const max = Math.max(1, ...data.weeks.map((w) => w.count));

  return (
    <section className="lp-section lp-section-alt" aria-label="Cadence">
      <div className="lp-wrap">
        <div className="lp-section-head">
          <h2 className="lp-h2">Cadence</h2>
          <p className="lp-h2-note">
            Releases and automated checks, read from the repository and CI. Not a
            badge — the actual history.
          </p>
        </div>

        <div className="lp-cadence">
          <div className="lp-cadence-block">
            <div className="lp-cadence-head">
              <span>Releases · last {WEEKS} weeks</span>
              <span className="lp-cadence-strong">
                {data.releasesTotal === 0 ? "—" : `${data.releasesTotal} shipped`}
              </span>
            </div>
            <div className="lp-bars" role="img" aria-label={`${data.releasesTotal} releases in the last ${WEEKS} weeks`}>
              {data.weeks.map((week) => (
                <div className="lp-bar-col" key={week.label}>
                  <div
                    className="lp-bar"
                    style={{ height: `${Math.max(3, Math.round((week.count / max) * 46))}px` }}
                    data-count={week.count}
                    title={`week of ${week.label}: ${week.count} release${week.count === 1 ? "" : "s"}`}
                  />
                </div>
              ))}
            </div>
            <div className="lp-cadence-foot">
              {data.weeks[0]?.label} → today · {data.version ? `mcp v${data.version}` : "version unknown"}
            </div>
          </div>

          <div className="lp-cadence-block">
            <div className="lp-cadence-head">
              <span>Automated checks · recent runs</span>
              <span className="lp-cadence-strong">
                {!data.checksAvailable
                  ? "history unavailable"
                  : data.checks.length === 0
                    ? "no runs yet"
                    : `${data.checks.filter((c) => c.ok).length}/${data.checks.length} passing`}
              </span>
            </div>
            <div className="lp-runs">
              {!data.checksAvailable && (
                <span className="lp-cadence-foot">
                  GitHub API rate-limited — check history not readable right now.{" "}
                </span>
              )}
              {data.checksAvailable && data.checks.length === 0 && (
                <span className="lp-cadence-foot">No runs recorded yet.</span>
              )}
              {data.checks.map((check) => (
                <span
                  key={check.at}
                  className={check.ok ? "lp-run lp-run-ok" : "lp-run lp-run-fail"}
                  title={`${check.at}: ${check.ok ? "passed" : "failed"}`}
                />
              ))}
            </div>
            <div className="lp-cadence-foot">
              Conformance and dependency audit, daily.{" "}
              <a href={`https://github.com/${REPO}/actions/workflows/cadence.yml`} rel="noopener">
                See the runs
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
