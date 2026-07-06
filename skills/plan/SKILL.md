---
name: plan
description: Designs a new GitHub Issue, or revises an existing one, for a feature/fix/refactor/infra request through multi-perspective investigation, integrated drafting, and critique. Invoke as `/forge:plan <要求文>` for a new issue, or `/forge:plan #<N>`(Issue URL可)for revision. `[--depth quick|standard|thorough]`.
disable-model-invocation: true
---

# plan

要求文から GitHub Issue を設計する、または既存 Issue を改訂する。多観点調査 → 統合ドラフト → 批評 → `gh issue create` / `gh issue edit`。

## 1. 前提

- Workflow(Dynamic Workflows)必須。`${CLAUDE_PLUGIN_ROOT}/references/workflow-core.md` §1 に従い、Workflow ツールが使えない場合はここで停止しユーザーに案内する
- `gh` CLI 必須(Step 1 の `gh issue view`、Step 3 の `gh issue create` / `gh issue edit` / コメント投稿で使用)
- 封じ込め(`workflow-core.md` §5)・ワークフロー内対話禁止(`workflow-core.md` §6)に従う

## 2. Step 0: プロファイル解決

`${CLAUDE_PLUGIN_ROOT}/references/profile.md` の解決順(引数 → `.forge.json` → 自動検出)に従い、プロファイルを確定する。自動検出を行った場合はユーザーに通知する。

## 3. Step 1: 前段(リーダー)

引数が `#N` または Issue URL のときは**改訂モード**、それ以外の自由文は**新規モード**とする。

新規モード:

1. 要求文を `feature | fix | refactor | infra` に分類する
2. 対象範囲・受け入れ条件・非機能要件など不足情報を `AskUserQuestion` で解消する(ワークフロー起動前のここでのみ使用可)

改訂モード:

1. `gh issue view <#N> --comments` で本文と議論の現状を取得する
2. 改訂の目的(何をどう直すか)をユーザーに確認する。不足情報は `AskUserQuestion` で解消する

共通(モード確定後):

3. 分類(改訂モードは既存 Issue から読み取る、または上記確認で分類し直す)に応じて下表の観点プリセットを選び、プロファイルの `stack` や要求内容に応じて追加観点を足す。観点数は depth 上限(`workflow-core.md` §4: quick 2 / standard 4 / thorough 6)で切る
4. depth に応じた Critique 巡回数を決める: quick 0 / standard 1 / thorough 2

### 観点プリセット(タスク種別別)

| 分類 | 基本観点 | 追加条件 |
|---|---|---|
| feature | architecture / reuse / tests | stack・要求内容に応じ ui / security / infra |
| fix | architecture(roleHint: 根本原因の特定)/ reuse / tests(roleHint: 再現手順の確立) | 同上 |
| refactor | architecture / reuse / tests | 同上 |
| infra | infra / security / reuse | 同上 |

### 観点 → agentType 対応

観点は `{ key, agentType, roleHint }` で表す。roleHint はプリセットが重点を指定する場合に 1 文で埋め、指定がなければ空文字にする。

| key | agentType |
|---|---|
| architecture | `forge:architecture` |
| security | `forge:security` |
| tests | `forge:tests` |
| ui | `forge:ui` |
| infra | `forge:infra` |
| reuse | `forge:reuse` |
| その他中立観点(checklist 等) | `forge:analyst` |

## 4. Step 2: ワークフロー

Step 2 冒頭でリーダーは `${CLAUDE_PLUGIN_ROOT}/references/knowledge-packs.md` の手順に従い、選定済みプロファイルから有効な knowledge pack を決定し、観点ごとに「知識ソース」ブロックを組み立てる。各ブロックは該当する Survey エージェントのプロンプトに埋め込む(Draft/Critique には調査結果を経由して間接的に反映される)。

### フェーズ表

| フェーズ | 担当 agentType | TIER | 役割 |
|---|---|---|---|
| Survey | 観点ごとの agentType(前掲対応表。観点ごとに parallel) | judge | 立場ごとの一次調査。事実収集と関連ファイル・リスクの洗い出し。改訂モードでは既存 Issue と議論の現状も入力に含める |
| Draft | `forge:analyst`(単体・中立役) | judge | 全 Survey を統合し Issue ドラフト(または改訂案)を生成 |
| Critique | `forge:analyst`(単体・中立役、最大 critiqueRounds 回) | judge | ドラフトを反駁し、blocking があれば改訂を促す |

Survey はコードベースの実質的な調査(何が既存でどうリスクがあるかの評価)を伴う判断系であるため TIER judge とする。TIER scan は Context/Report のような機械的収集・整形専用であり(`workflow-core.md` §3)、Survey はこれに当たらない。Draft/Critique は特定の立場を持たない中立役のため `forge:analyst` に固定する(`workflow-core.md` §3 直後の「ロール配置」節参照)。

### スキーマ

SURVEY(Survey の出力。観点ごとに 1 件):

```json
{
  "perspective": "architecture | reuse | tests | security | ui | infra | その他中立観点のkey",
  "findings": ["所見(1〜2文/件)の配列"],
  "relatedFiles": ["リポジトリ相対パス"],
  "risks": ["想定リスク"],
  "openQuestions": ["未確認事項"]
}
```

DRAFT(Draft/改訂後 Draft の出力。新規・改訂共通スキーマ):

```json
{
  "title": "Issueタイトル(改訂モードでは変更後タイトル。不要なら既存と同じ値)",
  "body": "Issue本文。profile.paths.issueTemplate があればその構造に従い、無ければ Why/What/How + 受け入れ条件の汎用構造。改訂モードは差分ではなく更新後の本文全体",
  "acceptanceCriteria": ["受け入れ条件"],
  "implementationPlan": ["実装ステップの概要(粒度は数行〜十数行)"],
  "criticalDecisions": "contracts.md §1 の 4 キー(backwardCompatibility / securityTradeoff / irreversibleAction / dataModelChange)必須。該当なしでも status: notApplicable + rationale を書く",
  "openQuestions": ["未解決の論点(ユーザーへの確認事項)"]
}
```

CRITIQUE(Critique の出力):

```json
{
  "blocking": [
    { "point": "指摘内容", "reason": "根拠", "suggestedFix": "改善の方向性" }
  ],
  "suggestions": [
    { "point": "改善提案", "rationale": "根拠" }
  ]
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
  name: 'forge-plan',
  description: 'Issue設計: 多観点調査 → 統合ドラフト → 批評',
  phases: [{ title: 'Survey' }, { title: 'Draft' }, { title: 'Critique' }],
}

// スキーマは前掲「スキーマ」節の JSON 形をリーダーが実行時に JSON Schema として展開する
const SURVEY_SCHEMA = { /* §スキーマ の SURVEY */ }
const DRAFT_SCHEMA = { /* §スキーマ の DRAFT */ }
const CRITIQUE_SCHEMA = { /* §スキーマ の CRITIQUE */ }

const {
  mode,              // 'new' | 'revise'
  issueContext,      // 改訂モード: gh issue view --comments の本文+議論。新規モードは null
  requirement,       // 分類・不足情報解消済みの要求文(改訂モードでは改訂目的)
  perspectives,      // Step1 で選定した観点定義 { key, agentType, roleHint } の配列
  knowledgeBlocks,   // { [key]: string } 知識ソースブロック
  issueTemplate,     // profile.paths.issueTemplate の内容。無ければ null
  critiqueRounds,    // quick=0 / standard=1 / thorough=2
} = args

phase('Survey')
const surveysRaw = await parallel(
  perspectives.map(p => () => agent(
    `観点: ${p.key}${p.roleHint ? `(重点: ${p.roleHint})` : ''}\n要求: ${requirement}\n${issueContext ? `既存Issueと議論の現状:\n${issueContext}\n` : ''}知識ソース:\n${knowledgeBlocks[p.key] ?? ''}\nSURVEY スキーマで返せ。`,
    { schema: SURVEY_SCHEMA, agentType: p.agentType, ...TIER.judge, label: `survey:${p.key}`, phase: 'Survey' }
  ))
)
const surveys = surveysRaw.filter(Boolean) // skip/死亡時の null を除外

phase('Draft')
let draft = await agent(
  `モード: ${mode}\n要求: ${requirement}\nSurvey結果:\n${JSON.stringify(surveys)}\nissueTemplate: ${issueTemplate ?? '(なし・汎用構造で可)'}\n${mode === 'revise' ? '改訂案を生成せよ。body は差分ではなく更新後の本文全体とする。\n' : ''}DRAFT スキーマで返せ。`,
  { schema: DRAFT_SCHEMA, agentType: 'forge:analyst', ...TIER.judge, label: 'draft', phase: 'Draft' }
)

phase('Critique')
for (let i = 0; i < critiqueRounds; i++) {
  const critique = await agent(
    `以下のIssueドラフトを反駁せよ:\n${JSON.stringify(draft)}\nCRITIQUE スキーマで返せ。`,
    { schema: CRITIQUE_SCHEMA, agentType: 'forge:analyst', ...TIER.judge, label: `critique:${i}`, phase: 'Critique' }
  )
  if (critique.blocking.length === 0) break
  draft = await agent(
    `以下のドラフトを blocking 指摘に基づき1回だけ改訂せよ:\nドラフト: ${JSON.stringify(draft)}\n指摘: ${JSON.stringify(critique.blocking)}\nDRAFT スキーマで返せ。`,
    { schema: DRAFT_SCHEMA, agentType: 'forge:analyst', ...TIER.judge, label: `revise:${i}`, phase: 'Critique' }
  )
}

return { surveys, draft }
```

## 5. Step 3: 後段(リーダー)

1. `draft.title` / `draft.body` / `draft.acceptanceCriteria` / `draft.implementationPlan` と、`criticalDecisions`(`irreversible` / `costly` の項目を強調)・`openQuestions` をユーザーに提示する
2. 新規モード: ユーザー確認後、`gh issue create` で Issue を作成する。確認前に作成しない
   改訂モード: 「本文を `gh issue edit` で更新する」か「補記コメントを投稿する」かをユーザーに確認してから実行する
3. `.forge/reports/plan-<timestamp>.md` にレポートを書き出す(`${CLAUDE_PLUGIN_ROOT}/references/contracts.md` §4 の構造。plan では「修正済み defect」に相当する項目は無いため、結果サマリ・criticalDecisions・judgment 所見(=suggestions)・spurious 監査(該当なければ「なし」)・実行統計に読み替える)

## 6. 制約

- Issue の作成・更新・コメント投稿(`gh issue create` / `gh issue edit` / コメント)はユーザー確認後にのみ実行する
- ワークフロー内で `AskUserQuestion` は使用しない(`workflow-core.md` §6)。曖昧さは Step 1 で解消するか、`openQuestions` として報告する
- commit / push はこのスキルの範囲外
