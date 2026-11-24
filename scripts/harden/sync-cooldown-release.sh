#!/usr/bin/env bash
# The cooldown, asked for a release: did every upstream commit this release would ship wait
# out its cooldown before it was merged (scripts/harden/sync-cooldown.sh has the rule)?
#
#   sync-cooldown-release.sh --prev-base <sha> --new-base <sha> --upstream-ref <ref> --branch <name> [--notes <file>]
#
# `prev-base` is the upstream commit the last release contained (state/upstream-base),
# `new-base` the one HEAD contains now. It walks the branch's own line (first parents from
# HEAD) back to where the last release's upstream base was all it had, and accounts for every
# step on which new upstream commits arrived: a merge is traced to the pull request that
# landed it, and the rule is asked about that pull request at the moment it was merged; an
# upstream commit that sits on the line itself arrived by a fast-forward or a direct push,
# with no pull request at all.
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

# Where new upstream commits arrived on the branch's own line, newest first: `landing <commit>`
# for a commit of this side that contains upstream commits its first parent lacks, and
# `direct <commit>` for an upstream commit on the line itself. Every upstream commit after $1
# arrived on exactly one of these steps, so none is left unaccounted for.
cr_arrivals() {
  local prev="$1" upstream_ref="$2" commit base parent_base
  while read -r commit; do
    if git merge-base --is-ancestor "$commit" "$upstream_ref" 2> /dev/null; then
      # From here down the line is upstream's own.
      git merge-base --is-ancestor "$commit" "$prev" 2> /dev/null || echo "direct ${commit}"
      break
    fi
    base=$(git merge-base "$commit" "$upstream_ref" 2> /dev/null) || break
    if git merge-base --is-ancestor "$base" "$prev" 2> /dev/null; then break; fi
    parent_base=$(git merge-base "${commit}^1" "$upstream_ref" 2> /dev/null) || parent_base=""
    [ "$parent_base" = "$base" ] || echo "landing ${commit}"
  done < <(git rev-list --first-parent HEAD)
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
  local prev="" new="" upstream_ref="" notes="" kind landing upstream short what refused="" passed="" waivers="" found=0
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

  # Oldest first.
  cr_arrivals "$prev" "$upstream_ref" | awk '{ line[NR] = $0 } END { for (i = NR; i > 0; i--) print line[i] }' > "$CD_TMP/arrivals"
  while read -r kind landing; do
    [ -n "$landing" ] || continue
    found=1
    upstream=$(git merge-base "$landing" "$upstream_ref")
    short="${upstream:0:8}"
    CR_PULL_REQUEST=""
    if [ "$kind" = "landing" ] && ! cr_pull_request_of "$landing"; then
      echo "GitHub could not be asked which pull request brought upstream ${short} in: $(cd_problem_text)."
      exit 2
    fi
    if [ -z "$CR_PULL_REQUEST" ]; then
      what="upstream ${short} came in through the commit ${landing:0:8} (\"$(git log -1 --format=%s "$landing")\"), which is not the merge of a pull request into ${CD_BRANCH}"
      if [ "$kind" = "direct" ]; then
        what="upstream ${short} is on ${CD_BRANCH}'s own line: it arrived by a fast-forward or a direct push, not through a pull request"
      fi
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
  done < "$CD_TMP/arrivals"
  if [ "$found" = 0 ]; then
    echo "The upstream commits in this release (${prev:0:8}..${new:0:8}) can't be traced to a step on ${CD_BRANCH}'s own line."
    exit 2
  fi

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
