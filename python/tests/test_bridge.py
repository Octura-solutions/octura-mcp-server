"""Contract tests for the Python bridge.

Deliberately the same eight cases as test/bridge.test.mjs. Two bridges that
claim identical behaviour are only worth having if something checks that claim.

They run against a local stand-in rather than octurasolutions.com, so they are
deterministic and pass with no network access.
"""

import json
import subprocess
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

PACKAGE_DIR = Path(__file__).resolve().parent.parent


def make_endpoint(handler_fn):
    """Start a throwaway HTTP server; returns (url, shutdown)."""

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):  # noqa: N802 - name fixed by BaseHTTPRequestHandler
            length = int(self.headers.get("content-length", 0))
            body = json.loads(self.rfile.read(length) or b"{}")
            status, payload = handler_fn(body)
            self.send_response(status)
            self.send_header("content-type", "application/json")
            data = payload.encode() if payload else b""
            self.send_header("content-length", str(len(data)))
            self.end_headers()
            if data:
                self.wfile.write(data)

        def log_message(self, *args):
            pass

    server = HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    port = server.server_address[1]

    def stop():
        # shutdown() stops serve_forever but leaves the socket open, which
        # surfaces as a ResourceWarning; server_close() releases it.
        server.shutdown()
        server.server_close()

    return f"http://127.0.0.1:{port}/mcp", stop


def run_bridge(url, stdin_text, timeout=15):
    """Feed text to the bridge, return (stdout_messages, stderr)."""
    proc = subprocess.run(
        [sys.executable, "-m", "octura_mcp_server"],
        input=stdin_text,
        capture_output=True,
        text=True,
        timeout=timeout,
        cwd=PACKAGE_DIR,
        env={"PATH": "/usr/bin:/bin", "OCTURA_MCP_URL": url, "OCTURA_MCP_TIMEOUT_MS": "2000",
             "PYTHONPATH": str(PACKAGE_DIR)},
    )
    messages = [json.loads(line) for line in proc.stdout.splitlines() if line.strip()]
    return messages, proc.stderr


class BridgeContract(unittest.TestCase):
    def test_forwards_request_and_returns_response(self):
        url, stop = make_endpoint(
            lambda body: (200, json.dumps({"jsonrpc": "2.0", "id": body["id"],
                                           "result": {"echoed": body["method"]}}))
        )
        try:
            messages, _ = run_bridge(url, json.dumps(
                {"jsonrpc": "2.0", "id": 1, "method": "tools/list"}) + "\n")
        finally:
            stop()
        self.assertEqual(len(messages), 1)
        self.assertEqual(messages[0]["result"], {"echoed": "tools/list"})

    def test_notification_gets_no_reply(self):
        # The bug this guards: replying to a notification desynchronises the
        # client, which reads it as the answer to its next request.
        url, stop = make_endpoint(lambda _body: (202, ""))
        try:
            messages, _ = run_bridge(url, json.dumps(
                {"jsonrpc": "2.0", "method": "notifications/initialized"}) + "\n")
        finally:
            stop()
        self.assertEqual(messages, [])

    def test_stdout_is_protocol_only_logs_on_stderr(self):
        url, stop = make_endpoint(
            lambda body: (200, json.dumps({"jsonrpc": "2.0", "id": body["id"], "result": {}}))
        )
        try:
            messages, stderr = run_bridge(url, json.dumps(
                {"jsonrpc": "2.0", "id": 7, "method": "ping"}) + "\n")
        finally:
            stop()
        self.assertEqual(len(messages), 1)
        self.assertIn("bridging stdio to", stderr)

    def test_unreachable_endpoint_errors_rather_than_hanging(self):
        # Port 1 is reserved and refuses instantly. A client that never gets a
        # reply here would block forever, which is worse than a clean error.
        messages, _ = run_bridge("http://127.0.0.1:1/mcp", json.dumps(
            {"jsonrpc": "2.0", "id": 3, "method": "ping"}) + "\n")
        self.assertEqual(len(messages), 1)
        self.assertEqual(messages[0]["id"], 3)
        self.assertEqual(messages[0]["error"]["code"], -32603)

    def test_upstream_error_body_is_passed_through(self):
        # 429 matters specifically: the rate limiter's message is the useful
        # part, and a generic error would hide the Retry-After advice.
        url, stop = make_endpoint(
            lambda body: (429, json.dumps({"jsonrpc": "2.0", "id": body["id"],
                                           "error": {"code": -32000,
                                                     "message": "Rate limit exceeded"}}))
        )
        try:
            messages, _ = run_bridge(url, json.dumps(
                {"jsonrpc": "2.0", "id": 4, "method": "tools/call"}) + "\n")
        finally:
            stop()
        self.assertEqual(messages[0]["error"]["message"], "Rate limit exceeded")

    def test_unparseable_input_yields_parse_error_with_null_id(self):
        url, stop = make_endpoint(lambda _body: (200, "{}"))
        try:
            messages, _ = run_bridge(url, "{ not json\n")
        finally:
            stop()
        self.assertEqual(messages[0]["error"]["code"], -32700)
        self.assertIsNone(messages[0]["id"])

    def test_two_messages_answered_in_order(self):
        url, stop = make_endpoint(
            lambda body: (200, json.dumps({"jsonrpc": "2.0", "id": body["id"], "result": {}}))
        )
        try:
            payload = (json.dumps({"jsonrpc": "2.0", "id": 1, "method": "ping"}) + "\n"
                       + json.dumps({"jsonrpc": "2.0", "id": 2, "method": "ping"}) + "\n")
            messages, _ = run_bridge(url, payload)
        finally:
            stop()
        self.assertEqual([m["id"] for m in messages], [1, 2])

    def test_blank_lines_are_ignored(self):
        url, stop = make_endpoint(
            lambda body: (200, json.dumps({"jsonrpc": "2.0", "id": body["id"], "result": {}}))
        )
        try:
            payload = "\n\n" + json.dumps({"jsonrpc": "2.0", "id": 5, "method": "ping"}) + "\n\n"
            messages, _ = run_bridge(url, payload)
        finally:
            stop()
        self.assertEqual(len(messages), 1)
        self.assertEqual(messages[0]["id"], 5)


if __name__ == "__main__":
    unittest.main()
