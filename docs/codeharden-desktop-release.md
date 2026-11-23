# Publishing CodeHarden's desktop installers

The desktop app's installers are built on GitHub, by the "Desktop installers" workflow (`.github/workflows/harden-desktop.yml`), for the releases you choose, and attached to that release on GitHub. An installed app looks for updates in the latest published release of this repository, so a release only needs installers when you want desktop users to get it. Nothing here touches npm ([Publishing to npm](codeharden-npm-release.md) is separate), and the workflow never starts by itself.

## Every time

1. **Have a release tag.** A CodeHarden release is a tag `v<VERSION>` on `harden` (`scripts/harden/release.sh --push`, or the one the sync workflow made). The tag must contain this workflow's packaging: `v2026.1122.2240` and earlier build an app that is still named CodeDen, and the workflow refuses them.

2. **Rehearse.** On GitHub: **Actions › Desktop installers › Run workflow**, on the branch `harden`, with the tag and **dry-run** ticked (the default). Or from a terminal:

   ```sh
   gh workflow run harden-desktop.yml --repo harperaa/codeharden --ref harden -f tag=v2026.0105.0518 -f dry-run=true
   gh run watch --repo harperaa/codeharden
   ```

   It builds on Windows, macOS and Linux, checks that the files carry the release's version, checks the macOS apps' signatures and that they start, and keeps the installers as artifacts of the run for 14 days (`desktop-windows-latest`, `desktop-macos-latest`, `desktop-ubuntu-latest`). No release is created or changed.

3. **Publish.** Run it again for the same tag with **dry-run** off (`-f dry-run=false`). After all three systems have built, one job creates the GitHub release as a draft (if the tag has none; its notes are the version's entry in `CODEHARDEN-CHANGELOG.md`), attaches every file, the update files last, and only then publishes the release and marks it latest.

4. **Check it.** The release page lists:

   | System | Files |
   |---|---|
   | Windows | `CodeHarden-Setup-<version>.exe`, its `.blockmap`, `latest.yml` |
   | macOS | `CodeHarden-<version>-arm64.dmg`, `CodeHarden-<version>-x64.dmg`, the two `.zip` files the updater downloads, their `.blockmap` files, `latest-mac.yml` |
   | Linux | `CodeHarden-<version>-x86_64.AppImage`, `codeharden_<version>_amd64.deb`, `latest-linux.yml` |

   `<version>` is the npm form of the release (`2026.105.518` for the tag `v2026.0105.0518`): leading zeros are stripped, because the app's version must be valid semver.

**If a system fails,** nothing is attached: the publishing job only runs when all three built. Fix the cause and run it again. **If the publishing job itself fails partway,** the release is left as it was (a draft when the workflow created it), and running the workflow again for the same tag replaces the files and finishes the job. A draft is invisible to installed apps.

## Signing

No signing certificate is configured, so the installers are unsigned. They work; the system warns once.

| System | Without a certificate (today) | With one |
|---|---|---|
| Windows | SmartScreen shows "Windows protected your PC"; the user chooses **More info**, then **Run anyway**. The app updates itself. | A code-signing certificate (`.pfx`) names the publisher in the prompt. SmartScreen still warns until the certificate has a reputation; an EV certificate has one from the start. |
| macOS | The app is signed ad hoc and not notarized. macOS says it can't verify the developer; the user allows it once under **System Settings › Privacy & Security › Open Anyway**. **It can't update itself**: macOS only lets an app with a Developer ID replace itself, so new versions are downloaded from the release page and dragged over the old one. Settings › About says so. | A Developer ID Application certificate and notarization (an Apple Developer account) make it open without a warning and update itself. |
| Linux | AppImage and `.deb` are not signed; nothing warns. The AppImage updates itself, the `.deb` through the downloaded package. | Nothing to change. |

[The desktop app](desktop.md#unsigned-builds) has the steps a user follows.

To sign later, add these repository secrets; the workflow already reads them, and without them it builds as today:

| Secret | What |
|---|---|
| `CSC_LINK`, `CSC_KEY_PASSWORD` | The certificate (`.pfx` for Windows or a Developer ID Application `.p12` for macOS), base64 or a URL, and its password |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | Notarization on macOS |

## Good to know

- **Manual only.** The workflow has no `push` or schedule trigger. Upstream's Release workflow stays disabled: it reacts to every `v*.*.*` tag, which CodeHarden's tags match, and publishes to npm.
- **What may write.** The build jobs run the repository's code with a read-only token. One job has `contents: write`; it runs no code from the repository and only moves the built files onto the release.
- **Installed apps** read the latest *published* release. A release with no installers is "up to date" to them, quietly, so a CodeHarden release without desktop installers is fine.
- **Sync pull requests.** The workflow file, `apps/desktop/scripts/` and `apps/desktop/electron-builder.config.mjs` are protected paths of the "Upstream sync merge" workflow: an upstream change to how the app is packaged is merged by a person, not by the 48-hour rule.
- **A fork's own app.** In a fork the installers are the fork's: named after its `PACKAGE_NAME` repository variable (and the optional `PRODUCT_NAME`, `APP_ID`, `DEFAULT_PORT`), updating from the fork's own releases. The workflow refuses to run in another repository until `PACKAGE_NAME` is set.
- **Build one yourself:** `pnpm desktop:dist` makes the installers for the system you are on, in `apps/desktop/release/`.
