# Changelog

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
