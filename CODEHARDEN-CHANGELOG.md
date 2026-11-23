# CodeHarden releases

## 2026.1123.0917 — 2026-11-23 09:17

### codeharden
- fix(harden): never drop a ticked deploy, start one login per service, and word the clone mode truthfully
- docs: the deploy option of Secure Foundation
- feat(web): the deploy option in the Secure Foundation form, off by default
- feat(server): GitHub and Vercel connections, the deploy part of the setup brief and the deployed URL
- feat(contracts): the deploy option of Secure Foundation: the repository, the Vercel scope and what gets created
- fix(server): find the services' CLIs on the person's shell path, read afresh at each check
- docs: the Connections step of Secure Foundation
- feat(web): the Connections step of the Secure Foundation form
- feat(server): ask each service's own CLI whether it is signed in, and run its login from the form
- feat(contracts): the Connections step of Secure Foundation: sign-in state, logins and the Convex team
- fix(harden): make the Secure Foundation folder name in one pass, and never clean up through a link
- test(providers): record the project-commands capability in the Claude fixtures
- docs: Secure Foundation user guide, the fork's template variables and the changelog note
- test(harden): guard the Secure Foundation slots against upstream merges
- feat(web): the Secure Foundation option, its form and confirm step, and the setup status on the project page
- feat(server): create a project from the Secure Foundation template and start its setup session
- feat(contracts): Secure Foundation contracts, the template in the fork's configuration and a capability for project command files

## 2026.1123.0059 — 2026-11-23 00:59

### codeharden
- fix(harden): count the card surface for the wordmark's contrast, and tidy two string replacements
- feat(harden): a red and white shield logo, the CodeHarden wordmark and its own icons
- test: run the installer build step's signing guards, not just read them
- docs: sign a release cut after the strict signature check
- ci: give each system's installer build only its own signing secrets

## 2026.1123.0007 — 2026-11-23 00:07

### codeharden
- test(harden): guard the page and manifest the build names
- ci: take the expected page title from the build's own product name
- ci: expect the product's own name in the served page's title
- feat(server): give Docker sandboxes the fork's own names
- feat(web): name the page and the installed web app after the product
- test(harden): follow strings when skipping comments, check every define block
- docs: how the fork's changes are kept through upstream merges
- test(harden): fail when an upstream merge brings upstream's identity back
- docs: how the desktop installers of a release are built and published
- ci: add a manual workflow that builds the desktop installers of a release

## 2026.1122.2302 — 2026-11-22 23:02

### codeharden
- docs: CodeHarden's own home and app identity, next to CodeDen
- feat: CodeHarden runs as its own app, with its own home, port and app id
- feat(contracts): give the fork its own install identity in the channel module

## 2026.1122.2240 — 2026-11-22 22:40

### codeharden
- docs: how to make your own hardened fork
- feat(sync): add setup-fork.sh to set a hardened fork up on GitHub
- feat(sync): read the upstream, the branches and the package from repository variables
- feat(release): take the release repository from origin and the docs branch from the build
- fix(ci): keep git's hook variables out of the local test run
- ci: run the tests locally before a push while CI's test step is switched off
- docs(release): the owner can ask an agent to run the publish and open npm's approval page
- ci(sync): leave sync pull requests that touch scripts/harden/ for a manual merge

## 2026.1122.2133 — 2026-11-22 21:33

### codeharden
- feat(release): add release.sh and publish.sh, and run release.sh from the sync workflow
- feat(release): add the manual npm release script and skill
- chore(github): link the CodeHarden Skool community from the issue chooser
- chore(github): add issue templates that route security reports privately
- fix(updates): encode the package name as one segment of the registry URL
- style(server): format the registry query
- fix(updates): escape every slash in the registry query and match the API host exactly in the test
- docs: name the codeharden package, command and repository in the user docs
- docs: point the desktop download links at the channel's releases and add the changelog note
- feat(web): build release, docs and command text from the update channel
- feat(desktop): update from the channel's GitHub releases, quietly without a feed
- feat(updates): self-update from the channel's npm package
- feat(contracts): add the update channel module and its build-time define
- docs: add the changelog note for the version display
- feat(desktop): show the version line in the window title, About and the start-up lines
- feat(web): show the version line in Settings > About from the server's fields
- feat(cli): show the CodeHarden and upstream versions in --version, help, doctor and the start-up line
- feat(server): report the CodeHarden and upstream versions in health and the snapshot
- build: inject the CodeHarden version from VERSION at build time
- feat(contracts): add the CodeHarden version module and version API fields
- fix(providers): locate a supported CLI copy before a runner's first session
- docs: a review started from a session is Read-only; PM and factory sessions take the project's default
- docs: what the autonomy mode changes about approvals, and where other levels come from
- test(server): cover the back-off states the provider listing really shows
- fix(server): say exactly what start_session and defaultProvider do with a provider id
- docs: say exactly when a role session moves provider and what is dropped
- fix(server): keep a retired role session retired, and leave one with a message on its way
- docs(server): say exactly which artifact names failed before (#68)
- docs(server): state the tests check's test-file rules and limits exactly
- docs(workbench): say which shells start as a login shell on macOS
- test(providers): cover every shell that starts as a login shell on macOS
- docs: say which sessions block archiving a project
- fix(web): block archiving a project for every working session status
- fix(server): refuse to archive a project with working sessions
- refactor(contracts): share the list of active session statuses
- fix(providers): prefer a CLI copy that meets the provider's minimum version
- feat(server): list the loaded providers in start_session's provider parameter
- docs: where a session's permission level comes from
- test(providers): sed that only prints runs freely at Auto
- fix(server): update_project says existing sessions keep their level
- fix(web): name the open sessions a project's permissions don't reach
- fix(server): serve artifacts whose names hold non-Latin-1 characters
- fix(server): recognise more test file names in the factory's tests check
- fix(server): move the orchestrator and PMs to the provider chosen in settings
- test(runner): read the stalled server's socket so it sees the link drop
- feat(web): archive a project from its sidebar menu
- fix(runner): start macOS terminals as a login shell

## 2026.1122.2006 — 2026-11-22 20:06

### upstream (leonvanzyl/codeden)
- starts from 91155115: Auto: `Invoke-WebRequest … -OutFile <outside>` and PowerShell's `${C:\path}` file syntax read and write files outside the worktree without asking (#548)

### codeharden
- ci: release CodeHarden after merged upstream syncs
- ci: merge approved upstream sync pull requests after 48 hours
- docs: introduce CodeHarden
