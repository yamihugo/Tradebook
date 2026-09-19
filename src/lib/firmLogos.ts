/**
 * The packaged logo catalog.
 *
 * Logos are embedded in `main.js` as data URIs at build time (esbuild
 * `loader: { ".png": "dataurl" }`), because BRAT and the community store only
 * download `main.js`, `manifest.json` and `styles.css` — a loose `assets/`
 * folder would never reach the user.
 *
 * To add a logo: drop a transparent PNG (128×128, square) in
 * `assets/firm-logos/<id>.png`, add an import below and a line in `LOGOS`.
 * A catalog entry without a file still shows in the wizard — it falls back to
 * the account's initials.
 *
 * Trade names and logos belong to their owners and are used only to identify
 * the firm or broker an account sits at.
 */

import topstepLogo from "../../assets/firm-logos/topstep.png";
import tradeifyLogo from "../../assets/firm-logos/tradeify.png";
import apexLogo from "../../assets/firm-logos/apex.png";
import takeProfitTraderLogo from "../../assets/firm-logos/takeprofittrader.png";
import myFundedFuturesLogo from "../../assets/firm-logos/myfundedfutures.png";
import lucidTradingLogo from "../../assets/firm-logos/lucidtrading.png";
import alphaFuturesLogo from "../../assets/firm-logos/alphafutures.png";
import ftmoFuturesLogo from "../../assets/firm-logos/ftmofutures.png";
import fundedNextLogo from "../../assets/firm-logos/fundednext.png";
import topOneFuturesLogo from "../../assets/firm-logos/toponefutures.png";
import tradovateLogo from "../../assets/firm-logos/tradovate.png";
import ninjaTraderLogo from "../../assets/firm-logos/ninjatrader.png";
import interactiveBrokersLogo from "../../assets/firm-logos/interactivebrokers.png";
import ampFuturesLogo from "../../assets/firm-logos/ampfutures.png";

export interface FirmLogoEntry {
  id: string;
  label: string;
  group: "prop" | "broker" | "practice";
}

/** What the wizard shows in the logo grid, in order. */
export const FIRM_CATALOG: FirmLogoEntry[] = [
  { id: "topstep", label: "Topstep", group: "prop" },
  { id: "tradeify", label: "Tradeify", group: "prop" },
  { id: "apex", label: "Apex Trader Funding", group: "prop" },
  { id: "takeprofittrader", label: "Take Profit Trader", group: "prop" },
  { id: "myfundedfutures", label: "MyFundedFutures", group: "prop" },
  { id: "lucidtrading", label: "Lucid Trading", group: "prop" },
  { id: "alphafutures", label: "Alpha Futures", group: "prop" },
  { id: "ftmofutures", label: "FTMO Futures", group: "prop" },
  { id: "fundednext", label: "FundedNext", group: "prop" },
  { id: "toponefutures", label: "TopOne Futures", group: "prop" },
  { id: "tradovate", label: "Tradovate", group: "broker" },
  { id: "ninjatrader", label: "NinjaTrader", group: "broker" },
  { id: "interactivebrokers", label: "Interactive Brokers", group: "broker" },
  { id: "ampfutures", label: "AMP Futures", group: "broker" },
  { id: "own", label: "Practice", group: "practice" },
];

const LOGOS: Record<string, string> = {
  topstep: topstepLogo,
  tradeify: tradeifyLogo,
  apex: apexLogo,
  takeprofittrader: takeProfitTraderLogo,
  myfundedfutures: myFundedFuturesLogo,
  lucidtrading: lucidTradingLogo,
  alphafutures: alphaFuturesLogo,
  ftmofutures: ftmoFuturesLogo,
  fundednext: fundedNextLogo,
  toponefutures: topOneFuturesLogo,
  tradovate: tradovateLogo,
  ninjatrader: ninjaTraderLogo,
  interactivebrokers: interactiveBrokersLogo,
  ampfutures: ampFuturesLogo,
};

/** The data URI for a packaged logo, or null when we have no file for it. */
export function firmLogoUrl(id: string): string | null {
  return id && LOGOS[id] ? LOGOS[id] : null;
}

/** The catalog entry for an id, so a label always exists even without a file. */
export function firmLabel(id: string): string | null {
  return FIRM_CATALOG.find((f) => f.id === id)?.label ?? null;
}
