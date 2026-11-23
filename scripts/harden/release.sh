#!/usr/bin/env bash
# Cut a CodeHarden release in the current checkout: one commit
# `release: <version> (upstream <sha>)`, tagged `v<version>`, that writes
#
#   VERSION                  `YYYY.MMDD.HHMM`, the release time in America/New_York
#   CODEHARDEN-CHANGELOG.md  a new entry on top: the upstream commit subjects merged since the
#                            last release, and this fork's own since then (no merge commits)
#   state/upstream-base      the upstream commit this branch now contains, where the next
#                            release's upstream section starts
#
# The sync workflow (.github/workflows/upstream-sync-merge.yml) runs it after merging a sync,
# and a maintainer runs it after merging our own changes. Publishing to npm is separate
# (scripts/harden/publish.sh).
#
#   scripts/harden/release.sh             commit and tag locally, push nothing
#   scripts/harden/release.sh --dry-run   print what it would write, change nothing
#   scripts/harden/release.sh --push      also push the commit and the tag, in one atomic push
#
# It refuses to run when the tag already exists (here or on the remote), when tracked files
# have changes, or when the upstream base would move backwards. It never forces a push and
# never moves a tag. Plain bash, also on macOS's bash 3.2.
set -euo pipefail

UPSTREAM_URL="${UPSTREAM_URL:-https://github.com/leonvanzyl/codeden}"
UPSTREAM_NAME="${UPSTREAM_NAME:-leonvanzyl/codeden}"
MIRROR_BRANCH="${MIRROR_BRANCH:-main}"
TARGET_BRANCH="${TARGET_BRANCH:-harden}"
CHANGELOG_FILE="${CHANGELOG_FILE:-CODEHARDEN-CHANGELOG.md}"
CHANGELOG_TITLE="${CHANGELOG_TITLE:-# CodeHarden releases}"
BASE_FILE="${BASE_FILE:-state/upstream-base}"
RELEASE_TZ="${RELEASE_TZ:-America/New_York}"
REMOTE="${RELEASE_REMOTE:-origin}"

dry_run=0
push=0
upstream_ref=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) dry_run=1 ;;
    --push) push=1 ;;
    # A ref that already holds upstream's branch, instead of fetching it (the workflow, tests).
    --upstream-ref) upstream_ref="${2:-}"; shift ;;
    -h | --help) sed -n '2,22p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "release: unknown option $1" >&2; exit 2 ;;
  esac
  shift
done

die() {
  echo "release: $*" >&2
  exit 1
}

cd "$(git rev-parse --show-toplevel 2> /dev/null)" || die "run this inside the repository"

for f in VERSION "$CHANGELOG_FILE" "$BASE_FILE"; do
  [ -f "$f" ] || die "this checkout has no $f; can't make a release"
done
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  die "tracked files have changes; commit or discard them first"
fi
if [ "$(head -n 1 "$CHANGELOG_FILE")" != "$CHANGELOG_TITLE" ]; then
  die "$CHANGELOG_FILE doesn't start with '$CHANGELOG_TITLE'"
fi

if [ -z "$upstream_ref" ]; then
  upstream_ref="refs/sync/upstream"
  git fetch --quiet --no-tags "$UPSTREAM_URL" "+refs/heads/${MIRROR_BRANCH}:${upstream_ref}" \
    || die "couldn't fetch ${MIRROR_BRANCH} from $UPSTREAM_URL"
fi
git cat-file -e "${upstream_ref}^{commit}" 2> /dev/null || die "$upstream_ref is not a commit here"

prev_base=$(tr -d '[:space:]' < "$BASE_FILE")
if ! [[ "$prev_base" =~ ^[0-9a-f]{40}$ ]] || ! git cat-file -e "${prev_base}^{commit}" 2> /dev/null; then
  die "$BASE_FILE doesn't hold a commit of this repository"
fi
# The newest upstream commit this branch contains.
new_base=$(git merge-base HEAD "$upstream_ref") || die "this branch shares no history with upstream"
if ! git merge-base --is-ancestor "$prev_base" "$new_base"; then
  die "the last release's upstream base ($prev_base) is not an ancestor of the upstream commit this branch now contains ($new_base)"
fi
prev_release=$(git log -1 --format=%H -- VERSION)
[ -n "$prev_release" ] || die "VERSION has no history; can't tell where the last release was"

# One clock reading for the version and the changelog heading. RELEASE_NOW replaces the clock
# in tests: "YYYY.MMDD.HHMM YYYY-MM-DD HH:MM".
now="${RELEASE_NOW:-$(TZ="$RELEASE_TZ" date '+%Y.%m%d.%H%M %Y-%m-%d %H:%M')}"
read -r version day time <<< "$now"
[[ "$version" =~ ^[0-9]{4}\.[0-9]{4}\.[0-9]{4}$ ]] || die "\"$version\" is not a version (YYYY.MMDD.HHMM)"
tag="v${version}"

if git rev-parse --verify --quiet "refs/tags/${tag}" > /dev/null; then
  die "tag ${tag} already exists. Nothing was changed; run it again in a minute."
fi
if git remote get-url "$REMOTE" > /dev/null 2>&1; then
  if git ls-remote --exit-code --tags "$REMOTE" "refs/tags/${tag}" > /dev/null 2>&1; then
    die "tag ${tag} already exists on ${REMOTE}. Nothing was changed; run it again in a minute."
  fi
elif [ "$push" = 1 ]; then
  die "there is no remote named ${REMOTE} to push to"
fi

upstream_lines=$(git log --no-merges --pretty='- %s' "${prev_base}..${new_base}")
own_lines=$(git log --no-merges --pretty='- %s' "${prev_release}..HEAD" --not "$new_base")
short=$(git rev-parse --short=8 "$new_base")

entry() {
  printf '## %s — %s %s\n\n' "$version" "$day" "$time"
  if [ -z "$upstream_lines" ] && [ -z "$own_lines" ]; then
    printf -- '- rebuild only (upstream base or dependency refresh)\n\n'
  fi
  if [ -n "$upstream_lines" ]; then printf '### upstream (%s)\n%s\n\n' "$UPSTREAM_NAME" "$upstream_lines"; fi
  if [ -n "$own_lines" ]; then printf '### codeharden\n%s\n\n' "$own_lines"; fi
}

if [ "$dry_run" = 1 ]; then
  echo "Dry run: nothing is written, committed, tagged or pushed."
  echo
  echo "VERSION:              $version (was $(tr -d '[:space:]' < VERSION))"
  echo "Tag:                  $tag"
  echo "Commit:               release: ${version} (upstream ${short})"
  echo "$BASE_FILE:  $new_base (was $prev_base)"
  echo
  echo "New entry in ${CHANGELOG_FILE}:"
  echo
  entry
  exit 0
fi

new_changelog=$(mktemp)
trap 'rm -f "$new_changelog"' EXIT
{
  printf '%s\n\n' "$CHANGELOG_TITLE"
  entry
  tail -n +3 "$CHANGELOG_FILE"
} > "$new_changelog"
cp "$new_changelog" "$CHANGELOG_FILE"
printf '%s\n' "$version" > VERSION
printf '%s\n' "$new_base" > "$BASE_FILE"

git add VERSION "$CHANGELOG_FILE" "$BASE_FILE"
git commit --quiet -m "release: ${version} (upstream ${short})"
git tag -a "$tag" -m "CodeHarden ${version} (upstream ${short})"
echo "Released CodeHarden ${version} (${tag}), upstream base ${short}."

if [ "$push" = 1 ]; then
  # One atomic push, never forced: both the commit and the tag land, or neither.
  git push --atomic "$REMOTE" "HEAD:refs/heads/${TARGET_BRANCH}" "refs/tags/${tag}"
  echo "Pushed ${TARGET_BRANCH} and ${tag} to ${REMOTE}."
else
  echo "Not pushed. To publish the release: git push --atomic ${REMOTE} HEAD:refs/heads/${TARGET_BRANCH} refs/tags/${tag}"
fi
