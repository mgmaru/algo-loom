---
status: normative
applies_to: MVP
derived_from:
  - ../docs/architecture/core-contracts.md
  - ../docs/architecture/language-and-platform-portability.md
  - ../docs/quality/security-design.md
  - ../docs/quality/stress-free-ux-design.md
---

# AlgoLoom Core開発契約

## 1. 本書の役割

本書は、Coreの実装が機能横断で満たす不変条件を、実装とtestで参照できる単位に整理します。完全な定義と設計理由は[Core契約](../docs/architecture/core-contracts.md)を正とし、個別機能の詳細は各設計文書を参照してください。

## 2. 共通契約

- 任意機能を設定しなくてもCoreを利用できなければなりません。
- 外部提出、source送信、削除等を、利用者の明示操作なしに行ってはなりません。
- 同じ操作の再実行で、既存source、sample、metadata、履歴または外部提出を重複・破壊してはなりません。
- 部分失敗時は、成功済みの事実と保持されたデータを先に示し、未完了状態と次の安全な操作を示さなければなりません。
- ローカルで完了できる主目的を、無関係なnetwork、保守処理または任意機能の完了待ちにしてはなりません。
- 外部通信またはcode実行は無期限に待たず、timeoutまたは取消後の状態確認と再試行経路を持たなければなりません。

## 3. データの権威

| データ | 権威 |
|---|---|
| 編集中のsource | workspace上の保存済み通常file |
| 問題ID、問題ページ、公開sampleの取得元 | AtCoder |
| submission ID、judge判定、judge execution timeとmemory | AtCoder |
| AlgoLoom導入後のsnapshotと操作履歴 | ローカルAlgoLoom DB |
| SolveAttempt、FocusInterval、milestone | 明示操作とCore eventを保存するローカルAlgoLoom DB |
| credentialとsession | 利用者または外部toolの適切なsecret store |
| 問題・解説・他ユーザーcodeの本文 | AtCoder公式サイトと各権利者。AlgoLoomへ保存しない |

workspaceの移動、renameまたは削除を、保存済み履歴の削除として扱いません。

## 4. Workspaceとcontext

- workspaceと問題directoryは通常のfilesystem操作で移動・rename可能とします。
- 絶対path、directory名、生成suffixを、問題、checkout、SolveAttemptまたは履歴の恒久IDにしません。
- contextは現在directory、明示source、親directoryのmetadataから、安全に一意な場合だけ解決します。
- 複数候補、欠損または矛盾がある場合は暗黙に一つを選びません。
- context不明は、test実行またはAtCoderへの提出等の作用前に検出します。
- 同じ問題の別言語またはfreshな解き直しには、別checkoutを既定とします。
- problem checkoutとSolveAttemptを同一概念または恒久的な1対1関係にしません。
- Editor固有fileを生成・要求・実行設定として解釈しません。
- 各command開始時にfilesystemとmetadataからcontextを再検証し、file watcherを正しさの条件にしません。

## 5. 設定とprocess

- workspace metadataは宣言的な問題情報に限定し、実行command、credentialまたは外部endpointを含めません。
- MVPではworkspaceから任意のcompile/run commandを定義できるようにしません。
- `LanguageProfile`はshell文字列ではなく、argv、working directory、source、artifact、timeout区分等からなるBuildPlanまたはRunPlanを返します。
- processは`HostPlatform`を介してargv配列で起動し、pathや利用者入力をshell commandへ連結しません。
- 子processにはAtCoder sessionや不要な環境変数を渡しません。
- success、compile error、runtime error、timeout、出力量超過、取消をOS間で共通分類へ正規化します。
- user preferenceはCoreの意味、状態遷移、データの権威、不変性、安全性、privacyまたは外部作用への同意を変更できません。

## 6. 問題取得と外部資料

- 一件ずつ明示された正規問題IDまたは公式URLを対象とし、一括・background crawlを行いません。
- local test用には、公開sampleだけを取得します。
- 同じ場所への再取得で編集済みsourceを上書きしません。
- directory、metadata、sample、template、DB保存の完了段階を識別し、途中失敗後の再実行で破損や重複を増やしません。
- freshな解き直しは既存sourceを変更せず、新しいcheckoutとSolveAttemptを作ります。
- 問題・解説ページはdefault browserへ委譲し、本文をprocess、DB、cache、temp、logまたはexportへ取り込みません。
- spoiler-sensitiveな資料は終了状態を確認し、未ACの場合は明示確認後にだけ開きます。終了状態を確認できない場合は開きません。
- browser起動失敗によって、workspace、test、提出または履歴の成功状態を変更しません。

## 7. Local test

- `test`が保証するのは、取得済み公開sampleに対するlocal実行結果であり、AtCoder上のACではありません。
- compile、sample実行、比較を別の段階として扱います。
- compile error、runtime error、timeout、出力量超過、signal終了、不一致を区別します。
- compileとrunには別々のtimeoutを設け、stdout、stderr、生成file、process数等へ妥当な上限を設けます。
- timeoutまたは取消時は、対応するprocess treeを終了します。
- compile durationとsampleごとのlocal run durationは、対象と単位を明示します。
- local値とjudge値を同一環境のbenchmarkとして比較しません。取得不能な観測値を`0`で補いません。
- 未信頼codeを実行対象へ加える前に、filesystem、network、process、CPU、memory等の隔離を再設計します。

## 8. SolveAttempt、履歴、snapshot

- 時間計測は明示的に開始したSolveAttemptだけを対象とします。`get`、`test`またはfile保存を暗黙の開始にしません。
- active、paused、completed、abandonedを区別し、状態遷移を冪等にします。
- 別のSolveAttemptを開始するとき、既存attemptを暗黙にpause、終了、放棄またはmergeしません。
- active durationは妥当なFocusIntervalの合計とし、wall elapsedやprocess durationと区別します。
- 時計の後退、極端な飛躍または欠損intervalを、推測した正常値や負のdurationとして保存しません。
- 最初のsample通過、初回提出、初ACを別のmilestoneとし、それぞれの観測時点に対応するactive durationを保持します。
- checkpointは利用者の明示操作でのみ作り、作成時に外部通信しません。
- snapshotは保存後にsource本文を上書きせず、正確なsource bytesからhashを計算します。
- 提出snapshotは外部送信に使ったsource bytesと一致しなければなりません。
- 履歴表示はlocal DBから行い、checkpoint、提出待ち、提出済み、判定待ち、最終判定を混同しません。
- `show`はsnapshotを読み取り専用で表示し、`diff`は比較対象を確認可能にします。

## 9. 提出

AtCoderへの送信とlocal DBのcommitは原子的にできないため、提出を回復可能な状態遷移として実装します。

外部送信前に、一意なoperation ID、問題、judge、account identity、言語とjudge固有言語、正確なsource snapshotとhash、作成時刻、operation stateを耐久保存します。

少なくとも次の状態を意味として区別します。実際の識別子名は実装設計で変更できます。

```text
PREPARED
  ├─ 外部送信前の失敗 → FAILED_BEFORE_SEND
  └─ 送信開始 → SEND_STARTED
                    ├─ ID取得 → REMOTE_ACCEPTED → VERDICT_PENDING → FINAL
                    └─ 応答不明 → REMOTE_STATUS_UNKNOWN
```

- `SEND_STARTED`以降は外部へ到達した可能性があるため、無条件に再送しません。
- submission ID取得後は、そのIDの確認によって回復し、codeを再提出しません。
- 判定polling timeoutを提出失敗として扱いません。
- 状態が不明で一意に回復できない場合は、公式提出一覧と利用者確認へ委ねます。
- AtCoder提出、local保存、判定確認を別々の結果として表示します。
- account identityを確認できない場合、または以前と異なるaccountを検出した場合は送信前に停止します。
- verdictは取得時刻付きの観測として保存し、欠損値を`0`または推測値で補いません。

## 10. 保存、migration、export

- MVPの履歴保存は、Python標準`sqlite3`によるlocal SQLiteを既定かつ唯一の方式とします。
- 一つの業務操作に必要なDB更新は、明示transactionでcommitまたはrollbackします。
- foreign key、unique constraint、schema versionを有効にします。
- migration前に復旧可能なlocal退避を作り、失敗時に旧Schemaを破壊したまま通常起動しません。
- 未知の将来Schemaを自動downgradeしません。
- exportにはformat version、作成時刻、AlgoLoom versionと、MVP履歴の関連を欠損なく含めます。
- exportにはcredential、secret、不要な絶対path、外部コンテンツ本文を含めません。
- export中のDB更新による不整合を防ぎ、AlgoLoomなしでもsourceを回収可能にします。

## 11. 内部境界

最低限、次の責任を直接結合しません。

| 境界 | 責任 |
|---|---|
| CLI / Application | 入出力と業務状態遷移を分離する |
| `JudgeAdapter` | AtCoder固有の取得、認証、提出、判定確認を閉じ込める |
| `ReferenceLinkProvider` | 外部本文を取得せず、公式URLを構成する |
| `BrowserLauncher` | OSへのURL起動要求とページ表示結果を分ける |
| `HistoryStore` | transaction、履歴状態、queryをSQLite詳細から分ける |
| `LanguageProfile` | 言語固有のtemplate、診断、BuildPlan、RunPlanを閉じ込める |
| `HostPlatform` / `ProcessRunner` | process、timeout、出力上限、path等のOS差異を閉じ込める |
| workspace context | path探索とmetadata検証を各commandから分ける |

MVPで実装しないAI、Cloud同期、Web API等の型、SDK、設定、状態をCoreへ持ち込みません。

## 12. Securityとprivacy

- SQL値はparameter bindし、動的識別子は許可リストで制限します。
- path、problem ID、language、file type、sizeを作用前に検証します。
- atomic write、安全な一時directory、適切なpermission、cleanupを実装します。
- 外部文字列、compiler出力、sourceをterminalへ出す前に、制御文字とmarkupを安全に扱います。
- credential、source、raw HTTP header、raw errorを通常logへ出しません。
- 自動telemetry、crash report送信、Cloud同期をMVP Coreへ追加しません。
- 問題取得と提出にはrequest timeout、上限付きretry、適切な間隔を設けます。
- hidden test取得、一括crawl、CAPTCHA回避、session共有を実装しません。

## 13. 契約testの最低範囲

- `get`、freshな解き直し、状態遷移の各段階における強制終了と安全な再実行
- source、metadata、path、外部文字列への境界値と攻撃的入力
- 4言語のbuild/run計画と3 OSのprocess分類、timeout、process tree終了
- DB transaction、constraint、lock、disk full、migration失敗、未知Schema
- 提出前保存失敗、送信直後の通信断、判定timeout、状態不明からの回復
- snapshot bytesと送信bytesのhash一致、不変性、exportからのsource回収
- credential、外部コンテンツ、不要なpathがlog、DB、export、配布物へ混入しないこと
- AI、Cloud、Viewerを設定しない状態でCore主要導線を完了できること
