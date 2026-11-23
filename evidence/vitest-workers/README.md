# Evidence: the busy-machine worker limit in the root `vitest.config.ts`

Branch `fix/vitest-workers-under-load`, commit `485ecfd08a644f4db4266c6024c6c9937249d9d1`, against `main` at `911551159b30ae44367c1cea5f2ba3fa9f755346`.

Machine: macOS, 10 CPUs, Node 24.22.1, pnpm 10.12.1, Vitest 5.1.0. It was shared and busy for the whole session (other work measured 2% to 49% idle), so most plain runs took the busy branch on their own.

Every log starts with the commit and the command and ends with the exit code. Paths are relative to the repository; home and temp paths and IP addresses are replaced with `<home>`, `<tmp>` and `<ip>`, colour codes are removed, and two kinds of noise lines are dropped (a tool warning from the session's own environment and jsdom's "Not implemented: Window's scrollTo").

## How the load was produced

- `stub-os.mjs`: a preload (`NODE_OPTIONS="--import …"`) that makes `os.cpus()` report a chosen idle share per measurement (`STUB_IDLE=0.9,0.2`: first measurement 90% idle, later ones 20%) and optionally a CPU count (`STUB_CPUS`). `STUB_TRACE=1` prints one line per measurement. Only the process that loads the config is stubbed.
- `real-load.mjs`: no stub. Starts `vitest run` for two projects, then one spinning thread per CPU after a delay, so the machine is idle at the first measurement and busy at the later ones.
- `scripts/test-under-load.mjs` (the repository's own): three `pnpm test` at once, `--runs 2`.

## Files (`main-*` on `main`, `branch-*` on the fix)

| Log | Case | `main` | Fix |
|---|---|---|---|
| `*-1-idle-then-busy-pnpm-test.log` | `pnpm test`, first measurement idle, later ones busy (stub) | 5 measurements; stops with `Projects "@codeden/contracts" and "@codeden/desktop" have different 'maxWorkers' but same 'sequence.groupOrder'`; no test runs; exit 1 | 1 measurement; 4,545 tests run; only `runner-link` fails (see below) |
| `*-9-real-load.log` | the same with real CPU load (`real-load.mjs`) | 2 of 12 tries stop with the error | 0 of 16 |
| `*-2-busy-<n>-cpus.log` | busy, with 1, 2, 3, 4, 8, 16, 32 CPUs (stub) | 2, 2, 2, 2, 2, 4, 8 workers | 1, 1, 2, 2, 2, 4, 8 workers |
| `*-3-busy-maxWorkers-camel.log` | busy with `--maxWorkers=6` | no limit set | no limit set |
| `*-3-busy-max-workers-kebab.log` | busy with `--max-workers=6` | limit set (2), which overrides the option | no limit set |
| `*-3-busy-no-file-parallelism.log` | busy with `--no-file-parallelism` | limit set (2), which overrides the option | no limit set |
| `*-3-busy-env-set.log` | busy with `VITEST_MAX_WORKERS=5` | not measured, left alone | not measured, left alone |
| `*-4-busy-slow-mode-list.log` | busy, `--mode slow` (`vitest list`, nothing is run) | limit set (2) | no limit set |
| `*-5-idle.log` | idle (90%) | 5 measurements, no limit | 1 measurement, no limit |
| `*-6-runner-link-alone*.log` | `apps/runner/test/runner-link.test.ts` on its own | passes once, then fails 3 of 6 | fails once (1 run) |
| `*-7-pnpm-test.log` | plain `pnpm test` (machine really busy: 3% and 26% idle) | 1 failed (`runner-link`), 4,485 passed | 1 failed (`runner-link`), 4,499 passed |
| `*-8-test-under-load.log` | `node scripts/test-under-load.mjs --runs 2` | 5 of 6 `pnpm test` fail, each only on `runner-link`; 1 passes | 4 of 6 fail, each only on `runner-link`; 2 pass |
| `branch-0-typecheck.log`, `branch-0-lint.log` | `pnpm typecheck`, `pnpm lint` | | pass |
| `branch-0-unit-test.log` | `scripts/test-workers.test.mjs` | | 14 pass |

`main-9-real-load.log` was recorded with the fix checked out and `main`'s `vitest.config.ts` copied beside it as `vitest.main.config.ts` (`--config`), so its header shows the fix's commit; the config under test is `main`'s.

`vitest-behaviour.log` (with the files in `vitest-behaviour/`) shows what Vitest 5.1.0 does with `VITEST_MAX_WORKERS`: it overrides `fileParallelism: false` in a project, and `--maxWorkers`, `--max-workers` and `--no-file-parallelism` on the command line.

## The `runner-link` failure

`apps/runner/test/runner-link.test.ts > aborting while the upgrade is still pending drops the socket and ends the link` times out at 40 s on this machine on `main` and on the fix alike, in full runs and on its own (`main-6-runner-link-alone-6x.log`: 3 of 6). It is the only test that failed in any run here. The fix does not touch it.
