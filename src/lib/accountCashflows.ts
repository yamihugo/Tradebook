/**
 * The single place an account's cash movements become signed values for the
 * balance engine.
 *
 * A payout lowers the account, a deposit raises it, and a balance adjustment
 * carries its own sign (negative when the account holds less than the journal
 * says). Trading P&L never sees any of these: money leaving is not a loss. Every
 * balance consumer reads this, so the sign convention can never drift between
 * the account page, the accounts list and Home.
 */

export interface AccountCashflow {
  date: string;
  amount: number;
}

export function accountCashflows(
  payouts: ReadonlyArray<{ date: string; amount: number }> = [],
  deposits: ReadonlyArray<{ date: string; amount: number }> = [],
  adjustments: ReadonlyArray<{ date: string; amount: number }> = []
): AccountCashflow[] {
  return [
    ...payouts.map((p) => ({ date: p.date, amount: -Math.abs(p.amount) })),
    ...deposits.map((d) => ({ date: d.date, amount: Math.abs(d.amount) })),
    ...adjustments.map((a) => ({ date: a.date, amount: a.amount })),
  ];
}
