# Google 管理コンソールからの拡張機能一括導入ガイド（完全無料・児童Googleアカウント自動同期対応）

本ガイドでは、**Google Workspace for Education 管理コンソール（Google Admin Console）** を使用して、美作市内の児童生徒が使用する Chromebook に、本クライアント拡張機能を**完全無料（費用0円・Webストア登録不要）**で一括強制インストールし、児童Googleアカウントと自動連携・自動同期させる手順を解説します。

---

## 💡 この仕組みの特長

1. **完全無料（費用0円）**:  
   Chrome ウェブストアのデベロッパー登録料（$5）やサードパーティの有料MDMツールを一切使わず、Google Workspace 管理コンソールの標準機能のみで導入できます。
2. **児童Googleアカウントの自動取得・管理**:  
   児童が Chromebook にログインすると、`chrome.identity` API によりログイン中の Google アカウント（例: `student01@school.ed.jp`）が自動的に識別され、教員コンソール・スプレッドシートに児童IDとして自動登録されます。
3. **ゼロタッチ自動同期**:  
   児童や教員が端末ごとに拡張機能を開いて「児童ID」や「GAS URL」を手動入力する必要はありません。管理コンソールからポリシー（Managed Storage）を一括配布するか、インストール時にバックグラウンドで自動的にスプレッドシートと同期が開始されます。
4. **Google検索画面・全Webサイトの画面ロック完全対応**:  
   画面ロック実行時、Google検索画面（google.com）や新規タブを含め、全画面が確実にロックされます。解除後は**児童がページを更新（リロード）しなくても、即座に自動で元の画面に戻ります**。

---

## 🛠️ 事前準備

1. **Google Workspace 管理者アカウント**（`admin.google.com` へのアクセス権限）
2. **本プロジェクトのファイル一式**:
   - `extension/` フォルダ（拡張機能のソースコード）
   - `extension/schema.json`（管理コンソール用ポリシー定義）
3. **デプロイ済みの GAS Web アプリケーション URL**:
   - 例: `https://script.google.com/macros/s/AKfycb.../exec`
   - ※まだデプロイしていない場合は、先に [SPREADSHEET_SETUP.md](file:///workspaces/my-app3/docs/SPREADSHEET_SETUP.md) を参照してデプロイを完了してください。

---

## 🚀 導入手順（全4ステップ）

### ステップ 1: 拡張機能のパッケージ化（.crx と ID の作成）

Chrome ブラウザを使って、拡張機能フォルダを `.crx` ファイルにパッケージ化します。

1. お手元の PC の Google Chrome で、アドレスバーに `chrome://extensions` と入力して開きます。
2. 右上の **「デベロッパーモード」** を ON にします。
3. 左上に表示される **「拡張機能のパッケージ化」** ボタンをクリックします。
4. 設定画面が開きます:
   - **「拡張機能のルートディレクトリ」**: `extension` フォルダのパスを選択します。
   - **「秘密鍵ファイル」**: 初回は空欄のままでOKです。
5. **「拡張機能をパッケージ化」** をクリックします。
6. パッケージ化が完了すると、次の2つのファイルが生成されます:
   - `extension.crx`（拡張機能本体）
   - `extension.pem`（秘密鍵：次回以降のアップデート時に使用するため大切に保管してください）
7. 画面に表示される **「拡張機能ID（32文字の英小文字、例: `abcdefghijklmnopqrstuvwxyz123456`）」** をメモ帳などにコピーしておきます。

---

### ステップ 2: 無料ホスティング（GitHub Pages / Google ドライブ / サーバー）への配置

完全無料で配布するため、`.crx` ファイルと、ブラウザが更新を確認するための `update.xml` を公開URLに配置します。

#### 1. `update.xml` の作成
以下の内容で `update.xml` というファイルを作成します。
`YOUR_EXTENSION_ID` はステップ1でメモした32文字の拡張機能ID、`YOUR_CRX_URL` は後述の `.crx` 公開URLに置き換えます。

```xml
<?xml version='1.0' encoding='UTF-8'?>
<gupdate xmlns='http://www.google.com/update2/response' protocol='2.0'>
  <app appid='YOUR_EXTENSION_ID'>
    <updatecheck codebase='YOUR_CRX_URL' version='1.0.0' />
  </app>
</gupdate>
```

#### 2. 公開場所の選択（すべて無料）
- **おすすめA: GitHub Pages（無料・最も安定）**
  - GitHub のリポジトリに `extension.crx` と `update.xml` をプッシュし、Settings > Pages を有効化します。
  - 公開URL例:
    - update.xml: `https://<ユーザー名>.github.io/<リポジトリ名>/update.xml`
    - extension.crx: `https://<ユーザー名>.github.io/<リポジトリ名>/extension.crx`
- **おすすめB: 学校・教育委員会の内部Webサーバー**
  - 自治体や学校のイントラネット / Webサーバーの公開ディレクトリに配置します。

---

### ステップ 3: Google 管理コンソールでの一括強制インストール設定

1. 管理者アカウントで **[Google 管理コンソール](https://admin.google.com)** にログインします。
2. 左メニューから **「デバイス」 > 「Chrome」 > 「アプリと拡張機能」 > 「ユーザーとブラウザ」** を開きます。
3. 左側の組織部門ツリーで、**拡張機能を導入したい児童生徒の組織部門（OU）** を選択します（例: `美作市教育委員会 / 児童生徒` や 各学校・学年OU）。
4. 右下の **「＋」** アイコン（黄色い丸ボタン）にマウスを合わせ、表示されるアイコンの中から **「URL から Chrome アプリまたは拡張機能を追加」**（地球儀またはリンクのアイコン）をクリックします。
5. ダイアログに以下を入力します:
   - **拡張機能 ID**: ステップ1でメモした32文字の英小文字
   - **URL**: ステップ2で配置した `update.xml` の URL（例: `https://.../update.xml`）
6. **「保存」** をクリックします。
7. アプリ一覧に追加されたら、インストールポリシーのプルダウンを **「強制インストール」**（または「強制インストールしてタスクバーに固定」）に変更します。
   > 💡 **ポイント**: 「強制インストール」に設定することで、児童生徒が自分で拡張機能を削除・無効化できなくなります。

---

### ステップ 4: Managed Storage ポリシーによる GAS URL の自動配信

本拡張機能は **Managed Storage（組織ポリシー）** に対応しており、児童端末に一切触れることなく GAS の Web アプリケーション URL を配信できます。

> 💡 **1つの拡張機能で13校のGAS（スプレッドシート）に振り分け可能**:
> 学校ごとに別のスプレッドシート／GAS を用意する場合（負荷分散）でも、**拡張機能は1つ**で運用できます。
> `gas_url_map`（学校名 → GAS URL）を配布すると、各端末は自分の `school_name` に一致する GAS へ自動で接続します。
> 学校ごとの組織部門（OU）に `school_name` を設定しておけば、児童は何も入力せずに正しい学校のGASへ繋がります。

1. ステップ3で追加した拡張機能の一覧行をクリックし、右側に表示される **設定パネル** を開きます。
2. **「拡張機能のポリシー」**（Managed Storage）欄を探します。
3. 次の JSON を貼り付けて保存します（`YOUR_GAS_WEB_APP_URL` は実際のデプロイURLに置き換えてください。`dist/managed_policy.json` にもひな形があります）:

**（A）各校でGASを分ける場合（推奨・負荷分散）**:

`dist/managed_policy.json` に、`gas/Code.gs` の `CONFIG.SCHOOL_LIST`（美作市の全14校）を自動列挙したひな形が生成されます。
`REPLACE_WITH_XX_GAS_ID` を各校の実際のデプロイURLに置き換えてから、下記に貼り付けてください。

```json
{
  "gas_url_map": {
    "Value": {
      "英田小学校": "https://script.google.com/macros/s/＜英田小のGAS_ID＞/exec",
      "大原小学校": "https://script.google.com/macros/s/＜大原小のGAS_ID＞/exec",
      "江見小学校": "https://script.google.com/macros/s/＜江見小のGAS_ID＞/exec",
      "勝田小学校": "https://script.google.com/macros/s/＜勝田小のGAS_ID＞/exec",
      "勝田東小学校": "https://script.google.com/macros/s/＜勝田東小のGAS_ID＞/exec",
      "第一小学校": "https://script.google.com/macros/s/＜第一小のGAS_ID＞/exec",
      "北小学校": "https://script.google.com/macros/s/＜北小のGAS_ID＞/exec",
      "土居小学校": "https://script.google.com/macros/s/＜土居小のGAS_ID＞/exec",
      "英田中学校": "https://script.google.com/macros/s/＜英田中のGAS_ID＞/exec",
      "大原中学校": "https://script.google.com/macros/s/＜大原中のGAS_ID＞/exec",
      "作東中学校": "https://script.google.com/macros/s/＜作東中のGAS_ID＞/exec",
      "勝田中学校": "https://script.google.com/macros/s/＜勝田中のGAS_ID＞/exec",
      "美作中学校": "https://script.google.com/macros/s/＜美作中のGAS_ID＞/exec",
      "樸学園": "https://script.google.com/macros/s/＜樸学園のGAS_ID＞/exec"
    }
  },
  "school_name": {
    "Value": ""
  },
  "student_id": {
    "Value": "${USER_EMAIL}"
  }
}
```

> 📌 `gas_url_map` は「学校名 → その学校のGAS URL」の対応表です。**使用する全学校分**を列挙してください（上記は全14校の例）。
> 学校名は `gas/Code.gs` の `CONFIG.SCHOOL_LIST` と同じ正式名称で記載します（`resolveGasUrl` が表記ゆれ「美作市立〜」「〜小」等を吸収します）。
> `school_name` は**学校ごとのOUで**固定値を設定します（例: 英田小学校のOUには `"英田小学校"`）。トップレベル（全校共通）では空欄のままにします。空欄の場合は児童端末で「未設定」となり、教員画面から学校を紐付けた時点で対応するGASへ切り替わります。

**（B）全校で同じGASを使う場合（単一）**:

```json
{
  "gas_url": {
    "Value": "https://script.google.com/macros/s/AKfycb.../exec"
  },
  "student_id": {
    "Value": "${USER_EMAIL}"
  },
  "school_name": {
    "Value": ""
  }
}
```

> 📌 **項目解説**:
> - `gas_url_map`: 学校名 → GAS URL の対応表（複数校対応・推奨）。`school_name` に一致するGASへ自動振り分けします。表記ゆれ（「英田小」「美作市立英田小学校」等）も吸収します。
> - `gas_url`: 全校共通の GAS Web アプリのデプロイURL。`gas_url_map` が無い場合に使用されます。
> - `student_id`: **`"${USER_EMAIL}"` を指定します**。Google Workspace 管理コンソールのマクロ変数機能により、児童が Chromebook にログインすると自動的にその児童の Google アカウント（メールアドレス）に置き換わって拡張機能に渡されます（空欄でも `chrome.identity` により自動検出されます）。
> - `school_name`: 学校OUごとに学校名を固定したい場合に入力。`gas_url_map` の振り分けキーになります。

4. 画面右上の **「保存」** をクリックします。

---

## 🚫 ステップ 5: Gemini（生成AI）機能の無効化【重要】

Chromebook のブラウザ（Chrome）本体に組み込まれた **「Geminiに相談」「Gemini in Chrome」「AI モード」** は、
ブラウザのUI（ツールバー・アドレスバー・サイドパネル）として動作するため、**拡張機能からは完全に無効化できません**。
拡張機能側では、ロック中にWebページ内に表示される Gemini / AIモード関連の要素を検出して非表示・クリック遮断しますが、
ブラウザ本体のボタンは **Chrome の組織ポリシー（管理コンソール）で無効化する必要があります**。

ロック中も含めて確実に Gemini を使えなくするには、Google 管理コンソールで以下を設定してください。

1. 管理者アカウントで **[Google 管理コンソール](https://admin.google.com)** にログインします。
2. **「デバイス」 > 「Chrome」 > 「設定」 > 「ユーザーとブラウザ」**（対象OU：児童生徒）を開きます。
3. 検索ボックスで「Gemini」「AI」を検索し、次の値に設定します。

   | ポリシー名 | 設定値 | 効果 |
   | --- | --- | --- |
   | **Gemini の統合設定（GeminiSettings）** | **1 = 無効** | ツールバーの Gemini サイドパネル・アイコンを完全に削除（「Gemini in Chrome」「Geminiに相談」を無効化） |
   | **AI モードの設定（AIModeSettings）** | **1 = 無効** | アドレスバー・新規タブの検索ボックスの「AI モード」ボタンを無効化 |
   | **生成AIの既定設定（GenAiDefaultSettings）** | **2 = すべてブロック** | 現在・将来の Chrome 生成AI機能をまとめてブロック（新機能が自動有効化されるのを防止） |
   | **Gemini Act On Web の設定（GeminiActOnWebSettings）** | **1 = 無効** | Gemini の自動操作（Auto Browse）を無効化 |

4. 画面右上の **「保存」** をクリックします。

> 💡 **確認方法**: 児童端末の Chrome で `chrome://policy` を開き、「ポリシーを再読み込み」をクリックして
> `GeminiSettings` が `1`、`AIModeSettings` が `1` になっていることを確認してください。

> 📌 **補足**: Google Workspace 管理コンソールの「アプリ」>「追加サービス」からも Gemini アプリ自体
> （Gemini Web / モバイル）を利用停止にできます。Chromebook 端末でブラウザのGeminiを完全に使わせない場合は
> 上記ポリシーと合わせて設定してください。

---

## 🎒 動作の確認（児童端末・教員画面）

1. **児童端末（Chromebook）での確認**:
   - 対象組織部門の児童生徒 Google アカウントで Chromebook にログインします。
   - 数秒〜1分程度で、ブラウザ右上に本拡張機能が自動インストールされます。
   - 拡張機能アイコンをクリックすると、次のように表示されます:
     - **児童ID / アカウント**: `student123@school.ed.jp`（児童のGoogleアカウント）
     - **「Google自動連携」** バッジが表示
     - **接続状態**: 「接続済み」
2. **教員管理コンソール（Web画面）での確認**:
   - 教員管理コンソールを開くと、「管理対象端末」の一覧に児童の Google アカウントが表示され、緑色の「オンライン」マークが点灯します。
   - 「画面ロック」ボタンを押すと、**児童端末の画面が Google 検索画面や新規タブを含めて瞬時に全画面ロック**されます。
   - 「ロック解除」を押すと、**児童端末でリロード（F5）を押さなくても、1秒〜2秒で自動的に画面が元に戻ります**。

---

## ❓ よくある質問とトラブルシューティング

### Q1. 完全無料で運用できますか？
**はい、完全無料です。**  
Chromeウェブストアの有料デベロッパー登録（$5）を行わなくても、Google Workspace 管理コンソールの「URLから追加（update.xml + crx）」機能を使用することで、1円もかけずに何千台もの Chromebook に安全に強制配布できます。

### Q2. 児童のGoogleアカウントが正しく反映されない場合は？
- Google Workspace 管理コンソールの「アプリと拡張機能」設定で、拡張機能に **「Identity API（アカウント情報の取得）」** が許可されているか確認してください（通常は manifest.json の `"identity"` 権限により自動許可されます）。
- 児童が個人の私用 Google アカウント（@gmail.com など）でログインしている場合は学校組織のポリシーが適用されません。学校から配布された教育用 Google アカウントでログインしていることを確認してください。

### Q3. 新しいバージョンを配布したいときは？
1. `manifest.json` の `"version"` をインクリメントします（例: `1.0.0` → `1.0.1`）。
2. 初回に生成された秘密鍵 `extension.pem` を指定して再度「拡張機能のパッケージ化」を行います（同じ拡張機能IDが維持されます）。
3. 生成された `extension.crx` と、バージョン番号を書き換えた `update.xml` をサーバーに上書きアップロードするだけで、全生徒の Chromebook に自動でバックグラウンド更新が配信されます。

---

## ✅ 13校展開 運用チェックリスト（1拡張機能 + 学校別GAS）

本システムを**複数校（13校＋樸学園）**で運用する際の作業手順です。拡張機能は**1つ**、GAS／スプレッドシートは**学校ごと**に用意します。

### 事前準備（管理者）
- [ ] 各校の Google スプレッドシートを新規作成し、[SPREADSHEET_SETUP.md](SPREADSHEET_SETUP.md) の手順でシート（`端末一覧` / `教員マスタ`）とGASを設置
- [ ] 各校のGASを **「ウェブアプリ」** としてデプロイし、`.../exec` URL を控える（実行ユーザー: 自分／アクセス: 全員 or 組織内）
- [ ] 各校の**部署（OU）**を作成（例: `児童生徒/英田小学校`）＝ `school_name` をOU単位で配布するため

### 拡張機能の配布（1回だけ）
- [ ] `scripts/package_extension.sh` を実行 → `dist/extension.zip` / `dist/update.xml` / `dist/managed_policy.json` を生成
- [ ] `dist/managed_policy.json` の `REPLACE_WITH_XX_GAS_ID` を各校の実デプロイURLに置換（学校名は `CONFIG.SCHOOL_LIST` の正式名称のまま）
- [ ] ステップ1〜3の手順で `.crx` を作成し、管理コンソールから**1つの拡張機能**としてURL追加・強制インストール
- [ ] 拡張機能のポリシー（Managed Storage）に `dist/managed_policy.json` の内容を貼り付け

### 学校ごとのOU設定（各校分・繰り返し）
- [ ] 各校OUの拡張機能ポリシーで `school_name` を**その学校の正式名称**に設定（例: 英田小学校のOU → `"英田小学校"`）
  - ※ `gas_url_map` / `student_id`（`${USER_EMAIL}`）は共通のまま。`school_name` だけをOUごとに変える運用が最も簡単です
- [ ] 対象OUの児童アカウントで Chromebook にログインし、拡張機能が自動インストールされることを確認
- [ ] 児童端末の Chrome で `chrome://policy` → ポリシー再読み込み → `gas_url_map` / `school_name` が反映されていることを確認

### 動作確認（学校ごと）
- [ ] 児童端末の拡張機能ポップアップで「接続済み」になること（＝ `school_name` から解決した自校GASへ接続）
- [ ] 教員コンソールを開き、自校の端末一覧のみが表示されること（学校スコープ）
- [ ] 対象クラスを設定した教員が、その担当クラスの児童のみを操作できること（クラス境界）
- [ ] 画面ロック / ロック解除 / URL規制 / 一斉URL配信 が自校の児童端末にのみ作用すること（他校へ波及しない）

### よくあるつまずき
- **接続できない（他校のGASに繋がる）**: `school_name` の綴りが `CONFIG.SCHOOL_LIST` と一致しているか、`gas_url_map` のキーと一致しているか確認（`resolveGasUrl` は前後空白・全角・「美作市立〜」等を吸収しますが、短縮名「英田小」は正式名に解決しません）
- **未設定のまま**: `school_name` が空だと、教員画面から学校を紐付けるまで `gas_url`（無ければフォールバック）に接続します。学校OUには `school_name` を設定してください
- **教員が対象クラスを変更できない**: 仕様です。対象クラスは権限の境界のため**管理者のみ**変更可能です（マイURL・個別規制URLは全教員が変更可）
