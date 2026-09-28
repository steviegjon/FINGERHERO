#!/usr/bin/env sh
# Bundle the game into one self-contained HTML body (for sharing/embedding). Needs esbuild via npx.
#   sh tools/build-single-file.sh out.html
set -e
OUT=${1:-dist/finger-hero.html}
mkdir -p "$(dirname "$OUT")"
JS=$(npx --yes esbuild src/main.js --bundle --format=iife --minify --legal-comments=none --target=es2020)
cat > "$OUT" <<HTML
<title>Finger Hero</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Oswald:wght@500;600&family=Patrick+Hand&family=Share+Tech+Mono&display=swap">
<style>
  :root { color-scheme: dark; --bg: #07080b; }
  html, body { margin: 0; height: 100%; background: var(--bg); overflow: hidden; }
  body { display: flex; align-items: center; justify-content: center; }
  canvas { display: block; outline: none; }
</style>
<canvas id="game" width="1280" height="720" tabindex="0" aria-label="Finger Hero game. Click, then press Space to start."></canvas>
<script>
$JS
</script>
HTML
echo "wrote $OUT ($(wc -c < "$OUT") bytes)"
