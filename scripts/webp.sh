#!/bin/bash
# Convert every PNG in client/src/images/ to WebP, replacing the source.
# Requires the cwebp encoder: brew install webp

set -u
shopt -s nullglob

# Fail before touching anything: a missing encoder used to delete every source without converting it.
# Run it rather than testing for the file — a cwebp that cannot load its libraries still passes
# `command -v`, and dyld's abort was not reflected in the exit status either.
if ! cwebp -version >/dev/null 2>&1; then
  echo "cwebp is missing or cannot run. Install it with: brew install webp libtiff" >&2
  exit 1
fi

converted=0
for file in client/src/images/*.png; do
  # `&&`, not `;` — the source is removed only once its replacement exists
  if cwebp -q 70 -short "$file" -o "${file%.png}.webp" && [ -s "${file%.png}.webp" ]; then
    rm -f "$file"
    converted=$((converted + 1))
  else
    echo "failed to convert $file, source kept" >&2
  fi
done

echo "converted $converted file(s)"
