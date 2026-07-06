---
name: work
description: Implements a GitHub Issue, or a free-text task description without an issue, through zone-based design, parallel implementation, and a seam/integration check. Also detects in-progress work against a base branch and continues it. Invoke as `/forge:work #<issue番号>` or `/forge:work "<作業内容>"`. `[--depth quick|standard|thorough]`.
disable-model-invocation: true
---

# work

Issue を実装する、または Issue を伴わない自由文の作業内容を実装する。設計 → 並列実装 → 縫合チェック。コードは書くが commit / push はしない。

## 1. 前提

- Workflow(Dynamic Workflows)必須。`${CLAUDE_PLUGIN_ROOT}/references/workflow-core.md` §1 に従い、Workflow ツールが使えない場合はここで停止しユーザーに案内する
- `gh` CLI 必須(Issue モードの `gh issue view` で使用)
- `scripts/diff-summary.sh` 必須(Step 1 の引き継ぎモード判定で使用)
- 封じ込め(`workflow-core.md` §5)・ワークフロー内対話禁止(`workflow-core.md` §6)に従う

## 2. Step 0: プロファイル解決

`${CLAUDE_PLUGIN_ROOT}/references/profile.md` の解決順(引数 → `.forge.json` → 自動検出)に従い、プロファイルを確定する。`commands`(typecheck/lint/test/build)は Build/Check フェーズの検証コマンドとして使う。

## 3. Step 1: 前段(リーダー)

引数が `#N` または Issue URL のときは**Issue モード**、Issue 番号を伴わない自由文は**自由文モード**とする。

1. Issue モード: `gh issue view` で対象 Issue を取得する。実装計画の記載が薄い場合はその旨をユーザーに伝え、`/forge:plan` の実行を提案するか Step 2 の Design フェーズで補うかを確認する
   自由文モード: 与えられた説明文をそのまま作業内容として扱う(`issue = { number: null, body: <説明文> }`)。この時点では追跡用 Issue を作成しない
2. Issue 本文(または説明文)から `taskType`(`feature | fix | refactor | infra`)を推定する。判定できなければユーザーに確認する。fix の場合、Design フェーズで再現テスト先行が必須になることを踏まえておく
3. `scripts/diff-summary.sh` を base と比較実行する。差分が既に存在すれば**引き継ぎモード**に切り替える(空ならこの Step は素通りし新規実装として進める)
4. 曖昧点を `AskUserQuestion` で解消する(ワークフロー起動前のここでのみ使用可)
5. 着手内容を 1 段落でユーザーに確認する。実装はコードを書く実判断点であるため、**この確認ゲートは省略しない**(`docs/design.md` の work 仕様を参照)
6. depth に応じて zone 並列上限を決める(`workflow-core.md` §4 のピーク並列数。quick は常に 1 zone)。Design フェーズで批評を挟むか(standard 以上かつ Context の zone 数が 2 以上)もここで判定条件を用意する

## 4. Step 2: ワークフロー

Step 2 冒頭でリーダーは `${CLAUDE_PLUGIN_ROOT}/references/knowledge-packs.md` の手順に従い、プロファイルから有効な knowledge pack を決定し、フェーズ(Context / Design / Build / Check)ごとに「知識ソース」ブロックを組み立てて各エージェントのプロンプトに埋め込む。

### フェーズ表

| フェーズ | 担当 agentType | TIER | 役割 |
|---|---|---|---|
| Context | `forge:analyst` | scan | 規約・関連実装の把握、非重複 zone 分割案の作成。引き継ぎモードでは差分の理解と Issue 要件とのギャップ分析(`gapAnalysis`)も行う |
| Design | `forge:analyst` | judge | zone ごとの実装仕様と criticalDecisions の策定。standard 以上かつ zone 数 2 以上のとき、`forge:analyst` による設計批評を 1 回追加し、blocking 時のみ改訂。fix タスクでは「先に失敗する再現テストを書き、修正後に green を確認する」を testPlan に必須で含める。引き継ぎモードでは `gapAnalysis.remaining` のみを対象に計画する |
| Build | `forge:builder`(zone ごとに parallel) | build | 担当 zone 内での実装適用と検証コマンド実行 |
| Check | `forge:analyst` | judge | zone 縫合部の整合レビューと全体検証コマンド結果の確認 |

### スキーマ

CTX(Context の出力):

```json
{
  "conventions": ["把握した規約・命名・レイヤー構成などの要点"],
  "relatedImplementations": [
    { "path": "リポジトリ相対パス", "role": "この実装が関係する理由" }
  ],
  "zones": [
    { "name": "zone識別名", "files": ["担当ファイル/ディレクトリ"], "summary": "このzoneが実装する内容の要約" }
  ],
  "gapAnalysis": {
    "done": ["Issue要件のうち既に完了している項目(新規モードでは空配列)"],
    "remaining": ["未着手・残作業(新規モードでは空配列)"],
    "concerns": ["整合性・後方互換等の懸念(新規モードでは空配列)"]
  }
}
```

`gapAnalysis` は引き継ぎモードのみ実質を埋める。新規モードでは全フィールドを空配列で返す(フィールド自体は必須)。

DESIGN(Design/改訂後 Design の出力):

```json
{
  "zoneSpecs": [
    {
      "zone": "Context で定義した zone 名",
      "spec": "実装仕様(変更内容・インターフェース・データフロー)",
      "filesToChange": ["リポジトリ相対パス"],
      "testPlan": "追加/更新するテストの方針"
    }
  ],
  "criticalDecisions": "contracts.md §1 の4キー必須(backwardCompatibility / securityTradeoff / irreversibleAction / dataModelChange)。backwardCompatibility と dataModelChange は特に丁寧に埋める"
}
```

設計批評(条件付き実施)は plan の CRITIQUE スキーマと同形(`blocking[]` / `suggestions[]`)を使う。

BUILD(Build の出力。zone ごとに 1 件):

```json
{
  "zone": "担当zone名",
  "status": "done | partial | failed",
  "changedFiles": ["リポジトリ相対パス"],
  "checks": {
    "typecheck": "pass | fail | skipped | not_configured",
    "lint": "pass | fail | skipped | not_configured",
    "test": "pass | fail | skipped | not_configured"
  },
  "concerns": ["スコープ外で気づいた懸念・保留事項"]
}
```

CHECK(Check の出力):

```json
{
  "seams": [
    { "description": "zone間の縫合箇所の説明", "files": ["リポジトリ相対パス"], "status": "ok | issue", "detail": "issue時の詳細(okなら空文字)" }
  ],
  "failures": [
    { "command": "実行した検証コマンド", "output": "失敗内容の要約" }
  ],
  "verdict": "pass | pass_with_concerns | fail"
}
```

### JS スケルトン

```js
const TIER = {
  scan:  { model: 'sonnet', effort: 'low' },
  judge: {},
  build: {},
}

export const meta = {
  name: 'forge-work',
  description: 'Issue実装: 設計 → 並列実装 → 縫合チェック',
  phases: [{ title: 'Context' }, { title: 'Design' }, { title: 'Build' }, { title: 'Check' }],
}

// スキーマは前掲「スキーマ」節の JSON 形をリーダーが実行時に JSON Schema として展開する
const CTX_SCHEMA = { /* §スキーマ の CTX */ }
const DESIGN_SCHEMA = { /* §スキーマ の DESIGN */ }
const CRITIQUE_SCHEMA = { /* plan の CRITIQUE と同形 */ }
const BUILD_SCHEMA = { /* §スキーマ の BUILD */ }
const CHECK_SCHEMA = { /* §スキーマ の CHECK */ }

const {
  mode,             // 'new' | 'handoff'(引き継ぎモード)
  taskType,         // feature | fix | refactor | infra
  issue,            // { number, body }(自由文モードは number: null)。Step1で確定
  diffSummary,      // 引き継ぎモード: diff-summary.sh の出力。新規モードは null
  knowledgeBlocks,  // { context, design, build, check } 知識ソースブロック
  maxZones,         // depth依存の並列上限。quickは1固定
  commands,         // profile.commands(typecheck/lint/test/build)
  designCritique,   // boolean: standard以上 かつ Context の zone 数が2以上
} = args

phase('Context')
const ctx = await agent(
  `Issue:\n${issue.body}\n${mode === 'handoff' ? `既存差分:\n${diffSummary}\n差分の理解とIssue要件とのギャップ分析(gapAnalysis)を行え。\n` : ''}知識ソース:\n${knowledgeBlocks.context}\n最大zone数: ${maxZones}\nCTX スキーマで返せ。zoneはfilesが重複しないよう分割せよ。`,
  { schema: CTX_SCHEMA, agentType: 'forge:analyst', ...TIER.scan, label: 'context', phase: 'Context' }
)

phase('Design')
let design = await agent(
  `Issue:\n${issue.body}\nzones:\n${JSON.stringify(ctx.zones)}\n${mode === 'handoff' ? `残作業のみ計画せよ(gapAnalysis.remaining): ${JSON.stringify(ctx.gapAnalysis.remaining)}\n` : ''}${taskType === 'fix' ? '先に失敗する再現テストを書き、修正後にgreenを確認することをtestPlanに必須で含めよ。\n' : ''}知識ソース:\n${knowledgeBlocks.design}\nDESIGN スキーマで返せ。`,
  { schema: DESIGN_SCHEMA, agentType: 'forge:analyst', ...TIER.judge, label: 'design', phase: 'Design' }
)

if (designCritique) {
  const critique = await agent(
    `以下の実装設計を反駁せよ:\n${JSON.stringify(design)}\nCRITIQUE スキーマ(plan と同形)で返せ。`,
    { schema: CRITIQUE_SCHEMA, agentType: 'forge:analyst', ...TIER.judge, label: 'design-critique', phase: 'Design' }
  )
  if (critique.blocking.length > 0) {
    design = await agent(
      `以下の設計を blocking 指摘に基づき1回だけ改訂せよ:\n設計: ${JSON.stringify(design)}\n指摘: ${JSON.stringify(critique.blocking)}\nDESIGN スキーマで返せ。`,
      { schema: DESIGN_SCHEMA, agentType: 'forge:analyst', ...TIER.judge, label: 'design-revise', phase: 'Design' }
    )
  }
}

phase('Build')
const buildsRaw = await parallel(
  design.zoneSpecs.map(z => () => agent(
    `担当zone: ${z.zone}\n仕様: ${z.spec}\n変更対象: ${JSON.stringify(z.filesToChange)}\nテスト方針: ${z.testPlan}\n検証コマンド: ${JSON.stringify(commands)}\n知識ソース:\n${knowledgeBlocks.build}\nBUILD スキーマで返せ。担当zone外は変更しない。`,
    { schema: BUILD_SCHEMA, agentType: 'forge:builder', ...TIER.build, label: `build:${z.zone}`, phase: 'Build' }
  ))
)
const builds = buildsRaw.filter(Boolean) // skip/死亡時の null を除外

phase('Check')
const check = await agent(
  `zoneごとの変更結果:\n${JSON.stringify(builds)}\n検証コマンド: ${JSON.stringify(commands)}\n知識ソース:\n${knowledgeBlocks.check}\nCHECK スキーマで返せ。zone間の縫合部の整合と全体検証結果を確認せよ。`,
  { schema: CHECK_SCHEMA, agentType: 'forge:analyst', ...TIER.judge, label: 'check', phase: 'Check' }
)

return { ctx, design, builds, check }
```

## 5. Step 3: 後段(リーダー)

1. `builds` の `changedFiles` / `checks` を集約した変更サマリを提示する
2. `check.verdict` と `check.seams` の issue、`check.failures` を報告する
3. 全 `concerns`(Build)と blocking 未解消のまま残った設計批評があればあわせて報告する
4. 自由文モード(`issue.number` が `null`)の場合、完了報告に「追跡性のため事後 Issue 化」の提案を添える。作成する場合はユーザー確認後に `gh issue create` で行う(このスキルでは自動作成しない)
5. `.forge/reports/work-<timestamp>.md` にレポートを書き出す(`${CLAUDE_PLUGIN_ROOT}/references/contracts.md` §4 の構造に準拠。defect 相当は `check.failures`、judgment 相当は `concerns` に読み替える)
6. commit / push は行わない

## 6. 制約

- commit / push はこのスキルの範囲外。ユーザーが明示的に別途指示した場合のみリーダーが実行する
- 自由文モードの事後 Issue 作成(`gh issue create`)はユーザー確認後にのみ実行する
- ワークフロー内で `AskUserQuestion` は使用しない。実行中に発覚した曖昧さは `concerns` / `criticalDecisions` として報告する
- Build フェーズの `forge:builder` はスコープ外のファイルを変更しない(`agents/builder.md` 原則 1)
