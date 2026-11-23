import type { SecureFoundationOptions, SecureFoundationTemplate } from "@codeden/contracts";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ConfirmStep } from "@/components/harden/secure-foundation/confirm-step";
import {
  CREATED_STAYS,
  consentStatements,
  projectPath,
} from "@/components/harden/secure-foundation/consent";
import { type FormAnswers, FormStep } from "@/components/harden/secure-foundation/form-step";
import { SecureFoundationSlot } from "@/components/harden/secure-foundation/slot";
import type { CodeDenClient } from "@/lib/api";
import { createMockClient } from "@/lib/api/mock";
import { renderWithClient } from "./utils";

/** The Secure Foundation option, its form and what the confirm step says. */

const options: SecureFoundationOptions = {
  enabled: true,
  template: { repository: "acme/starter", branch: "main" },
  projectsDir: "/work/projects",
  pathSeparator: "/",
  providers: [
    { id: "alpha", displayName: "Alpha", runsCommandFiles: true },
    { id: "beta", displayName: "Beta", runsCommandFiles: false },
  ],
  defaults: { secrets: "doppler", shell: "minimal", deploy: false },
  repositoryMode: "fresh",
  autonomy: "full",
};
const template: SecureFoundationTemplate = {
  repository: "acme/starter",
  branch: "main",
  commit: "0123456789abcdef0123456789abcdef01234567",
  committedAt: "2026-01-05T10:00:00.000Z",
  modules: [
    { name: "blog", title: "Blog", description: "A blog" },
    { name: "pricing", title: "Pricing", description: "A pricing page" },
  ],
};
const blank: FormAnswers = {
  name: "",
  adminEmail: "",
  emailTouched: false,
  secrets: "doppler",
  shell: "minimal",
  modules: [],
  provider: "alpha",
  deploy: false,
};

const clientWith = (sf: Partial<CodeDenClient["secureFoundation"]>): CodeDenClient => {
  const client = createMockClient();
  return { ...client, secureFoundation: { ...client.secureFoundation, ...sf } };
};

describe("the option in the add-project dialog", () => {
  it("is hidden in a build without a template", async () => {
    const asked = vi.fn(async () => ({
      ...options,
      enabled: false,
      template: null,
      providers: [],
    }));
    renderWithClient(<SecureFoundationSlot />, clientWith({ options: asked }));
    await waitFor(() => expect(asked).toHaveBeenCalled());
    expect(screen.queryByTestId("secure-foundation-option")).toBeNull();
  });

  it("shows the card with the owner's copy when the build has one", async () => {
    renderWithClient(<SecureFoundationSlot />, clientWith({ options: async () => options }));
    const card = await screen.findByTestId("secure-foundation-option");
    expect(card.textContent).toContain("Secure Foundation");
    expect(card.textContent).toContain(
      "Hardened Nextjs, Clerk Billing, Convex, Doppler, Vercel stack.",
    );
    expect(card.textContent).not.toContain("Needs a signed-in agent provider");
  });

  it("explains itself when no signed-in provider can run the install", async () => {
    renderWithClient(
      <SecureFoundationSlot />,
      clientWith({ options: async () => ({ ...options, providers: [] }) }),
    );
    const card = await screen.findByTestId("secure-foundation-option");
    expect(card.textContent).toContain("Needs a signed-in agent provider");
  });
});

function Form({ start = blank, onNext = () => {} }: { start?: FormAnswers; onNext?: () => void }) {
  const [answers, setAnswers] = useState(start);
  return (
    <FormStep
      options={options}
      template={template}
      templateError={null}
      onRetryTemplate={() => {}}
      answers={answers}
      onChange={setAnswers}
      onNext={onNext}
      onCancel={() => {}}
    />
  );
}

describe("the form", () => {
  const review = () => screen.getByRole("button", { name: "Next" }) as HTMLButtonElement;

  it("works with nothing prefilled: Doppler and Minimal preselected, the path shown", () => {
    const onNext = vi.fn();
    renderWithClient(<Form onNext={onNext} />, createMockClient());
    expect(review().disabled).toBe(true);
    expect((screen.getByLabelText(/Doppler/) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText(/Minimal/) as HTMLInputElement).checked).toBe(true);
    fireEvent.change(screen.getByLabelText("Project name"), { target: { value: "My Site" } });
    expect(screen.getByTestId("secure-foundation-path").textContent).toContain(
      "/work/projects/my-site",
    );
    expect(review().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Admin email"), {
      target: { value: "person@site.test" },
    });
    expect(review().disabled).toBe(false);
    fireEvent.click(review());
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("refuses a name that is a path and an address the install refuses", () => {
    renderWithClient(
      <Form start={{ ...blank, name: "../x", adminEmail: "admin@example.com" }} />,
      createMockClient(),
    );
    expect(review().disabled).toBe(true);
    expect(screen.getByTestId("secure-foundation-path").textContent).toContain("Use letters");
    expect(screen.getByText(/the install refuses placeholders/)).toBeTruthy();
  });

  it("lists the template's own modules under Pick, and says how each provider runs the install", () => {
    renderWithClient(<Form />, createMockClient());
    expect(screen.queryByText("A pricing page")).toBeNull();
    fireEvent.click(screen.getByLabelText(/Pick/));
    expect(screen.getByText("A pricing page")).toBeTruthy();
    expect(screen.getByText(/runs the template's \/install command/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Runs on"), { target: { value: "beta" } });
    expect(screen.getByText(/reads the template's install instructions/)).toBeTruthy();
  });
});

describe("the confirm step", () => {
  const input = {
    ...options,
    name: "My Site",
    secrets: "doppler" as const,
    modules: [] as string[],
    provider: options.providers[0] as (typeof options.providers)[number],
    template,
  };

  it("says where, from which commit, what runs unattended and what the URL is", () => {
    const text = consentStatements(input).join("\n");
    expect(projectPath(input)).toBe("/work/projects/my-site");
    expect(text).toContain("/work/projects/my-site as a new local git repository");
    expect(text).toContain("no remote, no link back to the template, and no GitHub repository");
    expect(text).toContain("acme/starter, branch main, commit 0123456 of 2026-01-05");
    expect(text).toContain("Packages are installed from npm");
    expect(text).toContain("A Clerk app and a Convex project are created");
    expect(text).toContain("you are asked to sign in in a browser");
    expect(text).toContain("The CI token step of the install is skipped");
    expect(text).toContain("runs commands inside the new project without asking for each one");
    expect(text).toContain("Alpha at the Full permission level");
    expect(text).toContain("It only works while the setup session's processes are running");
  });

  it("changes with the answers", () => {
    const local = consentStatements({ ...input, secrets: "env_local", modules: ["blog"] });
    expect(local.join("\n")).toContain("written to .env.local");
    expect(local.join("\n")).toContain("Content modules installed: blog.");
    const reads = consentStatements({ ...input, provider: options.providers[1] as never });
    expect(reads.join("\n")).toContain("reads the template's install instructions");
  });

  it("with the deploy on, names the repository, the scope and what the session may do", () => {
    const deploy = { owner: "acme-org", repository: "my-site", vercelScope: "acme-team" };
    const text = consentStatements({ ...input, deploy }).join("\n");
    expect(text).toContain("pushed to a new private GitHub repository, acme-org/my-site");
    expect(text).toContain('a Vercel project named "my-site" in the scope "acme-team"');
    expect(text).toContain("public on a vercel.app address");
    expect(text).toContain("nothing is deployed with production keys");
    expect(text).toContain("told to stop and ask if anything differs");
    expect(text).toContain("A Doppler token is stored in the new repository");
    expect(text).toContain("The deployed one stays up; the local one only works while");
    expect(text).not.toContain("no GitHub repository");
  });

  it("lists what is created in the person's accounts and starts nothing until confirmed", () => {
    const onConfirm = vi.fn();
    renderWithClient(
      <ConfirmStep
        options={options}
        template={template}
        answers={{ ...blank, name: "My Site", adminEmail: "person@site.test" }}
        moved={false}
        busy={false}
        error={null}
        onBack={() => {}}
        onCancel={() => {}}
        onConfirm={onConfirm}
      />,
      createMockClient(),
    );
    const step = screen.getByTestId("secure-foundation-confirm");
    for (const service of ["Clerk:", "Convex:", "Doppler:"]) {
      expect(step.textContent).toContain(service);
    }
    expect(step.textContent).toContain('a Doppler project named "my-site"');
    expect(step.textContent).toContain(CREATED_STAYS);
    // The email is not repeated on the page.
    expect(step.textContent).not.toContain("person@site.test");
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("secure-foundation-confirm-button"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("asks again when the template moved", () => {
    renderWithClient(
      <ConfirmStep
        options={options}
        template={template}
        answers={{ ...blank, name: "My Site" }}
        moved
        busy={false}
        error={null}
        onBack={() => {}}
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
      createMockClient(),
    );
    expect(screen.getByRole("alert").textContent).toContain("check it and confirm again");
  });
});
