# AlgoLoom MVPスコープとCore契約（MVPスコープ）

> 対象: AlgoLoomの最初の利用可能な製品範囲と、機能設計・データ設計・実装が共通して守る契約
>
> 状態: MVPの正本。MVPの対象範囲について他文書と矛盾する場合は本書を優先する
>
> 決定日: 2026年7月18日
>
> 更新日: 2026年7月19日
>
> 関連文書:
> - [プロダクトビジョン](vision.md)
> - [ストレスフリーUX設計](../quality/stress-free-ux-design.md)
> - [セキュリティ設計ガイド](../quality/security-design.md)
> - [パフォーマンスと待機体験の設計](../quality/performance-and-waiting-design.md)
> - [ローカル利用とCloud同期の段階的設計](../features/local-and-cloud-sync-design.md)
> - [配布方針ガイド](../operations/algoloom-distribution.md)
> - [言語・実行環境の可搬性設計](../architecture/language-and-platform-portability.md)

---

## 0. 結論

AlgoLoomのMVPは、**AtCoderの終了済み過去問を、自分のEditorで解き、公開sampleで確認し、自分のアカウントで提出し、その試行をローカルの学習履歴として振り返れるCLI**とする。

MVPで証明する価値は、機能の多さではない。

> 問題を始め、書き、試し、提出し、過去の実装へ戻る流れを、EditorやCloudへ利用者を囲い込まず、壊れにくい一つの導線として提供できること

MVPにはAI review、Cloud同期、問題推薦、TUI、Repair Labを含めない。これらはCoreの安定した契約を利用する任意Capabilityとして後から追加できる依存方向を保つが、Coreから未実装の任意機能へ依存させず、将来機能のために導入、日常操作、業務データモデルを複雑にしない。

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

MVPの製品対象はnative macOS、native Linux、native Windows、解答言語はC++、Python、Go、Rustとする。

- AlgoLoom自身のPython runtime、対応OS release、CPU architectureの正確な組み合わせは配布設計で固定し、CIまたは実機で確認する。
- C++、Python、Go、RustにはAlgoLoom組み込みの安全なlanguage profileを用意する。
- 各language profileは単一sourceと標準toolchainを初期保証範囲とし、project buildや外部package管理を暗黙に対応済みと扱わない。
- 言語固有のtemplate、toolchain診断、build/run計画は`LanguageProfile`境界へ、OS固有のprocess、path、terminal、file操作は`HostPlatform`境界へ閉じ込める。
- native WindowsはWindows上のPython processとして動作する環境を意味し、WSLと同一視しない。
- compilerまたはruntimeがない場合、利用者が原因と導入先を理解できる診断を返す。
- WSL、追加言語、project buildはMVPの保証対象外とし、未検証のまま対応済みと表示しない。

新しい言語またはOSを追加するときも、既存command、履歴、snapshot、提出の意味と基本導線を変えず、同じ契約テストへ合格させる。正確な差異、依存方向、workspace UX、検証matrixは[言語・実行環境の可搬性設計](../architecture/language-and-platform-portability.md)を正とする。

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

#### AI・Cloud・分析

- AI review、LLM Provider、生成AIルール判定、`contest_mode`
- Turso、Cloud同期、複数端末、共有、共同編集
- AtCoder Problemsのcatalog取得、terminal内検索、推薦、weakness分析
- 自動での成長評価、skill score、苦手分野の断定

#### UI・外部ツール連携

- TUI、Web dashboard、Editor plugin、専用Editor
- 外部Editor / Diff Viewerとの高度な連携

#### 履歴・同期データ管理

- 既存のAtCoder全提出履歴の自動backfill
- testまたはfile保存のたびに行うsource全文の自動versioning
- 個別履歴のCloud削除、tombstone、端末間競合解決
- 自動Cloud backupと自動restore

#### 対応環境・利用形態

- WSL、C++・Python・Go・Rust以外の言語の正式対応
- Cargo、Go module、CMake等を含む一般的な複数file・project build
- AHC、interactive問題、特殊judgeへの一般対応
- 複数AtCoderアカウントの統合管理

#### 未信頼codeの実行

- 他者またはLLMが書いた未信頼codeの実行とRepair Lab

MVP対象外の機能について、将来の設定項目、空の画面、毎回の案内をCoreへ置かない。利用者が使えない機能を先に見せて日常操作を複雑にしない。

### 3.3. MVPの依存関係

MVPは次を必須条件とする。

#### Adapter境界

- AtCoderとの連携を交換可能な`JudgeAdapter`境界の後ろへ置く。
- `online-judge-tools`は候補実装であり、AlgoLoomのDomainや保存Schemaの契約にしない。
- 外部toolのstdout、stderr、例外文、HTML構造をそのままCoreの状態として保存しない。

#### 実装前の技術検証

- 現在のAtCoderに対して、sample取得、認証確認、提出、submission ID取得、判定確認が成立することを実装前の技術検証で確認する。

#### 外部サービスの保護

- CAPTCHA、Turnstile、rate limit、Bot対策を回避しない。

自動提出の必須検証に合格しない場合、提出を実装済みとみなさない。browser-assisted提出等へ変更する場合は、代替実装として暗黙に差し替えず、本書のMVP範囲と価値仮説を再決定する。

---

## 4. MVPの実装開始条件

機能ごとの詳細設計へ進む前に、本書を正本として受け入れる。実装開始時には、さらに次を満たす。

1. `JudgeAdapter`の技術検証計画と合格条件がある。
2. 現在のAtCoderでsample取得、account確認、提出、submission ID取得、判定確認を小さく検証できる。
3. C++、Python、Go、Rustの組み込みlanguage profile案と共通契約テストがある。
4. native macOS、native Linux、native Windowsの`HostPlatform`契約と、4言語×3 OSの検証matrixがある。
5. snapshot、submission operation、submission、verdict observation、account identityの論理モデルがある。
6. workspace metadataとuser-level設定の責任が分かれている。
7. `get`、`test`、`submit`の中断点と回復経路が機能設計に含まれている。

技術検証で外部前提が成立しない場合は、回避実装へ進まず、MVPスコープを再検討する。

---

## 5. MVP完了条件

MVPは、commandが存在するだけでは完了としない。少なくとも次を自動test、fault injection、実機確認、利用者検証のいずれかで満たす。

### 5.1. 主要導線

- [ ] クリーン環境でinstallし、AIまたはCloud設定なしで最初の問題を取得できる。
- [ ] 設定fileを手編集せず、C++、Python、Go、Rustのsourceを、対応する3 OSの保証matrixで公開sampleに対して実行できる。
- [ ] 同じ`get`を再実行しても、編集済みsourceを失わない。
- [ ] 明示checkpointを作り、offlineで表示できる。
- [ ] sourceを明示確認して、自分のAtCoderアカウントへ一件提出できる。
- [ ] submission ID取得後に判定待ちを中断し、後から同じ提出を確認できる。
- [ ] 初回提出、途中版、最新提出等のsnapshotを選んで差分比較できる。
- [ ] version付きexportから、AlgoLoomなしでもsourceを取り出せる。

### 5.2. 障害と回復

- [ ] `get`の各段階で強制終了しても、安全に再実行できる。
- [ ] compile timeoutと実行timeoutで子processが残らない。
- [ ] 提出前のDB保存に失敗した場合、AtCoderへ送信しない。
- [ ] 送信開始直後に通信を切っても、自動で重複提出しない。
- [ ] 判定polling timeoutを提出失敗と表示しない。
- [ ] DB lock、disk full、migration失敗で履歴を黙って失わない。
- [ ] account変更を検出し、別アカウントへ無確認で提出しない。
- [ ] 外部出力に制御文字や大量出力があってもterminalとprocessを制御できる。

### 5.3. 利用者体験

- [ ] 初期利用者がhelpだけで`get → test`へ到達できる。
- [ ] 部分失敗時に、何が完了済みで何を再実行すべきか判断できる。
- [ ] 1秒を超える可能性があるCore処理で現在の段階を確認でき、無期限に待たず、timeoutまたは取消後の状態と次の確認方法を理解できる。
- [ ] 利用者へ制御を返した後に未完了状態が残る場合、その状態を後から確認し、成功済みdataを壊さず再試行できる。
- [ ] sample testをAC保証と誤解させない。
- [ ] AI、同期、Viewer等の未設定を繰り返し案内しない。
- [ ] 「AlgoLoomで記録した履歴」の範囲を利用者が理解できる。
- [ ] 初回自動提出前にAtCoderのAI学習拒否設定を一度だけ案内する。

---

## 6. 推奨する機能設計の順序

1. `JudgeAdapter`技術検証と対応環境matrix
2. workspace metadata、context解決、`LanguageProfile`、`HostPlatform`、組み込みprofile
3. `get`の冪等性、部分失敗、再実行
4. `test`のprocess制御、比較、error表示
5. snapshotとcheckpointの論理モデル
6. `submit`の状態遷移、account確認、判定回復
7. `log`、`show`、`diff`のqueryと表示契約
8. migration、export、障害復旧
9. installから振り返りまでのEnd-to-End検証

縦に一度通すため、最初から全commandを同じ深さで設計しない。ただし、提出前の耐久保存と履歴モデルを後付けにしない。

---

## 7. 変更管理

次の変更は、個別機能の都合だけで行わず、本書を更新して影響を確認する。

- MVP対象機能の追加または削除
- 対象judge、contest、OS、言語、account modelの変更
- 自動外部通信、自動source保存、telemetryの導入
- 履歴の意味、権威、不変性、削除方針の変更
- workspace設定へ実行権限を追加する変更
- 提出の状態不明時に再送を許可する変更
- CloudまたはAIをCoreの必須条件にする変更

変更時は、少なくともコンセプト、UX、セキュリティ、DB、配布方針との整合性を再確認する。各文書の局所的な`Phase`を変更しても、MVP範囲が自動的に変わることはない。
