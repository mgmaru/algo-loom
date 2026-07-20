---
status: normative
applies_to: MVP
derived_from:
  - ../docs/product/vision.md
  - ../docs/architecture/core-contracts.md
  - ../docs/quality/stress-free-ux-design.md
  - ../docs/quality/security-design.md
---

# AlgoLoom 製品・実装原則

## 1. 目的

本書は、個別の実装方法やCLI名が変わっても維持する製品上の原則を定義します。詳細な理由と将来構想は[製品ビジョン](../docs/product/vision.md)、具体的なCore契約は[Core契約](../docs/architecture/core-contracts.md)を参照してください。

## 2. 実装が維持する原則

### 2.1. 利用者が選んだ開発環境を中心にする

- Coreは特定のEditor、IDE、pluginまたは専用project fileを必須にしません。
- 編集中sourceの権威は、workspaceへ保存された通常fileです。未保存bufferやEditor内部状態を推測しません。
- Coreは、通常fileとCLIだけで主要導線を完了できなければなりません。

### 2.2. 外部所有環境を変更しない

- 通常操作は、AlgoLoom所有領域と利用者が明示したworkspace以外の永続状態を変更しません。
- Editor、shell、plugin、toolchain、Provider runtimeおよびOS設定を、通常操作でinstall、update、削除または再設定しません。
- 外部toolは安全なargvで一時的に呼び出し、その設定や認証cacheをAlgoLoomが所有しません。

### 2.3. Coreをローカルファーストに保つ

- test、checkpoint、履歴一覧、source表示、差分、exportはCloudまたはAtCoderを必要としません。
- AI、Cloud同期、外部Viewer等の任意機能が未設定または失敗しても、無関係なCore操作を停止させません。
- source snapshotと操作履歴を、失われてもよいcacheとして扱いません。

### 2.4. 学習者の主体性を守る

- AlgoLoomは利用者に代わって問題を解く主体になりません。
- codeの編集、外部提出、外部送信および削除は、利用者の明示的な操作または同意なしに行いません。
- 時間計測は任意かつ明示的に開始し、利用しないことをerrorまたは不完全な利用として扱いません。

### 2.5. 過去の自分との比較を中心にする

- 履歴、時間、提出回数を、利用者間rank、他者平均との差または単一skill scoreへ変換しません。
- sample通過、AC、active duration、wall elapsed、process duration、judge execution timeを、それぞれ異なる観測として扱います。
- 同じ問題の解き直しは別のSolveAttemptとして保存し、以前の試行を上書きしません。

### 2.6. 成功済みのデータを失わない

- source snapshotは保存後に本文を上書きしません。
- 部分失敗時は、成功済みの結果、影響を受けないデータ、未完了の処理、次の安全な操作を示します。
- 再実行によって既存source、sample、metadata、履歴または外部提出を重複・破壊しません。
- 状態不明を成功または未実行と推測しません。

### 2.7. 外部作用と信頼境界を隠さない

- network通信、AtCoderへの提出、将来のAI送信およびCloud保存を、local処理と区別します。
- credentialとsessionをworkspace、履歴DB、exportまたは通常logへ保存しません。
- 外部入力、source pathまたは設定値からshell commandを文字列連結で生成しません。
- 安全性、privacy、データ完全性または外部作用を確定できない場合は、影響する操作だけを安全側で停止します。

### 2.8. 外部コンテンツの所有境界を守る

- AtCoderの問題・解説と他ユーザーのcodeは、AlgoLoomの所有データとして保存しません。
- 外部学習資料は公式ページをbrowserで開く境界に留め、本文をDB、cache、exportへ取り込みません。
- browser起動要求の成功を、ページ表示、loginまたは閲覧完了の成功とみなしません。

### 2.9. 内部複雑性を日常操作へ露出させない

- Adapter、Provider、Repository等の内部用語を、通常利用者が目的を達成するための前提知識にしません。
- AlgoLoom固有の状態や外部作用を扱う操作だけを専用commandにし、一般的なfile・directory操作を独自に再定義しません。
- 安全な既定経路を一つ用意し、任意機能と詳細設定は必要になるまで通常導線へ出しません。

### 2.10. 将来機能からCoreへの逆依存を作らない

- AI review、Cloud同期、Web dashboard等は、Coreの安定したPortまたはqueryへ一方向に依存します。
- MVPで実装しない機能の型、SDK、設定または保存状態を、CoreのDomainへ持ち込みません。
- 将来機能のためだけに、MVPの日常操作とデータモデルを複雑にしません。

## 3. Review時の問い

実装と設計のreviewでは、少なくとも次を確認します。

- 特定のEditor、Cloud、AIまたは外部toolが暗黙の必須条件になっていないか。
- 利用者が所有するsource、環境、credentialまたは選択権を侵害していないか。
- 部分失敗、timeout、取消後の状態と回復方法を説明できるか。
- 同じ操作の再実行でsource、履歴または外部状態を壊さないか。
- 外部作用と送信対象が利用者から見えるか。
- 将来機能の都合でMVPの範囲またはCore契約を広げていないか。
