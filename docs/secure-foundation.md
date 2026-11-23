# Secure Foundation

**Secure Foundation** is the third choice of the add-project dialog. It creates a new project from the Secure Vibe Coding OS template ([harperaa/secure-vibe-coding-OS](https://github.com/harperaa/secure-vibe-coding-OS): Next.js, Clerk, Convex, optionally Doppler), runs the template's own install for you with the answers of one form, starts the app and gives you its URL.

It installs software from npm and creates resources in your Clerk, Convex and (if chosen) Doppler accounts. The form says what, right above its buttons, and nothing is created until you press **Go** and every check has passed.

## The form

There is one form. With the defaults it takes two clicks: the option in the add-project dialog, then **Go** once you have typed a name.

| Field | What it is |
|---|---|
| Project name | Also the site's name. The folder is the name in lower case with dashes, inside your projects folder (`~/codeharden-projects`); the full path is shown as you type. A folder that already holds something is refused. |
| Admin email | Who signs in as the site's admin. Suggested from `git config user.email` on this computer when there is one; you can change it. It goes to the install and nowhere else. |
| Secrets | **Doppler** (preselected): the app's secrets live in a Doppler project. **.env.local**: they are written to a file in the project folder that git ignores. |
| App shell | **All modules** (preselected): every content module the template has. **Minimal**: none; add them later. **Pick**: a tick box per module. |
| Advanced › Deploy | Off unless you tick it. **Create a GitHub repository and deploy to Vercel** adds a private repository and a Vercel project and publishes the site (see [Deploy](#deploy)). |
| Advanced › Runs on | Which of your signed-in agent providers runs the setup. A provider that runs project command files runs the template's `/install`; any other reads the template's install instructions and follows them. |

**Advanced** is closed to begin with; its heading says what it holds ("Deploy off · runs on …"). Under the fields the form shows the template commit that will be installed (short id and date).

Above the buttons, always in view, three lines say what pressing Go does:

- what is created in your accounts, by kind ("Creates a Clerk app, a Convex project and a Doppler project in your accounts."), following your answers;
- that the setup session runs commands inside the new project without asking for each one;
- that the app's URL only works while the setup session's processes are running.

**Details** beside them opens the verification view, which has the full lists. Pressing Go is your confirmation of these lines.

## Go

**Go** is green and can be pressed as soon as the name and the email are valid. One press does everything, in this order:

1. **The checks,** all in one pass (the button reads "Checking…"):
   - the form's answers, checked again by the server;
   - the folder: nothing may be there but an empty folder;
   - the template: its branch is resolved to a commit. If that isn't the commit the form showed, you are shown the new one first;
   - the provider that runs the setup is still signed in;
   - the sign-in of each service your choices need (Convex always, Doppler when chosen, GitHub and Vercel with the deploy).
2. **Only when every check passed:** the project is created and the setup session opens (the button reads "Creating…").

**If a check doesn't pass, nothing is created.** Go opens the verification view with what stopped it at the top and what to do about each item. Put it right there and press Go again; it runs the checks again and goes on.

Go also stops once, without anything being wrong, to show you a choice it made for you before it is used: the first of several Convex teams, the deploy's repository owner, name and Vercel scope, or a template commit newer than the one on the form.

If the create itself fails (the session can't start, say), what that attempt wrote is removed and you land in the same view with the server's reason.

## Verify Settings

**Verify Settings** opens the verification view without starting anything. It runs the same checks and shows each as passed, needing you, or failed:

- **Form, Project folder, Template, Runs on:** what the server found, with the folder's full path and the commit.
- **One row per service:** whether this computer is signed in. CodeHarden finds out by asking each service's own command-line tool; it reads, copies and stores no token or session file, and the tools keep their own sign-ins.
  - **Signed out:** **Sign in to Convex** (or Doppler) starts that tool's own login. The row shows a link to the service's sign-in page, and the code that page should show; finish in your browser and the row turns green. A login waits five minutes at most and can be cancelled; either way no process is left running.
  - **Tool not installed** (Doppler): the row shows the install command for you to run in a terminal yourself, because it can ask for your password. Then **Check again**.
  - **Several Convex teams:** pick the team the project is created in. The first one is preselected.
- **What happens when you press Go:** where the project is created, the template commit that will be installed, that packages are installed from npm, what the setup session may do, and that the app's URL only works while the setup session's processes are running.
- **What is created in your accounts,** each item by name with where you remove it.

**Check again** runs the checks again, **Back to the form** keeps your answers, and **Go** is there too. **Cancel** or closing the dialog leaves nothing behind.

**If a row says Node.js isn't on the app's path:** an app started from the Dock or a launcher gets the system's bare path, without the folders your terminal adds (Homebrew, a Node version manager). The checks ask your own shell for its path every time, so this is rare; when it still happens, start CodeHarden from a terminal where `npx` works. The same goes for the setup session: if it reports that `node` or `npm` isn't found, quit the app, start it from such a terminal and send "continue" in the session.

The commands are fixed in the product: `npx convex@<pinned version> login status` and `login --login-flow poll --no-open`, `doppler me` and `doppler login`. Nothing you type becomes part of a command.

**From a phone or another device,** sign-ins can't be checked or started: that works on the computer running CodeHarden only. Go says so in the verification view. Without the deploy you can press Go again there to go on, and the setup session checks the sign-ins on the computer it runs on and asks you in the session; with the deploy ticked, Go doesn't go on from another device.

## What gets created, and where

- **On your computer:** the project folder, as a new local git repository with a single first commit. It has no remote, no link back to the template and none of the template's history. No GitHub repository is created. `node_modules`, and `.env.local` unless you chose Doppler, are written there by the install.
- **Clerk:** an accountless Clerk app with a JWT template and a webhook endpoint. It becomes yours when you claim it (below).
- **Convex:** a project named after your project, with a cloud dev deployment, in your Convex team.
- **Doppler** (if chosen): a project named after your project, with the configs `dev` and `prd`, holding the app's secrets. The install's "CI token" step is skipped, because the project has no GitHub repository to hold that token; run `node scripts/setup.mjs doppler-create-ci-token` yourself once the project has one.

## Deploy

With **Create a GitHub repository and deploy to Vercel** ticked, the setup also runs the template's dev deploy (`/deploy-to-dev`) after the install:

- The verification view gains two rows. **GitHub** needs the `gh` command-line tool, signed in with the `repo`, `workflow` and `read:org` permissions; a missing one gets a button that adds it. **Vercel** is asked through `npx vercel@<pinned version>`.
- Once both are signed in the view shows the **repository owner** (your account is preselected, your organisations follow), the **repository name** (the folder's name unless you change it) and the **Vercel scope** (the first team is preselected). The first Go always stops there so you see these names before anything is created with them.
- The repository is created **private**. What is pushed is this project's own history: the single first commit and what the install adds, none of the template's.
- The Vercel project takes the repository's name and is connected to it, so later pushes to `main` redeploy.
- The site is **public** on a `vercel.app` address and runs on the development Clerk and Convex, the same ones as on your computer. On Vercel this uses the project's production slot, as the template's dev route does; nothing is deployed with production keys, and `/deploy-to-prod` is never run.
- With Doppler, a Doppler token is stored as the repository's Actions secret `DOPPLER_TOKEN` and as the Vercel project's only environment variable. Without Doppler, the app's environment variables, its development keys included, are copied to the Vercel project.

The verification view lists all of this by name. The setup session is given exactly those names and stops to ask if anything differs: another owner, a public repository, a production deploy. A repository or a Vercel project of that name that already exists is refused in the session's first part, before anything is created: nothing is pushed or deployed into it.

At the end you get two URLs: the local one, which only works while the setup session's processes are running, and the deployed one, which stays up. The project page shows both.

## The setup session

The setup is an ordinary agent session in the new project, called "Secure Foundation setup". It runs at the Full permission level: commands inside the project folder run without asking. It is told to refuse anything outside that folder, and CodeHarden's protected areas and always-ask rules apply as in every session (see [Security](security.md#permissions)).

It works in parts:

1. **A last check.** Node 18 or newer, npm and git; `npm install`; and that the sign-ins Go checked still hold. Only if one is missing does the session ask you (it lands in the inbox): a link to sign in to Convex, which team if you have several and chose none, or to install the Doppler CLI or run `doppler login` yourself. It never runs an installer that needs your password.
2. **The install,** without questions: the template's `/install` with your answers.
3. **The deploy,** only when you ticked it (see [Deploy](#deploy)).
4. **Starting the app:** the two dev processes (`npm run convex` and `npm run dev`, or their `:doppler` variants) as long-running processes of the session.

Its first message is the whole brief it was given: your answers, the list of what you agreed will be created, and the commands with your answers filled in. Its last message starts with the app's URL, then the Clerk claim link and how to stop and restart, and ends with **What was created**: each thing that now exists in your accounts, by name, with where to remove it.

The project page shows a **Secure Foundation setup** line: checking this computer, installing, waiting on you, running at the URL, stopped or failed.

## Claim your Clerk app

When the install is done, the project page shows **Claim your Clerk app**. On Clerk's page, click **Claim** only and sign in or create your Clerk account. Skip the setup checklist that page shows afterwards (API keys, environment variables, middleware, JWT template, webhook): the install already did all of it, and doing it again can overwrite a working configuration. The link is also in the project's `docs/INSTALL.md`.

## Stopping and restarting the app

The app runs as processes of the setup session. **The URL only works while those processes are running.**

- **Stop:** stop the setup session (or ask in it to stop the two processes). Archiving the session or quitting CodeHarden stops them too. The status then reads "Stopped".
- **Start again:** send "start the app" in the setup session, or run the two commands yourself in two terminals in the project folder: `npm run convex` and `npm run dev` (with Doppler: `npm run convex:doppler` and `npm run dev:doppler`). The URL is in the second command's output.

The status follows the setup session: if the processes end while the session is still open and the agent doesn't notice, it can still read "Running".

## If something fails

- **Before the project exists** (a sign-in is missing, the template can't be fetched, the folder exists, the session can't start): the verification view marks the check that failed and says what to do, and what that attempt created is removed.
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

The template is part of the fork's configuration: the build variables `TEMPLATE_REPOSITORY` (a GitHub `owner/repo`, default `harperaa/secure-vibe-coding-OS`) and `TEMPLATE_BRANCH` (default `main`). `TEMPLATE_REPOSITORY=none` builds without the option. Only that repository is ever fetched: no request can name another. The other defaults are one constant each in `packages/contracts/src/secure-foundation.ts`: `SECURE_FOUNDATION_DEFAULT_SECRETS`, `SECURE_FOUNDATION_SETUP_AUTONOMY`, `SECURE_FOUNDATION_REPOSITORY_MODE`, `SECURE_FOUNDATION_DEFAULT_SHELL` (the preselected app shell, `all`) and `SECURE_FOUNDATION_DEFAULT_DEPLOY` (whether the deploy option starts ticked).

The template must have what the setup session's brief names: `.claude/commands/install.md`, `scripts/setup.mjs` with the subcommands `init`, `convex-setup`, `configure`, `doppler-bootstrap`, `doppler-sync-env-local` and `write-install-summary`, `scripts/modules.mjs install`, for the deploy `.claude/commands/deploy-to-dev.md` and `scripts/deploy.mjs` (`github-setup`, `vercel-env-dev`, `vercel-deploy`, `write-summary`), and content modules under `templates/modules/<name>/module.json`.
