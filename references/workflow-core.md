# workflow-core — forge の Workflow 実行規約

全スキル共通の実行規約。各スキルの「ワークフロー仕様」はこの規約を前提に書かれている。

## 1. Workflow 専用プラグイン

forge は Dynamic Workflows(Workflow ツール)専用。フォールバック実装は持たない。

- 各スキルの冒頭で Workflow ツールの呼び出しを行い、ツールが存在しない・即時エラーになる場合は**そこで停止**し、ユーザーに次を案内する:
  - `/config` で Dynamic workflows が有効か確認する
  - `CLAUDE_CODE_DISABLE_WORKFLOWS=1` / settings の `disableWorkflows` が立っていないか確認する
- 部分実行後に失敗した場合(Fix 適用後にエラー等)は、ワーキングツリーを `git status --short` / `git diff --stat` で再把握して現状をユーザーに報告する。中間生成物を根拠に状態を推定しない。commit / push は行われていない前提なので `git restore` で巻き戻し可能である旨を添える(実行はユーザー指示があった場合のみ)

## 2. 検証済み API 面(これだけを使う)

スキルのスケルトンは以下の API のみに依存する(claude v2.1.191 で実機検証済みの面):

- `agent(prompt, { schema, agentType, model, effort, label, phase })`
- `parallel([fn, ...])` / `phase(title)` / `budget.total` / `args`
- `export const meta = { name, description, phases }`
- `agentType` はプラグイン名前空間付きカスタムエージェント(`forge:analyst` / `forge:builder`)が解決され、`schema` と合成できる

未検証の機能(`pipeline` の複雑な合成、`isolation: 'worktree'`、`workflow()` ネスト等)はスケルトンに含めない。必要になったら実機検証してからこのファイルを更新する。

## 3. モデル階層

モデルはスクリプト内の 1 箇所(`TIER`)で集中管理する。frontmatter には固定しない。

```js
const TIER = {
  scan:  { model: 'sonnet', effort: 'low' },  // 機械的収集・整形(Context / Report)
  judge: {},                                   // 判断系(Review / Verify / 統合 / 設計)= セッションモデルを継承
  build: {},                                   // 実装(builder)= セッションモデルを継承
}
```

判断系・実装をセッションモデル継承にすることで、コストはユーザーのセッションモデル選択で一括制御できる。

## 3.5 ロール配置

「あなたは誰の立場か」と「このプロジェクトは何か」を分離して注入する。

- **立場**(職業的懐疑の対象)はエージェント定義に置く: `forge:architecture` / `forge:security` / `forge:tests` / `forge:ui` / `forge:infra` / `forge:reuse` の6ロール。各ロールは自分の立場のみを主張し、他観点との調整・バランス取りは行わない(ポジショントーク)
- **プロジェクト具体性**(スタック固有の知識源・追加観点)は knowledge-packs.md の知識ソースブロックとして実行時にプロンプト注入する。立場とプロジェクト具体性は独立した軸であり、同じロールでもプロジェクトが変われば注入内容だけが変わる
- **中立役は `forge:analyst` に固定する**: Context(構造化収集)、Verify(バッチ判定)、Draft/Integrate(統合)、Report(レポート整形)。これらのフェーズにポジションロールを使わない
- **Verify の中立性は機能要件**: ポジショントークで最大化された各ロールの主張を裁定する唯一の面であり、Verify 自身が立場を持つと defect/judgment の判定と収束(§7)が歪む

## 4. depth プロファイル

全スキルは `--depth quick|standard|thorough` を受け付ける(省略時はプロファイルの `depthDefault`、それも無ければ `standard`)。depth は「並列数・反復数・観点数」だけを変える。契約(§6)と収束判定は変えない。

| depth | 調査/レビュー観点数 | finish の最大反復 | ピーク並列数 | 目安コスト(1 スキル実行) |
|---|---|---|---|---|
| quick | 2 | 2 | 3 | 〜0.3M tokens |
| standard | 4 | 3 | 5 | 0.4〜0.8M tokens |
| thorough | 6(+外部レビュアー) | 5 | 7 | 0.9〜1.7M tokens |

- エージェント 1 体の固定コストは実測 約 20k tokens。エージェント数を増やす設計変更はこの単価で見積もる
- 検証(Verify)が観点数・指摘数に比例してエージェントを増やさないよう、**バッチ検証(1 体で全指摘を判定)** を必ず使う
- ユーザーが `+500k` 等のトークン指示を出した場合のみ `budget.total` が入る。ループには `budget.total && budget.remaining()` ではなく**反復上限(maxIter)を必ず併置**する

## 5. 封じ込め(containment)

Workflow のサブエージェントは親セッションの allowlist を継承して acceptEdits で動く。したがって:

- **不可逆操作は allowlist に絶対に入れない**: `git push`、破壊的マイグレーション、`terraform apply`、外部 API への書き込み。封じ込めは「エージェントが物理的に呼べない」ことで担保する(人の確認ゲートに頼らない)
- commit / push はワークフローの外(リーダー側)で、ユーザーの明示指示があった場合のみ行う。force push は常に禁止
- 型チェック・lint・テスト等の検証コマンドは allowlist 外だと実行時に許可プロンプトが出る(そのコマンドだけ拒否され、run は続く)。事前にユーザーへ「実行され得るコマンド」を提示しておく

## 6. ワークフロー内の対話禁止

ワークフロー実行中のエージェントはユーザーに質問できない。したがって:

- 曖昧さの解消は**ワークフロー起動前**にリーダーが行う(必要なら AskUserQuestion)
- 実行中に発覚した曖昧さ・要判断事項は、所見または criticalDecisions(contracts.md 参照)として報告に載せ、リーダーが事後にユーザーへ提示する

## 7. 収束設計(反復レビューを行うスキル用)

fresh spawn の非決定性を前提にした収束エンジニアリング。severity ベースの収束判定は破綻することが確認済みなので使わない。

- **Exit / Fix の軸は defect / judgment**: 客観的な誤り(defect)は severity に関わらず修正対象。主観的な指摘(judgment)は収束判定に含めない。severity は修正の**順序付けのみ**に使う
- **Exit 条件**(JS で構造的に判定する。プロンプトへの依頼で済ませない):
  1. `all-clear` — defect が 0
  2. `converged` — defect の集合が前反復と同一(fix-stable キーで比較)
  3. `max-iterations` — depth の反復上限に到達
- **fix-stable な同一性キー**: `file + category + normalize(evidence)`。evidence は問題箇所のコード断片(取得不能時は包含シンボル名で代替)。**行番号は使わない**(他箇所の Fix で行がずれ、同一 defect が別物に見える)。**自由文タイトルも使わない**(fresh spawn の言い換えで一致しなくなる)

```js
const key = f => `${f.file}|${f.category}|${normalize(f.evidence)}`
const sameKeySet = (a, b) =>
  a.length === b.length && new Set(a.map(key)).size === new Set([...a, ...b].map(key)).size
// normalize: 空白圧縮 + trim。evidence が空なら f.symbol で代替
```

- **バッチ検証と spurious 監査**: Verify は 1 体が全指摘を `defect / judgment / spurious` に分類する(判定理由 reason 必須)。spurious として落とした指摘は**黙って捨てず** history に記録し、最終レポートに監査リストとして必ず表示する(バッチ検証者は単一障害点であり、その偽陰性を検出できる唯一の面がこの監査リストのため)
