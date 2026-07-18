# AlgoLoom 未決事項一覧

> 作成日: 2026年7月18日
>
> 目的: リポジトリ内に分散している未決事項を、原文の判断を変えずに確認できるよう集約する。
>
> 範囲: 「未確定」「別途決定」「機能設計で決める」「採用判断」「外部への確認」が明記されている事項、および将来の追加時に再評価が必要と明記されている事項を対象にする。実装順序だけが書かれ、判断が保留されていない項目は含めない。

## 読み方

- 各項目の「原文」は出典からの抜粋であり、表記・条件・留保を変更していない。
- 「決めること」は原文から分かる確認対象を短く示すための案内であり、決定そのものではない。
- MVPの範囲に関する正本は、引き続き [MVPスコープとCore契約](design/mvp-scope-and-core-contracts.md) である。この一覧は正本を置き換えない。

## 1. CLI・workspace・出力UX

### 1.1 日常commandの最終仕様

**決めること:** subcommand名、引数、option、alias、および例示されたCLI案をどこまで正式契約にするか。

**原文:** 「本書および関連文書に記載するcommand名、引数、option、対話例、出力例は、明示的にCLI契約として確定したものを除き、機能と責任を説明するための暫定案とする。具体的なCLI設計は、上記原則と実際の利用検証を踏まえて別途決定する。」

出典: [プロジェクト草案 §3.4](concept.md#34-標準ツールとの責任境界)、[MVPスコープとCore契約 §1.2](design/mvp-scope-and-core-contracts.md#12-本書で決めないこと)

### 1.2 workspace metadataとcontext指定

**決めること:** metadata fileの名称・形式・Schema version、探索範囲・除外directory・規模上限、明示option名、引数を省略できる条件。

**原文:** 「metadata fileの名称と形式、探索上限、明示option名は機能設計で決める。」

**原文:** 「問題directoryと一緒に移動するmetadata fileの名称、形式、Schema version」「同じ問題を検出するworkspace探索範囲と、除外directory、規模上限」「workspace、問題、source contextを明示指定するoptionの具体名」「引数を省略できる条件」

出典: [MVPスコープとCore契約 §4.3](design/mvp-scope-and-core-contracts.md#43-workspaceとcontext)、[ストレスフリーUX設計 §11](design/stress-free-ux-design.md#11-現時点で確定しないこと)

### 1.3 `get`の補助動作と途中失敗の回復

**決めること:** 問題ページをbrowserで開くか、templateをいつ作るか、取得の各途中状態からどのように再実行・回復するか。

**原文:** 「問題ページをbrowserで開くか、templateをいつ作るか等は機能設計で決める。」

**原文:** 「問題取得は、公式確認、sample取得、directory作成、template作成、DB保存、browser起動という複数の副作用を持つ。次の途中状態が未定義である。」

出典: [MVPスコープとCore契約 §5.2](design/mvp-scope-and-core-contracts.md#52-冪等性と部分失敗)、[ストレスフリーUX設計 §3.3](design/stress-free-ux-design.md#33-問題取得の途中失敗と再実行)

### 1.4 履歴・表示・診断の細部

**決めること:** 同一sourceへの重複操作の見せ方、terminal表示の色・spinner・table layout、進捗表示、統一診断入口、Viewer fallbackの表示量。

**原文:** 「同じsourceに対する重複操作をどう見せるかは機能設計で決めるが、無断で別のsourceへ差し替えない。」

**原文:** 「terminal表示の色、spinner、table layout」

**原文:** 「進捗表示の具体的な見た目」「統一診断入口の具体名」「Viewer fallbackの具体的な表示量」

出典: [MVPスコープとCore契約 §7.3](design/mvp-scope-and-core-contracts.md#73-checkpoint)、[MVPスコープとCore契約 §1.2](design/mvp-scope-and-core-contracts.md#12-本書で決めないこと)、[ストレスフリーUX設計 §11](design/stress-free-ux-design.md#11-現時点で確定しないこと)

### 1.5 exit codeとmachine-readable出力

**決めること:** exit codeの体系とmachine-readable出力の詳細。

**原文:** 「exit codeとmachine-readable出力の詳細は機能設計で決める。」

出典: [MVPスコープとCore契約 §4.6](design/mvp-scope-and-core-contracts.md#46-出力とerror)

### 1.6 任意機能の具体的な導線

**決めること:** interactive UIの有無、AtCoder認証を確認する具体的操作、AI Provider選択画面の階層、Cloud同期を案内するタイミング、shell completionの詳細。

**原文:** 「interactive UIの有無」「AtCoder認証を確認する具体的な操作」「AI Provider選択画面の具体的な階層」「Cloud同期を案内するタイミング」「aliasとshell completionの詳細」

出典: [ストレスフリーUX設計 §11](design/stress-free-ux-design.md#11-現時点で確定しないこと)

## 2. Core実装・性能パラメータ

### 2.1 実装技術の最終形

**決めること:** CLI framework、dependency injection手法、class・module・table・column名、metadata/export fileの最終形式。

**原文:** 「CLI frameworkやdependency injection手法」「class、module、table、columnの最終名称」「metadata fileとexport fileの最終形式」

出典: [MVPスコープとCore契約 §1.2](design/mvp-scope-and-core-contracts.md#12-本書で決めないこと)

### 2.2 言語profileとuser-level実行設定

**決めること:** C++・Python以外の対応時期、およびuser-level設定から拡張子・template・compile/run commandを変更可能にするかと、その安全な契約。

**原文:** 「将来、user-level設定から拡張子、template、compile/run commandを変更できる構成を検討する。」

出典: [プロジェクト草案 §4](concept.md#4-解答言語と設定管理)、[MVPスコープとCore契約 §14.1](design/mvp-scope-and-core-contracts.md#141-core安定後に検討する近接拡張)

### 2.3 実行・保持・性能の具体値

**決めること:** timeout、出力量、保持期間、compile/runのresource上限、性能SLOを固定する値と計測対象環境。

**原文:** 「timeout、出力量、保持期間等の具体値」「compilerとruntimeの細かなversion matrix」

**原文:** 「数値は対応OS、DB規模、sample数、Providerにより変わるため、次は実装開始時の仮説である。固定の約束にする前に、代表的な端末と履歴件数でp50/p95を計測する。」

出典: [MVPスコープとCore契約 §1.2](design/mvp-scope-and-core-contracts.md#12-本書で決めないこと)、[パフォーマンスと待機体験の設計 §5](design/performance-and-waiting-design.md#5-性能待機の初期契約)

### 2.4 DB保守の実行規約

**決めること:** DB lock、migration、checkpoint、backupをいつ・どのような排他と回復表示で実行するか。

**原文:** 「DB lock、migration、checkpoint、backupの実行規約を確定する。」

出典: [パフォーマンスと待機体験の設計 §7](design/performance-and-waiting-design.md#7-実装順序と非目標)

## 3. MVP後の機能採否

### 3.1 AI reviewを正式に採用するか

**決めること:** AI reviewをCoreへ昇格させるか。採否は、ルールのversion確認、過去問識別、送信・費用・保持方針の確認、review-only制約を満たした後に判断する。

**原文:** 「AI reviewはMVP後の独立した採用判断とする。少なくとも次を満たすまでCoreへ含めない。」

出典: [MVPスコープとCore契約 §14.2](design/mvp-scope-and-core-contracts.md#142-ai-review)、[Repair Lab 将来構想 §0](design/repair-lab-future-design.md#0-結論)

### 3.2 追加Review Backendを採用するか

**決めること:** BYOK Cloud API、Codex Agent Bridge、追加Backendごとの採否。追加Backendは需要、公式組み込み経路、利用規約、認証、料金、data retention、SDK依存、contract/security testで評価する。

**原文:** 「Phase 6: 追加Backend」「ユーザー需要を確認する。」「公式の組み込み経路、利用規約、認証方式、料金、data retention、SDK依存を評価する。」

出典: [Review Backend・LLM Provider選択・実行基盤設計 §11](design/llm-provider-design.md#11-段階的なreview-backend対応)

### 3.3 近接拡張の採否・優先順位

**決めること:** Windows、Go、Rust、Editor / Diff Viewer、catalog、opt-in自動checkpoint、既存履歴import、自動backup/restore、machine-readable出力を、Core安定後にどの順で採用するか。

**原文:** 「Core安定後に検討する近接拡張」

出典: [MVPスコープとCore契約 §14.1](design/mvp-scope-and-core-contracts.md#141-core安定後に検討する近接拡張)

### 3.4 CLI問題選択のインタラクション

**決めること:** Phase 3の`pick`で採るインタラクティブ方式と、fzf非導入環境でのfallback（番号選択・一覧のみ・`--no-interactive`）。

**原文:** 「fzfがない環境では、次のいずれかへフォールバックする。」

出典: [問題選択・カタログ設計 §7.3](design/problem-selection-and-catalog.md#73-fzf連携)

## 4. Cloud同期・データ共有

### 4.1 同期Adapterの採用

**決めること:** MVP後の同期BetaでTurso Syncを採用するか、公開を延期するか、Embedded Replicaまたは別Adapterを評価するか。

**原文:** 「試作と正式な設計判断が完了するまでは、同期機能を正式公開しない。Turso Syncの必須検証に合格した場合は第一候補として採用し、不合格の場合は同期公開を延期する。」

出典: [Turso移行互換性設計 §10](database/turso-migration-compatibility-design.md#10-同期方式の採用判断)、[Turso設計ガイド §0](database/turso-design-guide.md#0-結論)、[ローカル利用とCloud同期の段階的設計 §14](database/local-and-cloud-sync-design.md#14-段階的な実装計画)

### 4.2 マネージド同期（AlgoLoom Cloud）の提供

**決めること:** BYOCの利用状況・離脱理由、運用費、認証、法務、privacyを評価した上で、AlgoLoom Cloudを別サービスとして提供するか。

**原文:** 「初期OSS版の必須要件にはせず、BYOCの利用状況を確認した後に別サービスとして判断する。」

出典: [ローカル利用とCloud同期の段階的設計 §13](database/local-and-cloud-sync-design.md#13-byocと将来のマネージド同期)

### 4.3 Cloud-primary構成を再検討するか

**決めること:** Turso Syncが不適合な場合に、Embedded Replica + outbox以外（Supabase、Neon、Crunchy Bridge等）を比較対象に戻すか。その場合のローカル永続化・読み取り層。

**原文:** 「Supabase、Neon、Crunchy Bridge等は、将来Cloud-primary構成を再検討する場合の比較対象として残す。その場合も、Cloudへの直接問い合わせで履歴表示を遅くしないためのローカル永続化・読み取り層を別途設計する。」

出典: [DB候補比較メモ §5](database/db-comparison.md#5-あなたのケースでの推奨)

### 4.4 共同編集・削除を扱う場合の競合戦略

**決めること:** 利用規模や共同編集・削除・監査要件が変わった場合に、last-push-winsを維持するか、楽観ロック、競合UI、CRDT/OT、tombstone、不変ログなどを導入するか。

**原文:** 「次のいずれかが発生した場合は、last-push-winsを再評価する。」

出典: [Turso設計ガイド §5.5.3](database/turso-design-guide.md#553-再検討が必要になる条件)

## 5. AIレビューのルール適用

### 5.1 開催中AHCの専用プロファイル

**決めること:** 単発レビュー・自動再生成なし・自動選別なし・対象AHC個別ルール確認の条件を満たした後、AHC専用プロファイルを有効化するか。

**原文:** 「将来、次の条件を実装・確認できた場合に、AHC専用プロファイルを有効化する。」

出典: [AIレビュー安全設計 §3.2](distribution/ai-review-safety-design.md#32-ahcを初期版で保守的に扱う理由)

### 5.2 ADTのAIレビュー可否の外部確認

**決めること:** ADTで再利用中の過去問を「許可・注意表示」とする解釈の妥当性。

**原文:** 「初期版の『許可・注意表示』は公開情報を組み合わせたAlgoLoomの判断として扱い、公開前にAtCoderへ確認する。」

出典: [AIレビュー安全設計 §3.3](distribution/ai-review-safety-design.md#33-adtをabc系と同一扱いしない理由)、[配布方針ガイド §15](distribution/algoloom-distribution.md#15-atcoderへ確認したい事項)

### 5.3 AWC Beta・個別コンテストルールへの対応

**決めること:** AWC Betaの対象回で明示許可をどう確認・期限管理するか、個別コンテストルールをどのプロファイル・更新手順で扱うか。

**原文:** 「AWC Beta用プロファイルは対象回の明示許可を毎回確認する。」「AHC用プロファイルの解禁条件を検討する。」「個別コンテストルールへの対応方法を追加する。」

出典: [AIレビュー安全設計 §3.4](distribution/ai-review-safety-design.md#34-awc-betaは対象回の明示ルールを確認する)、[AIレビュー安全設計 §12](distribution/ai-review-safety-design.md#12-段階的な実装)

## 6. Repair Lab

### 6.1 機能の名称・操作・評価方法

**決めること:** Repair Labの正式名称、command、画面、採点方式。

**原文:** 「本書ではこの構想を仮に**Repair Lab**と呼ぶ。名称、command、画面、採点方式は確定事項ではない。」

出典: [Repair Lab 将来構想 §0](design/repair-lab-future-design.md#0-結論)

### 6.2 学習価値と共通UXへの統合

**決めること:** 仮説を先に記録する手順の学習価値、複数の正しいpatchを受け入れる判定方法、共通UXへ統合できるか、統合不能時に別applicationとするか。

**原文:** 「commandや画面を確定する前に、仮説を先に記録する手順が実際の学習に役立つか確認する。」

**原文:** 「複数の正しいpatchを受け入れる判定方法を検証する。」「共通UXを保てない場合は、AlgoLoomへ無理に追加せず別applicationとして扱う。」

出典: [Repair Lab 将来構想 §8](design/repair-lab-future-design.md#8-段階的な実装判断)、[Repair Lab 将来構想 §10](design/repair-lab-future-design.md#10-実装開始の判断条件)

### 6.3 教材生成・個別化・外部コードの採用

**決めること:** mutationとLLMを教材候補生成へ利用する範囲、傾向分析・個別練習候補に必要な件数と精度、利用者投稿教材のmoderation・license・削除手順。

**原文:** 「十分な件数と精度が得られた行動だけを、根拠付きの練習候補へ利用する。」

**原文:** 「利用者投稿教材 | moderation、license、悪意あるcode、品質保証、削除手順を設計した後の候補とする」

出典: [Repair Lab 将来構想 §4.1](design/repair-lab-future-design.md#41-教材の段階的な採用)、[Repair Lab 将来構想 §8](design/repair-lab-future-design.md#8-段階的な実装判断)

## 7. セキュリティ境界の拡張

### 7.1 未信頼code実行の隔離方式

**決めること:** 他人・共有・Cloud取得・LLM生成のcodeを実行対象に加える場合のOS sandbox、container、VM等の方式と、filesystem/network/process/CPU/memory等の制限。

**原文:** 「次の機能を追加する場合は、OS sandbox、container、VM等による隔離を必須候補として再評価する。」

**原文:** 「具体的なsandbox方式とthreat modelは、実装判断時に[セキュリティ設計ガイド](./security-design.md)へ追加する。」

出典: [セキュリティ設計ガイド §6.9](design/security-design.md#69-testによる任意コード実行とresource制限)、[Repair Lab 将来構想 §7](design/repair-lab-future-design.md#7-安全性)

### 7.2 Web UI・複数ユーザー化の安全設計

**決めること:** Web UIを追加する場合の認証・認可、ownership検証、XSS/CSP/security header、rate limit、session、監査ログ。

**原文:** 「Phase 3: 外部コード実行・Web UI追加時に必須」

出典: [セキュリティ設計ガイド §8](design/security-design.md#8-段階的な実装)

## 8. 配布・AtCoderとの外部確認

### 8.1 公開ベータ前にAtCoderへ確認する事項

**決めること:** 次の9項目への回答を得て、配布・アクセス・AIレビュー・表示の方針へ反映する。

**原文:**

1. 「ユーザー操作により、公開サンプル入出力を1問ずつローカル保存するCLIの配布可否」
2. 「ユーザー自身のセッションを使った提出補助の可否」
3. 「推奨されるアクセス間隔と再試行方法」
4. 「User-Agentへ記載すべき情報」
5. 「公開サンプルのローカルキャッシュ可否」
6. 「AIレビュー要求時に開催状況・種別・正規問題IDを照合し、ABC・ARC・AGCの開催中問題だけを拒否する設計で問題ないか」
7. 「ADTで再利用中の過去問をAIレビュー対象とする解釈で問題ないか」
8. 「READMEやPyPIで『AtCoder対応』と文章表記する場合の注意点」
9. 「無料OSS版と有料版で確認事項が異なるか」

出典: [配布方針ガイド §15](distribution/algoloom-distribution.md#15-atcoderへ確認したい事項)

### 8.2 商用・法人向け配布の可否と条件

**決めること:** OSS公開後に商用・法人向け配布へ進むか。進む場合のAtCoder確認、専門家への相談、利用規約、privacy policy、サポート範囲、採用試験・査定用途の禁止。

**原文:** 「OSS公開とは別の判断を行う。」「AtCoderから必要な確認を得る。」「利用規約、プライバシーポリシー、サポート範囲を整備する。」

出典: [配布方針ガイド §16](distribution/algoloom-distribution.md#16-段階的な配布計画)

## 確認時の注意

- この一覧にない将来機能でも、MVPの範囲を変更する場合は [MVPスコープとCore契約](design/mvp-scope-and-core-contracts.md) §16 の変更管理に従う。
- 外部サービスの規約、SDK、料金、配布wheelは変わり得る。各設計文書にあるとおり、実装開始時・リリース前に公式情報を再確認する。
