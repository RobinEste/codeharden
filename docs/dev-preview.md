# Dev preview

A **dev preview** is your project's dev server, started by the app where a session works, with its address shown at the top of that session.

Every agent session works in a worktree of its own, so a dev server you started in the project folder never sees a session's edits. A dev preview runs the project's dev command inside the session's worktree instead, on ports the app picks, and the page reloads as the agent changes files, exactly as it does when you code in a terminal with `npm run dev` running.

There are two kinds:

- **A session's preview**, off by default. A switch at the top of the session turns it on.
- **The PM thread's preview**, on by default once the project has a dev command. It shows the project's **base branch** (the project's own default branch, whatever it is called), from a checkout the app keeps for this, and follows the branch as it moves.

Nothing runs for a project until you have set it up.

## Set it up

Open the project, **Settings**, **Dev preview**.

| Field | What it is |
|---|---|
| Dev command | The command that starts the dev server, as you would type it in a terminal in the project: `pnpm dev`, `npm run dev`, `bin/rails server -p {port}`. |
| Prepare command | Optional. Run before the first start in a worktree, and again when a lockfile there changes: `pnpm install --frozen-lockfile`, `npm ci`, `bundle install`. A new worktree has no installed dependencies, so most projects need one. |
| Port variables | The environment variables the app puts the ports in. `PORT` by default. Name up to four, separated by commas, for a project that needs more than one port; each gets its own free port, and the first is the page the link opens. A name must contain `PORT` (`WEB_PORT`, `VITE_PORT`), so a port can never land in a variable that changes what your shell runs. |
| Link | **First port**: `http://localhost:<the first port>`. **From the output**: the first local URL the dev command prints, for dev servers that choose their own port. A pattern (a regular expression whose first group is the URL) narrows that down. An address on the app's own port is never taken. |
| On the PM thread | Whether a preview of the base branch runs for the PM thread. On by default; your choice is kept. |

If the project has a `dev` script, the form offers a command to fill in (`pnpm dev`, `yarn dev`, `bun run dev` or `npm run dev`, by the lockfile it finds). That only fills the field.

**Save** shows the exact commands and asks **Run these commands on this computer?** Only after **Save and allow** are they stored, and only then can a preview start. Changing a command later asks again; previews that were running stop, the PM thread's starts again with the new commands, and a session's starts when you turn it on again. **Remove** forgets the commands, stops the project's previews and takes the base branch's checkout away, with what git ignores in it (installed dependencies, build output). A checkout that has changes or untracked files is kept.

### Ports in the command

Most dev servers read `PORT`. For one that takes its port as an argument, write `{port}` in the command, and `{port2}`, `{port3}`, `{port4}` for further ports:

```
vite --port {port} --strictPort
```

`{port}` is the first port and `{port2}` the second, in the same order as the port variables. Those placeholders are the only things the app ever replaces in your command, and only with a port number.

### This repository (CodeHarden itself)

`pnpm dev` uses two fixed ports, so two worktrees can't run it side by side. Use the script made for this:

| Field | Value |
|---|---|
| Dev command | `node scripts/harden/dev-preview/run.mjs` |
| Prepare command | `pnpm install --frozen-lockfile` |
| Port variables | `WEB_PORT, API_PORT` |
| Link | First port |

It starts the server on `API_PORT` and the web app (Vite) on `WEB_PORT`, with the Fake provider on, and a home of its own in `.codeden-dev/` inside that worktree, so a preview never touches your installed app's data or another worktree's. Stopping the preview also stops the runner that dev server started.

## At the top of a session

| It shows | Meaning |
|---|---|
| The switch, off | No preview. Turn it on to start one. |
| **Preparing** | The prepare command is running in the session's worktree. |
| **Starting** | The dev command is running; nothing answers on its port yet. |
| **Running** and a link | Something answers on the port. The link opens it. |
| **Stopped** and a reason | It ran and ended: the dev command exited, the session was stopped or archived, or it was stopped to make room. **Restart** starts it again. |
| **Failed** and a reason | It never came up. The last lines of its output are shown underneath. |

**Log** opens everything the prepare and dev commands printed since the last start.

The link appears only once something is actually listening: the app tries the port instead of trusting that the command says it is ready. With **From the output** the address itself is the one the command printed, so it is as trustworthy as the project's dev script.

The preview keeps running while the agent works, whatever the agent restarts. If the dev command exits by itself, the app starts it again **once**; if it exits again, the preview says so and waits for you. It stops when you switch it off, when the session is stopped, fails or is archived, when its worktree is cleaned up, and when the app quits.

The switch is disabled, with the reason, where a preview has nowhere to run: a session that works in the project folder instead of a worktree of its own (projects that aren't git repositories), a read-only session, a session in a sandbox, and a session that is stopped.

## On the PM thread

The base branch's preview runs from **a checkout of its own**, inside the app's home (`dev-preview/base/<project>`). It is never your project folder, and never a session's worktree.

- About every 90 seconds, and when you press **Update now**, the app fetches the base branch from the project's remote (for a project without a remote, it reads the local branch) and **fast-forwards** the checkout to it. The dev server's own reload picks the new files up.
- The dev command is restarted only when it must be: when a lockfile changed, so the prepare command ran again, or after it stopped.
- It follows **the branch you confirmed**. Saving the settings records the project's base branch at that moment, and the dialog names it. If the project's base branch is changed later (the orchestrator can change it, and so can project settings opened from another device), the preview stops and says so, and runs nothing from the new branch until you save the dev preview settings again on this computer.
- The app's own git commands in your project run without the repository's git hooks, and never prune or remove your other worktrees.
- The checkout only ever moves forward. If it can't be fast-forwarded, because someone committed in it, edited a file that the update would overwrite, or the branch was rewritten, the preview **stops with a message** and the checkout is left exactly as it is. The app never resets it, discards anything or deletes it. Sort the folder out (or move it away) and press **Update now**.
- A project with no dev command shows **Set up a dev preview** on the PM thread and nothing else.

## Limits

**Settings**, **Dev previews**:

- **At once in a project** (3) and **at once in all projects** (6). The PM threads' previews count. When you start one over the limit, the app stops the oldest idle preview, which then says it was stopped to make room. A preview whose session is working is never stopped for this; if all of them are, the start is refused. A preview the app starts by itself (the PM thread's) never stops anyone else's.
- **Ports**: the range previews get their ports from (43100 to 43199). A port in use is skipped. The app's own port, 4417 and 4317 are never given out, whatever the range.
- **Stop all** ends every preview in every project. The PM threads' previews then stay stopped until you press **Restart** on one. Quitting the app also stops everything; the PM threads' previews come back when it starts again.

## What runs, and as what

Read this before you set a project up: a dev preview runs the project's code on your computer.

- **Only commands you confirmed.** The dev and prepare commands are the ones you typed and confirmed in the project's settings. They are never read from the repository: not from `package.json`, not from `.codeden/project.json`, not from anything a branch or a pull request can change. A project you added from a repository you don't trust can't run anything through this feature until you type and confirm a command for it. Remember that the command then runs that repository's code: `pnpm dev` runs whatever its `dev` script says, in every worktree, including a session's branch that an agent wrote, and on the PM thread whatever is merged into the base branch, as soon as it is merged.
- **Only on this computer.** With network access on, a phone or another device sees a preview's state, its address and its log, and can stop it. It can't set or change a command, change the limits, start a session's preview, or switch on or update the PM thread's. The address is `localhost`, so it only opens on the computer running the app.
- **Only a person.** There is no agent tool for any of this. An agent can't turn a preview on and can't change the command. The commands aren't part of the project's own settings, so the orchestrator's and PMs' project tools can't reach them, and the branch the PM thread's preview follows is the one you confirmed (above). They are stored in a file in the app's home (`dev-preview.json`), which agents are kept out of by the same guard as the app's other files; that guard has known gaps, listed under Permissions in [Security](security.md), and an agent that got past it could plant a command there.
- **Like your terminal.** The command is handed whole to your own shell, in the worktree, with your environment minus the app's own variables. Nothing is added to the command text except the port numbers described above.
- **Loopback.** The app picks ports that are free on this computer and passes `HOST=127.0.0.1`, which most dev servers obey. But a dev server listens however its command makes it listen: a command with `--host 0.0.0.0` is reachable from your network. Keep it on this computer unless you mean otherwise.
- **The output is yours.** A preview's log can hold whatever the project prints, secrets included. It is kept in memory only (the last 2,000 lines), shown when you open it, and never written into a transcript, an event or a file.
- **Nothing left behind.** Each preview runs in its own process group. Stopping it ends the group and everything it started. If the app is killed or crashes, the next start ends what was left running, after checking that each process really is the one it started.

## Limits of this version

- Previews run on the computer the app runs on. Sessions in a sandbox (Docker) have none.
- A prepare command that hasn't finished after 30 minutes is ended, and the preview fails.
- The prepare command runs again when a lockfile at the root of the worktree changes (`pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, `bun.lock`, `Cargo.lock`, `go.sum`, `Gemfile.lock` and the like), or when you change the command. A session's preview checks when it starts; the PM thread's also after every update.
- A session's preview is off again after the app restarts; the PM thread's comes back by itself.
- After a crash, a process a dev server had started *outside its own process group* can survive until you end it. A normal stop finds those too.
- The UI asks for a preview's state every few seconds while a thread is open, so a change can take a moment to show.
- Windows: previews start and stop there, but this version was only tested on macOS.
