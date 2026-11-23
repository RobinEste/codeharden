import {
  isLoginRunning,
  type SecureFoundationConnection,
  type SecureFoundationLogin,
  type SecureFoundationService,
  secureFoundationServices,
} from "@codeden/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, CircleAlert, ExternalLink, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useClient } from "@/lib/api";
import { deployOf } from "./deploy";
import { DeployFields } from "./deploy-fields";
import type { FormAnswers } from "./form-step";
import { secureFoundationKey } from "./use-secure-foundation";

const LABEL: Record<SecureFoundationService, string> = {
  convex: "Convex",
  doppler: "Doppler",
  github: "GitHub",
  vercel: "Vercel",
};

/** One service: its state, and its login while one runs. */
function Row({
  connection,
  onChanged,
}: {
  connection: SecureFoundationConnection;
  onChanged: () => void;
}) {
  const client = useClient();
  const { service } = connection;
  const [login, setLogin] = useState<SecureFoundationLogin | null>(null);
  const [error, setError] = useState<string | null>(null);
  const running = login !== null && isLoginRunning(login);
  const loginId = login?.id;
  // Poll while the login runs. The link and the code stay in this component: no store, no cache.
  useEffect(() => {
    if (!loginId || !running) return;
    const timer = setInterval(() => {
      void client.secureFoundation.login(loginId).then(
        (next) => {
          setLogin(next);
          if (!isLoginRunning(next)) onChanged();
        },
        () => setLogin(null),
      );
    }, 1500);
    return () => clearInterval(timer);
  }, [client, loginId, running, onChanged]);
  // Leaving the step stops a login that is still waiting.
  const latest = useRef(login);
  latest.current = login;
  useEffect(
    () => () => {
      const open = latest.current;
      if (open && isLoginRunning(open))
        void client.secureFoundation.cancelLogin(open.id).catch(() => {});
    },
    [client],
  );

  const start = () => {
    setError(null);
    client.secureFoundation.startLogin(service).then(setLogin, (e: Error) => setError(e.message));
  };
  const cancel = () => {
    if (login)
      void client.secureFoundation.cancelLogin(login.id).then(setLogin, () => setLogin(null));
  };
  const ok = connection.signedIn === true && connection.missingScopes.length === 0;
  return (
    <li className="rounded-lg border border-border p-2.5" data-testid={`connection-${service}`}>
      <div className="flex items-center gap-2">
        {ok ? (
          <Check className="size-4 text-emerald-500" />
        ) : (
          <CircleAlert className="size-4 text-amber-500" />
        )}
        <span className="text-[13px] font-medium">{LABEL[service]}</span>
        <span className="text-2xs text-muted-foreground">{connection.message}</span>
        {connection.signedIn === true && connection.missingScopes.length > 0 && !running && (
          <Button size="sm" className="ml-auto" onClick={start}>
            Add the {connection.missingScopes.join(", ")} permission
          </Button>
        )}
        {connection.cli === "ready" && connection.signedIn === false && !running && (
          <Button size="sm" className="ml-auto" onClick={start}>
            Sign in to {LABEL[service]}
          </Button>
        )}
        {running && (
          <Button size="sm" variant="ghost" className="ml-auto" onClick={cancel}>
            Cancel
          </Button>
        )}
      </div>
      {connection.cli === "missing" && connection.install && (
        <p className="mt-1.5 text-2xs text-muted-foreground">
          Install it yourself in a terminal (it can ask for your password), then check again:{" "}
          <code className="rounded bg-accent px-1 py-0.5">{connection.install}</code>
        </p>
      )}
      {login && login.status !== "done" && (
        <div className="mt-1.5 space-y-1 text-2xs" role="status">
          <p className="flex items-center gap-1.5 text-muted-foreground">
            {running && <Loader2 className="size-3 animate-spin" />}
            {login.message}
          </p>
          {login.url && (
            <p>
              <a
                href={login.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-medium underline underline-offset-2"
              >
                Open the {LABEL[service]} sign-in page <ExternalLink className="size-3" />
              </a>
              {login.code && (
                <>
                  {" "}
                  The page should show the code{" "}
                  <code className="rounded bg-accent px-1 py-0.5">{login.code}</code>
                </>
              )}
            </p>
          )}
        </div>
      )}
      {error && (
        <p className="mt-1.5 text-2xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}

/**
 * Step 2: the sign-ins the chosen options need, checked by asking each service's own CLI, with
 * a button that starts its login. The setup that follows reuses those sign-ins.
 */
export function ConnectionsStep({
  answers,
  onChange,
  onBack,
  onNext,
  onCancel,
}: {
  answers: FormAnswers;
  onChange: (next: FormAnswers) => void;
  onBack: () => void;
  onNext: () => void;
  onCancel: () => void;
}) {
  const client = useClient();
  const queryClient = useQueryClient();
  const services = secureFoundationServices(answers);
  const key = [...secureFoundationKey, "connections", services.join(",")];
  const state = useQuery({
    queryKey: key,
    queryFn: () => client.secureFoundation.connections(services),
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  const refresh = useRef(() => {});
  refresh.current = () => void queryClient.invalidateQueries({ queryKey: key });
  const onChanged = useRef(() => refresh.current()).current;
  const connections = state.data?.connections ?? [];
  const teams = connections.find((c) => c.service === "convex")?.teams ?? [];
  const firstTeam = teams[0]?.slug;
  const chosen = teams.some((t) => t.slug === answers.convexTeam) ? answers.convexTeam : firstTeam;
  // The only team, or the first of several, is preselected.
  useEffect(() => {
    if (chosen !== answers.convexTeam) onChange({ ...answers, convexTeam: chosen });
  }, [chosen, answers, onChange]);
  const blocked =
    connections.some(
      (c) => c.cli === "missing" || c.signedIn === false || c.missingScopes.length > 0,
    ) ||
    // With the deploy on, its owner, name and scope have to be settled here.
    (connections.length > 0 && deployOf(answers) === null);
  const of = (service: SecureFoundationService) => connections.find((c) => c.service === service);

  return (
    <div className="space-y-4" data-testid="secure-foundation-connections">
      <div>
        <h3 className="mb-1 text-xs font-medium">Connections</h3>
        <p className="text-2xs text-muted-foreground">
          The install signs in to these with their own command-line tools, and the setup reuses
          those sign-ins. Nothing of them is read or kept here: each tool is only asked whether it
          is signed in.
        </p>
      </div>
      {state.isLoading && (
        <p className="flex items-center gap-1.5 text-2xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" /> Asking each tool… the first time can take a
          minute.
        </p>
      )}
      {state.error && (
        <p className="text-xs text-muted-foreground" role="alert">
          The sign-ins can't be checked from here ({state.error.message}). You can go on: the setup
          session checks them on the computer it runs on and asks you there.
        </p>
      )}
      <ul className="space-y-2">
        {connections.map((c) => (
          <Row key={c.service} connection={c} onChanged={onChanged} />
        ))}
      </ul>
      {teams.length > 1 && (
        <label className="block space-y-1.5 text-xs">
          <span className="font-medium">Convex team</span>
          <select
            value={chosen ?? ""}
            onChange={(e) => onChange({ ...answers, convexTeam: e.target.value })}
            className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-[13px]"
          >
            {teams.map((t) => (
              <option key={t.slug} value={t.slug}>
                {t.name} ({t.slug})
              </option>
            ))}
          </select>
          <span className="block text-2xs text-muted-foreground">
            The Convex project is created in this team.
          </span>
        </label>
      )}
      {answers.deploy && (
        <DeployFields
          github={of("github")}
          vercel={of("vercel")}
          answers={answers}
          onChange={onChange}
        />
      )}
      <div className="flex items-center justify-end gap-2">
        {blocked && (
          <span className="mr-auto text-2xs text-muted-foreground">Sign in above to go on.</span>
        )}
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => refresh.current()}
          disabled={state.isFetching}
        >
          Check again
        </Button>
        <Button type="button" onClick={onNext} disabled={blocked || state.isLoading}>
          Review
        </Button>
      </div>
    </div>
  );
}
