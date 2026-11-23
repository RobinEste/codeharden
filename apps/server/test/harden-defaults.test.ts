import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HARDEN_AUTO_SWITCH_ON_LIMIT_DEFAULT, type Settings } from "@codeden/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SettingsStore } from "../src/settings-store";
import { removeTree } from "./support/remove-tree";

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "harden-defaults-"));
  file = join(dir, "settings.json");
});

afterEach(async () => {
  await removeTree(dir);
});

const onDisk = () => JSON.parse(readFileSync(file, "utf8")) as Settings;

describe("the provider switch at a usage limit ships off", () => {
  it("is off in a new install", () => {
    expect(HARDEN_AUTO_SWITCH_ON_LIMIT_DEFAULT).toBe(false);
    expect(new SettingsStore(file).get().providers.autoSwitchOnLimit).toBe(false);
    expect(onDisk().providers.autoSwitchOnLimit).toBe(false);
  });

  it("is off for an install whose settings file is from before the setting existed", () => {
    // The role defaults a person chose, and no word about the switch.
    writeFileSync(file, JSON.stringify({ providers: { pm: { provider: "codex" } } }));
    const store = new SettingsStore(file);
    expect(store.get().providers).toMatchObject({
      pm: { provider: "codex" },
      autoSwitchOnLimit: false,
    });
    // Saving something else doesn't turn it on.
    expect(store.update({ appearance: { theme: "light" } }).providers.autoSwitchOnLimit).toBe(
      false,
    );
    expect(SettingsStore.read(file).providers.autoSwitchOnLimit).toBe(false);
  });

  it("stays on once a person turns it on", () => {
    const store = new SettingsStore(file);
    expect(
      store.update({ providers: { autoSwitchOnLimit: true } }).providers.autoSwitchOnLimit,
    ).toBe(true);
    expect(onDisk().providers.autoSwitchOnLimit).toBe(true);
    // A restart reads the person's choice, and another change keeps it.
    const again = new SettingsStore(file);
    expect(again.get().providers.autoSwitchOnLimit).toBe(true);
    expect(again.update({ appearance: { theme: "dark" } }).providers.autoSwitchOnLimit).toBe(true);
  });
});
