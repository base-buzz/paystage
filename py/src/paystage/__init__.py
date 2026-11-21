"""Thin Python client for the hosted PayStage MCP endpoint.

The evaluator is TypeScript. This package is a transport: it sends JSON-RPC 2.0
over HTTPS to ``https://api.paystage.xyz/mcp`` and returns the verdict the hosted
MCP tool produced. It contains no policy rules, no signing code, and no keys.
"""

from .client import (
    CLIENT_NAME,
    DEFAULT_ENDPOINT,
    PROTOCOL_VERSION,
    REVIEW_PACKET_SCHEMA,
    TOOL_EVALUATE_PAYMENT,
    VERDICTS,
    VERSION,
    Evaluation,
    PayStageClient,
    PayStageError,
    PayStageProtocolError,
    PayStageToolError,
    PayStageTransportError,
    evaluate,
)

__version__ = VERSION

__all__ = [
    "CLIENT_NAME",
    "DEFAULT_ENDPOINT",
    "PROTOCOL_VERSION",
    "REVIEW_PACKET_SCHEMA",
    "TOOL_EVALUATE_PAYMENT",
    "VERDICTS",
    "VERSION",
    "Evaluation",
    "PayStageClient",
    "PayStageError",
    "PayStageProtocolError",
    "PayStageToolError",
    "PayStageTransportError",
    "evaluate",
    "__version__",
]
