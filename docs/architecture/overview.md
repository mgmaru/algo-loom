# AlgoLoom アーキテクチャ概要

## 1. 用語

| 用語 | 本書での意味 |
|---|---|
| Core | AI review、Cloud同期、外部Viewer等の任意機能に依存しないAlgoLoomの中核機能。 |
| Judge Adapter | sample取得、提出、判定確認等のjudge固有処理をCoreから分離する接続境界。 |
| language profile | 言語ごとの拡張子、template、安全なcompile方法、実行方法を定義する設定。 |
| workspace | 問題directoryを配置し、AlgoLoomが作業対象として認識する通常のdirectory。 |
| problem metadata | 正規問題ID等、問題directoryの識別に使う宣言的な情報。 |
| source snapshot | checkpointや提出の時点で保存するsource codeの不変記録。 |
| context | commandが処理対象とするworkspace、問題、sourceの組み合わせ。 |

## 2. システムアーキテクチャ・技術スタック

| 構成要素 | 方針 |
|---|---|
| CLIツール開発言語 | Python (Typer または Click を想定) |
| コア機能補助 | online-judge-tools (スクレイピング、入出力例の取得、提出処理の代行) |
| AIレビュー連携 | ユーザーが明示的に選択するReview Backend。初期候補のlocal Model APIはOllamaとLM Studioとし、将来はBYOKのCloud APIや、公式interfaceを持つCoding Agent Bridgeへ段階的に拡張する。AlgoLoomはProvider本体やモデルをインストール・起動しない。 |
| データベース | ローカルSQLiteを履歴の通常の読み書き先として使用する。基本構成ではPython標準`sqlite3`を使用する。 |
| データ同期・インフラ | 複数端末利用を望むユーザーだけが、Turso Cloudを介した任意の同期機能を有効化できる。Cloudは履歴表示の必須経路ではなく、端末間共有のために使用する。Google Drive等のファイル同期領域へSQLite DBファイルを置かない。 |
| エディタ連携 | AlgoLoom Coreはエディタに依存しない。閲覧や差分表示が必要な場合だけ、ユーザーが選択した外部Editor / ViewerをAdapter経由で起動する。 |

## 3. 解答言語と設定管理

製品構想としてはC++、Python、Go、Rust等の複数言語へ段階的に対応する。MVPはC++とPythonに限定し、安全なcompile/run定義をAlgoLoomの組み込みprofileとして提供する。

将来、user-level設定から拡張子、template、compile/run commandを変更できる構成を検討する。ただし、MVPではworkspace内の設定に任意commandの実行権限を与えない。問題directoryと一緒に移動するmetadataは、問題ID等の宣言的情報だけを持つ。設定と信頼境界の正確な契約は[Core契約](core-contracts.md)を正とする。

## 4. ディレクトリ構成（ハイブリッド型）

コンテキストスイッチを防ぐため、`get`は既定でworkspace直下に「問題ごとのフォルダ」を1階層だけ作成する。この構成は開始時の推奨layoutであり、利用者が維持し続けなければならない実行時制約ではない。

```text
algoloom_workspace/
└── abc300_a/                 # aloom get で自動生成
    ├── <problem-metadata>    # 名称と形式は機能設計で決定
    ├── main.cpp              # 組み込みprofileの雛形から作成
    └── test/                 # Judge Adapterが取得した公開sample
```

作成後は、利用者がOS、shell、file manager、Editor / IDEの標準操作でworkspace全体や問題directoryを移動・rename・整理できることを基本契約とする。

- workspace全体を移動しても、workspace内の相対的な構成から再認識できるようにする。
- 問題directoryは、workspace内でrenameまたは下位directoryへ移動しても、directory名ではなく保存済みの正規問題IDを含むmetadataから識別する。
- 問題metadataは問題directoryと一緒に移動できる通常fileとして保存し、絶対pathを問題や履歴の恒久的な識別子にしない。
- commandは現在directoryまたは明示されたsourceから親方向へcontextを探索し、安全に一意に決まる場合だけworkspace、問題、sourceを推測する。
- sourceだけを問題context外へ移動した場合等、一意に判断できない状態では勝手に関連付けず、必要なcontextと明示指定方法を説明する。
- 複数の同一問題directoryが存在する場合は、暗黙に先頭候補を選んだりmerge・削除したりしない。

## 5. CLIコマンド構成

本節は、現時点で想定している機能と責任の整理であり、最終的なsubcommand名、引数、optionを確定するものではない。具体的なCLIは、シンプルさとユーザーの自由を優先して後の設計段階で決定する。

AlgoLoomの日常操作では、短く入力でき、製品名との関係も識別しやすい`aloom`を正式command名とする。Python package名や内部module名、保存directory名は`algoloom`を維持でき、command名と一致させる必要はない。

| 区分 | 名前 | 方針 |
|---|---|---|
| 製品名 | AlgoLoom | UI、文書、配布時の正式名称 |
| 正式command | `aloom` | README、help、利用例で優先して使用する |
| 互換command | `algoloom` | `aloom`と同じentry pointを呼び、既存scriptや明示的な正式名入力を支える |
| 任意alias | `al` | ユーザーが望む場合だけshell側で設定する。AlgoLoomから自動登録しない |

```bash
aloom get abc300_a
aloom test main.cpp
aloom submit main.cpp
```

`loom`は他のCLIと衝突しやすいため使用しない。AlgoLoomはshellの設定fileを無断で変更せず、`al`のaliasとcompletionを設定する手順だけを案内する。

| コマンド | 引数 / オプション | 実行される処理 |
| :--- | :--- | :--- |
| **get** | [問題ID]<br>--lang [言語] | ①Judge Adapter経由で公開sampleをtest/へ取得<br>②宣言的な問題metadataを保存<br>③組み込みlanguage profileから雛形fileを作成。再実行時は編集済みsourceを上書きしない |
| **test** | [ファイル名] | 組み込みlanguage profileに基づきbuild（C++等）を行い、test/内の公開sampleとの一致をlocalで確認する。AtCoderでのACを保証する判定とは表現しない。 |
| **checkpoint** | [ファイル名] | 提出前のsource snapshotを、利用者の明示操作によってローカル履歴へ保存する。外部通信は行わない。 |
| **submit** | [ファイル名]<br>--review（MVP後） | ①問題contextとAtCoder accountを確認<br>②送信する正確なsource snapshotと提出操作をローカルSQLiteへ耐久保存<br>③Judge Adapter経由でAtCoderへ提出<br>④submission IDを保存し、判定をpolling<br>⑤中断時は状態を保持し、同じ提出の判定だけを再確認<br>⑥将来の同期とAI reviewは、Core完了後の独立した処理として追加 |
| **log** | なし | ローカルSQLiteからcheckpoint、提出操作、判定を取得し、通信を待たずにterminalへ一覧表示する。 |
| **show** | [問題IDまたは履歴ID] | ローカルDBから選択したsource snapshotを取得する。MVPはterminal上のplain textで表示し、外部Editor / Viewer連携はMVP後とする。 |
| **diff** | [問題IDまたは履歴ID] | ローカルDBから利用者が振り返る2つのsource snapshotを取得し、MVPはunified diffで表示する。初回提出と最新AC等を既定候補にしても、比較対象を確認・指定できるようにする。 |
| **export** | [保存先] | checkpoint、提出、判定、source snapshotを、credentialを含まないversion付き形式で持ち出す。 |

一般的なfile・directory操作はこのcommand体系へ含めない。例えば問題directoryの移動には、macOS / Linuxの`mv`、PowerShellの`Move-Item`、各OSのfile manager、Editor / IDEのfile操作等をそのまま利用できるようにする。
