# troubleshooting — よくある症状と対処

症状 → 原因 → 対処の順にまとめる。詳細な規約は `references/workflow-core.md` と `references/profile.md` を参照。

## スキルが冒頭で停止し、Workflow の案内が出る

**原因**: Dynamic Workflows(Workflow ツール)が無効。forge は Workflow 専用でフォールバック実装を持たないため、ツールが使えないと各スキルは冒頭で停止する(`references/workflow-core.md` §1)。

**対処**:
1. `/config` で Dynamic workflows が有効になっているか確認する
2. 環境変数 `CLAUDE_CODE_DISABLE_WORKFLOWS=1` が立っていないか確認する
3. settings の `disableWorkflows` が立っていないか確認する

## `gh` コマンドが失敗する

**原因**: `gh` CLI が未認証、またはリポジトリに対する Issue/PR 権限がない。

**対処**:
- 未認証なら `gh auth login` で認証する。`gh auth status` で状態を確認できる
- 認証済みでも失敗する場合、対象リポジトリで Issue 作成・PR 作成・コメント投稿の権限があるか確認する(`plan` は Issue 作成、`ship` は PR 作成・レビュー対応で `gh` を使う)

## `.forge.json` の値が古い、スタックが変わった

**原因**: 自動検出は初回実行時に一度だけ行われ、以降は `.forge.json` の値がそのまま使われ続ける。パッケージマネージャの移行、主要フレームワークの追加・入れ替え、ORM の導入・変更などがあっても自動では追随しない。

**対処**: 該当フィールドを `null` に戻すか、`.forge.json` ごと削除してから任意のスキルを再実行する。次回実行時に自動検出が該当フィールドを埋め直す(`references/profile.md` の「再検出のタイミング」節)。`commands.*` など手動で調整した値は、スタック変化と無関係に上書きされたくないことが多いので、フィールド単位で `null` に戻す方が安全。

## 検証コマンドの許可プロンプトが毎回出る

**原因**: 型チェック・lint・テスト等の検証コマンドが allowlist に含まれていない。

**対処**: プロジェクトの allowlist にそのコマンドを追加すると、以後プロンプトが出なくなる。ただし **`git push` や破壊的マイグレーション、`terraform apply` など不可逆な操作は絶対に allowlist に入れない**。forge の封じ込め設計は「エージェントが物理的に呼べない」ことで不可逆操作を防いでおり(`references/workflow-core.md` §5)、allowlist への追加はこの前提を壊さない範囲(読み取り・検証系コマンドのみ)にとどめる。

## ワークフローが途中で失敗した

**原因**: Fix 適用後のエラーなど、反復の途中で失敗するケース。

**対処**: commit / push はワークフロー内で一切行われないため、途中で失敗しても作業ツリーの変更が勝手に共有されることはない。`git status --short` と `git diff --stat` で現状を確認する。中間生成物の内容を根拠に状態を推測せず、実際の作業ツリーを見て判断する。元に戻したい場合は `git restore` で巻き戻せる(実行はユーザー自身の判断で)。
