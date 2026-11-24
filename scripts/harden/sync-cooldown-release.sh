#!/usr/bin/env bash
# The cooldown, asked for a release: did every upstream commit this release would ship wait
# out its cooldown before it was merged (scripts/harden/sync-cooldown.sh has the rule)?
#
#   sync-cooldown-release.sh --prev-base <sha> --new-base <sha> --upstream-ref <ref> --branch <name> [--notes <file>]
#
# `prev-base` is the upstream commit the last release contained (state/upstream-base),
# `new-base` the one HEAD contains now. For the upstream commits between them it finds the
# merges through which they entered the branch, the pull request that landed each, and asks
# the rule about that pull request at the moment it was merged.
#
#   exit 0  every one had waited, or the owner waived it. Prints one line for each; a waived
#           one is also written to the notes file, for the release's changelog entry.
#   exit 1  at least one had not. Prints which, from when it would have been allowed and how
#           the owner waives it.
#   exit 2  GitHub could not be asked. That is not a yes: the caller refuses the release.
#
# release.sh calls it, and only when the upstream base moves: a release of this fork's own
# commits asks nothing and needs neither `gh` nor a network. It changes nothing.
set -euo pipefail

# shellcheck source=scripts/harden/sync-cooldown.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/sync-cooldown.sh"

# The commit of the branch's own line (first parents from HEAD) that brought commit $1 in.
cr_landing() {
  local commit landing=""
  while read -r commit; do
    if git merge-base --is-ancestor "$1" "$commit" 2> /dev/null; then landing="$commit"; else break; fi
  done < <(git rev-list --first-parent HEAD)
  printf '%s\n' "$landing"
}

# The merged pull request into the branch whose merge is commit $1: sets CR_PULL_REQUEST
# (empty when there is none).
cr_pull_request_of() {
  local pick="[.[] | select(.merged_at != null and .base.ref == \"${CD_BRANCH}\" and (.merge_commit_sha == \"$1\" or .head.sha == \"$1\")) | .number] | first // empty"
  # A commit GitHub doesn't have (a merge made here and not pushed) is an error of this call,
  # so its failure is not the last word: the list of merged pull requests is.
  CR_PULL_REQUEST=$(cd_gh api "repos/${CD_REPO}/commits/$1/pulls" --jq "$pick") || CR_PULL_REQUEST=""
  if [ -z "$CR_PULL_REQUEST" ]; then
    CR_PULL_REQUEST=$(cd_gh api --method GET "repos/${CD_REPO}/pulls" -f state=closed -f "base=${CD_BRANCH}" \
      -f sort=updated -f direction=desc -f per_page=100 --jq "$pick") || return 2
  fi
}

# Why a merged pull request had not waited when it was merged, and from when it would have.
cr_why() {
  local h="$COOLDOWN_HOURS" approved="" ready="" pushed=""
  [ -z "$CD_APPROVED_AT" ] || approved=$(cd_time "$CD_APPROVED_AT")
  [ -z "$CD_READY_AT" ] || ready=$(cd_time "$CD_READY_AT")
  [ -z "$CD_PUSH_AT" ] || pushed=$(cd_time "$CD_PUSH_AT")
  case "$CD_STATE" in
    not-approved)
      echo "it did not have the label ${APPROVED_LABEL} when it was merged, so there is no time from which it would have been allowed" ;;
    waiting)
      echo "it was merged $(cd_hours $((CD_AT - CD_APPROVED_AT))) after ${APPROVED_LABEL} was applied (${approved}); it would have been allowed from ${ready}" ;;
    held)
      if [ -n "$ready" ]; then
        echo "it had the label ${HOLD_LABEL} when it was merged; without the hold it would have been allowed from ${ready}"
      else
        echo "it had the label ${HOLD_LABEL} and not the label ${APPROVED_LABEL} when it was merged, so there is no time from which it would have been allowed"
      fi ;;
    head-moved)
      echo "its head branch was pushed ${pushed}, after ${APPROVED_LABEL} was applied (${approved}), so the approval did not cover what was merged; it would have been allowed ${h} hours after the label was applied again" ;;
    unsettled)
      echo "GitHub's record of the pushes to its head branch does not end at the commit that was merged, so it can't be shown that nothing was pushed after the approval" ;;
    foreign)
      echo "its head branch was in another repository (${PR_HEAD_REPO}), whose pushes can't be read" ;;
    *) echo "the cooldown rule did not hold (${CD_STATE})" ;;
  esac
}

cr_main() {
  local prev="" new="" upstream_ref="" notes="" entries entry landing landings="" upstream short what refused="" passed="" waivers=""
  CD_BRANCH=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --prev-base) prev="${2:-}"; shift ;;
      --new-base) new="${2:-}"; shift ;;
      --upstream-ref) upstream_ref="${2:-}"; shift ;;
      --branch) CD_BRANCH="${2:-}"; shift ;;
      --notes) notes="${2:-}"; shift ;;
      *) echo "sync-cooldown-release: unknown option $1" >&2; exit 2 ;;
    esac
    shift
  done
  if ! [[ "$prev" =~ ^[0-9a-f]{40}$ && "$new" =~ ^[0-9a-f]{40}$ && "$CD_BRANCH" =~ ^[A-Za-z0-9][A-Za-z0-9._/-]*$ ]] || [ -z "$upstream_ref" ]; then
    echo "sync-cooldown-release: needs --prev-base, --new-base (full commit ids), --upstream-ref and --branch" >&2
    exit 2
  fi
  cd_init
  [ -z "$notes" ] || : > "$notes"
  if [ "$prev" = "$new" ]; then
    echo "Sync cooldown: this release has no new upstream commits."
    exit 0
  fi

  # Where the new upstream commits entered: merges on this side that have one as a parent.
  git rev-list "${prev}..${new}" > "$CD_TMP/new-upstream"
  entries=$(git rev-list --parents --min-parents=2 HEAD --not "$upstream_ref" \
    | awk 'NR == FNR { new[$1] = 1; next } { for (i = 2; i <= NF; i++) if ($i in new) { print $1; break } }' "$CD_TMP/new-upstream" -)
  # Oldest first, each landing commit once.
  for entry in $(printf '%s\n' "$entries" | awk '{ line[NR] = $0 } END { for (i = NR; i > 0; i--) print line[i] }'); do
    landing=$(cr_landing "$entry")
    case " ${landings} " in *" ${landing} "*) ;; *) landings="${landings} ${landing}" ;; esac
  done
  if [ -z "${landings// /}" ]; then
    echo "The upstream commits in this release (${prev:0:8}..${new:0:8}) can't be traced to a merge on ${CD_BRANCH}: upstream is expected to arrive by merge commits."
    exit 2
  fi

  for landing in $landings; do
    upstream=$(git merge-base "$landing" "$upstream_ref")
    short="${upstream:0:8}"
    if ! cr_pull_request_of "$landing"; then
      echo "GitHub could not be asked which pull request brought upstream ${short} in: $(cd_problem_text)."
      exit 2
    fi
    if [ -z "$CR_PULL_REQUEST" ]; then
      what="upstream ${short} came in through the commit ${landing:0:8} (\"$(git log -1 --format=%s "$landing")\"), which is not the merge of a pull request into ${CD_BRANCH}"
      if cd_find_waiver "$upstream" ""; then
        CD_STATE="waived"
      else
        CD_STATE="no-pull-request"
        refused="${refused}  - ${what}: nothing was approved, so there is no time from which it would have been allowed.
    To waive: upstream commit ${upstream}, no pull request.
"
        continue
      fi
    else
      if ! cd_read_pull_request "$CR_PULL_REQUEST" || ! cd_evaluate "$upstream"; then
        echo "GitHub could not be asked about pull request #${CR_PULL_REQUEST}, which brought upstream ${short} in: $(cd_problem_text)."
        exit 2
      fi
      what="upstream ${short} came in through pull request #${PR_NUMBER} (${PR_HEAD_REF}), merged $(cd_time "$CD_AT")"
    fi
    case "$CD_STATE" in
      satisfied)
        passed="${passed}Sync cooldown: ${what}, $(cd_hours $((CD_AT - CD_APPROVED_AT))) after ${APPROVED_LABEL} was applied ($(cd_time "$CD_APPROVED_AT")).
" ;;
      waived)
        passed="${passed}Sync cooldown waived by the owner: ${what}; ${CD_WAIVER_BY} approved the waiver run that started $(cd_time "$CD_WAIVER_AT") (${CD_WAIVER_URL}).
"
        waivers="${waivers}Sync cooldown waived by the owner for upstream ${short} (approved by ${CD_WAIVER_BY}, $(cd_time "$CD_WAIVER_AT")).
" ;;
      *)
        refused="${refused}  - ${what}: $(cr_why).
    To waive: upstream commit ${upstream}, pull request ${PR_NUMBER}.
" ;;
    esac
  done

  if [ -n "$refused" ]; then
    printf 'This release would ship upstream changes that had not waited out the %s-hour cooldown when they were merged:\n%s' "$COOLDOWN_HOURS" "$refused"
    printf 'Only the repository owner can let it through: Actions > "%s" > Run workflow on %s, with the values above. The run waits for the owner'"'"'s approval in the environment %s; when it has finished, run the release again. Nobody else waives it, and there is no other way around it (%s).\n' \
      "$WAIVER_WORKFLOW_NAME" "$CD_BRANCH" "$WAIVER_ENVIRONMENT" "$COOLDOWN_DOCS"
    exit 1
  fi
  printf '%s' "$passed"
  [ -z "$notes" ] || printf '%s' "$waivers" > "$notes"
}

cr_main "$@"
