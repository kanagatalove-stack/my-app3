# 1つの拡張機能で13校（＋樸学園＝全14校）を運用する仕組み

本ドキュメントは、次の2つのご質問に答えるものです。

1. **13校を一つの拡張機能で対応する方法** — Webアプリ（GAS）にどのように上げ、Google 管理コンソールでどのように児童端末へインストールするのか。
2. **スプレッドシートは13校別々でデプロイURLもそれぞれ違うのに、なぜ1つの拡張機能で別々に対応できるのか。**

---

## 結論（ひとことで）

> **配布するのは拡張機能「1つ」だけ。学校ごとに違うのは「GASのデプロイURL（＝接続先）」だけで、それを拡張機能が端末の所属学校名から自動で選び分ける。**

- 拡張機能 = 共通の「1つのアプリ」（1回だけパッケージ化・配布）
- 学校ごとに違うもの = スプレッドシート／GAS の **デプロイURL**（13校分）
- その「学校名 → GAS URL」の対応表を **`gas_url_map`** として管理コンソールから配布
- 各端末は自分の `school_name` を見て、**自分で正しいGASを選んで**通信する

---

## Part 1. 13校を1つの拡張機能で対応する方法（導入手順）

### 全体像

```
[配布するもの：1つだけ]
  extension.zip / extension.crx  ← 全校共通・1回だけ作成

[学校ごとに用意するもの：13セット]
  各校のスプレッドシート + GAS Webアプリ（デプロイURL）← 学校数だけ用意

[配る設定：1つの対応表]
  gas_url_map = { "英田小学校": "...URL_A", "大原小学校": "...URL_B", ... }
```

ポイントは、**「配るアプリ」と「配る設定」を分ける**ことです。アプリは1つ、設定（対応表）の中に13校分のURLを入れます。

---

### ステップ 0：各校のスプレッドシートとGASを用意（学校ごとに1回）

1. 各校の Google スプレッドシートを新規作成。
2. 「拡張機能 > Apps Script」を開き、`gas/Code.gs` を貼り付け、HTMLに `gas/index.html` を貼り付け。
3. 関数 `setupSpreadsheet` を実行 → `端末一覧` / `教員マスタ` シートが自動作成。
4. 「デプロイ > 新しいデプロイ > ウェブアプリ」でデプロイ。
   - 次のユーザーとして実行：**自分**
   - アクセスできるユーザー：**全員**（端末の拡張機能が認証なしで heartbeat を送るため）
5. 発行された **WebアプリURL**（`https://script.google.com/macros/s/XXXX/exec`）を控える。

→ これを **13校分（＋樸学園）** 繰り返し、**13個の `/exec` URL** を得ます。

> 📌 補足：GAS/スプレッドシートを分けるのは、**負荷分散**と**学校単位のデータ分離**のためです。
> 1つのGASに全13校を集約することも技術的には可能ですが、書込み競合や権限分離の観点から学校別が推奨です。

---

### ステップ 1：拡張機能をパッケージ化（1回だけ）

Chrome の `chrome://extensions` → デベロッパーモードON → **「拡張機能のパッケージ化」** → `extension` フォルダを指定。

- 生成物：`extension.crx`（本体）と `extension.pem`（**秘密鍵／再更新に必須。厳重保管**）
- 画面に表示される **32文字の拡張機能ID** を控える。

> この時点で13校分の区別はありません。**拡張機能はあくまで1つ**です。

---

### ステップ 2：`extension.crx` と `update.xml` をWebに公開

管理コンソールは「拡張機能ID + `update.xml` のURL」から本体を取りに行きます。`update.xml` は、どのバージョンの `.crx` をどこから取得するかを示す更新マニフェストです。

```xml
<?xml version='1.0' encoding='UTF-8'?>
<gupdate xmlns='http://www.google.com/update2/response' protocol='2.0'>
  <app appid='＜ステップ1の拡張機能ID＞'>
    <updatecheck codebase='https://＜公開先＞/extension.crx' version='1.3.0' />
  </app>
</gupdate>
```

公開先は GitHub Pages でも自治体のWebサーバーでも構いません（`scripts/package_extension.sh` が `dist/update.xml` のひな形を生成します）。

---

### ステップ 3：管理コンソールで「1つの拡張機能」として強制インストール

1. `admin.google.com` → **「デバイス > Chrome > アプリと拡張機能 > ユーザーとブラウザ」**
2. 対象の組織部門（OU）を選択（例：`児童生徒` または 各校OU）
3. **「＋」→「URL から Chrome アプリまたは拡張機能を追加」**
   - **拡張機能ID**：ステップ1の32文字
   - **URL**：ステップ2の `update.xml` のURL
4. 追加後、インストールポリシーを **「強制インストール」** に変更
   → 児童は削除・無効化できない。

> **ここが「1つ」の核心**：13校すべてに **同じ拡張機能ID** を配ります。学校ごとに別の拡張機能を作る必要はありません。

---

### ステップ 4：`gas_url_map` で13校のGASへ振り分け（ここが学校ごとの差分）

拡張機能の **「拡張機能のポリシー（Managed Storage）」** に、次のJSONを貼り付けます。

```json
{
  "gas_url_map": {
    "Value": {
      "英田小学校": "https://script.google.com/macros/s/＜英田小のID＞/exec",
      "大原小学校": "https://script.google.com/macros/s/＜大原小のID＞/exec",
      "江見小学校": "https://script.google.com/macros/s/＜江見小のID＞/exec",
      "勝田小学校": "https://script.google.com/macros/s/＜勝田小のID＞/exec",
      "勝田東小学校": "https://script.google.com/macros/s/＜勝田東小のID＞/exec",
      "第一小学校": "https://script.google.com/macros/s/＜第一小のID＞/exec",
      "北小学校": "https://script.google.com/macros/s/＜北小のID＞/exec",
      "土居小学校": "https://script.google.com/macros/s/＜土居小のID＞/exec",
      "英田中学校": "https://script.google.com/macros/s/＜英田中 のID＞/exec",
      "大原中学校": "https://script.google.com/macros/s/＜大原中のID＞/exec",
      "作東中学校": "https://script.google.com/macros/s/＜作東中のID＞/exec",
      "勝田中学校": "https://script.google.com/macros/s/＜勝田中 のID＞/exec",
      "美作中学校": "https://script.google.com/macros/s/＜美作中のID＞/exec",
      "樸学園":     "https://script.google.com/macros/s/＜樸学園のID＞/exec"
    }
  },
  "school_name": { "Value": "" },
  "student_id":  { "Value": "${USER_EMAIL}" }
}
```

> `dist/managed_policy.json` に、`CONFIG.SCHOOL_LIST` から **全14校分を自動列挙したひな形** が生成されます（`REPLACE_WITH_XX_GAS_ID` を各校URLへ置換するだけ）。

---

### ステップ 5：各校の組織部門（OU）に `school_name` を設定（学校ごとに1か所）

各校のOUで、拡張機能ポリシーの **`school_name` だけ** をその学校の正式名称に変更します。

- 例：英田小学校のOU → `"school_name": { "Value": "英田小学校" }`
- 例：大原小学校のOU → `"school_name": { "Value": "大原小学校" }`
- `gas_url_map` と `student_id`（`${USER_EMAIL}`）は**共通のまま**。

> これで、英田小の端末は `school_name = 英田小学校` を受け取り、`gas_url_map` の中から **英田小のGAS URL** を自動選択します。
> **学校ごとに変えるのは `school_name` 1行だけ**。これが「1つの拡張機能で13校」を実現する運用上の要です。

---

### 導入フロー（まとめ）

| 作業 | 単位 | 回数 |
|---|---|---|
| スプレッドシート + GAS 作成・デプロイ | 学校ごと | 13回 |
| 拡張機能のパッケージ化（`.crx`） | 全体 | 1回 |
| `.crx` / `update.xml` の公開 | 全体 | 1回 |
| 管理コンソールで拡張機能を追加・強制インストール | 全体 | 1回 |
| `gas_url_map`（13校のURL対応表）を配布 | 全体 | 1回 |
| 各校OUに `school_name` を設定 | 学校ごと | 13回 |

**ポイント**：拡張機能（アプリ本体）の作業は**1回**。学校ごとに増えるのは「URLを用意する」ことと「`school_name` を1行設定する」ことだけです。

---

## Part 2. なぜURLが学校ごとに違っても1つの拡張機能で対応できるのか

### 2-1. 拡張機能は「接続先を自分で決める」から

普通のアプリは「接続先が固定」ですが、本拡張機能は **接続先（GAS URL）を実行時に自分で決めます**。

拡張機能の処理（`background.js`）は、同期のたびに次を行います：

```
1. 自分の school_name を確認する         （管理コンソールのポリシーから取得）
2. gas_url_map[自分の school_name] を探す （13校分の対応表）
3. 見つかったURL（＝自校のGAS）へだけ通信する
```

つまり、**「13個のURL」は拡張機能の中にハードコードされているのではなく、ポリシーの `gas_url_map` として外から与えられます**。だからアプリ本体（`.crx`）は1つのままでよいのです。

実装イメージ（`resolveGasUrl`）：

```js
function resolveGasUrl(data) {
  const map = data.gas_url_map;        // {学校名: GAS URL} の対応表
  const school = data.school_name;     // この端末の所属校（ポリシーで配布）

  if (school) {
    if (map[school]) return map[school];              // 完全一致
    // 表記ゆれ（「英田小」「美作市立英田小学校」等）を吸収して照合
    for (const key of Object.keys(map)) {
      if (normalizeSchoolKey(key) === normalizeSchoolKey(school)) return map[key];
    }
  }
  return data.gas_url;                 // 対応表に無い場合は共通URLへフォールバック
}
```

### 2-2. 「アプリ」と「設定」を分離している（Managed Storage の役割）

| 層 | 中身 | 学校ごとに違う？ | 配布方法 |
|---|---|---|---|
| アプリ本体（`.crx`） | 画面ロック・URL規制・同期などの**共通ロジック** | ❌ 全校共通 | 管理コンソールで1回配布 |
| 設定（Managed Storage） | `gas_url_map` / `school_name` / `student_id` | ⭕ 学校ごとに値が違う | OU単位でポリシー配布 |

**同じアプリに、違う設定を配る**。これが1つで13校を捌ける理由です。
（OSでいう「同じソフトを入れ、設定ファイルだけ拠点ごとに変える」のと同じ考え方です。）

### 2-3. 「学校名」という共通のキーで紐付けるから

13校のスプレッドシートは別々でも、**学校名は全システムで共通の識別子**です。

- ポリシー：`school_name = "英田小学校"`（そのOUの端末に配る）
- 対応表：`gas_url_map["英田小学校"] = "...英田小のURL"`

学校名という共通キーがあるため、「この端末 → このGAS」を機械的に一意に決められます。

さらに、`normalizeSchoolKey` が表記ゆれを吸収します：

- 前後の空白・全角スペース
- 全角英数字 → 半角
- 接頭辞「美作市立」「市立」「公立」を除去

→ 「美作市立英田小学校」でも「　英田小学校　」でも同じ `英田小学校` として一致します。

### 2-4. 1つの学校だけを変更・追加したいときも安全

- **URLを差し替え**：`gas_url_map` の該当行を書き換えて再配布するだけ。拡張機能の再パッケージ・再インストールは不要。
- **学校を増やす**：`gas_url_map` に行を追加し、新校のOUに `school_name` を設定。
- **未設定の端末**：`school_name` が空でも、`gas_url`（共通URL）へフォールバックするか、教員画面で学校を紐付けた時点で正しいGASへ切り替わります。

---

## よくある誤解と回答

**Q. 13校それぞれに拡張機能を作る必要がある？**
→ いいえ。**拡張機能は1つ**です。学校ごとに違うのは「GASのデプロイURL」で、それは `gas_url_map` という設定として外から配ります。

**Q. 13個のURLを拡張機能に埋め込むの？**
→ 埋め込みません。`gas_url_map` は管理コンソールのポリシーとして配布され、端末は自分の `school_name` から必要なURLを選びます。だからアプリ本体は1つのままです。

**Q. 学校ごとに違う設定を配るには？**
→ 各校の **組織部門（OU）** ごとにポリシーを設定します。`gas_url_map` と `student_id` は共通、**`school_name` だけをOUごとに変える**のが最も簡単です。

**Q. 学校名の表記ゆれで繋がらないのでは？**
→ `normalizeSchoolKey` が空白・全角・「美作市立〜」等を吸収します。ただし短縮名「英田小」は正式名に解決しないため、`CONFIG.SCHOOL_LIST` の正式名称を使用してください。

**Q. セキュリティは大丈夫？**
→ 端末は自校のGASにのみ接続し、教員は自校・担当クラスのみ操作可能（学校スコープ＋クラス境界）。他校のデータには触れられません。

---

## 用語

| 用語 | 意味 |
|---|---|
| Managed Storage | 管理コンソールから配布される組織ポリシー。拡張機能が `chrome.storage.managed` で読み取る |
| `gas_url_map` | 「学校名 → GAS URL」の対応表。1拡張で13校へ振り分ける中核 |
| `school_name` | 端末の所属校。OUごとに配布し、`gas_url_map` の検索キーになる |
| `resolveGasUrl` | `school_name` から実際に通信すべきGAS URLを決定する関数 |
| `normalizeSchoolKey` | 学校名の表記ゆれを吸収する正規化関数 |
| OU（組織部門） | 管理コンソール上のグループ。学校ごとに作成し、ポリシーの適用単位にする |
