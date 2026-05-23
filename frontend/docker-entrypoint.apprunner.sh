#!/bin/sh
set -eu

cat <<EOF >/usr/share/nginx/html/runtime-config.js
window.__APP_CONFIG__ = {
  VITE_API_URL: "${VITE_API_URL:-}"
};
EOF

exec nginx -g 'daemon off;'
