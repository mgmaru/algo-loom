# AlgoLoom MVPスコープとCore契約（Core契約）

## 1. 用語

| 用語 | 本書での意味 |
|---|---|
| Core | AI、Cloud同期、外部Viewer等を設定しなくても成立する日常機能と共通契約。 |
| workspace | 編集中のsourceと問題directoryを置く、利用者が通常のfilesystem操作で管理できる作業領域。 |
| context | commandが処理対象とするworkspace、問題、sourceの組み合わせ。 |
| source snapshot | ある時点の正確なsource bytesと、その由来や問題等を結び付けた不変記録。 |
| checkpoint | 利用者の明示操作によって提出前のsource snapshotを履歴へ残す節目。 |
| submission operation | 外部送信前の耐久保存から、判定確定または状態不明からの回復までを表す提出操作記録。 |
| verdict observation | AtCoderから判定状態を取得した時刻付きの観測記録。 |
| 冪等性 | 同じ操作を再実行しても、重複や上書きによって既存データを壊さない性質。 |
| データの権威 | あるデータの正しい状態を最終的に決定する取得元または記録。 |
| LanguageProfile | 言語固有のtemplate、toolchain診断、build/run計画を提供し、他言語から独立した組み込み境界。 |
| HostPlatform | OS固有のprocess、path、terminal、file操作を閉じ込める境界。 |
| optional Capability | Coreの安定した契約を利用して後から追加でき、未導入・失敗時にもCoreを変化させないAI reviewやCloud同期等の機能。 |
| 外部所有環境 | Editor、shell、plugin、toolchain、Provider runtime、OS設定等、AlgoLoomではなく利用者または外部toolが所有する永続状態。 |

## 2. 共通Core契約

### 2.1. 共通UX

1. Editor、問題種別、将来の教材ごとに別application相当のmodeを作らない。
2. 同じ意味の操作には同じ基本導線、出力構造、errorと回復方法を使う。
3. 同じcommand名を、対象ごとに異なる意味へ流用しない。
4. 内部のAdapter、Provider、Repository等を日常のCLIへ露出させない。
5. 任意機能が未設定でもCoreを利用できる。
6. 外部提出、source送信、削除等の作用は、利用者の明示操作なしに行わない。
7. 部分失敗時は、失敗より先に成功済みの事実と保持されたデータを示す。
8. 再実行で既存source、sample、metadata、履歴を壊さない。
9. CoreはAI review、Cloud同期等のoptional Capabilityの型、設定、SDK、保存状態へ依存しない。
10. optional CapabilityはCoreの安定したPortまたはquery契約へ一方向に依存できるが、失敗によってCoreの成功済み状態を変更しない。
11. ローカルで主目的を満たせる操作は、無関係なnetwork、保守処理、optional Capabilityを待たずに結果を返す。
12. 主目的に外部通信またはcode実行が必要な場合は、無期限に待たず、timeoutまたは取消後も完了済み状態と後続の確認方法を示す。
13. 中断して破棄できない処理を主目的の完了後へ分離する場合は、その入力、意図、後続確認に必要な状態を先に耐久保存し、process終了後も状態確認と安全な再試行を可能にする。中断して破棄できるのは、主目的とユーザーdataへ影響しない再取得可能な補助処理だけとする。

### 2.2. データの権威

| データ | 権威 |
|---|---|
| 編集中のsource | workspace上の通常file |
| 問題IDと問題ページ | AtCoder |
| 公開sample | 取得時点のAtCoder。ローカルdataには取得元と取得時刻を持つ |
| submission IDとjudge上の判定 | AtCoder |
| AlgoLoom導入後のsnapshotと操作履歴 | ローカルのAlgoLoom DB |
| credentialとsession | AlgoLoom DBではなく、利用者または外部toolの適切なsecret store |

履歴DBはworkspaceの代わりに現在のsourceを管理しない。workspaceの移動、rename、削除は、保存済み履歴の削除を意味しない。

### 2.3. workspaceとcontext

- workspaceと問題directoryは通常のfilesystem操作で移動、renameできる。
- 絶対pathとdirectory名を問題や履歴の恒久IDにしない。
- 問題directoryには、問題ID、judge、schema version等の宣言的metadataを置く。
- 現在directory、明示source、親directoryから安全に一意な場合だけcontextを推測する。
- 複数候補、欠損、矛盾がある場合は暗黙に一つを選ばない。
- context解決の失敗は、AtCoderへの提出前に検出する。
- `get`は選択された1言語のsourceだけを作り、全対応言語のtemplateを同じ問題directoryへ一括生成しない。
- 同じ問題を別言語で解く場合は別directoryを既定として推奨し、正規問題IDによって同一問題へ関連付ける。
- 利用者が同じdirectoryへ複数言語sourceを置くことは禁止しないが、候補が複数なら先頭file、更新時刻、hiddenなactive language等から暗黙に選ばない。
- sourceを明示した場合は、拡張子とprofile、問題contextの整合を検証し、外部作用前に対象sourceと言語を確認できるようにする。

metadata fileの名称と形式、探索上限、明示option名は機能設計で決める。

### 2.4. 設定と実行commandの信頼境界

#### 組み込みprofileと設定データ

- C++、Python、Go、Rustの標準template、toolchain診断、build/run計画はAlgoLoom組み込み`LanguageProfile`として提供する。
- 各profileは共通契約へ依存できるが、別言語の個別profileへ依存しない。
- canonical language IDをcompiler executable名、local version、AtCoder上の提出言語IDから分離する。
- MVPの初期保証は単一sourceと標準toolchainとし、workspace内のCargo、Go module、CMake等を自動検出して任意project buildを実行しない。
- 問題metadataは実行command、credential、endpointを含まない。
- workspace内の設定から、LLM、Cloud、AtCoder session、外部endpointを上書きできないようにする。
- MVPでは、workspaceが任意のcompile/run commandを定義する機能を提供しない。
- 利用者自身のuser-level設定による実行fileや引数の変更を将来許可する場合も、workspace設定とは信頼境界を分ける。

#### User preference契約

- Coreはuser preferenceの作成や設定fileの手編集を利用開始条件にせず、製品既定値だけで成立するcanonicalな導線を持つ。
- 永続的なuser preferenceは、表示、反復入力の既定値、AlgoLoomが利用する既存外部toolの参照と一時的な呼出方法等、Coreの意味を変えない端末所有の差分として扱う。外部tool本体の設定変更命令をuser preferenceとして扱わず、履歴DB、共有DB、exportへ端末固有設定を混入させない。
- 同じ値を明示指定できる機能では、commandごとの明示指定、user-level preference、製品既定値の順に解決する。workspace metadataを汎用的な設定上書き層として扱わない。
- preferenceは可能な限り列挙値、範囲付き数値、argv等の型付きdataとして検証し、raw shell文字列、任意code、内部class名等の実装詳細を設定契約にしない。
- commandの意味、状態遷移、データの権威、snapshotの不変性、冪等性、error分類、安全性、privacy、外部作用への同意をuser preferenceで変更できないようにする。表示設定によっても、保持されたdata、外部作用、状態不明等の重要な事実を隠さない。
- credential、session、API key等のsecretはuser preferenceから分離し、適切なcredential ownerまたはsecret storeに保持させる。
- 任意Capabilityまたは特定Adapterの設定が不正、未対応、migration不能であっても、影響をその機能へ局所化し、無関係なCore操作を停止させない。安全性または外部作用を確定できない設定は、影響する操作だけをfail closedにする。
- 設定はversion付きSchemaとして検証し、利用者が明示した差分を中心に保持する。新しい項目の追加時は既存設定をそのまま有効とし、省略された新項目へ安全な製品既定値を適用する。
- 実際に解決した値、値の由来、無視または拒否した設定を秘密情報なしで診断できるようにし、設定を無視したcanonicalな状態で問題を切り分けられる回復経路を用意する。

#### 外部所有環境への書き込み境界

通常commandは、AlgoLoom所有領域と、そのcommandで利用者が明示したworkspace上の対象以外へ、永続的な設定変更を書き込まない。

| 境界 | 許可する操作 | 禁止する操作 |
|---|---|---|
| AlgoLoomのconfig、DB、cache、temp | Schemaとcommand契約に沿った作成、更新、migration、削除 | 外部toolの設定をAlgoLoom所有dataへ複製して管理する |
| 利用者が明示したworkspace | `get`等が予告したfile作成、metadata・sample保存 | 既存sourceの無断上書き、Editor・shell・toolchain設定の配置 |
| Editor、shell、plugin、toolchain、OS設定 | read-onlyな検出、version診断、安全なargvによる既存toolの一時起動 | install、update、削除、設定file編集、plugin追加、永続的な`PATH`・環境変数変更 |
| Provider runtime、model、外部認証cache | 公式interfaceへの接続、read-only診断 | lifecycle操作、model download、認証cacheの読取・複製・変更 |
| OS keyring等のsecret store | 明示操作によるAlgoLoom namespaceの項目参照・保存・削除 | 他applicationや外部runtimeが所有する項目の変更 |

- child processへ渡すargv、読み取り専用option、working directory、必要最小限の環境変数は、そのprocessだけの一時的な実行条件として構成し、hostの設定へ永続化しない。
- alias、completion、Editor最適化等の導入支援は、外部設定fileを直接編集するより、設定断片、差分、利用者が実行できる手順を生成する方法を優先する。
- 外部設定を変更する将来のsetup helperを検討する場合は、通常commandから分離し、対象pathと差分の事前表示、backup、冪等性、rollbackを契約化する。これらを保証できなければ実行しない。

#### process起動

- `LanguageProfile`はshell文字列ではなくargv、working directory、source、artifact、timeout区分等からなるBuildPlan / RunPlanを返す。
- processは`HostPlatform`境界を介してargv配列で起動し、source path等をshell文字列へ連結しない。
- 子processへAtCoder sessionや不要な環境変数を渡さない。
- process tree終了、path、terminal、file操作のOS差異を各commandまたは個別language profileへ重複させない。
- native macOS、native Linux、native Windowsでsuccess、compile error、runtime error、timeout、出力量超過、取消等を共通分類へ正規化する。

これにより、取得元不明のworkspaceを開いただけで任意commandが実行される状態を避ける。

### 2.5. 通信とoffline動作

#### 操作ごとの通信要否

- `get`、`submit`、判定確認等、目的上必要な操作だけがAtCoderへ通信する。
- `test`、checkpoint、履歴一覧、source表示、差分、exportはCloudやAtCoderを必要としない。

#### 自動通信

- 自動telemetry、利用統計送信、crash report送信は行わない。
- MVPのCoreは自動Cloud同期を行わない。MVP後に利用者が明示的に同期を有効化した場合の時間上限付きpushはoptional Capabilityの契約とし、Coreの成功条件や通常の読み取り経路へ含めない。
- 自動update確認を導入する場合はMVP後の明示的なprivacy判断とし、Coreの起動条件にしない。

#### 通信error

- network errorを履歴保存失敗やlocal test失敗と混同しない。

### 2.6. 出力とerror

- 通常出力と診断出力を分離し、scriptから利用する将来性を壊さない。
- success、利用者入力error、環境error、外部サービスerror、状態不明を区別する。
- terminalへ出す外部文字列とユーザーcodeは制御文字を無害化する。
- timeout後にprocess、提出、判定、履歴がどの状態かを示す。
- 内部詳細を通常表示から省略する場合も、利用者の目的、保持されたdata、外部作用、再実行の安全性に影響する事実は省略しない。
- module名、stack trace、raw HTTP response、Provider固有error等は通常表示から分離し、利用者がSubsystemを判別しなくても次の行動を選べる表現にする。
- 詳細な内部traceは既定で表示せず、秘密情報を除いた診断経路から確認できるようにする。

exit codeとmachine-readable出力の詳細は機能設計で決める。

---

## 3. 問題取得契約

### 3.1. 取得対象

- 利用者が一件ずつ明示したAtCoderの正規問題IDまたは公式問題URLだけを取得する。
- 問題本文、画像、解説、hidden testをAlgoLoomの配布物へ含めない。
- local test用に、問題ページで公開されているsample入出力だけを取得する。
- 一括crawlとbackground crawlを行わない。

### 3.2. 冪等性と部分失敗

- 同じ問題を同じ場所で再取得しても、利用者が編集したsourceを上書きしない。
- 既存sampleとmetadataは、由来と内容を確認してから安全に再利用または更新する。
- directory作成、metadata保存、sample取得、template作成の完了段階を識別できる。
- 途中失敗後の再実行で、重複fileや破損したcontextを増やさない。
- 同じ問題の別directoryが存在しても、自動mergeまたは削除しない。

問題ページをbrowserで開くか、templateをいつ作るか等は機能設計で決める。

---

## 4. local test契約

### 4.1. testが保証すること

MVPの`test`が保証するのは、**取得済みの公開sampleに対するlocal実行結果**である。

- sample一致をAtCoderでのACまたはcode全体の正しさと表現しない。
- compile、各sample実行、比較を区別して表示する。
- どのsampleが、どの理由で失敗したかを確認できる。
- timeout、出力量超過、signal終了、compile error、実行errorを誤って不一致と表示しない。
- 実行順序と結果表示順序を安定させる。

空白、改行、浮動小数、special judge等の比較方式は機能設計で明示する。MVPでAtCoderのjudgeを再現できない形式は、近似判定であることを表示するか、未対応として停止する。

### 4.2. 実行安全性

- MVPでは本人が書いたcodeだけを実行対象とする。
- compileと実行に個別のtimeoutを持つ。
- stdout、stderr、生成file、process数等へ妥当な上限を設ける。
- timeout時は子processを含めて終了できるよう、対応OSごとのprocess管理を検証する。
- 4言語×3 OSの正式保証matrixで代表的なbuild/runを確認し、詳細なprocess障害は各`HostPlatform`の契約テストで検証する。
- 強いsandboxはMVPの必須条件にしないが、未信頼codeを対象へ加える前に再設計する。

---

## 5. 学習履歴契約

### 5.1. MVPで保存する履歴

MVPでは次を保存する。

1. 利用者が明示的に作成したcheckpoint
2. 提出操作前に耐久保存したsource snapshotと操作状態
3. AtCoderが受理したsubmission ID、問題、言語、アカウント、提出時刻
4. 判定確認で得た観測と最終判定
5. source snapshot間の関係と、差分選択に必要なmetadata

MVPでは、Editorの保存、source変更、local testのたびにsource全文を自動保存しない。local testの永続的なイベント履歴と自動checkpointは、利用者への価値とprivacyを検証した後の拡張とする。

したがってMVPの「学習履歴」は、AlgoLoom導入後の**提出の軌跡と利用者が明示的に残した節目**を意味する。端末上のすべての編集履歴やAtCoder上の全過去履歴を意味しない。

### 5.2. snapshotの不変条件

- snapshotは保存後にsource本文を上書きしない。
- 提出snapshotは、外部送信に使った正確なsource bytesを保持する。
- code hashはその正確なbytesから計算し、文字コードや改行を後から暗黙に正規化しない。
- 問題、judge、言語、作成理由、端末生成UTC時刻を記録する。
- AtCoder時刻と端末時刻を同一の意味で扱わない。
- source sizeへ上限を設け、上限超過時は提出前に説明して停止する。
- 同じ内容のsnapshotを内部で重複排除する場合も、利用者が作った履歴イベントを失わない。

### 5.3. checkpoint

- checkpointは利用者の明示操作でだけ作る。
- checkpoint作成は外部通信を行わない。
- checkpointを作らなくてもtestとsubmitを利用できる。
- 同じsourceに対する重複操作をどう見せるかは機能設計で決めるが、無断で別のsourceへ差し替えない。

### 5.4. 履歴表示と差分

- 履歴はnetworkを待たずにローカルDBから表示する。
- checkpoint、提出待ち、提出済み、判定待ち、最終判定を混同しない。
- `show`は保存済みsnapshotを読み取り専用の内容として表示する。
- `diff`は比較対象を利用者が確認できるようにし、暗黙の「最良版」を作らない。
- 初回提出と最新AC等の便利な既定値を設けても、比較対象を明示できるようにする。

### 5.5. 既存履歴と削除

- MVPはAtCoder上の既存提出を自動importしない。
- 履歴の説明では「AlgoLoomで記録した履歴」と明記する。
- workspaceやsource fileの削除を、履歴DBの削除として扱わない。
- MVPでは個別履歴の同期削除やtombstoneを扱わない。
- 履歴削除機能を追加するときは、export、影響確認、復旧可能性を先に設計する。

---

## 6. 提出契約

### 6.1. 原則

AtCoderへの送信とローカルDBのcommitは、一つの原子的transactionにはできない。したがって`submit`を一回の関数呼び出しではなく、回復可能な状態遷移として扱う。

外部送信前に、少なくとも次をローカルへ耐久保存する。

- 一意なoperation ID
- 正規問題IDとjudge
- AtCoder account identity
- 言語
- 送信する正確なsource snapshotとcode hash
- 作成時刻
- 現在のoperation state

### 6.2. 状態遷移

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

### 6.3. 冪等性と再実行

- AlgoLoom独自のoperation IDをAtCoderのidempotency keyと誤認しない。
- submission ID取得後は、同じ操作の再実行でcodeを再提出しない。
- 判定pollingのtimeoutは提出失敗を意味しない。
- `REMOTE_STATUS_UNKNOWN`では、account、問題、時刻等から安全に候補を確認する。
- 一意に復元できない場合はAtCoderの公式提出一覧を案内し、利用者の確認なしに履歴へ結び付けない。
- 「AtCoder提出」「ローカル保存」「判定確認」を別の結果として表示する。

### 6.4. verdictの保存

- 判定確認で得た状態は、取得時刻を持つ観測として扱う。
- pendingから最終判定への進行を、source snapshotの上書きとして実装しない。
- 最終判定を得た後に外部状態との差異を検出した場合、履歴を黙って書き換えず再照合の事実を記録する。
- AtCoderへ確認できないとき、推測した判定を保存しない。

### 6.5. AtCoderアカウント

- MVPは一つのAtCoderアカウントを使用する。
- 自動提出前に、現在のsessionがどのアカウントか確認できなければならない。
- 初回提出時にaccount identityをローカルへ関連付ける。
- 以前と異なるアカウントを検出した場合は、送信前に停止して説明する。
- Cookie、password、session tokenを履歴DB、export、logへ保存しない。
- 複数アカウント対応は、履歴の分離と切替UXを設計した後の拡張とする。

### 6.6. AtCoderのAI学習拒否設定の案内

AtCoderは2026年8月以降、拒否設定が反映されていない提出sourceをAI学習用データの販売対象とする方針を公開している。

- AlgoLoomで初めて自動提出する前に、一度だけ簡潔な非blocking案内を表示する。
- [AtCoder公式の説明](https://info.atcoder.jp/overview/about/ai-training-opt-out)と設定先へ案内する。
- AlgoLoomは拒否設定を代行、推測、保証しない。
- 案内を読まないことを理由に、通常の提出を恒常的に妨げない。
- AtCoderの方針変更に備え、案内文とURLをリリース前に再確認する。

---

## 7. 保存、migration、export契約

### 7.1. ローカル保存

- MVPはPython標準`sqlite3`によるローカルSQLiteを既定かつ唯一の履歴保存方式とする。
- Turso SDK、Cloud account、Cloud credentialを基本packageの依存にしない。
- 1回の業務操作に必要なDB更新は明示transactionでcommitまたはrollbackする。
- foreign key、unique constraint、schema versionを有効にする。
- DB lock、disk full、破損、migration失敗を外部提出失敗と区別する。

### 7.2. migration

- schema versionをDB内に記録する。
- migration前に、少なくとも復旧可能なローカル退避を作る。
- migration失敗時に旧Schemaを破壊したまま通常起動しない。
- 新しいCLIが未知の将来Schemaを勝手にdowngradeしない。
- migrationと回復の契約テストをMVPに含める。

### 7.3. export

- MVPは、人間が保存先を選べる明示的なexportを提供する。
- exportにはformat version、作成時刻、AlgoLoom versionを含める。
- 問題、checkpoint、submission、verdict、source snapshotと関連付けを欠損なく含める。
- Cookie、token、password、環境変数、不要な絶対pathを含めない。
- export作成中のDB更新によって不整合な組み合わせを出力しない。
- exportを新しいDBへ自動restoreする機能はMVP対象外だが、形式を文書化し、sourceをAlgoLoomなしでも回収できるようにする。

自動backup、世代管理、Cloudへの暗号化backup、完全なrestore UXはMVP後とする。

---

## 8. 内部境界

MVPでは、将来の全機能を先回りした抽象化を作らない。一方、変更可能性と障害境界が明確な箇所は分離する。

最低限、次の責任を直接結合しない。

| 境界 | 責任 |
|---|---|
| CLI / Application | 入力と表示を、業務状態遷移から分ける |
| `JudgeAdapter` | 問題取得、認証確認、提出、判定確認をAtCoder固有処理へ閉じ込める |
| `HistoryStore` | transaction、snapshot、提出操作、queryをSQLite詳細から分ける |
| `LanguageProfile` | template、toolchain診断、BuildPlan / RunPlanを言語ごとに閉じ込め、他言語へ波及させない |
| `HostPlatform` / `ProcessRunner` | compileと実行、timeout、出力上限、process tree終了、path等をOS差分から分ける |
| workspace context | path探索とmetadata検証を各commandへ重複させない |

Cloud同期を実装しないMVPで、`SyncCoordinator`や同期状態を日常のDomainへ持ち込まない。将来Adapterを追加できるよう、SQLite固有処理をCLIから直接呼ばないことで十分とする。

AI reviewを実装しないMVPで、Provider、prompt、review設定、review状態をCoreのsubmission、snapshot、verdictへ持ち込まない。将来AI reviewを追加する場合は、Coreの安定したsnapshot・verdict・diff queryへ一方向に依存し、review revisionを別の追記型recordとして保存する。Coreの提出ServiceからReview Backendを呼び出さず、review拒否・失敗・timeout・response不正が提出、test、履歴の成功状態を変更しない。

個別language profile、個別HostPlatform Adapter、optional Capabilityの依存規則と契約テストは[言語・実行環境の可搬性設計](language-and-platform-portability.md)を参照する。

---

## 9. PrivacyとSecurityのMVP基準

### 9.1. telemetryとsecret

- 自動telemetryを送信しない。
- source、履歴、path、ユーザー名をcrash reportへ自動送信しない。
- secretをworkspace、履歴DB、export、debug logへ保存しない。

### 9.2. fileとterminal

- file permission、atomic write、安全な一時file、path traversal対策を実装する。
- 外部文字列、compiler出力、ユーザーcodeをterminalへ出す前に制御文字を扱う。

### 9.3. 外部通信

- 問題取得と提出にrequest timeout、上限付きretry、適切な間隔を持たせる。
- hidden test取得、一括crawl、CAPTCHA回避、session共有を実装しない。

### 9.4. code実行

- 自作codeのみを前提とするMVPでも、timeoutと出力量上限を省略しない。

セキュリティ対策が主要導線を妨げる場合でも、無効化して通すのではなく、原因と安全な回復方法を設計する。

---
