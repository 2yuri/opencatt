# Releasing

`.github/workflows/release.yml` builds the installers for macOS (arm64 and x64, DMG and ZIP),
Windows and Linux when a version tag is pushed, and attaches them, with the `latest*.yml` files
the updater reads, to a draft GitHub release.

On macOS it signs the app with the **Developer ID Application** certificate (hardened runtime,
secure timestamp), has Apple notarize it and staples the ticket, so the DMG and the app open on any
Mac without a Gatekeeper warning. That needs the five repository secrets below. Without them (a
fork, or before they're added) the release still builds, ad-hoc signed as before, and the run shows
an **Unsigned macOS build** warning. Setting only some of them fails the macOS job.

## Cutting a release

1. Set the new version in `package.json` (`"version": "0.3.0"`), commit and merge it to `main`.
2. Tag that commit with the same version, prefixed with `v`, and push the tag:

   ```sh
   git tag v0.3.0
   git push origin v0.3.0
   ```

   The workflow fails straight away if the tag and `package.json` disagree.

3. Wait for the **Release** run. On macOS, notarization adds a few minutes per architecture. Open
   the run summary: an **Unsigned macOS build** warning means the secrets weren't found and the
   macOS installers will warn on first launch.
4. Check the draft release (Releases → Draft), edit the generated notes and **Publish** it. Running
   apps only see published releases, so publishing is what makes it an update.

## What the macOS job does with the secrets

1. electron-builder (`pnpm dist:mac` with the Developer ID settings on the command line; see the
   **Build, sign and notarize macOS installers** step) imports the `.p12` into a temporary keychain,
   signs every binary in the app with the hardened runtime and a secure timestamp, and uses
   `build/entitlements.mac.hardened.plist` (only `com.apple.security.cs.allow-jit`, which V8
   needs). It notarizes the `.app` with the API key and staples it, then packs it into the ZIP (the
   file the updater downloads) and the DMG.
2. The DMGs are signed (with a timestamp), notarized and stapled.
   `scripts/refresh-dmg-update-info.mjs` then rewrites their `.blockmap` and their sha512 and size in
   `latest-mac.yml`, because stapling changes the file.
3. The job checks both apps, the apps inside both ZIPs, and both DMGs with
   `codesign --verify --deep --strict`, `xcrun stapler validate` and `spctl --assess`.
4. The keychain and the decoded key files are deleted.

`electron-builder.yml` itself stays ad-hoc (`identity: '-'`), so `pnpm dist:mac` works on any Mac
without the certificate.

## One-time setup: repository secrets

Settings → Secrets and variables → Actions → **New repository secret**. The names are shared with
the owner's other repos, so the same values can be reused.

| Secret                      | Value                                                       |
| --------------------------- | ----------------------------------------------------------- |
| `DEVELOPER_ID_P12_BASE64`   | base64 of the exported Developer ID Application `.p12`      |
| `DEVELOPER_ID_P12_PASSWORD` | the password chosen when exporting the `.p12`               |
| `NOTARY_KEY_P8_BASE64`      | base64 of the App Store Connect API key (`AuthKey_XXXX.p8`) |
| `NOTARY_KEY_ID`             | that key's Key ID                                           |
| `NOTARY_ISSUER_ID`          | the Issuer ID shown above the keys list                     |

The workflow signs with "Developer ID Application: YURI ALVES MIGUEL (RQTYDUV329)" (team
`RQTYDUV329`). If the certificate ever belongs to someone else, change `MAC_IDENTITY` in
`release.yml` to the name after "Developer ID Application: ".

### Signing certificate (`DEVELOPER_ID_P12_*`)

Xcode's cloud-managed certificate can't be exported, so create one with a local private key:

1. Xcode → Settings → Accounts → select the team → **Manage Certificates…** → **+** →
   **Developer ID Application**.
2. Keychain Access → login keychain → My Certificates → right-click
   **Developer ID Application: YURI ALVES MIGUEL (RQTYDUV329)** → **Export…** → save as
   `developer-id.p12` with a strong password.
3. Add the secrets:
   - `DEVELOPER_ID_P12_BASE64`: run `base64 -i developer-id.p12 | pbcopy` and paste.
   - `DEVELOPER_ID_P12_PASSWORD`: the export password.
4. Delete `developer-id.p12` from disk.

### Notarization API key (`NOTARY_*`)

1. [App Store Connect](https://appstoreconnect.apple.com/access/integrations/api) → Users and
   Access → Integrations → App Store Connect API → Team Keys → **+**, access **Developer**.
2. Download the `.p8`. Apple only lets you do this once. Note the **Key ID** and the
   **Issuer ID** shown above the list.
3. Add the secrets:
   - `NOTARY_KEY_P8_BASE64`: run `base64 -i AuthKey_XXXX.p8 | pbcopy` and paste.
   - `NOTARY_KEY_ID`: the Key ID.
   - `NOTARY_ISSUER_ID`: the Issuer ID.
4. Delete the `.p8` from disk. Revoke the key in App Store Connect if it ever leaks.

## When something fails

- **Incomplete macOS signing secrets**: one or more of the five secrets is empty. Set all of
  them, or remove all of them to release unsigned.
- **Identity name is specified, but no valid identity with this name**: the `.p12` isn't a
  Developer ID Application certificate for `MAC_IDENTITY`, or it was exported without its private
  key (export it from My Certificates, not Certificates).
- **Notarization failed**: the step prints Apple's log for the submission, which names each file
  that was rejected and why.
- The certificate expires after five years. Apps signed before then keep working, because the
  signatures carry a secure timestamp. Create a new certificate and replace the two `DEVELOPER_ID_P12_*`
  secrets.
