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
