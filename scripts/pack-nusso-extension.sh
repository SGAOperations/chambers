#!/usr/bin/env bash
# Zip the Chambers for NUSSO extension for "Load unpacked" (see extension/nusso/README.md).
set -euo pipefail
cd "$(dirname "$0")/.."
rm -f chambers-nusso-extension.zip
(cd extension && zip -qr ../chambers-nusso-extension.zip nusso -x 'nusso/README.md')
echo "Wrote chambers-nusso-extension.zip"
