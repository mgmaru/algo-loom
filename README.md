# AlgoLoom Design

## ドキュメント概要

このREADMEは、AlgoLoomの目的と現在の開発段階を示し、設計リポジトリ内の設計文書と開発用仕様を読む順序、各文書の役割、正本の扱いを案内します。製品名は`AlgoLoom`、この設計リポジトリの名前は`algo-loom-design`とします。

AlgoLoomは、AtCoderの終了済み過去問を、利用者が選んだEditorやIDEで解き、ターミナルから公開sampleの取得、local test、任意の学習時間計測、提出、履歴の保存・振り返りを行うためのローカルファーストCLIです。他者との順位付けではなく、過去の自分の試行、実装、時間、理解の変化を振り返ることを中心にします。

特定のEditor、Cloud、LLMへ利用者を囲い込まず、自分に合った道具と学習方法を選べることを重視します。

AlgoLoomは、利用者が既に導入しているtoolを選択して安全に呼び出すことはあっても、通常操作でEditor、shell、plugin、toolchain、Provider runtime等の外部環境を永続的に書き換えません。AlgoLoomをユーザーの環境になじませ、ユーザーの環境をAlgoLoom向けに作り替えないことを原則とします。

## このリポジトリの責任

このリポジトリは、AlgoLoomの製品思想、設計判断、MVP範囲、Core契約および、それらから導出した開発用仕様の正本です。

| 場所 | 役割 | 主な読者 |
|---|---|---|
| [`docs/`](docs/) | 製品思想、設計理由、判断経緯、将来構想、調査記録を保持する | 設計者、reviewer、設計変更を行う開発者 |
| [`spec/`](spec/) | 現在の実装が満たすべき範囲、原則、不変条件を開発向けに抽出する | 実装者、test作成者、code reviewer |

`spec/`は独立した設計判断の正本ではなく、`docs/`にある正本から作る規範的な投影です。両者に矛盾が見つかった場合は実装で一方を選ばず、このリポジトリで設計文書と開発用仕様を同じ変更として整合させます。

実装リポジトリへは`spec/`の特定revisionを読み取り専用snapshotとして同期します。実装中に製品の挙動、範囲、原則または契約を変える必要が判明した場合は、このリポジトリへ設計変更を提案し、確定した`spec/`を再同期します。module構成、dependency、build、CI等の実装固有文書は実装リポジトリを正本とし、このリポジトリとの同期対象にはしません。詳しい運用は[開発用仕様の案内](spec/README.md)を参照してください。

## 現在の状態

現在は設計段階です。MVPは、AtCoderの終了済み過去問を対象とした問題取得、local test、任意の学習時間計測、提出、ローカル履歴、差分表示、exportを中心とします。

AI review、Cloud同期、問題推薦・TUI、公開用solution bundle、Repair Lab、Web dashboard、学習データAPIはMVP対象外です。将来機能として設計資料がありますが、実装や正式採用が確定したことを意味しません。

## はじめに読む文書

実装を始める開発者は、まず[開発用仕様の案内](spec/README.md)から、現在の実装に必要な文書を確認します。

設計変更へ参加する開発者は、次の順序で読むことを推奨します。

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
| [公開用solution bundle将来設計](docs/features/public-solution-bundle-design.md) | 自分のsourceを公開候補として最小構成へ切り出す境界、Git・GitHub等へ委ねる操作、安全・privacy要件 | MVP後の候補。実装・採用は未決 |
| [学習データアクセス・可視化API将来設計](docs/features/learning-data-access-api-design.md) | 本人の学習履歴をCLI、個人用UI、公式dashboard、外部toolから参照する共通Query契約、指標、段階的API公開 | 長期構想・MVP対象外 |
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
- 自分のsourceを外部公開前の最小bundleへ切り出す責任と、Git・GitHub等へ委ねる公開操作の境界は、[公開用solution bundle将来設計](docs/features/public-solution-bundle-design.md)を参照します。
- 本人の学習データを外部clientへ提供する際のQuery契約、指標、local data access、Hosted API、無料提供の境界は、[学習データアクセス・可視化API将来設計](docs/features/learning-data-access-api-design.md)を参照します。
- 未決事項一覧や調査メモは、各設計文書の正本を置き換えません。

## 外部情報に関する注意

AtCoderの規約・コンテストルール、GitHub等の外部公開先、TursoやLLM ProviderのSDK・料金・利用条件は変更される可能性があります。時点が記載された調査結果は、そのまま現在の事実とみなさず、実装開始時と公開前に公式資料を再確認してください。
