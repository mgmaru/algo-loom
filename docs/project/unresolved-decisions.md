# AlgoLoom 未決事項一覧

> 作成日: 2026年7月18日
>
> 状態確認日: 2026年7月18日
>
> 目的: リポジトリ内に分散している未決事項を、原文の判断を変えずに確認できるよう集約する。
>
> 範囲: 「未確定」「別途決定」「機能設計で決める」「採用判断」「外部への確認」が明記されている事項、および将来の追加時に再評価が必要と明記されている事項を対象にする。実装順序だけが書かれ、判断が保留されていない項目は含めない。

## 読み方

- 各項目の「原文」は出典からの抜粋であり、表記・条件・留保を変更していない。
- 「決めること」は原文から分かる確認対象を短く示すための案内であり、決定そのものではない。
- 「決定済みの内容」は、別の関連文書ですでに確定している範囲を示す。元の未決事項全体が解消していない場合は、残る未決範囲も併記する。
- MVPの範囲に関する正本は、引き続き [MVPスコープとCore契約](../product/mvp-scope-and-core-contracts.md) である。この一覧は正本を置き換えない。

### 状態の定義

| 状態 | 意味 |
|---|---|
| 決定済み | 現在の対象範囲では必要な判断が完了している |
| 一部決定済み | 境界または一部仕様は決定しているが、具体値・名称・実装方法等が残っている |
| 条件付き決定 | 現在の方針と再評価条件が決定しており、条件成立後の最終採否だけが残っている |
| 未決 | 採否または具体仕様を決める根拠・設計がまだ揃っていない |
| 外部確認待ち | AlgoLoom内の暫定方針はあるが、外部への問い合わせ結果が必要である |

### 状態確認の結果

| 状態 | 項目 |
|---|---|
| 決定済み | 1.3、2.4、4.4 |
| 一部決定済み | 1.1、1.2、1.4、1.5、1.6、2.2、2.3、3.2、3.4、4.2、5.3 |
| 条件付き決定 | 3.1、4.1、4.3、5.1、6.2、6.3、7.1、7.2、8.2 |
| 未決 | 2.1、3.3、6.1 |
| 外部確認待ち | 5.2、8.1 |

## 1. CLI・workspace・出力UX

### 1.1 日常commandの最終仕様

**状態:** 一部決定済み

**決定済みの内容:** 製品名は`AlgoLoom`、正式commandは`aloom`、互換commandは`algoloom`とする。`al`は利用者が任意に設定するaliasであり、AlgoLoomは自動登録しない。`loom`は使用しない。`get`、`test`、`checkpoint`、`submit`、`log`、`show`、`diff`、`export`の責任分割もMVP契約として定義されている。

**残る未決:** 各subcommand・引数・optionの最終名称、aliasとcompletionの詳細、各表示例を正式契約にする範囲。

**決めること:** subcommand名、引数、option、alias、および例示されたCLI案をどこまで正式契約にするか。

**原文:** 「本書および関連文書に記載するcommand名、引数、option、対話例、出力例は、明示的にCLI契約として確定したものを除き、機能と責任を説明するための暫定案とする。具体的なCLI設計は、上記原則と実際の利用検証を踏まえて別途決定する。」

出典: [プロジェクト草案 §3.4](../product/concept.md#34-標準ツールとの責任境界)、[MVPスコープとCore契約 §1.2](../product/mvp-scope-and-core-contracts.md#12-本書で決めないこと)

### 1.2 workspace metadataとcontext指定

**状態:** 一部決定済み

**決定済みの内容:** metadataは問題directoryとともに移動できる通常fileとし、問題ID、judge、schema version等の宣言的情報だけを持つ。絶対pathとdirectory名を恒久IDにしない。現在directory・明示source・親directoryから安全に一意な場合だけcontextを推測し、複数候補・欠損・矛盾時は暗黙に選ばない。

**残る未決:** file名・形式・Schema versionの具体値、探索上限・除外directory・規模上限、明示option名、引数省略条件。

**決めること:** metadata fileの名称・形式・Schema version、探索範囲・除外directory・規模上限、明示option名、引数を省略できる条件。

**原文:** 「metadata fileの名称と形式、探索上限、明示option名は機能設計で決める。」

**原文:** 「問題directoryと一緒に移動するmetadata fileの名称、形式、Schema version」「同じ問題を検出するworkspace探索範囲と、除外directory、規模上限」「workspace、問題、source contextを明示指定するoptionの具体名」「引数を省略できる条件」

出典: [MVPスコープとCore契約 §4.3](../product/mvp-scope-and-core-contracts.md#43-workspaceとcontext)、[ストレスフリーUX設計 §11](../quality/stress-free-ux-design.md#11-現時点で確定しないこと)

### 1.3 `get`の補助動作と途中失敗の回復

**状態:** 決定済み

**決定済みの内容:** 機能設計で、`get`は公式ページ確認、公開sample取得、template・test作成、ユーザーDB保存、公式問題ページのbrowser表示の順に処理すると決定している。再実行では編集済みsourceを上書きせず、完了段階を識別し、重複fileや破損contextを増やさない。browser起動だけの失敗はworkspace作成失敗にせず、既存directoryを勝手にmerge・rename・削除しない。

**決めること:** 問題ページをbrowserで開くか、templateをいつ作るか、取得の各途中状態からどのように再実行・回復するか。

**原文:** 「問題ページをbrowserで開くか、templateをいつ作るか等は機能設計で決める。」

**原文:** 「問題取得は、公式確認、sample取得、directory作成、template作成、DB保存、browser起動という複数の副作用を持つ。次の途中状態が未定義である。」

出典: [MVPスコープとCore契約 §5.2](../product/mvp-scope-and-core-contracts.md#52-冪等性と部分失敗)、[問題選択・カタログ設計 §6.3](../features/problem-selection-and-catalog.md#63-getの処理)、[ストレスフリーUX設計 §3.3](../quality/stress-free-ux-design.md#33-問題取得の途中失敗と再実行)

### 1.4 履歴・表示・診断の細部

**状態:** 一部決定済み

**決定済みの内容:** MVPの`show`はterminal上のplain text、`diff`はunified diffをfallbackとする。成功、部分成功、回復可能errorの情報順序は「主結果、追加失敗、影響を受けないもの、次の行動」とし、詳細情報は既定で大量表示せず確認方法を示す。

**残る未決:** 同一sourceへの重複操作の具体表示、色・spinner・table layout、進捗の見た目、診断command名、Viewer fallbackの表示量。

**決めること:** 同一sourceへの重複操作の見せ方、terminal表示の色・spinner・table layout、進捗表示、統一診断入口、Viewer fallbackの表示量。

**原文:** 「同じsourceに対する重複操作をどう見せるかは機能設計で決めるが、無断で別のsourceへ差し替えない。」

**原文:** 「terminal表示の色、spinner、table layout」

**原文:** 「進捗表示の具体的な見た目」「統一診断入口の具体名」「Viewer fallbackの具体的な表示量」

出典: [MVPスコープとCore契約 §7.3](../product/mvp-scope-and-core-contracts.md#73-checkpoint)、[MVPスコープとCore契約 §1.2](../product/mvp-scope-and-core-contracts.md#12-本書で決めないこと)、[ストレスフリーUX設計 §11](../quality/stress-free-ux-design.md#11-現時点で確定しないこと)

### 1.5 exit codeとmachine-readable出力

**状態:** 一部決定済み

**決定済みの内容:** success、利用者入力error、環境error、外部サービスerror、状態不明を区別する。通常出力と診断出力を分離し、timeout後の状態を示し、内部traceは既定表示しない。

**残る未決:** 各状態へ割り当てる具体的なexit codeとmachine-readable Schema。

**決めること:** exit codeの体系とmachine-readable出力の詳細。

**原文:** 「exit codeとmachine-readable出力の詳細は機能設計で決める。」

出典: [MVPスコープとCore契約 §4.6](../product/mvp-scope-and-core-contracts.md#46-出力とerror)

### 1.6 任意機能の具体的な導線

**状態:** 一部決定済み

**決定済みの内容:** AI Provider setupはProvider、Backend種別、endpoint・credential source、実行場所・課金、capability、model、送信範囲・送信先、同意、接続testの順とする。Cloud同期は通常commandで宣伝せず、複数端末利用を求めたとき、`sync`を実行したとき、または明示helpを開いたときだけ案内する。AtCoder認証は初回提出前に安全に状態確認でき、失敗時もlocal testと履歴閲覧を止めない。

**残る未決:** interactive UI、認証確認command、AI画面の最終的な階層表現、alias・completionの詳細。例示されたAI・sync command名もCLI最終設計までは暫定案である。

**決めること:** interactive UIの有無、AtCoder認証を確認する具体的操作、AI Provider選択画面の階層、Cloud同期を案内するタイミング、shell completionの詳細。

**原文:** 「interactive UIの有無」「AtCoder認証を確認する具体的な操作」「AI Provider選択画面の具体的な階層」「Cloud同期を案内するタイミング」「aliasとshell completionの詳細」

出典: [ストレスフリーUX設計 §11](../quality/stress-free-ux-design.md#11-現時点で確定しないこと)、[Review Backend設計 §6](../features/llm-provider-design.md#6-セットアップux)、[ローカル利用とCloud同期の段階的設計 §8](../features/local-and-cloud-sync-design.md#8-cli設計)

## 2. Core実装・性能パラメータ

### 2.1 実装技術の最終形

**状態:** 未決

**現在の確定境界:** 実装言語はPython、MVPのローカルDBは標準`sqlite3`である。ただし、この項目に挙げた内部実装の具体仕様は決定されていない。

**決めること:** CLI framework、dependency injection手法、class・module・table・column名、metadata/export fileの最終形式。

**原文:** 「CLI frameworkやdependency injection手法」「class、module、table、columnの最終名称」「metadata fileとexport fileの最終形式」

出典: [MVPスコープとCore契約 §1.2](../product/mvp-scope-and-core-contracts.md#12-本書で決めないこと)

### 2.2 言語profileとuser-level実行設定

**状態:** 一部決定済み

**決定済みの内容:** MVPはC++とPythonに限定し、標準compile/run定義を組み込みprofileとして提供する。workspace metadataに実行command、credential、endpointを持たせず、workspaceから任意commandを定義させない。processはargv配列で起動し、不要なsecretを子processへ渡さない。

**残る未決:** Go・Rust等の追加時期、user-level設定による拡張子・template・実行file・引数変更を採用するか、およびその具体契約。

**決めること:** C++・Python以外の対応時期、およびuser-level設定から拡張子・template・compile/run commandを変更可能にするかと、その安全な契約。

**原文:** 「将来、user-level設定から拡張子、template、compile/run commandを変更できる構成を検討する。」

出典: [プロジェクト草案 §4](../product/concept.md#4-解答言語と設定管理)、[MVPスコープとCore契約 §14.1](../product/mvp-scope-and-core-contracts.md#141-core安定後に検討する近接拡張)

### 2.3 実行・保持・性能の具体値

**状態:** 一部決定済み

**決定済みの内容:** compileとrunのtimeoutを分け、stdout/stderrに上限を設け、timeout時はprocess groupを終了する。DB lockは有限時間とし、外部通信ではconnection・request・polling全体の上限を分ける。初期性能目標として`log` p95 100ms、`show` p95 150ms、`diff` p95 250ms等の計測仮説が定義されている。

**残る未決:** 実測後に固定するtimeout・出力量・保持期間・resource上限・SLO、対応OSごとの強制memory/process制限、compiler/runtime version matrix。

**決めること:** timeout、出力量、保持期間、compile/runのresource上限、性能SLOを固定する値と計測対象環境。

**原文:** 「timeout、出力量、保持期間等の具体値」「compilerとruntimeの細かなversion matrix」

**原文:** 「数値は対応OS、DB規模、sample数、Providerにより変わるため、次は実装開始時の仮説である。固定の約束にする前に、代表的な端末と履歴件数でp50/p95を計測する。」

出典: [MVPスコープとCore契約 §1.2](../product/mvp-scope-and-core-contracts.md#12-本書で決めないこと)、[パフォーマンスと待機体験の設計 §5](../quality/performance-and-waiting-design.md#5-性能待機の初期契約)

### 2.4 DB保守の実行規約

**状態:** 決定済み

**決定済みの内容:** transactionは短くし、競合時は有限時間だけ待機または安全に再試行する。backup/exportは明示操作に分離し、通常閲覧時に実行しない。migration中は通常commandを停止し、完了またはrollback後に再開する。checkpointを閲覧経路で実行しない。lock上限の具体秒数だけは2.3の計測対象として残る。

**決めること:** DB lock、migration、checkpoint、backupをいつ・どのような排他と回復表示で実行するか。

**原文:** 「DB lock、migration、checkpoint、backupの実行規約を確定する。」

出典: [パフォーマンスと待機体験の設計 §7](../quality/performance-and-waiting-design.md#7-実装順序と非目標)

## 3. MVP後の機能採否

### 3.1 AI reviewを正式に採用するか

**状態:** 条件付き決定

**決定済みの内容:** AI reviewはMVPへ含めず、Core完了後の独立した採用判断とする。安全判定、過去問識別、送信・費用・保持方針の明示、Coreからの独立、sourceを自動編集・実行・提出しない権限制約をすべて満たすまで昇格させない。

**残る判断:** 条件を実装・検証した後に正式採用するか。

**決めること:** AI reviewをCoreへ昇格させるか。採否は、ルールのversion確認、過去問識別、送信・費用・保持方針の確認、review-only制約を満たした後に判断する。

**原文:** 「AI reviewはMVP後の独立した採用判断とする。少なくとも次を満たすまでCoreへ含めない。」

出典: [MVPスコープとCore契約 §14.2](../product/mvp-scope-and-core-contracts.md#142-ai-review)、[Repair Lab 将来構想 §0](../future/repair-lab-future-design.md#0-結論)

### 3.2 追加Review Backendを採用するか

**状態:** 一部決定済み

**決定済みの内容:** 初期local Model API候補はOllamaとLM Studioとする。BYOK Cloud APIは各Providerを個別Adapterとして評価する。Codex Agent Bridgeは公式app-server、外部runtime所有の認証、一時directory、tool禁止、session破棄、response再検証を満たす場合だけ導入する。Claude Code・Gemini CLIのsubscription credentialは、第三者組み込みの明示許可があるまで再利用しない。

**残る未決:** 各Cloud API・Agent Bridgeの実検証後の採否と、Phase 6以降の追加Backend。

**決めること:** BYOK Cloud API、Codex Agent Bridge、追加Backendごとの採否。追加Backendは需要、公式組み込み経路、利用規約、認証、料金、data retention、SDK依存、contract/security testで評価する。

**原文:** 「Phase 6: 追加Backend」「ユーザー需要を確認する。」「公式の組み込み経路、利用規約、認証方式、料金、data retention、SDK依存を評価する。」

出典: [Review Backend・LLM Provider選択・実行基盤設計 §11](../features/llm-provider-design.md#11-段階的なreview-backend対応)

### 3.3 近接拡張の採否・優先順位

**状態:** 未決

**決定済みの境界:** すべてMVP対象外であり、追加してもMVPのinstall、日常command、offline履歴を複雑にしないことは決定している。

**残る未決:** 各候補を実際に採用するか、および候補間の優先順位。

**決めること:** Windows、Go、Rust、Editor / Diff Viewer、catalog、opt-in自動checkpoint、既存履歴import、自動backup/restore、machine-readable出力を、Core安定後にどの順で採用するか。

**原文:** 「Core安定後に検討する近接拡張」

出典: [MVPスコープとCore契約 §14.1](../product/mvp-scope-and-core-contracts.md#141-core安定後に検討する近接拡張)

### 3.4 CLI問題選択のインタラクション

**状態:** 一部決定済み

**決定済みの内容:** 初期版の主経路はAtCoder Problemsで発見し、`get`で開始する。Phase 3の`pick`も独自のworkspace作成処理を持たず、選択後に共通`get`を呼ぶ。local statusはAtCoder全体の提出状態と明確に区別する。

**残る未決:** `pick`を正式採用するか、インタラクティブUIの実装方式、fzfがない場合のfallback選択。

**決めること:** Phase 3の`pick`で採るインタラクティブ方式と、fzf非導入環境でのfallback（番号選択・一覧のみ・`--no-interactive`）。

**原文:** 「fzfがない環境では、次のいずれかへフォールバックする。」

出典: [問題選択・カタログ設計 §7.3](../features/problem-selection-and-catalog.md#73-fzf連携)

## 4. Cloud同期・データ共有

### 4.1 同期Adapterの採用

**状態:** 条件付き決定

**決定済みの内容:** Cloud同期はMVPへ含めない。MVP後はTurso Syncを第一候補として同一論理Schema・Adapter契約で試作する。必須検証に合格すれば同期Beta候補へ採用し、不合格なら公開を延期する。ローカル履歴をCloudなしで参照できない方式は採用しない。

**残る判断:** SDK、耐久性、競合、強制終了、bootstrap、wheel導入の実測後にTurso Syncを正式採用するか。不合格かつ実需がある場合だけEmbedded Replica + outboxまたは別Adapterを評価する。

**決めること:** MVP後の同期BetaでTurso Syncを採用するか、公開を延期するか、Embedded Replicaまたは別Adapterを評価するか。

**原文:** 「試作と正式な設計判断が完了するまでは、同期機能を正式公開しない。Turso Syncの必須検証に合格した場合は第一候補として採用し、不合格の場合は同期公開を延期する。」

出典: [Turso移行互換性設計 §10](../integrations/turso-migration-compatibility-design.md#10-同期方式の採用判断)、[Turso設計ガイド §0](../integrations/turso-design-guide.md#0-結論)、[ローカル利用とCloud同期の段階的設計 §14](../features/local-and-cloud-sync-design.md#14-段階的な実装計画)

### 4.2 マネージド同期（AlgoLoom Cloud）の提供

**状態:** 一部決定済み

**決定済みの内容:** 初期OSS版の同期方式はユーザー所有のTursoを使うBYOCとし、AlgoLoom Cloudは必須要件にしない。Cloud同期自体もローカル利用へ追加する任意機能で、既定OFFとする。

**残る未決:** BYOC利用状況と離脱理由を確認した後、AlgoLoom Cloudを別サービスとして提供するか。

**決めること:** BYOCの利用状況・離脱理由、運用費、認証、法務、privacyを評価した上で、AlgoLoom Cloudを別サービスとして提供するか。

**原文:** 「初期OSS版の必須要件にはせず、BYOCの利用状況を確認した後に別サービスとして判断する。」

出典: [ローカル利用とCloud同期の段階的設計 §13](../features/local-and-cloud-sync-design.md#13-byocと将来のマネージド同期)

### 4.3 Cloud-primary構成を再検討するか

**状態:** 条件付き決定

**決定済みの内容:** 評価順は標準SQLiteのCore、Turso Sync、必要時のEmbedded Replica + outboxとする。Supabase、Neon、Crunchy Bridge等は現在の採用候補ではなく、将来Cloud-primary構成を再検討する場合だけ比較対象へ戻す。どの場合もローカル永続化・読み取り契約を維持する。

**残る判断:** Turso系の候補が条件を満たさず、Cloud-primaryを再検討する必要が生じた場合の方式選択とローカル層の設計。

**決めること:** Turso Syncが不適合な場合に、Embedded Replica + outbox以外（Supabase、Neon、Crunchy Bridge等）を比較対象に戻すか。その場合のローカル永続化・読み取り層。

**原文:** 「Supabase、Neon、Crunchy Bridge等は、将来Cloud-primary構成を再検討する場合の比較対象として残す。その場合も、Cloudへの直接問い合わせで履歴表示を遅くしないためのローカル永続化・読み取り層を別途設計する。」

出典: [DB候補比較メモ §5](../research/db-comparison.md#5-あなたのケースでの推奨)

### 4.4 共同編集・削除を扱う場合の競合戦略

**状態:** 決定済み

**決定済みの内容:** 現在想定する個人または調整可能な少人数、同一データを複数端末で同時編集しない、追記中心という前提ではlast-push-winsを正式に許容する。手動merge UIやfield単位の複雑な競合解決は実装しない。大人数、共同編集、リアルタイム編集、削除競合、監査要件が生じた場合だけ再評価する。

**決めること:** 利用規模や共同編集・削除・監査要件が変わった場合に、last-push-winsを維持するか、楽観ロック、競合UI、CRDT/OT、tombstone、不変ログなどを導入するか。

**原文:** 「次のいずれかが発生した場合は、last-push-winsを再評価する。」

出典: [Turso設計ガイド §5.5.3](../integrations/turso-design-guide.md#553-再検討が必要になる条件)

## 5. AIレビューのルール適用

### 5.1 開催中AHCの専用プロファイル

**状態:** 条件付き決定

**決定済みの内容:** 初期版では開催中AHCのAI reviewを拒否する。将来プロファイルを検討できる条件も、1回の明示操作につき1回、自動再生成なし、複数候補の自動評価・選別なし、対象AHCの個別ルール確認、と定義されている。条件を満たすまでは拒否を維持する。

**残る判断:** 条件を実装・確認した後にAHC専用プロファイルを有効化するか。

**決めること:** 単発レビュー・自動再生成なし・自動選別なし・対象AHC個別ルール確認の条件を満たした後、AHC専用プロファイルを有効化するか。

**原文:** 「将来、次の条件を実装・確認できた場合に、AHC専用プロファイルを有効化する。」

出典: [AIレビュー安全設計 §3.2](../features/ai-review-safety-design.md#32-ahcを初期版で保守的に扱う理由)

### 5.2 ADTのAIレビュー可否の外部確認

**状態:** 外部確認待ち

**決定済みの内容:** AlgoLoom内の初期判定は、ADTで再利用中の過去問を「許可・注意表示」とする。コンテスト種別を特定してから正規問題IDを照合し、AIなしで参加したい利用者には`contest_mode`を案内する。

**残る確認:** この解釈で問題ないかを公開前にAtCoderへ問い合わせる。リポジトリ内に回答済みの記録はない。

**決めること:** ADTで再利用中の過去問を「許可・注意表示」とする解釈の妥当性。

**原文:** 「初期版の『許可・注意表示』は公開情報を組み合わせたAlgoLoomの判断として扱い、公開前にAtCoderへ確認する。」

出典: [AIレビュー安全設計 §3.3](../features/ai-review-safety-design.md#33-adtをabc系と同一扱いしない理由)、[配布方針ガイド §15](../operations/algoloom-distribution.md#15-atcoderへ確認したい事項)

### 5.3 AWC Beta・個別コンテストルールへの対応

**状態:** 一部決定済み

**決定済みの内容:** AWC Betaは対象回の問題ID、Beta種別、AI利用の明示許可、有効なcache期限をすべて確認できた場合だけ注意表示付きで許可し、それ以外はfail closedとする。対象回の明示ルールは毎回確認する。

**残る未決:** AHC解禁後を含む個別コンテストルールをどの更新・version管理方法で実装するか。

**決めること:** AWC Betaの対象回で明示許可をどう確認・期限管理するか、個別コンテストルールをどのプロファイル・更新手順で扱うか。

**原文:** 「AWC Beta用プロファイルは対象回の明示許可を毎回確認する。」「AHC用プロファイルの解禁条件を検討する。」「個別コンテストルールへの対応方法を追加する。」

出典: [AIレビュー安全設計 §3.4](../features/ai-review-safety-design.md#34-awc-betaは対象回の明示ルールを確認する)、[AIレビュー安全設計 §12](../features/ai-review-safety-design.md#12-段階的な実装)

## 6. Repair Lab

### 6.1 機能の名称・操作・評価方法

**状態:** 未決

**決定済みの境界:** `Repair Lab`は仮称であり、AtCoder Coreとは別の恒常modeや専用command体系を作らず、patch速度や想定解との文字列一致だけで評価しない。

**残る未決:** 正式名称、既存commandへ統合する具体的操作、画面、採点方式。

**決めること:** Repair Labの正式名称、command、画面、採点方式。

**原文:** 「本書ではこの構想を仮に**Repair Lab**と呼ぶ。名称、command、画面、採点方式は確定事項ではない。」

出典: [Repair Lab 将来構想 §0](../future/repair-lab-future-design.md#0-結論)

### 6.2 学習価値と共通UXへの統合

**状態:** 条件付き決定

**決定済みの内容:** 正式設計へ進む前に、手作り教材で仮説・根拠・予測・検証の学習価値を確認する。複数の正しいpatchを受け入れ、LLMを唯一の正しさの根拠にしない。AtCoder Coreと同じ基本導線へ統合できない場合は、AlgoLoomへ追加せず別applicationとして扱う。

**残る判断:** 小規模検証で学習価値と共通UXへの統合可能性を確認できた後に正式機能化するか。

**決めること:** 仮説を先に記録する手順の学習価値、複数の正しいpatchを受け入れる判定方法、共通UXへ統合できるか、統合不能時に別applicationとするか。

**原文:** 「commandや画面を確定する前に、仮説を先に記録する手順が実際の学習に役立つか確認する。」

**原文:** 「複数の正しいpatchを受け入れる判定方法を検証する。」「共通UXを保てない場合は、AlgoLoomへ無理に追加せず別applicationとして扱う。」

出典: [Repair Lab 将来構想 §8](../future/repair-lab-future-design.md#8-段階的な実装判断)、[Repair Lab 将来構想 §10](../future/repair-lab-future-design.md#10-実装開始の判断条件)

### 6.3 教材生成・個別化・外部コードの採用

**状態:** 条件付き決定

**決定済みの内容:** 初期検証では手作りの検証済み教材を優先する。mutationはtest oracleで期待どおりの失敗を確認できる場合、LLM生成codeは人間または決定的な検証工程を通した場合、第三者codeはlicense・帰属・privacy・再配布条件を確認できる場合だけ利用する。利用者投稿教材はmoderation等の設計後の候補とする。

**残る判断:** 各教材種別の検証結果を踏まえた採用範囲、傾向分析に必要な件数・精度の具体基準、利用者投稿機能を採用するか。

**決めること:** mutationとLLMを教材候補生成へ利用する範囲、傾向分析・個別練習候補に必要な件数と精度、利用者投稿教材のmoderation・license・削除手順。

**原文:** 「十分な件数と精度が得られた行動だけを、根拠付きの練習候補へ利用する。」

**原文:** 「利用者投稿教材 | moderation、license、悪意あるcode、品質保証、削除手順を設計した後の候補とする」

出典: [Repair Lab 将来構想 §4.1](../future/repair-lab-future-design.md#41-教材の段階的な採用)、[Repair Lab 将来構想 §8](../future/repair-lab-future-design.md#8-段階的な実装判断)

## 7. セキュリティ境界の拡張

### 7.1 未信頼code実行の隔離方式

**状態:** 条件付き決定

**決定済みの内容:** MVPは利用者自身のcodeだけを対象とし、完全sandboxは必須にしない。ただしcompile/run timeout、出力量上限、process group終了、secretを除いた環境等はMVPで必須とする。他人・共有・Cloud取得・LLM生成codeを実行対象にする場合は、OS sandbox、containerまたはVMによる隔離とresource制限を必須候補として再評価する。

**残る判断:** 未信頼code実行を採用するときの具体的なsandbox方式、threat model、対応OSと保証範囲。

**決めること:** 他人・共有・Cloud取得・LLM生成のcodeを実行対象に加える場合のOS sandbox、container、VM等の方式と、filesystem/network/process/CPU/memory等の制限。

**原文:** 「次の機能を追加する場合は、OS sandbox、container、VM等による隔離を必須候補として再評価する。」

**原文:** 「具体的なsandbox方式とthreat modelは、実装判断時に[セキュリティ設計ガイド](../quality/security-design.md)へ追加する。」

出典: [セキュリティ設計ガイド §6.9](../quality/security-design.md#69-testによる任意コード実行とresource制限)、[Repair Lab 将来構想 §7](../future/repair-lab-future-design.md#7-安全性)

### 7.2 Web UI・複数ユーザー化の安全設計

**状態:** 条件付き決定

**決定済みの内容:** Web UIはMVP対象外である。追加時に認証・認可とownership検証、保存型XSS対策、CSP/security header、request size、rate limit、session管理、複数ユーザー向け監査logを必須とすることは決定している。

**残る判断:** Web UI自体を採用するか、および採用時の具体的な認証基盤、policy、制限値、実装方式。

**決めること:** Web UIを追加する場合の認証・認可、ownership検証、XSS/CSP/security header、rate limit、session、監査ログ。

**原文:** 「Phase 3: 外部コード実行・Web UI追加時に必須」

出典: [セキュリティ設計ガイド §8](../quality/security-design.md#8-段階的な実装)

## 8. 配布・AtCoderとの外部確認

### 8.1 公開ベータ前にAtCoderへ確認する事項

**状態:** 外部確認待ち

**決定済みの内容:** 問い合わせる9項目と、リクエスト数・保存内容・認証方式・AI制限を具体的に説明して問い合わせる方針は決定している。限定公開Beta前に問い合わせる。

**残る確認:** 9項目に対するAtCoderの回答。リポジトリ内に問い合わせ済み・回答済みの記録はない。

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

出典: [配布方針ガイド §15](../operations/algoloom-distribution.md#15-atcoderへ確認したい事項)

### 8.2 商用・法人向け配布の可否と条件

**状態:** 条件付き決定

**決定済みの内容:** 現在は個人利用からOSS公開までを先に検証し、商用・法人向けはOSS公開とは別判断とする。進む場合は採用試験・査定用途を禁止し、AtCoderへの確認、専門家への相談、利用規約・privacy policy・support範囲の整備を必須とする。

**残る判断:** OSS公開後に商用・法人向けへ進むか。

**決めること:** OSS公開後に商用・法人向け配布へ進むか。進む場合のAtCoder確認、専門家への相談、利用規約、privacy policy、サポート範囲、採用試験・査定用途の禁止。

**原文:** 「OSS公開とは別の判断を行う。」「AtCoderから必要な確認を得る。」「利用規約、プライバシーポリシー、サポート範囲を整備する。」

出典: [配布方針ガイド §16](../operations/algoloom-distribution.md#16-段階的な配布計画)

## 確認時の注意

- この一覧にない将来機能でも、MVPの範囲を変更する場合は [MVPスコープとCore契約](../product/mvp-scope-and-core-contracts.md) §16 の変更管理に従う。
- 外部サービスの規約、SDK、料金、配布wheelは変わり得る。各設計文書にあるとおり、実装開始時・リリース前に公式情報を再確認する。
