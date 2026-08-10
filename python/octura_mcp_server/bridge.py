"""stdio to streamable-HTTP bridge for the Octura Solutions MCP server.

The Python twin of ``src/bridge.mjs``. Same contract, same failure modes, so a
client gets identical behaviour whichever one it launches.

It is a pipe, not a reimplementation: whatever arrives on stdin is POSTed
verbatim to the endpoint and the reply is written back. No tool name, schema or
version is restated here, so this cannot drift out of sync with the server.

Standard library only, deliberately. Nothing to install means nothing that can
break an install.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

ENDPOINT = os.environ.get("OCTURA_MCP_URL", "https://octurasolutions.com/mcp")
TIMEOUT = float(os.environ.get("OCTURA_MCP_TIMEOUT_MS", "30000")) / 1000

PARSE_ERROR = -32700
INTERNAL_ERROR = -32603


def log(message: str) -> None:
    """stdout carries the protocol and nothing else.

    A stray print() here corrupts the stream and the client fails parsing a
    message it never sent.
    """
    print(f"[octura-mcp] {message}", file=sys.stderr, flush=True)


def error_response(request_id, code: int, message: str) -> dict:
    # JSON-RPC uses null, not omitted, for "no id".
    return {"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}}


def forward(message):
    """POST one message and return the parsed reply, or None if there is none."""
    payload = json.dumps(message).encode()
    request = urllib.request.Request(
        ENDPOINT,
        data=payload,
        headers={
            "content-type": "application/json",
            # Both, because the spec allows either. This server answers JSON,
            # but the bridge should not depend on that.
            "accept": "application/json, text/event-stream",
            "user-agent": "octura-mcp-bridge-py",
        },
        method="POST",
    )

    request_id = message.get("id") if isinstance(message, dict) else None

    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            body = response.read().decode()
    except urllib.error.HTTPError as exc:
        # A rate limit or outage still has to reach the client as JSON-RPC,
        # otherwise it hangs waiting for a reply that never comes.
        body = exc.read().decode()
        log(f"HTTP {exc.code} from endpoint")
        if not body:
            return error_response(request_id, INTERNAL_ERROR, f"Upstream HTTP {exc.code}")
        try:
            return json.loads(body)
        except json.JSONDecodeError:
            return error_response(request_id, INTERNAL_ERROR, f"Upstream HTTP {exc.code}")
    except Exception as exc:  # noqa: BLE001 - a dead endpoint must not crash the bridge
        reason = f"Cannot reach {ENDPOINT}: {exc}"
        log(reason)
        return error_response(request_id, INTERNAL_ERROR, reason)

    # An empty body is the correct reply to a notification (the server answers
    # 202). There is nothing to hand back, and inventing a response would be a
    # protocol violation.
    if not body:
        return None

    try:
        return json.loads(body)
    except json.JSONDecodeError:
        return error_response(request_id, INTERNAL_ERROR, "Upstream sent invalid JSON")


def write(payload) -> None:
    """One JSON message per line, which is what MCP's stdio transport specifies."""
    if payload is not None:
        sys.stdout.write(json.dumps(payload) + "\n")
        sys.stdout.flush()


def handle_line(line: str) -> None:
    stripped = line.strip()
    if not stripped:
        return

    try:
        message = json.loads(stripped)
    except json.JSONDecodeError:
        # No id is recoverable from unparseable input, so this is the one case
        # where the reply cannot be correlated. Per JSON-RPC, id is null.
        write(error_response(None, PARSE_ERROR, "Parse error"))
        return

    # A notification (no id) gets no reply, even on failure. Batches pass
    # through untouched; the server decides what a batch means.
    is_notification = isinstance(message, dict) and "id" not in message
    response = forward(message)
    if not is_notification:
        write(response)


def main() -> int:
    log(f"bridging stdio to {ENDPOINT}")
    # Iterating the text stream reassembles messages split across reads, so a
    # line straddling two chunks is handled for us.
    for line in sys.stdin:
        handle_line(line)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
