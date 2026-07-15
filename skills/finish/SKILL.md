---
name: finish
description: Docs and test follow-up plus a convergent multi-round review loop for the current branch's diff, run entirely via a Dynamic Workflow. Detects doc drift and test gaps, applies fixes, then runs Review -> Verify -> Fix rounds until all-clear, converged, or max-iterations, producing a defect/judgment/spurious-audited report.
disable-model-invocation: true
---

# finish

ブランチの変更差分に対して docs/テストの追随と収束型レビューループを行う。devflow の branch-finisher + review-loop の統合に相当する。

## 1. 前提

- Workflow(Dynamic Workflows)必須。詳細は `${CLAUDE_PLUGIN_ROOT}/references/workflow-core.md` §1
- 封じ込め(不可逆操作を allowlist に入れない)は §5、ワークフロー内対話禁止は §6 を参照
- gh CLI は任意。`spec` 観点(§3)で対象 Issue を解決できた場合の読み取り(`gh issue view`)にのみ使い、PR 操作は行わない。gh が使えない場合は `spec` 観点を skip するだけでよい

## 2. Step 0: プロファイル解決

`${CLAUDE_PLUGIN_ROOT}/references/profile.md` の解決順(引数 → `.forge.json` → 自動検出)に従いプロファイルを確定する。

## 3. Step 1: 前段(リーダー)

1. `${CLAUDE_PLUGIN_ROOT}/scripts/diff-summary.sh [--base]` を実行。`NO_CHANGES` なら終了を報告して停止
2. レビュー観点を選定する。基本観点は `architecture`(correctness を含む)、`tests` の 2 つで固定。残り枠は以下から優先度順に埋める: `spec`(下記の条件で対象 Issue を解決できた場合のみ) → `security`(常時候補) → `checklist`(profile.paths.reviewChecklist が非 null) → `infra`(差分に iac/cloud 関連ファイルを含む) → 言語パック観点(knowledge packs)。上限は depth 依存(quick 2 / standard 4 / thorough 6、`${CLAUDE_PLUGIN_ROOT}/references/workflow-core.md` §4)。profile.review.dimensions が明示配列なら自動選定より優先する

   `spec` 観点の条件: ブランチ名とコミットメッセージ(`git log <base>..HEAD --oneline`)から Issue 参照(`#N` 等)を解決できた場合のみ採用する。採用時は `gh issue view <N>` で本文・受け入れ条件を取得し、roleHint に「Issue の受け入れ条件と diff の突合 — 未達の要件、Issue が求めていないスコープ外の変更、実装済みに見えて挙動が要件と食い違うもの」として Issue 内容ごと注入する。解決できない(参照なし・gh 不可)場合は観点に入れず、その旨を最終報告に含める。この観点は「頼まれたものを作ったか」を見る軸であり、コード品質を見る他観点とは独立に評価する
3. 各観点は `{ key, agentType, roleHint }` で選定する。key → agentType の対応(ポジションロールは立場を代表し、裁定は行わない):

   | key | agentType |
   |---|---|
   | architecture | forge:architecture |
   | security | forge:security |
   | tests | forge:tests |
   | ui | forge:ui |
   | infra | forge:infra |
   | reuse | forge:reuse |
   | spec / checklist / 言語パック観点 | forge:analyst |

   `roleHint` には観点固有の着眼点(reviewChecklist の要約、knowledge packs の追加観点など)を入れる
4. 実行され得る検証コマンド(profile.commands の typecheck/lint/test/build 等)をユーザーに事前提示する。allowlist 外だと実行時に許可プロンプトが出るため

## 4. Step 2: ワークフロー

冒頭で `${CLAUDE_PLUGIN_ROOT}/references/knowledge-packs.md` の手順に従い、有効パックから知識ソースブロックを合成し、Groundwork/Review/Fix 各エージェントのプロンプトに埋め込む。

### フェーズ表

| フェーズ | 役割 | agentType | TIER |
|---|---|---|---|
| Context | 差分構造化、変更ファイル→docs/テスト対応マップ | forge:analyst | scan |
| Groundwork (survey) | docs 乖離検出 / テストギャップ検出(parallel 2) | forge:analyst | judge |
| Groundwork (fix) | 上記修正を適用し検証コマンドを通す | forge:builder | build |
| Review | 観点ごとの所見収集(parallel) | dim.agentType(観点別のポジションロール) | judge |
| Verify | 全指摘をバッチ判定(defect/judgment/spurious) | forge:analyst | judge |
| Fix | defect を severity 順に修正 | forge:builder | build |
| Report | contracts.md §4 準拠のレポート生成 | forge:analyst | scan |

Review → Verify → Fix は Exit 条件が成立するまで反復する(最大反復は depth 依存: quick 2 / standard 3 / thorough 5)。Context / Groundwork(survey)/ Verify / Report は立場を持たない中立役として `forge:analyst` に固定する。特に Verify は指摘の裁定者であり、立場を持たないことが機能要件(ポジショントークの判定を歪めないため)。

### スキーマ

**GAPS**(Groundwork の docs 乖離・テストギャップ用):

```json
{
  "gaps": [
    {
      "kind": "docs-drift | test-gap",
      "file": "対象ファイル(ドキュメントまたはテスト)",
      "relatedFile": "対応するコード側ファイル",
      "description": "何が乖離/不足しているか",
      "evidence": "根拠となるコード/文書断片",
      "suggestion": "修正の方向性"
    }
  ]
}
```

**FINDINGS** / **VERDICTS**: `${CLAUDE_PLUGIN_ROOT}/references/contracts.md` §2, §3 をそのまま使う。

### JS スケルトン

```js
export const meta = {
  name: 'finish',
  description: 'Docs/test follow-up + convergent review loop',
  phases: [
    { title: 'Context' },
    { title: 'Groundwork' },
    { title: 'Review' },
    { title: 'Verify' },
    { title: 'Fix' },
    { title: 'Report' },
  ],
}

const TIER = {
  scan:  { model: 'sonnet', effort: 'low' },
  judge: {},
  build: {},
}

const DEPTH_TABLE = {
  quick:    { dimensions: 2, maxIter: 2 },
  standard: { dimensions: 4, maxIter: 3 },
  thorough: { dimensions: 6, maxIter: 5 },
}
const depth = DEPTH_TABLE[args.depth ?? 'standard']

const normalize = s => (s || '').replace(/\s+/g, ' ').trim()
const key = f => `${f.file}|${f.category}|${normalize(f.evidence || f.symbol)}`
const sameKeySet = (a, b) =>
  a.length === b.length && new Set(a.map(key)).size === new Set([...a, ...b].map(key)).size
const bySeverityDesc = (a, b) =>
  ['critical', 'high', 'medium', 'low'].indexOf(a.severity) -
  ['critical', 'high', 'medium', 'low'].indexOf(b.severity)

// --- Context ---
phase('Context')
const context = await agent(CONTEXT_PROMPT(args.diffSummary), {
  ...TIER.scan,
  agentType: 'forge:analyst',
  schema: CONTEXT_SCHEMA,
  label: 'context',
})

// --- Groundwork ---
phase('Groundwork')
const [docsGaps, testGaps] = await parallel([
  () => agent(DOCS_GAPS_PROMPT(context, args.knowledgeBlocks), {
    ...TIER.judge, agentType: 'forge:analyst', schema: GAPS_SCHEMA, label: 'docs-gaps',
  }),
  () => agent(TEST_GAPS_PROMPT(context, args.knowledgeBlocks), {
    ...TIER.judge, agentType: 'forge:analyst', schema: GAPS_SCHEMA, label: 'test-gaps',
  }),
])
// barrier: parallel の戻り値を両方受け取ってから builder を起動する(label で survey/fix を区別)
const groundworkFix = await agent(
  GROUNDWORK_FIX_PROMPT([...(docsGaps?.gaps ?? []), ...(testGaps?.gaps ?? [])], args.commands),
  { ...TIER.build, agentType: 'forge:builder', schema: FIX_RESULT_SCHEMA, label: 'groundwork-fix' },
)

// --- Review -> Verify -> Fix ループ ---
const history = []      // 各反復の findings(Review プロンプトへ渡す)
const spuriousLog = []  // spurious 監査リスト(レポート必須)
let prevDefects = null
let iter = 0
let exitReason = null
let lastDefects = []

while (true) {
  iter += 1
  phase('Review')
  const externalNotes = args.externalReviewerNotes ?? [] // §external reviewers 参照
  const reviewResults = await parallel(
    // args.dimensions の要素は { key, agentType, roleHint }(§3 の対応表で決定済み)
    args.dimensions.slice(0, depth.dimensions).map(dim => () => agent(
      REVIEW_PROMPT(dim, context, history, externalNotes, args.knowledgeBlocks),
      { ...TIER.judge, agentType: dim.agentType, schema: FINDINGS_SCHEMA, label: `review-${dim.key}-${iter}` },
    ))
  )
  const findings = reviewResults.filter(Boolean).flatMap(r => r.findings)

  phase('Verify')
  let verdicts = []
  if (findings.length > 0) {
    const v = await agent(
      VERIFY_PROMPT(findings),
      { ...TIER.judge, agentType: 'forge:analyst', schema: VERDICTS_SCHEMA, label: `verify-${iter}` },
    )
    verdicts = v?.verdicts ?? []
  }

  const defects = []
  for (const v of verdicts) {
    const f = { ...findings[v.index], kind: v.kind }
    if (v.kind === 'spurious') {
      spuriousLog.push({ file: f.file, claim: f.claim, reason: v.reason })
    } else if (v.kind === 'defect') {
      defects.push(f)
    }
  }
  history.push({ iter, findings })
  lastDefects = defects

  if (defects.length === 0) { exitReason = 'all-clear'; break }
  if (prevDefects && sameKeySet(defects, prevDefects)) { exitReason = 'converged'; break }
  if (iter >= depth.maxIter) { exitReason = 'max-iterations'; break }
  prevDefects = defects

  phase('Fix')
  const sorted = [...defects].sort(bySeverityDesc)
  await agent(
    FIX_PROMPT(sorted, args.commands),
    { ...TIER.build, agentType: 'forge:builder', schema: FIX_RESULT_SCHEMA, label: `fix-${iter}` },
  )
}

// --- Report ---
phase('Report')
const report = await agent(
  REPORT_PROMPT({ exitReason, iter, lastDefects, history, spuriousLog, groundworkFix }),
  { ...TIER.scan, agentType: 'forge:analyst', schema: REPORT_SCHEMA, label: 'report' },
)
```

Exit 判定は上記のとおり JS の分岐(`defects.length === 0` / `sameKeySet` / `iter >= depth.maxIter`)で構造的に行い、プロンプトへの依頼では済ませない。`key` / `sameKeySet` は `${CLAUDE_PLUGIN_ROOT}/references/workflow-core.md` §7 の定義そのまま。

### external reviewers(任意機能)

thorough かつ `profile.review.externalReviewers`(例: codex / gemini CLI)が定義されている場合、各反復の Review フェーズと並行して、リーダー側(ワークフロー外)で該当 CLI を同期実行し、得られた所見を `externalReviewerNotes` として次の Review 入力に混ぜる。CLI が存在しない・失敗する場合はスキップし、Review はワークフロー内の観点のみで継続する。

## 5. Step 3: 後段(リーダー)

1. レポートを `.forge/reports/finish-<timestamp>.md` に書き出す(contracts.md §4 の構造)。書き出し失敗はパイプラインを止めず、チャットで要約を補う
2. 修正済み defect / deferred(見送り理由付き) / judgment 所見 / spurious 監査リスト(0 件でも明記) / exit 理由を要約報告する
3. Groundwork で適用した docs/テスト修正も併せて報告する

## 6. 制約

- commit / push はユーザーが明示的に指示した場合のみリーダーが実行する。ワークフロー内では一切行わない
- `forge:builder` は git 状態変更操作を行わない(agents/builder.md)。iac の apply/destroy・破壊的マイグレーションは常に封じ込め対象で、Fix の対象にしない
- severity は Fix の順序付けにのみ使う。Exit 判定には defect/judgment の別のみを用いる
