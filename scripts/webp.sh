#!/bin/sh
# Convert every PNG in client/src/images/ to WebP, replacing the source.
# Requires the cwebp encoder: brew install webp libtiff
#
# POSIX sh, no bashisms: package.json invokes this with `sh`, which is dash on most Linux, so
# `shopt -s nullglob` would fail there and leave the unmatched glob to reach the encoder.

set -u

# Fail before touching anything: a missing encoder used to delete every source without converting it.
# Run it rather than testing for the file — a cwebp that cannot load its libraries still passes
# `command -v`, and dyld's abort was not reflected in the exit status either.
if ! cwebp -version >/dev/null 2>&1; then
  echo "cwebp is missing or cannot run. Install it with: brew install webp libtiff" >&2
  exit 1
fi

converted=0
failed=0

for file in client/src/images/*.png; do
  # An unmatched glob arrives as the literal pattern; skip it rather than hand it to the encoder
  [ -e "$file" ] || continue

  # `&&`, not `;` — the source is removed only once a non-empty replacement exists
  if cwebp -q 70 -short "$file" -o "${file%.png}.webp" && [ -s "${file%.png}.webp" ] && rm -f "$file"; then
    converted=$((converted + 1))
  else
    echo "failed to convert $file, source kept" >&2
    failed=$((failed + 1))
  fi
done

echo "converted $converted file(s)"

# Exit non-zero on a partial run, so a caller cannot read silence as success
[ "$failed" -eq 0 ] || { echo "$failed file(s) failed" >&2; exit 1; }
