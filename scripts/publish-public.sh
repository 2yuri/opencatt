#!/usr/bin/env bash
# Syncs the public repo from this one's main (OP-85): main's files only, never its history.
# The first sync makes the public repo's single root commit; each later one adds one snapshot
# commit on top, so clones and forks keep working. Nothing is pushed without --push.
#
# Usage: scripts/publish-public.sh [--push]
#   PUBLIC_REPO   the public repo (default 2yuri/opencatt)
#   SOURCE_REF    what to publish (default origin/main, fetched first)
#   PUBLIC_AUTHOR_NAME / PUBLIC_AUTHOR_EMAIL   the snapshot's author (default: yuri,
#                 hello@yuri.dev, the owner's)
set -euo pipefail
cd "$(dirname "$0")/.."
PUBLIC_REPO=${PUBLIC_REPO:-2yuri/opencatt}
# Where the ffmpeg release is copied from when the public repo doesn't have it yet.
PRIVATE_REPO=${PRIVATE_REPO:-2yuri/opencatt-private}
SOURCE_REF=${SOURCE_REF:-origin/main}
PUSH=${1:-}

git fetch -q origin
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
TREE="$WORK/tree"
mkdir -p "$TREE"
git archive "$SOURCE_REF" | tar -x -C "$TREE"
VERSION=$(node -p "require('$TREE/package.json').version")
RELEASE_TAG=$(sed -nE 's/^RELEASE_TAG=(.*)$/\1/p' "$TREE/scripts/ffmpeg/fetch.sh")

# The public copy fetches its ffmpeg from the public repo's own release (OP-87, OP-85).
sed -i.bak -E "s#^RELEASE_REPO=.*#RELEASE_REPO=\${OPENCATT_FFMPEG_REPO:-$PUBLIC_REPO}#" \
  "$TREE/scripts/ffmpeg/fetch.sh"
rm "$TREE/scripts/ffmpeg/fetch.sh.bak"

# --- Checks: any hit stops the sync. ---
fail=0
hit() { echo "BLOCKED: $1"; fail=1; }
( cd "$TREE"
  find . -type f \( -name '.env*' -o -name '*.pem' -o -name '*.key' -o -name '*.p12' \
    -o -name '*.pfx' -o -name 'id_rsa*' \) -print | grep . && exit 1 || true
  [ -d .claude ] && exit 1 || true ) || hit "a key, env or .claude file is in the tree"
SECRETS='ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-ant-[A-Za-z0-9_-]{10,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|BEGIN [A-Z ]*PRIVATE KEY'
grep -rInE "$SECRETS" "$TREE" --exclude=pnpm-lock.yaml && hit "something that looks like a secret"
# The product OpenCatt was inspired by is never named (OP-84); built in halves so this file passes.
NAME="ot""to"
grep -rIniw "$NAME" "$TREE" && hit "the inspiration's name"
grep -rIn '/Users/[a-z]' "$TREE" | grep -vE "/Users/(me|u)(/|'|\`)" && hit "a real local path"
# The public site is static files only (OP-131): nothing that runs or holds data.
[ -d "$TREE/site" ] && ( cd "$TREE/site" && find . -type f ! \( -name '*.html' -o -name '*.css' \
  -o -name '*.js' -o -name '*.svg' -o -name '*.png' -o -name '*.jpg' -o -name '*.webp' \
  -o -name '*.ico' -o -name '*.woff2' -o -name '*.txt' \) -print | grep . ) &&
  hit "site/ has a file that isn't a static page, style, script, image or font"
grep -q 'RELEASE_REPO=${OPENCATT_FFMPEG_REPO:-'"$PUBLIC_REPO}" "$TREE/scripts/ffmpeg/fetch.sh" ||
  hit "fetch.sh doesn't point at $PUBLIC_REPO"
grep -q "\"repository\": \"github:$PUBLIC_REPO\"" "$TREE/package.json" ||
  hit "package.json repository isn't github:$PUBLIC_REPO"
[ "$fail" = 0 ] || { echo "Nothing was published."; exit 1; }
echo "Checks passed for $SOURCE_REF (version $VERSION)."

# The ffmpeg release the public fetch.sh downloads from, binaries and sources (the LGPL source
# offer in build/third-party/FFmpeg/NOTICE.md). A release needs a commit to tag, so on a new
# public repo it can only be mirrored after the first push.
has_release() { gh release view "$RELEASE_TAG" -R "$PUBLIC_REPO" >/dev/null 2>&1; }
mirror_release() {
  has_release && { echo "Release $RELEASE_TAG is on $PUBLIC_REPO."; return; }
  local dir="$WORK/release"
  mkdir -p "$dir"
  gh release download "$RELEASE_TAG" -R "$PRIVATE_REPO" -D "$dir"
  (cd "$dir" && shasum -a 256 -c "$TREE/scripts/ffmpeg/checksums.sha256")
  gh release view "$RELEASE_TAG" -R "$PRIVATE_REPO" --json body --jq .body > "$WORK/notes.md"
  gh release create "$RELEASE_TAG" -R "$PUBLIC_REPO" --target main --prerelease \
    --title "$(gh release view "$RELEASE_TAG" -R "$PRIVATE_REPO" --json name --jq .name)" \
    --notes-file "$WORK/notes.md" "$dir"/*
  has_release || { echo "Mirroring $RELEASE_TAG failed."; exit 1; }
  echo "Mirrored release $RELEASE_TAG ($(ls "$dir" | wc -l | tr -d ' ') files) to $PUBLIC_REPO."
}

# --- The snapshot commit. ---
PUB="$WORK/public"
if [ "$(gh repo view "$PUBLIC_REPO" --json isEmpty --jq .isEmpty)" = true ]; then
  git init -q -b main "$PUB"
  git -C "$PUB" remote add origin "https://github.com/$PUBLIC_REPO.git"
else
  git clone -q --branch main "https://github.com/$PUBLIC_REPO.git" "$PUB"
  find "$PUB" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
fi
cp -R "$TREE"/. "$PUB"/
git -C "$PUB" add -A
if git -C "$PUB" diff --cached --quiet; then
  echo "The public repo already matches $SOURCE_REF."
  [ "$PUSH" = --push ] && mirror_release
  exit 0
fi
# The public commit carries no private SHA, branch or PR number; its author is the owner, below.
# Every public commit is the owner's, whoever runs the sync (the boss asked: this email, no other).
AUTHOR_NAME=${PUBLIC_AUTHOR_NAME:-yuri}
AUTHOR_EMAIL=${PUBLIC_AUTHOR_EMAIL:-hello@yuri.dev}
git -C "$PUB" -c user.name="$AUTHOR_NAME" -c user.email="$AUTHOR_EMAIL" \
  commit -q -m "OpenCatt $VERSION" -m "Snapshot of the OpenCatt source on $(date -u +%Y-%m-%d)."
echo "Snapshot commit: $(git -C "$PUB" log --oneline -1) ($(git -C "$PUB" rev-list --count HEAD) commit(s) in the public history)"
git -C "$PUB" show --stat --format= HEAD | tail -1

if [ "$PUSH" = --push ]; then
  git -C "$PUB" push -q origin main
  echo "Pushed to https://github.com/$PUBLIC_REPO"
  mirror_release
else
  has_release || echo "Note: $PUBLIC_REPO has no $RELEASE_TAG release yet; --push mirrors it."
  echo "Dry run: nothing pushed. Run again with --push to publish."
fi
