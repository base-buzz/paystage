/**
 * `GET /runs/:id` — the record of one decision (#308).
 *
 * A bundle is content-addressed: the id is the SHA-256 of the canonical inputs, so the
 * same decision always has the same name. The route is public and read-only, mounted
 * before the payment middleware for the same reason `/v1/public/status` is: an auditor
 * checking a past verdict is not making a new payment.
 *
 * Fail-closed rules:
 *  - no store configured  -> 503 storage_not_configured (never an empty 200);
 *  - store throws         -> 503 storage_unavailable;
 *  - id not found         -> 404 run_not_found, which says the id is unknown;
 *  - no `format`          -> one markdown document containing all four artefacts;
 *  - `?format=json`       -> the four artefacts as structured JSON.
 */

import { Hono } from "hono";
import { PROBLEMS } from "../problem.js";
import { BUNDLE_ID_RE, type StoredBundle, type BundleStore } from "../bundle-store.js";

const JSON_FORMAT = "json";

function fence(language: string, body: string): string {
  return `\`\`\`${language}\n${body.replace(/\s+$/, "")}\n\`\`\``;
}

function markdownBundle(row: StoredBundle): string {
  return [
    `# Evidence bundle ${row.id}`,
    "",
    `- decision: **${row.decision}**`,
    ...(row.created_at !== undefined ? [`- stored at: ${row.created_at}`] : []),
    "",
    "## events.jsonl",
    "",
    fence("jsonl", row.events),
    "",
    "## proof",
    "",
    fence("json", row.proof),
    "",
    "## receipt",
    "",
    row.receipt === null ? "No receipt was produced for this evaluation." : fence("json", row.receipt),
    "",
    "## summary.md",
    "",
    row.summary,
    "",
    "---",
    "",
    "Verify this bundle's verdict from `proof` alone:",
    "",
    "```sh",
    `curl -s "https://api.paystage.xyz/runs/${row.id}?format=proof" -o proof.json`,
    "npx -y -p @paystage/preflight paystage-verify-bundle proof.json",
    "```",
    "",
  ].join("\n");
}

/** Parse a stored artefact that is supposed to be JSON; malformed storage is an outage, not a 200. */
function parseStoredJson(value: string): unknown {
  return JSON.parse(value) as unknown;
}

export function createRunsRoutes(store: BundleStore | undefined): Hono {
  const routes = new Hono();

  routes.get("/runs/:id", async (c) => {
    if (store === undefined) {
      return c.json(PROBLEMS.storageNotConfigured(), 503);
    }

    const id = c.req.param("id");
    if (!BUNDLE_ID_RE.test(id)) {
      return c.json(PROBLEMS.unknownRun(id), 404);
    }

    let row: StoredBundle | null;
    try {
      row = await store.get(id);
    } catch (error) {
      console.log(
        JSON.stringify({
          level: "error",
          msg: "evidence_bundle_read_failed",
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      return c.json(PROBLEMS.storageUnavailable(), 503);
    }
    if (row === null) {
      return c.json(PROBLEMS.unknownRun(id), 404);
    }

    const format = c.req.query("format");
    const cacheHeaders = { "cache-control": "no-store", "x-paystage-bundle-id": row.id };

    if (format === undefined || format === "markdown") {
      return c.body(markdownBundle(row), 200, {
        ...cacheHeaders,
        "content-type": "text/markdown; charset=utf-8",
      });
    }

    if (format === "events") {
      return c.body(row.events, 200, {
        ...cacheHeaders,
        "content-type": "application/x-ndjson; charset=utf-8",
      });
    }

    if (format === "proof") {
      return c.body(row.proof, 200, {
        ...cacheHeaders,
        "content-type": "application/json; charset=utf-8",
      });
    }

    if (format === "summary") {
      return c.body(row.summary, 200, {
        ...cacheHeaders,
        "content-type": "text/markdown; charset=utf-8",
      });
    }

    if (format === "receipt") {
      if (row.receipt === null) {
        return c.json(PROBLEMS.receiptNotIssued(id), 404);
      }
      return c.body(row.receipt, 200, {
        ...cacheHeaders,
        "content-type": "application/json; charset=utf-8",
      });
    }

    if (format === JSON_FORMAT) {
      try {
        return c.json(
          {
            schema: "paystage.evidence-bundle.v1",
            bundle_id: row.id,
            decision: row.decision,
            ...(row.created_at !== undefined ? { created_at: row.created_at } : {}),
            artefacts: {
              "events.jsonl": row.events,
              proof: parseStoredJson(row.proof),
              receipt: row.receipt === null ? null : parseStoredJson(row.receipt),
              "summary.md": row.summary,
            },
          },
          200,
          cacheHeaders,
        );
      } catch (error) {
        console.log(
          JSON.stringify({
            level: "error",
            msg: "evidence_bundle_corrupt",
            error: error instanceof Error ? error.message : String(error),
          }),
        );
        return c.json(PROBLEMS.storageUnavailable(), 503);
      }
    }

    return c.json(PROBLEMS.unknownFormat(format), 400);
  });

  return routes;
}
