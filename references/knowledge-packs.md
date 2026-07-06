# knowledge-packs — forge の知識注入機構

スキルロジックの抽象化(スタック非依存化)によって失われるスタック固有の具体性を、実行時にエージェントプロンプトへ再注入し、品質劣化を防ぐための機構。

## 目的と機構

1. リーダーはプロファイルの `stack` / `knowledge.packs` / `knowledge.extra`(profile.md 参照)から有効なパックを決める
2. 各パックの内容(下表)を合成して**「知識ソース」ブロック**(1 パック 2〜4 行)を組み立て、ワークフローの各エージェントプロンプトに埋め込む
3. ブロックの内容は 3 種: (a) ToolSearch で探す MCP ツール名/検索語と用途、(b) 追加レビュー観点、(c) 禁止・注意事項
4. **ツール不在時の規約**: 指定ツールが見つからなければリポジトリ内の既存実装を一次情報とする。ツール不在を理由に調査を省略しない(agents/analyst.md 原則 3 と同文)

エージェントは起動プロンプトの「知識ソース」ブロックを読んだ後、必要なツールを ToolSearch で検索してから使う(ツール名はヒントであり、実際の名前空間は MCP サーバーの導入経路によって前後する: `mcp__context7__*` か `mcp__plugin_<インストール元プラグイン>_context7__*` かなど)。

## パック対応表

| パック | 発火条件 | 注入内容 |
|---|---|---|
| library-docs | 常時 | context7 系 MCP を ToolSearch(`resolve-library-id` → `query-docs`)。外部ライブラリの API・設定・バージョン差分に関する主張は、学習知識だけで断定せずドキュメントを引いてから書く/指摘する。バージョン不明時はマニフェストで実バージョンを確認してから引く |
| code-intel | 常時 | serena 系 MCP を ToolSearch(`find_symbol` / `find_referencing_symbols` / `get_symbols_overview`)。シンボル定義・参照箇所の特定は文字列 grep より優先し、取りこぼしを防ぐ。初回利用前に `initial_instructions` 相当のツールがあれば一度読む |
| typescript | `stack.languages` に `typescript`/`ts` | 観点: any/unknown/型アサーションで型安全性が壊れていないか、ESM/CJS 境界の破綻、非同期の取りこぼし(floating promise、await 漏れ) |
| python | `stack.languages` に `python`/`py` | 観点: 型ヒントと実装の不整合、mutable default argument、async/sync 混在によるブロッキング、例外の握り潰し(`except: pass`) |
| go | `stack.languages` に `go` | 観点: エラーハンドリングの網羅性(err の握り潰し)、goroutine リーク、context 伝播の欠落 |
| rust | `stack.languages` に `rust` | 観点: `unwrap`/`expect` の乱用、エラー型設計(`thiserror` と `anyhow` の使い分け)、所有権回避のための不要な `clone` |
| java | `stack.languages` に `java` | 観点: 例外設計(checked/unchecked の使い分け)、null 安全性(`Optional` の活用状況)、Stream API の誤用によるパフォーマンス劣化 |
| ruby | `stack.languages` に `ruby` | 観点: 例外の握り潰し(`rescue => e; end`)、ActiveRecord の N+1、メタプログラミングが可読性を損なっていないか |
| php | `stack.languages` に `php` | 観点: 型宣言の欠如(`strict_types` 未指定)、生クエリによる SQL インジェクション、null 安全でないプロパティアクセス |
| react / next.js 等 FW | `stack.frameworks` に該当 | FW 用 devtools MCP(例: next 系)があれば ToolSearch で利用。観点: サーバー/クライアント境界の妥当性、不要な再レンダリング、バンドルサイズへの影響 |
| gcp | `stack.cloud` = `gcp` | gcloud 系 / Google developer knowledge 系 MCP を ToolSearch。観点: IAM 最小権限、サービス構成の妥当性、常時起動リソースによるコスト |
| aws | `stack.cloud` = `aws` | aws-knowledge 系 MCP(ドキュメント検索)を ToolSearch。観点: IAM 最小権限、サービス構成の妥当性、コスト |
| azure | `stack.cloud` = `azure` | azure 系 MCP を ToolSearch。観点: IAM 最小権限、サービス構成の妥当性、コスト |
| iac(terraform 等) | `stack.iac` が非 null | 観点: plan 影響範囲(意図しないリソースの削除・置換)、state 操作の危険性。**apply/destroy は封じ込め対象(workflow-core.md §5)で絶対に実行しない**。読み取り・計画確認に留める |
| db/orm | `stack.orm` が非 null | 観点: マイグレーションの後方互換性(既存データとの整合)、N+1 クエリ、インデックス設計の妥当性。**破壊的マイグレーション(drop/truncate 等)の実行は封じ込め対象**で、生成・レビューのみ行う |
| ui-catalog | `stack.uiCatalog` が非 null | 変更コンポーネントのストーリー追随を finish の docs/test 追随対象に含める。chrome-devtools 系 MCP があればビジュアル確認を browser-verify と併用する |
| browser-verify | 任意(uiCatalog に依らず利用可) | chrome-devtools 系 MCP があれば ship/finish で画面確認に使える。不在なら確認手順を計画としてレポートに残すのみに留める |

`knowledge.extra` の各文字列はそのまま知識ソースブロック末尾に追記する。

## 知識ソースブロックの組み立て例

プロファイルが `stack.languages = ["typescript"]`、`stack.cloud = "gcp"`、`stack.orm` が非 null(例: Prisma)の場合、有効パックは常時パック 2 つ(library-docs, code-intel)+ typescript + gcp + db/orm。リーダーが組み立ててエージェントプロンプトに埋め込むブロックは次の形になる:

```
## 知識ソース

- library-docs: 外部ライブラリの API・設定に関する主張は、ToolSearch で context7 系 MCP(resolve-library-id → query-docs)を検索し裏取りしてから書く。ツール不在ならリポジトリ内の既存利用箇所を一次情報とする。
- code-intel: シンボル定義・参照箇所の特定は ToolSearch で serena 系 MCP(find_symbol / find_referencing_symbols 等)を優先する。文字列 grep で済ませない。
- typescript: 追加観点として any/unknown/型アサーションの境界、ESM/CJS 境界、非同期の取りこぼし(floating promise)を確認する。
- gcp: ToolSearch で gcloud 系 / Google developer knowledge 系 MCP を検索し、利用可能なら参照する。追加観点: IAM 最小権限、サービス構成の妥当性、コスト。
- db/orm: 追加観点として、マイグレーションの後方互換性、N+1、インデックス設計を確認する。破壊的マイグレーションの実行は行わない(封じ込め対象)。
```

## ツール不在時の規約

ToolSearch で該当ツールが見つからない、または呼び出しが許可プロンプトで拒否された場合、そのパックの調査を省略しない。リポジトリ内の既存実装・既存ドキュメントを一次情報として代替する(agents/analyst.md 原則 3、agents/builder.md 原則 3 と同じ扱い)。ツール不在の事実は所見の `evidence` や builder の `concerns` に記録し、裏取りが弱い旨を報告に残す。
