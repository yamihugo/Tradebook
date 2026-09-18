# Tradebook — working rules for this repo

## The line we never cross

**This is a journal, not a prop firm. The journal reports; the prop firm imposes.**
(product rule, 16 Sep 2026 — a standing rule.)

- Show the rule, the room left, the usage, the direction of travel. Never enforce:
  no blocking orders, no refusing trades, no holding payouts, no trade limits, no
  lockouts, no symbol blocks.
- Numbers stay honest when they are bad — a breached limit reads as breached.
- Where our model is only a model (copy legs, simulated commissions), say so: the
  platform is the source of truth; we are the record of it.
- If a feature only makes sense to a firm's back office, it does not belong here.

Full statement: `docs/UX-GUIDELINES.md` §0. Every new screen is judged against the
checklist at the bottom of that file.

## The bible (read this first)

`docs/PROJECT-SPEC.md` is the **project bible** — the authoritative map. Load and respect
it and the normative docs every chat. They are mandatory, not suggestions.

- `docs/DEV-REFERENCE.md` — platform (Obsidian), BRAT releases, language rules.
- `docs/BACKLOG-AND-HISTORY.md` — what is done / partial / pending / ruled out (read
  before proposing features).
- `docs/UI-CATALOG.md` — tokens, cards, states, CSS conventions (reference).
- `docs/ARCHITECTURE.md` — code layers, lib, data attributes (reference).
- Canonical docs live in `source/docs/`. `TradeBook/docs/` and `TradeBook/AGENTS.md` are
  **symlinks** — nothing to copy. Keep the `instructions` list in `opencode.jsonc` in sync.

## House conventions

- **Build:** `npm run build` (tsc -noEmit + esbuild production). Must exit 0.
- **Smoke:** `cd ~/trading-journal-smoke && cp <src>/main.js . && cp <src>/styles.css . && node smoke.js /home/hugo/trading-journal-smoke` → 142 PASS / 0 FAIL.
- **Audit:** `node tools/ux-audit.mjs` → must report no normative violations.
- **Deploy:** copy `main.js`, `styles.css`, `manifest.json` to
  `<vault>/.obsidian/plugins/tradebook/`. **Never** copy `data.json`. Verify md5 both
  sides. Ask the user for Ctrl+R (Obsidian does not reload plugin code by itself).
  (Firm logos are embedded in `main.js` as data URIs — no `assets/` folder to copy.)
- `styles.css` lives at the repo root and is prettier-formatted (multi-line rules);
  edit `oldString`s must match it exactly.
- Respond in **PT-PT**; the UI text is in **English**.
- Keep `docs/QA-CHECKLIST.md` current — it is the living QA record.
- Read `docs/RELEASE-AND-DISTRIBUTION.md` before touching versions, tags or the tutorial.
- No dead code, no dead CSS.
- Harness scripts (21) and artefacts (`/home/hugo/tj-out/`): see `docs/DEV-REFERENCE.md` §Harness.

## Definition of done (no task ends without this)

1. `npm run build` exits 0.
2. Smoke: **142 PASS / 0 FAIL**.
3. `node tools/ux-audit.mjs`: **0** normative violations.
4. If the change is user-visible: deployed with md5 verified, and Ctrl+R requested.
5. Docs updated in the canonical `docs/` and recorded in `PROJECT-SPEC.md` §7 when the
   change touches a rule, token, card or contract.
6. No dead code, no dead CSS.

Shortcuts: `/tj-build` (build only) · `/tj-check` (full gate) · `/tj-deploy` (deploy).
