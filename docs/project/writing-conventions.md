# AlgoLoom ドキュメント表記規則

> 対象: このリポジトリのすべてのMarkdown文書
>
> 状態: 表記の正本
>
> 作成日: 2026年8月9日

## ドキュメント概要

本書は、日本語と英語の混在によって読解が中断される問題を防ぐため、どの語を日本語で書き、どの語を英語のまま残すかを定義します。

## 0. 結論

読み手が語の意味を調べ直さずに読み進められることを最優先とします。

> 一般語は日本語で書く。コード上の名前だけを英語で残し、見た目で区別できるようにする。

英語を減らすこと自体は目的ではありません。実装と対応付ける必要がある名前まで訳すと、コードと文書の対応が失われます。そのため語を次の2種類へ分けます。

| 種別 | 扱い | 例 |
|---|---|---|
| 一般語 | 日本語（訳語を優先し、定着したカタカナ語を許容） | ソースコード、作業領域、ディレクトリ、ブラウザ |
| コード上の名前 | 英語のまま。初出で日本語の意味を併記 | `SolveAttempt`、`LanguageProfile`、`PREPARED`、`get` |

## 1. 英語のまま残す語

次のいずれかに当てはまる語だけを英語で書きます。それ以外はすべて日本語で書きます。

| 分類 | 書き方 | 該当する語 |
|---|---|---|
| 論理モデル名 | 英語のまま。初出で日本語を併記 | `SolveAttempt`、`FocusInterval` |
| 境界・Port名 | 英語のまま。バッククォートで囲む | `LanguageProfile`、`HostPlatform`、`JudgeAdapter`、`ReferenceLinkProvider`、`BrowserLauncher`、`HistoryStore`、`ProcessRunner`、`BuildPlan`、`RunPlan`、`LearningDataQuery` |
| 状態名 | 英語のまま。バッククォートで囲む | `ACTIVE`、`PAUSED`、`COMPLETED`、`ABANDONED`、`PREPARED`、`SEND_STARTED`、`REMOTE_ACCEPTED`、`VERDICT_PENDING`、`FINAL`、`FAILED_BEFORE_SEND`、`REMOTE_STATUS_UNKNOWN` |
| 操作の概念名 | 英語のまま。バッククォートで囲む | `aloom`、`get`、`test`、`submit`、`log`、`show`、`diff`、`checkpoint`、`export`、`redo`、`attempt`、`status`、`open` |
| 固有名詞 | 英語のまま | AlgoLoom、AtCoder、Turso、SQLite、Python、C++、Go、Rust、macOS、Linux、Windows、WSL、GitHub、PyPI、Git、Neovim |
| 定着した略語 | 英語のまま | MVP、Core、DB、ID、OS、CLI、API、URL、AC、WA、UX、LLM、SDK、HTTP、SQL、JSON、PDF、TTY、UTC、CI、IDE、CPU、E2E、SLO、ADR、PR |
| 技術上の固有表記 | 英語のまま。必要なら日本語を併記 | `argv`、`stdout`、`stderr`、`shell=False`、`unified diff`、`monotonic clock`、`peak RSS` |

論理モデル名を初出で併記する例を次に示します。

```text
新しいSolveAttempt（解答試行）を作る。
`LanguageProfile`はシェル文字列ではなく`BuildPlan`を返す。
```

## 2. 日本語で書く語

### 2.1. 基本語

| 英語 | 表記 | 補足 |
|---|---|---|
| source | ソースコード | 短縮する場合も「ソース」までとする |
| file | ファイル | |
| directory | ディレクトリ | |
| workspace | 作業領域 | |
| context | コンテキスト | 「文脈」とは訳さない |
| command | コマンド | |
| subcommand | サブコマンド | |
| option | オプション | |
| process | プロセス | process tree はプロセスツリー |
| filesystem | ファイルシステム | |
| path | パス | |
| shell | シェル | |
| terminal | ターミナル | 「端末」は利用者のPCを指す語として使うため、混同しない |
| browser | ブラウザ | default browser は既定のブラウザ |
| network | ネットワーク | |
| error | エラー | |
| timeout | タイムアウト | |
| tool | ツール | toolchain はツールチェーン |
| runtime | ランタイム | |
| compiler | コンパイラ | |
| build / compile / run | ビルド / コンパイル / 実行 | |
| template | テンプレート | |
| cache | キャッシュ | |
| data | データ | metadata はメタデータ |
| version | バージョン | versioning はバージョン管理 |
| schema | スキーマ | |
| transaction | トランザクション | |
| migration | マイグレーション | |
| lock | ロック | |
| backup / restore | バックアップ / 復元 | |
| export / import | エクスポート / 取り込み | `export`コマンドを指す場合は英語のまま |
| snapshot | スナップショット | source snapshot はソーススナップショット |
| checkpoint | チェックポイント | `checkpoint`コマンドを指す場合は英語のまま |
| milestone | マイルストーン | learning milestone は学習マイルストーン |
| checkout | 問題チェックアウト | problem checkout の訳。単独では「チェックアウト」 |
| sample | 入出力例 | AtCoderの呼称に合わせる。hidden test は非公開テスト |
| test | テスト | `test`コマンドと`test/`ディレクトリは英語のまま |
| judge | ジャッジ | |
| verdict | 判定 | verdict observation は判定観測 |
| submission | 提出 | submission ID は提出ID |
| account | アカウント | account identity はアカウント識別情報 |
| session | セッション | |
| credential | 認証情報 | |
| secret | 秘密情報 | secret store は秘密情報保管庫 |
| token | トークン | |
| local | ローカル | local-first はローカルファースト |
| offline | オフライン | |
| Cloud | クラウド | |
| Editor | エディタ | |
| Viewer | ビューア | |
| Adapter | アダプタ | 境界名の一部である場合は英語のまま |
| Provider | プロバイダ | |
| plugin | プラグイン | |
| install / update | インストール / 更新 | |
| polling | ポーリング | |
| retry | 再試行 | |
| rollback | ロールバック | |
| commit | コミット | |
| fallback | フォールバック | |
| rename | 名前変更 | |
| merge | 統合 | |
| copy | 複製 | |
| symlink | シンボリックリンク | |
| hash | ハッシュ | code hash はコードハッシュ |
| bytes | バイト列 | |
| resource | リソース | |
| memory | メモリ | peak memory は最大メモリ |
| module | モジュール | |
| table / column | テーブル / カラム | |
| query | クエリ | |
| record | レコード | |
| log | ログ | `log`コマンドを指す場合は英語のまま |
| raw | 生の | raw output は生出力 |
| plain text | プレーンテキスト | |
| markup | マークアップ | |
| spoiler | ネタバレ | spoiler-sensitive はネタバレを含み得る |
| interactive | 対話的 | non-interactive は非対話的 |
| opt-in | 明示的な有効化 | 初出で英語を併記してよい |
| fail closed | 安全側で停止 | 初出で英語を併記してよい |
| allowlist | 許可リスト | |
| privacy | プライバシー | |
| security | セキュリティ | |
| telemetry | テレメトリ | |
| matrix | 検証マトリクス | |
| fixture | フィクスチャ | |
| fault injection | 障害注入 | |
| machine-readable | 機械可読 | |
| stale | 期限切れ | |
| pending | 保留 | |
| catalog | カタログ | |
| crawl | クロール | |
| user preference | 利用者設定 | user-level は利用者単位 |
| working directory | 作業ディレクトリ | |
| executable | 実行ファイル | |
| artifact | 生成物 | build artifact はビルド生成物 |
| exit code | 終了コード | |
| entry point | エントリポイント | |
| daemon | デーモン | |
| repository | リポジトリ | |
| revision | リビジョン | |
| release | リリース | |

### 2.2. 時間を表す語

意味の異なる時間を同じ語で書きません。

| 英語 | 表記 | 意味 |
|---|---|---|
| active duration | 能動時間 | 一時停止を除いて実際に取り組んだ時間の合計 |
| wall elapsed | 実経過時間 | 中断を含む開始から終了までの時間 |
| process duration | 処理時間 | コンパイル、実行、通信等の機械処理に要した時間 |
| compile duration | コンパイル所要時間 | ビルドに要した処理時間 |
| local run duration | ローカル実行時間 | 入出力例ごとのローカル実行の処理時間 |
| judge execution time | ジャッジ実行時間 | AtCoderが返した実行時間 |
| verdict polling time | 判定待機時間 | 判定確定を待った時間 |

### 2.3. 解き直しの区分

| 英語 | 表記 |
|---|---|
| fresh revisit | 白紙からの解き直し |
| snapshot-based revisit | スナップショットからの解き直し |
| in-place new attempt | 現在地での新しい試行 |
| sibling checkout | 同階層の新しい問題チェックアウト |
| origin snapshot | 開始元スナップショット |

## 3. 書き方の規則

- 一般語と日本語を直接つなげた「file保存」「browser起動」のような表記を作りません。
- コード上の名前をバッククォートで囲み、地の文の日本語と視覚的に区別します。
- 一つの文書で同じ語に二つの表記を使いません。
- 見出しにも本節の規則を適用します。見出しを変更する場合は、その文書を参照しているリンクのアンカーを同じ変更で更新します。
- 各文書の用語表には、日本語の表記と、対応する英語のコード上の名前を併記します。
- 引用、コードブロック、外部サービスの画面表示をそのまま示す部分は変換しません。

## 4. 適用範囲

| 範囲 | 状態 |
|---|---|
| `spec/` | 適用済み |
| `docs/` | 未適用。順次適用する |
| `README.md` | 未適用 |

新しい文書は最初から本規則に従って作成します。既存文書を編集する場合は、編集した範囲を本規則へ合わせます。
