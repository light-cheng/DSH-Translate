# data/ — 内置英汉词典

`dictionary.json.gz` 是本插件自带的离线英汉词典，由 `scripts/build-dictionary.mjs`
从下列开源数据集裁剪生成，随插件一起分发，运行时无需联网下载。

> **许可**：插件代码是 MIT；这个数据文件因为含英式音标，整体按 **GPL-3.0-only**
> 分发。归属、修改说明和「对应源代码」见仓库根目录的
> [THIRD-PARTY-NOTICES.md](../THIRD-PARTY-NOTICES.md)。

| 文件 | 内容 |
| --- | --- |
| `dictionary.json.gz` | gzip 后的 JSON，约 1.9 MB，58,468 个词条 + 32,888 条屈折形式反查 |
| `dictionary.meta.json` | 词条/形式/IPA 覆盖数、许可与生成日期，便于核对 |

## 数据来源

- [ECDICT](https://github.com/skywind3000/ECDICT)，MIT License，Copyright (c) 2025
  Linwei —— 中文释义、考试/Collins/Oxford 标签、BNC/COCA 词频与 `exchange` 屈折形式表。
  ECDICT 自带的 `phonetic` 列是 ASCII 近似记音（如 `'æpl`），不作为音标展示。
- [ipa-dict](https://github.com/open-dict-data/ipa-dict) 的 `en_US`，MIT License，
  Copyright (c) 2016 dohliam —— 美式 IPA。该数据又派生自
  [cmudict-ipa](https://github.com/lingz/cmudict-ipa)（MIT，Copyright (c) 2016
  Lingliang Zhang），重音标记来自 [syllabify](https://github.com/kylebgorman/syllabify)。
- [ipa-dict](https://github.com/open-dict-data/ipa-dict) 的 `en_UK`，**GPL-3.0** ——
  英式 IPA。ipa-dict 的 Credits 写明它派生自
  [ipacards](https://github.com/leoboiko/ipacards)（GPL 3.0）。本插件把原始数据里写在
  元音核之前的重音标记移到合法的音节起始处（如 `/stˈeɪt/` → `/ˈsteɪt/`），并丢弃不可靠的
  次重音标记；这两处修改都在 `scripts/build-dictionary.mjs` 里实现并注释。
  **正是这份 GPL-3.0 数据让整个 `dictionary.json.gz` 必须按 GPL-3.0-only 分发。**

## 词条挑选

- 全部带 ECDICT 考试标签（zk/gk/cet4/cet6/ky/toefl/ielts/gre）的词约 1.5 万；
- Collins 星级或 Oxford 标记的常用词；
- 按 BNC/COCA 词频取前 6 万词（只收有真实词频的名次，避免缩写词占满预算）；
- 不规则屈折形式（`was`、`were`、`is`、`been`、`gotten`……）即使没有词频也单独收进来；
- 仅保留 `[a-z][a-z'’.-]*`、有中文释义、长度 ≤ 39 的词形；带点缩写（`e.g.`、`a.m.`）
  不可被单词查询命中，直接排除。

## 格式

```json
{
  "v": 1,
  "built": "2026-11-10",
  "sources": [
    { "name": "ECDICT", "license": "MIT", "url": "…", "copyright": "Copyright (c) 2025 Linwei" },
    { "name": "ipa-dict", "license": "MIT", "url": "…", "copyright": "Copyright (c) 2016 dohliam",
      "note": "en_US only; derived from cmudict-ipa (MIT, Copyright (c) 2016 Lingliang Zhang)" },
    { "name": "ipa-dict (en_UK)", "license": "GPL-3.0-only", "url": "…",
      "copyright": "ipacards by leoboiko, GPL-3.0", "note": "British IPA; this source is why the payload is GPL-3.0-only" }
  ],
  "words": [["state", "/ˈsteɪt/", "/ˈsteɪt/", "n. 州, 状态…\na. 国家的…"]],
  "forms": { "ran": "run", "went": "go", "invoked": "invoke" }
}
```

- `words[i] = [word, ipaUs, ipaUk, translation]`：全部小写、按词典序；
  `translation` 用 `\n` 分隔多行中文释义，可能带 `[计]` 等专业域前缀。
- `forms`：屈折形式 → 原形，只收「本身不是词条」的形式（如 `children`、
  `running` 本身就是词条，直接精确命中）；Host 侧另有保守的词形还原规则兜底。
- `dictionary.meta.json`：`{ v, built, license, words, forms, ipa, ipaUk, bytes }`，
  其中 `license` 是**数据文件**的许可（`GPL-3.0-only`），不是插件代码的许可。

## 重新生成

```sh
npm run build:dict                 # 默认 6 万词预算
node scripts/build-dictionary.mjs --entries 80000
```

脚本会把 66 MB 的 `ecdict.csv` 与两份 ipa-dict 文本缓存在 `tmp/`（不入包），
再写出本目录的两个文件。若网络不可用，可先手动把文件放到 `tmp/` 对应位置。
`scripts/` 同时包含在 npm 包里，因此拿到包就能重建数据——这也是 GPL-3.0 要求的
「对应源代码」的一部分。

## 许可

- **插件代码**：MIT，见仓库根目录的 [`LICENSE`](../LICENSE)。
- **本目录的数据文件**：`GPL-3.0-only`，全文见
  [`LICENSES/GPL-3.0.txt`](../LICENSES/GPL-3.0.txt)。数据是从 ECDICT（MIT）、
  ipa-dict en_US（MIT）、ipa-dict en_UK（GPL-3.0，源自 ipacards）生成的衍生作品；
  MIT 部分与 GPL 部分兼容，合并后的整体必须按 GPL 分发。逐项归属与修改说明见
  [THIRD-PARTY-NOTICES.md](../THIRD-PARTY-NOTICES.md)。
- 再分发本插件时，`data/` 需要保留 GPL 文本与声明；插件代码仍可按 MIT 使用。
