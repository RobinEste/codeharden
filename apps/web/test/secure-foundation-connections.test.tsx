import type { SecureFoundationConnection, SecureFoundationLogin } from "@codeden/contracts";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ConnectionsStep } from "@/components/harden/secure-foundation/connections-step";
import type { FormAnswers } from "@/components/harden/secure-foundation/form-step";
import type { CodeDenClient } from "@/lib/api";
import { createMockClient } from "@/lib/api/mock";
import { renderWithClient } from "./utils";

/** The Connections step: only the services the answers need, their state and their logins. */

const answers: FormAnswers = {
  name: "My Site",
  adminEmail: "person@site.test",
  emailTouched: true,
  secrets: "doppler",
  shell: "minimal",
  modules: [],
  provider: "alpha",
};
const connection = (
  service: "convex" | "doppler",
  patch: Partial<SecureFoundationConnection> = {},
): SecureFoundationConnection => ({
  service,
  cli: "ready",
  signedIn: true,
  message: "Signed in.",
  install: null,
  teams: [],
  ...patch,
});

function Step({ start = answers, seen }: { start?: FormAnswers; seen?: (a: FormAnswers) => void }) {
  const [value, setValue] = useState(start);
  seen?.(value);
  return (
    <ConnectionsStep
      answers={value}
      onChange={setValue}
      onBack={() => {}}
      onNext={() => {}}
      onCancel={() => {}}
    />
  );
}

const clientWith = (sf: Partial<CodeDenClient["secureFoundation"]>): CodeDenClient => {
  const client = createMockClient();
  return { ...client, secureFoundation: { ...client.secureFoundation, ...sf } };
};
const review = () => screen.getByRole("button", { name: "Review" }) as HTMLButtonElement;

describe("the Connections step", () => {
  it("asks only for the services the answers need", async () => {
    const asked = vi.fn(async (services: string[]) => ({
      connections: services.map((s) => connection(s as "convex")),
    }));
    renderWithClient(
      <Step start={{ ...answers, secrets: "env_local" }} />,
      clientWith({ connections: asked }),
    );
    await screen.findByTestId("connection-convex");
    expect(asked).toHaveBeenCalledWith(["convex"]);
    expect(screen.queryByTestId("connection-doppler")).toBeNull();
    expect(review().disabled).toBe(false);
  });

  it("holds Review until every service is signed in, and names a missing tool's install command", async () => {
    renderWithClient(
      <Step />,
      clientWith({
        connections: async () => ({
          connections: [
            connection("convex", { signedIn: false, message: "Not signed in to Convex." }),
            connection("doppler", {
              cli: "missing",
              signedIn: null,
              message: "The doppler command isn't installed on this computer.",
              install: "brew install dopplerhq/cli/doppler",
            }),
          ],
        }),
      }),
    );
    await screen.findByRole("button", { name: "Sign in to Convex" });
    expect(review().disabled).toBe(true);
    expect(screen.getByText("brew install dopplerhq/cli/doppler")).toBeTruthy();
    // Nothing offers to install it for the person.
    expect(screen.queryByRole("button", { name: /Sign in to Doppler|Install/ })).toBeNull();
  });

  it("starts a login, shows its link and code, and can cancel it", async () => {
    const waiting: SecureFoundationLogin = {
      id: "l1",
      service: "convex",
      status: "waiting",
      url: "https://auth.convex.dev/activate?user_code=WXYZ-1234",
      code: "WXYZ-1234",
      message: "Open the link to sign in to Convex.",
    };
    const cancelLogin = vi.fn(async () => ({
      ...waiting,
      status: "cancelled" as const,
      url: null,
      code: null,
      message: "The Convex sign-in was cancelled.",
    }));
    renderWithClient(
      <Step start={{ ...answers, secrets: "env_local" }} />,
      clientWith({
        connections: async () => ({ connections: [connection("convex", { signedIn: false })] }),
        startLogin: async () => waiting,
        cancelLogin,
      }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Sign in to Convex" }));
    const link = (await screen.findByRole("link", {
      name: /Open the Convex sign-in page/,
    })) as HTMLAnchorElement;
    expect(link.href).toBe(waiting.url);
    expect(screen.getByText("WXYZ-1234")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Cancel" })[0] as HTMLElement);
    await waitFor(() => expect(cancelLogin).toHaveBeenCalledWith("l1"));
    await screen.findByText("The Convex sign-in was cancelled.");
    expect(screen.queryByText("WXYZ-1234")).toBeNull();
  });

  it("preselects the only team, or the first of several, and lets the person pick", async () => {
    const seen: FormAnswers[] = [];
    renderWithClient(
      <Step seen={(a) => seen.push(a)} />,
      clientWith({
        connections: async () => ({
          connections: [
            connection("convex", {
              teams: [
                { name: "Acme Labs", slug: "acme-labs" },
                { name: "Side Project", slug: "side-project" },
              ],
            }),
            connection("doppler"),
          ],
        }),
      }),
    );
    const select = (await screen.findByLabelText(/Convex team/)) as HTMLSelectElement;
    await waitFor(() => expect(seen.at(-1)?.convexTeam).toBe("acme-labs"));
    fireEvent.change(select, { target: { value: "side-project" } });
    await waitFor(() => expect(seen.at(-1)?.convexTeam).toBe("side-project"));
    expect(review().disabled).toBe(false);
  });

  it("lets the person go on when the sign-ins can't be checked from this device", async () => {
    renderWithClient(
      <Step />,
      clientWith({
        connections: async () => {
          throw new Error("Sign-ins can only be checked on the computer running the app.");
        },
      }),
    );
    expect((await screen.findByRole("alert")).textContent).toContain("You can go on");
    expect(review().disabled).toBe(false);
  });
});
