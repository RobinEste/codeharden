import {
  isSecureFoundationSetup,
  type SecureFoundationPhase,
  secureFoundationStatus,
} from "@codeden/contracts";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ExternalLink, ShieldCheck } from "lucide-react";
import { useClient } from "@/lib/api";
import { useSnapshot } from "@/lib/queries";
import { secureFoundationDocsUrl, secureFoundationRemovalUrl } from "./copy";
import { secureFoundationKey } from "./use-secure-foundation";

const LABEL: Record<SecureFoundationPhase, string> = {
  cloning: "Cloning",
  preparing: "Checking this computer",
  installing: "Installing",
  waiting: "Waiting on you",
  running: "Running",
  stopped: "Stopped",
  failed: "Failed",
};

const HINT: Partial<Record<SecureFoundationPhase, string>> = {
  waiting: "The setup session has a question or something for you to read.",
  stopped:
    'The setup session ended, so the app\'s processes are gone. Open the session and send "start the app", or run the two dev commands in a terminal in the project folder.',
  failed: 'Open the setup session to see what went wrong; sending "continue" there resumes it.',
};

/**
 * A project's "Secure Foundation setup" status: derived from its setup session, with the app's
 * URL while that session's processes run. Renders nothing for any other project.
 */
export function SecureFoundationStatus({ projectId }: { projectId: string }) {
  const client = useClient();
  const { data } = useSnapshot();
  const session = (data?.sessions ?? [])
    .filter((s) => s.projectId === projectId && isSecureFoundationSetup(s))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const status = session ? secureFoundationStatus(session) : null;
  const finished = status?.phase === "running" || status?.phase === "stopped";
  const finish = useQuery({
    queryKey: [...secureFoundationKey, "finish", projectId, status?.phase],
    queryFn: () => client.secureFoundation.finish(projectId),
    enabled: Boolean(session) && finished,
    gcTime: 0,
  });
  if (!session || !status) return null;
  const claim = finish.data?.clerkClaimUrl;
  return (
    <section
      className="rounded-xl border border-border p-3 text-xs"
      aria-label="Secure Foundation setup"
      data-testid="secure-foundation-status"
      data-phase={status.phase}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <ShieldCheck className="size-4 text-muted-foreground" />
        <span className="font-medium">Secure Foundation setup</span>
        <span className="rounded-md bg-accent px-1.5 py-0.5 text-2xs">
          {LABEL[status.phase]}
          {status.url ? " at " : ""}
          {status.url && (
            <a
              href={status.url}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
            >
              {status.url}
            </a>
          )}
        </span>
        <Link
          to="/sessions/$sessionId"
          params={{ sessionId: session.id }}
          className="ml-auto text-2xs text-muted-foreground hover:text-foreground"
        >
          Open the setup session →
        </Link>
      </div>
      {status.phase === "running" && (
        <p className="mt-1.5 text-2xs text-muted-foreground">
          The URL only works while the setup session's processes are running. Stop the app by
          stopping that session.{" "}
          <a
            href={secureFoundationDocsUrl()}
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            Stopping, restarting and removing
          </a>
        </p>
      )}
      {HINT[status.phase] && (
        <p className="mt-1.5 text-2xs text-muted-foreground">{HINT[status.phase]}</p>
      )}
      {finish.data?.deployedUrl && (
        <p className="mt-2 text-2xs" data-testid="secure-foundation-deployed">
          <span className="font-medium">Deployed (dev):</span>{" "}
          <a
            href={finish.data.deployedUrl}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2"
          >
            {finish.data.deployedUrl}
          </a>{" "}
          <span className="text-muted-foreground">
            Public, on the development Clerk and Convex. It stays up when the setup session stops.
          </span>
        </p>
      )}
      {(finished || status.phase === "failed") && (
        <p className="mt-2 text-2xs text-muted-foreground" data-testid="secure-foundation-created">
          What was created in your accounts is listed at the end of the setup session, with where to
          remove each item. Archiving the project or deleting its folder removes none of it.{" "}
          <a
            href={secureFoundationRemovalUrl()}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2"
          >
            Removing the project
          </a>
        </p>
      )}
      {claim && (
        <p className="mt-2 flex flex-wrap items-center gap-2 text-2xs">
          <a
            href={claim}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 font-medium hover:bg-accent/40"
            data-testid="secure-foundation-claim"
          >
            Claim your Clerk app <ExternalLink className="size-3" />
          </a>
          <span className="text-muted-foreground">
            Click Claim only, and skip the setup checklist on that page: the install already did all
            of it.
          </span>
        </p>
      )}
    </section>
  );
}
