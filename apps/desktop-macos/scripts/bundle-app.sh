#!/usr/bin/env bash
# Build a release binary and wrap it in a real .app so macOS shows the proper
# microphone-permission prompt. The bundle is unsigned — for a public release,
# add codesign + notarytool steps after this.
set -euo pipefail

cd "$(dirname "$0")/.."

APP="AthenaOverlay.app"
EXE="AthenaOverlay"

echo "→ swift build -c release"
swift build -c release

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"
mkdir -p "$APP/Contents/Resources"

cp ".build/release/$EXE" "$APP/Contents/MacOS/$EXE"
cp "Resources/Info.plist" "$APP/Contents/Info.plist"

cat <<EOF > "$APP/Contents/PkgInfo"
APPL????
EOF

echo "→ built $APP"
echo "→ open with: open ./$APP"
