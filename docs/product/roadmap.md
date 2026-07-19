# AlgoLoom ロードマップ

## 1. 用語

| 用語 | 本書での意味 |
|---|---|
| Core | MVPで提供する、AIやCloud同期等の任意機能に依存しない中核機能。 |
| Adapter | Coreを特定のEditor、Viewer、外部サービス等から分離する接続境界。 |
| 製品フェーズ | 製品全体として、どの価値と範囲を優先するかを示す大区分。 |
| 局所Phase | 個別の設計文書内だけで有効な実装・検証順序。製品フェーズとは番号を共有しない。 |
| 昇格条件 | 将来候補を正式な製品範囲へ含める前に満たすべき条件。 |
| opt-in | 利用者が明示的に選択した場合にだけ機能を有効にする方式。 |
| fail closed | 安全性を判定できない場合に、処理を許可せず停止する方針。 |
| bootstrap | 同期先の既存データから端末の初期状態を構築する処理。 |

## 2. 製品全体のフェーズ

本書のフェーズは製品全体の優先順位を示す。各機能・配布・運用文書にある`Phase 1`等は、その文書内だけの局所Phaseであり、本書の製品フェーズとは別に扱う。MVPの正式な範囲と完了条件は[AlgoLoom MVPスコープとCore契約](./mvp.md)を正本とする。

| 製品フェーズ | 目的 | 主な対象 | 次へ進む判断 |
|---|---|---|---|
| Phase 1: MVP Core | AtCoderの終了済み過去問について、問題開始から履歴の振り返りまでの主要導線を成立させる。 | `get`、`test`、checkpoint、`submit`、`log`、`show`、`diff`、export | MVP文書の実装開始条件と完了条件を満たす。 |
| Phase 2: Core安定化・近接拡張 | Coreの意味を変えず、実需に基づいて日常利用と対応範囲を改善する。 | 問題選択支援、履歴検索、追加host・言語・build方式、外部Adapter、backup・restore等 | install、日常command、offline履歴を複雑にせず追加できることを候補ごとに確認する。 |
| Phase 3以降: 任意Capabilityの検証・採用 | Coreから分離した任意機能について、価値、安全性、配布可能性を個別に検証する。 | AI review、Cloud同期、Repair Lab | 各Capability固有の昇格条件を満たしたものだけを正式な製品範囲へ含める。 |
| 長期候補 | 現在の製品範囲を前提にせず、需要を確認して構想を具体化する。 | Web dashboard、managed service等 | 実需、Coreとの境界、運用・安全上の成立性を確認してから製品フェーズへの昇格を判断する。 |

Phase 2の各候補は実装を約束するbacklogではなく、すべての候補を完了することもPhase 3以降の開始条件ではない。Phase 3以降のCapabilityは相互に必須順序を持たない並行トラックとし、それぞれの前提と昇格条件が満たされた時点で個別に採否を判断する。

## 3. Phase 2: Core安定化・近接拡張

| 候補 | ねらい | 検討時の条件 |
|---|---|---|
| 履歴のインタラクティブ検索 | `log`や`show`で、fzfライクなインクリメンタル検索UIから過去の試行を探せるようにする。 | fzfの導入を必須にせず、非interactiveな既存導線を維持する。 |
| AtCoder Problems catalogと問題選択支援 | 問題catalogと絞り込みを使い、terminal内から問題を選択できるようにする。 | catalog障害や未導入を理由に、公式URLまたは問題IDを使うCore導線を止めない。 |
| 追加host環境 | WSL等、MVP外のhost環境へ対応範囲を広げる。 | 既存の`HostPlatform`契約と検証matrixを弱めない。 |
| 追加の解答言語 | C++、Python、Go、Rust以外の言語を追加する。 | 既存の`LanguageProfile`契約と共通テストを適用できる。 |
| project build | Cargo、Go module、CMake等を使うprojectを扱えるようにする。 | 単一sourceの既定導線を複雑にせず、実行範囲と設定の安全性を定義できる。 |
| 外部Editor / Diff Viewer Adapter | 実需に応じて代表的な外部ツール向け設定例や接続方法を追加する。 | 個別EditorやViewerの機能をCoreへ組み込まない。 |
| local test eventと自動checkpoint | local testの記録と、利用者が選択した場合の自動checkpointを検討する。 | opt-inとし、自動保存の範囲、保持方針、履歴上の意味を明確にする。 |
| AtCoder既存履歴のread-only import | AlgoLoom導入前の提出履歴を参照できるようにする。 | AlgoLoomが記録した履歴と外部から取得した履歴を混同しない。 |
| 自動backupとrestore UX | local履歴を安全に退避し、回復しやすくする。 | 同期とは別の責任として設計し、復元時に成功済みデータを失わない。 |
| machine-readable出力と高度なshell integration | scriptや外部toolからCore機能を利用しやすくする。 | 人向けCLIの意味と終了statusを変えず、version付きの出力契約を定義する。 |
| 境界づけられたuser preference | 表示、反復入力の既定値、端末固有の外部tool等を、利用者の環境へなじませる。 | 利用者検証で反復的な摩擦を確認し、user preferenceなしの標準導線、Coreの意味と安全契約、旧設定の互換性、設定errorの局所化を維持する。shellで自然に実現できるalias等は標準toolへ委ねる方法を先に検討する。 |

## 4. Phase 3以降: 任意Capabilityの検証・採用

| Capability | 開始前提 | 正式採用の判断 | 詳細 |
|---|---|---|---|
| AI review | Coreのsnapshot、verdict、diff参照契約が安定している。 | ルール適合、安全な問題識別、権限制約、Provider障害からの分離をすべて確認できる。 | [4.1. AI review](#41-ai-review) |
| Cloud同期 | 標準SQLiteのSchemaとmigrationが安定している。 | 複数端末、offline、競合、bootstrap、disable、配布可能性を検証できる。 | [4.2. Cloud同期](#42-cloud同期) |
| Repair Lab | AtCoder Coreが安定し、共通UX上で小規模な学習価値を検証できる。 | 学習記録の価値と未信頼codeの実行安全性を確認し、Coreと自然に統合できる。 | [4.3. Repair Lab](#43-repair-lab) |

### 4.1. AI review

AI reviewはMVP後の独立した採用判断とする。採用後もCoreへ組み込まず、次をすべて満たした場合だけ正式なoptional Capabilityとして提供する。

- 現行のAtCoderルールをversion付きで確認し、不明時にfail closedにできる。
- 終了済み過去問を安全に識別できる。
- 利用者が送信内容、Provider、費用、保持方針を確認できる。
- reviewを使わなくても同じCore導線が成立する。
- AIがsourceを自動編集、実行、提出しない権限制約がある。
- CoreはAI reviewの型、Provider、設定、保存状態へ依存せず、AI reviewだけがCoreの安定したsnapshot・verdict・diff参照契約へ一方向に依存する。
- AI reviewの保存はCoreのsubmissionやsnapshotへ任意列を追加せず、独立した追記型revisionとして関連付ける。
- Provider未導入、設定不足、判定拒否、timeout、response不正のいずれでも、Coreの成功済み状態を変更しない。

### 4.2. Cloud同期

Cloud同期は標準SQLiteのSchemaとmigrationが安定した後に試作する。

- Turso SDKを基本packageへ必須化しない。
- 2端末、offline、競合、強制終了、bootstrap、disableを検証する。
- 同期はbackupの代替にしない。
- 同期の導入前後で`log`、`show`、`diff`の意味を変えない。
- SDKが未成熟または配布不能なら同期公開を延期し、MVP Coreへ影響させない。

### 4.3. Repair Lab

Repair LabはAtCoder Coreとは異なる教材を扱うが、別application相当のmodeにはしない。仮説、根拠、予測、検証、確信度更新を保存する学習価値と、未信頼codeの実行安全性を確認してから正式設計へ進む。詳細な段階的実装判断は[Repair Lab 将来構想](../future/repair-lab-future-design.md)で定義する。

共通UXへ自然に統合できない場合は、AlgoLoomへ無理に追加せず、別applicationとして分離すべきか再評価する。

## 5. 長期候補

| 候補 | 構想 | 製品フェーズへ昇格する前の確認 |
|---|---|---|
| Web dashboard | DBの蓄積データを利用し、チャート等を用いたWeb UIを提供する。 | CLIとoffline履歴の価値を弱めず、表示する指標の根拠、Web公開時の認証・Security・運用責任を定義できる。 |
| managed service | 同期等の運用をAlgoLoom側で提供する可能性を検討する。 | 利用者需要、費用、認証、法務、privacy、OSS版との責任境界を確認できる。 |

---
