"""Contract and transport tests for the Python client.

No network is used unless a test is marked ``live``. The live contract test
compares the hosted MCP endpoint against the TypeScript evaluator itself through
``ts_evaluator.mjs``; the Python test never re-implements a policy rule.
"""

import io
import json
import re
import shutil
import subprocess
import sys
import urllib.error
from pathlib import Path

import pytest

# Run from a source checkout without `pip install -e .`.
PACKAGE_ROOT = Path(__file__).resolve().parents[1]
SRC = PACKAGE_ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from paystage import (  # noqa: E402
    DEFAULT_ENDPOINT,
    REVIEW_PACKET_SCHEMA,
    TOOL_EVALUATE_PAYMENT,
    VERDICTS,
    Evaluation,
    PayStageClient,
    PayStageError,
    PayStageProtocolError,
    PayStageToolError,
    PayStageTransportError,
)
from paystage.client import VERSION  # noqa: E402

# py/tests/test_client.py -> parents[0] is tests/, [1] is py/, [2] is the repository root. Off by one here reads
# /home/runner/work/paystage/paystage/... in CI and every path assertion fails with a FileNotFoundError that looks like a missing file.
REPO_ROOT = Path(__file__).resolve().parents[2]
PAYMENT = {
    "x402Version": 2,
    "accepts": [
        {
            "scheme": "exact",
            "network": "eip155:8453",
            "amount": "2000",
            "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
            "payTo": "0x1b2272A2Ca1792e8497A8d45Fd3eb8665AE88fAE",
            "maxTimeoutSeconds": 300,
        }
    ],
}
POLICY = {
    "version": 1,
    "max_amount": {"value": "0.05", "asset": "USDC", "decimals": 6},
    "allowed_assets": [
        {
            "symbol": "USDC",
            "decimals": 6,
            "address": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
            "network": "eip155:8453",
        }
    ],
    "allowed_networks": ["eip155:8453"],
    "allowed_pay_to": ["0x1b2272A2Ca1792e8497A8d45Fd3eb8665AE88fAE"],
    "max_timeout_seconds": 300,
    "unknown_payee": "deny",
}
PACKET = {
    "schema": REVIEW_PACKET_SCHEMA,
    "amount": {
        "value": "0.002",
        "symbol": "USDC",
        "atomic": "2000",
        "share": {"of": "max_amount", "denominator": "0.05", "ratio": "4%"},
    },
    "payee": {
        "address": "0x6160a0d8a3a1f8b0c4e2d1f7b3a9c6e5d4f23757",
        "network": "eip155:8453",
        "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        "symbol": "USDC",
    },
    "rule": "payee not in allowed_pay_to",
    "checked": ["policy"],
    "not_checked": ["seller reputation"],
    "decision": {"question": "Pay this payee?", "options": ["yes", "no"]},
}


# -- stubs -----------------------------------------------------------------


class StubResponse:
    def __init__(
        self, body="", status=200, content_type="text/event-stream"
    ):
        self._body = body.encode("utf-8")
        self.status = status
        self.headers = {"Content-Type": content_type}

    def read(self):
        return self._body

    def close(self):
        return None


class StubOpener:
    """A callable matching urllib.request.urlopen(req, timeout=...)."""

    def __init__(self, responses):
        self.responses = list(responses)
        self.requests = []

    def __call__(self, request, timeout=None):
        self.requests.append(request)
        if not self.responses:
            raise AssertionError("StubOpener ran out of responses")
        response = self.responses.pop(0)
        if isinstance(response, BaseException):
            raise response
        return response


def sse(payload):
    return "event: message\ndata: %s\n\n" % json.dumps(payload)


def rpc_result(request_id, result):
    return sse({"jsonrpc": "2.0", "id": request_id, "result": result})


def init_response():
    return rpc_result(
        1,
        {
            "protocolVersion": "2025-06-18",
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "paystage", "version": "test"},
        },
    )


def notification_response():
    return StubResponse("", status=202, content_type="text/plain")


def tool_response(request_id, payload):
    return rpc_result(
        request_id,
        {"content": [{"type": "text", "text": json.dumps(payload)}]},
    )


def request_payload(request):
    return json.loads(request.data.decode("utf-8"))


def request_headers(request):
    return {key.lower(): value for key, value in request.header_items()}


def http_error(status, body):
    return urllib.error.HTTPError(
        DEFAULT_ENDPOINT,
        status,
        "error",
        {"Content-Type": "application/json"},
        io.BytesIO(body.encode("utf-8")),
    )


# -- transport envelope ----------------------------------------------------


def test_initialize_then_tools_call_uses_jsonrpc_envelope():
    review = {
        "decision": "review",
        "packet": PACKET,
        "reasons": ["payee not in allowed_pay_to"],
        "summary": "Decision: review.",
    }
    opener = StubOpener(
        [
            StubResponse(init_response()),
            notification_response(),
            StubResponse(tool_response(2, review)),
        ]
    )
    client = PayStageClient(opener=opener, source="test")
    result = client.evaluate(PAYMENT, POLICY)

    assert len(opener.requests) == 3
    init, notify, call = (request_payload(r) for r in opener.requests)

    assert init["jsonrpc"] == "2.0"
    assert init["method"] == "initialize"
    assert init["id"] == 1
    assert init["params"]["protocolVersion"] == "2025-06-18"
    assert init["params"]["clientInfo"]["name"] == "paystage-python"
    assert init["params"]["clientInfo"]["version"] == VERSION

    assert notify == {"jsonrpc": "2.0", "method": "notifications/initialized"}

    assert call["jsonrpc"] == "2.0"
    assert call["method"] == "tools/call"
    assert call["id"] == 2
    assert call["params"]["name"] == TOOL_EVALUATE_PAYMENT
    assert call["params"]["arguments"]["payment_required"] == PAYMENT
    assert call["params"]["arguments"]["policy"] == POLICY

    headers = request_headers(opener.requests[2])
    assert "application/json" in headers["accept"]
    assert "text/event-stream" in headers["accept"]
    assert headers["content-type"] == "application/json"
    assert headers["x-paystage-source"] == "test"

    assert opener.requests[2].full_url == DEFAULT_ENDPOINT
    assert result.decision == "review"
    assert result.is_review
    assert result.packet == PACKET
    # The exact object, not a copy: callers can compare it with the tool payload.
    assert result.packet is result.result["packet"]
    assert result.reasons == ("payee not in allowed_pay_to",)


def test_pay_result_has_no_packet():
    payload = {
        "decision": "pay",
        "reasons": [],
        "summary": "Decision: pay.",
    }
    opener = StubOpener(
        [
            StubResponse(init_response()),
            notification_response(),
            StubResponse(tool_response(2, payload)),
        ]
    )
    result = PayStageClient(opener=opener).evaluate(PAYMENT, POLICY)
    assert result.decision == "pay"
    assert result.packet is None
    assert not result.is_review
    assert result["decision"] == "pay"


def test_client_initializes_only_once():
    opener = StubOpener(
        [
            StubResponse(init_response()),
            notification_response(),
            StubResponse(tool_response(2, {"decision": "do_not_pay"})),
            StubResponse(tool_response(3, {"decision": "pay"})),
        ]
    )
    client = PayStageClient(opener=opener)
    client.evaluate(PAYMENT, POLICY)
    client.evaluate(PAYMENT, POLICY)
    methods = [request_payload(r)["method"] for r in opener.requests]
    assert methods == [
        "initialize",
        "notifications/initialized",
        "tools/call",
        "tools/call",
    ]


def test_json_rpc_error_is_raised():
    opener = StubOpener(
        [
            StubResponse(
                sse(
                    {
                        "jsonrpc": "2.0",
                        "id": 1,
                        "error": {"code": -32601, "message": "Method not found"},
                    }
                )
            )
        ]
    )
    with pytest.raises(PayStageError) as exc:
        PayStageClient(opener=opener).initialize()
    assert exc.value.code == -32601
    assert "Method not found" in str(exc.value)


def test_http_error_is_raised_as_transport_error():
    opener = StubOpener(
        [http_error(400, '{"error": {"message": "policy is required"}}')]
    )
    with pytest.raises(PayStageTransportError) as exc:
        PayStageClient(opener=opener).initialize()
    assert exc.value.status == 400
    assert "policy is required" in str(exc.value)


def test_tool_error_is_raised():
    opener = StubOpener(
        [
            StubResponse(init_response()),
            notification_response(),
            StubResponse(
                rpc_result(
                    2,
                    {
                        "isError": True,
                        "content": [
                            {
                                "type": "text",
                                "text": "Error: policy is required on the hosted endpoint",
                            }
                        ],
                    },
                )
            ),
        ]
    )
    with pytest.raises(PayStageToolError) as exc:
        PayStageClient(opener=opener).evaluate(PAYMENT, POLICY)
    assert "policy is required" in str(exc.value)


def test_unexpected_decision_is_a_protocol_error():
    opener = StubOpener(
        [
            StubResponse(init_response()),
            notification_response(),
            StubResponse(tool_response(2, {"decision": "maybe"})),
        ]
    )
    with pytest.raises(PayStageProtocolError):
        PayStageClient(opener=opener).evaluate(PAYMENT, POLICY)


def test_json_body_is_accepted_as_well_as_sse():
    review = {"decision": "review", "packet": PACKET, "reasons": []}
    opener = StubOpener(
        [
            StubResponse(
                json.dumps(
                    {
                        "jsonrpc": "2.0",
                        "id": 1,
                        "result": {"protocolVersion": "2025-06-18"},
                    }
                ),
                content_type="application/json",
            ),
            notification_response(),
            StubResponse(
                json.dumps(
                    {
                        "jsonrpc": "2.0",
                        "id": 2,
                        "result": {
                            "content": [
                                {"type": "text", "text": json.dumps(review)}
                            ]
                        },
                    }
                ),
                content_type="application/json",
            ),
        ]
    )
    result = PayStageClient(opener=opener).evaluate(PAYMENT, POLICY)
    assert result.packet == PACKET


# -- contract against the TypeScript source --------------------------------


def test_verdict_vocabulary_matches_typescript_decision_union():
    source = (REPO_ROOT / "packages/preflight/src/evaluate.ts").read_text(
        encoding="utf-8"
    )
    block = re.search(r"export type Decision = ([^;]+);", source)
    assert block is not None, "could not find the TypeScript Decision union"
    ts_verdicts = tuple(re.findall(r'"([a-z_]+)"', block.group(1)))
    assert ts_verdicts == VERDICTS


def test_review_packet_schema_matches_typescript():
    source = (REPO_ROOT / "packages/preflight/src/evaluate.ts").read_text(
        encoding="utf-8"
    )
    assert 'schema: "paystage.review-packet.v1";' in source
    assert REVIEW_PACKET_SCHEMA == "paystage.review-packet.v1"


def test_evaluate_tool_name_is_registered_by_typescript_server():
    source = (REPO_ROOT / "packages/mcp/src/tools.ts").read_text(encoding="utf-8")
    assert re.search(r'registerTool\(\s*"%s"' % TOOL_EVALUATE_PAYMENT, source)
    assert TOOL_EVALUATE_PAYMENT in source


def test_pyproject_declares_hosted_url_version_and_no_dependencies():
    text = (PACKAGE_ROOT / "pyproject.toml").read_text(encoding="utf-8")
    assert re.search(r'^name = "paystage"$', text, re.MULTILINE)
    assert re.search(r'^version = "%s"$' % re.escape(VERSION), text, re.MULTILINE)
    assert re.search(r'^requires-python = ">=3\.9"$', text, re.MULTILINE)
    assert re.search(r"^dependencies = \[\]$", text, re.MULTILINE)
    assert 'Homepage = "https://api.paystage.xyz/mcp"' in text
    assert 'PayStage = "https://api.paystage.xyz/mcp"' in text


def test_client_uses_only_stdlib_http():
    source = (PACKAGE_ROOT / "src/paystage/client.py").read_text(encoding="utf-8")
    assert "urllib.request" in source
    assert "import requests" not in source
    assert "import httpx" not in source


# -- live contract ---------------------------------------------------------


def _load_cases():
    strict = json.loads(
        (REPO_ROOT / "examples/policies/strict.json").read_text(encoding="utf-8")
    )
    review_policy = dict(strict)
    review_policy["unknown_payee"] = "review"

    def challenge(name):
        return json.loads(
            (REPO_ROOT / "examples/challenges" / name).read_text(encoding="utf-8")
        )

    return [
        {
            "name": "over-cap",
            "payment_required": challenge("over-cap.json"),
            "policy": strict,
        },
        {
            "name": "unknown-payee-deny",
            "payment_required": challenge("unknown-payee.json"),
            "policy": strict,
        },
        {
            "name": "known-drainer",
            "payment_required": challenge("drainer.json"),
            "policy": strict,
        },
        {
            "name": "non-receivable",
            "payment_required": challenge("non-receivable.json"),
            "policy": strict,
        },
        {
            "name": "unknown-payee-review",
            "payment_required": challenge("unknown-payee.json"),
            "policy": review_policy,
        },
    ]


def _typescript_verdicts(cases):
    node = shutil.which("node")
    evaluator = REPO_ROOT / "packages/preflight/dist/evaluate.js"
    if node is None or not evaluator.exists():
        pytest.skip(
            "live contract needs node and a built @paystage/preflight dist/ "
            "(run `npm run build -w @paystage/preflight`)"
        )
    script = Path(__file__).with_name("ts_evaluator.mjs")
    process = subprocess.run(
        [node, str(script)],
        input=json.dumps(cases),
        text=True,
        capture_output=True,
        timeout=60,
    )
    if process.returncode != 0:
        pytest.fail(
            "ts_evaluator.mjs failed: %s" % (process.stderr.strip()[:500],)
        )
    return json.loads(process.stdout)


@pytest.mark.live
def test_live_verdict_and_packet_match_the_typescript_evaluator():
    """The contract: same input, same verdict and same review packet.

    The expected verdicts come from the TypeScript evaluator itself, run through
    a tiny Node bridge. Nothing here re-implements a rule.
    """
    cases = _load_cases()
    expected = _typescript_verdicts(cases)
    client = PayStageClient(source="test")
    for case, want in zip(cases, expected):
        got = client.evaluate(case["payment_required"], case["policy"])
        assert got.decision == want["decision"], case["name"]
        assert list(got.reasons) == want["reasons"], case["name"]
        if want["decision"] == "review":
            assert got.packet == want["packet"], case["name"]
            assert got.packet["schema"] == REVIEW_PACKET_SCHEMA
        else:
            assert got.packet is None, case["name"]
