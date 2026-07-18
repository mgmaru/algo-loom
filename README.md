# AlgoLoom

AlgoLoomは、AtCoderの終了済み過去問を、利用者が選んだEditorやIDEで解き、ターミナルから公開sampleの取得、local test、提出、履歴の保存・振り返りを行うためのローカルファーストCLIです。

特定のEditor、Cloud、LLMへ利用者を囲い込まず、自分に合った道具と学習方法を選べることを重視します。

## 現在の状態

現在は設計段階です。MVPは、AtCoderの終了済み過去問を対象とした問題取得、local test、提出、ローカル履歴、差分表示、exportを中心とします。

AI review、Cloud同期、問題推薦・TUI、Repair LabはMVP対象外です。将来機能として設計資料がありますが、実装や正式採用が確定したことを意味しません。

## はじめに読む文書

新しく参加する開発者は、次の順序で読むことを推奨します。

1. [プロジェクト草案](docs/product/concept.md) — 製品目的と中核となる設計思想
2. [MVPスコープとCore契約](docs/product/mvp-scope-and-core-contracts.md) — MVPの正本
3. [ストレスフリーUX設計](docs/quality/stress-free-ux-design.md) — 利用者体験として守る原則
4. [セキュリティ設計ガイド](docs/quality/security-design.md) — 信頼境界と実装上の安全要件
5. [未決事項一覧](docs/project/unresolved-decisions.md) — 設計・実装前に判断が必要な事項

## ドキュメント目次

### 製品・MVP・共通品質

| 文書 | 主な内容 | 状態・位置付け |
|---|---|---|
| [プロジェクト草案](docs/product/concept.md) | 製品目的、設計思想、技術構成、想定CLI、将来構想 | 製品全体の構想 |
| [MVPスコープとCore契約](docs/product/mvp-scope-and-core-contracts.md) | 対象利用者、MVP範囲、Core契約、完了条件 | **MVPの正本** |
| [ストレスフリーUX設計](docs/quality/stress-free-ux-design.md) | ストレス要因、UX契約、errorと回復 | 設計原則・改善対象 |
| [パフォーマンスと待機体験の設計](docs/quality/performance-and-waiting-design.md) | 待機時間、resource上限、性能目標、計測 | 設計方針・実装優先順位 |
| [セキュリティ設計ガイド](docs/quality/security-design.md) | 未信頼データ、外部process、DB、terminal、LLMの安全境界 | 設計方針 |

### 問題選択・AI review・将来機能

| 文書 | 主な内容 | 状態・位置付け |
|---|---|---|
| [問題選択・カタログ設計](docs/features/problem-selection-and-catalog.md) | 問題発見、`get`、AtCoder Problemsカタログ | 設計方針 |
| [Review Backend・LLM Provider設計](docs/features/llm-provider-design.md) | Provider選択、credential、Adapter、実行フロー | MVP後の設計方針 |
| [AIレビュー安全設計](docs/features/ai-review-safety-design.md) | AtCoderルール、開催中問題の判定、fail closed | MVP後の設計方針 |
| [Repair Lab 将来構想](docs/future/repair-lab-future-design.md) | 仮説と検証によるcode修正学習 | 将来構想・初期版対象外 |

### ローカル保存・Cloud同期・データベース

| 文書 | 主な内容 | 状態・位置付け |
|---|---|---|
| [ローカル利用とCloud同期の段階的設計](docs/features/local-and-cloud-sync-design.md) | ローカル利用と同期利用の関係、同期UX、導入段階 | 同期機能の製品・UX設計 |
| [Turso設計ガイド](docs/integrations/turso-design-guide.md) | データの権威、Turso方式、競合、障害、backup | 現在の同期方式判断の正本 |
| [Turso移行互換性設計](docs/integrations/turso-migration-compatibility-design.md) | Adapter境界、方式変更、移行、契約test | 同期実装の互換性設計 |
| [DB候補比較メモ](docs/research/db-comparison.md) | Cloud DB候補、料金、無料枠の比較 | 2026年7月時点の調査メモ |

### 配布・プロジェクト管理

| 文書 | 主な内容 | 状態・位置付け |
|---|---|---|
| [配布方針ガイド](docs/operations/algoloom-distribution.md) | AtCoderコンテンツ、規約、ライセンス、PyPI公開 | 配布上の判断材料 |
| [未決事項一覧](docs/project/unresolved-decisions.md) | 未決、条件付き決定、外部確認待ちの集約 | 判断状況の一覧。各設計の正本は置き換えない |

## 正本の扱い

- MVPへ含める能力、対象利用者、初期対応環境、履歴・提出のCore契約は、[MVPスコープとCore契約](docs/product/mvp-scope-and-core-contracts.md)を優先します。
- 同期機能の製品・UX上の位置付けは、[ローカル利用とCloud同期の段階的設計](docs/features/local-and-cloud-sync-design.md)を参照します。
- 現在のTurso採用方針とデータの権威は、[Turso設計ガイド](docs/integrations/turso-design-guide.md)を参照します。
- AI reviewのAtCoderルール判定は、[AIレビュー安全設計](docs/features/ai-review-safety-design.md)を参照します。
- 未決事項一覧や調査メモは、各設計文書の正本を置き換えません。

## 外部情報に関する注意

AtCoderの規約・コンテストルール、TursoやLLM ProviderのSDK・料金・利用条件は変更される可能性があります。時点が記載された調査結果は、そのまま現在の事実とみなさず、実装開始時と公開前に公式資料を再確認してください。
