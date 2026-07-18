# AlgoLoom パフォーマンスと待機体験の設計

> 対象: AlgoLoomにおけるローカル操作、外部通信、任意コード実行、AIレビュー、DB保守の待機時間と性能
>
> 状態: 設計方針・実装優先順位
>
> 作成日: 2026年7月18日
>
> 関連文書:
> - [プロジェクト草案](../product/concept.md)
> - [ストレスフリーUX設計](./stress-free-ux-design.md)
> - [問題選択・カタログ設計](../features/problem-selection-and-catalog.md)
> - [Review Backend・LLM Provider設計](../features/llm-provider-design.md)
> - [セキュリティ設計ガイド](./security-design.md)
> - [ローカル利用とCloud同期の段階的設計](../features/local-and-cloud-sync-design.md)
> - [Turso設計ガイド](../integrations/turso-design-guide.md)

---

## 0. 結論

AlgoLoomで守るべき性能目標は、単に処理時間を短くすることではない。

> 利用者が今すぐ得られる結果を、無関係な通信・保守処理・任意機能によって待たせず、待つ必要がある場合も、何を待っているか、いつ止められるか、次に何をすればよいかを分かるようにする。

このため、処理を次の3種類へ分ける。

| 種類 | 例 | UX上の扱い |
|---|---|---|
| 即時ローカル操作 | `log`、`show`、`diff`、既存workspaceのcontext判定 | networkを待たず、ローカルDBまたはfilesystemから結果を返す |
| 利用者が待つ外部・実行処理 | `get`、compile、test、AtCoder提出・判定取得、AI review、明示`sync run` | 段階、経過、timeout、停止可否、後続の確認経路を示す |
| 後回しにできる補助・保守処理 | Cloud push、catalog更新、checkpoint、backup、export | foregroundの目的を遅らせない。必要なら明示commandへ分離する |

Cloud DBを通常の履歴参照経路から外したことは、この方針の最初の達成項目である。次に優先すべきなのは、DBの同時実行、カタログ更新、外部待機、test実行の上限である。

---

## 1. 共通原則

1. **待たせないで済む処理は待たせない。** `log`、`show`、`diff`はCloud、AI、catalog更新、checkpointを待たない。
2. **待つ処理に無期限を作らない。** 接続、全体処理、polling、DB lockのそれぞれに上限と終了後の行動を持たせる。
3. **主目的と補助処理を分ける。** たとえば`submit`ではAtCoder提出、ローカル保存、Cloud共有、AI reviewを独立した結果として扱う。
4. **background化はデータを失わない場合だけ行う。** Cloud pushは保留にできるが、ローカルcommit、提出前の耐久保存、DB migrationは完了確認なしに後回しにしない。
5. **速さのために状態を曖昧にしない。** stale catalog、未同期履歴、判定待ち、review中を成功と誤表示しない。
6. **計測してから複雑なcacheを入れる。** source codeの重複排除、常駐メモリcache、test並列化は初期要件にしない。

```mermaid
flowchart TD
    A[利用者のcommand] --> B{ローカルだけで目的を返せるか}
    B -->|Yes| C[即時にローカル結果を表示]
    B -->|No| D{外部通信・code実行が必要か}
    D -->|Yes| E[段階と停止可否を表示]
    E --> F{時間上限内に完了したか}
    F -->|Yes| G[主目的の結果を表示]
    F -->|No| H[現在の保存状態と後続確認方法を表示]
    D -->|No| I[保守処理]
    I --> J{foregroundを待たせずに安全か}
    J -->|Yes| K[保留または短い時間予算で実行]
    J -->|No| L[明示commandとして実行]
```

---

## 2. 修正の優先順位

| 優先度 | 対象 | 修正する理由 | 方針 | 完了の判定 |
|---|---|---|---|---|
| P0 | DB同時実行・保守 | `submit`、`sync`、backup、migrationが重なるとSQLite lockや長い待機が起こり得る | 短いtransaction、有限のlock待機、command間排他、閲覧経路からcheckpointを除外 | lock待ちが無期限にならず、保存済みデータを失わず復旧方法を表示できる |
| P0 | カタログの期限切れ更新 | `pick`時の24時間更新は、順次取得とrate limitにより数秒以上の待機になり得る | stale cacheで先に検索し、更新は明示`catalog update`または結果を妨げない経路へ分離 | 既存catalogがあれば更新失敗・遅延でも`pick`が使える |
| P0 | `get`・提出・判定polling | 外部サービス、認証、network、judge待ちにより終了時刻を予測できない | 接続・全体・pollingの上限、進捗、取消、submission IDからの後続照会を定義 | timeout後も再提出を促さず、何が完了したかを説明できる |
| P0 | compile・testのresource上限 | 無限loop、大量出力、重いcompileが端末とCLIを占有する | compile/run別timeout、出力量・memory/process上限、process group終了を実装 | 暴走時に端末を使い切らず、次のtestを実行できる |
| P1 | AI reviewの待機・入出力量 | local modelのcold start、remote遅延、複数snapshotやdiffで待機・費用が増える | input byte/token budget、output上限、cancel、streaming表示、Provider別timeoutを定義 | reviewを中止しても提出・履歴を壊さず、送信範囲と省略を説明できる |
| P1 | `diff`・terminal fallback | 大きなcode・diffを全量生成・描画するとCPU、memory、terminal操作性を消費する | size/line数の保護、出力省略・pager、Viewer失敗時の選択肢を持つ | 大きな履歴でもterminalが操作不能にならない |
| P1 | 繰り返しcompile | 同じsourceをtestするたびにcompileすると日常待機が蓄積する | source hash、compile command、関連設定をkeyにした限定的build cacheを実測後に導入 | cache hit/missが明確で、設定・source変更時に誤った成果物を使わない |
| P2 | backup・export・restore | 履歴増加後に長いI/O、DB lock、容量不足が起こり得る | 明示command、整合snapshot、進捗、取消可否、容量不足の事前確認 | 長時間処理でも通常履歴を壊さず、途中失敗から復旧できる |
| P2 | 起動時の依存初期化 | 通常commandがTurso、LLM、Viewer等の任意依存を読込むと体感が悪化する | command境界までlazy importし、`--help`とCore経路から任意依存を外す | 同期・AI未導入でもCore起動と履歴参照が遅延・失敗しない |

P0はCoreの操作を止める、端末を占有する、または重複提出・履歴不安につながるため、同期BetaやAI拡張より先に実装・検証する。

---

## 3. P0の詳細

### 3.1. DB同時実行、WAL、保守処理

ローカルDBは高速でも、複数processが同時に書き込めば待機する。特に次の組合せを未定義のままにしてはいけない。

| 競合し得る操作 | 想定される問題 | 必要な挙動 |
|---|---|---|
| `submit` と `sync run` | 同時write、push対象の取り違え | 保存transactionを短くし、片方を有限時間だけ待機または安全に再試行する |
| `submit` と backup/export | 長いread transactionやsnapshot作成によるwrite遅延 | backupを明示操作にし、保存を妨げる場合は中止または再実行を案内する |
| migration と通常command | schema不一致、lock、破損した中間状態 | migration中は通常commandを安全に停止し、完了またはrollback後だけ再開する |
| checkpoint と `log` / `show` / `diff` | 本来即時の閲覧がI/O待ちになる | checkpointを閲覧経路で実行しない |

初期実装では、DB lockの待機上限を持ち、超過時に「別のAlgoLoom操作がDBを使用中」であること、保存済みデータへの影響、再試行方法を表示する。具体的な秒数は対応OSと実測で決めるが、無期限のdriver既定値へ委ねない。

### 3.2. カタログ更新を検索の必須待機にしない

[問題選択・カタログ設計](../features/problem-selection-and-catalog.md#8-カタログ更新設計)では、公開JSONを順番に取得し、リソース間に1秒超の間隔を置く。この安全なrate limitは必要だが、期限切れを理由に既存catalogでの検索を停止する理由にはならない。

```text
既存catalogあり
    pick: すぐに既存catalogで検索
    更新: 明示的なcatalog update、または次の安全な機会に確認

catalogなし
    pick: 初回取得の進捗を表示して待機
    失敗時: get <公式URLまたは問題ID> を代替経路として案内
```

未知の問題IDだけは、`get`時に1回だけ更新してもよい。それでも見つからなければ、catalogの失敗とAtCoder公式上の問題不存在を混同せず、公式ページ確認へ進む。

### 3.3. `get`・提出・判定取得の外部待機

外部サービスの応答時間はAlgoLoomが制御できない。したがって、成功まで待ち続けるのではなく、操作ごとに次を持つ。

| 操作 | 待機中に示すこと | 上限後に保持するもの | 後続経路 |
|---|---|---|---|
| `get` | 公式確認、sample取得、workspace作成の現在段階 | 完了済みfileと未完了段階 | 安全な再実行または手動確認 |
| `submit` | 提出済みか、判定待ちか | AtCoder submission ID、code hash、ローカル履歴 | 判定だけ再確認。再提出はしない |
| 判定polling | 経過と最後の確認時刻 | submission IDと最後に得た状態 | `status`等で後から照会 |
| 明示`sync run` | push/pullの段階とpending件数 | ローカルの未push変更 | retryまたは後で再実行 |

connection timeout、個別request timeout、polling全体の最大待機時間を分ける。1つのHTTP requestが失敗したことと、操作全体が回復不能なことを同一視しない。

### 3.4. compile・testのresource制限

これは主に安全性の要件だが、端末が長時間使えなくなることを防ぐため性能UXでもある。既存の[セキュリティ設計](./security-design.md#69-testによる任意コード実行とresource制限)にある方針を、実装可能な既定値と観測へ落とす。

- compileとrunのtimeoutを別々に設定する。
- stdout/stderrは上限までだけ取得し、超過時は読み取りを止めてprocess groupを終了する。
- timeout、signal、runtime error、出力上限、compiler未導入を区別する。
- 初期版ではsampleを無制限に並列実行しない。出力順序、CPU負荷、停止処理を単純に保つ。
- memoryやprocess数の強制制限はOS差が大きいため、対応範囲を明示した上で段階導入する。

---

## 4. P1・P2の詳細

### 4.1. AI review

AI reviewはCoreを止めない任意機能だが、もっとも待機時間が読みにくい。review開始前に次を確定する。

- 送信するcode、diff、test outputの最大byte数またはtoken数
- 上限を超えた場合の優先順位と省略方法
- 最初の応答を表示するまでのtimeout、全体timeout、利用者による中止
- streaming対応Backendでの逐次表示と、非対応Backendでの待機表示
- local modelの起動待ちとremote Providerの接続失敗を区別したerror
- review中断後も提出、ローカル履歴、Cloud同期を成功済みのまま保持すること

model一覧、capability検査、重いhealth checkを毎回のreview実行へ混ぜない。設定変更時または`ai doctor`で検査し、通常実行では短い接続確認だけにする。

### 4.2. `diff`、Viewer、terminal

履歴取得はローカルでも、差分アルゴリズム、外部Viewer起動、terminal描画は別の遅延源である。

- codeまたはdiffが一定のsize・行数を超える場合、全量terminal表示を既定にしない。
- Viewer未設定・起動失敗時は、短い要約、pager、明示optionのいずれかへ安全にfallbackする。
- diff対象を2件へ固定し、履歴全件比較や暗黙の巨大diffをしない。
- 外部Viewerの起動時間はDB取得時間と別に表示・計測する。

### 4.3. compile cache

compile cacheは日常の`test`を速くし得るが、誤った実行結果を出す危険がある。導入する場合は、少なくともsource hash、compile command、compiler version、関連する設定・依存fileをkeyに含める。最初はcacheなしの所要時間とhit率を計測し、コンパイルが実際に主要な待機要因だと確認してから導入する。

### 4.4. backup、export、起動

backup/exportは通常の学習操作から分離する。整合snapshot、容量不足、途中中止、復元検証を扱う明示commandとし、`log`や`show`の開始時に走らせない。

また、Turso、LLM、Viewer等は任意機能である。Coreの起動、`--help`、ローカル履歴参照のためにそれらのSDK、network接続、model確認を実行してはならない。

---

## 5. 性能・待機の初期契約

数値は対応OS、DB規模、sample数、Providerにより変わるため、次は実装開始時の仮説である。固定の約束にする前に、代表的な端末と履歴件数でp50/p95を計測する。

| 操作 | 初期目標・契約 | 測定から除くもの |
|---|---|---|
| `log` | ローカル履歴表示 p95 100ms以内 | terminal emulatorの描画時間 |
| `show` | code取得・表示開始 p95 150ms以内 | 外部Viewerの起動時間 |
| `diff` | 2 snapshot取得・差分生成開始 p95 250ms以内 | 外部Viewerの起動時間 |
| すべての長い操作 | 1秒を超える可能性があれば、段階または進捗を表示 | 正常な短時間操作へのanimation |
| DB lock | 有限時間で成功または回復可能な状態表示へ遷移 | 無期限の既定wait |
| `get` / submit / polling / review / sync | 接続・全体・再試行の上限を分ける | 外部サービスの完了時刻そのもの |
| Cloud push | ローカル保存後の短い時間予算で試し、未完了ならpendingへ移す | 明示`sync run`の完了待機 |

性能計測は平均だけで判断しない。遅い5%の操作、ネットワーク切断、DB lock、巨大出力、cold startでUXが成立するかを重視する。

---

## 6. 検証シナリオと計測

### 6.1. 自動テスト

- 2つのCLI processが同時に保存・同期・backupを始めた場合に、DBが無期限にlockしない。
- 期限切れのcatalogがある状態で、networkを遮断しても`pick`が既存データから検索できる。
- `get`のsample取得、`submit`のpolling、`sync run`、AI reviewを途中で中止しても、保存済み状態を説明できる。
- 無限loop、大量stdout/stderr、compile timeoutで子孫processが残らない。
- 大きなsource、長いreview、巨大diffでmemory使用量とterminal出力が上限内に収まる。
- optional dependencyを導入していない環境でも、`aloom --help`、`log`、`show`、`diff`が起動する。

### 6.2. 実機計測

最低限、次を記録する。

| 観測値 | 用途 |
|---|---|
| commandごとのp50 / p95 / 最大時間 | 体感遅延と回帰の検出 |
| DB lock待機回数・時間 | transactionや排他方針の見直し |
| catalog取得、JSON解析、SQLite更新の内訳 | `pick`を止めない更新方式の確認 |
| compile時間、test case数、出力量 | build cache・並列化の必要性判断 |
| reviewの接続時間、最初の表示まで、全体時間、input/output量 | Provider別のtimeout・予算の調整 |
| Cloud push/pull成功率、pending滞留時間 | 同期の時間予算と再試行方針の調整 |

計測ログへsource code、credential、raw responseを残さない。duration、size、件数、状態コード等の必要最小限だけを記録する。

---

## 7. 実装順序と非目標

1. ローカル履歴の索引・ページング・性能計測を実装する。
2. DB lock、migration、checkpoint、backupの実行規約を確定する。
3. `get`、submit、polling、testのtimeout・中止・進捗契約を実装する。
4. catalogをstale cacheで即時検索できるようにし、更新を検索経路から分離する。
5. Turso Syncのpush/pullとpending復旧を検証する。
6. AI reviewのinput/output budgetと待機契約を追加する。
7. 実測結果を基に、compile cache、diff最適化、さらに強いresource制限を判断する。

初期段階で次を行わない。

- Cloud read cacheを追加して`log`、`show`、`diff`を複雑にすること
- すべてのsample testを無制限に並列化すること
- codeのcontent-addressable deduplicationを先に導入すること
- cache hitを優先してsource、compiler設定、判定結果の正しさを損なうこと
- 常駐daemonを導入してcatalog、sync、backupを暗黙に実行すること

この順序により、日常操作の即時性とデータ完全性を先に確立し、複雑な最適化は実測で必要性を確認してから追加できる。
