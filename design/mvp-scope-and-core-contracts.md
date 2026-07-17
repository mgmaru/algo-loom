# AlgoLoom MVPスコープとCore契約

> 対象: AlgoLoomの最初の利用可能な製品範囲と、機能設計・データ設計・実装が共通して守る契約
>
> 状態: MVPの正本。MVPの対象範囲について他文書と矛盾する場合は本書を優先する
>
> 決定日: 2026年7月18日
>
> 関連文書:
> - [プロジェクト草案](../concept.md)
> - [ストレスフリーUX設計](./stress-free-ux-design.md)
> - [セキュリティ設計ガイド](./security-design.md)
> - [パフォーマンスと待機体験の設計](./performance-and-waiting-design.md)
> - [ローカル利用とCloud同期の段階的設計](../database/local-and-cloud-sync-design.md)
> - [配布方針ガイド](../distribution/algoloom-distribution.md)

---

## 0. 結論

AlgoLoomのMVPは、**AtCoderの終了済み過去問を、自分のEditorで解き、公開sampleで確認し、自分のアカウントで提出し、その試行をローカルの学習履歴として振り返れるCLI**とする。

MVPで証明する価値は、機能の多さではない。

> 問題を始め、書き、試し、提出し、過去の実装へ戻る流れを、EditorやCloudへ利用者を囲い込まず、壊れにくい一つの導線として提供できること

MVPにはAI review、Cloud同期、問題推薦、TUI、Repair Labを含めない。これらの将来機能を考慮して交換可能な境界は保つが、未実装機能のためにCoreの導入、日常操作、データモデルを複雑にしない。

MVPの主要導線は次とする。名称は機能設計で変更できるが、責任の分割は維持する。

```text
問題を選ぶ
  → get
  → 任意のEditorで書く
  → test
  → 必要なら明示checkpoint
  → submit
  → log / show / diffで振り返る
  → exportで学習資産を持ち出す
```

---

## 1. 本書の責任

### 1.1. 本書で決めること

- MVPへ含める能力と含めない能力
- 最初に価値を届ける利用者と利用条件
- workspace、設定、履歴、提出、外部通信のCore契約
- 機能設計が越えてはならない安全性とデータ完全性の境界
- MVPの実装開始条件と完了条件
- 将来機能をMVPへ昇格させる条件

### 1.2. 本書で決めないこと

- 最終的なsubcommand名、option名、alias
- CLI frameworkやdependency injection手法
- class、module、table、columnの最終名称
- metadata fileとexport fileの最終形式
- terminal表示の色、spinner、table layout
- timeout、出力量、保持期間等の具体値
- compilerとruntimeの細かなversion matrix

これらは機能設計または実装設計で決める。ただし、本書の契約を弱めたり、MVPの対象範囲を暗黙に広げたりしてはならない。

### 1.3. 用語

| 用語 | 本書での意味 |
|---|---|
| MVP | 初期利用者が主要導線を実用し、学習履歴の価値とCoreの信頼性を検証できる最小の製品範囲 |
| Core | AI、Cloud同期、外部Viewer等を設定しなくても成立する日常機能と共通契約 |
| source snapshot | ある時点のsource bytesと、その由来、時刻、問題、言語等を結び付けた不変記録 |
| checkpoint | 利用者が提出前の実装を履歴へ残すと明示したときに作るsource snapshot |
| submission operation | 提出開始前の耐久保存から判定確定または状態不明の回復までを表す操作記録 |
| submission | AtCoderが受理し、submission IDを発行した提出 |
| MVP後 | MVP完了後に別の採用条件で検証する拡張。実装を約束する意味ではない |

各文書にある`Phase 1`等は、その文書内の実装順序を表す場合がある。製品全体のMVP範囲は本書だけを正本とする。

---

## 2. 対象利用者と利用前提

### 2.1. 主対象

MVPの主対象は、次の個人利用者とする。

- AtCoderの終了済み過去問を使って学習する。
- 自分のPCと自分のAtCoderアカウントを使う。
- terminalで短いcommandを実行できるが、shellやcompiler設定の熟練は前提にしない。
- source編集には自分が選んだEditorまたはIDEを使う。
- 一度に主として一つの問題へ取り組む。
- 自分で書いたcodeだけをlocal testと提出の対象にする。
- AlgoLoom導入後の試行を履歴として蓄積する。

初期利用者検証では、CLIに慣れた利用者だけでなく、compiler導入やCLI errorからの復旧に不慣れな利用者も含める。

### 2.2. MVPで保証する利用形態

- 一人の利用者
- 一つのAtCoderアカウント
- 一台の端末
- 一つ以上のworkspace
- local-firstかつofflineで参照可能な履歴
- 通常の非interactiveなAtCoder Algorithm問題

同じ問題を複数directoryで解くことは許容するが、AlgoLoomが暗黙に一つへ統合、上書き、削除してはならない。

### 2.3. 初期対応環境

MVPの製品対象はmacOSとLinux、解答言語はC++とPythonとする。

- AlgoLoom自身のPython runtime、対応OS release、CPU architectureの正確な組み合わせは配布設計で固定し、CIまたは実機で確認する。
- C++とPythonにはAlgoLoom組み込みの安全なlanguage profileを用意する。
- compilerまたはruntimeがない場合、利用者が原因と導入先を理解できる診断を返す。
- Windows、Go、RustはMVPの保証対象外とし、未検証のまま対応済みと表示しない。

Windows、Go、Rustを追加するときも、既存commandの意味と基本導線を変えず、同じ契約テストへ合格させる。

### 2.4. AtCoderの対象範囲

MVPのサポートと利用者検証は、終了済みのAtCoder Algorithm問題に限定する。

- 開催中contestでの利用をMVPの価値検証に含めない。
- AHC、interactive問題、企業等の特殊contestは、個別検証なしに対応済みと扱わない。
- 非AIのCore操作まで恒常的なglobal modeで切り替えさせない。
- 対象外の問題を安全に処理できない場合は、推測して続行せず理由を示して停止する。

---

## 3. MVPの対象範囲

### 3.1. MVPに含める能力

| 能力 | MVPで保証すること |
|---|---|
| install・初期診断 | 任意機能や設定fileの手編集なしで最初のlocal testへ進める |
| 問題取得 | 一つの正規問題IDまたはAtCoder公式URLから公開sampleと宣言的metadataを取得する |
| workspace作成 | 通常のdirectoryとsource fileを作り、任意のEditorで編集できる |
| local test | 自分のcodeをresource上限付きで実行し、公開sampleとの比較結果を示す |
| 明示checkpoint | 利用者の操作によって、提出前のsource snapshotをローカル履歴へ保存する |
| 提出 | 自分のAtCoder sessionを使い、明示操作によって一件を提出する |
| 判定確認 | submission IDを基準に判定を確認し、待機上限後も後から再確認できる |
| 履歴一覧 | 問題、提出、checkpoint、判定、時刻をローカルDBから確認する |
| source表示 | 保存したsnapshotをterminalのplain textで確認する |
| 差分 | 利用者が選んだ二つのsnapshotをunified diffで比較する |
| export | credentialを含まないversion付き形式で学習履歴を持ち出す |
| help・回復 | 部分失敗時に、成功済みの段階、未完了の段階、次の安全な操作を示す |

`get`、`test`、`submit`、`log`、`show`、`diff`、`checkpoint`、`export`は責任を説明する仮称であり、最終的なCLI名ではない。

### 3.2. MVPに含めない能力

- AI review、LLM Provider、生成AIルール判定、`contest_mode`
- Turso、Cloud同期、複数端末、共有、共同編集
- AtCoder Problemsのcatalog取得、terminal内検索、推薦、weakness分析
- TUI、Web dashboard、Editor plugin、専用Editor
- 外部Editor / Diff Viewerとの高度な連携
- 既存のAtCoder全提出履歴の自動backfill
- 自動での成長評価、skill score、苦手分野の断定
- testまたはfile保存のたびに行うsource全文の自動versioning
- Windows、Go、Rustの正式対応
- AHC、interactive問題、特殊judgeへの一般対応
- 複数AtCoderアカウントの統合管理
- 個別履歴のCloud削除、tombstone、端末間競合解決
- 自動Cloud backupと自動restore
- 他者またはLLMが書いた未信頼codeの実行とRepair Lab

MVP対象外の機能について、将来の設定項目、空の画面、毎回の案内をCoreへ置かない。利用者が使えない機能を先に見せて日常操作を複雑にしない。

### 3.3. MVPの依存関係

MVPは次を必須条件とする。

- AtCoderとの連携を交換可能な`JudgeAdapter`境界の後ろへ置く。
- 現在のAtCoderに対して、sample取得、認証確認、提出、submission ID取得、判定確認が成立することを実装前の技術検証で確認する。
- `online-judge-tools`は候補実装であり、AlgoLoomのDomainや保存Schemaの契約にしない。
- 外部toolのstdout、stderr、例外文、HTML構造をそのままCoreの状態として保存しない。
- CAPTCHA、Turnstile、rate limit、Bot対策を回避しない。

自動提出の必須検証に合格しない場合、提出を実装済みとみなさない。browser-assisted提出等へ変更する場合は、代替実装として暗黙に差し替えず、本書のMVP範囲と価値仮説を再決定する。

---

## 4. 共通Core契約

### 4.1. 共通UX

1. Editor、問題種別、将来の教材ごとに別application相当のmodeを作らない。
2. 同じ意味の操作には同じ基本導線、出力構造、errorと回復方法を使う。
3. 同じcommand名を、対象ごとに異なる意味へ流用しない。
4. 内部のAdapter、Provider、Repository等を日常のCLIへ露出させない。
5. 任意機能が未設定でもCoreを利用できる。
6. 外部提出、source送信、削除等の作用は、利用者の明示操作なしに行わない。
7. 部分失敗時は、失敗より先に成功済みの事実と保持されたデータを示す。
8. 再実行で既存source、sample、metadata、履歴を壊さない。

### 4.2. データの権威

| データ | 権威 |
|---|---|
| 編集中のsource | workspace上の通常file |
| 問題IDと問題ページ | AtCoder |
| 公開sample | 取得時点のAtCoder。ローカルdataには取得元と取得時刻を持つ |
| submission IDとjudge上の判定 | AtCoder |
| AlgoLoom導入後のsnapshotと操作履歴 | ローカルのAlgoLoom DB |
| credentialとsession | AlgoLoom DBではなく、利用者または外部toolの適切なsecret store |

履歴DBはworkspaceの代わりに現在のsourceを管理しない。workspaceの移動、rename、削除は、保存済み履歴の削除を意味しない。

### 4.3. workspaceとcontext

- workspaceと問題directoryは通常のfilesystem操作で移動、renameできる。
- 絶対pathとdirectory名を問題や履歴の恒久IDにしない。
- 問題directoryには、問題ID、judge、schema version等の宣言的metadataを置く。
- 現在directory、明示source、親directoryから安全に一意な場合だけcontextを推測する。
- 複数候補、欠損、矛盾がある場合は暗黙に一つを選ばない。
- context解決の失敗は、AtCoderへの提出前に検出する。

metadata fileの名称と形式、探索上限、明示option名は機能設計で決める。

### 4.4. 設定と実行commandの信頼境界

- C++とPythonの標準compile/run定義はAlgoLoom組み込みprofileとして提供する。
- 問題metadataは実行command、credential、endpointを含まない。
- workspace内の設定から、LLM、Cloud、AtCoder session、外部endpointを上書きできないようにする。
- MVPでは、workspaceが任意のcompile/run commandを定義する機能を提供しない。
- 利用者自身のuser-level設定による実行fileや引数の変更を将来許可する場合も、workspace設定とは信頼境界を分ける。
- processはargv配列で起動し、source path等をshell文字列へ連結しない。
- 子processへAtCoder sessionや不要な環境変数を渡さない。

これにより、取得元不明のworkspaceを開いただけで任意commandが実行される状態を避ける。

### 4.5. 通信とoffline動作

- `get`、`submit`、判定確認等、目的上必要な操作だけがAtCoderへ通信する。
- `test`、checkpoint、履歴一覧、source表示、差分、exportはCloudやAtCoderを必要としない。
- 自動telemetry、利用統計送信、crash report送信、自動Cloud同期は行わない。
- 自動update確認を導入する場合はMVP後の明示的なprivacy判断とし、Coreの起動条件にしない。
- network errorを履歴保存失敗やlocal test失敗と混同しない。

### 4.6. 出力とerror

- 通常出力と診断出力を分離し、scriptから利用する将来性を壊さない。
- success、利用者入力error、環境error、外部サービスerror、状態不明を区別する。
- terminalへ出す外部文字列とユーザーcodeは制御文字を無害化する。
- timeout後にprocess、提出、判定、履歴がどの状態かを示す。
- 詳細な内部traceは既定で表示せず、秘密情報を除いた診断経路から確認できるようにする。

exit codeとmachine-readable出力の詳細は機能設計で決める。

---

## 5. 問題取得契約

### 5.1. 取得対象

- 利用者が一件ずつ明示したAtCoderの正規問題IDまたは公式問題URLだけを取得する。
- 問題本文、画像、解説、hidden testをAlgoLoomの配布物へ含めない。
- local test用に、問題ページで公開されているsample入出力だけを取得する。
- 一括crawlとbackground crawlを行わない。

### 5.2. 冪等性と部分失敗

- 同じ問題を同じ場所で再取得しても、利用者が編集したsourceを上書きしない。
- 既存sampleとmetadataは、由来と内容を確認してから安全に再利用または更新する。
- directory作成、metadata保存、sample取得、template作成の完了段階を識別できる。
- 途中失敗後の再実行で、重複fileや破損したcontextを増やさない。
- 同じ問題の別directoryが存在しても、自動mergeまたは削除しない。

問題ページをbrowserで開くか、templateをいつ作るか等は機能設計で決める。

---

## 6. local test契約

### 6.1. testが保証すること

MVPの`test`が保証するのは、**取得済みの公開sampleに対するlocal実行結果**である。

- sample一致をAtCoderでのACまたはcode全体の正しさと表現しない。
- compile、各sample実行、比較を区別して表示する。
- どのsampleが、どの理由で失敗したかを確認できる。
- timeout、出力量超過、signal終了、compile error、実行errorを誤って不一致と表示しない。
- 実行順序と結果表示順序を安定させる。

空白、改行、浮動小数、special judge等の比較方式は機能設計で明示する。MVPでAtCoderのjudgeを再現できない形式は、近似判定であることを表示するか、未対応として停止する。

### 6.2. 実行安全性

- MVPでは本人が書いたcodeだけを実行対象とする。
- compileと実行に個別のtimeoutを持つ。
- stdout、stderr、生成file、process数等へ妥当な上限を設ける。
- timeout時は子processを含めて終了できるよう、対応OSごとのprocess管理を検証する。
- 強いsandboxはMVPの必須条件にしないが、未信頼codeを対象へ加える前に再設計する。

---

## 7. 学習履歴契約

### 7.1. MVPで保存する履歴

MVPでは次を保存する。

1. 利用者が明示的に作成したcheckpoint
2. 提出操作前に耐久保存したsource snapshotと操作状態
3. AtCoderが受理したsubmission ID、問題、言語、アカウント、提出時刻
4. 判定確認で得た観測と最終判定
5. source snapshot間の関係と、差分選択に必要なmetadata

MVPでは、Editorの保存、source変更、local testのたびにsource全文を自動保存しない。local testの永続的なイベント履歴と自動checkpointは、利用者への価値とprivacyを検証した後の拡張とする。

したがってMVPの「学習履歴」は、AlgoLoom導入後の**提出の軌跡と利用者が明示的に残した節目**を意味する。端末上のすべての編集履歴やAtCoder上の全過去履歴を意味しない。

### 7.2. snapshotの不変条件

- snapshotは保存後にsource本文を上書きしない。
- 提出snapshotは、外部送信に使った正確なsource bytesを保持する。
- code hashはその正確なbytesから計算し、文字コードや改行を後から暗黙に正規化しない。
- 問題、judge、言語、作成理由、端末生成UTC時刻を記録する。
- AtCoder時刻と端末時刻を同一の意味で扱わない。
- source sizeへ上限を設け、上限超過時は提出前に説明して停止する。
- 同じ内容のsnapshotを内部で重複排除する場合も、利用者が作った履歴イベントを失わない。

### 7.3. checkpoint

- checkpointは利用者の明示操作でだけ作る。
- checkpoint作成は外部通信を行わない。
- checkpointを作らなくてもtestとsubmitを利用できる。
- 同じsourceに対する重複操作をどう見せるかは機能設計で決めるが、無断で別のsourceへ差し替えない。

### 7.4. 履歴表示と差分

- 履歴はnetworkを待たずにローカルDBから表示する。
- checkpoint、提出待ち、提出済み、判定待ち、最終判定を混同しない。
- `show`は保存済みsnapshotを読み取り専用の内容として表示する。
- `diff`は比較対象を利用者が確認できるようにし、暗黙の「最良版」を作らない。
- 初回提出と最新AC等の便利な既定値を設けても、比較対象を明示できるようにする。

### 7.5. 既存履歴と削除

- MVPはAtCoder上の既存提出を自動importしない。
- 履歴の説明では「AlgoLoomで記録した履歴」と明記する。
- workspaceやsource fileの削除を、履歴DBの削除として扱わない。
- MVPでは個別履歴の同期削除やtombstoneを扱わない。
- 履歴削除機能を追加するときは、export、影響確認、復旧可能性を先に設計する。

---

## 8. 提出契約

### 8.1. 原則

AtCoderへの送信とローカルDBのcommitは、一つの原子的transactionにはできない。したがって`submit`を一回の関数呼び出しではなく、回復可能な状態遷移として扱う。

外部送信前に、少なくとも次をローカルへ耐久保存する。

- 一意なoperation ID
- 正規問題IDとjudge
- AtCoder account identity
- 言語
- 送信する正確なsource snapshotとcode hash
- 作成時刻
- 現在のoperation state

### 8.2. 状態遷移

状態名は実装設計で変更できるが、意味として次を区別する。

```text
PREPARED
  ├─ 外部送信前に失敗 ─→ FAILED_BEFORE_SEND
  └─ 送信開始 ─→ SEND_STARTED
                    ├─ submission ID取得 ─→ REMOTE_ACCEPTED
                    │                          └─ VERDICT_PENDING
                    │                                └─ FINAL
                    └─ 応答不明 ─→ REMOTE_STATUS_UNKNOWN
```

| 状態 | 意味 | 許される次の行動 |
|---|---|---|
| `PREPARED` | sourceと提出意図は保存済み。外部送信は未開始 | 送信開始または安全な取消 |
| `FAILED_BEFORE_SEND` | 外部へ送られていないことを確認できる失敗 | 原因修正後に新しい明示操作 |
| `SEND_STARTED` | 外部へ到達した可能性がある | 結果確認。無条件再送は禁止 |
| `REMOTE_ACCEPTED` | submission IDを取得済み | そのIDの判定確認 |
| `VERDICT_PENDING` | AtCoderで判定中 | 後から同じIDを再確認 |
| `FINAL` | 最終判定を取得済み | 履歴参照、差分、明示的な次の提出 |
| `REMOTE_STATUS_UNKNOWN` | 送信されたか安全に断定できない | 最近の提出または公式画面を確認。自動再送は禁止 |

### 8.3. 冪等性と再実行

- AlgoLoom独自のoperation IDをAtCoderのidempotency keyと誤認しない。
- submission ID取得後は、同じ操作の再実行でcodeを再提出しない。
- 判定pollingのtimeoutは提出失敗を意味しない。
- `REMOTE_STATUS_UNKNOWN`では、account、問題、時刻等から安全に候補を確認する。
- 一意に復元できない場合はAtCoderの公式提出一覧を案内し、利用者の確認なしに履歴へ結び付けない。
- 「AtCoder提出」「ローカル保存」「判定確認」を別の結果として表示する。

### 8.4. verdictの保存

- 判定確認で得た状態は、取得時刻を持つ観測として扱う。
- pendingから最終判定への進行を、source snapshotの上書きとして実装しない。
- 最終判定を得た後に外部状態との差異を検出した場合、履歴を黙って書き換えず再照合の事実を記録する。
- AtCoderへ確認できないとき、推測した判定を保存しない。

### 8.5. AtCoderアカウント

- MVPは一つのAtCoderアカウントを使用する。
- 自動提出前に、現在のsessionがどのアカウントか確認できなければならない。
- 初回提出時にaccount identityをローカルへ関連付ける。
- 以前と異なるアカウントを検出した場合は、送信前に停止して説明する。
- Cookie、password、session tokenを履歴DB、export、logへ保存しない。
- 複数アカウント対応は、履歴の分離と切替UXを設計した後の拡張とする。

### 8.6. AtCoderのAI学習拒否設定の案内

AtCoderは2026年8月以降、拒否設定が反映されていない提出sourceをAI学習用データの販売対象とする方針を公開している。

- AlgoLoomで初めて自動提出する前に、一度だけ簡潔な非blocking案内を表示する。
- [AtCoder公式の説明](https://info.atcoder.jp/overview/about/ai-training-opt-out)と設定先へ案内する。
- AlgoLoomは拒否設定を代行、推測、保証しない。
- 案内を読まないことを理由に、通常の提出を恒常的に妨げない。
- AtCoderの方針変更に備え、案内文とURLをリリース前に再確認する。

---

## 9. 保存、migration、export契約

### 9.1. ローカル保存

- MVPはPython標準`sqlite3`によるローカルSQLiteを既定かつ唯一の履歴保存方式とする。
- Turso SDK、Cloud account、Cloud credentialを基本packageの依存にしない。
- 1回の業務操作に必要なDB更新は明示transactionでcommitまたはrollbackする。
- foreign key、unique constraint、schema versionを有効にする。
- DB lock、disk full、破損、migration失敗を外部提出失敗と区別する。

### 9.2. migration

- schema versionをDB内に記録する。
- migration前に、少なくとも復旧可能なローカル退避を作る。
- migration失敗時に旧Schemaを破壊したまま通常起動しない。
- 新しいCLIが未知の将来Schemaを勝手にdowngradeしない。
- migrationと回復の契約テストをMVPに含める。

### 9.3. export

- MVPは、人間が保存先を選べる明示的なexportを提供する。
- exportにはformat version、作成時刻、AlgoLoom versionを含める。
- 問題、checkpoint、submission、verdict、source snapshotと関連付けを欠損なく含める。
- Cookie、token、password、環境変数、不要な絶対pathを含めない。
- export作成中のDB更新によって不整合な組み合わせを出力しない。
- exportを新しいDBへ自動restoreする機能はMVP対象外だが、形式を文書化し、sourceをAlgoLoomなしでも回収できるようにする。

自動backup、世代管理、Cloudへの暗号化backup、完全なrestore UXはMVP後とする。

---

## 10. 内部境界

MVPでは、将来の全機能を先回りした抽象化を作らない。一方、変更可能性と障害境界が明確な箇所は分離する。

最低限、次の責任を直接結合しない。

| 境界 | 責任 |
|---|---|
| CLI / Application | 入力と表示を、業務状態遷移から分ける |
| `JudgeAdapter` | 問題取得、認証確認、提出、判定確認をAtCoder固有処理へ閉じ込める |
| `HistoryStore` | transaction、snapshot、提出操作、queryをSQLite詳細から分ける |
| `ProcessRunner` | compileと実行、timeout、出力上限、process終了をOS差分から分ける |
| workspace context | path探索とmetadata検証を各commandへ重複させない |

Cloud同期を実装しないMVPで、`SyncCoordinator`や同期状態を日常のDomainへ持ち込まない。将来Adapterを追加できるよう、SQLite固有処理をCLIから直接呼ばないことで十分とする。

---

## 11. PrivacyとSecurityのMVP基準

- 自動telemetryを送信しない。
- source、履歴、path、ユーザー名をcrash reportへ自動送信しない。
- secretをworkspace、履歴DB、export、debug logへ保存しない。
- file permission、atomic write、安全な一時file、path traversal対策を実装する。
- 外部文字列、compiler出力、ユーザーcodeをterminalへ出す前に制御文字を扱う。
- 問題取得と提出にrequest timeout、上限付きretry、適切な間隔を持たせる。
- hidden test取得、一括crawl、CAPTCHA回避、session共有を実装しない。
- 自作codeのみを前提とするMVPでも、timeoutと出力量上限を省略しない。

セキュリティ対策が主要導線を妨げる場合でも、無効化して通すのではなく、原因と安全な回復方法を設計する。

---

## 12. MVPの実装開始条件

機能ごとの詳細設計へ進む前に、本書を正本として受け入れる。実装開始時には、さらに次を満たす。

1. `JudgeAdapter`の技術検証計画と合格条件がある。
2. 現在のAtCoderでsample取得、account確認、提出、submission ID取得、判定確認を小さく検証できる。
3. C++とPythonの組み込みlanguage profile案がある。
4. macOSとLinuxの検証matrixがある。
5. snapshot、submission operation、submission、verdict observation、account identityの論理モデルがある。
6. workspace metadataとuser-level設定の責任が分かれている。
7. `get`、`test`、`submit`の中断点と回復経路が機能設計に含まれている。

技術検証で外部前提が成立しない場合は、回避実装へ進まず、MVPスコープを再検討する。

---

## 13. MVP完了条件

MVPは、commandが存在するだけでは完了としない。少なくとも次を自動test、fault injection、実機確認、利用者検証のいずれかで満たす。

### 13.1. 主要導線

- [ ] クリーン環境でinstallし、AIまたはCloud設定なしで最初の問題を取得できる。
- [ ] 設定fileを手編集せず、C++またはPythonのsourceを公開sampleで実行できる。
- [ ] 同じ`get`を再実行しても、編集済みsourceを失わない。
- [ ] 明示checkpointを作り、offlineで表示できる。
- [ ] sourceを明示確認して、自分のAtCoderアカウントへ一件提出できる。
- [ ] submission ID取得後に判定待ちを中断し、後から同じ提出を確認できる。
- [ ] 初回提出、途中版、最新提出等のsnapshotを選んで差分比較できる。
- [ ] version付きexportから、AlgoLoomなしでもsourceを取り出せる。

### 13.2. 障害と回復

- [ ] `get`の各段階で強制終了しても、安全に再実行できる。
- [ ] compile timeoutと実行timeoutで子processが残らない。
- [ ] 提出前のDB保存に失敗した場合、AtCoderへ送信しない。
- [ ] 送信開始直後に通信を切っても、自動で重複提出しない。
- [ ] 判定polling timeoutを提出失敗と表示しない。
- [ ] DB lock、disk full、migration失敗で履歴を黙って失わない。
- [ ] account変更を検出し、別アカウントへ無確認で提出しない。
- [ ] 外部出力に制御文字や大量出力があってもterminalとprocessを制御できる。

### 13.3. 利用者体験

- [ ] 初期利用者がhelpだけで`get → test`へ到達できる。
- [ ] 部分失敗時に、何が完了済みで何を再実行すべきか判断できる。
- [ ] sample testをAC保証と誤解させない。
- [ ] AI、同期、Viewer等の未設定を繰り返し案内しない。
- [ ] 「AlgoLoomで記録した履歴」の範囲を利用者が理解できる。
- [ ] 初回自動提出前にAtCoderのAI学習拒否設定を一度だけ案内する。

---

## 14. MVP後の拡張と昇格条件

### 14.1. Core安定後に検討する近接拡張

- Windows、Go、Rust
- 外部Editor / Diff Viewer Adapter
- AtCoder Problems catalogと問題選択支援
- local test eventの保存とopt-in自動checkpoint
- AtCoder既存履歴のread-only import
- 自動backupとrestore UX
- machine-readable出力と高度なshell integration

追加時は、MVPのinstall、日常command、offline履歴を複雑にしないことを確認する。

### 14.2. AI review

AI reviewはMVP後の独立した採用判断とする。少なくとも次を満たすまでCoreへ含めない。

- 現行のAtCoderルールをversion付きで確認し、不明時にfail closedにできる。
- 終了済み過去問を安全に識別できる。
- 利用者が送信内容、Provider、費用、保持方針を確認できる。
- reviewを使わなくても同じCore導線が成立する。
- AIがsourceを自動編集、実行、提出しない権限制約がある。

### 14.3. Cloud同期

Cloud同期は標準SQLiteのSchemaとmigrationが安定した後に試作する。

- Turso SDKを基本packageへ必須化しない。
- 2端末、offline、競合、強制終了、bootstrap、disableを検証する。
- 同期はbackupの代替にしない。
- 同期の導入前後で`log`、`show`、`diff`の意味を変えない。
- SDKが未成熟または配布不能なら同期公開を延期し、MVP Coreへ影響させない。

### 14.4. Repair Lab

Repair LabはAtCoder Coreとは異なる教材を扱うが、別application相当のmodeにはしない。仮説、根拠、予測、検証、確信度更新を保存する学習価値と、未信頼codeの実行安全性を確認してから正式設計へ進む。

共通UXへ自然に統合できない場合は、AlgoLoomへ無理に追加せず、別applicationとして分離すべきか再評価する。

---

## 15. 推奨する機能設計の順序

1. `JudgeAdapter`技術検証と対応環境matrix
2. workspace metadata、context解決、組み込みlanguage profile
3. `get`の冪等性、部分失敗、再実行
4. `test`のprocess制御、比較、error表示
5. snapshotとcheckpointの論理モデル
6. `submit`の状態遷移、account確認、判定回復
7. `log`、`show`、`diff`のqueryと表示契約
8. migration、export、障害復旧
9. installから振り返りまでのEnd-to-End検証

縦に一度通すため、最初から全commandを同じ深さで設計しない。ただし、提出前の耐久保存と履歴モデルを後付けにしない。

---

## 16. 変更管理

次の変更は、個別機能の都合だけで行わず、本書を更新して影響を確認する。

- MVP対象機能の追加または削除
- 対象judge、contest、OS、言語、account modelの変更
- 自動外部通信、自動source保存、telemetryの導入
- 履歴の意味、権威、不変性、削除方針の変更
- workspace設定へ実行権限を追加する変更
- 提出の状態不明時に再送を許可する変更
- CloudまたはAIをCoreの必須条件にする変更

変更時は、少なくともコンセプト、UX、セキュリティ、DB、配布方針との整合性を再確認する。各文書の局所的な`Phase`を変更しても、MVP範囲が自動的に変わることはない。
