---
name: ship
description: Drafts a PR body from the branch diff and issue context (with critique), then optionally runs a review-response loop that analyzes PR comments and proposes fix/discuss/rebut plans. All push and gh operations stay outside the Dynamic Workflow and are executed by the leader only, gated on user confirmation unless --auto is set.
disable-model-invocation: true
---

# ship

PR 作成とレビュー対応ループ。**push と gh 操作はワークフローに入れない**(封じ込め、`${CLAUDE_PLUGIN_ROOT}/references/workflow-core.md` §5)。ワークフローは「PR 本文起草+批評」と「コメント分析+対応方針統合」のみを担当し、実際の `gh pr create` / `gh api` / `git push` はすべてリーダー側(ワークフロー外)でユーザーの確認を経て実行する。

## 1. 前提

- Workflow(Dynamic Workflows)必須。§1
- gh CLI 必須(PR 作成・コメント取得・返信投稿に使用)
- 封じ込め §5、ワークフロー内対話禁止 §6 を参照
- ワークフロー内の `forge:analyst` / `forge:builder` はどちらも push・gh 操作を行わない(agents/*.md)。この禁止はエージェント定義そのものによる構造的なものであり、プロンプト指示に依存しない

## 2. Step 0: プロファイル解決

`${CLAUDE_PLUGIN_ROOT}/references/profile.md` の解決順に従いプロファイルを確定する。

## 3. Step 1: 前段(リーダー)

1. protected branch ガード: 現在のブランチが `profile.git.protectedBranches` に含まれる場合は中止する
2. ブランチ状態を確認し、base(`--base` またはプロファイルの `git.baseBranch`)との関係を把握する
3. 未 push のコミットがあればユーザーに push の可否を確認する(自動では push しない)
4. 引数(PR 番号/URL、または issue 番号)から対象を解決する:
   - issue 番号のみ: Step 2 で新規 PR を作成してから Step 3 へ進む
   - 既存 PR(番号/URL、他人が作成したものでもよい): Step 2 を丸ごとスキップし Step 3 のレビュー対応ループへ直接入る。`gh pr view` で対象 PR のブランチを確認し、現在のワーキングツリーがそのブランチを checkout 済みでなければ、checkout してよいかユーザーに確認してから進める

## 4. Step 2: PR 作成ワークフロー(Draft → Critique)

Step 1 で既存 PR 直入り(R2-5)と判定された場合、このステップは丸ごとスキップして Step 3 へ進む。

冒頭で `${CLAUDE_PLUGIN_ROOT}/references/knowledge-packs.md` の手順で知識ソースブロックを合成し、Draft/Critique のプロンプトに埋め込む。

### フェーズ表

| フェーズ | 役割 | agentType | TIER |
|---|---|---|---|
| Draft | diff + issue + prTemplate から PR 本文起草 | forge:analyst | judge |
| Critique | 起草内容を批評(quick は省略) | forge:analyst | judge |
| Revise | blocking があれば 1 回改訂 | forge:analyst | judge |

### スキーマ

```json
{
  "title": "PR タイトル",
  "body": "PR 本文(prTemplate があればその構造に従う)",
  "openQuestions": ["起草時に判断保留した点"]
}
```

Critique は `CRITIQUE スキーマ: blocking[] / suggestions[]`(plan と同形)を返す。

### JS スケルトン

```js
export const meta = {
  name: 'ship-pr-draft',
  description: 'Draft PR body from diff/issue/template, then critique it',
  phases: [{ title: 'Draft' }, { title: 'Critique' }, { title: 'Revise' }],
}

const TIER = {
  scan:  { model: 'sonnet', effort: 'low' },
  judge: {},
  build: {},
}

phase('Draft')
let final = await agent(
  DRAFT_PROMPT({ diff: args.diff, issue: args.issue, prTemplate: args.prTemplate, knowledgeBlocks: args.knowledgeBlocks }),
  { ...TIER.judge, agentType: 'forge:analyst', schema: DRAFT_PR_SCHEMA, label: 'pr-draft' },
)

if (args.depth !== 'quick') {
  phase('Critique')
  const critique = await agent(
    CRITIQUE_PROMPT(final),
    { ...TIER.judge, agentType: 'forge:analyst', schema: CRITIQUE_SCHEMA, label: 'pr-critique' },
  )
  if (critique.blocking.length > 0) {
    phase('Revise')
    final = await agent(
      REVISE_PROMPT(final, critique.blocking),
      { ...TIER.judge, agentType: 'forge:analyst', schema: DRAFT_PR_SCHEMA, label: 'pr-draft-revised' },
    )
  }
}
```

ワークフローの戻り値は `final`(title/body/openQuestions)のみ。リーダーはこれを提示 → ユーザー確認 → `gh pr create` を自分で実行する。

## 5. Step 3: レビュー対応ループ(任意 — ユーザーが求めた場合または `--auto`)

各ラウンドはリーダー主導で以下 4 手順を行う。

1. **リーダー**: `gh api` / `gh pr view` でレビューコメントを取得する。新規の実質的コメントがなければ Exit
2. **ワークフロー(Analyze → Integrate)**: コメント群を観点別に並列分析し、統合エージェントがコメントごとの対応方針を返す。観点は `{ key, agentType, roleHint }` で選定する(ポジションロール)。基本セット:

   | key | agentType |
   |---|---|
   | architecture | forge:architecture |
   | security | forge:security |
   | reuse | forge:reuse |

   Integrate は裁定役であり `forge:analyst` に固定する(立場を持たない)
3. **リーダー**: `action: fix` は `forge:builder` 1 体のミニワークフローで適用する。`discuss` / `rebut` は返信文を提示してから投稿する。commit & push は `--auto` 指定時のみ自動実行、無指定時は毎回ユーザー確認を挟む
4. **Exit**: 実質的コメントなし / max-rounds(既定 5、`--max-rounds` で上書き) / ユーザー中断

`--auto` は commit & push の自動化のみを意味する。PR 作成(Step 2)や返信投稿の要否判断そのものを自動化するものではない。

protected branch ガードは各ラウンドの commit/push 直前にも再確認する(ブランチ切替が挟まっている可能性があるため)。

### 「実質的コメント」判定

nit・acknowledge のみ・bot の定型文を除いたものを実質的コメントとする。判定は Analyze フェーズのスキーマに含め、Integrate 側で再判断しない。

### スキーマ

**ANALYZE**(実質性判定を含む):

```json
{
  "assessments": [
    {
      "commentId": "コメント ID",
      "isSubstantive": true,
      "nonSubstantiveReason": "false のとき必須(nit / acknowledge-only / bot-boilerplate 等)",
      "notes": "分析観点からの所見"
    }
  ]
}
```

**RESPONSE_PLAN**:

```json
{
  "plans": [
    {
      "commentId": "コメント ID",
      "action": "fix | discuss | rebut",
      "rationale": "この対応方針を選んだ理由",
      "fixSpec": "action=fix のときの変更方針・スコープ(それ以外は空でよい)"
    }
  ]
}
```

### JS スケルトン

```js
export const meta = {
  name: 'ship-review-round',
  description: 'Analyze PR review comments and produce a per-comment response plan',
  phases: [{ title: 'Analyze' }, { title: 'Integrate' }],
}

const TIER = {
  scan:  { model: 'sonnet', effort: 'low' },
  judge: {},
  build: {},
}

phase('Analyze')
const analyses = await parallel(
  // args.dimensions の要素は { key, agentType, roleHint }(§3 手順 2 の対応表で決定済み)
  args.dimensions.map(dim => () => agent(
    ANALYZE_PROMPT(dim, args.comments, args.diffContext, args.knowledgeBlocks),
    { ...TIER.judge, agentType: dim.agentType, schema: ANALYZE_SCHEMA, label: `analyze-${dim.key}` },
  ))
)

// 全観点で isSubstantive=false と判定されたコメントのみ非実質的として除外する
const nonSubstantiveIds = new Set(
  args.comments
    .map(c => c.id)
    .filter(id =>
      analyses.filter(Boolean).every(a =>
        a.assessments.find(x => x.commentId === id)?.isSubstantive === false
      )
    )
)
const substantive = args.comments.filter(c => !nonSubstantiveIds.has(c.id))

phase('Integrate')
let plans = []
if (substantive.length > 0) {
  const integrated = await agent(
    INTEGRATE_PROMPT(substantive, analyses),
    { ...TIER.judge, agentType: 'forge:analyst', schema: RESPONSE_PLAN_SCHEMA, label: 'integrate' },
  )
  plans = integrated?.plans ?? []
}

return { plans, substantiveCount: substantive.length }
```

`substantiveCount` はリーダーがそのラウンドの Exit 判定(実質的コメントなし)に使う値であり、0 ならレビュー対応ループを終了する。

fix 適用のミニワークフローは 1 エージェント構成で足りるため、専用スケルトンは持たず `forge:builder` を単発 `agent()` で呼ぶ(schema は finish の `FIX_RESULT_SCHEMA` と同形: `changedFiles[] / checks{} / concerns[]`)。

## 6. 制約

- `git push` / `gh pr create` / `gh api`(書き込み系)/ 返信投稿はすべてリーダー側でのみ実行する。ワークフロー内のエージェントには allowlist 上そもそも呼び出す手段がない(構造的封じ込め)
- force push は常に禁止
- protected branch 上では PR 作成・レビュー対応ループとも開始しない
- `--auto` 無指定時は commit & push の前に必ずユーザー確認を挟む
