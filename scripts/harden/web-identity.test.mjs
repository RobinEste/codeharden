import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { hardenWebIdentity, namedManifest, titledHtml } from "./web-identity.mjs";

const read = (file) =>
  readFileSync(fileURLToPath(new URL(`../../${file}`, import.meta.url)), "utf8");
const html = read("apps/web/index.html");
const manifest = read("apps/web/public/manifest.webmanifest");

describe("the web app's name in its static files", () => {
  it("the files as written carry CodeHarden's own name", () => {
    expect(html).toContain("<title>CodeHarden</title>");
    expect(html).toContain('<meta name="apple-mobile-web-app-title" content="CodeHarden" />');
    expect(JSON.parse(manifest)).toMatchObject({ name: "CodeHarden", short_name: "CodeHarden" });
  });

  it("puts a fork's product name in the page and leaves the rest of it alone", () => {
    const named = titledHtml(html, "Acme Den");
    expect(named).toContain("<title>Acme Den</title>");
    expect(named).toContain('<meta name="apple-mobile-web-app-title" content="Acme Den" />');
    expect(named.replaceAll("Acme Den", "CodeHarden")).toBe(html);
  });

  it("puts it in the manifest and keeps every other field", () => {
    const named = JSON.parse(namedManifest(manifest, "Acme Den"));
    expect(named).toEqual({ ...JSON.parse(manifest), name: "Acme Den", short_name: "Acme Den" });
  });

  it("fails the build when a file lost the place for the name", () => {
    expect(() => titledHtml("<html><head></head></html>", "X")).toThrow(/no <title>/);
    expect(() => titledHtml("<title>x</title>", "X")).toThrow(/apple-mobile-web-app-title/);
    expect(() => namedManifest('{"display":"standalone"}', "X")).toThrow(/no name and short_name/);
  });

  it("the plugin takes the name from the build's channel", () => {
    const origin = "harperaa/codeharden";
    const own = hardenWebIdentity({}, { origin });
    expect(own.transformIndexHtml(html)).toBe(html);
    const fork = hardenWebIdentity({ PACKAGE_NAME: "acme", PRODUCT_NAME: "Acme Den" }, { origin });
    expect(fork.transformIndexHtml(html)).toContain("<title>Acme Den</title>");
  });
});
