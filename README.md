# AlgoLoom

## ドキュメント概要

このREADMEは、AlgoLoomの目的と現在の開発段階を示し、リポジトリ内の設計文書を読む順序、各文書の役割、正本の扱いを案内します。

AlgoLoomは、AtCoderの終了済み過去問を、利用者が選んだEditorやIDEで解き、ターミナルから公開sampleの取得、local test、任意の学習時間計測、提出、履歴の保存・振り返りを行うためのローカルファーストCLIです。他者との順位付けではなく、過去の自分の試行、実装、時間、理解の変化を振り返ることを中心にします。

特定のEditor、Cloud、LLMへ利用者を囲い込まず、自分に合った道具と学習方法を選べることを重視します。

AlgoLoomは、利用者が既に導入しているtoolを選択して安全に呼び出すことはあっても、通常操作でEditor、shell、plugin、toolchain、Provider runtime等の外部環境を永続的に書き換えません。AlgoLoomをユーザーの環境になじませ、ユーザーの環境をAlgoLoom向けに作り替えないことを原則とします。

## 現在の状態

現在は設計段階です。MVPは、AtCoderの終了済み過去問を対象とした問題取得、local test、任意の学習時間計測、提出、ローカル履歴、差分表示、exportを中心とします。

AI review、Cloud同期、問題推薦・TUI、Repair LabはMVP対象外です。将来機能として設計資料がありますが、実装や正式採用が確定したことを意味しません。

## はじめに読む文書

新しく参加する開発者は、次の順序で読むことを推奨します。

1. [製品ビジョン](docs/product/vision.md) — 製品目的と中核となる設計思想
2. [MVPスコープ](docs/product/mvp.md) — 対象利用者、MVP範囲、実装開始・完了条件
3. [アーキテクチャ概要](docs/architecture/overview.md) — 技術構成、設定、workspace、想定CLI
4. [Core契約](docs/architecture/core-contracts.md) — 各機能が共通して守る契約
5. [言語・実行環境の可搬性設計](docs/architecture/language-and-platform-portability.md) — 言語・OS・開発環境差異、依存方向、workspace UX、可搬性
6. [ストレスフリーUX設計](docs/quality/stress-free-ux-design.md) — 利用者体験として守る原則
7. [セキュリティ設計ガイド](docs/quality/security-design.md) — 信頼境界と実装上の安全要件
8. [未決事項一覧](docs/project/unresolved-decisions.md) — 設計・実装前に判断が必要な事項

## ドキュメント目次

### 製品・MVP

| 文書 | 主な内容 | 状態・位置付け |
|---|---|---|
| [製品ビジョン](docs/product/vision.md) | 製品目的、中核となる設計思想 | 製品全体の構想 |
| [MVPスコープ](docs/product/mvp.md) | 対象利用者、MVP範囲、実装開始・完了条件、変更管理 | **MVP範囲の正本** |
| [ロードマップ](docs/product/roadmap.md) | MVP後の拡張候補と昇格条件 | 将来候補。実装の確約ではない |

### アーキテクチャ・共通品質

| 文書 | 主な内容 | 状態・位置付け |
|---|---|---|
| [アーキテクチャ概要](docs/architecture/overview.md) | 技術構成、設定、workspace、想定CLI | 製品全体の技術構想 |
| [Core契約](docs/architecture/core-contracts.md) | 問題取得、test、履歴、提出、保存の不変契約 | **Core契約の正本** |
| [言語・実行環境の可搬性設計](docs/architecture/language-and-platform-portability.md) | LanguageProfile、HostPlatform、Editor / IDE非依存境界、実行配置、複数言語UX、異種OS間の可搬性 | MVP対応環境の実装設計 |
| [ストレスフリーUX設計](docs/quality/stress-free-ux-design.md) | ストレス要因、UX契約、errorと回復 | 設計原則・改善対象 |
| [パフォーマンスと待機体験の設計](docs/quality/performance-and-waiting-design.md) | 待機時間、resource上限、local実行計測、性能目標 | 設計方針・実装優先順位 |
| [セキュリティ設計ガイド](docs/quality/security-design.md) | 未信頼データ、外部process、DB、terminal、LLMの安全境界 | 設計方針 |

### 問題選択・AI review・将来機能

| 文書 | 主な内容 | 状態・位置付け |
|---|---|---|
| [問題選択・カタログ設計](docs/features/problem-selection-and-catalog.md) | 問題発見、`get`、AtCoder Problemsカタログ、問題・解法タグ | 設計方針 |
| [外部学習資料参照設計](docs/features/external-learning-resources.md) | AtCoder問題・解説・他ユーザー提出一覧のbrowser参照、著作権・保存境界 | 公式問題・解説はMVP、提出一覧はMVP後 |
| [解き直しworkflow設計](docs/features/revisit-workflow.md) | freshな解き直し、sibling checkout、SolveAttempt分離、比較・回復 | MVP機能設計 |
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

- MVPへ含める能力、対象利用者、初期対応環境、実装開始・完了条件は、[MVPスコープ](docs/product/mvp.md)を優先します。
- 問題取得、local test、履歴、提出、保存のCore契約は、[Core契約](docs/architecture/core-contracts.md)を優先します。
- 言語・OS差異の境界、Editor / IDEに依存しないCore互換性、実行配置、複数言語workspace UX、異種OS間の可搬性は、[言語・実行環境の可搬性設計](docs/architecture/language-and-platform-portability.md)を参照します。
- 同期機能の製品・UX上の位置付けは、[ローカル利用とCloud同期の段階的設計](docs/features/local-and-cloud-sync-design.md)を参照します。
- 現在のTurso採用方針とデータの権威は、[Turso設計ガイド](docs/integrations/turso-design-guide.md)を参照します。
- AI reviewのAtCoderルール判定は、[AIレビュー安全設計](docs/features/ai-review-safety-design.md)を参照します。
- AtCoderの問題・解説・他ユーザー提出一覧を参照する際のbrowser委譲、spoiler、保存禁止範囲は、[外部学習資料参照設計](docs/features/external-learning-resources.md)を参照します。
- 同じ問題を解き直す際のproblem checkout、SolveAttempt、snapshot、部分失敗の契約は、[解き直しworkflow設計](docs/features/revisit-workflow.md)を参照します。
- 未決事項一覧や調査メモは、各設計文書の正本を置き換えません。

## 外部情報に関する注意

AtCoderの規約・コンテストルール、TursoやLLM ProviderのSDK・料金・利用条件は変更される可能性があります。時点が記載された調査結果は、そのまま現在の事実とみなさず、実装開始時と公開前に公式資料を再確認してください。
