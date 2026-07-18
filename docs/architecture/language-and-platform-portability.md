# AlgoLoom 言語・実行環境の可搬性設計

> 対象: 解答言語、host OS、process実行、workspace layout、異なる環境間での履歴可搬性
>
> 状態: MVPの対応環境を実装するための設計方針
>
> 作成日: 2026年7月19日
>
> 関連文書:
> - [MVPスコープ](../product/mvp.md)
> - [アーキテクチャ概要](overview.md)
> - [Core契約](core-contracts.md)
> - [パフォーマンスと待機体験の設計](../quality/performance-and-waiting-design.md)
> - [セキュリティ設計ガイド](../quality/security-design.md)
> - [ローカル利用とCloud同期の段階的設計](../features/local-and-cloud-sync-design.md)

---

## 0. 結論

MVPの解答言語は**C++、Python、Go、Rust**、製品対象OSは**native macOS、native Linux、native Windows**とする。WSLはLinux版またはnative Windows版と同一の保証範囲とはみなさず、MVPの正式対象へ含めない。

言語とOSの追加が既存実装を壊さないよう、差異を次の直交した境界へ分ける。

```mermaid
flowchart LR
    APP[Application / Core] --> LP[LanguageProfile Registry]
    APP --> HP[HostPlatform]
    APP --> JA[JudgeAdapter]

    LP --> BP[BuildPlan / RunPlan]
    BP --> HP

    LP --> CPP[C++]
    LP --> PY[Python]
    LP --> GO[Go]
    LP --> RS[Rust]

    HP --> MAC[native macOS]
    HP --> LIN[native Linux]
    HP --> WIN[native Windows]

    JA --> AT[AtCoder]

    style APP fill:#dbeafe,stroke:#2563eb,stroke-width:2px
    style LP fill:#ede9fe,stroke:#7c3aed
    style HP fill:#dcfce7,stroke:#16a34a
    style JA fill:#fef3c7,stroke:#d97706
```

- `LanguageProfile`は、言語固有のtemplate、toolchain診断、build/run計画を担う。
- `HostPlatform`は、OS固有のprocess起動・終了、path、terminal、原子的file操作を担う。
- `JudgeAdapter`は、sample取得、提出、判定、judge上の提出言語への対応付けを担う。
- Coreの各commandへ言語名やOS名の条件分岐を散在させない。
- 対応言語やOSを追加しても、既存command、履歴、snapshot、提出の意味を変更しない。

---

## 1. 本書の責任

### 1.1. 本書で決めること

- MVPで正式に保証する解答言語とOS
- 言語差異とOS差異を閉じ込める境界
- 各言語の初期対応範囲
- 複数言語sourceが存在する場合のworkspace UX
- 異なるOS間で履歴とsource snapshotを可搬にする原則
- 追加言語・追加OSの契約テストと受け入れ条件

### 1.2. 本書で決めないこと

- compiler、runtime、OS release、CPU architectureの最終version matrix
- 各OSにおけるcompiler/runtimeの具体的な導入command
- build artifact用directoryの最終名称
- metadata fileの最終形式
- MVP後のCargo project、Go module、CMake等のproject build対応
- WSLを将来正式対応する時期

---

## 2. 用語

| 用語 | 本書での意味 |
|---|---|
| canonical language ID | `cpp`、`python`、`go`、`rust`等、toolchain名やjudge上のversionに依存しないAlgoLoom内の言語識別子 |
| language profile | 言語固有の拡張子、template、toolchain診断、安全なbuild/run計画を提供する組み込み定義 |
| host OS | AlgoLoom processが直接動作し、filesystemと子processを制御するOS |
| native Windows | WSLを介さず、Windows上のPython processとしてAlgoLoomを実行する環境 |
| HostPlatform | host OS固有のprocess、path、terminal、file操作を閉じ込める境界 |
| BuildPlan | shell文字列ではなくargv、working directory、入力、生成物、timeout区分等で表すbuild計画 |
| RunPlan | argv、working directory、stdin、実行対象、resource上限区分等で表す実行計画 |
| toolchain observation | compiler/runtimeの種類、version、診断結果等、その端末で観測した実行環境情報 |
| logical source name | snapshotやexportでsourceを説明するための、絶対pathではない可搬な名称 |

---

## 3. MVPの対応範囲

### 3.1. 解答言語

MVPでは、次の4言語に組み込みlanguage profileを提供する。

| 言語 | canonical ID | 初期実行モデル | MVPで保証する範囲 | MVPで保証しない範囲 |
|---|---|---|---|---|
| C++ | `cpp` | sourceをcompileし、生成binaryを実行 | 単一source file、標準toolchain、標準library | CMake、複数translation unit、外部library管理 |
| Python | `python` | runtimeでsourceを実行 | 単一source file、標準runtime、標準library | virtual environment作成、外部package導入・lock管理 |
| Go | `go` | 単一packageをbuildし、生成binaryを実行 | 単一source file、標準toolchain、標準library | 複数package、外部module取得、`go.mod`管理 |
| Rust | `rust` | 単一sourceをcompileし、生成binaryを実行 | 単一source file、標準toolchain、標準library | Cargo project、外部crate取得、workspace管理 |

この4言語は、利用者が設定fileへ任意commandを書かなくても最初のlocal testへ進める組み込みprofileとする。個別profileの内部事情を他のprofileへ継承させず、共通の契約と値objectだけを共有する。

### 3.2. host OS

| 環境 | MVPでの状態 | 意味 |
|---|---|---|
| native macOS | 正式対象 | macOS上のPython processとして実行し、実機またはCIで検証する |
| native Linux | 正式対象 | Linux上のPython processとして実行し、実機またはCIで検証する |
| native Windows | 正式対象 | Windows上のPython processとして実行し、PowerShell等から利用できることを検証する |
| WSL | 対象外 | Linux kernelで動作しても、Windows filesystem・実行file・browser・credentialとの相互運用を未検証のまま保証しない |

WSL上で偶然動作することを妨げないが、native Windows対応またはLinux対応の検証結果を根拠に「WSL対応済み」と表示しない。

### 3.3. 保証matrix

正式対応を表示する前に、少なくとも4言語と3 OSの12組み合わせで、代表的な単一sourceのtoolchain診断、build、run、公開sample比較を確認する。

詳細な障害テストはすべてを12回複製せず、責任ごとの契約テストへ分ける。

| テスト層 | 主な対象 | 組み合わせ |
|---|---|---|
| LanguageProfile契約 | template、toolchain診断、BuildPlan、RunPlan | 4 profile |
| HostPlatform契約 | 起動、取消、timeout、process tree終了、path、出力上限 | 3 OS |
| Judge言語mapping契約 | canonical language IDとAtCoder提出言語の対応 | 4言語と対応version |
| End-to-End smoke | `get → test`と代表的な提出前検証 | 4言語 × 3 OS |
| Core回帰 | workspace、snapshot、履歴、error構造 | 言語・OS非依存fixture |

---

## 4. 依存方向と責任境界

### 4.1. 言語とOSを組み合わせたclassを作らない

次のような組み合わせ別実装を基本構造にしない。

```text
CppWindowsAtCoderRunner
PythonLinuxAtCoderRunner
RustMacAtCoderRunner
```

代わりに、Applicationが選択したlanguage profileからOS非依存の計画を受け取り、現在のHostPlatformへ実行を依頼する。

```mermaid
sequenceDiagram
    participant A as Test Application Service
    participant L as LanguageProfile
    participant H as HostPlatform / ProcessSupervisor
    participant J as Test Comparator

    A->>L: sourceとtoolchain条件からbuild/run計画を要求
    L-->>A: BuildPlan / RunPlan
    A->>H: BuildPlanを実行
    H-->>A: 正規化されたProcessResult
    A->>H: RunPlanとsample inputを実行
    H-->>A: 正規化されたProcessResult
    A->>J: stdoutとexpectedを比較
    J-->>A: sample result
```

### 4.2. 境界ごとの責任

| 境界 | 含める責任 | 含めない責任 |
|---|---|---|
| `LanguageProfile` | 拡張子、template、toolchain要件、build/run計画、生成物種別 | process tree終了、AtCoder通信、DB保存、任意shell実行 |
| `HostPlatform` | process起動・取消・終了、path、temp、terminal capability、原子的file操作 | 言語template、judge提出言語、sample比較 |
| `JudgeAdapter` | 問題取得、認証、提出、判定、canonical language IDからjudge言語への解決 | local compilerの探索、OS process制御、履歴Schema |
| `HistoryStore` | snapshot、言語ID、toolchain観測、提出と判定の永続化 | sourceのbuild/run、host pathを恒久IDにすること |
| workspace context | 問題metadata探索、source候補解決、曖昧性の検出 | compiler実行、暗黙のsource選択、別directoryの自動merge |

### 4.3. 許可する依存方向

- Applicationは抽象化された`LanguageProfile`、`HostPlatform`、`JudgeAdapter`、`HistoryStore`を利用できる。
- 個別language profileは共通のplan/result型へ依存できるが、別の個別profileへ依存しない。
- 個別HostPlatform Adapterは共通契約へ依存できるが、別OS Adapterへ依存しない。
- `JudgeAdapter`はcanonical language IDをjudge上の言語へ解決できるが、workspace内の実行commandを変更しない。
- Domainと履歴の論理モデルは、compiler executable名、path separator、signal番号等のOS詳細へ依存しない。

### 4.4. 条件分岐の配置

`if windows`、`if rust`等の条件分岐を各commandやDomainへ散在させない。個別Adapterの選択は起動時のcomposition rootまたはregistryで行い、その後は共通interfaceを使う。

共通化できる処理は共有してよい。ただし、共有実装の変更が全profile・全OSへ影響するため、共通契約テストを必ず実行する。

---

## 5. LanguageProfile契約

### 5.1. 概念interface

最終的なclass名とmethod名を確定するものではないが、責任は概ね次のように分ける。

```python
class LanguageProfile(Protocol):
    language_id: str

    def source_conventions(self) -> SourceConventions:
        ...

    def render_template(self, context: TemplateContext) -> bytes:
        ...

    def probe_toolchain(self, host: HostPlatform) -> ToolchainObservation:
        ...

    def plan_build(self, request: BuildRequest) -> BuildPlan | None:
        ...

    def plan_run(self, request: RunRequest) -> RunPlan:
        ...
```

- planはargv配列で表し、shell command文字列を返さない。
- source path、artifact path、working directoryを文字列連結でcommandへ埋め込まない。
- toolchainがない場合は、profile ID、欠けているtool、影響を受ける操作を含む正規化された診断を返す。
- compiler/runtimeのraw errorを業務状態として保存せず、共通分類と必要に応じてredactした詳細へ変換する。
- toolchain executableの絶対pathは端末上の観測情報であり、共有履歴の恒久IDにしない。

### 5.2. 組み込みprofileと信頼境界

MVPの4 profileはAlgoLoom配布物に含め、version管理する。workspace metadataへcompile/run commandを保存しない。

将来user-level設定で実行fileや引数の変更を許可する場合も、次を守る。

- workspaceから変更できない端末所有の設定として扱う。
- safe argvとして検証し、shell文字列を許可しない。
- 組み込みprofileと同じprocess、resource、secret分離契約を通す。
- 設定変更が他言語profileへ波及しない。

---

## 6. HostPlatform契約

### 6.1. 主なOS差異

| 領域 | macOS / Linux | native Windows | 閉じ込める境界 |
|---|---|---|---|
| process tree | process group、session、signalを利用可能 | process groupの意味が異なり、Job Object等の検証が必要 | `ProcessSupervisor` |
| 取消・異常終了 | signalを分類できる | Console Control Eventやexit code等を分類する | `ProcessSupervisor`、共通`ProcessResult` |
| executable | 通常は拡張子なし | `.exe`、`PATHEXT`、`.cmd`等 | `ToolchainLocator` |
| path | POSIX rootとseparator | drive、UNC、予約名、case差、separator | `HostPathPolicy` |
| file lock・削除 | open中fileの扱いが比較的緩い場合がある | open中fileのrename/delete制約が異なる | `AtomicFileOperations` |
| terminal | POSIX terminal | PowerShell、cmd、Windows Terminal等 | `TerminalCapabilities` |
| symlink | 一般的に利用可能 | 作成条件や権限が異なる | path/context契約 |
| resource制限 | POSIX APIを利用できる場合がある | Job Object等、別方式が必要 | `ProcessSupervisor` |

### 6.2. 正規化するprocess結果

利用者向けの基本分類はOSで変えない。

- success
- compile error
- runtime error
- timeout
- output limit exceeded
- cancelled
- abnormal termination
- toolchain unavailable
- process state unknown

signal番号等のOS固有詳細は診断情報へ残せるが、Domainの状態遷移や通常表示の主分類にはしない。

### 6.3. native Windowsの検証

- 子processと孫processをtimeout後に残さない。
- space、quote、先頭hyphen等を含むpathでも追加commandを実行しない。
- source、artifact、sample pathをWindows上で安全に扱う。
- compiler/runtime未導入時に、他の言語や履歴機能を停止しない。
- PowerShell等から基本commandと取消操作を実行できる。
- SQLite lock、atomic write、temp cleanupを実機または同等環境で確認する。

---

## 7. workspaceと複数言語UX

### 7.1. 既定は一つの問題directoryに一つのsource

4言語を正式対応しても、`get`で4言語分のsourceを同時生成しない。利用者が選んだ1言語のtemplateだけを作る。

```text
algoloom_workspace/
└── abc300_a/
    ├── <problem-metadata>
    ├── main.cpp
    └── test/
```

この既定により、問題directoryを通常の単一言語projectに近い状態へ保ち、Editor、LSP、toolchainの曖昧性を減らす。

### 7.2. 同じ問題を別言語で解く場合

既定では別directoryを推奨する。

```text
algoloom_workspace/
├── abc300_a/
│   ├── <problem-metadata>
│   └── main.cpp
└── abc300_a-python/
    ├── <problem-metadata>
    └── main.py
```

- directory名は恒久IDにせず、両方を同じ正規問題IDへ関連付ける。
- AlgoLoomは別directoryを自動merge、rename、削除しない。
- 履歴では問題ID、snapshot ID、canonical language IDにより比較できる。
- directory名の付け方をAlgoLoom固有規則として強制しない。

### 7.3. 同じdirectoryへ複数sourceを置いた場合

利用者が自分で複数言語sourceを置くことは禁止しない。

- sourceを明示した`test`、checkpoint、`submit`を許可する。
- 引数省略時に候補が1つだけなら、その候補と言語を表示して利用できる。
- 複数候補がある場合は、先頭file、更新時刻、hiddenなactive language等から暗黙に選ばない。
- 対象source、解決したlanguage profile、問題IDを外部作用前に確認できるようにする。
- workspace全体へ恒久的な「現在の言語」modeを設けない。

---

## 8. 異なるOS間の可搬性

### 8.1. 共有可能な論理データと端末固有データ

| データ | 可搬・同期可能 | 端末ローカル | 理由 |
|---|:---:|:---:|---|
| problem ID、judge ID | Yes | No | pathに依存しない識別子 |
| snapshot ID、source bytes、code hash | Yes | No | 履歴の不変記録 |
| canonical language ID | Yes | No | compiler名やjudge versionと分離する |
| logical source name | Yes | No | 絶対pathではない表示・復元用metadata |
| workspaceの絶対path | No | Yes | OS・端末ごとに異なるlocator |
| compiler/runtimeの絶対path | No | Yes | 端末固有toolchain |
| Editor / Viewer設定 | No | Yes | 端末固有UX |
| build artifact、cache、temp file | No | Yes | 現在OSで再生成する |
| credential、session | No | Yes | secret ownerから取得する |

### 8.2. 絶対pathの扱い

- 絶対pathを問題、解答、snapshot、提出、履歴の恒久IDにしない。
- 共有DB、Cloud、exportへ不要な絶対pathを含めない。
- workspace探索を高速化するため絶対pathを保持する場合は、端末専用sidecarまたはlocal indexへ保存する。
- local indexは同期せず、別端末ではmetadataから再構築する。
- sourceの関連付けには安定ID、正規問題ID、canonical language ID、code hashを使う。

### 8.3. snapshotからworkspaceを再構築する将来機能

Cloud同期は履歴を共有する機能であり、編集中workspaceの自動同期・mergeではない。別OSで編集を再開する場合は、同期済みsnapshotを利用者が選んだlocal directoryへ安全にmaterializeする独立機能として設計する。

materialize時は次を守る。

- 元端末の絶対pathを再現しない。
- 現在OSで無効な予約名、separator、case衝突を検証する。
- `..`、絶対path、symlink等による復元先外への書き込みを防ぐ。
- 既存fileを無断で上書きしない。
- file名を変更した場合は、元のlogical nameとの対応を表示する。
- source bytesとcode hashを検証し、改行や文字コードを暗黙に正規化しない。
- build artifactは移送せず、現在OSのprofileとtoolchainで再生成する。

このmaterialize / restore UXはMVP対象外であり、MVPではversion付きexportからAlgoLoomなしでもsourceを回収できる契約を優先する。

---

## 9. 追加時の回帰防止

### 9.1. 新しい言語

新しいlanguage profileは次を満たすまで正式対応と表示しない。

- 既存profileを変更せずregistryへ追加できる。
- language profile契約テストへ合格する。
- 対応OSでtoolchain診断、build、run、timeout、出力上限を確認する。
- JudgeAdapterの提出言語mappingを確認する。
- 既存snapshot、履歴Schema、CLIの意味を変えない。
- 未導入時に他言語と履歴機能を停止しない。

### 9.2. 新しいOSまたはWSL

新しいHostPlatform Adapterは次を満たすまで正式対応と表示しない。

- 既存OS Adapterを変更せず選択できる。
- process、path、terminal、file操作の契約テストへ合格する。
- 対応言語のEnd-to-End smoke testへ合格する。
- unsupportedなtoolchainや機能を明示し、推測して続行しない。
- 既存OSのCIと実機確認を再実行する。

### 9.3. Architectureテスト

- Domainから個別language profile moduleを直接importしない。
- DomainからWindows、macOS、Linux固有moduleを直接importしない。
- 個別profile同士、個別HostPlatform Adapter同士のimportを禁止する。
- optional featureの追加によってCore packageへ逆向き依存を作らない。
- registryからprofileまたはplatformを1つ除いても、無関係なCore commandが起動することを確認する。

---

## 10. 実装チェックリスト

### LanguageProfile

- [ ] C++、Python、Go、Rustが同じprofile契約を実装している。
- [ ] build/runをshell文字列ではなくargv計画として返す。
- [ ] workspace metadataへ任意commandを保存しない。
- [ ] toolchain未導入が他言語とCore機能を止めない。
- [ ] canonical language IDとjudge上の言語/versionを分離している。

### HostPlatform

- [ ] macOS、Linux、Windowsが同じprocess結果分類を返す。
- [ ] timeoutと出力量超過で子孫processが残らない。
- [ ] path、temp、atomic writeのOS差異がAdapter外へ漏れていない。
- [ ] WSLを未検証のまま対応済みと表示しない。

### Workspace UX

- [ ] `get`が選択した1言語のsourceだけを作る。
- [ ] 同一問題の別directoryを自動mergeしない。
- [ ] 複数source候補があるとき暗黙に一つを選ばない。
- [ ] source、言語、問題contextを外部作用前に確認できる。

### 可搬性

- [ ] 絶対pathを履歴の恒久IDにしていない。
- [ ] source snapshotがpathなしで`show`、`diff`、exportできる。
- [ ] 端末固有path、toolchain、Editor設定を共有DBへ同期しない。
- [ ] source bytesを改行・文字コードの暗黙変換なしで保持する。

---

## 11. 最終方針

AlgoLoomの拡張性は、すべてを動的設定へすることではなく、変更理由の異なる差異を別々の境界へ閉じ込めることで確保する。

```text
解答言語を追加する  → LanguageProfileを追加する
host OSを追加する   → HostPlatform Adapterを追加する
judgeを追加する     → JudgeAdapterを追加する
AIを追加する        → Coreの安定した参照契約を利用する任意Capabilityを追加する
Cloud同期を追加する → local-firstの保存契約を利用する任意Capabilityを追加する
```

いずれの追加でも、既存command、履歴、snapshot、提出、offline参照の意味を変更しない。共通部分の変更が必要な場合は、局所的な都合で広げず、Core契約と全既存Adapterの回帰テストを先に確認する。
