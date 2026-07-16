# AlgoLoom ローカル利用とCloud同期の段階的設計

> 対象: AlgoLoomをローカルだけで利用する構成と、複数端末同期を追加する構成の関係、導入UX、保存・同期状態、パッケージ配布
>
> 状態: 設計方針
>
> 作成日: 2026年7月16日
>
> 関連文書:
> - [プロジェクト草案](../concept.md)
> - [AlgoLoom配布方針ガイド](../distribution/algoloom-distribution.md)
> - [AlgoLoom Turso設計ガイド](./turso-design-guide.md)
> - [AlgoLoom Turso移行互換性設計](./turso-migration-compatibility-design.md)
>
> 注意: TursoのSDK、同期方式、対応OS、料金、制約は変更される可能性がある。実装開始時とリリース前に公式資料と配布wheelを再確認すること。

---

## 0. 結論

AlgoLoomでは、ローカル利用と同期利用を別々の製品や独立したシステムとして設計しない。

**同期利用は、ローカル利用を土台としてCloud同期機能を追加した上位構成である。**

```text
ローカル利用 = AlgoLoom Core + ローカルDB

同期利用       = AlgoLoom Core + ローカルDB + Cloud同期機能
```

```mermaid
flowchart LR
    subgraph LocalOnly[ローカル利用・基本構成]
        CLI[AlgoLoom CLI]
        APP[Application / Domain]
        DB[(ローカルユーザーDB)]
        CLI --> APP
        APP --> DB
    end

    subgraph SyncAddition[同期利用で追加する機能]
        SC[SyncCoordinator]
        AUTH[認証・端末情報]
        CLOUD[(Turso Cloud)]
        SC --> CLOUD
        AUTH --> SC
    end

    APP -. 同期を有効化した場合だけ利用 .-> SC
    DB <--> SC

    style LocalOnly fill:#eff6ff,stroke:#2563eb,stroke-width:2px
    style SyncAddition fill:#f0fdf4,stroke:#16a34a,stroke-width:2px
```

この構成で守る中心原則は次のとおりである。

- `pip install algoloom`後、Tursoアカウントなしで主要機能を利用できる。
- 履歴は同期の有無にかかわらず、最初にローカルへ永続保存する。
- 同期を有効化しても、主要コマンドと論理データモデルを変更しない。
- Cloud障害や未認証を理由に、ローカルで可能な操作を止めない。
- 同期の有効化・無効化・再有効化・データexportを安全に行える。
- Cloudへ送信するデータと認証処理は、ユーザーの明示的な同意後にだけ有効化する。

この方針はTurso Syncの「ローカルでcommitし、後から`push()` / `pull()`する」方式と自然に一致する。Embedded Replicaを利用する場合も同じ製品UXを保つが、Cloud primaryへの書き込みとoutboxの統合が必要になるため、内部実装は複雑になる。

---

## 1. 目的と対象外

### 1.1. 目的

- OSS利用者がCloudサービスを契約せず、短時間でAlgoLoomを使い始められるようにする。
- 複数端末同期を、既存のローカル環境へ後から追加できるようにする。
- ローカル利用と同期利用で、CLI、論理スキーマ、業務ルールを共通化する。
- 同期機能の依存パッケージや認証障害を、基本機能から隔離する。
- 同期を無効化しても、ユーザーがローカル履歴へアクセスできるようにする。
- 将来Turso SDKや同期方式を変更しても、上位層のUXを維持する。

### 1.2. 対象外

- Cloudアカウントをユーザーに無断で作成すること
- 開発者所有のTurso URLや管理トークンを配布物へ埋め込むこと
- 大人数によるリアルタイム共同編集
- 同期をバックアップの代わりにすること
- 異なる端末の編集中ワークスペースを自動マージすること
- AtCoderの認証情報やセッションCookieをCloudへ同期すること
- Python、コンパイラ、Ollama、LLMモデル等を無断でシステムへインストールすること

---

## 2. 用語

| 用語 | 本文書での意味 |
|---|---|
| ローカル利用 | Cloud同期を有効化せず、ユーザーデータを利用端末内へ保存する構成 |
| 同期利用 | ローカル利用の全機能に、Turso Cloudを介した複数端末共有を追加した構成 |
| AlgoLoom Core | CLI、Application、Domain、ローカル保存等、同期の有無にかかわらず利用する機能 |
| ローカルユーザーDB | 提出履歴、コード、レビュー等を端末内へ永続保存するDB |
| 同期機能 | `push`、`pull`、bootstrap、認証、同期状態管理、再試行等をまとめた任意機能 |
| 共有確定 | ローカルの変更がCloudへ反映され、別端末から取得可能になった状態 |
| pending | ローカルへ永続保存済みだが、Cloudへの共有が完了していない状態 |
| bootstrap | 新しい端末へCloud上の共有済みデータを取り込み、ローカルDBを初期構築すること |
| BYOC | Bring Your Own Cloud。各ユーザーが自分のTursoアカウント、DB、トークンを用意する方式 |
| AlgoLoom Cloud | 将来候補。AlgoLoom側のサービスが認証とユーザー用DBの払い出しを代行するマネージド方式 |

「non-sync」と「sync」は実装名として固定せず、ユーザー向けには原則として「ローカル利用」「Cloud同期有効」と表現する。同期を無効化した状態が機能不足に見えないようにし、ローカル利用を正式な完成形の1つとして扱う。

---

## 3. 構成の包含関係

### 3.1. 同期利用でも変わらないもの

| 領域 | ローカル利用 | 同期利用 |
|---|---|---|
| `get` / `test` / `submit` | 利用する | 同じものを利用する |
| `log` / `show` / `diff` | ローカルDBから読む | 同じローカルDBアクセス境界から読む |
| 論理データモデル | 共通 | 共通 |
| UUID・一意制約・冪等性 | 共通 | 共通 |
| ローカル永続化 | 必須 | 必須 |
| ワークスペース | 端末ごと | 端末ごと。原則として同期対象外 |
| 問題カタログ | ローカルキャッシュ | 同じ。Cloud同期対象外 |

### 3.2. 同期利用で追加するもの

| 追加要素 | 役割 |
|---|---|
| `SyncCoordinator` | `push`、`pull`、再試行、状態取得を統一する |
| Turso Adapter | ローカルDBとTurso Cloudの同期を実装する |
| Cloud認証 | DB URL、DB専用トークン、端末登録を管理する |
| 同期状態 | 最終成功時刻、pending件数、最終エラー等を保持する |
| bootstrap | 新しい端末へ共有済み履歴を復元する |
| 同期コマンド | `sync enable/status/run/retry/disable`を提供する |

```mermaid
flowchart TB
    CORE[AlgoLoom Core]
    CORE --> CMD[主要CLIコマンド]
    CORE --> MODEL[共通論理モデル]
    CORE --> LOCAL[(ローカルユーザーDB)]

    LOCALMODE[ローカル利用] --> CORE

    SYNCMODE[同期利用] --> CORE
    SYNCMODE --> CAP[Cloud同期Capability]
    CAP --> LOCAL
    CAP <--> CLOUD[(Turso Cloud)]

    style CORE fill:#dbeafe,stroke:#2563eb,stroke-width:2px
    style CAP fill:#dcfce7,stroke:#16a34a,stroke-width:2px
```

### 3.3. 重要な不変条件

同期有効化の前後で、次の操作結果を変えない。

- `submit`後、ローカル保存に成功した履歴は直ちに`log`へ表示される。
- `show`と`diff`は、Cloud接続の成否にかかわらずローカルに存在するコードを扱える。
- Cloud同期失敗をAtCoderへの提出失敗として表示しない。
- 同期を無効化しても、ローカル履歴を削除しない。
- 同じAtCoder submission IDを複数回取得しても重複登録しない。

---

## 4. 論理アーキテクチャ

### 4.1. レイヤー構成

```mermaid
flowchart TB
    subgraph Presentation[Presentation]
        MainCmd[get / test / submit / log / show / diff]
        SyncCmd[sync enable / run / status / disable]
    end

    subgraph Application[Application]
        SubmissionService[SubmissionService]
        HistoryService[HistoryService]
        SyncService[SyncService・任意Capability]
    end

    subgraph Ports[安定したPorts]
        HistoryPort[HistoryStore]
        TxPort[UnitOfWork]
        SyncPort[SyncCoordinator]
    end

    subgraph LocalCore[常に存在するLocal Core]
        LocalAdapter[LocalHistoryAdapter]
        LocalDB[(ローカルユーザーDB)]
        Catalog[(catalog.sqlite)]
    end

    subgraph OptionalSync[同期時だけ有効]
        TursoAdapter[TursoSyncAdapter]
        Sidecar[(同期状態sidecar)]
        Cloud[(Turso Cloud)]
    end

    MainCmd --> SubmissionService
    MainCmd --> HistoryService
    SyncCmd --> SyncService
    SubmissionService --> HistoryPort
    SubmissionService --> TxPort
    HistoryService --> HistoryPort
    HistoryPort --> LocalAdapter
    TxPort --> LocalAdapter
    LocalAdapter --> LocalDB
    HistoryService --> Catalog
    SyncService --> SyncPort
    SyncPort --> TursoAdapter
    TursoAdapter <--> LocalDB
    TursoAdapter --> Sidecar
    TursoAdapter <--> Cloud

    style LocalCore fill:#eff6ff,stroke:#2563eb,stroke-width:2px
    style OptionalSync fill:#f0fdf4,stroke:#16a34a,stroke-width:2px
```

Presentation、SubmissionService、HistoryServiceは、Turso SDK、DB URL、認証トークン、`push()`、`pull()`を知らない。同期固有処理は`SyncService`、`SyncCoordinator`、Adapterへ閉じ込める。

### 4.2. Portの概念

```python
class HistoryStore(Protocol):
    def save_submission(self, submission: Submission) -> WriteReceipt:
        ...

    def list_submissions(self, query: SubmissionQuery) -> list[SubmissionView]:
        ...

    def get_submission(self, submission_id: str) -> SubmissionView | None:
        ...


class SyncCoordinator(Protocol):
    def enable(self, settings: SyncSettings) -> SyncEnableResult:
        ...

    def run(self) -> SyncResult:
        ...

    def status(self) -> SyncStatus:
        ...

    def disable(self, keep_local: bool = True) -> SyncDisableResult:
        ...
```

`HistoryStore`は常にローカル永続化を提供する。`SyncCoordinator`は任意Capabilityであり、無効時に主要コマンドから呼び出す必要はない。

---

## 5. データの権威と保存状態

### 5.1. データの権威

| データ | ローカル利用 | 同期利用 |
|---|---|---|
| 編集中のコード | 各端末のワークスペース | 同じ。原則としてCloud同期しない |
| ローカル保存済み履歴 | ローカルユーザーDBが正本 | その端末での最新状態。未pushを含み得る |
| 複数端末で共有済みの履歴 | 存在しない | Turso Cloud上の共有確定状態 |
| AtCoder提出ID・判定 | AtCoderが外部の権威 | 同じ |
| 同期状態 | 存在しない、または`DISABLED` | 端末ローカルのsidecarまたはSDK統計 |
| バックアップ | 独立した世代別コピー | 同期とは別に独立した世代別コピー |

同期利用では、ローカルとCloudの役割を次のように分ける。

- ローカルcommit成功は「この端末から回復できる」ことを意味する。
- push成功は「別端末から取得できる」ことを意味する。
- 未push変更がある間、Cloudだけを唯一の最新状態とはみなさない。
- Cloudは複数端末間の共有確定状態を集約する。

### 5.2. 共通の保存・同期状態

| 状態 | 意味 | 同期無効時 | 同期有効時 |
|---|---|---:|---:|
| `LOCAL_SAVE_FAILED` | ローカル永続化に失敗 | 使用する | 使用する |
| `LOCAL_ONLY` | ローカル保存済みで同期対象ではない | 通常状態 | 同期対象外データに使用 |
| `SYNC_PENDING` | ローカル保存済み、Cloud未反映 | 使用しない | 使用する |
| `SYNCED` | Cloudへ反映済み | 使用しない | 使用する |
| `SYNC_FAILED_RETRYABLE` | ローカルデータを保持し、再送が必要 | 使用しない | 使用する |

```mermaid
stateDiagram-v2
    [*] --> LocalSaving: ローカル保存開始
    LocalSaving --> LocalSaveFailed: commit失敗
    LocalSaving --> LocalOnly: commit成功・同期無効
    LocalSaving --> SyncPending: commit成功・同期有効
    SyncPending --> Synced: push成功
    SyncPending --> SyncFailed: push失敗
    SyncFailed --> Synced: retry成功
    LocalOnly --> SyncPending: 同期を有効化
    Synced --> LocalOnly: 同期を無効化・ローカル保持
```

### 5.3. `submit`の表示例

ローカル利用:

```text
AtCoder submission: Accepted
Local history:      Saved
Cloud sync:         Disabled
```

同期利用・成功:

```text
AtCoder submission: Accepted
Local history:      Saved
Cloud sync:         Synced
```

同期利用・Cloud障害:

```text
AtCoder submission: Accepted
Local history:      Saved
Cloud sync:         Pending (retry: algoloom sync retry)
```

Cloud同期の結果は、AtCoder提出とローカル保存の結果から分離して表示する。

---

## 6. ローカルファイルと物理DB

### 6.1. 推奨配置

```text
<OSの標準データディレクトリ>/algoloom/
├── user.sqlite              # ユーザー履歴のローカルDB
├── device.json              # device ID等。秘密情報は置かない
└── sync-state.sqlite        # 同期有効時のみ。最終同期時刻・エラー等

<OSの標準設定ディレクトリ>/algoloom/
└── config.toml              # 秘密を除く設定

<OSの標準キャッシュディレクトリ>/algoloom/
└── catalog.sqlite           # 再取得可能な問題カタログ
```

認証トークンは平文の`config.toml`やワークスペースへ保存せず、OS keyring等の秘密情報ストアを優先する。

### 6.2. 標準SQLiteとTurso管理DBの関係

理想は、同期の有効化前後で同じローカルDBファイルと同じドライバーを使うことである。しかし、OSSの基本インストールでは、Tursoのネイティブ依存を必須にしない方が導入成功率を高められる。

そのため初期版では、次の設計を許容する。

| 構成 | ローカルDB実装 |
|---|---|
| ローカル利用 | Python標準`sqlite3` |
| 同期利用 | 検証済みのTurso Sync対応ドライバー |

同期有効化時に物理DBの変換が必要な場合は、次の条件を守る。

1. 変換前に整合したバックアップを作成する。
2. 新しい一時DBへ共通マイグレーションを適用する。
3. UUID、件数、コードハッシュ、一意制約を検証する。
4. 初回pushとCloud側の検証が成功するまで旧DBを保持する。
5. 失敗時は旧DBへ戻し、ローカル利用を継続できるようにする。
6. 変換後も`HistoryStore`とCLIの契約を変えない。

この内部変換は「別システムへの移行」ではなく、同期Capabilityを追加するためのストレージAdapter切り替えとして扱う。

---

## 7. ユーザーフロー

### 7.1. インストールからローカル利用開始まで

```mermaid
flowchart LR
    A[pip / pipx / uv toolでインストール] --> B[algoloom init]
    B --> C[設定ディレクトリ作成]
    C --> D[ローカルDB作成・migration]
    D --> E[利用環境をdoctor]
    E --> F[主要機能を利用開始]

    style F fill:#dcfce7,stroke:#16a34a,stroke-width:2px
```

初回起動時のルール:

- Tursoアカウントを要求しない。
- 同期設定を必須質問にしない。
- デフォルト値で安全に作成できる項目は自動作成する。
- 不足している外部ツールは、必要な機能と影響を説明する。
- Ollamaや各言語コンパイラがなくても、無関係なコマンドを利用可能にする。

### 7.2. 既存端末で同期を有効化する

```mermaid
flowchart TD
    A[algoloom sync enable] --> B[同期依存・対応環境を検査]
    B -->|不足| X[正確な追加インストール方法を案内]
    B -->|利用可能| C[Cloud送信内容・料金・無効化方法を説明]
    C --> D{ユーザーが同意?}
    D -->|No| Z[ローカル利用を継続]
    D -->|Yes| E[Turso認証・DB選択または作成]
    E --> F[ローカルDBをバックアップ]
    F --> G[必要なら物理DBを安全に変換]
    G --> H[既存データを初回push]
    H --> I[Cloudとローカルの件数・hashを検証]
    I -->|成功| J[同期を有効化]
    I -->|失敗| K[旧DBへrollback]
    K --> Z

    style J fill:#dcfce7,stroke:#16a34a,stroke-width:2px
    style Z fill:#eff6ff,stroke:#2563eb
```

有効化は、すべて完了した場合だけcommitする。途中失敗で「同期は有効だがDB変換は未完了」のような中間状態を残さない。

### 7.3. 同期有効時の通常処理

```mermaid
flowchart TD
    A[コマンド開始] --> B[best-effort pull]
    B --> C[ローカルDBで読み書き]
    C --> D{ローカル変更あり?}
    D -->|No| E[結果を表示して終了]
    D -->|Yes| F[ローカルcommit]
    F -->|失敗| G[ローカル保存失敗を表示]
    F -->|成功| H[best-effort push]
    H -->|成功| I[Syncedを表示]
    H -->|失敗| J[Pendingを保持して終了]
    J --> K[次回起動またはsync retryで再送]
```

通常コマンドでは、ネットワーク障害によってローカルで可能な処理まで止めない。詳細な診断と復旧は同期コマンドへ分離する。

### 7.4. 新しい端末を追加する

1. 新端末へAlgoLoomと同期依存をインストールする。
2. `algoloom sync connect`を実行する。
3. 既存のTurso DBへ認証する。
4. Cloudから新しいローカルDBへbootstrapする。
5. 件数、主キー、コードハッシュ、スキーマバージョンを検証する。
6. 端末固有のdevice IDを登録する。
7. ローカルDBから`log`、`show`、`diff`を実行する。

### 7.5. 同期を無効化する

```mermaid
flowchart TD
    A[algoloom sync disable] --> B{pending変更がある?}
    B -->|No| E[同期設定を無効化]
    B -->|Yes| C{最終pushを試す?}
    C -->|Yes| D[pushを実行]
    C -->|No| F[未共有データがあることを確認]
    D --> E
    F --> E
    E --> G[Cloud認証情報を端末から削除]
    G --> H[ローカルDBと履歴は保持]
```

- 同期無効化とCloud上のデータ削除は別操作にする。
- オフラインでも、確認後に同期を無効化できるようにする。
- デフォルトではローカルデータを保持する。
- Cloudデータ削除には再認証と明示確認を要求する。

---

## 8. CLI設計

| コマンド案 | 同期無効時 | 同期有効時 | 目的 |
|---|---|---|---|
| `algoloom init` | ローカルDBを初期化 | 既存設定を維持 | 利用開始 |
| `algoloom doctor` | Python・外部ツール・DBを診断 | 同期依存も追加診断 | 問題の切り分け |
| `algoloom sync enable` | 同期を追加 | 設定済みと表示 | 既存端末で同期開始 |
| `algoloom sync connect` | Cloudからbootstrap | 接続先を表示 | 新端末追加 |
| `algoloom sync run` | 同期無効を表示 | pull / pushを実行 | 明示同期 |
| `algoloom sync status` | `Disabled / Local only` | pending、最終成功、エラーを表示 | 状態確認 |
| `algoloom sync retry` | 同期無効を表示 | pendingを再送 | 障害復旧 |
| `algoloom sync disable` | 変更なし | Cloud同期だけを停止 | ローカル利用へ戻す |
| `algoloom export` | ローカルデータをexport | 共有済み・pendingを含めてexport | 可搬性・退避 |
| `algoloom backup` | 整合バックアップを作成 | 同期とは独立して作成 | 復元手段の確保 |

`sync enable`の対話例:

```text
$ algoloom sync enable

Cloud sync adds multi-device sharing to your existing local history.

Data sent to Turso Cloud:
  - submission history and source code
  - verdicts and AI review records

Never sent:
  - AtCoder passwords or session cookies
  - workspace files that have not been submitted

Local history will remain available if sync is disabled.
Continue? [y/N]
```

通常コマンドでCloud同期を繰り返し宣伝しない。ユーザーが複数端末利用を求めたとき、`sync`コマンドを実行したとき、または明示的にヘルプを開いたときに案内する。

---

## 9. パッケージ配布と依存関係

### 9.1. 配布単位

```text
pip install algoloom
    └── ローカル利用に必要な依存だけを導入

pip install "algoloom[sync]"
    └── 上記 + 検証済みのTurso同期依存を導入
```

Pythonパッケージのoptional dependenciesを使用し、Cloud同期を利用しないユーザーへネイティブSDKを強制しない。

| 依存 | 基本パッケージ | `sync` extra |
|---|:---:|:---:|
| CLIフレームワーク | 必須 | 共通 |
| 表示・設定ライブラリ | 必須 | 共通 |
| online-judge-tools連携 | 必須または機能単位で整理 | 共通 |
| Python標準`sqlite3` | Python同梱 | 共通 |
| Turso Python SDK | 含めない | 含める |
| OS keyring連携 | 最小構成を検討 | 原則として含める |
| Turso CLI | 自動同梱しない | 既存インストールを利用可能 |

### 9.2. インストール時の原則

- アプリ実行中に、自分自身のPython環境へ勝手に`pip install`しない。
- 同期依存がない場合は、使用中の導入方法に合った正確なコマンドを表示する。
- 対応wheelがないOS・Python・CPUでは、同期機能だけを利用不可にし、基本インストールを失敗させない。
- `pip`、`pipx`、`uv tool`のそれぞれでインストール・upgrade・uninstallをCI検証する。
- sdistからの暗黙ビルドへ依存せず、リリース対象ではwheelによる導入成功を確認する。
- 初期版で対応しない環境は、曖昧にせず明示する。

### 9.3. 将来の単一インストーラー

Python自体の導入障壁も下げる場合は、PyPI配布とは別に次を検討する。

- Homebrew tap
- GitHub Releasesのstandalone executable
- OS別インストーラー
- ハッシュ検証付きの公式bootstrap script

単一実行ファイル化しても、Tursoアカウント作成、Cloud送信への同意、認証はユーザーの明示操作として残す。

---

## 10. Turso接続方式への含意

### 10.1. 方式比較

| 評価軸 | Turso Sync | Embedded Replica |
|---|---|---|
| ローカル利用への機能追加として説明しやすい | **高い** | 中程度 |
| 通常の書き込み先 | ローカルDB | Cloud primary |
| Cloud障害時のローカル書き込み | 可能 | outboxによる補完が必要 |
| 同期有効化前後のUX一貫性 | **高い** | Adapterで吸収が必要 |
| 競合処理 | last-push-wins等の設計が必要 | primaryで直列化しやすい |
| Python SDK・耐久性検証 | 必須 | 必須 |

### 10.2. 本文書から導かれる方針

「同期利用はローカル利用への追加機能」という製品モデルには、Turso Syncがより自然に適合する。

したがって、実装順序は次を推奨する。

1. 標準SQLite Adapterでローカル利用を完成させる。
2. 共通論理スキーマとPortを固定する。
3. Turso Sync Adapterを試作する。
4. wheel、commit、push、pull、競合、強制終了、bootstrapを検証する。
5. 合格すればTurso Syncを同期Capabilityとして採用する。
6. 不合格の場合だけ、Embedded Replica + outboxを暫定Adapterとして検討する。

Embedded Replicaを暫定採用する場合も、ユーザーへ「Cloud版のAlgoLoomへ切り替わった」と見せてはならない。`HistoryStore`がローカルレプリカとoutboxを統合し、ローカル利用へ同期機能を追加した同じUXを提供する。

既存のTurso設計ガイドに記載された最終的な方式選択は、試作結果を反映して別途更新する。本文書は方式選択より上位にある製品構造とUX契約を定義する。

---

## 11. 障害時の動作

| 状況 | ローカル利用 | 同期利用 |
|---|---|---|
| インターネット切断 | ローカル機能を継続 | ローカル機能を継続し、変更をpendingにする |
| Turso障害 | 影響なし | ローカルcommitを維持し、後で再送する |
| 認証期限切れ | 影響なし | ローカル機能を継続し、再認証を案内する |
| 同期依存のimport失敗 | 影響なし | 同期だけを停止し、修復方法を表示する |
| ローカルDB commit失敗 | 保存失敗 | Cloudへ送らず保存失敗を表示する |
| push成功後の強制終了 | 該当なし | 冪等キーまたは同期統計で重複を避ける |
| pull中の強制終了 | 該当なし | 元の整合状態を維持し、次回再試行する |
| Cloud上の誤削除 | 影響なし | 同期で波及し得るため、独立バックアップから復元する |

障害表示では、少なくとも次を区別する。

- AtCoderへの提出結果
- ローカルDBへの保存結果
- Cloudへの同期結果
- バックアップの状態

---

## 12. セキュリティとプライバシー

### 12.1. 同期有効化前の同意

同期を有効化する前に、次を表示する。

- Cloudへ送るデータ
- Cloudへ送らないデータ
- 利用する外部サービス名
- 無料枠と課金可能性を確認する場所
- 同期を無効化する方法
- ローカルおよびCloudデータをexport・削除する方法

### 12.2. 認証情報

- 開発者所有のTurso管理トークンを配布物へ含めない。
- BYOCではユーザーごとにDB専用・必要最小権限のトークンを使う。
- Platform APIトークンをCLIへ保存しない。
- DBトークンをGit、ログ、クラッシュレポート、shell履歴へ出さない。
- OS keyringを利用できない場合は、保存方法とリスクを明示する。
- `sync disable`時に、端末上の認証情報を削除できるようにする。

### 12.3. 同期対象外

- AtCoderパスワード
- AtCoderセッションCookie
- ブラウザプロファイル
- 環境変数の全内容
- 未提出のワークスペースファイル
- コンパイラやエディタの個人設定
- Turso Platform APIトークン

---

## 13. BYOCと将来のマネージド同期

### 13.1. 初期OSS版: BYOC

```mermaid
flowchart LR
    USER[ユーザー] --> LOGIN[Tursoへ認証]
    LOGIN --> DB[(ユーザー所有DB)]
    CLI[AlgoLoom CLI] <-->|DB専用token| DB
```

利点:

- AlgoLoom開発者がユーザーデータを預からない。
- 運用費とサービス障害責任を抑えられる。
- ユーザーがDB、料金、export、削除を管理できる。

課題:

- Tursoアカウント作成が必要になる。
- DB作成と認証の導線を整える必要がある。
- Turso CLIまたは公式ダッシュボードとの連携が必要になる。

### 13.2. 将来候補: AlgoLoom Cloud

```mermaid
sequenceDiagram
    participant U as User
    participant CLI as AlgoLoom CLI
    participant AC as AlgoLoom Cloud
    participant T as Turso Platform API

    U->>CLI: sync enable
    CLI->>AC: ブラウザ認証
    AC->>T: ユーザー用DBを作成
    T-->>AC: DB URL・限定token
    AC-->>CLI: CLI用credential
    CLI->>T: 初回同期
```

この方式はワンクリックに近いUXを提供できるが、次の責任を新たに持つ。

- 認証サービスの運用
- 利用規約とプライバシーポリシー
- Turso Platform APIトークンの保護
- 不正利用、課金、障害、退会処理
- ユーザーごとのexport・削除

初期OSS版の必須要件にはせず、BYOCの利用状況を確認した後に別サービスとして判断する。

---

## 14. 段階的な実装計画

```mermaid
flowchart LR
    P1[Phase 1<br/>ローカル利用] --> P2[Phase 2<br/>同期Adapter試作]
    P2 --> G{耐久・配布テスト合格?}
    G -->|Yes| P3[Phase 3<br/>BYOC同期Beta]
    G -->|No| R[Adapter再検討]
    R --> P2
    P3 --> P4[Phase 4<br/>同期UX安定化]
    P4 --> P5{マネージド需要あり?}
    P5 -->|Yes| P6[Phase 5<br/>AlgoLoom Cloud検討]
    P5 -->|No| P4
```

### Phase 1: ローカル利用

- 標準SQLiteで共通論理スキーマを実装する。
- `submit`、`log`、`show`、`diff`を完成させる。
- マイグレーション、export、backup、restoreを実装する。
- `HistoryStore`、`UnitOfWork`、`WriteReceipt`の契約テストを作る。
- Tursoなしのクリーン環境でインストールと初回起動を検証する。

### Phase 2: 同期Adapter試作

- `SyncCoordinator`を定義する。
- Turso Sync Adapterを第一候補として実装する。
- 標準SQLiteから同期対応DBへの安全な有効化手順を試作する。
- 2端末、オフライン、競合、強制終了、bootstrapを検証する。
- 対応OS・Python・CPUでwheelインストールを検証する。

### Phase 3: BYOC同期Beta

- `sync enable/connect/status/run/retry/disable`を提供する。
- 同期有効化時の同意、認証、keyring保存を実装する。
- 同期失敗時もローカル機能が継続することを確認する。
- 限定ユーザーでセットアップ時間と失敗箇所を計測する。

### Phase 4: 同期UX安定化

- 認証・DB作成の案内を自動化する。
- upgrade、再認証、token失効、端末削除を整備する。
- import/exportとCloud削除を整備する。
- 対応環境を拡大し、インストールCIを強化する。

### Phase 5: AlgoLoom Cloud検討

- BYOC離脱理由を調査する。
- 運用費、認証、法務、プライバシーを評価する。
- OSS版とマネージド版の責任範囲を分離する。

---

## 15. 受け入れ基準

### 15.1. ローカル利用

- [ ] Tursoアカウントなしで`pip install algoloom`が成功する。
- [ ] Turso SDKなしで`algoloom init`が成功する。
- [ ] 初回起動時にローカルDBとスキーマが自動作成される。
- [ ] Cloud未設定でも主要コマンドが利用できる。
- [ ] Cloud同期を有効化するよう繰り返し要求しない。
- [ ] exportとbackupから別環境へ復元できる。

### 15.2. 同期の追加

- [ ] 既存ローカルデータを失わず同期を有効化できる。
- [ ] 同期有効化前後でUUID、件数、コードハッシュが一致する。
- [ ] Cloud障害時もローカルへ保存し、履歴を参照できる。
- [ ] 新端末へbootstrapできる。
- [ ] 同じsubmission IDを重複登録しない。
- [ ] pending件数と最終同期時刻を確認できる。
- [ ] 同期を無効化してもローカル履歴を利用できる。
- [ ] 認証情報が設定ファイル、ログ、Gitへ漏れない。

### 15.3. インストール

- [ ] `pip`、`pipx`、`uv tool`で基本パッケージを導入できる。
- [ ] 対応環境で`algoloom[sync]`をwheelだけから導入できる。
- [ ] 同期非対応環境でも基本パッケージのインストールは成功する。
- [ ] 同期依存不足時に、利用中の導入方法に合った修復手順を表示する。
- [ ] ネイティブビルドツールがないクリーン環境でテストする。

### 15.4. UX目標

初期目標値として次を計測する。

| 指標 | 目標 |
|---|---:|
| 基本インストールから`algoloom --version`成功まで | 2分以内 |
| `algoloom init`完了までの必須質問 | 3問以下 |
| Tursoなしで主要機能を開始できたユーザー | 100% |
| 対応環境での基本インストール成功率 | 99%以上 |
| BYOC同期の有効化 | 5分以内 |
| 同期有効化失敗時のローカルデータ消失 | 0件 |

時間だけでなく、ユーザーが外部ドキュメントを何ページ開いたか、秘密情報を何回コピーしたか、失敗から自己回復できたかも計測する。

---

## 16. 実装チェックリスト

### 境界

- [ ] 同期利用をローカル利用への追加Capabilityとして実装している。
- [ ] 主要コマンドがTurso SDKを直接呼んでいない。
- [ ] 論理スキーマとRepository契約が同期の有無で共通である。
- [ ] 同期依存のimportを同期機能の境界まで遅延できる。

### データ

- [ ] すべての履歴をCloud送信前にローカルへ永続化する。
- [ ] UUIDとjudge submission IDで冪等化している。
- [ ] 同期状態を共有業務テーブルへ直接保存していない。
- [ ] DB変換時に件数・主キー・コードハッシュを検証する。
- [ ] 同期とは別のバックアップを用意している。

### UX

- [ ] 初回利用でCloud設定を要求しない。
- [ ] Cloud送信前にデータ範囲を説明して同意を得る。
- [ ] AtCoder提出、ローカル保存、Cloud同期を別々に表示する。
- [ ] 同期無効化後もローカル履歴を保持する。
- [ ] pendingと再送方法を明確に表示する。

### 配布

- [ ] Turso SDKを基本パッケージの必須依存にしていない。
- [ ] 対応wheelがある環境をCIで検証している。
- [ ] unsupported環境を明記している。
- [ ] CLIが無断で外部バイナリやPython依存をインストールしない。

---

## 17. 関連文書との責任分担

| 文書 | 主な責任 |
|---|---|
| [プロジェクト草案](../concept.md) | 製品目的、主要機能、基本的な利用体験 |
| [配布方針ガイド](../distribution/algoloom-distribution.md) | PyPI公開、ライセンス、AtCoder規約、公開版の安全性 |
| 本文書 | ローカル利用と同期利用の包含関係、導入UX、追加Capabilityとしての同期設計 |
| [Turso設計ガイド](./turso-design-guide.md) | Turso方式、データの権威、outbox、競合、バックアップ |
| [Turso移行互換性設計](./turso-migration-compatibility-design.md) | Adapter境界、方式変更、契約テスト、移行手順 |

本文書は「同期機能を使うか」という製品・UX上の選択を扱う。Turso設計ガイドと移行互換性設計は「同期機能をどのSDK・方式で実現するか」という内部実装の選択を扱う。

---

## 18. 公式資料

- [Python Packaging User Guide: `pyproject.toml`](https://packaging.python.org/en/latest/guides/writing-pyproject-toml/)
- [pip Dependency Resolution](https://pip.pypa.io/en/latest/topics/dependency-resolution/)
- [Turso Python Quickstart](https://docs.turso.tech/sdk/python/quickstart)
- [Turso CLI Authentication](https://docs.turso.tech/cli/authentication)
- [Turso Sync Usage](https://docs.turso.tech/sync/usage)
- [Turso Sync Conflict Resolution](https://docs.turso.tech/sync/conflict-resolution)
- [Turso Platform API](https://docs.turso.tech/api-reference/introduction)
- [pyturso on PyPI](https://pypi.org/project/pyturso/)

---

## 19. 最終方針

AlgoLoomの基本単位は、常にローカルで動作するAlgoLoom Coreである。

```text
同期なし: AlgoLoom Core + Local DB
同期あり: AlgoLoom Core + Local DB + Sync Capability + Turso Cloud
```

- ローカル利用だけでも完成した学習体験を提供する。
- 同期利用はローカル利用を置き換えず、複数端末共有を追加する。
- データは最初にローカルへ保存し、その後Cloudへ共有する。
- 同期の有無でCLI、論理モデル、ローカル履歴の見え方を変えない。
- 同期有効化は明示的、段階的、検証可能、ロールバック可能にする。
- 同期方式はTurso Syncを第一候補として検証し、製品上の包含関係をAdapter内部の都合で崩さない。
- インストールの容易さを守るため、Turso SDKは同期用の任意依存として配布する。

この設計により、初めて使うユーザーには最短の導入体験を提供し、複数端末を必要とするユーザーには、既存データと操作方法を維持したままCloud同期を追加できる。
