# Forge

Workflow(Dynamic Workflows)専用の開発パイプライン。`plan → work → finish → ship` の 4 スキルで、Issue 設計から実装・仕上げ・PR レビュー対応までをカバーする。`{{VARIABLE}}` テンプレは使わず、プロジェクトプロファイル(`.forge.json`)と knowledge packs でスタックごとの差分を吸収するため、単一スタック固定の前提がない。

## Requirements

- Claude Code の Dynamic Workflows(Workflow ツール)が有効であること。無効な場合、各スキルは冒頭で停止し `/config` の確認手順を案内する
- `gh` CLI(`plan` の Issue 作成、`ship` の PR 作成・レビュー対応で使用。`finish` は任意 — spec 観点で Issue を参照できた場合の読み取りのみ)
- Agent Teams への依存はない

## Install

Claude Code のプラグインマーケットプレイスとして追加する。

```
/plugin marketplace add k02miu/forge
/plugin install forge@forge
```

リポジトリ公開前はローカルパス指定でも追加できる(`/plugin marketplace add /path/to/forge`)。

## Skills

| スキル | コマンド | 役割 |
|---|---|---|
| plan | `/forge:plan <要求文>` / `/forge:plan #N` | 新規 Issue 設計。`#N`(既存 Issue 番号/URL)指定時は改訂モードに切り替わり、現状の本文・議論を踏まえた改訂案を作る |
| work | `/forge:work #<issue番号>` / `/forge:work "<作業内容>"` | Issue の実装。Issue 番号なしの自由文も受け付け、Issue を切るまでもない小規模修正に使える(完了後に事後 Issue 化を提案) |
| finish | `/forge:finish [--base <branch>]` | docs/テスト追随・静的チェック・収束型レビューループ |
| ship | `/forge:ship <PR番号または issue番号> [--auto] [--max-rounds N]` | PR 作成とレビュー対応ループ。既存 PR 番号を渡すと PR 作成をスキップし、レビュー対応ループへ直接入る |

全スキルは `--depth quick|standard|thorough` を受け付ける(既定は `.forge.json` の `depthDefault`、無指定時は `standard`)。depth は調査・レビューの観点数、反復数、並列数だけを変える。品質を担保する契約(criticalDecisions、finding のスキーマ、収束判定)は depth に関わらず一定。

## `.forge.json`(プロジェクトプロファイル)

初回実行時にリーダーがマニフェスト・設定ファイルを検査して自動検出し、プロジェクトルートに書き出す(コミット推奨)。以降はこの値を使い、再検出は行わない。詳細は `references/profile.md`。

最小例:

```json
{
  "version": 1,
  "detectedAt": "2026-01-10",
  "language": { "docs": "ja" },
  "git": { "baseBranch": "main", "protectedBranches": ["main"] },
  "commands": { "typecheck": "npm run typecheck", "lint": "npm run lint", "test": "npm test" },
  "stack": { "packageManager": "npm", "languages": ["typescript"], "frameworks": ["next"] },
  "knowledge": { "packs": ["typescript", "react"], "extra": [] },
  "depthDefault": "standard"
}
```

未検出のフィールドは `null` のままでよい。`null` は「実行時にエージェントがリポジトリから都度導出する」ことを意味し、エラーではない。スタックが変わったら該当フィールドを削除して次回実行時に再検出させる。

## Knowledge Packs

スキルロジックはスタック非依存に抽象化されているため、そのままでは言語・フレームワーク・クラウド固有の観点が薄くなる。knowledge packs は `.forge.json` の `stack` から有効なパックを選び、MCP ツールの検索指示・追加レビュー観点・禁止事項をエージェントプロンプトに実行時注入することでこれを補う(例: TypeScript なら floating promise、GCP なら IAM 最小権限)。対応表と組み立て例は `references/knowledge-packs.md`。

## Agents

forge のワークフローは中立役 2 種とポジションロール 6 種を使い分ける。

- **中立役**: `analyst`(調査・レビュー・統合・検証を担う汎用エージェント。Context / Verify / Draft・Integrate / Report で使用)、`builder`(実装エージェント。commit/push 禁止)
- **ポジションロール**: `architecture` / `security` / `tests` / `ui` / `infra` / `reuse` の 6 種。各ロールは自分の立場のみを主張し(ポジショントーク)、他観点との調整・バランス取りは行わない。複数ロールの指摘を裁定するのは中立の `analyst`(Verify)
- 「あなたは誰の立場か」はロールのエージェント定義に、「このプロジェクトは何か」は knowledge packs のプロンプト注入に置く。両者は独立した軸(詳細は `references/workflow-core.md` §3.5)

## Cost

| depth | 観点数 | finish の最大反復 | ピーク並列数 | 目安コスト(1 スキル実行) |
|---|---|---|---|---|
| quick | 2 | 2 | 3 | 〜0.3M tokens |
| standard | 4 | 3 | 5 | 0.4〜0.8M tokens |
| thorough | 6(+外部レビュアー) | 5 | 7 | 0.9〜1.7M tokens |

詳細は `references/workflow-core.md` §4。

## Relation to devflow

forge は devflow(Agent Teams ベースの開発パイプライン)の後継だが、コードも参照も共有しない完全新設計。Agent Teams と Workflow の二重実装保守、コスト・実行時間の過大さ、単一スタック固定のデフォルト値という devflow の課題を踏まえ、Workflow 専用・スタック非依存で作り直したもの。devflow パイロットで実証済みの品質機構(criticalDecisions 契約、defect/judgment 軸の Exit、fix-stable 収束キー等)は設計として継承しているが、実行時の依存関係はない。
