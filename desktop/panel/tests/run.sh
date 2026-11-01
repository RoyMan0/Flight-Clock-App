#!/bin/sh
# Run the panel layout tests under JavaScriptCore (ships with macOS; no Node needed)
cd "$(dirname "$0")/../js" || exit 1
JSC=/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc
exec "$JSC" ../tests/shim.js board.js layouts/*.js fixtures.js ../tests/layouts_test.js
