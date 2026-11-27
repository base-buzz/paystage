/**
 * `/directory.schema.json` — the JSON Schema for `/directory.json`.
 *
 * Written beside the data rather than in a README so an agent can validate before parsing. The `$schema` field inside
 * the payload points here. It describes the committed snapshot's shape, not a promise that every field is populated:
 * `x402scan` is `null` when the explorer has no match, which the page renders as `not known`.
 */
export const dynamic = "force-static";

const SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://paystage.xyz/directory.schema.json",
  title: "PayStage x402 merchant directory",
  description:
    "A dated census of x402 resources that answered a correct payment challenge. A listing is an observation, not a claim that anybody paid, and it is not an endorsement.",
  type: "object",
  required: ["schema", "verifiedOn", "firstVerifiedOn", "source", "ordering", "taxonomy", "counts", "rows"],
  properties: {
    schema: { const: "x402-merchant-directory/v1" },
    $schema: { type: "string" },
    generatedAt: { type: ["string", "null"], description: "When the source census was generated." },
    verifiedOn: { type: ["string", "null"], format: "date", description: "Last verified date in the rows." },
    firstVerifiedOn: { type: ["string", "null"], format: "date", description: "Earliest verified date in the rows." },
    source: {
      type: "object",
      required: ["census", "history", "demand"],
      properties: {
        census: {
          type: "object",
          required: ["name", "verifiedOn"],
          properties: {
            name: { type: "string" },
            verifiedOn: { type: ["string", "null"], format: "date" },
            generatedAt: { type: ["string", "null"] },
            method: { type: ["string", "null"] },
            predicate: { type: ["string", "null"] },
          },
        },
        history: {
          type: "array",
          items: {
            type: "object",
            required: ["name", "verifiedOn"],
            properties: { name: { type: "string" }, verifiedOn: { type: ["string", "null"], format: "date" } },
          },
        },
        demand: {
          oneOf: [
            { type: "null" },
            {
              type: "object",
              required: ["source", "url", "capturedOn", "level", "note"],
              properties: {
                source: { const: "x402scan" },
                url: { type: "string", format: "uri" },
                capturedOn: { type: "string", format: "date" },
                level: { const: "recipient" },
                note: { type: "string" },
              },
            },
          ],
        },
      },
    },
    ordering: {
      type: "object",
      required: ["by", "direction", "tieBreak", "reason"],
      properties: {
        by: { type: "string" },
        direction: { type: "string" },
        tieBreak: { type: "string" },
        reason: { type: "string" },
      },
    },
    taxonomy: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "label", "definition", "count"],
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          definition: { type: "string" },
          count: { type: "integer", minimum: 0 },
        },
      },
    },
    counts: {
      type: "object",
      required: ["resources", "hosts", "censusRows", "notAnswered", "byCategory", "withDemand", "withoutDemand"],
      properties: {
        resources: { type: "integer", minimum: 0 },
        hosts: { type: "integer", minimum: 0 },
        censusRows: { type: "integer", minimum: 0 },
        notAnswered: { type: "integer", minimum: 0 },
        byCategory: { type: "object", additionalProperties: { type: "integer", minimum: 0 } },
        withDemand: { type: "integer", minimum: 0 },
        withoutDemand: { type: "integer", minimum: 0 },
      },
    },
    rows: {
      type: "array",
      items: {
        type: "object",
        required: [
          "host",
          "resource",
          "category",
          "priceUsd",
          "priceUnit",
          "method",
          "chain",
          "chains",
          "challengeBytes",
          "firstVerifiedOn",
          "lastVerifiedOn",
          "verifiedSource",
          "payTo",
          "x402scan",
        ],
        properties: {
          host: { type: "string" },
          resource: { type: "string", format: "uri" },
          category: { type: "string" },
          categoryBasis: { enum: ["path", "listing-description", "default"] },
          priceUsd: { type: "number", minimum: 0 },
          priceUnit: { const: "request" },
          method: { type: "string" },
          chain: { type: "string" },
          chains: { type: "array", items: { type: "string" } },
          challengeBytes: { type: "integer", minimum: 1 },
          firstVerifiedOn: { type: "string", format: "date" },
          lastVerifiedOn: { type: "string", format: "date" },
          verifiedSource: { type: "string" },
          payTo: { type: "string" },
          x402scan: {
            oneOf: [
              { type: "null" },
              {
                type: "object",
                required: ["recipient", "url", "payments", "valueUsd", "source", "capturedOn"],
                properties: {
                  recipient: { type: "string" },
                  url: { type: "string", format: "uri" },
                  payments: { type: "integer", minimum: 1 },
                  valueUsd: { type: "number", minimum: 0 },
                  source: { const: "x402scan" },
                  capturedOn: { type: "string", format: "date" },
                },
              },
            ],
          },
        },
      },
    },
  },
} as const;

export function GET() {
  return new Response(JSON.stringify(SCHEMA, null, 2), {
    headers: {
      "content-type": "application/schema+json; charset=utf-8",
      "cache-control": "public, max-age=86_400",
      "access-control-allow-origin": "*",
    },
  });
}
