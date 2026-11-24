#!/usr/bin/env bash
# A stand-in for `gh` in the cooldown tests: GitHub's answers are JSON files in $GH_STATE
# (test-support/cooldown.mjs writes them), every call is written to $GH_STATE/log, and a
# call's own `--jq` filter is applied with the real `jq`. It knows only the calls the
# cooldown scripts make. A line in $GH_STATE/fail is a pattern: a call whose
# "<method> <path>" matches it fails the way a GitHub outage does.
set -euo pipefail
state="${GH_STATE:?}"
# One line for each call, whatever its filter looks like.
printf '%s\n' "$(printf '%s' "$*" | tr '\n' ' ')" >> "$state/log"

[ "${1:-}" = "api" ] || { echo "stub gh: unexpected call: $*" >&2; exit 2; }
shift
method="GET" path="" filter="" fields=""
while [ $# -gt 0 ]; do
  case "$1" in
    --method) method="$2"; shift ;;
    --jq) filter="$2"; shift ;;
    -f) fields="${fields}$2
"; shift ;;
    --paginate) ;;
    repos/*) path="$1" ;;
    *) echo "stub gh: unexpected argument $1" >&2; exit 2 ;;
  esac
  shift
done
field() { printf '%s' "$fields" | sed -n "s/^$1=//p" | head -n 1; }

if [ -f "$state/fail" ]; then
  while IFS= read -r pattern; do
    if [ -n "$pattern" ] && [[ "$method $path" =~ $pattern ]]; then
      echo "gh: Bad Gateway (HTTP 502)" >&2
      exit 1
    fi
  done < "$state/fail"
fi

rest="${path#repos/*/*/}"
# The answer is a file, or what GitHub says when there is nothing ($2), or a 404.
answer() {
  if [ -f "$state/$1" ]; then cat "$state/$1"; elif [ $# -gt 1 ]; then printf '%s' "$2"; else
    echo "gh: Not Found (HTTP 404)" >&2
    exit 1
  fi
}

case "$method $rest" in
  "GET pulls?state=open"*) body=$(answer open-pulls.json '[]') ;;
  "GET pulls") body=$(answer closed-pulls.json '[]') ;;
  "GET pulls/"*) body=$(answer "pulls/${rest#pulls/}.json") ;;
  "GET issues/"*/timeline*)
    number="${rest#issues/}"
    body=$(answer "timeline/${number%%/*}.json" '[]') ;;
  "GET activity")
    ref=$(field ref)
    branch="${ref#refs/heads/}"
    body=$(answer "activity/${branch//\//__}.json" '[]') ;;
  "GET commits/"*/pulls)
    sha="${rest#commits/}"
    sha="${sha%/pulls}"
    if [ -f "$state/not-pushed" ] && grep -qx "$sha" "$state/not-pushed"; then
      echo "gh: No commit found for SHA: ${sha} (HTTP 422)" >&2
      exit 1
    fi
    body=$(answer "commit-pulls/${sha}.json" '[]') ;;
  "GET commits/"*/statuses)
    sha="${rest#commits/}"
    body=$(answer "statuses/${sha%/statuses}.json" '[]') ;;
  "POST statuses/"*)
    sha="${rest#statuses/}"
    mkdir -p "$state/statuses"
    new=$(jq -n --arg state "$(field state)" --arg context "$(field context)" \
      --arg description "$(field description)" --arg url "$(field target_url)" \
      '{state: $state, context: $context, description: $description, target_url: $url}')
    old=$(answer "statuses/${sha}.json" '[]')
    # Newest first, as GitHub lists them.
    jq -n --argjson new "$new" --argjson old "$old" '[$new] + $old' > "$state/statuses/${sha}.json"
    printf '%s %s\n' "$sha" "$(jq -c . <<< "$new")" >> "$state/posted"
    body="$new" ;;
  "GET actions/workflows/sync-waiver.yml/runs") body=$(answer waiver-runs.json '{"workflow_runs":[]}') ;;
  "GET actions/runs/"*/approvals)
    id="${rest#actions/runs/}"
    body=$(answer "approvals/${id%/approvals}.json" '[]') ;;
  "GET environments/sync-waiver") body=$(answer environment.json) ;;
  "GET environments/sync-waiver/deployment-branch-policies"*) body=$(answer branch-policies.json) ;;
  *) echo "stub gh: unexpected call: $method $path" >&2; exit 2 ;;
esac

if [ -n "$filter" ]; then printf '%s' "$body" | jq -r "$filter"; else printf '%s\n' "$body"; fi
