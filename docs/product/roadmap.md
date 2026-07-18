# AlgoLoom ロードマップ

## 1. 用語

| 用語 | 本書での意味 |
|---|---|
| Core | MVPで提供する、AIやCloud同期等の任意機能に依存しない中核機能。 |
| Adapter | Coreを特定のEditor、Viewer、外部サービス等から分離する接続境界。 |
| 昇格条件 | 将来候補を正式な製品範囲へ含める前に満たすべき条件。 |
| opt-in | 利用者が明示的に選択した場合にだけ機能を有効にする方式。 |
| fail closed | 安全性を判定できない場合に、処理を許可せず停止する方針。 |
| bootstrap | 同期先の既存データから端末の初期状態を構築する処理。 |

## 2. 今後の拡張構想（フェーズ2以降）

| 候補 | 概要 |
|---|---|
| fzf連携の実装 | log や show コマンド実行時に、Linuxコマンドの fzf ライクなインタラクティブ検索UIをターミナルに表示し、過去問をインクリメンタルサーチできるようにする。 |
| ダッシュボード化 | DBの蓄積データを利用し、将来的にチャート等を用いたWeb UIを作成する。 |
| Editor / Viewer Adapter | 実需に応じて代表的な外部ツール向け設定例を追加する。ただし、個別エディタの機能をAlgoLoom Coreへ組み込まない。 |
| Repair Lab（将来の学習ワークフロー） | AtCoder Coreが安定した後、他者またはLLMが書いた検証済みcodeを読み、修正前に原因仮説・根拠・予測・確信度を記録し、testによる検証、最小限の修正、回帰確認、確信度の更新までを練習する学習対象を検討する。別applicationのようなmode切替やcommand体系は設けず、workspace、編集、test、履歴、差分、review等の共通UXへ統合する。patchの速さや想定解との一致ではなく、調査と検証の質を中心に扱う。詳細は[Repair Lab 将来構想](../future/repair-lab-future-design.md)で定義する。 |

## 3. MVP後の拡張と昇格条件

### 3.1. Core安定後に検討する近接拡張

- Windows、Go、Rust
- 外部Editor / Diff Viewer Adapter
- AtCoder Problems catalogと問題選択支援
- local test eventの保存とopt-in自動checkpoint
- AtCoder既存履歴のread-only import
- 自動backupとrestore UX
- machine-readable出力と高度なshell integration

追加時は、MVPのinstall、日常command、offline履歴を複雑にしないことを確認する。

### 3.2. AI review

AI reviewはMVP後の独立した採用判断とする。少なくとも次を満たすまでCoreへ含めない。

- 現行のAtCoderルールをversion付きで確認し、不明時にfail closedにできる。
- 終了済み過去問を安全に識別できる。
- 利用者が送信内容、Provider、費用、保持方針を確認できる。
- reviewを使わなくても同じCore導線が成立する。
- AIがsourceを自動編集、実行、提出しない権限制約がある。

### 3.3. Cloud同期

Cloud同期は標準SQLiteのSchemaとmigrationが安定した後に試作する。

- Turso SDKを基本packageへ必須化しない。
- 2端末、offline、競合、強制終了、bootstrap、disableを検証する。
- 同期はbackupの代替にしない。
- 同期の導入前後で`log`、`show`、`diff`の意味を変えない。
- SDKが未成熟または配布不能なら同期公開を延期し、MVP Coreへ影響させない。

### 3.4. Repair Lab

Repair LabはAtCoder Coreとは異なる教材を扱うが、別application相当のmodeにはしない。仮説、根拠、予測、検証、確信度更新を保存する学習価値と、未信頼codeの実行安全性を確認してから正式設計へ進む。

共通UXへ自然に統合できない場合は、AlgoLoomへ無理に追加せず、別applicationとして分離すべきか再評価する。

---
