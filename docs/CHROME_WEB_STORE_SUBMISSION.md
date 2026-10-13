# Chrome ウェブストア「限定公開（Unlisted）」提出メモ

本ドキュメントは、Chromebook 児童端末管理クライアント（Chrome 拡張機能）を
**Chrome ウェブストアに「限定公開（Unlisted）」で提出する際に、開発者ダッシュボードへ
そのまま入力できる文言と設定値**をまとめたものです。

- 対象バージョン: **1.6.1**（`extension/manifest.json`）
- 提出用パッケージ: `dist/extension.zip`（`bash scripts/package_extension.sh` で生成）
- 画像アセット: `dist/store_assets/` 配下

---

## 0. 事前に必要なもの

- Google アカウント（開発者登録用。教育委員会の共用アカウントでも可）
- 初回のみ **開発者登録料 5 USD**（買い切り）
  - <https://chrome.google.com/webstore/devconsole> → 規約同意 → 支払い
- 配布用 ZIP: `dist/extension.zip`
- 画像アセット: `dist/store_assets/`（本メモ §4）

> ⚠️ ウェブストアは**リモートコードを禁止**しています。本拡張機能は Tailwind CDN を
> 除去済みで自己完結しています（`popup.css` 同梱）。**CDN を再追加しないでください。**

---

## 1. ストアの掲載情報（Store listing タブ）

### 名前（Name）
```
Chromebook 児童端末管理クライアント
```

### 概要（Summary／132文字以内）
```
教育委員会が管理するChromebook児童端末向けの画面ロック・URL規制・一斉URL配信クライアントです。管理者の許可なく個人が利用することはできません。
```

### 詳細説明（Detailed description）
```
Chromebook 児童端末管理クライアントは、教育委員会が管理する Google Workspace for Education 環境で、児童生徒の Chromebook を一元的に管理するためのクライアント拡張機能です。

■ 主な機能
・画面ロック：教員の操作により、対象の児童端末を全画面ロック（キーボード・マウス入力を無効化）します。
・URL規制：許可リスト（ホワイトリスト）／禁止リスト（ブラックリスト）方式で、学習に不要なサイトへのアクセスを制限します。
・一斉URL配信：教員が指定したURLを、対象の児童端末で一斉に開かせます。
・見守り（閲覧状況の把握）：児童が現在開いているページを教員コンソールで確認できます。
・自動構成：Google 管理コンソールから配布されるポリシーにより、児童の操作なしで自動的に設定されます。

■ 想定利用者
教育委員会および学校の教職員（管理者）。児童生徒は本拡張機能を操作する必要はありません。学校から配布された教育用 Google アカウントでの利用を前提としています。

■ データの取り扱い
・取得する情報：ログイン中の Google アカウント（メール）、現在開いているURL、名簿に基づく氏名・学校・クラス、教員が指示した場合の画面情報。
・利用目的：端末管理（画面ロック・URL規制・一斉配信・見守り）のみ。
・保管：教育委員会の Google Workspace 組織内のスプレッドシートに保管し、第三者へ提供・販売しません。
・詳細はプライバシーポリシーをご覧ください。

■ 注意
本拡張機能は教育委員会の管理下でのみ使用されます。管理者の許可なく個人がインストール・利用することはできません。
```

### カテゴリ（Category）
```
教育（Education）
```
- 理由：学校の授業・学習環境を支援する「teaching aid（教授補助）」に該当。
- 次点候補：`仕事効率化（Workflow & Planning）`。

### 言語（Language）
```
日本語（Japanese）
```

### その他の項目
| 項目 | 設定値 |
|---|---|
| コンテンツレーティング（Mature content） | **OFF** |
| 公式URL（Official URL） | 任意（教育委員会ドメインを Search Console で確認済みの場合） |
| ホームページURL（Homepage URL） | 任意（教育委員会の案内ページ） |
| サポートURL（Support URL） | 任意（教育委員会の問い合わせページ） |

---

## 2. プライバシータブ（Privacy practices）

### 2-1. 単一用途（Single purpose description）
```
教育委員会が管理する児童端末（Chromebook）に対して、教職員が画面ロック・URL規制・一斉URL配信・閲覧状況の把握を一括で実行するためのクライアント機能を提供すること。
```

### 2-2. 権限の正当性（Permissions justification）
> 本バージョン（1.6.1）で未使用の `tabCapture` 権限を削除しました。審査画面には以下が表示されます。

| 権限 | 貼り付け文 |
|---|---|
| `host_permissions: <all_urls>` | 児童端末で開かれる任意のWebページ上で、画面ロック画面の表示とURL規制（許可/禁止）を実行するために必要です。本拡張機能は教育委員会が管理する端末にのみ配布されます。 |
| `storage` | 管理コンソールから配布されるポリシー（接続先URL・学校名）と同期状態を端末内に保存するために使用します。 |
| `storage.managed`（`managed_schema`） | 管理者が Google 管理コンソールから配布するポリシーを読み取るために使用します。 |
| `alarms` | 教員の指示（画面ロック・一斉配信など）を反映するため、定期的にサーバーと同期するために使用します。 |
| `tabs` | 教員コンソールへ現在閲覧中のURL（見守り）を報告し、一斉URL配信の対象タブを制御するために使用します。 |
| `identity` / `identity.email` | ログイン中の児童 Google アカウント（メールアドレス）を自動取得し、児童IDとして名簿と突合するために使用します。 |

### 2-3. リモートコード（Remote code）
```
No, I am not using remote code.（リモートコードは使用していません）
```

### 2-4. データ使用（Data usage）— 収集するデータ（チェックする項目）
| 収集するデータ | チェック | 根拠（実装） |
|---|:--:|---|
| 個人を特定できる情報（Personally identifiable information） | ✓ | 名簿の氏名・学校・クラス |
| 認証情報（Authentication information） | ✓ | Google アカウントのメール（`identity.email`） |
| ウェブ履歴（Web history） | ✓ | 現在開いているURLの定期報告 |
| ウェブサイトのコンテンツ（Website content） | ✓ | 画面情報（スクリーンショット）の取得・送信 |
| ユーザーアクティビティ（User activity） | ✓ | 同期時刻・最終ログイン等 |

**認証（certification）3項目はすべてチェック（該当）**：
1. 承認された用途以外で、ユーザーデータを第三者へ販売・転送しません。
2. 本拡張機能の単一用途に無関係な目的でユーザーデータを使用・転送しません。
3. 信用力の判断・融資目的でユーザーデータを使用しません。

### 2-5. プライバシーポリシーURL（必須）
- 公開URLに設置したプライバシーポリシーの URL を貼ります。
- **公開済みURL（確定）**：
  ```
  https://kanagatalove-stack.github.io/my-app3/privacy-policy.html
  ```
  - 配信元ファイル: 本リポジトリ直下の **`privacy-policy.html`**（GitHub Pages・main:/ 配信）
  - ランディング: `https://kanagatalove-stack.github.io/my-app3/`（`index.html`）
- ※ 連絡先は美作市教育委員会の公式情報（教育総務課 〒707-8501 岡山県美作市美来1番地／0868-72-2900）を反映済み。

---

## 3. 配布タブ（Distribution）
| 項目 | 設定値 |
|---|---|
| 公開範囲（Visibility） | **Unlisted（限定公開）** |
| 対象地域 | 日本 |
| 審査の送信 | 「審査のために送信」をクリック |

> Unlisted はストア検索に出ませんが、**アイテムIDを知っている人／管理コンソールからは**インストールできます。

---

## 4. 画像アセット（Graphic assets）

提出用ファイルは **`dist/store_assets/`** に配置済みです。

| 種類 | ファイル | サイズ | 必須 |
|---|---|---|---|
| ストアアイコン | `dist/store_assets/store_icon_128.png` | 128×128（96アート＋16px透過パディング） | **必須** |
| スクリーンショット① 管理コンソール | `dist/store_assets/screenshot_1_console.png` | 1280×800 | **1枚以上** |
| スクリーンショット② 児童端末ポップアップ | `dist/store_assets/screenshot_2_popup.png` | 1280×800 | 推奨 |
| スクリーンショット③ 画面ロック | `dist/store_assets/screenshot_3_lock.png` | 1280×800 | 推奨 |
| スモールプロモタイル | `dist/store_assets/small_promo_tile_440x280.png` | 440×280 | **必須** |
| マーキープロモタイル | `dist/store_assets/marquee_1400x560.png` | 1400×560 | 任意 |

> 拡張機能本体のアイコン（`extension/icons/` の 16/48/128）も本バージョンで刷新済みです。
> これらは `dist/extension.zip` に含まれます。

---

## 5. 更新（バージョンアップ）手順

1. `extension/manifest.json` の `"version"` を上げる。
2. `bash scripts/package_extension.sh` で `dist/extension.zip` を再作成。
3. 開発者ダッシュボード → 対象アイテム → **「パッケージ」→「新しいパッケージをアップロード」**。
4. 「審査のために送信」→ 承認されると**全端末へ自動更新**（児童・教員の操作不要）。

> アイテムIDは不変のため、管理コンソール側の設定変更は不要です。

---

## 6. 提出前チェックリスト

- [x] 未使用権限 `tabCapture` を削除（審査リスク低減）
- [x] ストアアイコン（128×128, 96アート＋16pad）を用意
- [x] スクリーンショット 1280×800 を 3 枚用意
- [x] スモールプロモタイル 440×280 を用意
- [x] プライバシーポリシー雛形を作成（`docs/privacy-policy.html`）
- [x] プライバシーポリシーを公開URLへ設置（https://kanagatalove-stack.github.io/my-app3/privacy-policy.html ）
- [ ] `dist/extension.zip` をアップロード
- [ ] §1〜§3 の文言を貼り付け
- [ ] 配布タブで Unlisted を選択 → 審査のために送信
