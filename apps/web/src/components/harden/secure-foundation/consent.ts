import {
  type AutonomyLevel,
  HARDEN_PRODUCT_NAME,
  type SecureFoundationCreated,
  type SecureFoundationRepositoryMode,
  type SecureFoundationSecrets,
  secureFoundationCreates,
  secureFoundationFolder,
} from "@codeden/contracts";

/** What the confirm step needs to say what will happen. */
export interface ConsentInput {
  name: string;
  projectsDir: string;
  pathSeparator: string;
  secrets: SecureFoundationSecrets;
  convexTeam?: string;
  modules: string[];
  provider: { displayName: string; runsCommandFiles: boolean };
  template: { repository: string; branch: string; commit: string; committedAt: string };
  repositoryMode: SecureFoundationRepositoryMode;
  autonomy: AutonomyLevel;
}

const LEVEL: Record<AutonomyLevel, string> = {
  read_only: "Read-only",
  supervised: "Supervised",
  auto: "Auto",
  full: "Full",
};

/** The folder the project is created in, as the server will build it. */
export function projectPath(input: Pick<ConsentInput, "name" | "projectsDir" | "pathSeparator">) {
  const folder = secureFoundationFolder(input.name);
  return folder ? `${input.projectsDir}${input.pathSeparator}${folder}` : "";
}

const day = (iso: string) => iso.slice(0, 10);

/**
 * The statements of the confirm step, in order: where, from what, what runs, what it needs from
 * the person, and what the URL at the end is. Plain sentences, built from the same answers the
 * request carries.
 */
export function consentStatements(input: ConsentInput): string[] {
  const { template, provider } = input;
  const product = HARDEN_PRODUCT_NAME;
  const doppler = input.secrets === "doppler";
  return [
    input.repositoryMode === "fresh"
      ? `The project is created in ${projectPath(input)} as a new local git repository with one first commit: no remote, no link back to the template, and no GitHub repository.`
      : `The project is created in ${projectPath(input)} as a clone of the template, with its history and its remote.`,
    `Its files come from ${template.repository}, branch ${template.branch}, commit ${template.commit.slice(0, 7)} of ${day(template.committedAt)}. Exactly that commit is installed.`,
    "Packages are installed from npm (npm install), which runs those packages' own install scripts.",
    "A Clerk app and a Convex project are created for you (listed below). The sign-ins were checked on the previous step; if one is missing when the setup starts, you are asked to sign in in a browser.",
    doppler
      ? "Doppler: a Doppler project is created and the app's secrets are kept there instead of in a file. It needs the Doppler CLI, installed and signed in (checked on the previous step). The CI token step of the install is skipped, because this project has no GitHub repository to hold that token."
      : "The app's secrets are written to .env.local in the project folder, a file git ignores. Doppler is not used.",
    input.modules.length > 0
      ? `Content modules installed: ${input.modules.join(", ")}.`
      : "No content modules are installed (minimal shell). You can add them later.",
    `A setup session runs on ${provider.displayName} at the ${LEVEL[input.autonomy]} permission level: it runs commands inside the new project without asking for each one. ${provider.runsCommandFiles ? "It runs the template's /install command." : "It reads the template's install instructions and follows them."} ${product}'s protected areas and always-ask rules still apply, and it is told to refuse anything outside the project folder.`,
    "The setup first checks this computer again (Node, npm, git, the sign-ins). Only that part can ask you something, and it lands in the inbox. After it the setup runs without you.",
    `At the end you get the app's local URL. It only works while the setup session's processes are running: stopping or archiving that session, or quitting ${product}, stops the app.`,
  ];
}

/** What will exist in the person's accounts afterwards (the same list the session is held to). */
export function consentCreates(
  input: Pick<ConsentInput, "name" | "secrets" | "convexTeam">,
): SecureFoundationCreated[] {
  return secureFoundationCreates(input);
}

/** Said under the list of what is created. */
export const CREATED_STAYS =
  "None of these is removed when you archive the project or delete its folder. Remove each one where it lives.";
