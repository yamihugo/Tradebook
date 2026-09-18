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
merged into it would be offered to stable users.

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
`versions.json`, built `main.js`/`styles.css` (attached to every release), `README.md`,
`LICENSE`, `assets/firm-logos/*.png`, `docs/`, `tools/ux-audit.mjs`, `src/`,
`esbuild.config.mjs`, `package.json`, `tsconfig.json`.

---

## 4. Release checklist

1. `npm run build` → exit 0.
2. Smoke: 142 PASS / 0 FAIL. Audit: `node tools/ux-audit.mjs` → no violations.
3. Bump the version in `manifest.json` (and `package.json`) to the tag you are about to
   create. Pre-release suffixes for test/beta: `0.5.0-test.1`, `0.5.0-beta.1`.
4. Commit, then tag exactly that version and push the tag.
5. Create the GitHub release from the tag, attach the three assets, mark **pre-release**
   for test/beta, and write two lines of changelog (what changed, what to look at).
6. Leave the **default-branch manifest at the last stable version** once the beta is out
   — Obsidian offers the default-branch manifest to store users.
7. Note: Obsidian will not auto-upgrade `1.0.1-preview.1` → `1.0.1`; the next release
   needs a higher number (e.g. `1.0.2`).

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
