# forge 設計書

Workflow(Dynamic Workflows)専用の開発パイプラインプラグイン。devflow(Agent Teams ベース)の後継だが、コードも参照も共有しない完全新設計。

## 背景と設計目標

devflow の課題: (1) Agent Teams と Workflow の二重実装保守が重い、(2) コスト・実行時間が過大、(3) デフォルト値が単一スタック(pnpm/Next.js/Prisma/GCP)+社内固有値に固定されている。

forge の目標:

1. **Workflow 専用**。フォールバック実装を持たない(references/workflow-core.md §1)
2. **4 スキルに統合**: plan → work → finish → ship。`--depth quick|standard|thorough` でコストを可変に
3. **スタック非依存**: `{{VARIABLE}}` テンプレは廃止。プロジェクトプロファイル(`.forge.json`、自動検出+手動上書き)から値を取る
4. **抽象化による品質劣化の防止**: knowledge packs(references/knowledge-packs.md)でスタック固有の知識ソース(MCP ツール・ドキュメント・レビュー観点)を実行時にエージェントプロンプトへ注入する
5. devflow パイロットで実証済みの品質機構を継承: criticalDecisions 契約、defect/judgment 軸の Exit、fix-stable 収束キー、バッチ検証+spurious 監査(references/workflow-core.md §7, contracts.md)

## ファイル構成

```
.claude-plugin/plugin.json      … 済
agents/analyst.md               … 済(読み取り専用の汎用調査・レビューエージェント=中立役専用)
agents/builder.md               … 済(実装エージェント。commit/push 禁止)
agents/{architecture,security,tests,ui,infra,reuse}.md … ポジションロール(改訂1)
references/workflow-core.md     … 済(実行規約: API 面・TIER・depth・封じ込め・収束設計)
references/contracts.md         … 済(出力契約: criticalDecisions・finding・verdict・最終レポート)
references/profile.md           … 未(このファイルの §プロファイル を仕様とする)
references/knowledge-packs.md   … 未(§knowledge packs を仕様とする)
skills/plan/SKILL.md            … 未(§plan)
skills/work/SKILL.md            … 未(§work)
skills/finish/SKILL.md          … 未(§finish)
skills/ship/SKILL.md            … 未(§ship)
scripts/diff-summary.sh         … 未(§diff-summary)
README.md / .gitignore / LICENSE … 未
```

## 全ファイル共通の執筆規則

- 日本語。簡潔・直截。絵文字なし、太字の乱用なし、冗長な前置き・忖度表現なし
- SKILL.md frontmatter は `name` / `description`(英語 1〜3 文)/ `disable-model-invocation: true`
- 共通事項は references を `${CLAUDE_PLUGIN_ROOT}/references/<file>.md` で参照し、本文に重複記述しない
- Workflow スクリプト(JS)はプラグインとして配布しない。SKILL.md には「仕様+スケルトン」を載せ、リーダーが実行時に組み立てる建付けにする
- スケルトンは workflow-core.md §2 の検証済み API 面のみ使用する
- モデルは各スケルトン冒頭の `TIER` マップ(workflow-core.md §3)で集中管理。agents/*.md の frontmatter にモデルを書かない

## 各スキル共通の構成(SKILL.md の章立て)

1. **前提** — Workflow 必須(workflow-core §1)、gh CLI(必要なスキルのみ)、封じ込め(§5)、対話禁止(§6)への参照
2. **Step 0: プロファイル解決** — references/profile.md の共通手順を参照(1〜2 行で済ませる)
3. **Step 1: 前段(リーダー)** — 曖昧さ解消・入力確定。AskUserQuestion はここでのみ使用可
4. **Step 2: ワークフロー** — フェーズ表(役割・agentType・TIER)、スキル固有スキーマ、JS スケルトン、knowledge packs 注入の指示
5. **Step 3: 後段(リーダー)** — レポート書き出し(`.forge/reports/<skill>-<timestamp>.md`、contracts.md §4)、ユーザー確認、gh 操作
6. **制約** — commit/push はユーザー明示指示時のみリーダーが実行、等

depth ごとの数値(観点数・反復数・並列数)は workflow-core.md §4 の表に従い、スキル側では「どの観点をどの順で削るか」だけを定義する。

---

## プロファイル(references/profile.md の仕様)

### 解決順

1. スキル引数のフラグ(例: `--base <branch>`、`--depth`)
2. プロジェクトルートの `.forge.json`
3. 自動検出(下記)。検出結果は `.forge.json` に書き出してユーザーに通知する(コミット推奨)

`.forge/` ディレクトリは実行アーティファクト(レポート等)置き場。gitignore 推奨。`.forge.json` はコミット対象。

### 自動検出の原則

- **リーダーが決定的に行う**(エージェントを起動しない。Glob / Read によるマニフェスト・設定ファイル検査のみ。コストゼロに近く、揺れない)
- 判定できないフィールドは `null` のまま残す。`null` の意味は「実行時にエージェントがリポジトリから都度導出する」であり、エラーではない
- 検出の手がかり(例): lockfile → packageManager、`package.json` scripts / Makefile / justfile / Taskfile → commands、マニフェスト(`package.json` / `Cargo.toml` / `go.mod` / `pyproject.toml` / `Gemfile` / `pom.xml` / `build.gradle`)+拡張子分布 → languages、設定ファイル(`next.config.*` / `nuxt.config.*` / `vite.config.*` / `manage.py` / `settings.gradle` 等)→ frameworks、`*.tf` / `cdk.json` / `Pulumi.yaml` → iac、`app.yaml` / `cloudbuild.yaml` / `.aws/` / `azure-pipelines.yml` / Dockerfile 内のベースイメージ等 → cloud、`.github/ISSUE_TEMPLATE/` / `PULL_REQUEST_TEMPLATE` → templates、`.storybook/` → uiCatalog

### `.forge.json` スキーマ

```json
{
  "version": 1,
  "detectedAt": "YYYY-MM-DD",
  "language": { "docs": "ja | en | ...(生成物の言語。既存 docs/README の言語から推定)" },
  "git": { "baseBranch": "main", "protectedBranches": ["main", "master", "develop"] },
  "commands": {
    "typecheck": null, "lint": null, "format": null,
    "test": null, "e2e": null, "build": null
  },
  "stack": {
    "packageManager": null,
    "monorepo": { "tool": "...", "filterFlag": "..." },
    "languages": [], "frameworks": [], "orm": null,
    "testFrameworks": [], "iac": null, "cloud": null, "uiCatalog": null
  },
  "paths": {
    "docs": [], "sourceRoots": [],
    "reviewChecklist": null, "issueTemplate": null, "prTemplate": null
  },
  "knowledge": { "packs": [], "extra": [] },
  "review": { "dimensions": null, "externalReviewers": [], "maxIterations": null },
  "depthDefault": "standard"
}
```

- `knowledge.packs` は自動検出時に stack から導出(knowledge-packs.md の対応表)。`knowledge.extra` はユーザーが自由記述で追加する注入指示(文字列配列)
- `review.dimensions: null` は「depth と stack から自動選定」。明示配列で固定も可
- profile.md には各フィールドの意味・検出手がかり・null 時の挙動を表で載せる

---

## knowledge packs(references/knowledge-packs.md の仕様)

### 目的と機構

スキルロジックの抽象化で失われるスタック固有の具体性を、実行時に再注入して品質を守る。

1. リーダーはプロファイルの `stack` / `knowledge.packs` / `knowledge.extra` から有効パックを決める
2. 各パックの内容(下表)を合成して**「知識ソース」ブロック**(1 パック 2〜4 行)を組み立て、ワークフローの各エージェントプロンプトに埋め込む
3. ブロックの内容は 3 種: (a) ToolSearch で探す MCP ツール名/検索語と用途、(b) 追加レビュー観点、(c) 禁止・注意事項
4. **ツール不在時の規約**: 指定ツールが見つからなければリポジトリ内の既存実装を一次情報とする。ツール不在を理由に調査を省略しない(agents/analyst.md 原則 3 と同文)

### パック対応表(knowledge-packs.md にはこの表を完全な形で載せる)

| パック | 発火条件 | 注入内容の要点 |
|---|---|---|
| library-docs | 常時 | context7 系 MCP(resolve-library-id → query-docs)。外部ライブラリ API の主張は裏取りしてから書く/指摘する |
| code-intel | 常時 | serena 系 MCP(シンボル検索・参照検索)。文字列 grep より優先 |
| typescript | languages に ts | 観点: any/unknown/型アサーションの境界、ESM/CJS 境界、非同期の取りこぼし(floating promise) |
| python | languages に py | 観点: 型ヒント整合、mutable default、async/sync 混在、例外の握り潰し |
| go | languages に go | 観点: エラーハンドリング網羅、goroutine リーク、context 伝播 |
| rust / java / ruby / php | 同様 | 各 1 行の要点観点(妥当な内容で埋める) |
| react / next.js 等 FW | frameworks | FW 用 devtools MCP があれば利用。観点: サーバー/クライアント境界、再レンダリング、バンドル影響 |
| gcp | cloud=gcp | gcloud 系 / Google developer knowledge 系 MCP を ToolSearch。観点: IAM 最小権限、サービス構成の妥当性、コスト |
| aws | cloud=aws | aws-knowledge 系 MCP(ドキュメント検索)。観点同上 |
| azure | cloud=azure | azure 系 MCP。観点同上 |
| iac(terraform 等) | iac 非 null | 観点: plan 影響範囲、state 操作の危険。**apply/destroy は封じ込め対象(workflow-core §5)で絶対に実行しない** |
| db/orm | orm 非 null | 観点: マイグレーション後方互換、N+1、インデックス。破壊的マイグレーション実行は封じ込め対象 |
| ui-catalog | uiCatalog 非 null | 変更コンポーネントのストーリー追随を finish の docs/test 追随対象に含める |
| browser-verify | 任意 | chrome-devtools 系 MCP があれば ship/finish で画面確認に使える(任意・不在なら計画のみ) |

`knowledge.extra` の各文字列はそのまま知識ソースブロック末尾に追記する。

---

## スキル仕様

### plan(`/forge:plan <要求文>`)

Issue 設計。多観点調査 → 統合ドラフト → 批評 → GitHub Issue 作成。

- **Step 1(リーダー)**: 要求文を分類(feature / fix / refactor / infra)し、不足情報(対象範囲・受け入れ条件・非機能要件)を AskUserQuestion で解消。調査観点を選定: architecture, existing-code, tests を基本とし、分類と stack に応じて security / ui / library / infra を追加。depth の観点数上限(quick 2 / standard 4 / thorough 6)で切る
- **Step 2(ワークフロー)**: フェーズ = Survey → Draft → Critique → 完了
  - Survey: 観点ごとに `forge:analyst` を parallel 起動(SURVEY スキーマ: 観点名 / 所見 / 関連ファイル / リスク / 未確認事項)。knowledge packs 注入
  - Draft: 統合エージェント(TIER judge)が全 Survey を受けて Issue ドラフト生成(DRAFT スキーマ: title / body / acceptanceCriteria / implementationPlan / criticalDecisions ※contracts.md §1 の 4 キー必須 / openQuestions)。body はプロジェクトの issueTemplate(profile.paths)があればその構造に従い、なければ Why/What/How + 受け入れ条件の汎用構造
  - Critique: `forge:analyst` がドラフトを反駁(CRITIQUE スキーマ: blocking[] / suggestions[])。blocking があれば Draft を 1 回改訂。quick は Critique を省略、thorough は 2 巡まで
- **Step 3(リーダー)**: ドラフトと criticalDecisions / openQuestions を提示 → ユーザー確認 → `gh issue create`。レポート書き出し

### work(`/forge:work #<issue 番号>`)

Issue の実装。設計 → 並列実装 → 縫合チェック。

- **Step 1(リーダー)**: `gh issue view` で Issue 取得。実装計画の記載が薄い場合はその旨を伝え、plan の実行を提案するか、ワークフローの Design フェーズで補う。曖昧点を AskUserQuestion で解消し、着手内容を 1 段落で確認(実装はコードを書く実判断点のため、この確認ゲートは省略しない)
- **Step 2(ワークフロー)**: フェーズ = Context → Design → Build → Check
  - Context(TIER scan): 規約・関連実装の把握、非重複 zone 分割案(ZONE: name / files / summary)。zone 数は depth の並列上限以内。quick は常に 1 zone
  - Design(TIER judge): zone ごとの実装仕様 + criticalDecisions(backwardCompatibility / dataModelChange を特に)。standard 以上かつ 2 zone 以上なら `forge:analyst` の設計批評 1 回(blocking 時のみ改訂)
  - Build: zone ごとに `forge:builder` を parallel 起動(共有ツリー・zone 非重複が前提。BUILD スキーマ: zone / status / changedFiles[] / checks{typecheck,lint,test} / concerns[])。プロファイルの commands を検証コマンドとしてプロンプトに渡す
  - Check(TIER judge, `forge:analyst`): zone 縫合部の整合レビュー + 全体検証コマンドの実行結果確認(CHECK スキーマ: seams[] / failures[] / verdict)
- **Step 3(リーダー)**: 変更サマリ・チェック結果・concerns を報告。commit しない

### finish(`/forge:finish [--base <branch>]`)

仕上げ。docs/テスト追随 → 静的チェック → 収束型レビューループ。devflow の branch-finisher + review-loop の統合に相当。

- **Step 1(リーダー)**: `scripts/diff-summary.sh` で base との差分取得(空なら終了)。レビュー観点を選定: correctness/architecture, tests を基本に、stack と profile.review.dimensions から security / checklist(reviewChecklist があるとき)/ infra(iac/cloud ファイルに差分があるとき)/ 言語パック観点。depth 上限で切る。実行され得る検証コマンドを事前提示
- **Step 2(ワークフロー)**: フェーズ = Context → Groundwork → (Review → Verify → Fix)×N → Report
  - Context(TIER scan): 差分の構造化、変更ファイル → docs / テストの対応マップ
  - Groundwork: `forge:analyst` ×2 を parallel(docs 乖離検出、テストギャップ検出。GAPS スキーマ)→ barrier → `forge:builder` が両方の修正を適用し検証コマンドを通す
  - Review: 観点ごとに `forge:analyst` を parallel(FINDINGS スキーマ = contracts.md §2、過去反復の履歴を渡す)
  - Verify: **1 体で全指摘をバッチ判定**(VERDICTS = contracts.md §3)。spurious は history に記録してから除外
  - Exit 判定(JS): all-clear / converged(fix-stable キー、workflow-core §7)/ max-iterations(depth 依存: 2/3/5)
  - Fix: `forge:builder` が defect を severity 順に修正(judgment は修正しない)
  - Report(TIER scan): contracts.md §4 の構造で返却(spurious 監査リスト必須)
  - スケルトンは workflow-core §7 のコード断片(key / sameKeySet)をそのまま使う
- **Step 3(リーダー)**: レポートを `.forge/reports/` に書き出し、defect 修正済み・deferred・judgment・spurious 監査を要約報告。thorough では profile.review.externalReviewers(codex / gemini CLI 等)が定義されていれば、Review フェーズと並行してリーダー側で同期実行し、その所見を次反復の Review 入力に混ぜる(任意機能)

### ship(`/forge:ship <PR 番号または issue 番号> [--auto] [--max-rounds N]`)

PR 作成とレビュー対応ループ。**push と gh 操作はワークフローに入れない**(封じ込め、workflow-core §5)。ループ制御はリーダーが行い、ワークフローは「分析・起草」のみ担当する。

- **Step 1(リーダー)**: ブランチ状態確認・protected branch ガード(profile.git.protectedBranches 上では中止)・base 確認。未 push commit があれば push の可否をユーザーに確認
- **Step 2(PR 作成)**: 小さなワークフロー(Draft → Critique): `forge:analyst` が diff + Issue + prTemplate から PR 本文を起草、別の `forge:analyst` が批評(quick は批評省略)。リーダーが本文を提示 → ユーザー確認 → `gh pr create`
- **Step 3(レビュー対応ループ、任意 — ユーザーが求めた場合または --auto)**: 各ラウンド:
  1. リーダー: レビューコメント取得(`gh api` / `gh pr view`)。新規の実質的コメントがなければ終了
  2. ワークフロー(Analyze → Integrate): コメント群を観点別 `forge:analyst` で並列分析 → 統合エージェント(TIER judge)がコメントごとの対応方針(RESPONSE_PLAN スキーマ: comment / action(fix|discuss|rebut) / rationale / fixSpec)を返す
  3. リーダー: fix 分は `forge:builder` 1 体のミニワークフローで適用 → discuss/rebut は返信文を提示 → 返信投稿。commit & push は --auto 時のみ自動、通常はユーザー確認
  4. Exit: 実質的コメントなし / max-rounds(既定 5)/ ユーザー中断
- 「実質的コメント」判定: nit・acknowledge のみ・bot の定型文を除いたもの。判定は Analyze フェーズのスキーマに含める

---

## diff-summary(scripts/diff-summary.sh の仕様)

スタック非依存の差分サマリ。bash、依存なし、読み取り専用。

- 引数 1(任意)= base branch。未指定時: `origin/HEAD` → `origin/main` → `origin/master` → `origin/develop` の順で解決。見つからなければ exit 1 でメッセージ
- 出力: base と merge-base、`git diff --name-status <merge-base>`(コミット済み+未コミットを含むワーキングツリー比較)、`git status --short`(未追跡把握)、`git diff --stat <merge-base>`
- 差分ゼロなら "NO_CHANGES" を出力して exit 0

## README.md の仕様

英語見出し+日本語本文(devflow README と同様の慣行で可)。内容: パイプライン概要(4 スキル+depth)、必要要件(Dynamic Workflows / gh)、インストール(marketplace 追加)、`.forge.json` の説明と最小例、knowledge packs の 1 段落説明、コスト目安表(workflow-core §4 の再掲)、devflow との関係(後継・非依存)1 段落。簡潔に(200 行以内)。

## その他

- `.gitignore`: `.forge/`、`node_modules/`、OS ノイズ
- `LICENSE`: MIT(Copyright 2026 k02miu)

---

# 改訂1(2026-07-06): ポジションロールと入口拡張

初版レビューでの合意事項。根拠: (1) ロールをエージェント定義に置いてもプロンプト注入でも実行コスト(トークン・時間)は同等であり、システムプロンプトに置く方がペルソナの希釈耐性が高い。(2) 4スキル構成の柔軟性不足は、スキルを増やさず各スキルの入口を広げて解決する。

## R1. ポジションロール(エージェント定義6件)

「あなたは誰か(立場)」はエージェント定義のシステムプロンプトに、「このプロジェクトは何か」は従来どおり knowledge packs のプロンプト注入に置く。ポジショントーク(各ロールが自分の立場から最大限主張し、裁定は中立の Verify が行う)を構造として担保する。

### 新設エージェント

`agents/` に以下 6 件。frontmatter は `name` / `description`(英語)/ `disallowedTools: Edit, Write, NotebookEdit`。model は書かない(TIER で管理)。各 40〜70 行。

| ファイル | 立場 | 職業的懐疑の対象(要点) |
|---|---|---|
| architecture.md | 設計・コード品質の立場 | レイヤー境界侵犯、責務過多、循環依存、命名・エラーハンドリングの綻び、複雑度、API 設計粒度 |
| security.md | セキュリティの立場 | 認証・認可の欠落、入力検証、データ保護、秘密情報の扱い、外部連携、OWASP Top 10 相当 |
| tests.md | テストの立場 | カバレッジ欠落、境界値、非決定性(flaky)、アサーション品質、モック戦略の歪み、テスト独立性 |
| ui.md | UI/UX の立場 | 既存コンポーネント再利用の無視、デザインシステム逸脱、アクセシビリティ、状態設計 |
| infra.md | インフラの立場 | IaC 変更影響、CI/CD 破壊、環境変数の注入漏れ、クラウドコスト、リソース権限 |
| reuse.md | 資産活用の立場(devflow の existing-code-reviewer + library-researcher を統合) | 既存実装の再発明、既存パターンとの不整合、後方互換の破壊、安易な新規依存の追加 |

### 各ロール定義の本文構成(共通)

1. **立場宣言** — 「あなたは○○の立場のみを代表する。他観点との調整・バランス取りはあなたの仕事ではない」
2. **職業的懐疑の対象** — 上表の要点を具体化した箇条書き(そのロールが必ず疑う箇所)
3. **自己検閲の禁止** — バランスを取った指摘は失敗。裁定は Verify の仕事。あなたが黙った論点は誰も拾わない
4. **調査と返却の規約** — analyst と同じ原則を簡潔に内包する: 一次情報主義 / evidence(コード断片)必須 / defect・judgment の自己申告 / 推測で埋めない / スキーマの構造化データをそのまま返す / git 状態変更禁止

### 観点 → agentType 対応

スキルの Survey / Review は観点定義 `{ key, agentType, roleHint }` の配列を受け、`agent()` の `agentType` に反映する:

- architecture → `forge:architecture`、security → `forge:security`、tests → `forge:tests`、ui → `forge:ui`、infra → `forge:infra`、reuse(旧 existing-code / library 観点を統合)→ `forge:reuse`
- 観点キーは全スキルで同一の語彙(`architecture` / `security` / `tests` / `ui` / `infra` / `reuse` / `checklist` 等)を使う。`.forge.json` の `review.dimensions` がスキル横断で機能するための要件
- checklist・言語パック観点・docs-drift・test-gap など立場を持たない観点 → `forge:analyst`
- **中立役は analyst のまま**: Context / Verify / Draft・Integrate / Report。特に Verify は立場を持たないことが機能要件

## R2. 入口拡張(スキルは4本のまま)

### R2-1. plan: Issue 改訂モード

`/forge:plan #N`(または Issue URL)を受けたら新規作成ではなく改訂モード。Step 1 で `gh issue view --comments` により本文+議論を取得し、Survey の入力に「Issue と議論の現状」を含める。Draft は改訂案を生成。Step 3 では「本文を `gh issue edit` で更新」か「補記コメントを投稿」かをユーザーに確認してから実行する。

### R2-2. plan / work: タスク種別プリセット

plan Step 1 の分類に応じて基本観点セットを差し替える(depth 上限は従来どおり):

- feature: architecture / reuse / tests(+ 条件に応じ ui / security / infra)
- fix: architecture(根本原因の特定を roleHint で強調)/ reuse / tests(再現手順の確立を roleHint で強調)
- refactor: architecture / reuse / tests
- infra: infra / security / reuse

fix ではさらに、work の Design 仕様に「先に失敗する再現テストを書き、修正後に green を確認する」を必須項目として含める。

### R2-3. work: 引き継ぎモード

Step 1 で `scripts/diff-summary.sh` を実行し、base との差分が既にあれば引き継ぎモードに切り替える: Context は差分の理解と「Issue 要件とのギャップ分析(何が完了し何が残っているか)」を行い(CTX スキーマに `gapAnalysis` を追加: `done[] / remaining[] / concerns[]`)、Design は残作業のみを計画する。

### R2-4. work: 自由文入力

`/forge:work "<作業内容の説明>"` と Issue 番号なしの自由文も受け付ける(Issue を切るまでもない小さな修正向け)。この場合、完了報告時に「追跡性のため事後 Issue 化」を提案する(作成はユーザー確認後)。

### R2-5. ship: 既存 PR 直入り

引数が既存 PR(番号 / URL)なら Step 2(PR 作成)を丸ごとスキップし、Step 3 のレビュー対応ループへ直接入る。他人が作成した PR でもよい(対象ブランチを checkout 済みかを Step 1 で確認する)。

## R3. 影響ファイル

- `agents/` 6 件新設、`agents/analyst.md` は変更なし(中立役専用である旨は本設計書が定義)
- `skills/plan/SKILL.md`: R2-1 / R2-2、観点定義への agentType 追加
- `skills/work/SKILL.md`: R2-2(fix の再現テスト先行)/ R2-3 / R2-4、Design 批評等の agentType は現状維持
- `skills/finish/SKILL.md`: Review 観点定義への agentType 追加(dims の要素を `{ key, agentType, roleHint }` に)
- `skills/ship/SKILL.md`: R2-5。Analyze の観点にも agentType 対応(architecture / security / reuse を基本とする)
- `references/workflow-core.md`: §3 の直後に「ロール配置」の短い節を追加(立場=エージェント定義、プロジェクト具体性=knowledge packs、中立役=analyst、Verify の中立性は機能要件)
- `README.md`: Skills 表に新しい入口(plan #N / work 自由文 / ship 既存PR)を反映、エージェント一覧を 2 種+6 ロールに更新
