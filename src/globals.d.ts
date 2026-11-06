/**
 * Ambient module declarations for static assets imported by the build.
 *
 * esbuild inlines these as data URIs (see `esbuild.config.mjs`), so the bundled
 * `main.js` is self-contained and works for BRAT / community-store installs.
 */
declare module "*.png" {
  const dataUri: string;
  export default dataUri;
}

interface Window {
    __tjBackup?: unknown;
    __tjBreakdown?: unknown;
    __tjChartKit?: unknown;
    __tjDiagnostics?: unknown;
    __tjFills?: unknown;
    __tjGrid?: unknown;
    __tjMetrics?: unknown;
    __tjMoney?: unknown;
    __tjPeriodComparisons?: unknown;
    __tjPeriods?: unknown;
    __tjProcess?: unknown;
    __tjReportedHistory?: unknown;
    __tjReview?: unknown;
    __tjScore?: unknown;
    __tjSessions?: unknown;
    __tjTradeTable?: unknown;
    __tjTrends?: unknown;
  }
