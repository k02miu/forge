# contracts — forge の出力契約

判断チェックポイント(実装計画・最終所見)の出力契約。各スキルは `agent({ schema })` の schema としてこの契約を強制する。

## 1. criticalDecisions(必須 4 キー)

「重要な判断を列挙せよ」という緩い依頼は自己都合の過少報告を招くため、カテゴリを名前付き必須フィールドとして構造で強制する。**該当なしでも 4 キーすべて必須**(`status: "notApplicable"` + rationale を書く。`criticalDecisions: {}` はスキーマ違反)。

```json
{
  "criticalDecisions": {
    "backwardCompatibility": { "status": "decided | notApplicable", "decision": "...", "rationale": "...", "rejectedAlternatives": [], "confidence": "high | medium | low", "reversibility": "reversible | costly | irreversible" },
    "securityTradeoff":     { "...同構造..." },
    "irreversibleAction":   { "...同構造..." },
    "dataModelChange":      { "...同構造..." }
  }
}
```

## 2. 所見(finding)の構造

```json
{
  "findings": [
    {
      "file": "リポジトリ相対パス",
      "category": "correctness | security | tests | docs | performance | architecture | convention",
      "severity": "critical | high | medium | low",
      "kind": "defect | judgment",
      "claim": "何が問題か(1〜2 文)",
      "evidence": "問題箇所のコード断片(正確な引用、200 字以内。取得不能なら空にして symbol を埋める)",
      "symbol": "evidence が空のときの包含シンボル名",
      "suggestion": "修正の方向性"
    }
  ]
}
```

- `evidence` は収束キーの材料(workflow-core §7)。行番号・自由文タイトルは同一性判定に使わないため、フィールド自体を持たない
- `kind` はレビュアーの自己申告。最終判定は Verify が上書きする

## 3. Verify の判定(verdict)

```json
{
  "verdicts": [
    { "index": 0, "kind": "defect | judgment | spurious", "reason": "判定理由(spurious の場合は除外根拠を具体的に)" }
  ]
}
```

## 4. 最終レポート

人間可読レポート(markdown)を `.forge/reports/<skill>-<timestamp>.md` に書き出す。必須セクション:

1. **結果サマリ** — 何をして何が残ったか(exit 理由を含む)
2. **criticalDecisions** — `irreversible | costly` の項目は目立たせる
3. **修正済み defect / 見送り(deferred)** — 見送りには理由を必ず添える
4. **judgment 所見** — 修正しなかった主観系の指摘(ユーザーの判断材料)
5. **spurious 監査リスト** — Verify が除外した指摘の全件(場所・元の主張・除外理由)。0 件なら「なし」と明記。省略禁止
6. **実行統計** — 反復数・エージェント数・(取得できれば)トークン消費

このレポートは同期ゲートではなく事後監査のアーティファクト。生成失敗してもパイプラインは止めない(結果はチャットで要約して補う)。
