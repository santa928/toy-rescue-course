# 積み木の衝突位置カバレッジ実装計画

1. production build上で黄色い積み木の東面5位置を独立実走し、現行の位置依存をREDで固定する。
2. 接触開始と継続接触の評価可否をpure helperでテストし、接触回数を増やさず再評価できる契約を作る。
3. `BreakableBlockPlaza` の破壊処理を共通化し、`onContactForce` から既存閾値へ継続入力する。
4. focused unit、5位置E2E、既存破壊E2E、全unit、build、全E2EをDocker内で実行する。
5. 代表画像を原寸目視し、mainへ日本語コミット、secret scan、push、Actions／Pages／公開版を確認する。
6. 検証根拠をIssue #3へコメントし、close後にopen Issue 0件を確認する。
