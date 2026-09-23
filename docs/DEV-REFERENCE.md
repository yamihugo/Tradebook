# DEV-REFERENCE.md — Plataforma, linguagens e referências

> **Normativo complementar**, carregado em todos os chats. Liga para fora (Obsidian,
> BRAT, TypeScript) em vez de copiar; define as regras obrigatórias de código que não
> vivem no `AGENTS.md` nem na bíblia. Regras de trabalho → `AGENTS.md`; o projeto →
> `PROJECT-SPEC.md`; catálogo de UI → `UI-CATALOG.md`; estrutura → `ARCHITECTURE.md`.

---

## 1. Plataforma — Obsidian plugins

### 1.1 Links canónicos

| Tema | Link |
|---|---|
| Developer docs (home) | https://docs.obsidian.md/Home |
| Construir o primeiro plugin | https://docs.obsidian.md/Plugins/Getting+started/Build+a+plugin |
| Anatomia de um plugin | https://docs.obsidian.md/Plugins/Getting+started/Anatomy+of+a+plugin |
| Referência da TypeScript API | https://docs.obsidian.md/Reference/TypeScript+API |
| Classe `Plugin` | https://docs.obsidian.md/Reference/TypeScript+API/Plugin |
| Sample plugin (template) | https://github.com/obsidianmd/obsidian-sample-plugin |
| Fonte dos developer docs | https://github.com/obsidianmd/obsidian-developer-docs |
| Hot-Reload (dev) | https://github.com/pjeby/hot-reload |
| CSS variables dos temas | `docs.obsidian.md` → *Themes* → *CSS variables* |

### 1.2 Regras obrigatórias da plataforma

- **O `id` do plugin é permanente**; a pasta do plugin tem de ter o mesmo nome do `id`
  (`tradebook`). Ver `RELEASE-AND-DISTRIBUTION.md`.
- **Nunca desenvolver na vault principal.** O harness é `~/trading-journal-smoke`; a
  vault em uso é a pessoal.
- **Registar tudo** com `this.register*` / `this.add*` (views, comandos, eventos,
  intervals) para o Obsidian limpar no `onunload` — sem leaks.
- **Nunca `innerHTML` com dados do utilizador.** Construir DOM com os helpers do
  Obsidian (`createDiv`, `createEl`, `createSpan`).
- Implementar `onExternalSettingsChange()` se o `data.json` puder mudar por fora.
- **No deploy nunca copiar `data.json`** (ver `AGENTS.md`).
- Preferir as APIs oficiais do Obsidian a reinventar (`Modal`, `ItemView`,
  `PluginSettingTab`, `setIcon`).
- **Sem `innerHTML`/`outerHTML`/`insertAdjacentHTML`** (a regra vai além de dados do
  utilizador): usar `createEl`/`createDiv`/`createSpan`, `setIcon` ou `el.empty()`.
- **Deferred views (Obsidian ≥1.7.2):** `leaf.view` pode ser uma `DeferredView` até estar
  visível. Fazer `await workspace.revealLeaf(leaf)` e depois `leaf.view instanceof View`
  antes de usar; nunca guardar referências a views — usar `getLeavesOfType`.
- **Pop-outs:** cada janela tem o seu `Document`/`Window`. Preferir `activeWindow`/
  `activeDocument` ou `element.win`/`element.doc`; usar `element.instanceOf(HTMLElement)`
  e `event.instanceOf(MouseEvent)` em vez de `instanceof`. *(dívida a corrigir)*
- **Lifecycle:** `registerEvent` / `registerInterval` / `registerDomEvent`; qualquer
  listener global (`document`/`window`) tem de ser removido em `onClose`/`onunload`.
  Não fazer `detachLeavesOfType` no `onunload`.
- **Comandos:** id sem o id do plugin (o Obsidian prefixa-o); sem hotkeys por omissão.
- **Copy de UI em Sentence case.** Headings de settings só com ≥2 secções, nunca a palavra
  "Settings"; usar `setHeading()`. Guardar ao alterar (não num botão *submit*).
- **Sem estilos hardcoded em JS**: classes CSS + variáveis do Obsidian, nunca literais.
- **Ícones:** só lucide até **v0.446.0**; `setIcon(el, "name")`.
- **Caminhos:** `normalizePath()` para input do utilizador; `Vault.process` (atómico) e
  `FileManager.processFrontMatter`; `cachedRead` para mostrar, `read` para read-modify-write.
- **Vault API > Adapter API**: `getFileByPath`/`getFolderByPath`/`getAbstractFileByPath`
  em vez de iterar `getFiles()`. Confirmar `instanceof TFile`/`TFolder`.
- **`const`/`let`** (nunca `var`); preferir `async/await`.
- **Mobile:** detetar com `Platform.isIosApp`/`isAndroidApp`; regex **lookbehind** só em
  iOS ≥16.4 (precisa de fallback). `isDesktopOnly:true` só se usar Node/Electron.

Ferramenta de verificação local: **<https://github.com/obsidianmd/eslint-plugin>** (ver
`RELEASE-AND-DISTRIBUTION.md` §9).

---

## 2. Releases & BRAT

Links: [BRAT](https://github.com/TfTHacker/obsidian42-brat) ·
[guia developer](https://github.com/TfTHacker/obsidian42-brat/blob/main/BRAT-DEVELOPER-GUIDE.md) ·
[docs BRAT](https://tfthacker.com/BRAT) ·
[exemplo](https://github.com/TfTHacker/obsidian-brat-example-plugin) ·
[Release com GH Actions](https://docs.obsidian.md/Plugins/Releasing/Release+your+plugin+with+GitHub+Actions).

Regras e processo completos: **`RELEASE-AND-DISTRIBUTION.md`** (assets do release são a
fonte da verdade; tag = release = versão; `manifest.json` do root fica no último estável).

---

## 3. Linguagens & ferramentas

### 3.1 Stack real

- **TypeScript** `^5.4` · **esbuild** `^0.20` · **Node** `^20` (types) · `obsidian` API.
- `tsconfig.json`: `target ES2018`, `module ESNext`, `moduleResolution node`,
  libs `DOM/ES5/ES6/ES7/ES2020`, `noImplicitAny: true`, `strictNullChecks: true`.
- **Atenção:** o tsconfig **não** é `strict: true` completo. Não o alterar sem discutir —
  é decisão consciente.

### 3.2 Regras obrigatórias de TypeScript

- Sem `any` implícito; evitar `as` cego e `!` desnecessário.
- Tipos de domínio vivem em `src/types.ts`; não duplicar tipos.
- Sem dependências novas sem justificação (o plugin é 100% local, sem cloud).
- Lógica pura vai para `src/lib/`; views só renderizam.
- `npm run build` = `tsc -noEmit -skipLibCheck` + esbuild production → **tem de sair 0**.

### 3.3 CSS

Regras e convenções de CSS (prefixo `tj-`, tokens, prettier multi-line, sem dead CSS)
vivem em **`UI-CATALOG.md` §9** e `AGENTS.md`.

Links úteis: [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro.html) ·
[strict](https://www.typescriptlang.org/tsconfig#strict) ·
[esbuild](https://esbuild.github.io/) · [Prettier](https://prettier.io/docs/) ·
[MDN DOM](https://developer.mozilla.org/en-US/docs/Web/API/Document_Object_Model) ·
[WCAG 2.2](https://www.w3.org/TR/WCAG22/).

### 3.4 Idiomas

- **UI:** inglês (strings nos ficheiros que as desenham — não há i18n).
- **Docs e respostas do agente:** PT-PT.

### 3.5 Sources (UX/design)

Base das regras de `UX-GUIDELINES.md`: **W3C WCAG 2.2** (SC 1.4.1/1.4.3/1.4.11/1.4.12/1.4.13/2.4.7/2.5.7/2.5.8) ·
**ISO 9241-110/-112** · **EN 301 549** + European Accessibility Act · **Material Design 3** ·
**Apple HIG** · **IBM Carbon / USWDS / BBC GEL / Atlassian / Shopify Polaris** ·
Cleveland & McGill (1984) · Tufte (1983) · Few (2006) · Nielsen Norman Group ·
Cowan (2001) · Hick (1952)/Hyman (1953) · Fitts (1954) · Doherty & Kelso (1982) ·
Wertheimer (1923) · Okabe & Ito (2008) · ColorBrewer · Bringhurst · Brown (2011).

---

## 4. Princípios gerais de código (obrigatórios)

- Seguir os padrões existentes antes de inventar novos.
- Funções pequenas e focadas; nomes claros; código autoexplicativo.
- Sem código morto, sem estilos mortos, sem comentários obsoletos.
- Validar todos os inputs; nunca expor segredos; princípio do menor privilégio.
- Testar o caminho feliz **e** os erros; correr o smoke (181 PASS) e o audit antes de dar
  algo por feito.
- Se uma regra for violada por engano, corrigir e registar em `PROJECT-SPEC.md` §7.

---

## 5. Harness (suite de verificação em `~/trading-journal-smoke/`)

```
repro-vault.js · nan-sweep.js · rules-check.js · sim-check.js · session-check.js
pass-check.js · cards-check.js · manage-check.js · wizard-check.js · numbers-check.js
accmodal-check.js · datefmt-check.js · trends-check.js · tip-check.js · tradelog-check.js
fills-check.js · filters-check.js · backup-check.js · onboarding-check.js · payouts-check.js
rename-plan.js · rename-apply.js · folder-check.js · tradelog-perf.js
```

Screenshots/artefactos: `layout-shot.js <out>` · `modal-shot.js` · `tradelog-shot.js`.
**Escrever artefactos em `/home/hugo/tj-out/`** — `/tmp` é um tmpfs pequeno.
O full gate é `node smoke.js /home/hugo/trading-journal-smoke` → **181 PASS / 0 FAIL**.
