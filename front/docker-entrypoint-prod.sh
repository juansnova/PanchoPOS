#!/bin/sh
set -e

# Get API and WS URLs from environment variables, with defaults
# In production, we prefer relative URLs handled by index.html defaults
API_URL="${API_URL:-}"
WS_URL="${WS_URL:-}"
GOOGLE_ANALYTICS_MEASUREMENT_ID="${GOOGLE_ANALYTICS_MEASUREMENT_ID:-}"

# Escape special characters for sed (slashes, ampersands, etc.)
# We only do this if the variables are not empty
if [ -n "$API_URL" ]; then
    API_URL_ESCAPED=$(echo "$API_URL" | sed 's/[\/&]/\\&/g')
    find /usr/share/nginx/html -name "index.html" -exec sed -i "s#window.__API_URL__ = .*#window.__API_URL__ = '${API_URL_ESCAPED}';#g" {} \;
fi

if [ -n "$WS_URL" ]; then
    WS_URL_ESCAPED=$(echo "$WS_URL" | sed 's/[\/&]/\\&/g')
    find /usr/share/nginx/html -name "index.html" -exec sed -i "s#window.__WS_URL__ = .*#window.__WS_URL__ = '${WS_URL_ESCAPED}';#g" {} \;
fi

# GA4: write measurement ID into runtime-config.js (from .secrets / compose env).
# Do not put the real ID into tracked source — see docs/0073-google-analytics.md.
case "$GOOGLE_ANALYTICS_MEASUREMENT_ID" in
  G-[A-Za-z0-9]*)
    GA_ESC=$(printf '%s' "$GOOGLE_ANALYTICS_MEASUREMENT_ID" | sed "s/\\\\/\\\\\\\\/g; s/'/\\\\'/g")
    printf "%s\n" "window.__GA_MEASUREMENT_ID__ = '${GA_ESC}';" > /usr/share/nginx/html/runtime-config.js
    echo "[entrypoint-prod] Google Analytics measurement ID written to runtime-config.js"
    ;;
  '')
    printf "%s\n" "window.__GA_MEASUREMENT_ID__ = '';" > /usr/share/nginx/html/runtime-config.js
    ;;
  *)
    printf "%s\n" "window.__GA_MEASUREMENT_ID__ = '';" > /usr/share/nginx/html/runtime-config.js
    echo "[entrypoint-prod] WARNING: ignoring invalid GOOGLE_ANALYTICS_MEASUREMENT_ID (expected G-…)"
    ;;
esac

# Execute the original command
exec "$@"
