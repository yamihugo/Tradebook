# Closed beta — installation, updates and bug reports

Tradebook's current manifest identifies the plugin as `tradebook` and requires
Obsidian 1.4.0 or newer. This guide describes the repository's installation
workflow; it does not confirm that a particular beta release is currently
published. Check the project's GitHub Releases page for the exact tag and assets
provided to your test group.

## Install a beta version

### BRAT

1. Install and enable **BRAT** from *Settings → Community plugins → Browse*.
2. In BRAT, add `https://github.com/yamihugo/Tradebook` as a beta plugin.
3. Enable **Tradebook** in *Settings → Community plugins*.
4. To test a specific beta, use BRAT's frozen/pinned-version control, if available
   in the installed BRAT version, and select the requested release tag. A tag is
   installable only after its GitHub release has been published.

BRAT is the documented route for checking later releases. Use its update check or
update action after the beta team announces a new version.

### Manual installation fallback

Download `main.js`, `manifest.json` and `styles.css` from the **same published
release**. In the target vault, place them in:

```text
.obsidian/plugins/tradebook/
```

The folder name must match the plugin ID, `tradebook`. Create/enable the plugin
through *Settings → Community plugins*. For an update, replace only those three
runtime files with files from the same release, then reload Obsidian if the new
code has not loaded. **Do not replace, delete or copy over `data.json`.**

The repository's `main.js` is a build output and is not committed. `styles.css`
and `manifest.json` are maintained in the repository. Logo source files are
embedded in `main.js`; there is no runtime `assets/` folder to install.

## Back up before testing an update

1. In Tradebook, open *Settings → Advanced → Backup → Export everything*.
2. Keep the resulting backup outside the plugin folder and verify that you can
   locate it before updating. It contains plugin settings and trade-note Markdown.
3. If the backup must also cover screenshot images, make a separate private copy
   of the vault. The Tradebook JSON backup does not contain those image files.

Plugin settings live in `.obsidian/plugins/tradebook/data.json`. Trade notes are
Markdown under the configured journal root. A normal plugin update uses the same
plugin ID and folder; uninstalling the plugin can delete its folder, including
`data.json`, so do not uninstall as an update method.

To identify the installed versions, use *Settings → Advanced → Copy diagnostics*.
The diagnostics text includes the Tradebook version and Obsidian version without
including note contents. Share it only through the beta team's approved private
support channel, or inspect the version locally before filing a report.

## Journal root warning

The default journal root is `Tradebook`. Trade notes are filed under
`<root>/<year>/<month>/trades/`; screenshots go under
`<root>/<year>/attachments/`.

**Changing the configured root does not move or delete existing notes.** If a
journal already exists, select its actual current root. If the configured root
points somewhere else, Tradebook may look empty while the notes remain elsewhere
in the vault. Do not change the root to reorganize an existing journal.

## Resetting preferences

**Reset all settings** resets only a defined subset: dashboard layouts, Trade Log
view preferences, privacy mode, startup/tab behavior, date/time display
preferences, and default symbol/quantity. It does **not** delete trade notes or
accounts, and it does not reset every stored setting. It is not a factory reset.

## Beta bug report

```text
Tradebook version:
Obsidian version:
Operating system and version:

Steps to reproduce:
1.
2.
3.

Expected result:
Observed result:
Does it also happen in a disposable vault? (yes / no / not tested):

Optional: screenshot(s):
Optional: Tradebook diagnostics (review before sharing):
```

Do **not** post private trading notes, account identifiers, credentials, or full
backups in public issues or Discord messages. Redact screenshots and diagnostics
before sharing if they reveal private information. Prefer a disposable vault for
reproductions; never include real trades in a public report.
