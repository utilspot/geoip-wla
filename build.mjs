// Build script: bundles the TypeScript/React source in src/ into a small set of
// static client files in dist/ (index.html, index-<hash>.js, index-<hash>.css,
// favicon.svg, logo_wla.svg, TwemojiCountryFlags.woff2, manifest.json). Uses esbuild only (a devDependency) — no
// framework CLI, no config files.
//
// Base URL (URL path prefix the client is served under, default "/") is taken
// from, in order of precedence:
//   1. a --base-url=<value> CLI argument
//        node build.mjs --base-url=/geoip/
//        npm run build -- --base-url=/geoip/
//   2. the npm_config_base_url env var, which npm sets for:
//        npm run build --base-url=/geoip/
//        npm run dev   --base-url=/geoip/   (inherited by the nested build)
import * as esbuild from 'esbuild';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const OUT_DIR = 'dist';
const watch = process.argv.includes('--watch');

const APP_TITLE = 'GeoIP Lookup';

// Flag emoji polyfill font (Chromium on Windows has no flag glyphs), served
// from dist/ instead of the package's default CDN URL.
const FLAG_FONT_FILE = 'TwemojiCountryFlags.woff2';
const FLAG_FONT_FAMILY = 'Twemoji Country Flags';
const FLAG_FONT_SRC = `node_modules/country-flag-emoji-polyfill/dist/${FLAG_FONT_FILE}`;

const pkg = JSON.parse(await readFile('package.json', 'utf8'));

/**
 * Resolve the base URL as given, only ensuring a single leading slash (a
 * trailing slash is kept if present, never added): "666" -> "/666",
 * "/666/" -> "/666/", "" -> "/".
 */
function resolveBaseUrl() {
  const cliArg = process.argv
    .find((a) => a.startsWith('--base-url='))
    ?.slice('--base-url='.length);
  const raw = (cliArg ?? process.env.npm_config_base_url ?? '/').trim() || '/';
  return `/${raw}`.replace(/\/{2,}/g, '/');
}

// baseUrl: served URL of index.html (also manifest `base` and `main`).
// rootUrl: baseUrl with a trailing slash, the prefix for every other asset.
const baseUrl = resolveBaseUrl();
const rootUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: { index: 'src/index.tsx' },
  bundle: true,
  outdir: OUT_DIR,
  // fixed names while watching (stable reloads), content-hashed for release
  entryNames: watch ? '[name]' : '[name]-[hash]',
  format: 'iife',
  platform: 'browser',
  target: ['es2020'],
  jsx: 'automatic',
  minify: !watch,
  sourcemap: false,
  legalComments: 'none',
  metafile: true,
  define: {
    'process.env.NODE_ENV': watch ? '"development"' : '"production"',
    __APP_HOMEPAGE__: JSON.stringify(pkg.homepage ?? ''),
    __APP_BASE_URL__: JSON.stringify(rootUrl),
    FLAG_FONT_FILE: JSON.stringify(FLAG_FONT_FILE),
    FLAG_FONT_FAMILY: JSON.stringify(FLAG_FONT_FAMILY),
  },
  logLevel: 'info',
};

/** Pull the emitted js/css basenames out of the esbuild metafile. */
function bundledAssets(metafile) {
  let js;
  let css;
  for (const outPath of Object.keys(metafile.outputs)) {
    const name = path.basename(outPath);
    if (name.endsWith('.js')) js = name;
    else if (name.endsWith('.css')) css = name;
  }
  if (!js || !css) throw new Error('esbuild did not emit both a JS and a CSS file');
  return { js, css };
}

async function writeClientFiles(metafile) {
  const { js, css } = bundledAssets(metafile);

  // index.html: swap the placeholder asset names for the hashed ones and
  // prefix every local reference with the base URL.
  let html = await readFile('src/index.html', 'utf8');
  html = html
    .replaceAll('href="favicon.svg"', `href="${rootUrl}favicon.svg"`)
    .replaceAll('href="app.css"', `href="${rootUrl}${css}"`)
    .replaceAll('src="app.js"', `src="${rootUrl}${js}"`);
  await writeFile(path.join(OUT_DIR, 'index.html'), html);

  await copyFile('src/favicon.svg', path.join(OUT_DIR, 'favicon.svg'));
  await copyFile('src/logo_wla.svg', path.join(OUT_DIR, 'logo_wla.svg'));
  await copyFile(FLAG_FONT_SRC, path.join(OUT_DIR, FLAG_FONT_FILE));

  const manifest = {
    name: pkg.name,
    base: baseUrl,
    entries: [
      {
        title: APP_TITLE,
        version: pkg.version,
        description: pkg.description,
        main: baseUrl,
        icons: [
          { url: `${rootUrl}favicon.svg`, colorScheme: 'light' },
          { url: `${rootUrl}favicon.svg`, colorScheme: 'dark' },
        ],
        screenshots: [
          { url: `${rootUrl}logo_wla.svg`, colorScheme: 'light' },
          { url: `${rootUrl}logo_wla.svg`, colorScheme: 'dark' },
        ],
      },
    ],
    files: [
      { url: `${rootUrl}favicon.svg`, file: 'favicon.svg', type: 'image/svg+xml' },
      { url: `${rootUrl}${css}`, file: css, type: 'text/css' },
      { url: `${rootUrl}${js}`, file: js, type: 'text/javascript' },
      { url: baseUrl, file: 'index.html', type: 'text/html' },
      { url: `${rootUrl}logo_wla.svg`, file: 'logo_wla.svg', type: 'image/svg+xml' },
      { url: `${rootUrl}${FLAG_FONT_FILE}`, file: FLAG_FONT_FILE, type: 'font/woff2' },
    ],
  };
  await writeFile(
    path.join(OUT_DIR, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  return { js, css };
}

await rm(OUT_DIR, { recursive: true, force: true });
await mkdir(OUT_DIR, { recursive: true });

if (watch) {
  const ctx = await esbuild.context(options);
  const { metafile } = await ctx.rebuild();
  await writeClientFiles(metafile);
  await ctx.watch();
  console.log(`watching src/ — output in ${OUT_DIR}/ (base ${baseUrl})`);
} else {
  const { metafile } = await esbuild.build(options);
  const { js, css } = await writeClientFiles(metafile);
  console.log(
    `built client -> ${OUT_DIR}/ (index.html, ${js}, ${css}, favicon.svg, logo_wla.svg, ${FLAG_FONT_FILE}, manifest.json)`,
  );
}
