# Secure Foundation

**Secure Foundation** is the third choice of the add-project dialog. It creates a new project from the Secure Vibe Coding OS template ([harperaa/secure-vibe-coding-OS](https://github.com/harperaa/secure-vibe-coding-OS): Next.js, Clerk, Convex, optionally Doppler), runs the template's own install for you with the answers of one form, starts the app and gives you its URL.

It installs software from npm and creates resources in your Clerk, Convex and (if chosen) Doppler accounts. The form says exactly what before anything happens, and nothing starts until you confirm.

## The form

| Field | What it is |
|---|---|
| Project name | Also the site's name. The folder is the name in lower case with dashes, inside your projects folder (`~/codeharden-projects`); the full path is shown as you type. A folder that already holds something is refused. |
| Admin email | Who signs in as the site's admin. Suggested from `git config user.email` on this computer when there is one; you can change it. It goes to the install and nowhere else. |
| Secrets | **Doppler** (preselected): the app's secrets live in a Doppler project. **.env.local**: they are written to a file in the project folder that git ignores. |
| App shell | **Minimal** (preselected), **All modules**, or **Pick** with a tick box per content module the template has. |
| Deploy | Off unless you tick it. **Create a GitHub repository and deploy to Vercel** adds a private repository and a Vercel project and publishes the site (see [Deploy](#deploy)). |
| Runs on | Which of your signed-in agent providers runs the setup. A provider that runs project command files runs the template's `/install`; any other reads the template's install instructions and follows them. |

## Connections

After the form, **Connections** lists the services your choices need (Convex always, Doppler when chosen) and whether this computer is signed in to each. CodeHarden finds out by asking each service's own command-line tool; it reads, copies and stores no token or session file, and the tools keep their own sign-ins.

- **Signed out:** **Sign in to Convex** (or Doppler) starts that tool's own login. The step shows a link to the service's sign-in page, and the code that page should show; finish in your browser and the row turns green. A login waits five minutes at most and can be cancelled; either way no process is left running.
- **Tool not installed** (Doppler): the step shows the install command for you to run in a terminal yourself, because it can ask for your password. Then **Check again**.
- **Several Convex teams:** pick the team the project is created in. The first one is preselected.

**If a row says Node.js isn't on the app's path:** an app started from the Dock or a launcher gets the system's bare path, without the folders your terminal adds (Homebrew, a Node version manager). The step asks your own shell for its path at every check, so this is rare; when it still happens, start CodeHarden from a terminal where `npx` works. The same goes for the setup session: if it reports that `node` or `npm` isn't found, quit the app, start it from such a terminal and send "continue" in the session.

The commands are fixed in the product: `npx convex@<pinned version> login status` and `login --login-flow poll --no-open`, `doppler me` and `doppler login`. Nothing you type becomes part of a command. These checks and logins work on the computer running CodeHarden only: from a phone or another device the step says so and the setup session asks you there instead.

Then **Review** shows what will happen: where the project is created, the template commit that will be installed (short id and date), that packages are installed from npm, what is created in your accounts and where you remove each item, what the setup session may do, and that the app's URL only works while the setup session's processes are running. **Create project and start setup** starts it; **Cancel** or closing the dialog leaves nothing behind.

If the template gained a commit while you were reading, nothing is created: the new commit is shown and you confirm again.

## What gets created, and where

- **On your computer:** the project folder, as a new local git repository with a single first commit. It has no remote, no link back to the template and none of the template's history. No GitHub repository is created. `node_modules`, and `.env.local` unless you chose Doppler, are written there by the install.
- **Clerk:** an accountless Clerk app with a JWT template and a webhook endpoint. It becomes yours when you claim it (below).
- **Convex:** a project named after your project, with a cloud dev deployment, in your Convex team.
- **Doppler** (if chosen): a project named after your project, with the configs `dev` and `prd`, holding the app's secrets. The install's "CI token" step is skipped, because the project has no GitHub repository to hold that token; run `node scripts/setup.mjs doppler-create-ci-token` yourself once the project has one.

## Deploy

With **Create a GitHub repository and deploy to Vercel** ticked, the setup also runs the template's dev deploy (`/deploy-to-dev`) after the install:

- **Connections** gains two rows. **GitHub** needs the `gh` command-line tool, signed in with the `repo`, `workflow` and `read:org` permissions; a missing one gets a button that adds it. **Vercel** is asked through `npx vercel@<pinned version>`.
- Once both are signed in you choose the **repository owner** (your account is preselected, your organisations follow), the **repository name** (the folder's name unless you change it) and the **Vercel scope** (the first team is preselected).
- The repository is created **private**. What is pushed is this project's own history: the single first commit and what the install adds, none of the template's.
- The Vercel project takes the repository's name and is connected to it, so later pushes to `main` redeploy.
- The site is **public** on a `vercel.app` address and runs on the development Clerk and Convex, the same ones as on your computer. On Vercel this uses the project's production slot, as the template's dev route does; nothing is deployed with production keys, and `/deploy-to-prod` is never run.
- With Doppler, a Doppler token is stored as the repository's Actions secret `DOPPLER_TOKEN` and as the Vercel project's only environment variable. Without Doppler, the app's environment variables, its development keys included, are copied to the Vercel project.

The confirm step lists all of this by name. The setup session is given exactly those names and stops to ask if anything differs: another owner, a public repository, a production deploy. A repository or a Vercel project of that name that already exists is refused in the session's first part, before anything is created: nothing is pushed or deployed into it.

At the end you get two URLs: the local one, which only works while the setup session's processes are running, and the deployed one, which stays up. The project page shows both.

## The setup session

The setup is an ordinary agent session in the new project, called "Secure Foundation setup". It runs at the Full permission level: commands inside the project folder run without asking. It is told to refuse anything outside that folder, and CodeHarden's protected areas and always-ask rules apply as in every session (see [Security](security.md#permissions)).

It works in parts:

1. **A last check.** Node 18 or newer, npm and git; `npm install`; and that the sign-ins from the Connections step still hold. Only if one is missing does the session ask you (it lands in the inbox): a link to sign in to Convex, which team if you have several and chose none, or to install the Doppler CLI or run `doppler login` yourself. It never runs an installer that needs your password.
2. **The install,** without questions: the template's `/install` with your answers.
3. **The deploy,** only when you ticked it (see [Deploy](#deploy)).
4. **Starting the app:** the two dev processes (`npm run convex` and `npm run dev`, or their `:doppler` variants) as long-running processes of the session.

Its last message starts with the app's URL, then the Clerk claim link and how to stop and restart.

The project page shows a **Secure Foundation setup** line: checking this computer, installing, waiting on you, running at the URL, stopped or failed.

## Claim your Clerk app

When the install is done, the project page shows **Claim your Clerk app**. On Clerk's page, click **Claim** only and sign in or create your Clerk account. Skip the setup checklist that page shows afterwards (API keys, environment variables, middleware, JWT template, webhook): the install already did all of it, and doing it again can overwrite a working configuration. The link is also in the project's `docs/INSTALL.md`.

## Stopping and restarting the app

The app runs as processes of the setup session. **The URL only works while those processes are running.**

- **Stop:** stop the setup session (or ask in it to stop the two processes). Archiving the session or quitting CodeHarden stops them too. The status then reads "Stopped".
- **Start again:** send "start the app" in the setup session, or run the two commands yourself in two terminals in the project folder: `npm run convex` and `npm run dev` (with Doppler: `npm run convex:doppler` and `npm run dev:doppler`). The URL is in the second command's output.

The status follows the setup session: if the processes end while the session is still open and the agent doesn't notice, it can still read "Running".

## If something fails

- **Before the project exists** (the template can't be fetched, the folder exists, the session can't start): the dialog says which step failed, and what that attempt created is removed.
- **During checks and sign-ins:** the session stops and says what exists so far: the project folder, and nothing at Clerk, Convex or Doppler. Send "continue" in the session to resume.
- **During the install:** the session stops, names the step and says what was already created in your accounts.

## Removing the project

1. Stop the setup session, then archive the project in CodeHarden.
2. Delete the project folder.

Neither step removes anything from your accounts. Remove each there:

- **Clerk:** in the Clerk dashboard, after claiming the app. An app you never claimed expires by itself.
- **Convex:** in the Convex dashboard, in the project's settings.
- **Doppler:** in the Doppler dashboard, in the project's settings.
- **GitHub** (if you deployed): the repository's settings, Danger Zone.
- **Vercel** (if you deployed): the project's settings. Removing the project takes the site down.

## What isn't in it yet

- **Your own Clerk keys.** The install always creates the accountless Clerk app. The template's install takes existing keys only as command-line arguments, where other programs on the computer could read a secret key, so the form doesn't ask for them.
- **A production deploy.** The template's `/deploy-to-prod` (production Clerk, custom domain, billing) is yours to run when you are ready.

## For fork owners

The template is part of the fork's configuration: the build variables `TEMPLATE_REPOSITORY` (a GitHub `owner/repo`, default `harperaa/secure-vibe-coding-OS`) and `TEMPLATE_BRANCH` (default `main`). `TEMPLATE_REPOSITORY=none` builds without the option. Only that repository is ever fetched: no request can name another. The other defaults are one constant each in `packages/contracts/src/secure-foundation.ts`: `SECURE_FOUNDATION_DEFAULT_SECRETS`, `SECURE_FOUNDATION_SETUP_AUTONOMY`, `SECURE_FOUNDATION_REPOSITORY_MODE`, `SECURE_FOUNDATION_DEFAULT_SHELL` and `SECURE_FOUNDATION_DEFAULT_DEPLOY` (whether the deploy option starts ticked).

The template must have what the setup session's brief names: `.claude/commands/install.md`, `scripts/setup.mjs` with the subcommands `init`, `convex-setup`, `configure`, `doppler-bootstrap`, `doppler-sync-env-local` and `write-install-summary`, `scripts/modules.mjs install`, for the deploy `.claude/commands/deploy-to-dev.md` and `scripts/deploy.mjs` (`github-setup`, `vercel-env-dev`, `vercel-deploy`, `write-summary`), and content modules under `templates/modules/<name>/module.json`.
