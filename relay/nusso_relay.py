#!/usr/bin/env python3
"""
NUSSO relay: lets Chambers (on Vercel) reach nuevents.neu.edu, which only
accepts connections from the Northeastern network.

Runs on the CSC office Raspberry Pis. Tailscale Funnel publishes it at
https://<pi>.ts.net and forwards to 127.0.0.1:PORT here; this script forwards
each request to EMS and passes the response back untouched (status, redirects,
every Set-Cookie). Chambers keeps the EMS login and cookies itself -- the relay
holds no session and no EMS credentials.

It is deliberately narrow, because it is a door into the campus network:
  * every request must carry X-Relay-Secret matching NUSSO_RELAY_SECRET;
  * it only ever talks to one upstream host (nuevents.neu.edu);
  * it only forwards the paths Chambers uses.

Standard library only, so a stock Raspberry Pi OS needs nothing installed.
See relay/README.md.
"""
import hmac
import http.client
import json
import os
import re
import socket
import ssl
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

SECRET = os.environ.get("NUSSO_RELAY_SECRET", "")
PORT = int(os.environ.get("NUSSO_RELAY_PORT", "8787"))
# Overridable only so the relay can be tested against a local fake.
UPSTREAM = urlsplit(os.environ.get("NUSSO_UPSTREAM", "https://nuevents.neu.edu"))
TIMEOUT = float(os.environ.get("NUSSO_RELAY_TIMEOUT", "30"))
MAX_BODY = 1_000_000

# The EMS paths Chambers calls (lib/nusso/client.ts). Anything else is refused.
ALLOWED_PATH = re.compile(r"^/(?:|BrowseForSpace\.aspx|ServerApi\.aspx/[A-Za-z]+)$")

HOP_BY_HOP = {
    "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
    "te", "trailer", "transfer-encoding", "upgrade", "host", "content-length",
}
# Headers Funnel / the relay add that EMS should not see.
DROP_REQUEST = HOP_BY_HOP | {
    "x-relay-secret", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto",
    "tailscale-funnel-request", "accept-encoding",
}


def log(msg):
    print(time.strftime("%Y-%m-%dT%H:%M:%S"), msg, flush=True)


class Relay(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "nusso-relay"
    sys_version = ""

    def log_message(self, fmt, *args):  # quiet default access log; we log our own
        pass

    def send_response(self, code, message=None):
        # Skip BaseHTTPRequestHandler's own Server/Date; relayed ones come from EMS.
        self.log_request(code)
        self.send_response_only(code, message)
        # Marks the response as the relay's own, so Chambers can tell it apart
        # from an error Tailscale Funnel returns when this Pi is offline.
        self.send_header("X-Nusso-Relay", "1")

    def _send(self, status, payload, extra=None):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _authorized(self):
        given = self.headers.get("X-Relay-Secret", "")
        return bool(SECRET) and hmac.compare_digest(given.encode(), SECRET.encode())

    def _handle(self):
        path_only = self.path.split("?", 1)[0]

        if not self._authorized():
            return self._send(401, {"error": "unauthorized"}, {"X-Relay-Error": "auth"})

        if path_only == "/__relay/health":
            return self._send(200, {"ok": True, "upstream": UPSTREAM.netloc})

        if self.command not in ("GET", "POST") or not ALLOWED_PATH.match(path_only):
            return self._send(404, {"error": "not relayed"})

        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY:
            return self._send(413, {"error": "body too large"})
        body = self.rfile.read(length) if length else None

        headers = {k: v for k, v in self.headers.items() if k.lower() not in DROP_REQUEST}
        headers["Host"] = UPSTREAM.netloc
        headers["Accept-Encoding"] = "identity"

        started = time.monotonic()
        if UPSTREAM.scheme == "https":
            conn = http.client.HTTPSConnection(UPSTREAM.netloc, timeout=TIMEOUT, context=ssl.create_default_context())
        else:
            conn = http.client.HTTPConnection(UPSTREAM.netloc, timeout=TIMEOUT)

        # Connect separately so Chambers can tell "EMS unreachable from here,
        # nothing was sent" (safe to try the other Pi) from a failure mid-request.
        try:
            conn.connect()
        except (OSError, socket.timeout) as e:
            log(f"{self.command} {path_only} -> connect failed: {e}")
            return self._send(502, {"error": f"relay could not connect to EMS: {e}"}, {"X-Relay-Error": "connect"})

        try:
            conn.request(self.command, self.path, body=body, headers=headers)
            res = conn.getresponse()
            data = res.read()
        except (OSError, socket.timeout, http.client.HTTPException) as e:
            log(f"{self.command} {path_only} -> upstream error: {e}")
            return self._send(502, {"error": f"relay lost the EMS connection: {e}"}, {"X-Relay-Error": "upstream"})
        finally:
            conn.close()

        self.send_response(res.status, res.reason)
        for k, v in res.getheaders():  # getheaders() keeps every Set-Cookie
            if k.lower() not in HOP_BY_HOP | {"server", "date"}:
                self.send_header(k, v)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)
        log(f"{self.command} {path_only} -> {res.status} ({int((time.monotonic() - started) * 1000)} ms)")

    do_GET = _handle
    do_POST = _handle

    def do_PUT(self):
        self._send(405, {"error": "method not allowed"})

    do_DELETE = do_PATCH = do_PUT


def main():
    if len(SECRET) < 32:
        sys.exit("NUSSO_RELAY_SECRET must be set (at least 32 characters).")
    # Loopback only: Tailscale Funnel is the one way in.
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Relay)
    log(f"nusso-relay listening on 127.0.0.1:{PORT}, upstream {UPSTREAM.geturl()}")
    server.serve_forever()


if __name__ == "__main__":
    main()
