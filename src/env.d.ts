// Injected at build time by build.mjs.

/** package.json's "homepage" field. */
declare const __APP_HOMEPAGE__: string;

/** Normalised base URL the client is served under (always "/…/", default "/"). */
declare const __APP_BASE_URL__: string;

/** Flag font file name in dist/, copied from country-flag-emoji-polyfill. */
declare const FLAG_FONT_FILE: string;

/** Font family the flag polyfill registers; must match `.flag` in styles.css. */
declare const FLAG_FONT_FAMILY: string;
