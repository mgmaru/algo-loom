# JudgeAdapter検証支援スクリプト

このディレクトリには、`JudgeAdapter`の技術検証を再現し、将来の実装判断へ参照できる検証支援スクリプトを置きます。製品コード、通常の認証導線、CI用の認証手段ではありません。

## `atcoder_v02_session_check.py`

方式Cの`V-02`を確認するスクリプトです。[`p0-04`の検証記録](../../docs/verification/judge-adapter/results/2026-08-11-p0-04.md)で記録した使い捨て検証コードの成功経路を、検証後に再構成して保持しています。削除済みの実行時ファイルとバイト単位で同一とは扱いません。空セッションの対照結果が想定外なら`REVEL_SESSION`を送らず停止する条件を追加しています。

Python標準ライブラリだけを使用するため、仮想環境や追加パッケージは不要です。Python 3.9以降を想定します。

```console
python3 scripts/verification/atcoder_v02_session_check.py
```

匿名化済みJSONが必要な場合だけ、リポジトリ外に作成した一時ディレクトリの、まだ存在しない絶対パスを指定します。

```console
python3 scripts/verification/atcoder_v02_session_check.py \
  --json-output /tmp/algoloom-v02-example/result.json
```

親ディレクトリは利用者が先に所有者専用権限で作成してください。スクリプトは既存ファイルを上書きせず、結果ファイルを`0600`で作成します。Cookie値、期待アカウント名、生のヘッダー、生のHTMLはJSONへ保存しません。

## 安全境界

- 利用者本人が通常のブラウザでログインし、`/settings`で本人アカウントを確認します。
- Cookie値と期待アカウント名は、表示しない対話入力だけで受け取ります。引数、環境変数、設定ファイルからは受け取りません。
- 非TTYでは秘密情報の非表示入力を保証できないため、外部通信前に停止します。
- 送信先は`https://atcoder.jp/settings`、Cookie名は`REVEL_SESSION`に固定します。
- 最初にCookieなしのGETを1回だけ送ります。想定どおり未認証と分類できた場合だけ、2秒以上空けて`REVEL_SESSION`ありのGETを1回送ります。
- リダイレクトを追従せず、自動再試行しません。
- 提出ページへアクセスせず、CSRFトークンを取得せず、提出POSTを実装しません。
- ブラウザプロファイル、Cookie DB、クリップボードを自動で読みません。
- このスクリプトの成功は認証と`/settings`閲覧の確認であり、対象問題への提出認可の確認ではありません。

秘密値はPythonプロセスのメモリには一時的に存在します。プロセス終了前に参照を外しますが、メモリからの完全な消去は保証しません。共有端末、リモート実行、CIでは使用しないでください。

## ローカルテスト

次のテストはAtCoderへ接続しません。

```console
python3 -m unittest discover \
  -s scripts/verification \
  -p 'test_*.py'
```

Cookie入力形式、誘導先と応答構造の分類、匿名化済みJSONの排他的な`0600`作成を確認します。テスト成功は実サービスの`V-02`合格を意味しません。実サービスの証拠は、匿名化した実行記録へ別途残します。

## `atcoder_v03_submit.py`

方式Cのセッションで`V-02`を再確認し、`V-05`で`python-cpython`を対象問題のPython（CPython）へ一意に解決した後、明示承認された1件だけを提出して提出IDを取得する`V-03`用スクリプトです。対象は`abc300_a`、正規言語IDは`python-cpython`に固定しています。

このスクリプトは外部作用を持ちます。実行前に[技術検証の実施手順](../../docs/verification/judge-adapter/README.md)の提出ゲートと、直近の確定済み実行記録を確認してください。ソースコード、匿名化済み結果、一時状態は、所有者専用権限で作成したリポジトリ外の一時ディレクトリへ置きます。

```console
python3 scripts/verification/atcoder_v03_submit.py \
  --source /absolute/path/outside/repository/source.py \
  --json-output /absolute/owner-only/path/v03-result.json \
  --state-output /absolute/owner-only/path/v03-state.json
```

`--json-output`には、HTTP状態、処理時間、アカウント一致、Cloudflare応答の許可リスト分類、提出フォームの構造、解決した言語、提出ID取得の成否等を匿名化して保存します。`--state-output`は`V-04`と`V-06`へ実際の提出IDを引き渡す一時ファイルであり、成果物へ移しません。いずれも既存ファイルを上書きせず、`0600`で作成します。

### `V-03`の安全境界

- Cookie値と期待アカウント名は、表示しない対話入力だけで受け取ります。
- 空のセッションと方式Cのセッションで`V-02`を当日に再確認します。
- Cloudflare Challenge Pageは、公式仕様の`cf-mitigated: challenge`を許可リスト射影して判定します。ヘッダーの生値や他の生ヘッダーは保存せず、`absent`、`challenge`、`unexpected`の分類だけを記録します。
- HTML内の`cf-turnstile`や`challenges.cloudflare.com`等はTurnstile関連参照として別に観測し、文字列の存在だけをChallenge Pageの証拠にしません。
- 認証済み提出フォームについて、同一オリジンの送信先、`method=POST`、フォーム数、CSRFフィールド数、対象問題、ソースコードフィールド、対象言語を許可リスト構造で確認します。
- 対象フォーム内のTurnstileウィジェットまたは応答フィールド、`turnstile.render()`または`turnstile.execute()`による明示的・遅延実行の参照を観測した場合は、フォーム構造を取得できても提出POST前に停止します。フォーム外のスクリプト参照だけなら、正常フォームの構造確認を継続します。
- 認証済み提出フォームから対象問題の言語候補とCSRFトークンをメモリ上で取得し、Python（CPython）が1件に決まらなければ停止します。
- 問題、アカウント一致、AtCoder固有の言語情報、Cloudflare Challenge Pageと提出フォームのTurnstile分類、ソースコードのバイト数とハッシュ、AI学習・販売の拒否設定案内、自動再送禁止を一画面に表示します。
- 正確な承認句が入力された場合だけ、提出POSTを最大1回送ります。通信結果が不明でも再送しません。
- 提出前後の本人提出一覧を1ページだけ確認し、新しい提出IDを一意に取得します。過去の提出全体を走査しません。
- Cookieの更新は`REVEL_SESSION`だけをプロセスメモリ上で反映し、他のCookieを送信しません。
- Cookie、CSRFトークン、ソース本文・ハッシュ、生のヘッダー、生のHTML、実際のアカウント名をファイルへ保存しません。
- 実際の提出IDは成果物では`submission-A`へ置き換え、`V-04`と`V-06`が終わるまで一時状態にだけ保持します。

## 既存スクリプトとの区別

| スクリプト | 用途 | 現在の扱い |
|---|---|---|
| `atcoder_v02_session_check.py` | 方式Cのアカウント確認 | `p0-04`相当の読み取り専用検証を再現する。製品へ組み込まない |
| `atcoder_v03_submit.py` | 方式Cによる1件提出と提出ID取得 | 当日の`V-02`再確認、`V-05`、明示承認を通過した場合だけPOSTを1回送る。製品へ組み込まない |
| `atcoder-login.sh` | `online-judge-tools`のパスワード入力型ログイン | `p0-01`・`p0-02`の過去経路を確認するために残す。Turnstile下の再認証手段として推奨しない |
