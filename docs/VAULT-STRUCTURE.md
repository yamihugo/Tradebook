---
title: Vault Structure
date: 2026-09-19
tags: [architecture, vault, folders, storage, obsidian, plugin]
aliases: [Vault Structure, Folder Model, Estrutura da Vault]
---

# Vault Structure

> [!note] TL;DR
> A vault é **uma raiz só** (`Tradebook/`), com o que é **evergreen** no topo (`library/`)
> e o que é **série temporal** por ano (`<ano>/<mês>/trades/`). O plugin **descobre as
> notas pelo `type` do frontmatter, não pela pasta** — por isso o utilizador pode
> reorganizar como quiser que nada quebra. Um ano é autocontido: apagar, zipar ou
> fazer backup de `2026/` não toca em mais nada. As pastas nascem **à medida** (só
> quando o primeiro ficheiro lá cai), nunca vazias.

---

## 1. A estrutura

```
Tradebook/                      ← raiz única, configurável
├── library/                    ← evergreen (sem data; criada à medida)
│   ├── strategies/             ← uma nota por estratégia (2.0)
│   ├── playbooks/              ← reservado
│   └── mindset/                ← psicologia / disciplina (reservado)
├── 2026/
│   ├── 01/ … 12/               ← mês numérico, zero-padded
│   │   └── trades/             ← as notas de trade vivem aqui
│   ├── reviews/                ← reviews de dia / semana / mês / ano
│   └── attachments/            ← screenshots do ano
├── 2027/ …
└── _tradebook/                 ← sistema: backups, snapshots de import (fora das varreduras)
```

**O que é evergreen vs série temporal:**

| | Onde vive | Porquê |
|---|---|---|
| Estratégias, playbooks, mindset | `library/` (topo) | Não pertencem a um ano; duram para sempre. |
| Trades, reviews, anexos | `<ano>/` | Pertencem a um ano; é o que se apaga/zipa/arquiva. |
| Backups, snapshots de import | `_tradebook/` | Sistema; nunca é jornal e nunca é lido como dados. |

---

## 2. As sete regras

1. **Raiz única, configurável.** Há uma só raiz (`settings.tradesFolder`, por omissão
   `Tradebook`). Nada hardcoda caminhos mais fundo — tudo é derivado da raiz.
2. **Descoberta por `type`, não por pasta.** O plugin varre a raiz à procura de
   `type: trade`, `type: strategy`, etc. A pasta é só organização: mover/reorganizar
   nunca parte nada, e uma feature nova ganha casa sem migração.
3. **Evergreen no topo (`library/`), série temporal no ano (`<ano>/`).**
4. **Mês numérico + `trades/`.** `<ano>/<mês>/trades/` com o mês em `01`..`12`
   (ordena bem, é neutro em qualquer língua).
5. **Re-homing automático.** Se a data de um trade mudar de mês, a nota é **movida**
   para a pasta do mês certo, pela API do Obsidian (links preservados), idempotente,
   nunca sobrepõe e nunca perde a nota.
6. **Anexos colados ao dono.** Screenshots de trades em `<ano>/attachments/`; os de
   estratégias em `library/`.
7. **`data.json` = índice + preferências, nunca a verdade.** A verdade são as notas.

---

## 3. Descoberta por `type`

O frontmatter de cada nota diz o que ela é:

```yaml
---
type: trade
date: 2026-09-19
symbol: NQ
...
---
```

Consequências:

- O plugin **não** assume `Tradebook/trades/`. Varre a raiz (recursivamente) e filtra
  por `type`.
- Mover a nota para outra pasta não muda nada para o plugin — só a organização muda.
- Uma nota com `type` desconhecido é ignorada em segurança (nunca rebenta).
- O `data.json` continua a ser apenas um **índice/cache**: se for perdido, o plugin
  reconstrói tudo a partir das notas.

---

## 4. Re-homing (mover a nota quando a data muda)

Um trade tem a data **dentro** da nota (frontmatter), não na pasta. Logo:

- Corrigir a data **nunca** reverte nada, mesmo que a pasta seja apagada e recriada —
  a data lida é sempre a do frontmatter.
- Mover é **arrumação**, não verdade. Ainda assim, o trader escolheu **mover
  automaticamente**: se a data mudar de mês, a nota passa para a pasta do mês certo.

Garantias do movimento:

- Feito pela **API do Obsidian** (`fileManager.renameFile`), por isso os **links e
  backlinks são atualizados sozinhos**.
- **Idempotente**: se já estiver na pasta certa, não faz nada.
- **Nunca sobrepõe**: se já existir um ficheiro com o mesmo nome no destino, a nota
  fica onde está e o sucedido é registado (log), nunca se perde conteúdo.
- **Nunca perde a nota**: se o movimento falhar, a nota fica e a data continua correta.

---

## 5. Criação à medida (lazy)

Nenhuma pasta é criada por antecipação:

- `library/` e `library/strategies/` nascem **quando a primeira estratégia é escrita**.
- `<ano>/<mês>/trades/` nasce quando cai o primeiro trade desse mês.
- `reviews/` e `attachments/` nascem com o primeiro ficheiro.
- A API do Obsidian não cria pastas-pai sozinha: a cadeia (`library` → `strategies`)
  é criada de uma vez quando for precisa.

Isto evita uma árvore de pastas vazias que só faz ruído no explorador de ficheiros.

---

## 6. Migração da pasta plana (implementada na 1.0)

> [!note] Já está a correr
> Isto **não** ficou para o 2.0: a estrutura é a da 1.0 e a migração corre no
> primeiro arranque do plugin depois do update (`settingsVersion` versão 1, em
> `main.ts`). Um journal novo nasce logo com `<ano>/<mês>/trades/`.

Antes desta versão os trades vivem **planos** em `Tradebook/trades/`. A migração:

1. Lê todas as notas com `type: trade` (ou as que estão na pasta antiga).
2. Move cada uma para `<ano>/<mês>/trades/` **pela API do Obsidian** (links
   preservados).
3. É **idempotente**: correr duas vezes dá o mesmo resultado.
4. É **registada** na migração numerada (ver `settingsVersion` em
   `STRATEGY-DATA-CONTRACT.md`), por isso só corre uma vez por journal.
5. Nunca sobrepõe nem apaga: em conflito de nome, mantém a nota e regista.

Durante uma versão, o plugin pode **ler as duas localizações** (a pasta antiga e a
nova) para nunca falhar a meio da transição — na 1.0 lê notas sem `type` que vivam
dentro de `…/trades/`, além de todas as que já têm `type: trade`.

---

## 7. Porque não copiámos o Journalit

O Journalit usa `!Journalit/<ano>/Q<trimestre>/<mês>/W<semana>/trades/`, com reviews
dentro do período e anexos em `<ano>/<mês>/<semana>`. É mais profundo do que
precisamos:

- A granularidade **semana a semana** só dá valor a *reviews* — que resolvemos por
  **nota** (uma pasta `reviews/`), não por pasta.
- Mais profundidade = mais caminhos e uma migração maior, sem ganho para o plugin
  (que descobre por `type`).
- Mantemos o que o Journalit faz bem: **ano autocontido** e **anexos por ano**.

Ver `docs/DEV-REFERENCE.md` para as regras de plataforma (Obsidian) e
`docs/STRATEGY-DATA-CONTRACT.md` para a fundação de dados.

---

## Related Notes
- [[STRATEGY-DATA-CONTRACT]]
- [[BACKUP-AND-EXPORT]]
- [[ARCHITECTURE]]
- [[PROJECT-SPEC]]
