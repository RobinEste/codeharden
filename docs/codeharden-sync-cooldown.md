# The 48-hour cooldown of upstream changes

CodeHarden takes upstream's changes every day, and none of them reaches users until it was approved and then waited 48 hours. The wait is the time in which a bad upstream change can still be caught, by the second reviewer, by the owner, or by upstream itself. This page says where the wait is enforced, what you see while it runs, and the one way around it.

## The rule

A pull request that brings upstream commits has waited out its cooldown when all of this holds:

1. It has the label `sync-approved`. The approval's time is when that label was last applied, from the pull request's timeline, not when the pull request was opened.
2. It does not have the label `sync-hold`.
3. Nothing was pushed to its head branch after the approval. The approval covers the commit that was reviewed, not a later one. Re-apply the label to start again. GitHub's times are whole seconds, so a push in the same second as the approval counts as after it.
4. 48 hours have passed since the approval.

`sync-needs-review` is not part of the rule. That label means a person merges the pull request instead of the workflow, and they may once the rule holds. A hold does not stop the clock: the 48 hours run from the approval, and the pull request is green again when the hold is taken off after them.

The rule applies to every pull request into the working branch that brings upstream commits the branch doesn't have: a `sync/...` branch, and any other branch that carries them, for example one that a sync branch was merged into.

There is one implementation, `scripts/harden/sync-cooldown.sh`, and everything below asks it. Nothing else has its own copy of the 48, of the labels or of the logic.

## Where it is enforced

| Where | What happens | How strong |
|---|---|---|
| On the pull request | The status **Sync cooldown** shows the rule's answer. | Information. A status can be written by anyone who can push, so nothing relies on it. |
| The automatic merge | The "Upstream sync merge" workflow's merge job asks the rule and merges only on "satisfied" or "waived". Its other conditions are unchanged. | Enforced: the job reads GitHub's records itself. |
| The release | `scripts/harden/release.sh` asks the rule about the pull request that brought the upstream commits in, at the moment it was merged, and refuses to cut the release otherwise. The sync workflow's release job runs the same script. | Enforced for everyone who releases with the script, which is the only way a release is made. |
| npm and the installers | Nothing of their own. `scripts/harden/publish.sh` publishes only the checked-out tag `v<VERSION>`, and the "Desktop installers" workflow builds only an existing release tag on the default branch whose `VERSION` names it. Those tags come from `release.sh`; neither can tell one that was made by hand. | As strong as the release. |
| A merge by hand | Not blocked. See [Merges by hand](#merges-by-hand). | By instruction, and caught at the release. |

So the guarantee is this: **an upstream change that was merged before its 48 hours were over cannot be released or published without the owner's waiver.** A sync that touches a protected path or a workflow file has to be merged by hand, and a merge by hand has no timer. That is the case the release check exists for.

## What a pull request shows

The "Sync cooldown report" workflow writes the status **Sync cooldown** on the head commit of each pull request the rule applies to. A pull request that brings no upstream commits gets no status.

| Status | Text | Meaning |
|---|---|---|
| pending | Not approved yet. Green 48 hours after the label sync-approved is applied. | Waiting for the review. |
| pending | Approved 2026-01-05 14:55 UTC. Green after 2026-01-07 14:55 UTC. | The clock is running. |
| pending | On hold (label sync-hold). The 48 hours since the approval end 2026-01-07 14:55 UTC. | Not to be merged while the label is on. |
| failure | Pushed 2026-01-06 09:00 UTC, after the approval (2026-01-05 14:55 UTC). Re-apply sync-approved to restart. | The approval no longer covers the head. |
| success | Approved 2026-01-05 14:55 UTC; 48 hours have passed and nothing was pushed since. | The cooldown is over. |
| success | Cooldown waived by the owner (approved by `<login>`, 2026-01-06 10:12 UTC). | See [Waiving the cooldown](#waiving-the-cooldown). Its "Details" link opens the approved run. |

All times are UTC. The workflow runs every hour, when a label is added or removed, and when a waiver run has finished, so a pull request turns green by itself within the hour after its 48 hours are over. A new head commit has no status until the next of those runs: a moved head never inherits green. You can run it at once from Actions › Sync cooldown report › Run workflow.

The sync workflow merges at 13:00 UTC. It asks the rule itself and writes the same status, so it does not depend on the hourly run.

## What a release refuses

`scripts/harden/release.sh` looks at the upstream commits between `state/upstream-base` (what the last release contained) and what the branch contains now. When there are none, it asks nothing: a release of the fork's own commits needs neither `gh` nor a network.

When there are some, it walks the branch's own line back to the last release and accounts for every step on which upstream commits arrived. A merge is traced to the pull request it belongs to, and the rule is asked about that pull request at the moment it was merged. It refuses when the pull request had not waited, when the commits came in without a pull request (a merge made by hand, a fast-forward, a direct push), and when GitHub can't be asked (no `gh`, not signed in, an outage). Two syncs in one release are judged each by itself. `--dry-run` shows what the release would be, then the same verdict, with the same exit status.

```text
release: refused. This release would ship upstream changes that had not waited out the 48-hour cooldown when they were merged:
  - upstream 1a2b3c4d came in through pull request #41 (sync/2026-01-05), merged 2026-01-05 17:15 UTC: it was merged 2 hours after sync-approved was applied (2026-01-05 14:55 UTC); it would have been allowed from 2026-01-07 14:55 UTC.
    To waive: upstream commit 1a2b3c4d5e6f..., pull request 41.
Only the repository owner can let it through: Actions > "Waive sync cooldown" > Run workflow on harden, with the values above. ...
release: nothing was changed
```

Waiting does not make it releasable. What counts is the moment of the merge: a sync that was merged early stays refused until the owner waives it. When a release goes through, it prints one line for each sync, and for a waived one it says so and writes the waiver into the release's changelog entry.

## Waiving the cooldown

Only the repository owner waives, and only for one upstream commit at a time.

1. Take the two values from the pull request's status or from the refused release: the upstream commit (its full id) and the pull request's number.
2. Actions › **Waive sync cooldown** › Run workflow, on the default branch. Enter the upstream commit and the pull request number. Leave the number empty only for upstream commits that reached the branch without a pull request.
3. The job "Check the request" runs first and says, in the run's summary, exactly what approving would waive. It refuses when the request doesn't fit: a commit that is not upstream's, a pull request that brings another commit, one that has already waited.
4. The job "Record the waiver" waits. Press **Review deployments**, tick `sync-waiver`, approve.
5. Within minutes the pull request's status reads "Cooldown waived by the owner". The sync workflow may merge it on its next run if its other conditions hold (labelled `sync-approved`, not on hold, upstream code only, checks green), and `release.sh` lets the release through.

**What a waiver covers.** The pull request's head as it was before the run started. A push to the branch in that second or afterwards voids it, like an approval. A waiver that names no pull request covers whichever merge brings that upstream commit. A waiver given after the merge covers what was merged.

**Where the record is.** The workflow writes nothing: no tag, no file, no variable. Any of those could also be written by whoever can push to the repository. The waiver is the run itself: a successful run of `sync-waiver.yml` on the working branch whose review history shows a reviewer's approval for the environment `sync-waiver`. That is GitHub's own record. It can be read without a secret (`gh api repos/<owner>/<repo>/actions/runs/<run id>/approvals`), it names who approved, the run's times say when, and it comes into being only by approving. The run's title names the upstream commit and the pull request.

GitHub keeps workflow runs for the repository's retention period, 90 days at most. A waiver is needed from the approval until the release that ships the commit, usually the same day. The release writes it into its entry in `CODEHARDEN-CHANGELOG.md`, where it stays. A waiver whose run is gone no longer counts, and is asked for again.

## The environment

The approval is GitHub's doing: a job that names an environment with required reviewers does not start before one of them approved. The workflow checks that the gate is really there, and refuses to go on when the environment is missing (GitHub would create it on first use, with no protection), has no required reviewers, admits anything but the working branch, or lets administrators skip the review.

Settings › Environments › New environment, named `sync-waiver`:

- **Required reviewers:** the owner. "Prevent self-review" off when the owner is the only reviewer, or nobody could approve a run the owner started.
- **Allow administrators to bypass configured protection rules:** off.
- **Deployment branches and tags:** "Selected branches and tags", with one rule, the working branch (`harden`).
- No secrets. The environment exists for the approval alone.

Required reviewers are available for public repositories on every plan, and for private ones on some. A repository without them has no waiver: the cooldown can't be skipped there.

## What is enforced, and what is an instruction

Enforced by code that reads GitHub's own records:

- The automatic merge waits for the rule.
- The release script refuses a sync that was merged early, came in without a pull request, or can't be checked.
- A waiver counts only when a required reviewer approved its run.

Not enforced, and said plainly:

- **A merge by hand is possible at any time.** The status is red or pending, and the release is refused afterwards, but GitHub does not stop the merge.
- **The release script runs on the owner's machine.** Someone who writes the release commit and tag by hand, or changes the script, goes around it. So does anyone who changes the scripts on the working branch; `scripts/harden/` and these workflows are protected paths for syncs, and a change to them is a pull request like any other.
- **An approval is as strong as the reviewer's sign-in.** GitHub's API lets a reviewer's token approve a waiting job, and agent sessions on the owner's machine act with the owner's sign-in. The waiver is a deliberate, separate step and a record of who took it, not a cryptographic separation.

The instructions that cover those are in [AGENTS.md](../AGENTS.md): an agent never merges a pull request whose cooldown status is not green, never approves a waiver, and reports a refused release instead of working around it.

## Merges by hand

A repository ruleset can require a status check on a branch, so the obvious question is whether "Sync cooldown" can be required for merges into the working branch. It can't be done safely here, and it is not set up:

- **The rule is not limited to pull requests.** A ruleset's required status check applies to every update of the branch: "When enabled, commits must first be pushed to another ref where the checks pass" ([REST API endpoints for rules](https://docs.github.com/en/rest/repos/rules#create-a-repository-ruleset)), and a direct push fails with "Required status check ... is failing" ([Troubleshooting required status checks](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks)).
- **Releases are direct pushes.** `release.sh --push` pushes a new commit and its tag straight to the working branch, from the owner's machine and from the sync workflow's release job. A new commit has no status, so both would be refused unless they are on the ruleset's bypass list.
- **The workflow's token has no documented bypass.** The bypass list takes repository roles, teams, deploy keys, GitHub Apps and users ([Creating rulesets for a repository](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository#granting-bypass-permissions-for-your-branch-or-tag-ruleset)). Nothing in GitHub's documentation says that the workflow token can be given one. Without it the release after every automatic merge would fail.
- **The owner's bypass is everyone's.** The owner's own push needs the bypass in the "always" mode, and agent sessions use the same sign-in, so `gh pr merge --admin` would go around the check for them too. Each bypass is listed under Insights › Rules, but it is an instruction again, not a block.
- **Every pull request would need the status.** A required check that is never reported leaves a pull request waiting for it forever. Here only pull requests that bring upstream commits get one, on purpose.

A mistake in such a rule would stop the daily sync and every release with nobody at the keyboard. If GitHub documents a bypass for the workflow token, the steps are: report the status on every pull request, add the ruleset (`POST /repos/{owner}/{repo}/rulesets`, the rule `required_status_checks` with the context `Sync cooldown`), and remove it again with `DELETE /repos/{owner}/{repo}/rulesets/{id}` if a release push is refused.

## In a fork

A fork of CodeHarden gets all of it with the sync: the rule, the status, the release check and the waiver workflow. They read the fork's own names from its repository variables. To be able to waive, create the environment `sync-waiver` as above; `scripts/harden/setup-fork.sh` does not create environments. The number of hours is `COOLDOWN_HOURS` in `scripts/harden/sync-cooldown.sh`.
