# profile — forge のプロジェクトプロファイル

各スキルが `{{VARIABLE}}` テンプレなしでスタック非依存に動くための、プロジェクト固有値の解決規約。

## 解決順

1. スキル引数のフラグ(例: `--base <branch>`、`--depth`)
2. プロジェクトルートの `.forge.json`
3. 自動検出(下記)。検出結果は `.forge.json` に書き出してユーザーに通知する(コミット推奨)

フラグ > `.forge.json` > 自動検出 の順で上書きする。`.forge.json` に値があればそのフィールドの自動検出は行わない。

`.forge/` ディレクトリは実行アーティファクト(`.forge/reports/` 配下のレポート等)の置き場であり、実行のたびに増える。gitignore 推奨。対して `.forge.json` はプロジェクトのプロファイル値そのものであり、コミット対象(チーム全員が同じ値を再利用でき、検出コストも省ける)。

## 自動検出の原則

- **リーダーが決定的に行う**(エージェントを起動しない。Glob / Read によるマニフェスト・設定ファイル検査、および `git` の参照系コマンド(`symbolic-ref` 等)のみ。コストゼロに近く、揺れない)
- 判定できないフィールドは `null` のまま残す。`null` の意味は「実行時にエージェントがリポジトリから都度導出する」であり、エラーではない
- 検出は上書きしない側に倒す。既存の `.forge.json` にフィールドの値(空配列・空文字含む)が入っていれば再検出で書き換えない。`null` のフィールドのみ埋める

### フィールド別の検出手がかり

| フィールド | 意味 | 検出手がかり | null / 未検出時の挙動 |
|---|---|---|---|
| `language.docs` | 生成物(Issue・レポート等)の言語 | 既存 `README.md` / `docs/` 配下の文字種(ひらがな・カタカナの有無)から推定 | 判定不能なら `"ja"`(forge 自体の既定執筆言語) |
| `git.baseBranch` | PR・diff の既定 base | `git symbolic-ref refs/remotes/origin/HEAD`、無ければ `main` → `master` の存在確認順 | 解決できなければ `"main"` を仮置きし、finish/ship の Step 1 でユーザーに確認 |
| `git.protectedBranches` | commit/push 前にガードするブランチ名 | 検出しない(既定値 `["main", "master", "develop"]` を常に設定) | 該当なし |
| `commands.typecheck` | 型チェックコマンド | `package.json` scripts(`typecheck` / `tsc` を含むスクリプト名)、`Makefile` / `justfile` / `Taskfile` のターゲット名 | `null`。実行時にエージェントがマニフェストから都度導出、または当該チェックをスキップして報告 |
| `commands.lint` | Lint コマンド | 同上(`lint` を含むスクリプト名、`.eslintrc*` / `ruff.toml` / `.rubocop.yml` 等の設定ファイル併存) | 同上 |
| `commands.format` | フォーマットコマンド | 同上(`format` / `fmt`、`.prettierrc*` / `rustfmt.toml` 等) | 同上 |
| `commands.test` | 単体テストコマンド | 同上(`test`)、testFrameworks の設定ファイル併存 | 同上 |
| `commands.e2e` | E2E テストコマンド | 同上(`e2e` / `playwright` / `cypress` を含むスクリプト名) | 同上 |
| `commands.build` | ビルドコマンド | 同上(`build`) | 同上 |
| `stack.packageManager` | パッケージマネージャ | lockfile(`package-lock.json`→npm、`yarn.lock`→yarn、`pnpm-lock.yaml`→pnpm、`bun.lockb`→bun、`Cargo.lock`→cargo、`go.sum`→go、`poetry.lock`/`Pipfile.lock`→poetry/pipenv、`Gemfile.lock`→bundler) | `null`。エージェントがマニフェストとlockfileから都度判定 |
| `stack.monorepo.tool` / `filterFlag` | モノレポツールとフィルタ指定方法 | `pnpm-workspace.yaml`(pnpm、`--filter`)、`turbo.json`(turborepo)、`nx.json`(nx、`--project`)、`lerna.json`(lerna) | 未検出ならモノレポ扱いしない(フィールド自体を省略) |
| `stack.languages` | 使用言語一覧 | マニフェスト(`package.json` / `Cargo.toml` / `go.mod` / `pyproject.toml` / `Gemfile` / `pom.xml` / `build.gradle`)の存在、および拡張子分布(`git ls-files` の拡張子集計) | 検出0件でも `[]` を設定(knowledge packs の言語系は発火しない) |
| `stack.frameworks` | フレームワーク一覧 | 設定ファイル(`next.config.*` / `nuxt.config.*` / `vite.config.*` / `manage.py` / `settings.gradle` 等)、マニフェストの依存名 | 同上、`[]` |
| `stack.orm` | 使用 ORM | `prisma/schema.prisma`(Prisma)、`drizzle.config.*`(Drizzle)、`ormconfig*` / `data-source.ts`(TypeORM)、依存に `sqlalchemy`(SQLAlchemy)、`Gemfile` に `rails`/`activerecord`、`pom.xml`/`build.gradle` に `hibernate`/`spring-data-jpa` | `null`(ORM なしとして扱い、db/orm パックは発火しない) |
| `stack.testFrameworks` | テストフレームワーク一覧 | マニフェストの devDependencies(`jest` / `vitest` / `mocha` / `playwright` / `cypress`)、`pytest` / `Gemfile` の `rspec` / `pom.xml` の `junit` | `[]` |
| `stack.iac` | IaC ツール | `*.tf`(terraform)、`cdk.json`(CDK)、`Pulumi.yaml`(Pulumi) | `null`(iac パック非発火。terraform/cdk 混在時は先に見つかったもの、複数使用が明らかならカンマ区切り文字列) |
| `stack.cloud` | クラウドベンダー | `app.yaml` / `cloudbuild.yaml` / Dockerfile ベースイメージの `gcr.io`(GCP)、`.aws/` / `buildspec.yml`(AWS)、`azure-pipelines.yml` / `.azure/`(Azure) | `null`(クラウド系パック非発火) |
| `stack.uiCatalog` | コンポーネントカタログ | `.storybook/` ディレクトリの存在 | `null` |
| `paths.docs` | 設計・仕様ドキュメントの場所 | `docs/` / `ADR/` / `adr/` ディレクトリの存在 | `[]` |
| `paths.sourceRoots` | ソースの主要ルート | `src/` / `app/` / モノレポの `packages/*` / `apps/*` | `[]` |
| `paths.reviewChecklist` | レビューチェックリストの場所 | `docs/review-checklist*` 等の命名一致ファイル | `null`(finish の checklist 観点は非発火) |
| `paths.issueTemplate` | Issue テンプレート | `.github/ISSUE_TEMPLATE/` | `null`(plan は汎用の Why/What/How 構造を使う) |
| `paths.prTemplate` | PR テンプレート | `.github/PULL_REQUEST_TEMPLATE.md` またはディレクトリ | `null`(ship は汎用構造を使う) |
| `knowledge.packs` | 有効な knowledge pack 名一覧 | `stack` の各フィールドから knowledge-packs.md の対応表に従い導出 | 導出結果を配列で設定(常時発火の `library-docs` / `code-intel` は明示せず全スキルで暗黙に有効) |
| `knowledge.extra` | ユーザー自由記述の追加知識ソース | 検出しない(ユーザーが手動追記する) | `[]` |
| `review.dimensions` | レビュー観点の固定リスト | 検出しない | `null`(depth と stack から実行時に自動選定) |
| `review.externalReviewers` | 外部 CLI レビュアー(codex / gemini 等) | 検出しない | `[]`(ship/finish の thorough 拡張機能は無効) |
| `review.maxIterations` | finish の反復上限の明示上書き | 検出しない | `null`(workflow-core.md §4 の depth 別既定値を使う) |
| `depthDefault` | `--depth` 未指定時の既定値 | 検出しない | `"standard"` |

## `.forge.json` スキーマ

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

### フィールド説明

- `version`: スキーマバージョン。現行は `1` 固定
- `detectedAt`: 直近の自動検出実行日(`YYYY-MM-DD`)。手動編集した場合も更新不要(検出タイミングの記録であり編集履歴ではない)
- `language.docs`: 生成物(Issue 本文・レポート・PR 説明文)の言語コード
- `git.baseBranch` / `git.protectedBranches`: diff の既定 base、および commit/push 前にガードする対象ブランチ
- `commands.*`: 各検証コマンド。`null` は「実行時にエージェントが都度導出、またはそのチェックを省略」を意味する
- `stack.packageManager`: 依存インストール・スクリプト実行に使うコマンド名(`npm` / `pnpm` / `yarn` / `bun` / `cargo` / `go` / `poetry` / `bundle` 等)
- `stack.monorepo`: モノレポツール名と、単一パッケージに対象を絞るためのフラグ書式。単一パッケージ構成なら省略
- `stack.languages` / `frameworks` / `testFrameworks`: knowledge packs 選定の主入力
- `stack.orm`: db/orm パックの発火条件
- `stack.iac` / `cloud`: iac パック・クラウド系パックの発火条件
- `stack.uiCatalog`: ui-catalog パックの発火条件、および finish の docs/test 追随対象へのストーリー追加
- `paths.docs` / `sourceRoots`: 調査・レビューエージェントに探索範囲のヒントとして渡す
- `paths.reviewChecklist` / `issueTemplate` / `prTemplate`: finish / plan / ship がテンプレート構造を踏襲するための参照先
- `knowledge.packs` は自動検出時に `stack` から導出する(knowledge-packs.md の対応表)。`knowledge.extra` はユーザーが自由記述で追加する注入指示(文字列配列)であり、そのまま知識ソースブロック末尾に追記される
- `review.dimensions: null` は「depth と stack から自動選定」を意味する。明示配列を書けば固定できる(例: `["correctness", "security", "tests"]`)
- `review.externalReviewers`: `finish` の thorough で同期実行する外部 CLI レビュアーの識別子(例: `["codex", "gemini"]`)。空配列なら外部レビューは行わない
- `review.maxIterations`: 明示すれば workflow-core.md §4 の depth 別既定反復数を上書きする
- `depthDefault`: プロジェクト全体の既定 depth。CI 等で毎回 `--depth` を指定したくない場合に設定する

## 再検出のタイミング

自動検出は初回実行時に一度だけ行われ、以降は `.forge.json` の値がそのまま使われ続ける。スタックが変化した(パッケージマネージャの移行、主要フレームワークの追加・入れ替え、ORM の導入・変更、IaC ツールの追加等)と感じたら、`.forge.json` を削除するか該当フィールドを `null` に戻してから任意のスキルを再実行する。次回実行時に自動検出が該当フィールドを埋め直す。

`commands.*` のように手動で調整した値は、スタック変化と無関係に上書きされたくない場合が多い。フィールド単位で `null` に戻すか、そのまま手動で書き換える方が安全。
