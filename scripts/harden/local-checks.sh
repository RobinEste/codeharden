#!/usr/bin/env bash
# The tests, run on this machine before a branch is pushed for a pull request.
#
# While CI's test step is switched off (the repository variable CI_TESTS=off; see "Local test
# gate" in AGENTS.md), this is where `pnpm test` runs and where a failure blocks. The pre-push
# hook (scripts/harden/hooks/pre-push) calls it; run it yourself first to see the result
# sooner. A pass is remembered for the exact tree that was tested, so pushing that commit
# afterwards doesn't run the tests again.
#
#   scripts/harden/local-checks.sh           test the checked-out commit and remember a pass
#   scripts/harden/local-checks.sh --status  say whether this commit's tree has passed
set -euo pipefail

# Inside a hook git exports its own variables (GIT_DIR, GIT_INDEX_FILE, ...). They must never
# reach the tests: tests create repositories of their own, and with these set their git
# commands would act on this repository instead. Drop them; git finds this repository from the
# folder again.
top=$(git rev-parse --show-toplevel)
# shellcheck disable=SC2046
unset $(git rev-parse --local-env-vars)
cd "$top"
passed_file="$(git rev-parse --git-common-dir)/harden-tests-passed"
tree=$(git rev-parse 'HEAD^{tree}')

has_passed() { [ -f "$passed_file" ] && grep -qx "$tree" "$passed_file"; }

if [ "${1:-}" = "--status" ]; then
  if has_passed; then echo "local checks: this commit's tree has passed the tests."; exit 0; fi
  echo "local checks: this commit's tree has not passed the tests yet."; exit 1
fi

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "local checks: tracked files have changes that aren't committed. The tests must run on what you push: commit them first." >&2
  exit 1
fi
if has_passed; then
  echo "local checks: this commit's tree already passed the tests."
  exit 0
fi

# Node and pnpm, also from a shell whose PATH doesn't have them. Only those two programs are
# linked into a private folder, so nothing else that lives beside them joins the PATH.
if ! command -v pnpm > /dev/null 2>&1 || ! command -v node > /dev/null 2>&1; then
  bin="$(git rev-parse --git-common-dir)/harden-hook-bin"
  mkdir -p "$bin"
  for dir in "$HOME"/.nvm/versions/node/*/bin /opt/homebrew/bin /usr/local/bin "$HOME/Library/pnpm" "$HOME/.local/share/pnpm"; do
    for tool in node pnpm; do
      if [ ! -e "$bin/$tool" ] && [ -x "$dir/$tool" ]; then ln -sf "$dir/$tool" "$bin/$tool"; fi
    done
  done
  PATH="$bin:$PATH"
  if ! command -v pnpm > /dev/null 2>&1 || ! command -v node > /dev/null 2>&1; then
    echo "local checks: node and pnpm were not found, so the tests can't run. Put them on PATH and try again." >&2
    exit 1
  fi
fi

# The tests use system tools (lsof, ps) that a trimmed PATH may not include.
PATH="$PATH:/usr/bin:/bin:/usr/sbin:/sbin"
export PATH
if env | grep -q '^GIT_DIR=\|^GIT_INDEX_FILE=\|^GIT_WORK_TREE='; then
  echo "local checks: git's own variables are still set; refusing to run the tests with them." >&2
  exit 1
fi

echo "local checks: running pnpm test on $(git rev-parse --short HEAD) ..."
if ! pnpm test; then
  echo >&2
  echo "local checks: the tests FAILED. Nothing was pushed. Fix them and try again." >&2
  exit 1
fi
if [ "$(git rev-parse 'HEAD^{tree}')" != "$tree" ] || [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "local checks: the checkout changed while the tests ran; run them again." >&2
  exit 1
fi
echo "$tree" >> "$passed_file"
echo "local checks: the tests passed."
