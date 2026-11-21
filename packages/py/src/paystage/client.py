"""JSON-RPC transport to the hosted PayStage MCP endpoint.

This module deliberately contains no payment policy, no signing, and no keys. The
evaluator is the TypeScript package served by the hosted Worker; this client only
speaks the MCP protocol to it and returns the evaluator's own JSON payload.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Callable, Dict, Optional, Sequence, Tuple

DEFAULT_ENDPOINT = "https://api.paystage.xyz/mcp"
TOOL_EVALUATE_PAYMENT = "evaluate_mcp_payment"
PROTOCOL_VERSION = "2025-06-18"
CLIENT_NAME = "paystage-python"
VERSION = "0.1.0"

#: The payment verdicts the hosted evaluator returns. Kept identical to the
#: TypeScript `Decision` union; tests read that union from source.
VERDICTS: Tuple[str, str, str] = ("pay", "review", "do_not_pay")
REVIEW_PACKET_SCHEMA = "paystage.review-packet.v1"


class PayStageError(Exception):
    """Base error for transport, protocol, and tool failures."""

    def __init__(
        self,
        message: str,
        *,
        status: Optional[int] = None,
        code: Optional[int] = None,
        body: Optional[str] = None,
    ) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.body = body


class PayStageTransportError(PayStageError):
    """The endpoint could not be reached, or answered with a non-2xx status."""


class PayStageProtocolError(PayStageError):
    """The endpoint answered, but not with the JSON-RPC or tool shape we expect."""


class PayStageToolError(PayStageError):
    """The MCP tool returned ``isError: true`` (for example, a missing policy)."""


@dataclass(frozen=True)
class Evaluation:
    """The evaluator's verdict plus the payload it came in.

    ``packet`` is the same object the TypeScript tool puts on a ``review``
    result. It is ``None`` for ``pay`` and ``do_not_pay``. ``result`` is the
    complete evaluator payload, so fields added by the hosted endpoint (for
    example ``seller_reputation``) are not discarded by this transport.
    """

    decision: str
    packet: Optional[Dict[str, Any]]
    reasons: Tuple[str, ...]
    summary: str
    result: Dict[str, Any]

    @property
    def is_review(self) -> bool:
        return self.decision == "review"

    def to_dict(self) -> Dict[str, Any]:
        """Return the complete evaluator payload as a dict."""
        return dict(self.result)

    def __getitem__(self, key: str) -> Any:
        return self.result[key]


class PayStageClient:
    """A small JSON-RPC 2.0 client for ``https://api.paystage.xyz/mcp``.

    The client initializes one MCP session per instance, then calls
    ``evaluate_mcp_payment``. It uses only :mod:`urllib.request`, so installing
    ``paystage`` adds no runtime dependency.
    """

    def __init__(
        self,
        endpoint: str = DEFAULT_ENDPOINT,
        *,
        timeout: float = 30.0,
        opener: Optional[Callable[..., Any]] = None,
        source: Optional[str] = None,
        client_version: str = VERSION,
    ) -> None:
        if not endpoint:
            raise ValueError("endpoint must not be empty")
        if timeout <= 0:
            raise ValueError("timeout must be positive")
        self.endpoint = endpoint
        self.timeout = timeout
        self.source = source
        self.client_version = client_version
        self._opener = opener if opener is not None else urllib.request.urlopen
        self._initialized = False
        self._server_info: Optional[Dict[str, Any]] = None
        self._next_id = 0

    # -- public surface ----------------------------------------------------

    def initialize(self) -> Dict[str, Any]:
        """Perform the MCP ``initialize`` handshake once and return server info."""
        if self._initialized:
            return dict(self._server_info or {})
        result = self._request(
            "initialize",
            {
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {},
                "clientInfo": {"name": CLIENT_NAME, "version": self.client_version},
            },
        )
        self._notify("notifications/initialized")
        if not isinstance(result, dict):
            raise PayStageProtocolError("initialize returned a non-object result")
        self._server_info = result
        self._initialized = True
        return dict(result)

    def evaluate(
        self,
        payment_required: Any,
        policy: Any,
        *,
        agent_id: Optional[str] = None,
        payment_identifier: Optional[str] = None,
    ) -> Evaluation:
        """Evaluate one x402 payment against one policy on the hosted endpoint.

        ``policy`` is sent inline, exactly as the hosted MCP tool requires; this
        package never reads a policy file. A ``review`` result exposes the same
        ``packet`` object the TypeScript tool built.
        """
        arguments: Dict[str, Any] = {
            "payment_required": payment_required,
            "policy": policy,
        }
        if agent_id is not None:
            arguments["agent_id"] = agent_id
        if payment_identifier is not None:
            arguments["payment_identifier"] = payment_identifier

        result = self.call_tool(TOOL_EVALUATE_PAYMENT, arguments)
        payload = self._tool_payload(result)
        decision = payload.get("decision")
        if decision not in VERDICTS:
            raise PayStageProtocolError(
                "unexpected decision %r; expected one of %s"
                % (decision, ", ".join(VERDICTS))
            )
        packet = payload.get("packet")
        if packet is not None and not isinstance(packet, dict):
            raise PayStageProtocolError("packet must be an object when present")
        reasons = payload.get("reasons") or ()
        if not isinstance(reasons, (list, tuple)):
            raise PayStageProtocolError("reasons must be a list when present")
        return Evaluation(
            decision=decision,
            packet=packet,
            reasons=tuple(str(reason) for reason in reasons),
            summary=str(payload.get("summary") or ""),
            result=payload,
        )

    # The tool name is the public verb; keep it as an alias so callers who
    # arrive from the MCP docs do not have to translate it.
    evaluate_mcp_payment = evaluate

    def call_tool(
        self, name: str, arguments: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Call any hosted MCP tool and return its raw ``tools/call`` result.

        This is the escape hatch for the other read-only tools. It does not
        parse or translate their payloads.
        """
        self.initialize()
        result = self._request(
            "tools/call", {"name": name, "arguments": arguments or {}}
        )
        if not isinstance(result, dict):
            raise PayStageProtocolError("tools/call returned a non-object result")
        if result.get("isError"):
            text = _content_text(result) or "tool returned isError"
            raise PayStageToolError(text)
        return result

    def close(self) -> None:
        """No persistent connection is held; provided for context-manager use."""
        return None

    def __enter__(self) -> "PayStageClient":
        return self

    def __exit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
        self.close()

    # -- JSON-RPC and HTTP -------------------------------------------------

    def _headers(self) -> Dict[str, str]:
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            "User-Agent": "%s/%s" % (CLIENT_NAME, self.client_version),
        }
        if self.source:
            headers["X-PayStage-Source"] = self.source
        return headers

    def _request(self, method: str, params: Optional[Dict[str, Any]] = None) -> Any:
        self._next_id += 1
        payload: Dict[str, Any] = {
            "jsonrpc": "2.0",
            "id": self._next_id,
            "method": method,
        }
        if params is not None:
            payload["params"] = params
        return self._post(payload)

    def _notify(self, method: str) -> None:
        self._post({"jsonrpc": "2.0", "method": method}, notification=True)

    def _post(self, payload: Dict[str, Any], *, notification: bool = False) -> Any:
        data = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        request = urllib.request.Request(
            self.endpoint, data=data, headers=self._headers(), method="POST"
        )
        try:
            response = self._opener(request, timeout=self.timeout)
        except urllib.error.HTTPError as exc:
            body = _read_error_body(exc)
            message = _rpc_error_message(body) or "HTTP %s from %s" % (
                exc.code,
                self.endpoint,
            )
            raise PayStageTransportError(
                message, status=exc.code, body=body
            ) from exc
        except urllib.error.URLError as exc:
            raise PayStageTransportError(
                "could not reach %s: %s" % (self.endpoint, exc.reason)
            ) from exc
        except OSError as exc:
            raise PayStageTransportError(
                "could not reach %s: %s" % (self.endpoint, exc)
            ) from exc

        try:
            status = getattr(response, "status", None)
            if status is None:
                status = getattr(response, "code", None)
            headers = getattr(response, "headers", None)
            content_type = ""
            if headers is not None and hasattr(headers, "get"):
                content_type = headers.get("Content-Type") or headers.get(
                    "content-type"
                ) or ""
            raw = response.read()
        finally:
            close = getattr(response, "close", None)
            if close is not None:
                close()

        text = raw.decode("utf-8", "replace")
        if notification:
            if status is not None and not 200 <= int(status) < 300:
                raise PayStageTransportError(
                    "notification %s answered HTTP %s"
                    % (payload.get("method"), status),
                    status=int(status),
                    body=text,
                )
            return None

        if status is not None and not 200 <= int(status) < 300:
            message = _rpc_error_message(text) or "HTTP %s from %s" % (
                status,
                self.endpoint,
            )
            raise PayStageTransportError(
                message, status=int(status), body=text
            )

        envelope = _parse_envelope(text, content_type, payload.get("id"))
        if not isinstance(envelope, dict):
            raise PayStageProtocolError("JSON-RPC response is not an object")
        if "error" in envelope:
            error = envelope.get("error")
            if isinstance(error, dict):
                message = str(error.get("message") or "JSON-RPC error")
                code = error.get("code")
                if isinstance(code, int):
                    raise PayStageError(message, code=code, body=text)
                raise PayStageError(message, body=text)
            raise PayStageError("JSON-RPC error: %s" % (error,), body=text)
        if "result" not in envelope:
            raise PayStageProtocolError("JSON-RPC response has neither result nor error")
        return envelope["result"]

    @staticmethod
    def _tool_payload(result: Dict[str, Any]) -> Dict[str, Any]:
        # The TypeScript tools put their evaluator payload in a text content
        # block. Prefer it, and fall back to structuredContent for an MCP host
        # that adds one; either way the bytes come from the tool.
        text = _content_text(result)
        if text:
            try:
                payload = json.loads(text)
            except ValueError:
                payload = None
            if isinstance(payload, dict):
                return payload
        structured = result.get("structuredContent")
        if isinstance(structured, dict):
            return structured
        if not text:
            raise PayStageProtocolError("tools/call returned no text content")
        raise PayStageProtocolError(
            "tools/call content is not a JSON object: %s" % (text[:200],)
        )


def evaluate(
    payment_required: Any,
    policy: Any,
    *,
    endpoint: str = DEFAULT_ENDPOINT,
    timeout: float = 30.0,
    opener: Optional[Callable[..., Any]] = None,
    agent_id: Optional[str] = None,
    payment_identifier: Optional[str] = None,
    source: Optional[str] = None,
) -> Evaluation:
    """One-shot convenience wrapper around :class:`PayStageClient`."""
    with PayStageClient(
        endpoint=endpoint,
        timeout=timeout,
        opener=opener,
        source=source,
    ) as client:
        return client.evaluate(
            payment_required,
            policy,
            agent_id=agent_id,
            payment_identifier=payment_identifier,
        )


# -- response parsing ------------------------------------------------------


def _read_error_body(exc: urllib.error.HTTPError) -> str:
    try:
        raw = exc.read()
    except Exception:  # pragma: no cover - a broken error body is not the error
        return ""
    if isinstance(raw, bytes):
        return raw.decode("utf-8", "replace")
    return str(raw)


def _rpc_error_message(text: str) -> Optional[str]:
    if not text:
        return None
    try:
        payload = json.loads(text)
    except ValueError:
        return None
    if not isinstance(payload, dict):
        return None
    error = payload.get("error")
    if isinstance(error, dict) and error.get("message"):
        return str(error["message"])
    return None


def _content_text(result: Dict[str, Any]) -> str:
    content = result.get("content")
    if not isinstance(content, list):
        return ""
    parts = []
    for item in content:
        if (
            isinstance(item, dict)
            and item.get("type") == "text"
            and isinstance(item.get("text"), str)
        ):
            parts.append(item["text"])
    return "\n".join(parts)


def _parse_envelope(
    text: str, content_type: str, expected_id: Optional[int]
) -> Dict[str, Any]:
    """Parse either a JSON body or a streamable-HTTP SSE body."""
    body = text.strip()
    if not body:
        raise PayStageProtocolError("empty response body")
    is_sse = (
        "text/event-stream" in (content_type or "").lower()
        or body.startswith("event:")
        or body.startswith("data:")
    )
    if not is_sse:
        try:
            parsed = json.loads(body)
        except ValueError as exc:
            raise PayStageProtocolError(
                "response is not JSON: %s" % (body[:200],)
            ) from exc
        if isinstance(parsed, dict):
            return parsed
        raise PayStageProtocolError("response is not a JSON-RPC object")

    messages = []
    for data in _sse_data_blocks(text):
        try:
            message = json.loads(data)
        except ValueError:
            continue
        if isinstance(message, dict):
            messages.append(message)
    if not messages:
        raise PayStageProtocolError("SSE response held no JSON-RPC message")
    for message in messages:
        if message.get("id") == expected_id:
            return message
    # A server that omitted the id on a single response is still unambiguous.
    if len(messages) == 1:
        return messages[0]
    raise PayStageProtocolError(
        "SSE response has no message with id %r" % (expected_id,)
    )


def _sse_data_blocks(text: str) -> Sequence[str]:
    blocks = []
    data_lines = []
    normalized = text.replace("\r\n", "\n").replace("\r", "\n")
    for line in normalized.split("\n"):
        if line == "":
            if data_lines:
                blocks.append("\n".join(data_lines))
                data_lines = []
            continue
        if line.startswith(":"):
            continue
        if line.startswith("data:"):
            value = line[5:]
            if value.startswith(" "):
                value = value[1:]
            data_lines.append(value)
    if data_lines:
        blocks.append("\n".join(data_lines))
    return blocks
