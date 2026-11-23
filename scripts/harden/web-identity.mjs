// The web app's name in its static files: the page title in `index.html` and the name an
// installed web app gets from `manifest.webmanifest`. Both files hold CodeHarden's name as
// written, so they are valid as they are (tests, a file opened by hand); a build, and the Vite
// dev server, put the product name of this build's channel in its place
// (`readHardenChannel().productName`, the same value the bundle gets as `HARDEN_PRODUCT_NAME`),
// so a fork configured with its own name gets it here too. The tab title the running app sets
// comes from `HARDEN_PRODUCT_NAME` (`apps/web/src/lib/attention/title.ts`).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { readHardenChannel } from "./channel-define.mjs";

export const MANIFEST_FILE = "manifest.webmanifest";

const TITLE = /(<title>)[^<]*(<\/title>)/;
const APPLE_TITLE = /(<meta\s+name="apple-mobile-web-app-title"\s+content=")[^"]*(")/;

/** `html` with the page title and the home-screen title set to `name`; throws when one is gone. */
export function titledHtml(html, name) {
  for (const [pattern, what] of [
    [TITLE, "<title>"],
    [APPLE_TITLE, 'the <meta name="apple-mobile-web-app-title"> tag'],
  ]) {
    if (!pattern.test(html)) {
      throw new Error(
        `index.html has no ${what} to put the product name in (scripts/harden/web-identity.mjs)`,
      );
    }
    html = html.replace(pattern, (_all, before, after) => `${before}${name}${after}`);
  }
  return html;
}

/** The web manifest `text` with `name` and `short_name` set to `name`. */
export function namedManifest(text, name) {
  const manifest = JSON.parse(text);
  if (typeof manifest.name !== "string" || typeof manifest.short_name !== "string") {
    throw new Error(
      `${MANIFEST_FILE} has no name and short_name to put the product name in (scripts/harden/web-identity.mjs)`,
    );
  }
  return `${JSON.stringify({ ...manifest, name, short_name: name }, null, 2)}\n`;
}

/** The Vite plugin: names the page and the manifest after this build's product. */
export function hardenWebIdentity(env = process.env, options = {}) {
  const { productName } = readHardenChannel(env, options);
  let config;
  return {
    name: "harden-web-identity",
    configResolved(resolved) {
      config = resolved;
    },
    transformIndexHtml: (html) => titledHtml(html, productName),
    // The dev server serves the public folder as it is: answer for the manifest before it does.
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split("?")[0] !== `/${MANIFEST_FILE}`) return next();
        const file = join(config.publicDir, MANIFEST_FILE);
        if (!existsSync(file)) return next();
        res.setHeader("content-type", "application/manifest+json");
        res.end(namedManifest(readFileSync(file, "utf8"), productName));
      });
    },
    // A build copies the public folder into the output: name the copy.
    closeBundle() {
      if (config?.command !== "build") return;
      const file = resolve(config.root, config.build.outDir, MANIFEST_FILE);
      if (!existsSync(file)) return;
      writeFileSync(file, namedManifest(readFileSync(file, "utf8"), productName));
    },
  };
}
