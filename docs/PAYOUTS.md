# Payouts — como os modelamos (e o que os outros fazem)

> Investigation, 17 Sep 2026: «o payout basicamente tira dinheiro da conta,
> simples né? se tiveres dúvidas confirma como está no Journalit e outros journals».
> Fontes: bundle do Journalit 1.8.4 (lido no repo local), regras oficiais das firms (TopStep,
> Tradeify) e documentação oficial de 10 journals + 4 ferramentas de prop.

## 1. O facto na vida real

Um payout **tira dinheiro da conta**:

- **TopStep (XFA)**: o montante aprovado é **subtraído da balance**; depois do primeiro payout passa
  a existir um *Minimum Payout Balance* (regras oficiais, Jun 2025).
- **Tradeify**: as fundeds exigem um saldo mínimo para poder levantar e o cap depende do número do
  payout.

Logo: um payout é um **evento de caixa negativo** na conta. Não é um troféu, não é uma métrica de
performance — é dinheiro que sai.

## 2. O que os outros fazem (resumo verificado)

| Produto | Payout é… | Efeito |
|---|---|---|
| **Journalit** | **não existe payout.** Só `manualTransactions` (`deposit`/`withdrawal`, `amount` assinado) | balance = soma cumulativa; withdraw não mexe em net P&L / growth % / win rate; baixa AUM e **aumenta o dd usado** (`remainingDistance = balance − floor`); o floor é `max(balances)` e é **monotónico**, logo um payout não o sobe nem o reinicia |
| **TradeZella** | Distingue **Withdrawal** (ajuste de saldo) de **Payout** (categoria própria, no PropFirm Sync) | curva de saldo com uma **linha vermelha por baixo** com os cash-flows ("para veres se os dips são perdas ou levantamentos"); ROI = payouts − gastos |
| **TradesViz** | payout = um **withdrawal** | **só o equity graph inclui** depósitos/levantamentos; todos os outros gráficos são só P&L; tem **Payout Readiness Indicator** (buffer acima do floor) |
| **TraderSync** | "Account Adjustments" (deposit/withdrawal/fees) | mudam o saldo e a *Accumulative Return %*; P&L/win rate continuam só de trades |
| **Edgewonk** | deposits/withdrawals (negativo = levantamento) | mudam o saldo; o Equity Graph mostra a balance |
| **Tradesyncer** | **Payout** é um tipo de transação próprio ("Money withdrawn") | separa "Spent = o que pagaste" de "Payouts = o que ganhaste"; ROI |
| **TradeTally** | cash-flow com running balance | equity curve vem de **snapshots**, não das transações |
| **PayoutLab / PropTracker** | **motor de elegibilidade** | "Payout Eligibility ✓ auto-calculado", buffers, caps ("primeiros 5 payouts com cap"), splits, timeline requested → paid |
| Tradervue, TradeNote, Traders Connect | **nada** | — |

**O que é normal:** dois ledgers separados (trades de um lado, dinheiro que entra/sai do outro); o
import **nunca** traz cash-flows (é sempre manual); uma só curva inclui os cash-flows.
**O que é raro:** "payout" como categoria própria (TradeZella, Tradesyncer); readiness com buffer
acima do floor (TradesViz, PayoutLab); status e caps.
**O que ninguém documenta:** **reiniciar o trailing floor / o pico / o ciclo de consistência quando há
um payout** — apesar de ser exactamente o que as firms fazem na prática.

## 3. O que ficou decidido (e implementado)

The product rule is direct: **the journal is not a prop firm**. Tudo o que é *regra de payout* saiu do sistema —
o trabalho das firms é o trabalho das firms. O que ficou é só o que faz o **valor seguir certo**.

**Ficou (é nosso):**

- **O registo do payout**: `Payout { id, accountId, date, amount, note }`. Formulário e tabela com
  **Date · Amount · Note** — marca-se o dia em que o dinheiro caiu. Sem estados, sem splits, sem caps.
- **O valor de conta registado** = `current configured size + Net das trades − payouts + depósitos + FeeAdjustments assinados`.
  Cada fonte entra uma vez: fees registadas na trade já estão dentro do Net; um custo órfão ou
  correção não atribuída a uma trade entra como ajuste datado; allocations guardadas são metadados
  e não voltam a mover o saldo. Os cartões individuais e o número grande **Account Balance** da
  página da conta mostram esta estimativa registada, não um snapshot/live equity do broker. A strip
  das Accounts mostra separadamente **Account Capital** e o **Remaining Account P&L** versus esse
  capital. Net trading P&L fica separado: diz o resultado de trading, não o dinheiro atual na conta.
- **Drawdown over the recorded account balance** — decision: «se tu tirares um payout, na prop firm ficas
  mais próximo do drawdown porque já não tens tanto dinheiro lá». O motor recebe os `cashflows`
  (payouts negativos, depósitos positivos), o floor vem do **pico da balance** e `ddToLimit` é o número
  que a firm vê. Efeito no simulador: balance `50.300 → 49.600` e distância ao limite `1.700 → 2.400`,
  **com o net P&L parado em +300**.
- **As métricas de performance nunca levam cash-flows** (net P&L, win rate, expectancy, profit factor,
  R). É a regra que todos os produtos sérios seguem, e a nossa.
- **Change vs Account Size** é `Total Account Balance − soma dos account sizes atualmente configurados`, e inclui
  Net trading, payouts, depósitos e ajustes assinados. O modelo não guarda história imutável do size,
  logo não pode prometer a diferença face ao size originalmente criado se este foi editado. É mudança
  do valor de conta registado, não lucro retido nem montante withdrawable. O **Paid Out** é o total histórico registado de dinheiro
  retirado; não o adicionamos ao saldo nem ao Net trading P&L, e não inferimos rendimento pessoal.

**Saiu (não é nosso):** rotas de payout por firm, `qualifying days`, `day threshold`, `per payout` /
caps, `profit since last payout`, `cycleNet` / `cycleConsistencyPct`, o campo `PropAccount.payoutPath`,
o widget «Payouts» da página da conta, a barra «Since last payout» do cartão, o segmento «Payout route»
do modal, e o veredicto `PAYOUT READY` (removido antes, a pedido dele: «vamos tirar isso ready to
payout de tudo e assim, vamos pelo simples»).

**Fica só um alerta:** `NEAR LIMIT` — o chip âmbar quando o drawdown usado chega a **80%** do limite.
É reportagem pura: «Nothing is blocked here — the platform is the one that enforces the limit.»

**Nota:** os `note`/`tagline` do `src/props.ts` continuam a descrever as regras de payout das firms em
**prosa** (ex.: «Payout: 5 profitable days (≥ $150/day) and 35% consistency; minimum balance $53,000»).
É informação da firm, não maquinaria — mas (to be confirmed) whether this also leaves.

## 4. As três decisões (fechadas)

1. **Uma curva ou duas?** **Uma** — a curva de caixa (valor real, com os cash-flows) é a da carteira e a
   da conta; os gráficos de performance continuam só com P&L. Duas curvas no mesmo sítio convidam à
   confusão.
2. **Payout é transação de saldo ou evento de metadata?** **Transação**: mexe na balance e carrega só
   uma nota. É a única forma de não ter dois sítios a discordar.
3. **Um payout reinicia o estado de risco?** **Não automaticamente** — e **não se pergunta nada**
   (decision: keep it simple). O floor continua a vir do pico de fecho.

## 5. O que isto implica no que falta

- **Existe uma payout page** (17 Set): o botão quadrado com ícone de dinheiro (`banknote`) no cabeçalho
  das contas **funded / live / personal** abre um modal com **Total paid out**, o número de payouts,
  a data do último, o formulário (Date · Amount · Note) sempre visível e a tabela com remover. Sob o
  título da conta ficou a linha `Paid out $X · N payouts` (o «canto confortável» pedido). O termo
  único em todo o produto passou a ser **Payout** (a célula da strip era `Withdrawals`, as mini-stats
  diziam `Withdrawn`; agora dizem `Payouts` e `Paid out`).
- **Widget de payouts na Home** (total levantado, contagem, contas, ano, 6 meses em barras, último).
- **Sem mais alertas de payout.** O único sinal nos cartões é o de limite.
- **Cenário de teste `sim/`**: como já não há veredicto, os 5 dias bons perderam função; o que ainda
  demonstra algo é o dia mau (âmbar a 85%) e o efeito de registar um payout na balance e no limite.
  Apagar: pasta `sim/`, ou Trade Log → Setup `SIM · TMM` → selecção → Delete.

- **Guardar com resposta (17 Set)**: o formulário do modal falhava em silêncio com o campo vazio (parecia um bug de persistência). Agora o valor inválido mostra `Enter an amount first — for example 1,000.` inline e o valor válido confirma com uma `Notice` (`Logged $X paid out of <conta>.`). O modal segue o desenho da casa (label à esquerda, controlos ghost, `Log payout`), a lista deixou de ser tabela e o empty-state deixou de transbordar. As notas de ensino saíram do modal e das tooltips.

- **Badge dourado (17 Set)** — e a porta é o quadrado no header (17 Set, 2.ª passagem): o header da conta tem **dois** quadrados (payouts + account settings); o badge dourado (`Paid out $2.2K`) vive sob o título e é **só informação** (não é botão), com a contagem no hover. Os controlos do modal são scoped (`input`/`button` com `!important`) porque dentro de um modal o Obsidian pinta os seus próprios estilos por cima de uma classe solta.

- **Uma superfície + badge no header (17 Set)**: o formulário do modal deixou de usar `.tj-payout-form` (a moldura legada que os depósitos ainda usam) e passou a `.tj-payout-fields` — um modal é uma superfície. A data ficou encostada à direita, alinhada com o Amount (medido, não estimado). O `Log payout` passou a **ghost** forçado com `!important` (dentro de modais o Obsidian pinta os botões por cima da nossa classe). E o badge dourado subiu para o **header**, à esquerda dos dois quadrados, numa linha que não faz wrap.

- **Metal, uma só superfície (17 Set)**: o modal tinha dois fundos porque carregava a classe legada `tj-modal` (a caixa do overlay antigo) dentro do `Modal` real — retirada de todos os modais. A data passou a ficar ao canto direito (o `input` era esticado pelas regras do Obsidian para `.modal-content input[type="text"]`; corrigido com selector scoped + `!important`, provado por medição: `date [395,545] == amount [395,545]`). O badge é agora **metal**: gradiente que escurece nas pontas, hairline de luz em cima, aresta escura em baixo, glow dourado e tinta escura sobre o ouro, com o brilho a atravessar mais visível (e a desligar-se com as animações/`prefers-reduced-motion`).

- **A data, segunda passagem (17 Set)**: o valor ficava 22px à esquerda da aresta porque o *glifo* do calendário vive dentro do mesmo wrapper — no modal dos payouts o glifo foi retirado e a caixa ficou com os mesmos 150px do Amount. O `input[type="date"]` invisível passou a ter as propriedades **inline** em `mountDateField` (dentro de modais as regras do Obsidian ganham a uma classe e o campo esticava) — o que também domou todos os outros campos de data do plugin. Medição: `wrap [395,545] == date [395,545] == amount [395,545]`.

- **No gráfico (17 Set)**: o dia do payout fica marcado com um **ponto dourado** na curva da conta (não verde/vermelho: o dinheiro saiu, não se perdeu) e o pop-up desse dia ganha uma linha **Payout** com o valor dessa conta. No gráfico da carteira (que soma contas) o pop-up mostra o **total do dia somado por todas as contas visíveis**. Provado no harness `cash-check.js`.
