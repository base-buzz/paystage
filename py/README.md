pip install paystage

# paystage (Python)

A thin Python client for the hosted PayStage MCP endpoint at
`https://api.paystage.xyz/mcp`.

This package is a transport. It speaks JSON-RPC 2.0 to the hosted endpoint over
HTTPS, sends your `payment_required` challenge and your policy inline, and returns
the verdict the hosted tool produced. The evaluator is TypeScript — the same
`@paystage/mcp` tools served by the Worker and over stdio. There is no policy
engine, no fallback verdict, no signing code and no key in this package. If the
endpoint is unreachable, the client raises; it never guesses a verdict locally.

The verdict strings are the same eight named across the MCP tool descriptions —
`pay`, `review`, `do_not_pay`, `allow`, `do_not_trade`, `VALID`, `INVALID`,
`UNVERIFIABLE` — and this client does not re-spell them. The one tool this
transport calls, `evaluate_mcp_payment`, returns the first three. A `review`
result carries the same `packet` object the TypeScript tool builds; `pay` and
`do_not_pay` do not.

## Use

```python
from paystage import PayStageClient

with PayStageClient() as client:
    result = client.evaluate(payment_required=challenge, policy=policy)
    print(result.decision)  # "pay" | "review" | "do_not_pay"
    if result.is_review:
        print(result.packet["decision"]["question"])
```

One-shot form:

```python
from paystage import evaluate

result = evaluate(challenge, policy)
```

`result` is an `Evaluation` with:

| Attribute | Meaning |
|---|---|
| `decision` | the evaluator's verdict string, unchanged |
| `packet` | the review-packet object on `review`, otherwise `None` |
| `reasons` | the evaluator's reason strings, in order |
| `summary` | the evaluator's one-line summary |
| `result` | the complete payload, including hosted-only fields such as `seller_reputation` |

`result["decision"]` also works, because `Evaluation` indexes into `result`.

`agent_id` and `payment_identifier` can be passed to `evaluate()`. They are
forwarded as the tool arguments of the same names. `PayStageClient.source` sets
the `X-PayStage-Source` header for labelled test traffic; leave it unset for
real calls.

`PayStageClient.call_tool(name, arguments)` is the raw escape hatch for the
other read-only MCP tools. It returns the unmodified `tools/call` result.

## Contract with the TypeScript evaluator

The tests do not contain a second evaluator:

- non-live tests prove the JSON-RPC envelope, the SSE parsing, error handling,
  and that `review` surfaces `packet`. They also read the TypeScript `Decision`
  union and review-packet schema from source and assert this package's constants
  match.
- `pytest -m live` runs the same inputs through the hosted endpoint and through
  the real TypeScript evaluator (`tests/ts_evaluator.mjs` imports the built
  `@paystage/preflight`), then compares `decision`, `reasons` and the `packet`.
  It is skipped when `node` or `packages/preflight/dist` is absent.

```sh
pytest                 # stubbed, no network
pytest -m live         # hosted endpoint + TypeScript evaluator
```

The live test sends `X-PayStage-Source: test`.

## Requirements and licence

Python 3.9 or newer. No runtime dependencies: `urllib.request` only. MIT.
