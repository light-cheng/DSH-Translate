# Changelog

## 0.1.5 — 2026-11-22

- Enforce the local-only privacy invariant (`lib/model.js`, `lib/routes.js`): selecting
  `engine: 'local'` without a configured `localModel` now refuses with `NO_MODEL` instead of
  falling back to the cloud route; `engine: 'auto'` uses its own local abort timer so a local
  timeout cleanly falls back to cloud without pre-aborting the fallback call, and fallback results
  no longer poison the local cache key.
- Fix client memo & retry behaviour (`client.js`, `lib/routes.js`): `memo` keys now include the
  active route signature (`engine`, model, `targetLanguage`) and selection context; Retry passes
  `force: true` to bypass both client `memo` and Host cache; incomplete (`partial`) selections are
  not memoized; clearing cache or switching routes invalidates client `memo`; closing a card or
  HTTP connection aborts in-flight model calls.
- Fix `WordCard` missing `meaning` rendering (`client.js`), add `AbortController` cleanup, and
  display the active local/auto model in Settings.
- Fix `POST /settings` partial updates wiping custom `model` (`lib/routes.js`), validate
  `localBaseUrl` (`BAD_URL`), propagate `cache.setLimit()` eviction, and make `safeMessage()`
  redact `Bearer` tokens and `key=secret` pairs.
- Fix cut-off JSON protection on `/explain` and `/toenglish`, balanced JSON extraction around prose
  braces (`lib/parse.js`), 2-letter selection translation (`needsTranslation`), and `'s` possessive
  dictionary lookup (`lib/dictionary.js`).
- Fix `playSpeech`/`stopSpeech` watchdog timer/callback leaks so rapid clicks never let an earlier
  word interrupt the current pronunciation (`client.js`).
- Fix `JsonStore` and `TranslationCache` concurrent write races (`writeQueue`, unique temp paths,
  `.tmp` cleanup, best-effort `chmod`), serialized `/vocab` mutations, and debounced cache writes.
- Fix composer `extractDraftText` false positives on empty strings, guard `DraftToEnglishButton`
  against overwriting modified drafts, mount `<style>` once into `document.head`, keep the manual
  selection pill anchored on scroll, gate right-click menu to clicks on the selection, add a
  two-click confirmation on Clear vocabulary, remove dead `POST /diag` and unused locale/CSS/config
  entries, and fix Cordis service/route disposal (`index.js`, `lib/routes.js`).
- Expand test coverage across `lib/store.js`, `lib/cache.js`, `lib/routes.js`, `lib/model.js`,
  `lib/parse.js`, `lib/dictionary.js`, `index.js`, and live `client.js` component flows.

## 0.1.4 — 2026-11-20

- Fix a click dead zone in the center of the selection translation card's close (`×`) button on
  DSH Desktop (#3). Floating surfaces rendered inside `shell.overlay` (`#root`) did not declare
  `-webkit-app-region: no-drag` and `placeCard` clamped to `top: 12px`, so flipping a card above
  a mid-screen selection pushed `.dsh-tr-close` (`y = 25–45 px`) straight into the 40 px Windows
  caption drag strip (`-webkit-app-region: drag`) and macOS top chrome — swallowing pointer
  events at the center of `×` while leaving only its bottom edge clickable. Floating surfaces
  (`.dsh-tr-float`, `.dsh-tr-pill`, `.dsh-tr-menu`, `.dsh-tr-close`) now opt out of window drag,
  overlay placement stays below the desktop titlebar clearance (`--dsh-windows-titlebar-height` /
  `--dsh-frame-top-clearance`), `.dsh-tr-float-head` no longer shrinks when scrolling, and
  `.dsh-tr-close` is a fixed 24×24 centered hit target with an `aria-label`. Pinned by
  `test/overlay-close.test.mjs`.

## 0.1.3 — 2026-11-10

- Fix the settings page crushing a long row label into one character per line in a narrow
  settings pane. A row was a non-wrapping flex line and its label column started from a zero
  flex basis, so the model-route hint (`留空则跟随 DSH 当前默认模型；…`) next to the
  `provider`/`model` inputs and their two buttons collapsed to a vertical text column. Rows now
  wrap and the label column keeps a real basis, so the control group drops to its own line
  instead. Pinned by `test/settings-layout.test.mjs`.

## 0.1.2 — 2026-11-10

- Fix Web boot failing after install. `client.js` registered its factory under the short plugin id
  (`dsh-translate`) instead of the package name (`@lightcheng/dsh-translate`). DSH keys one
  client-module row per package name, so the row loaded a second time and Web boot aborted with
  `client-modules: duplicate factory registration` and `web boot: 1 entry did not activate`.
  The registration id now equals `package.json` `name`, pinned by `test/client.test.mjs`.

## 0.1.1 — 2026-11-10

First public release.

- English learning for DeepSeek Harness: part-by-part translation of reasoning blocks with
  `x/y` progress, stop and resume; instant selection translation with a context note and
  key-vocabulary chips; right-click actions; Chinese-to-English composer rewrite with undo.
- Bundled offline English–Chinese dictionary (58,468 entries, 32,888 inflected-form lookups)
  that answers before the model does, plus US/UK IPA and pronunciation with a three-step
  fallback (Youdao audio → `speechSynthesis` → the IPA alone).
- Vocabulary notebook in the settings page: search, time filter, sort, in-place word cards,
  delete, copy and clear.
- Model route choice: Harness cloud model, local Ollama, or local-first with cloud fallback;
  translation cache and notebook live in the DSH profile under `dsh-translate/`.
- Chinese and English UI, following the Harness language setting.
- Runs on Windows, macOS and Linux with no native dependencies or shell calls; the desktop app
  supplies the Node.js runtime.
- Licensing: plugin code MIT; bundled dictionary data GPL-3.0-only because the British IPA
  data derives from ipacards (GPL-3.0). See `THIRD-PARTY-NOTICES.md`.
