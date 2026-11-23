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

Each system's build is given its own secrets and nothing else:

| System | Secrets | Notes |
|---|---|---|
| macOS | `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | All five or none. With only some of them the macOS job stops and names the missing ones. |
| Windows | `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` | Both or neither. Windows never receives `CSC_LINK`: electron-builder would fall back to it and try to sign the installer with the Apple certificate. |
| Linux | none | |

## Signing with an Apple Developer ID

You do these steps yourself, signed in to your Apple account and to GitHub. **The secrets are entered by you in the repository's settings. No agent ever sees, creates or handles them**, and they are never printed by the workflow.

1. **Create the certificate.** On your Mac open **Keychain Access › Certificate Assistant › Request a Certificate From a Certificate Authority**, enter your email and name, and choose **Saved to disk**. At [developer.apple.com/account](https://developer.apple.com/account) go to **Certificates, IDs & Profiles › Certificates › +**, choose **Developer ID Application** (not "Developer ID Installer", and not "Apple Development"), upload the request file, download the certificate and double-click it so it lands in your login keychain. Only the account holder of the developer team can create this kind.

2. **Export it as a `.p12`.** In Keychain Access, under **My Certificates**, find "Developer ID Application: <your name> (<team id>)". It must show a private key under it when expanded. Right-click it, **Export**, file format **Personal Information Exchange (.p12)**, and set a strong password you will use nowhere else.

3. **Turn it into text**, straight to the clipboard, so the file's content never appears in a terminal:

   ```sh
   base64 -i DeveloperID.p12 | pbcopy
   ```

4. **Make an app-specific password** for notarization: [account.apple.com](https://account.apple.com) › **Sign-In and Security › App-Specific Passwords › +**. It looks like `abcd-efgh-ijkl-mnop`. This is not your Apple account password.

5. **Add the five secrets** at **github.com/harperaa/codeharden › Settings › Secrets and variables › Actions › New repository secret**:

   | Secret | Value |
   |---|---|
   | `CSC_LINK` | The base64 text from step 3 |
   | `CSC_KEY_PASSWORD` | The password you set when exporting the `.p12` (step 2) |
   | `APPLE_ID` | The email address of your Apple developer account |
   | `APPLE_APP_SPECIFIC_PASSWORD` | The app-specific password from step 4 |
   | `APPLE_TEAM_ID` | The ten-character team id: developer.apple.com/account › **Membership details**, or the part in brackets in the certificate's name |

   Then delete the `.p12` file from your disk (the certificate stays in your keychain), and clear the clipboard by copying something else.

6. **Run the workflow** for a release tag, with **dry-run** on first. The macOS job's log says "signing with the Developer ID certificate and notarizing"; notarization adds a few minutes. The signature check is then strict: it fails unless each app is signed with your Developer ID, has Apple's notarization ticket stapled to it, and is accepted by Gatekeeper as a downloaded app. Open the `.dmg` from the run's `desktop-macos-latest` artifact on a Mac if you want to see it open without a warning. Then run it again with **dry-run** off.

**What changes for people using the app:**

- It opens on first launch without the "can't verify the developer" warning and without **Open Anyway**.
- It updates itself, like the Windows and Linux apps, and **Settings › About** no longer says that this macOS build can't update itself. The app decides this by looking at its own signature each time it starts (`macSigned` in `apps/desktop/src/main/system.ts`: a "Developer ID Application" authority), so nothing else needs to be switched on.
- **Someone on an earlier, unsigned build installs the signed one by hand, once:** an unsigned app can't replace itself, so they download the new `.dmg` from the release page and drag it over the old app. From then on it updates itself. Their data is untouched.

**Keep in mind:** a Developer ID certificate is valid for five years, and apps signed with it keep working after it expires, but new builds need a new one. If the secrets are ever exposed, revoke the certificate at developer.apple.com and the app-specific password at account.apple.com, then make new ones. Until the first signed run has passed, the signed path is untested: the unsigned path is what has been run.

### Signing the Windows installer

A Windows code-signing certificate is a separate purchase from a certificate authority. With a `.pfx` file: base64 it the same way and add `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD`. Certificates that live on a hardware token or in a cloud signing service (most new ones do) can't be exported to a `.pfx` and need a change to the workflow first.

## Good to know

- **Manual only.** The workflow has no `push` or schedule trigger. Upstream's Release workflow stays disabled: it reacts to every `v*.*.*` tag, which CodeHarden's tags match, and publishes to npm.
- **What may write.** The build jobs run the repository's code with a read-only token. One job has `contents: write`; it runs no code from the repository and only moves the built files onto the release.
- **Installed apps** read the latest *published* release. A release with no installers is "up to date" to them, quietly, so a CodeHarden release without desktop installers is fine.
- **Sync pull requests.** The workflow file, `apps/desktop/scripts/` and `apps/desktop/electron-builder.config.mjs` are protected paths of the "Upstream sync merge" workflow: an upstream change to how the app is packaged is merged by a person, not by the 48-hour rule.
- **A fork's own app.** In a fork the installers are the fork's: named after its `PACKAGE_NAME` repository variable (and the optional `PRODUCT_NAME`, `APP_ID`, `DEFAULT_PORT`), updating from the fork's own releases. The workflow refuses to run in another repository until `PACKAGE_NAME` is set.
- **Build one yourself:** `pnpm desktop:dist` makes the installers for the system you are on, in `apps/desktop/release/`.
