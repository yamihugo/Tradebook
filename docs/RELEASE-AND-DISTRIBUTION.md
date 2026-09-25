# Release and distribution — channels, BRAT and the beta package

Written 17 Sep 2026, while preparing the closed beta. This is the checklist we follow
when we ship anything. Nothing here is guesswork: the BRAT and Obsidian rules were
verified against the developer guides (links at the bottom).

---

## 1. Channels

| Channel | Who runs it | Where it lives | How it is installed |
|---|---|---|---|
| **Dev** | Maintainer | personal vault, local build | nothing to install |
| **Test** | 1–2 trusted people | GitHub **pre-release** (e.g. `0.5.0-test.1`) | BRAT, frozen to that tag |
| **Beta** | the Discord team | GitHub **pre-release** (e.g. `0.5.0-beta.1`) | BRAT, tracking latest |
| **Stable** | everyone else | GitHub **release** + community store | store, or BRAT frozen to the stable tag |

One repository, one code line, channels separated by **release tags**. Branch-per-channel
was rejected: Obsidian reads the **default branch** `manifest.json`, so a beta manifest
merged into it would be offered to stable users. We use two branches instead — `dev`
(daily work) and `main` (stable, merged to only when a release is cut); both hold the same
stable manifest, so the default-branch rule is satisfied.

---

## 2. What BRAT requires (the rules that matter)

- **GitHub Releases are the source of truth.** BRAT downloads `manifest.json`, `main.js`
  and `styles.css` **from the release assets** — a repo with only a root `manifest.json`
  and no release does not install.
- **The tag is authoritative.** Tag = release name = the version inside the released
  `manifest.json`. Mismatches trigger a BRAT warning. **Semver tags, no `v` prefix.**
- **Pre-releases count as candidates**: BRAT's "latest" picks the highest semver including
  pre-releases; "frozen" pins one exact tag.
- `manifest-beta.json` is **ignored** since BRAT 1.1.0.
- **Private repos work** but each tester needs a read-only `Contents` token — prefer a
  public repo with pre-release tags (four clicks).
- `versions.json` is consumed by **Obsidian**, not BRAT; add an entry only when
  `minAppVersion` changes.

## 3. Repo layout

`tradebook/` root: `manifest.json` (id permanent; version = last **stable**),
`versions.json`, `README.md`, `LICENSE`, `assets/firm-logos/*.png` (source images;
embedded into `main.js` at build time so BRAT/store installs get them), `docs/`,
`tools/ux-audit.mjs`, `src/`, `esbuild.config.mjs`, `package.json`, `tsconfig.json`.

**`main.js` is not committed** (it is in `.gitignore`). It is built by CI on every tag and
attached to the release — this keeps the repo clean and makes shipping a stale build
impossible. `styles.css` **is** committed: it is hand-written source, not a build product.

### 3.1 Automated release (the normal path)

`.github/workflows/release.yml` runs on any tag push (follows Obsidian's official
"Release your plugin with GitHub Actions" recipe):

1. `npm ci` → `npm run build`;
2. fails if the tag does not match `manifest.json`'s version;
3. generates a **build provenance attestation** over `main.js`, `manifest.json` and
   `styles.css` (`actions/attest@v4`) — recommended when submitting to the community
   directory;
4. creates the GitHub release **as a draft** and attaches `main.js`, `styles.css`,
   `manifest.json`.

The draft is deliberate: review it, tick **pre-release** for test/beta, write the
changelog, then **Publish release** — BRAT and the store only ever see published
releases, never a draft. The workflow needs the `contents: write`, `id-token: write`
and `attestations: write` permissions (already set), and Node `20.x` (the official
recipe still says `18.x`; 18 is end-of-life, so we track 20). So the manual asset
upload in §4 is only a fallback if CI is unavailable.

---

## 4. Release checklist

1. `npm run build` → exit 0.
2. Smoke: 188 PASS / 0 FAIL. Audit: `node tools/ux-audit.mjs` → no violations.
3. Bump the version on **both** branches: `npm version <x.y.z> --no-git-tag-version`
   (it updates `manifest.json`, `package.json` and `versions.json` together). Pre-release
   suffixes for test/beta: `0.5.0-test.1`, `0.5.0-beta.1`.
4. Merge `dev` → `main` (or cherry-pick the release commit), commit, then **tag exactly
   that version and push the tag** (`git tag 0.5.0 && git push origin 0.5.0`).
5. CI builds and creates the release **as a draft** with the three assets. Review it,
   tick **pre-release** for test/beta, write two lines of changelog (what changed, what
   to look at), then **Publish release**.
6. Leave the **default-branch manifest at the last stable version** once the beta is out
   — Obsidian offers the default-branch manifest to store users.
7. Note: Obsidian will not auto-upgrade `1.0.1-preview.1` → `1.0.1`; the next release
   needs a higher number (e.g. `1.0.2`).

### Branches

- **`dev`** — daily work; never released, never tagged.
- **`main`** — stable only; receives merges from `dev` when a release is cut.

Testers only ever see **tags/releases**, never branch pushes. A week of fixes on `dev`
stays invisible until one tag publishes them all at once.

## 5. Data safety for testers (put this in the tutorial)

- Updating a plugin **never touches `data.json`**: settings, accounts and preferences
  survive every update.
- **Disabling** the plugin keeps `data.json`; re-enabling restores everything.
- **Uninstalling deletes the plugin folder, including `data.json`.** Tell testers to
  back the file up (or use the plugin's own Export) before uninstalling.
- The plugin **`id` is permanent** (`tradebook`). All channels share it, so a
  tester can move from beta to stable and keep their settings.
- Trades are markdown notes in the vault: they are never at risk from a plugin update.

## 6. Beta package — "same experience as the end user"

The tester must be able to go from zero to journaling without us touching their machine.

1. **A clean vault folder** — no accounts, no trades, no `data.json`, no test logos.
   This is also our onboarding fixture: we test the first 60 minutes on it.
2. **README (repo) = install tutorial**: install Obsidian → install BRAT → *Add beta
   plugin* → paste the repo → enable → open the journal. Four steps, no jargon.
3. **In-plugin first-run guide** (shipped with the beta):
   trades folder → accounts → first trade or import → where reviews live → Manage →
   Copy groups (only after accounts exist).
4. **Discord `#journal-beta`**: the same tutorial, the bug-report template (what I did /
   what I expected / what happened / *Copy diagnostics*), and the exploration checklist.
5. **`KNOWN-LIMITATIONS.md`** in the repo: copy legs are a model, commissions are
   simulated, and anything else a tester could mistake for a bug.

## 7. The `id` is permanent

- **Free, any time**: the display `name`, the repo name (GitHub redirects), README, docs,
  logos, CSS prefix (cosmetic), release titles.
- **Not free**: the plugin **`id`** and the folder `.obsidian/plugins/<id>/`. Changing it
  orphans `data.json` until the file is copied into the new folder.
- **Rule:** settle the id before the first beta. (Done: the name **Tradebook** and the
  `id` `tradebook` are settled. If we ever rename, the migration is: rename the folder →
  change `id` → copy `data.json` in → keep the old folder one release as fallback →
  note it in the changelog.)

## 8. Community directory submission

The submission flow changed: it is **no longer a pull request** to `obsidian-releases`.
It now runs through **<https://community.obsidian.md>** — sign in with an Obsidian account,
connect GitHub (read-only), then add the plugin with its repo URL.

What the directory reads and requires:

- It reads **`manifest.json` at HEAD of the repo's default branch** — that file must be
  accurate and committed (this is why `main` stays on the last **stable** manifest).
- Obsidian downloads `main.js`, `manifest.json`, `styles.css` from the GitHub **release
  whose tag matches the `version` in the manifest**. Only `x.y.z` versions; `main.js` and
  `manifest.json` are required, `styles.css` is optional.
- **Repo root must contain** `README.md`, a recognized **`LICENSE`**, and `manifest.json`.
  (Tradebook ships MIT + a README — kept current.)
- The automated review covers Manifest, Releases, Source code and Build verification and
  rates each **Error / Warning / Recommendation / Pass**. Warnings do not block a listing.
- The scanner runs the first of `build`, `build:plugin`, `compile` it finds — our
  `npm run build` matches. It ignores these paths by name: `node_modules`, `dist`,
  `build`, `pkg`, `test-vault`, `.pnpm-store`, `.obsidian`, `esbuild.config.mjs`,
  `version-bump.mjs`, `automation`, `*.test.*`, `test`/`tests`/`__tests__`, `mocks`,
  `*.cjs`, `*.mjs`, `scripts`, `docs`, `i18n`/`locales` — so our `tools/ux-audit.mjs`
  (`.mjs`) and `docs/` are not scanned.
- **Developer policies** (must hold to stay listed): no obfuscated code, no dynamic ads,
  no client-side telemetry, no self-install/self-update. Things that need a clear README
  disclosure: payment, accounts, network use, files outside the vault, server-side
  telemetry (with a privacy-policy link). A LICENSE is mandatory; the Obsidian name and
  trademark are respected.

Checklist specifics that we already meet: `fundingUrl` only for real donations, a
sensible `minAppVersion`, a short action-first `description` (≤250 chars, ends with a
period, no emoji), `isDesktopOnly:false` (no Node/Electron), and command ids **without**
the plugin id (Obsidian auto-prefixes it).

## 9. Local compliance check — the official ESLint plugin

Obsidian publishes an ESLint plugin that runs the same checks the review uses:
**<https://github.com/obsidianmd/eslint-plugin>**. Running it locally lets us catch
Manifest/Source-code issues before a submission. Recommended (not yet wired):

```bash
npm i -D eslint @typescript-eslint/parser eslint-plugin-obsidianmd
```

and a `lint` script, e.g. `eslint src`. This is optional tooling — it does not change the
shipped plugin.
