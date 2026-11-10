#!/usr/bin/env bash
# Install the NUSSO relay on a CSC office Raspberry Pi.
#
# DORMANT: do not run without written Northeastern ITS approval -- Policy 700
# disallows this relay (see README.md). Run from the USB stick:
#
#   sudo bash /media/$USER/<stick>/relay/install.sh 1      # on the first Pi
#   sudo bash /media/$USER/<stick>/relay/install.sh 2      # on the second
#
# Expects relay.env next to this script (see relay.env.example). Safe to run
# again: it updates the relay and leaves Tailscale's login alone.
set -euo pipefail

N="${1:-}"
if [[ ! "$N" =~ ^[0-9]+$ ]]; then
  echo "Usage: sudo bash install.sh <pi number, e.g. 1 or 2>"; exit 1
fi
[[ $EUID -eq 0 ]] || { echo "Run with sudo."; exit 1; }

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[[ -f "$HERE/relay.env" ]] || { echo "Missing $HERE/relay.env (copy relay.env.example and fill it in)."; exit 1; }
# shellcheck disable=SC1091
source "$HERE/relay.env"
[[ ${#NUSSO_RELAY_SECRET} -ge 32 ]] || { echo "NUSSO_RELAY_SECRET in relay.env must be at least 32 characters."; exit 1; }
HOSTNAME_TS="chambers-relay-$N"
PORT=8787

echo "== 1/5  Can this Pi reach EMS?"
if code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 https://nuevents.neu.edu/); [[ "$code" != "000" ]]; then
  echo "   yes (HTTP $code)"
else
  echo "   NO: nuevents.neu.edu did not answer from this network."
  echo "   The relay will install, but it cannot help until this Pi's network reaches EMS."
fi

echo "== 2/5  Installing the relay service"
install -d /opt/nusso-relay
install -m 0644 "$HERE/nusso_relay.py" /opt/nusso-relay/nusso_relay.py
install -m 0644 "$HERE/README.md" /opt/nusso-relay/README.md
umask 077
printf 'NUSSO_RELAY_SECRET=%s\nNUSSO_RELAY_PORT=%s\n' "$NUSSO_RELAY_SECRET" "$PORT" > /etc/nusso-relay.env
umask 022
install -m 0644 "$HERE/nusso-relay.service" /etc/systemd/system/nusso-relay.service
systemctl daemon-reload
systemctl enable --now nusso-relay
systemctl restart nusso-relay
sleep 1
curl -fsS -H "X-Relay-Secret: $NUSSO_RELAY_SECRET" "http://127.0.0.1:$PORT/__relay/health" >/dev/null \
  && echo "   relay running on 127.0.0.1:$PORT" \
  || { echo "   relay did not start: journalctl -u nusso-relay"; exit 1; }

echo "== 3/5  Installing Tailscale"
if ! command -v tailscale >/dev/null; then
  curl -fsSL https://tailscale.com/install.sh | sh
fi
systemctl enable --now tailscaled

echo "== 4/5  Joining SGA's tailnet as $HOSTNAME_TS"
if tailscale status >/dev/null 2>&1; then
  echo "   already logged in"
  tailscale set --hostname="$HOSTNAME_TS"
else
  [[ -n "${TS_AUTHKEY:-}" ]] || { echo "TS_AUTHKEY is empty in relay.env."; exit 1; }
  tailscale up --auth-key="$TS_AUTHKEY" --hostname="$HOSTNAME_TS"
fi

echo "== 5/5  Publishing the relay with Tailscale Funnel"
# --bg persists the Funnel across reboots.
tailscale funnel --bg "$PORT"
URL="https://$(tailscale status --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))')"

echo
echo "Done. This Pi's relay URL:"
echo "   $URL"
echo
echo "Add it to NUSSO_RELAY_URLS in Vercel (comma-separated, Pi 1 first)."
echo "Check it from anywhere with:"
echo "   curl -H 'X-Relay-Secret: <secret>' $URL/__relay/health"
