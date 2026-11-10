# AGENTS.md

`dsh-translate` is a DeepSeek Harness Web plugin. A Host half (`index.js`, `lib/`) serves one same-origin JSON API; a browser half (`client.js`) renders everything; a ~2 MB English–Chinese dictionary ships with the plugin in `data/`. There is no bundler and no runtime dependency.

## Making a change

1. Read the file you will touch and the test that covers it.
2. Change the smallest surface that keeps both halves in sync.
3. Add or update a test that pins the new behaviour.
4. Run `npm run check` and `npm test`.
5. If user-visible behaviour changed, update `README.md` **and** `README_zh.md` in the same edit.
6. If the dictionary payload or its provenance changed, keep `THIRD-PARTY-NOTICES.md`, `data/README.md` and `test/dictionary-data.test.mjs` in step with it.

Done means: both commands pass, and the new behaviour has a test that failed before the change.

## Commands

| Command | When |
| --- | --- |
| `npm run check` | Always, before claiming anything works. |
| `npm test` | Always; the suite must stay at 100% pass. |
| `npm run build:dict` | Only when the dictionary payload or its filters change. Needs network; caches inputs in `tmp/`. |

Browser-side behaviour has no real DOM in the test environment. `test/client.test.mjs` only asserts module envelope and slot registration; for rendering, timers, audio and dictionary flows write a throwaway harness under `tmp/` (see the gitignored scratch area) instead of watering down the shipped code.

## Map

| Area | Files |
| --- | --- |
| Host entry, settings defaults, dictionary warm-up | `index.js` |
| HTTP API, settings sanitising, dictionary/preload state | `lib/routes.js` |
| Dictionary loading and lookup order | `lib/dictionary.js`, `data/` |
| Model route choice, Ollama client, prompts, parsing, chunk plans | `lib/model.js`, `lib/local.js`, `lib/prompt.js`, `lib/parse.js` |
| Translation cache, JSON stores | `lib/cache.js`, `lib/store.js` |
| Browser half (all UI, locale tables, CSS, audio, dictionary client) | `client.js` |
| Tests | `test/` |

## Invariants

- **Licensing is split on purpose.** Plugin code is MIT (`LICENSE`). The bundled dictionary data is **GPL-3.0-only** (`LICENSES/GPL-3.0.txt`) because the British IPA derives from ipacards (GPL-3.0); `data/README.md`, `THIRD-PARTY-NOTICES.md`, the two READMEs, the settings credit line in `client.js`, the build script's `sources` array and the payload tests all state that split. Never re-label the data as MIT, and keep the attribution and corresponding-source offer intact.
- `client.js` is one prebuilt script loaded through `window.__ModuleLoader__.load`: no JSX, no imports at runtime, four-space indent. Every browser API (`window`, `document`, `Audio`, `speechSynthesis`, `localStorage`) is reached **inside a function** with a `try`/guard, because Node tests load this file. `node --check client.js` must pass.
- **The registration id is the package name, not the plugin id.** DSH's client-module graph keys one row per package name (`@lightcheng/dsh-translate`) and resolves that row only when the bundle calls `__ModuleLoader__.load({ id: <package name> })`. Registering under the short id `dsh-translate` loads the row twice (`client-modules: duplicate factory registration`) and aborts Web boot (`web boot: 1 entry did not activate`). `test/client.test.mjs` pins the registration id to `package.json` `name`; the plugin id stays `dsh-translate` everywhere else (slots, routes, data directory).
- Host modules (`index.js`, `lib/*`) load when DSH starts, and `client.js` is re-read on a page refresh. So after a Host change, **restart DSH** to apply it; after a client change, refresh the page. The Electron-managed desktop profile has no in-place host reload.
- The Host is ESM. Every route is a same-origin JSON endpoint under `/dsh-translate/api`, registered in the routes array with a `node:check`-safe handler; errors use `safeMessage()` and never leak internals. New routes need a fake-`ctx` test in `test/`.
- A new setting needs three edits: a default in `index.js` `DEFAULT_CONFIG`, a sanitiser branch in `lib/routes.js` `sanitizeSettings`, and a control in the client settings page. Existing profiles must keep working: `JsonStore` merges defaults under persisted values.
- `POST /dictionary` returns exactly one entry per requested word, in request order. The client folds curly apostrophes and lower-cases before caching; keep that folding in both halves.
- The dictionary payload is generated, never hand-edited. Change `scripts/build-dictionary.mjs`, rebuild, and keep `test/dictionary-data.test.mjs` green. Two source quirks are already handled there: ECDICT senses arrive with a literal `\n`, and `ipa-dict` en_UK marks stress before the vowel nucleus (moved to the syllable onset at build time).
- `/translate` has two modes: one-shot (selection) and per-part (long reasoning). The `index` / `part` / `next` fields are a Host–client contract; `test/routes.translate.test.mjs` and `test/parse.test.mjs` pin it.
- `zh` and `en` locale tables inside `client.js` must have identical key sets; `locale/*.json` only holds the Plugin Manager title and description.
- Pronunciation must degrade silently: online audio → `speechSynthesis` → the IPA alone. Never surface an audio error, and never leave a playing state stuck.
- `package.json` `files` must keep `data` (payload), `docs` (screenshots), `assets/icon.png` (the plugin icon), `README_zh.md`, the licence files (`LICENSE`, `LICENSES`, `THIRD-PARTY-NOTICES.md`), `scripts` (the dictionary's corresponding source), `screenshots.json` and `CHANGELOG.md`. Check with `npm pack --dry-run`.
- The package name is `@lightcheng/dsh-translate` (the unscoped `dsh-translate` is another author's npm package); the plugin id stays `dsh-translate` so profile overrides and the `dsh-translate/` data directory keep working. `cordis.patch.yml` must resolve that exact name.
- `engines.dsh` must stay a range the plugin actually supports (`>=0.2.1-rc.5 <0.3.0` today); the Plugin Manager refuses to install or update a plugin whose declared range excludes the running DSH.
- `test/locale.test.mjs` enforces the zh/en table parity and the Host/client wire fields; `test/docs.test.mjs` enforces that every relative link and image in the docs resolves. Keep both green instead of re-checking those by hand.
- `README.md` is English and default; `README_zh.md` mirrors it in Chinese. Both show `assets/icon.png` — the single plugin icon, a 512×512 RGBA PNG with transparent rounded corners that `package.json` `icon`, the `./icon` export and the marketplace entry all point at — and the screenshots in `docs/images/`. The screenshots are static PNGs of the real settings component rendered with sample data: keep them free of personal data, and replace them when the settings page changes.
- The plugin must stay **platform-neutral**: Windows, macOS and Linux. No native dependencies, no `child_process`, no shell calls, no absolute Windows paths, no `process.platform` branches — paths go through `node:path`, durable files are written to a temp file and renamed, and `chmod 0o600` is best-effort (a no-op on Windows, real on POSIX). CI runs the suite on ubuntu (Node 22 + 24), macOS (22) and Windows (22); keep that matrix green instead of assuming.
- `tmp/` is gitignored scratch space: downloaded datasets, theme dumps, screenshot candidates, backups. No runtime asset may live there.

## Pitfalls worth remembering

- The dictionary route's `available:false` path must keep the 1:1 entry shape; the client pairs rows by index.
- A lost dictionary file must leave the plugin fully working (no local gloss, settings page says "not installed"), never a 500 or a thrown error.
- Do not reorder the lookup chain: exact → inflected form (`forms`) → conservative morphology.
- Do not hand-edit `data/dictionary.json.gz`; change `scripts/build-dictionary.mjs` and rebuild. The build reads cached inputs from `tmp/`, so it works offline.
- Keep `.gitignore` current: `tmp/`, `node_modules/`, `*.tgz`, `.strata/`, logs and OS noise stay out of the repository. The published package ships `scripts/` and `test/` even though `tmp/` never does.
