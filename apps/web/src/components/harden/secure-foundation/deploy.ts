import { SecureFoundationDeploy, secureFoundationFolder } from "@codeden/contracts";
import type { FormAnswers } from "./answers";

/** The repository name the form suggests: the folder's. */
export function suggestedRepository(answers: Pick<FormAnswers, "name">): string {
  return secureFoundationFolder(answers.name);
}

/**
 * The deploy part of the request, from the form's answers: undefined when the option is off,
 * null when it is on but not complete or not valid yet.
 */
export function deployOf(
  answers: Pick<
    FormAnswers,
    "name" | "deploy" | "deployOwner" | "deployRepository" | "deployScope"
  >,
): SecureFoundationDeploy | null | undefined {
  if (!answers.deploy) return undefined;
  const parsed = SecureFoundationDeploy.safeParse({
    owner: answers.deployOwner,
    repository: answers.deployRepository ?? suggestedRepository(answers),
    vercelScope: answers.deployScope,
  });
  return parsed.success ? parsed.data : null;
}
