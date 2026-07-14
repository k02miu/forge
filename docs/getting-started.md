# getting-started — 初めて forge を使う

forge を初めて使うときに知っておくべきことをまとめる。スキルの詳細な仕様は `references/` と `skills/*/SKILL.md` を参照。

## 前提を確認する

forge は Dynamic Workflows(Workflow ツール)専用で、フォールバック実装は持たない。実行前に次を確認しておく。

- **Dynamic Workflows が有効か**: `/config` で Dynamic workflows の項目を確認する。無効な場合、`CLAUDE_CODE_DISABLE_WORKFLOWS=1`(環境変数)や settings の `disableWorkflows` が立っていないかも確認する。無効なまま各スキルを実行すると、冒頭で停止しこの確認手順が案内される
- **`gh` CLI が認証済みか**: `gh auth status` で確認する。`plan`(Issue 作成)と `ship`(PR 作成・レビュー対応)は `gh` 必須。`finish` は任意(Issue 参照が取れた場合の読み取りのみ)

## 初回実行で何が起きるか

最初にどのスキルを実行しても、Step 0 でプロジェクトプロファイル(`.forge.json`)の解決が走る。プロジェクトルートにまだファイルがなければ、リーダーがマニフェストや設定ファイルを検査して自動検出し、`.forge.json` として書き出す。

- 書き出し後は通知が入る。**コミットを推奨する**: 一度検出すればチーム全員が同じ値を再利用でき、次回以降の検出コストも省ける
- 一方 `.forge/` ディレクトリ(実行のたびに増えるレポート等のアーティファクト置き場)は **gitignore を推奨**。プロファイルとアーティファクトはコミット方針が逆であることに注意する

詳しい検出項目とフィールドの意味は `references/profile.md` を参照。

## 実行中に許可プロンプトが出る場面

型チェック・lint・テスト・ビルドといった検証コマンドは、プロジェクトの allowlist に含まれていないと実行時に許可プロンプトが出る。これは forge の不具合ではなく、不可逆操作を allowlist に入れない封じ込め設計(`references/workflow-core.md` §5)の裏返しで、検証コマンドはその対象外という位置づけのためである。

プロンプトを拒否しても実行全体は止まらない。**そのコマンドだけがスキップされ、run は続行される**(結果は `skipped` 扱いでレポートに残る)。毎回聞かれるのが煩わしい場合は、`docs/troubleshooting.md` の allowlist 追加の案内を参照。

## depth とコストの読み方

全スキルは `--depth quick|standard|thorough` を受け付ける。コストの目安は README.md の Cost 表を参照。ごく簡単に言うと:

- 観点数・反復数・並列数だけが変わり、品質を担保する契約(criticalDecisions、finding のスキーマ、収束判定)は depth に関わらず一定
- **迷ったら `standard`**(既定値)。**まず動きを試したいだけなら `quick`** から始めるとコストを抑えられる

## 最初の一歩

Issue を切るほどでもない小さな修正で、パイプラインの流れを体験してみる。

```
/forge:work "READMEのtypoを直す"
/forge:finish --depth quick
```

`work` は自由文のまま実装まで進み、完了後に事後 Issue 化を提案する(作成は任意)。`finish` は `--depth quick` で軽めに差分を仕上げる。慣れてきたら `plan` から Issue 設計を始める通常フロー(`plan → work → finish → ship`)に進むとよい。
