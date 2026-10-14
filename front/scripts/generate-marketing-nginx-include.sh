#!/usr/bin/env sh
# Emit nginx location blocks for each slug under /usr/share/nginx/html/sites/<slug>/.
# Called from Dockerfile.prod after COPY sites/ → /usr/share/nginx/html/sites/

set -e
BASE=/usr/share/nginx/html/sites

if ! [ -d "$BASE" ]; then
  echo "# marketing: no $BASE"
  exit 0
fi

for d in "$BASE"/*/; do
  [ -d "$d" ] || continue
  slug=$(basename "$d")
  case "$slug" in _*) continue ;; esac

  echo ""
  echo "    location = /${slug} {"
  echo "        return 301 /${slug}/;"
  echo "    }"
  echo ""
  echo "    location ^~ /${slug}/ {"
  echo "        root /usr/share/nginx/html/sites;"
  echo "        try_files \$uri \$uri/ /${slug}/index.html;"
  echo "        add_header Cache-Control \"no-cache, no-store, must-revalidate\";"
  echo ""
  echo "        location ~* \\.(js|css|png|jpg|jpeg|gif|ico|svg)\$ {"
  echo "            expires 1y;"
  echo "            add_header Cache-Control \"public, no-transform\";"
  echo "        }"
  echo "    }"
done
