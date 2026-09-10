#!/bin/sh
# Convert client/src/images/*.png to WebP, replacing each source.
# Needs cwebp: brew install webp libtiff
# POSIX only — package.json runs this with `sh`, which is dash on most Linux.
set -u

# Run the encoder rather than look for it: one that cannot load its libraries still passes
# `command -v`, and dyld's abort never reached the exit status.
cwebp -version >/dev/null 2>&1 || { echo "cwebp missing or broken: brew install webp libtiff" >&2; exit 1; }

failed=0
for file in client/src/images/*.png; do
  [ -e "$file" ] || continue  # an unmatched glob arrives as the literal pattern

  # `&&` throughout: this once used `;` and deleted every source whether or not it converted
  cwebp -q 70 -short "$file" -o "${file%.png}.webp" && [ -s "${file%.png}.webp" ] && rm -f "$file" \
    || { echo "kept $file, conversion failed" >&2; failed=$((failed + 1)); }
done

[ "$failed" -eq 0 ] || exit 1
