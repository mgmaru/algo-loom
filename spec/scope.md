---
status: normative
applies_to: MVP
derived_from:
  - ../docs/product/mvp.md
  - ../docs/architecture/language-and-platform-portability.md
---

# AlgoLoom MVP実装範囲

## 1. MVPで実証する価値

AlgoLoomのMVPは、AtCoderの終了済み過去問について、問題取得、任意のEditorでの編集、公開sampleによるlocal test、明示的な提出、ローカル履歴による振り返りを、EditorやCloudへ利用者を囲い込まず、部分失敗から回復できる一つの導線として提供します。

機能数ではなく、次の導線が壊れずに成立することをMVPの価値とします。

```text
問題を取得する
  → 必要ならSolveAttemptを開始する
  → 任意のEditorで書く
  → 公開sampleでtestする
  → 必要ならcheckpointを残す
  → 明示的に提出する
  → 判定を確認する
  → 履歴、source、差分を振り返る
  → 必要なら別のSolveAttemptとして解き直す
  → exportで学習資産を持ち出す
```

記載した操作名は責任を示す概念名であり、最終的なsubcommand名またはoption名を確定しません。

## 2. 対象利用者と利用形態

- AtCoderの終了済み過去問を、自分のPCと自分のAtCoderアカウントで学習する個人利用者を対象とします。
- terminalで短いcommandを実行できることを前提としますが、shellやcompiler設定への習熟は要求しません。
- 一人、一つのAtCoderアカウント、一台の端末を保証範囲とします。
- 一つ以上のworkspaceと、offlineで参照できるローカル履歴を扱います。
- 通常の非interactiveなAtCoder Algorithm問題と、利用者自身が書いたcodeを対象とします。

## 3. 初期対応環境

| 項目 | MVP保証範囲 |
|---|---|
| host OS | native macOS、native Linux、native Windows |
| 解答言語 | C++、Python、Go、Rust |
| source構成 | 一つの問題directoryに一つのsourceを既定とする単一source |
| toolchain | 各言語の組み込み`LanguageProfile`で定義する標準toolchain |
| Editor | 保存済みの通常fileを編集できる任意のEditorまたはIDE |

WSL、追加言語、複数fileの一般的なproject build、Remote SSH、container等は、個別検証なしに対応済みと表示しません。言語固有差異は`LanguageProfile`、OS固有差異は`HostPlatform`へ分離します。

## 4. MVPに含める能力

1. install後の初期診断と、設定fileの手編集なしで最初のlocal testへ進める導線
2. 一件の正規問題IDまたはAtCoder公式URLからの公開sample取得
3. 通常directory、source、宣言的metadataからなるworkspaceの作成
4. 既存sourceを上書きしないfreshな解き直しと、別のSolveAttemptとしての保存
5. resource上限付きのcompile、公開sample実行、比較、compile時間とsampleごとのrun時間の表示
6. 明示的かつ任意のSolveAttempt開始、pause、resume、終了とactive durationの保存
7. 最初の公開sample通過、初回提出、初ACの区別されたmilestone
8. 利用者が明示的に作成するcheckpointと不変source snapshot
9. 自分のAtCoder sessionを使う一件ずつの明示的な提出
10. submission IDに基づく判定確認と、待機中断後の再確認
11. 問題、提出、checkpoint、判定、時刻のローカル履歴
12. 保存済みsnapshotのplain text表示と、選択したsnapshot間のunified diff
13. 公式問題ページとAtCoder問題別解説ページのdefault browser表示
14. credentialを含まず、AlgoLoomなしでもsourceを回収できるversion付きexport
15. 部分失敗時に、成功済み段階、未完了段階、保持されたデータ、次の安全な操作を示す回復導線

## 5. MVPに含めない能力

次はCoreへplaceholder、設定項目または日常的な案内を置かず、MVP後に別途採用判断します。

- AI review、LLM Provider、AIルール判定
- Cloud同期、複数端末、共有、共同編集、自動Cloud backupとrestore
- 問題catalog、terminal内検索、推薦、タグ、weakness分析
- TUI、Web dashboard、Editor plugin、専用Editor、高度な外部Viewer連携
- 利用者間ranking、公開skill score、他者平均との差、自動成長評価
- 公開用solution bundleとGitHub repository操作
- AtCoder上の既存提出履歴の自動backfill
- file保存またはtestごとのsource全文の自動versioning
- 全local test eventとlocal peak memoryの永続履歴
- 他ユーザーの提出一覧への導線、および外部コンテンツ本文の取得・保存
- WSL、追加言語、一般的な複数file project build、AHC、interactive問題、特殊judge
- 複数AtCoderアカウントの統合管理
- 他者またはLLMが作成した未信頼codeの実行とRepair Lab

## 6. 実装前に満たす条件

- `JudgeAdapter`について、現在のAtCoderでsample取得、account確認、提出、submission ID取得、判定確認を検証できること。
- C++、Python、Go、Rustの組み込み`LanguageProfile`案と共通契約testがあること。
- native macOS、native Linux、native Windowsの`HostPlatform`契約と検証matrixがあること。
- SolveAttempt、FocusInterval、milestone、snapshot、submission operation、submission、verdict observation、account identityの論理モデルがあること。
- workspace metadataとuser-level設定の責任が分離されていること。
- `get`、時間計測、`test`、`submit`の中断点と回復経路が設計されていること。
- freshな解き直しのfile作成とDB保存における部分失敗から、安全に回復できること。
- 外部資料のURL構成とbrowser起動を分離し、本文非取得、spoiler、contest状態、起動失敗を扱えること。

外部前提が成立しない場合は、回避実装へ暗黙に進まず、MVPスコープを再検討します。

## 7. MVP完了の判定

MVPはcommandが存在するだけでは完了しません。[MVPスコープの完了条件](../docs/product/mvp.md#5-mvp完了条件)を、自動test、fault injection、3 OSでの実機確認、利用者検証のいずれか適切な方法で満たす必要があります。

特に次をrelease gateとして扱います。

- 同じ取得・解き直し・状態遷移を再実行しても、既存sourceと履歴を失わず、重複を作らない。
- compile/run timeout後に子processを残さない。
- 外部送信前の保存に失敗した場合は提出せず、送信状態が不明な場合は自動再送しない。
- DB lock、disk full、migration失敗、process強制終了から、成功済みデータを失わずに回復できる。
- Editor、AI、Cloud、Viewerなしで主要導線を完了できる。
- 外部文字列とcodeを安全にterminalへ表示できる。
- 時間、判定、local計測、judge計測およびbrowser起動結果を、異なる意味の状態として表示できる。

## 8. この仕様で確定しないこと

- 最終的なsubcommand、option、alias
- CLI frameworkとdependency injection方式
- class、module、table、columnの最終名称
- metadata fileとexport fileの最終形式
- terminalの色、spinner、table layout
- timeout、出力量、保持期間等の具体値
- compilerとruntimeの詳細なversion matrix

これらは個別の機能設計または実装設計で決定します。ただし、MVP範囲、Core契約、安全性、データ完全性を弱める決定はできません。
