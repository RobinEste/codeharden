---
section: added
---

- **Dev preview: your project's dev server, where a session works.** A switch at the top of a session starts the project's dev command in that session's own worktree, on free local ports, and shows the address once something answers there, so the page reloads as the agent edits. The PM thread gets one for the project's base branch, from a checkout the app keeps and fast-forwards as the branch moves. Set the dev command (and an optional prepare command such as `pnpm install --frozen-lockfile`) in the project's Settings › Dev preview; nothing runs until you have typed and confirmed it there, and it is never read from the repository. Settings › Dev previews has the limits (3 at once in a project, 6 in all), the port range and **Stop all**. Commands can only be set, and previews started, on the computer running the app, and agents can do neither. See [Dev preview](docs/dev-preview.md).
