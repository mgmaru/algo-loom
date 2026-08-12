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
- 言語選択は、AtCoder公式`contest.js`のJavaScript実行前構造に合わせ、`#select-task`、`#select-lang[data-name="data.LanguageId"]`、`#select-lang-abc300_a > select`をそれぞれ一意に確認します。対象問題用`select`は、JavaScriptが`name="data.LanguageId"`を付ける前の名前なし状態と、付与後の状態だけを受け付けます。
- 言語ラッパー、問題選択欄、対象問題コンテナのID重複、`data-name`不一致、対象問題用`select`の欠損・重複・予期しない`name`、CPython候補0件・複数件では提出前に停止します。旧形式の名前付き言語`select`は、公式構造と混同しない互換経路で解析します。
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
| `atcoder_v03_browser_submit.mjs` | 通常の可視Chrome、人によるログイン・Turnstile・提出操作を使う1件提出と提出ID取得 | `--remote-debugging-pipe`を使わないV-03の再設計版。検証専用拡張を人が専用プロファイルへ読み込み、許可リスト化した結果だけをloopbackへ返す。製品へ組み込まない |
| `atcoder_v04_verdict.py` | V-03の提出ID1件による判定待ち・最終判定の確認 | 方式Cで本人を再確認し、対象IDだけを有限ポーリングする。実IDと生応答を保存しない。製品へ組み込まない |
| `atcoder_v03_turnstile_probe.mjs` | 可視の専用ブラウザにおけるTurnstile実行後状態の読み取り専用観測 | `p0-10`で`--remote-debugging-pipe`による自動化状態がCloudflareと非互換だと確認したため、AtCoderへ再接続しない。原因再現の参照コードとしてのみ保持する |
| `cloudflare_browser_local_diagnostic.mjs` | 現行CDP条件のローカル信号確認と、通常ChromeによるCloudflare公式互換性対照 | 既定モードは外部通信なし。対照モードは公式互換性チェッカーだけを開く。AtCoder、Cookie、Storage、CDP Network領域を扱わない |
| `atcoder-login.sh` | `online-judge-tools`のパスワード入力型ログイン | `p0-01`・`p0-02`の過去経路を確認するために残す。Turnstile下の再認証手段として推奨しない |

## `atcoder_v03_browser_submit.mjs`

V-03の再設計版です。macOSのGoogle Chromeを、空の専用プロファイルと通常の可視ブラウザ状態で起動します。CDP、WebDriver、リモートデバッグのpipe・port、ヘッドレス化、自動化信号の隠蔽を使用しません。

Chrome 137以降の公式版は`--load-extension`を受け付けないため、スクリプトは`chrome://extensions`を別タブで開きます。利用者がデベロッパーモードを有効にし、[`atcoder_v03_browser_extension/`](atcoder_v03_browser_extension/)を「パッケージ化されていない拡張機能」として読み込みます。拡張機能は実行終了時に専用プロファイルとともに削除され、通常のChromeプロファイルへインストールされません。

リポジトリ外の所有者専用ディレクトリへ、提出用ソースコードと二つの未作成出力パスを用意して実行します。

```console
node scripts/verification/atcoder_v03_browser_submit.mjs \
  --source /absolute/owner-only/path/source.py \
  --json-output /absolute/owner-only/path/v03-browser-result.json \
  --state-output /absolute/owner-only/path/v03-browser-state.json
```

実行時の境界は次のとおりです。

- 最初にローカルページで`navigator.webdriver`が偽であることを確認し、真ならAtCoderへ移動する前に停止する。
- Cloudflare公式互換性チェッカーは利用者が別タブで開き、`Diagnostics passed`を画面で確認する。失敗時は設定変更や再試行をせずブラウザを閉じる。
- AtCoderのユーザー名、パスワード、ログイン時Turnstileは利用者が操作する。拡張機能はログインページで動作しない。
- `/settings`で利用者が入力した期待アカウント名をブラウザ内だけで照合し、loopbackへは識別情報の件数と一致結果だけを返す。
- 対象、CPython候補、CSRF欄、ソースコード欄、Turnstile欄を件数で確認する。Cookie、CSRFトークン、Turnstileトークンの値は読まない。
- ソースコード、ハッシュ、期待アカウント名、提出前の実際の提出ID一覧は、拡張機能とNode.jsプロセスの一時メモリだけで扱う。匿名化済みJSONへ保存しない。
- 拡張機能は対象問題・言語を設定する。AtCoderのAceと送信用`textarea`の不一致を避けるため、利用者がAtCoder本体のエディタ切替を人の操作で`Ace → プレーンテキスト欄`へ変更してからソースコードを設定する。その後、利用者が`プレーンテキスト欄 → Ace → プレーンテキスト欄`と往復し、Aceでの目視と戻ってきた送信値の一致を確認する。拡張はエディタ切替、Turnstile、AtCoder本体の提出ボタンを自動操作せず、Ace API、main world注入、`click()`、`submit()`、`requestSubmit()`を使用しない。
- 文書全体で`#sourceCode`、`textarea#plain-textarea[name="sourceCode"]`、`#editor`、`.btn-toggle-editor`を各1件へ固定し、同じ対象フォーム内にあること、プレーンテキスト欄だけが可視で切替ボタンが`active`であることを要求する。見た目用の追加CSS classや、対象フォーム所属より厳しい要素間の祖先関係は契約にしない。利用者が一画面の提出ゲートを確認し、正確な承認句を入力した後だけAtCoder本体の提出ボタンを有効にする。承認時とフォームの`submit`イベント時に、問題、言語、実際に直列化される`sourceCode`、本文、バイト数を再検査し、不一致なら既定送信を同期的に遮断する。最後の提出操作は利用者が1回だけ行う。
- 提出前に本人提出一覧を1ページだけ取得し、提出後の表示との差から新しい提出IDを一意に解決する。候補が0件または複数件なら再提出せず状態不明で停止する。
- Cookie・network監視権限を持たないため、フォームの`submit`イベントをHTTP POSTの観測と同一視しない。`SEND_STARTED`後に提出IDを得られない場合は`REMOTE_STATUS_UNKNOWN`として停止し、再提出しない。
- 実際の提出IDは`V-04`・`V-06`用の一時状態へだけ`0600`で保存し、匿名化済み結果では`submission-A`へ置き換える。
- loopbackサーバーは`127.0.0.1`の動的portだけへbindし、64桁の一時token、`Host`、接続元、イベントのスキーマと順序を検査する。tokenはURL fragmentから拡張機能へ渡し、AtCoderへのreferrerや成果物へ含めない。
- 終了、利用者によるブラウザ終了、20分の上限、SIGINT・SIGTERMで専用Chrome、loopbackサーバー、一時プロファイルを後始末する。

このスクリプトは`REVEL_SESSION`を取得または保管しないため、方式Aの`V-10`合格証拠にはなりません。通常ブラウザ状態と人の操作を維持したV-03提出経路だけを検証します。拡張機能の権限、配布、方式AのCookie限定取得境界は別の設計判断です。

ローカルテストはAtCoder、Cloudflareへ接続しません。

```console
node --test scripts/verification/test_atcoder_v03_browser_submit.mjs
```

## `atcoder_v04_verdict.py`

V-03が作成した所有者専用一時状態から実際の提出IDを読み、方式Cで本人アカウントを再確認した後、そのID1件だけの判定を時刻付きで観測します。結果JSONには`submission-A`だけを記録し、実際の提出ID、Cookie、アカウント名、生ヘッダー、生HTML、生JSONは保存しません。

macOSでの自己検証には、リポジトリルートの**ターミナル**で次の1コマンドを実行します。ブラウザのConsoleで実行するコマンドやJavaScriptはありません。

```console
python3 scripts/verification/atcoder_v04_verdict.py \
  --discover-state \
  --guided-chrome
```

この入口は`/usr/bin/open -a "Google Chrome" https://atcoder.jp/settings`相当でGoogle Chromeを明示起動し、既定ブラウザやSafariへ切り替えません。V-03で使った空の専用Chromeプロファイルは終了時に削除済みのため、V-04の方式Cでは通常のGoogle Chromeプロファイルを使います。Chromeが既に起動中なら、開いた`/settings`が期待する本人アカウントか必ず画面で確認します。

Chromeでは次の順に操作します。

1. `/settings`がログイン画面なら、本人が通常どおりログインし、表示された場合はTurnstileも本人が操作してから`/settings`へ戻る。既に設定画面なら再ログインせず、表示アカウントだけを確認する。別アカウントならChromeプロファイルまたはAtCoderアカウントを切り替える。
2. 同じChromeウインドウで`⌥⌘I`を押し、DevToolsの`Application`を開く。タブが見えなければ`>>`から選ぶ。
3. `Storage > Cookies > https://atcoder.jp`を開き、`Name=REVEL_SESSION`、`Domain=atcoder.jp`、`Path=/`の行が1件だけであることを確認する。
4. その行の`Value`セルだけをコピーする。`REVEL_SESSION=`は含めず、続く非表示ダイアログへ貼り付ける。
5. 期待アカウント名を非表示ダイアログへ入力し、最後の「読み取り専用GETを実行」を押す。

スクリプトはChromeのCookieデータベースとクリップボードを自動で読みません。また、通常のChromeを閉じたり、プロファイルを削除したりしません。Cookie値と期待アカウント名は引数、環境変数、結果ファイルへ渡さず、非表示ダイアログの入力として当該プロセスだけが保持します。

`--discover-state`は`/private/tmp/algoloom-v03-*/v03-browser-state-*.json`のうち、所有者と権限を検査できた状態が1件だけの場合に限り選択します。0件または複数件なら外部通信前に停止するため、対象を次のように絶対パスで明示します。`--json-output`を省略すると、匿名化済み結果を状態ファイルと同じ所有者専用ディレクトリへ新規作成します。

```console
python3 scripts/verification/atcoder_v04_verdict.py \
  --state /absolute/owner-only/path/v03-state.json \
  --guided-chrome
```

実行時の境界は次のとおりです。

- V-03の一時状態を、リポジトリ外、所有者専用、固定スキーマ、最大4 KiBとして検査する。
- `--guided-chrome`ではGoogle Chromeと`/settings`を明示し、ログイン要否、本人アカウント、Cookie対象行を別々のダイアログで確認する。Safariへのfallback、Cookie DB・クリップボードの自動読取、Consoleでのコマンド実行は行わない。
- `REVEL_SESSION`と期待アカウント名を非表示の対話入力だけで受け取り、`/settings`で本人との一致を確認する。
- AtCoder公式`contest.js`が使用する判定状態経路へ`sids[]`を1件だけ渡し、提出一覧と他の提出IDを走査しない。
- 対象ID付きの`waiting-judge`だけを`VERDICT_PENDING`、許可リスト内で一意な判定コードだけを`FINAL`として扱う。
- 接続5秒、1リクエスト20秒、応答256 KiB、最小間隔2秒、判定GET 10回、全体120秒を上限にする。判定待ちではAtCoderの`Interval`と2秒の長い方を待つ。
- リダイレクト、429、Cloudflare Challenge Page、通信障害、対象外ID、曖昧な応答では安全側で停止する。自動再試行とPOSTは行わない。
- 同じ実行で、判定待ちと最終判定を実サービスから5分以内の順序付き観測として両方取得した場合だけ`V-04`を合格とする。片方だけ、時刻欠損、逆順、5分超なら匿名化済み結果を`incomplete`とする。

ローカルテストはAtCoderへ接続しません。

```console
python3 -m unittest discover \
  -s scripts/verification \
  -p 'test_atcoder_v04_verdict.py'
```

`p0-17`では、同じ提出IDの最終判定を取得時刻付きで観測しましたが、V-04開始時には判定待ちが終了していました。`p0-18`では曖昧だったブラウザと手動操作の導線を上記のGoogle Chrome固定フローへ修正し、`p0-19`でその入口から本人照合と最終判定の再取得まで実サービス実行しました。既存の`submission-A`を再確認しても過去の判定待ちは復元できなかったため、`V-04`は一部観測の未合格のままです。

## `atcoder_v03_turnstile_probe.mjs`

`p0-07`の静的HTML観測では確認できなかった、JavaScript実行後のTurnstile応答欄を調べる補助スクリプトです。macOS上のGoogle Chromeを、リポジトリ外に作る空の専用プロファイルと`--remote-debugging-pipe`で可視起動します。利用者がChrome内でログインとTurnstileを手動で完了した後、対象フォーム内の`cf-turnstile-response`が存在するか、値が空かどうかだけをブラウザ内で判定します。

所有者だけがアクセスできるリポジトリ外のディレクトリを先に作り、まだ存在しない結果パスを指定します。

```console
node scripts/verification/atcoder_v03_turnstile_probe.mjs \
  --json-output /absolute/owner-only/path/turnstile-result.json
```

この観測では次の境界を固定します。

- Chrome起動時の最初のページは`about:blank`とし、ログイン中はページへスクリプトを注入しない。利用者がログイン完了を確認した後、対象提出URLへの移動前に提出フォームの`submit`イベントと直接`submit()`を遮断する。
- 利用者は可視ブラウザ内でユーザー名、パスワード、Turnstileを操作する。スクリプトは入力やクリックを自動化しない。
- DevTools Protocolの`Network`領域を有効にせず、Cookie、HTTPヘッダー、POST本文を受け取らない。
- 応答欄の値をブラウザ外へ返さず、欄の件数と空でない欄の件数だけを返す。
- ソースコードを入力せず、提出POST上限を0回とする。`V-03`の合否は変更しない。
- ブラウザ終了後に、今回作成した一時プロファイルだけを削除する。ローカル削除をAtCoder側のセッション失効とは扱わない。
- ログイン開始から二段階の確認を通算15分以内に完了しない場合、ブラウザと一時プロファイルを後始末して停止する。

ローカルテストはAtCoderへ接続せず、次で実行します。

```console
node --test scripts/verification/test_atcoder_v03_turnstile_probe.mjs
```

`p0-08`の実行時版は、対象提出URLへの最初の移動前に提出防止コードを設定したため、ログイン画面にも同じJavaScript実行環境の変更が存在しました。ログインフォーム自体は送信対象外としていましたが、Cloudflare判定へ影響しなかったとは証明できません。現在の再利用版は、ログイン中にはページへスクリプトを注入せず、本人のログイン完了を確認した後だけ提出防止を設定する二段階へ修正しています。`p0-09`でこの版を実サービスへ1回再接続しましたが、Cloudflare検証は同じ段階で失敗しました。

[`p0-10`](../../docs/verification/judge-adapter/results/2026-08-12-p0-10.md)では、この再利用版と同じ`--remote-debugging-pipe`、CDP接続、ターゲット接続、ページ移動をローカルで再現し、`navigator.webdriver: true`を確認しました。Cloudflare公式互換性チェッカーはこの状態を自動化ブラウザとして不合格にします。したがってこのスクリプトをAtCoderへ再接続せず、`navigator.webdriver`の隠蔽やstealth設定も追加しません。

## `cloudflare_browser_local_diagnostic.mjs`

現行V-03観測ヘルパーのブラウザ制御条件と、CDPなしの通常Chromeを安全に比較する診断スクリプトです。

既定モードは空の一時プロファイルでChromeを起動し、外部通信のない`data:` URLに対して現行ヘルパーと同じ`--remote-debugging-pipe`、`Target.attachToTarget`、`Page.navigate`を実行します。外へ返すのはJavaScript実行、Cookie利用可否、`navigator.webdriver`の3つの真偽値だけです。

```console
node scripts/verification/cloudflare_browser_local_diagnostic.mjs
```

対照モードは別の空プロファイルでCloudflare公式互換性チェッカーだけを開きます。リモートデバッグ、CDP、開発者ツールを使用しません。結果は利用者が画面で確認し、スクリプトはDOM、画面、ネットワーク応答を読み取りません。

```console
node scripts/verification/cloudflare_browser_local_diagnostic.mjs \
  --manual-compatibility
```

いずれのモードもAtCoderへ接続せず、Cookie、Storage、生HTML、HTTPヘッダーを取得しません。終了またはSIGINT・SIGTERM時に専用Chromeと今回の一時プロファイルだけを後始末します。これは検知回避ツール、Cloudflare通過手段、製品用ブラウザランチャーではありません。

ローカルテストは外部通信せず、次で実行します。

```console
node --test scripts/verification/test_cloudflare_browser_local_diagnostic.mjs
```
