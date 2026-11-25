# Chromebook 児童端末管理システム 操作説明書

**美作市教育委員会 ／ 14小中学校**

**拡張機能 v1.6.11 対応 ／ 2026年11月改訂**

はじめてこのシステムを使う先生向けの説明書です。
「このボタンを押すと、児童の画面はこうなる」という**操作例**を中心にまとめました。

> **この説明書の読み方**
> - **前半（第1〜9章）** … 先生が毎日の授業で使う操作。まずはここだけ読めば使えます。
> - **後半（第10〜12章）** … 管理者（情報担当の先生）が最初に1回だけ行う設定。

---

## 目次

**前半：先生の日常操作**

1. [このシステムでできること](#1-このシステムでできること)
2. [ログインする](#2-ログインする)
3. [画面の見方](#3-画面の見方)
4. [操作例：児童の画面をロックする](#4-操作例児童の画面をロックする)
5. [操作例：URLを配信する・規制する](#5-操作例urlを配信する規制する)
6. [操作例：児童の画面を見る](#6-操作例児童の画面を見る)
7. [操作例：注意マーク（サイト監視）](#7-操作例注意マークサイト監視)
8. [予約スケジュール（時間制限タイマー）](#8-予約スケジュール時間制限タイマー)
9. [困ったときは](#9-困ったときは)

**後半：管理者の初期設定**

10. [システムの全体像](#10-システムの全体像)
11. [初期設定の手順](#11-初期設定の手順)
12. [サイト監視の設定](#12-サイト監視の設定)
13. [アカウントと権限（ADMIN と TEACHER の違い）](#13-アカウントと権限admin-と-teacher-の違い)
14. [マイ設定とアカウント管理](#14-マイ設定とアカウント管理)
15. [年次更新設定](#15-年次更新設定)

---

# 前半：先生の日常操作

## 1. このシステムでできること

先生のパソコン（またはChromebook）から、**教室の児童端末をまとめて管理**できます。
児童の端末に特別な操作は必要ありません。電源を入れてGoogleアカウントでログインすれば、自動で一覧に表示されます。

### できること一覧

| できること | 何が起きるか | 使う場面 |
|---|---|---|
| **画面ロック** | 児童の画面が操作できない状態になる | 話を聞かせたいとき、テスト中 |
| **一斉URL配信** | 全員の画面が指定したページに切り替わる | 授業で使うサイトを一斉に開かせたい |
| **URL規制** | 決めたサイトだけ見られる／見られないようにする | 調べ学習中、関係ないサイトを防ぐ |
| **画面情報取得** | 児童の今の画面を写真で確認できる | きちんと作業できているか見たい |
| **サイト監視** | 学習に関係ないサイトを開くと名簿に「⚠ 注意」が出る | 見回りなしで気づきたい |
| **予約スケジュール** | 指定した日時のあいだだけ、自動でロックや規制がON/OFFになる | 放課後・長期休業・テスト期間 |

### 仕組み（かんたんに）

```svg
<svg viewBox="0 0 720 250" xmlns="http://www.w3.org/2000/svg" font-family="sans-serif">
  <rect width="720" height="250" fill="#f8fafc" rx="12"/>
  <rect x="30" y="80" width="150" height="90" rx="10" fill="#4f46e5"/>
  <text x="105" y="115" fill="#fff" font-size="14" font-weight="bold" text-anchor="middle">先生の画面</text>
  <text x="105" y="136" fill="#c7d2fe" font-size="11" text-anchor="middle">管理コンソール</text>
  <text x="105" y="152" fill="#c7d2fe" font-size="11" text-anchor="middle">（ブラウザ）</text>
  <path d="M185 125 L245 125" stroke="#94a3b8" stroke-width="2" marker-end="url(#ar)"/>
  <rect x="250" y="80" width="150" height="90" rx="10" fill="#059669"/>
  <text x="325" y="115" fill="#fff" font-size="14" font-weight="bold" text-anchor="middle">指示の中継役</text>
  <text x="325" y="136" fill="#a7f3d0" font-size="11" text-anchor="middle">Google Apps Script</text>
  <text x="325" y="152" fill="#a7f3d0" font-size="11" text-anchor="middle">（クラウド上）</text>
  <path d="M405 125 L465 125" stroke="#94a3b8" stroke-width="2" marker-end="url(#ar)"/>
  <rect x="470" y="80" width="130" height="90" rx="10" fill="#0284c7"/>
  <text x="535" y="115" fill="#fff" font-size="14" font-weight="bold" text-anchor="middle">記録表</text>
  <text x="535" y="136" fill="#bae6fd" font-size="11" text-anchor="middle">スプレッドシート</text>
  <path d="M600 125 L660 125" stroke="#94a3b8" stroke-width="2" marker-end="url(#ar)"/>
  <rect x="665" y="80" width="0" height="0"/>
  <rect x="470" y="195" width="220" height="42" rx="8" fill="#fbbf24"/>
  <text x="580" y="221" fill="#78350f" font-size="12" text-anchor="middle" font-weight="bold">児童のChromebook（自動で反映）</text>
  <path d="M605 170 L605 193" stroke="#94a3b8" stroke-width="2" marker-end="url(#ar)"/>
  <text x="30" y="40" fill="#334155" font-size="13" font-weight="bold">先生が押す → クラウド経由 → 児童の端末へ（数秒）</text>
  <text x="30" y="62" fill="#64748b" font-size="11">児童は何も操作しません。Googleアカウントでログインしていれば自動でつながります。</text>
  <defs><marker id="ar" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6" fill="#94a3b8"/></marker></defs>
</svg>
```

**反映までの速さの目安**

| 場面 | 反映まで |
|---|---|
| 先生が管理画面を開いているとき | **約2秒** |
| 誰も管理画面を開いていないとき | **反映されません**（児童端末が通信を止めます） |

> ⚠ **大事なこと**：児童端末は「先生が管理画面を開いている間」だけ通信します。
> 操作するときは、管理画面を開いたままにしてください。閉じると指示が届きません。

---

## 2. ログインする

```svg
<svg viewBox="0 0 560 300" xmlns="http://www.w3.org/2000/svg" font-family="sans-serif">
  <rect width="560" height="300" fill="#e2e8f0" rx="10"/>
  <rect x="120" y="30" width="320" height="240" rx="12" fill="#fff" stroke="#cbd5e1"/>
  <text x="280" y="72" fill="#1e293b" font-size="16" font-weight="bold" text-anchor="middle">教員管理コンソール</text>
  <text x="280" y="94" fill="#64748b" font-size="10" text-anchor="middle">美作市 14小中学校 Chromebook児童端末一括管理</text>
  <text x="145" y="128" fill="#475569" font-size="11">教員Googleアカウント（メールアドレス）</text>
  <rect x="145" y="136" width="270" height="30" rx="6" fill="#f8fafc" stroke="#cbd5e1"/>
  <text x="155" y="156" fill="#94a3b8" font-size="11">taro@mimasaka.ed.jp</text>
  <text x="145" y="188" fill="#475569" font-size="11">管理パスワード</text>
  <rect x="145" y="196" width="270" height="30" rx="6" fill="#f8fafc" stroke="#cbd5e1"/>
  <text x="155" y="216" fill="#94a3b8" font-size="14">••••••••</text>
  <rect x="145" y="240" width="270" height="32" rx="7" fill="#4f46e5"/>
  <text x="280" y="261" fill="#fff" font-size="13" font-weight="bold" text-anchor="middle">ログイン</text>
  <rect x="40" y="130" width="60" height="0"/>
  <text x="60" y="290" fill="#64748b" font-size="10">① メールアドレス　② パスワード　③ ログイン</text>
</svg>
```

1. 管理コンソールのURLをブラウザで開きます。
2. **教員Googleアカウント（メールアドレス）** を入力します。
3. **管理パスワード** を入力します。
4. **ログイン** を押します。

> 💡 パスワードは管理者（情報担当の先生）から配布されます。
> 学校ごとに管理コンソールのURLが違う場合があります。配布されたURLを使ってください。

---

## 3. 画面の見方

ログインすると、次の画面が出ます。

```svg
<svg viewBox="0 0 760 430" xmlns="http://www.w3.org/2000/svg" font-family="sans-serif">
  <rect width="760" height="430" fill="#f1f5f9" rx="10"/>
  <!-- header -->
  <rect x="10" y="10" width="740" height="46" rx="8" fill="#1e1b4b"/>
  <text x="26" y="30" fill="#fff" font-size="12" font-weight="bold">教員管理コンソール</text>
  <text x="26" y="45" fill="#a5b4fc" font-size="8">美作市 14小中学校</text>
  <rect x="470" y="20" width="66" height="24" rx="5" fill="#047857"/>
  <text x="503" y="36" fill="#fff" font-size="8" text-anchor="middle">アカウント管理</text>
  <rect x="542" y="20" width="62" height="24" rx="5" fill="#3730a3"/>
  <text x="573" y="36" fill="#fff" font-size="8" text-anchor="middle">設定</text>
  <rect x="610" y="20" width="60" height="24" rx="5" fill="#9f1239"/>
  <text x="640" y="36" fill="#fff" font-size="8" text-anchor="middle">監視設定</text>
  <rect x="676" y="20" width="60" height="24" rx="5" fill="#e11d48"/>
  <text x="706" y="36" fill="#fff" font-size="8" text-anchor="middle">ログアウト</text>
  <!-- tabs -->
  <rect x="22" y="66" width="70" height="26" rx="6" fill="#4f46e5"/>
  <text x="57" y="83" fill="#fff" font-size="9" text-anchor="middle">端末一覧</text>
  <rect x="98" y="66" width="70" height="26" rx="6" fill="#e2e8f0"/>
  <text x="133" y="83" fill="#475569" font-size="9" text-anchor="middle">画面一覧</text>
  <!-- stat cards -->
  <g font-size="8">
    <rect x="22" y="102" width="172" height="48" rx="7" fill="#fff" stroke="#e2e8f0"/>
    <text x="38" y="120" fill="#64748b">管理対象端末</text><text x="38" y="140" fill="#1e293b" font-size="16" font-weight="bold">28</text>
    <rect x="204" y="102" width="172" height="48" rx="7" fill="#fff" stroke="#e2e8f0"/>
    <text x="220" y="120" fill="#64748b">接続中（オンライン）</text><text x="220" y="140" fill="#059669" font-size="16" font-weight="bold">26</text>
    <rect x="386" y="102" width="172" height="48" rx="7" fill="#fff" stroke="#e2e8f0"/>
    <text x="402" y="120" fill="#64748b">画面ロック中</text><text x="402" y="140" fill="#e11d48" font-size="16" font-weight="bold">0</text>
    <rect x="568" y="102" width="172" height="48" rx="7" fill="#fff" stroke="#e2e8f0"/>
    <text x="584" y="120" fill="#64748b">URL規制モード中</text><text x="584" y="140" fill="#d97706" font-size="16" font-weight="bold">0</text>
  </g>
  <!-- toolbar -->
  <rect x="22" y="162" width="340" height="54" rx="7" fill="#fff" stroke="#e2e8f0"/>
  <text x="36" y="180" fill="#475569" font-size="8">学校:</text>
  <rect x="66" y="170" width="96" height="16" rx="3" fill="#f8fafc" stroke="#cbd5e1"/>
  <text x="72" y="182" fill="#334155" font-size="7">英田小学校</text>
  <text x="176" y="180" fill="#475569" font-size="8">検索:</text>
  <rect x="204" y="170" width="146" height="16" rx="3" fill="#f8fafc" stroke="#cbd5e1"/>
  <text x="210" y="182" fill="#94a3b8" font-size="7">Googleアカウント・氏名で検索...</text>
  <rect x="36" y="194" width="120" height="14" rx="7" fill="#eef2ff" stroke="#c7d2fe"/>
  <text x="96" y="204" fill="#3730a3" font-size="7" text-anchor="middle">3 台選択中</text>
  <rect x="376" y="162" width="364" height="54" rx="7" fill="#fff" stroke="#e2e8f0"/>
  <rect x="390" y="176" width="76" height="26" rx="5" fill="#64748b"/>
  <text x="428" y="193" fill="#fff" font-size="8" text-anchor="middle">ロック / 解除</text>
  <rect x="474" y="176" width="76" height="26" rx="5" fill="#2563eb"/>
  <text x="512" y="193" fill="#fff" font-size="8" text-anchor="middle">一斉URL配信</text>
  <rect x="558" y="176" width="76" height="26" rx="5" fill="#d97706"/>
  <text x="596" y="193" fill="#fff" font-size="8" text-anchor="middle">URL規制変更</text>
  <rect x="642" y="176" width="84" height="26" rx="5" fill="#0891b2"/>
  <text x="684" y="193" fill="#fff" font-size="8" text-anchor="middle">画面情報取得</text>
  <!-- table -->
  <rect x="22" y="226" width="718" height="190" rx="7" fill="#fff" stroke="#e2e8f0"/>
  <rect x="22" y="226" width="718" height="24" fill="#f1f5f9"/>
  <g font-size="7" fill="#475569" font-weight="bold">
    <text x="32" y="242">☐</text>
    <text x="52" y="242">児童情報（Googleアカウント・氏名）</text>
    <text x="300" y="242">接続状態</text>
    <text x="366" y="242">画面ロック</text>
    <text x="432" y="242">URL規制</text>
    <text x="496" y="242">現在閲覧中のURL</text>
    <text x="646" y="242">最終通信</text>
    <text x="700" y="242">操作</text>
  </g>
  <line x1="22" y1="250" x2="740" y2="250" stroke="#e2e8f0"/>
  <!-- row1 -->
  <text x="32" y="276" font-size="7">☐</text>
  <rect x="52" y="258" width="120" height="14" rx="3" fill="#eef2ff"/>
  <text x="58" y="268" fill="#1e3a8a" font-size="7">taro@mimasaka.ed.jp</text>
  <text x="52" y="284" fill="#1e293b" font-size="8" font-weight="bold">山田 太郎</text>
  <text x="52" y="296" fill="#64748b" font-size="7">• 5年1組</text>
  <rect x="300" y="262" width="46" height="14" rx="7" fill="#d1fae5"/>
  <text x="323" y="272" fill="#065f46" font-size="6" text-anchor="middle">オンライン</text>
  <rect x="366" y="262" width="46" height="14" rx="4" fill="#f1f5f9"/>
  <text x="389" y="272" fill="#475569" font-size="6" text-anchor="middle">🔓 解除中</text>
  <text x="438" y="272" fill="#64748b" font-size="6">OFF</text>
  <text x="496" y="272" fill="#4f46e5" font-size="6">scratch.mit.edu</text>
  <text x="646" y="272" fill="#64748b" font-size="6">3秒前</text>
  <line x1="22" y1="300" x2="740" y2="300" stroke="#f1f5f9"/>
  <!-- row2 : monitor -->
  <text x="32" y="326" font-size="7">☐</text>
  <rect x="52" y="308" width="120" height="14" rx="3" fill="#eef2ff"/>
  <text x="58" y="318" fill="#1e3a8a" font-size="7">hanako@mimasaka.ed.jp</text>
  <text x="52" y="334" fill="#1e293b" font-size="8" font-weight="bold">鈴木 花子</text>
  <rect x="104" y="326" width="34" height="12" rx="3" fill="#ffe4e6" stroke="#fda4af"/>
  <text x="121" y="335" fill="#9f1239" font-size="6" text-anchor="middle">⚠ 注意</text>
  <text x="52" y="346" fill="#64748b" font-size="7">• 5年1組</text>
  <rect x="300" y="312" width="46" height="14" rx="7" fill="#d1fae5"/>
  <text x="323" y="322" fill="#065f46" font-size="6" text-anchor="middle">オンライン</text>
  <rect x="366" y="312" width="46" height="14" rx="4" fill="#f1f5f9"/>
  <text x="389" y="322" fill="#475569" font-size="6" text-anchor="middle">🔓 解除中</text>
  <text x="438" y="322" fill="#64748b" font-size="6">OFF</text>
  <text x="496" y="322" fill="#e11d48" font-size="6">youtube.com</text>
  <text x="646" y="322" fill="#64748b" font-size="6">5秒前</text>
  <line x1="22" y1="350" x2="740" y2="350" stroke="#f1f5f9"/>
  <!-- row3 -->
  <text x="32" y="376" font-size="7">☐</text>
  <rect x="52" y="358" width="120" height="14" rx="3" fill="#eef2ff"/>
  <text x="58" y="368" fill="#1e3a8a" font-size="7">jiro@mimasaka.ed.jp</text>
  <text x="52" y="384" fill="#1e293b" font-size="8" font-weight="bold">佐藤 次郎</text>
  <text x="52" y="396" fill="#64748b" font-size="7">• 5年1組</text>
  <rect x="300" y="362" width="40" height="14" rx="7" fill="#f1f5f9"/>
  <text x="320" y="372" fill="#64748b" font-size="6" text-anchor="middle">オフライン</text>
  <rect x="366" y="362" width="46" height="14" rx="4" fill="#ffe4e6"/>
  <text x="389" y="372" fill="#9f1239" font-size="6" text-anchor="middle">🔒 ロック中</text>
  <text x="438" y="372" fill="#64748b" font-size="6">OFF</text>
  <text x="496" y="372" fill="#94a3b8" font-size="6">-</text>
  <text x="646" y="372" fill="#64748b" font-size="6">12分前</text>
</svg>
```

### 画面の4つの数字（上部）

| 数字 | 意味 |
|---|---|
| **管理対象端末** | 一覧に登録されている児童端末の数 |
| **接続中（オンライン）** | 今つながっている端末。**60秒以内**に通信した端末を数えます |
| **画面ロック中** | 今ロックしている端末の数 |
| **URL規制モード中** | URL規制がかかっている端末の数 |

### 名簿の見方

| 項目 | 意味 |
|---|---|
| **接続状態** | オンラインなら緑、オフラインなら灰色 |
| **画面ロック** | 🔒 ロック中 ／ 🔓 解除中 |
| **URL規制** | 許可のみ ／ 規制拒否 ／ OFF |
| **現在閲覧中のURL** | 児童が今開いているページ |
| **最終通信** | 最後に通信した時刻（「3秒前」など） |
| **⚠ 注意** | サイト監視が学習に関係ないサイトを検知した印（第7章） |

> 💡 **「オフライン」でも操作できます。**
> オフラインは「今つながっていない」だけで、電源が入りログインすれば自動でオンラインになります。

---

## 4. 操作例：児童の画面をロックする

### こんなときに使います
- 説明を聞かせたいとき
- テストやアンケートの最中
- 手を止めさせたいとき

### 手順

```svg
<svg viewBox="0 0 720 200" xmlns="http://www.w3.org/2000/svg" font-family="sans-serif">
  <rect width="720" height="200" fill="#f8fafc" rx="10"/>
  <text x="20" y="30" fill="#1e293b" font-size="12" font-weight="bold">① ロックしたい児童にチェックを入れる</text>
  <rect x="20" y="44" width="330" height="60" rx="6" fill="#fff" stroke="#cbd5e1"/>
  <text x="32" y="64" font-size="11" fill="#4f46e5">☑</text>
  <text x="52" y="64" font-size="10" fill="#1e293b" font-weight="bold">山田 太郎</text>
  <text x="32" y="88" font-size="11" fill="#4f46e5">☑</text>
  <text x="52" y="88" font-size="10" fill="#1e293b" font-weight="bold">鈴木 花子</text>
  <rect x="250" y="50" width="86" height="18" rx="9" fill="#eef2ff" stroke="#c7d2fe"/>
  <text x="293" y="63" font-size="8" fill="#3730a3" text-anchor="middle">2 台選択中</text>
  <text x="380" y="30" fill="#1e293b" font-size="12" font-weight="bold">② 「ロック / 解除」を押す</text>
  <rect x="380" y="58" width="130" height="34" rx="7" fill="#475569"/>
  <text x="445" y="80" fill="#fff" font-size="12" text-anchor="middle" font-weight="bold">🔒 ロック / 解除</text>
  <path d="M348 74 L374 74" stroke="#94a3b8" stroke-width="2" marker-end="url(#a2)"/>
  <text x="530" y="30" fill="#1e293b" font-size="12" font-weight="bold">③ 確認 → OK</text>
  <rect x="530" y="50" width="170" height="52" rx="7" fill="#fff" stroke="#cbd5e1"/>
  <text x="615" y="70" font-size="9" fill="#334155" text-anchor="middle">2 台の画面ロックを</text>
  <text x="615" y="85" font-size="9" fill="#334155" text-anchor="middle">ON にしますか？</text>
  <rect x="1060" y="60" width="0" height="0"/>
  <rect x="556" y="106" width="56" height="16" rx="4" fill="#e2e8f0"/><text x="584" y="117" font-size="8" fill="#475569" text-anchor="middle">キャンセル</text>
  <rect x="620" y="106" width="60" height="16" rx="4" fill="#4f46e5"/><text x="650" y="117" font-size="8" fill="#fff" text-anchor="middle">OK</text>
  <text x="20" y="145" fill="#475569" font-size="9">※ 「すべて選択」のチェックボックスを使うと、表示中の児童をまとめて選べます。</text>
  <text x="20" y="165" fill="#475569" font-size="9">※ 学校やクラスで絞り込んでから選ぶと、対象外の児童を誤って操作しません。</text>
  <text x="20" y="185" fill="#dc2626" font-size="9">※ 他校の児童は選んでも操作できません（安全のため）。</text>
  <defs><marker id="a2" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6" fill="#94a3b8"/></marker></defs>
</svg>
```

1. ロックしたい児童の**チェックボックス**を入れます。
2. **「ロック / 解除」** ボタンを押します。
3. 確認が出るので **OK** を押します。

### 押すと児童の画面はこうなります

```svg
<svg viewBox="0 0 460 260" xmlns="http://www.w3.org/2000/svg" font-family="sans-serif">
  <rect x="60" y="14" width="340" height="212" rx="10" fill="#1e293b"/>
  <rect x="72" y="26" width="316" height="188" rx="4" fill="#fbbf24"/>
  <circle cx="230" cy="72" r="26" fill="#78350f" opacity="0.12"/>
  <text x="230" y="84" font-size="30" text-anchor="middle">🔒</text>
  <text x="230" y="124" fill="#78350f" font-size="17" font-weight="bold" text-anchor="middle">画面ロック中</text>
  <text x="230" y="146" fill="#7c2d12" font-size="12" font-weight="bold" text-anchor="middle">先生の話をよく聞きましょう</text>
  <text x="230" y="164" fill="#92400e" font-size="9" text-anchor="middle">※ 授業の指示があるまで、端末の操作はできません。</text>
  <rect x="104" y="176" width="252" height="28" rx="5" fill="#fffbeb" stroke="#fcd34d"/>
  <text x="116" y="189" fill="#78350f" font-size="8" font-weight="bold">先生からの指示</text>
  <text x="116" y="199" fill="#92400e" font-size="7">先生の話を最後まで静かに聞きましょう。</text>
  <text x="230" y="240" fill="#64748b" font-size="9" text-anchor="middle">キーボード・マウス・タッチ操作はできません。先生が解除すると自動で消えます。</text>
</svg>
```

画面が**黄色**に変わり、**「画面ロック中」** と表示されます。
児童はキーボード・マウス・タッチのすべてが効かなくなります。

**解除するとき** … 同じ児童を選んで **「ロック / 解除」** をもう一度押します。
（ボタンの表示が「🔓 解除中」になっている児童は、押すとロックが解除されます）

> ⏱ **反映は約2秒**です。押した直後に児童の画面が変わるのが見えます。
> 変わるまで少し待っても変わらない場合は、[第9章](#9-困ったときは)を確認してください。

---

## 5. 操作例：URLを配信する・規制する

### 5-1. 一斉URL配信（全員の画面を同じページにする）

#### こんなときに使います
- 授業で使うサイトを一斉に開かせたい
- 「このページを開いてください」と伝えたい

#### 手順

```svg
<svg viewBox="0 0 640 250" xmlns="http://www.w3.org/2000/svg" font-family="sans-serif">
  <rect width="640" height="250" fill="#f8fafc" rx="10"/>
  <rect x="130" y="16" width="380" height="218" rx="10" fill="#fff" stroke="#cbd5e1"/>
  <text x="320" y="42" fill="#1e293b" font-size="14" font-weight="bold" text-anchor="middle">一斉URL配信</text>
  <text x="150" y="64" fill="#4338ca" font-size="9" font-weight="bold">★ あなたの登録マイURL（クリックで自動入力）:</text>
  <rect x="150" y="72" width="88" height="18" rx="4" fill="#eef2ff" stroke="#c7d2fe"/>
  <text x="194" y="85" fill="#3730a3" font-size="8" text-anchor="middle">Scratch</text>
  <rect x="244" y="72" width="90" height="18" rx="4" fill="#eef2ff" stroke="#c7d2fe"/>
  <text x="289" y="85" fill="#3730a3" font-size="8" text-anchor="middle">NHK for School</text>
  <rect x="340" y="72" width="86" height="18" rx="4" fill="#eef2ff" stroke="#c7d2fe"/>
  <text x="383" y="85" fill="#3730a3" font-size="8" text-anchor="middle">Classroom</text>
  <text x="150" y="112" fill="#475569" font-size="9">配信するURL</text>
  <rect x="150" y="118" width="340" height="26" rx="5" fill="#f8fafc" stroke="#cbd5e1"/>
  <text x="158" y="135" fill="#94a3b8" font-size="8">https://scratch.mit.edu/</text>
  <text x="150" y="162" font-size="8" fill="#475569">☑ このURLをアカウントのマイURLにも保存する</text>
  <text x="150" y="188" fill="#64748b" font-size="8">標準プリセット:</text>
  <rect x="214" y="180" width="60" height="16" rx="3" fill="#e2e8f0"/><text x="244" y="191" font-size="7" fill="#475569" text-anchor="middle">Scratch</text>
  <rect x="280" y="180" width="86" height="16" rx="3" fill="#e2e8f0"/><text x="323" y="191" font-size="7" fill="#475569" text-anchor="middle">NHK for School</text>
  <rect x="372" y="180" width="74" height="16" rx="3" fill="#e2e8f0"/><text x="409" y="191" font-size="7" fill="#475569" text-anchor="middle">Classroom</text>
  <rect x="386" y="208" width="52" height="18" rx="4" fill="#e2e8f0"/><text x="412" y="220" font-size="8" fill="#475569" text-anchor="middle">キャンセル</text>
  <rect x="444" y="208" width="66" height="18" rx="4" fill="#2563eb"/><text x="477" y="220" font-size="8" fill="#fff" text-anchor="middle">今すぐ配信する</text>
</svg>
```

1. **「一斉URL配信」** ボタンを押します。
2. 配信するURLを入力します。**マイURL** や **標準プリセット** をクリックすると自動で入ります。
3. **「今すぐ配信する」** を押します。

#### 押すと児童の画面はこうなります

```svg
<svg viewBox="0 0 500 230" xmlns="http://www.w3.org/2000/svg" font-family="sans-serif">
  <rect x="40" y="14" width="420" height="180" rx="9" fill="#1e293b"/>
  <rect x="52" y="26" width="396" height="20" rx="4" fill="#334155"/>
  <circle cx="64" cy="36" r="4" fill="#ef4444"/><circle cx="76" cy="36" r="4" fill="#f59e0b"/><circle cx="88" cy="36" r="4" fill="#22c55e"/>
  <rect x="100" y="30" width="330" height="12" rx="3" fill="#475569"/>
  <text x="106" y="39" fill="#cbd5e1" font-size="8">https://scratch.mit.edu/</text>
  <rect x="52" y="54" width="396" height="140" rx="4" fill="#f1f5f9"/>
  <text x="250" y="100" fill="#334155" font-size="16" font-weight="bold" text-anchor="middle">Scratch</text>
  <text x="250" y="122" fill="#64748b" font-size="10" text-anchor="middle">Imagine, Program, Share</text>
  <rect x="150" y="140" width="90" height="22" rx="4" fill="#4f46e5"/>
  <text x="195" y="155" fill="#fff" font-size="9" text-anchor="middle">つくる</text>
  <rect x="252" y="140" width="90" height="22" rx="4" fill="#e2e8f0"/>
  <text x="297" y="155" fill="#475569" font-size="9" text-anchor="middle">さがす</text>
  <text x="250" y="214" fill="#64748b" font-size="10" text-anchor="middle">児童の画面が、配信したページに切り替わります。</text>
</svg>
```

児童の画面が、指定したページに**自動で切り替わります**。
児童が別のページに移動しても、もう一度そのページへ戻されます。

> 💡 途中でやめたいときは、**「一斉URL配信」** から配信を解除します。

---

### 5-2. URL規制（見られるサイトを制限する）

#### 2つのモード

| モード | 意味 | 使う場面 |
|---|---|---|
| **OFF** | 規制なし | ふだん |
| **ホワイトリスト** | **許可URLリストに入れたサイトだけ**見られる | 決まったサイトだけ使わせたい |
| **ブラックリスト** | **規制URLリストに入れたサイトだけ**見られない | 一部のサイトだけ禁止したい |

#### 手順

```svg
<svg viewBox="0 0 620 280" xmlns="http://www.w3.org/2000/svg" font-family="sans-serif">
  <rect width="620" height="280" fill="#f8fafc" rx="10"/>
  <rect x="60" y="14" width="500" height="252" rx="10" fill="#fff" stroke="#cbd5e1"/>
  <text x="310" y="40" fill="#1e293b" font-size="14" font-weight="bold" text-anchor="middle">URL規制モード設定</text>
  <text x="80" y="62" fill="#475569" font-size="9" font-weight="bold">規制モード</text>
  <rect x="80" y="68" width="460" height="22" rx="5" fill="#f8fafc" stroke="#cbd5e1"/>
  <text x="88" y="83" fill="#334155" font-size="9">ホワイトリスト（許可リストのみ閲覧可）　▾</text>
  <!-- whitelist -->
  <text x="80" y="112" fill="#475569" font-size="9" font-weight="bold">許可URLリスト（選択したURLのみ閲覧可）</text>
  <rect x="80" y="118" width="460" height="50" rx="5" fill="#f8fafc" stroke="#cbd5e1"/>
  <text x="88" y="134" font-size="8" fill="#334155">☑ nhk.or.jp</text>
  <text x="88" y="148" font-size="8" fill="#334155">☑ scratch.mit.edu</text>
  <text x="88" y="162" font-size="8" fill="#334155">☐ google.com</text>
  <text x="380" y="134" font-size="7" fill="#b45309">2件 選択中</text>
  <!-- blacklist -->
  <text x="80" y="190" fill="#475569" font-size="9" font-weight="bold">規制URLリスト（選択したURLのみ閲覧拒否）</text>
  <rect x="80" y="196" width="460" height="34" rx="5" fill="#f8fafc" stroke="#cbd5e1"/>
  <text x="88" y="212" font-size="8" fill="#334155">☑ youtube.com</text>
  <text x="88" y="224" font-size="8" fill="#334155">☐ tiktok.com</text>
  <rect x="394" y="246" width="66" height="18" rx="4" fill="#d97706"/>
  <text x="427" y="258" fill="#fff" font-size="8" text-anchor="middle">適用する</text>
  <text x="60" y="277" fill="#64748b" font-size="8">※ 許可リストと規制リストには、それぞれ別のURLが表示されます。</text>
</svg>
```

1. **「URL規制変更」** ボタンを押します。
2. **規制モード** を選びます。
3. **許可URLリスト** または **規制URLリスト** のチェックを入れます。
4. **「適用する」** を押します。

> 💡 **自分でURLを追加したいとき**は、リストの下の入力欄に `example.com` のように入れて **「＋ 追加」** を押します。
> 💡 **「＋ 登録マイURLを追加」** を押すと、よく使うサイトをまとめて許可リストに入れられます。
> 💡 **「↺ マイ個別設定に戻す」** を押すと、自分の設定（第3章の「設定」）に戻せます。

#### 押すと児童の画面はこうなります

規制URLリストに入れたサイトを開くと、次の画面になります。

```svg
<svg viewBox="0 0 500 230" xmlns="http://www.w3.org/2000/svg" font-family="sans-serif">
  <rect x="40" y="14" width="420" height="186" rx="9" fill="#1e293b"/>
  <rect x="52" y="26" width="396" height="162" rx="4" fill="#fef2f2"/>
  <circle cx="250" cy="74" r="26" fill="#fee2e2"/>
  <text x="250" y="86" font-size="28" text-anchor="middle">🚫</text>
  <text x="250" y="126" fill="#991b1b" font-size="16" font-weight="bold" text-anchor="middle">アクセスが制限されています</text>
  <text x="250" y="148" fill="#b91c1c" font-size="11" font-weight="bold" text-anchor="middle">先生の指示に従って作業を進めましょう</text>
  <text x="250" y="168" fill="#dc2626" font-size="9" text-anchor="middle">※ 授業中はこのWebサイトを開くことができません。</text>
  <text x="250" y="214" fill="#64748b" font-size="9" text-anchor="middle">規制が解除されると、自動的に元の画面に戻ります。</text>
</svg>
```

画面が**赤色**に変わり、**「アクセスが制限されています」** と表示されます。
規制を解除すると、自動的に元の画面に戻ります。

---

## 6. 操作例：児童の画面を見る

### こんなときに使います
- きちんと作業できているか確認したい
- 困っている児童がいないか見たい

### 手順

1. **「画面一覧」** タブに切り替えます。
2. 確認したい児童を選びます。
3. **「画面情報取得」** を押します。

```svg
<svg viewBox="0 0 560 220" xmlns="http://www.w3.org/2000/svg" font-family="sans-serif">
  <rect width="560" height="220" fill="#f8fafc" rx="10"/>
  <text x="20" y="28" fill="#1e293b" font-size="12" font-weight="bold">画面一覧（児童端末の現在画面）</text>
  <text x="20" y="46" fill="#64748b" font-size="9">「画面情報取得」を押したときだけ、児童の画面を表示します。</text>
  <rect x="20" y="58" width="110" height="28" rx="6" fill="#0891b2"/>
  <text x="75" y="76" fill="#fff" font-size="10" text-anchor="middle" font-weight="bold">画面情報取得</text>
  <g>
    <rect x="20" y="100" width="160" height="104" rx="7" fill="#fff" stroke="#cbd5e1"/>
    <rect x="28" y="108" width="144" height="66" rx="3" fill="#e2e8f0"/>
    <text x="100" y="146" font-size="20" text-anchor="middle">🖥️</text>
    <text x="100" y="188" font-size="8" fill="#334155" text-anchor="middle" font-weight="bold">山田 太郎</text>
    <rect x="52" y="192" width="96" height="10" rx="5" fill="#d1fae5"/>
    <text x="100" y="200" font-size="6" fill="#065f46" text-anchor="middle">取得済み</text>
  </g>
  <g>
    <rect x="196" y="100" width="160" height="104" rx="7" fill="#fff" stroke="#cbd5e1"/>
    <rect x="204" y="108" width="144" height="66" rx="3" fill="#f1f5f9"/>
    <text x="276" y="148" font-size="18" text-anchor="middle">⏳</text>
    <text x="276" y="188" font-size="8" fill="#334155" text-anchor="middle" font-weight="bold">鈴木 花子</text>
    <rect x="228" y="192" width="96" height="10" rx="5" fill="#fef3c7"/>
    <text x="276" y="200" font-size="6" fill="#92400e" text-anchor="middle">取得待ち</text>
  </g>
  <g>
    <rect x="372" y="100" width="160" height="104" rx="7" fill="#fff" stroke="#cbd5e1"/>
    <rect x="380" y="108" width="144" height="66" rx="3" fill="#f8fafc"/>
    <text x="452" y="148" font-size="18" text-anchor="middle">📷</text>
    <text x="452" y="188" font-size="8" fill="#334155" text-anchor="middle" font-weight="bold">佐藤 次郎</text>
    <rect x="404" y="192" width="96" height="10" rx="5" fill="#f1f5f9"/>
    <text x="452" y="200" font-size="6" fill="#64748b" text-anchor="middle">未取得</text>
  </g>
</svg>
```

**画像をクリックすると拡大**して見られます。

> ⚠ **画面の写真は「押したときだけ」撮ります。** 常時監視はしません（プライバシー保護のため）。
> 「取得待ち」のままの場合は、児童の端末がオフラインか、管理画面が閉じられている可能性があります。

---

## 7. 操作例：注意マーク（サイト監視）

### これは何か
児童が**学習に関係のないサイト**（YouTube・SNS・ゲームなど）を開くと、
名簿の氏名の横に **「⚠ 注意」** が出ます。見回りをしなくても気づけます。

```svg
<svg viewBox="0 0 620 190" xmlns="http://www.w3.org/2000/svg" font-family="sans-serif">
  <rect width="620" height="190" fill="#f8fafc" rx="10"/>
  <rect x="20" y="20" width="580" height="62" rx="7" fill="#fff" stroke="#e2e8f0"/>
  <text x="34" y="48" fill="#1e293b" font-size="11" font-weight="bold">山田 太郎</text>
  <text x="34" y="66" fill="#64748b" font-size="9">• 5年1組</text>
  <text x="330" y="48" fill="#4f46e5" font-size="9">scratch.mit.edu</text>
  <text x="500" y="48" fill="#059669" font-size="8">オンライン</text>
  <rect x="20" y="90" width="580" height="62" rx="7" fill="#fff" stroke="#fda4af" stroke-width="1.5"/>
  <text x="34" y="118" fill="#1e293b" font-size="11" font-weight="bold">鈴木 花子</text>
  <rect x="112" y="108" width="52" height="15" rx="4" fill="#ffe4e6" stroke="#fda4af"/>
  <text x="138" y="119" fill="#9f1239" font-size="9" text-anchor="middle" font-weight="bold">⚠ 注意</text>
  <text x="176" y="119" fill="#e11d48" font-size="8">2026/10/25 10:32:11</text>
  <text x="34" y="136" fill="#64748b" font-size="9">• 5年1組</text>
  <text x="330" y="118" fill="#e11d48" font-size="9">youtube.com</text>
  <text x="500" y="118" fill="#059669" font-size="8">オンライン</text>
  <text x="20" y="176" fill="#475569" font-size="9">マークにカーソルを合わせると、理由（例：「学習に関係のないサイト（youtube.com）」）が出ます。</text>
</svg>
```

### マークが出たらどうするか

| 対応 | 方法 |
|---|---|
| **そのサイトを許可する** | URL規制 → 許可URLリストに追加 → 適用する |
| **そのサイトを禁止する** | URL規制 → 規制URLリストに追加 → 適用する |
| **画面を止める** | その児童を選んで「ロック / 解除」 |

> 💡 **マークが出ないサイトもあります。** 判定は次の順番です。
> ①許可URLリスト → ②学習ドメイン辞書 → ③規制URLリスト → ④非学習ドメイン辞書 → ⑤未知のサイト
> **⑤の未知のサイトは、マークが出ません**（誤って注意しないため）。

```svg
<svg viewBox="0 0 640 240" xmlns="http://www.w3.org/2000/svg" font-family="sans-serif">
  <rect width="640" height="240" fill="#f8fafc" rx="10"/>
  <text x="20" y="26" fill="#1e293b" font-size="12" font-weight="bold">サイト監視の判定の流れ</text>
  <rect x="20" y="44" width="180" height="34" rx="6" fill="#eef2ff" stroke="#c7d2fe"/>
  <text x="110" y="65" font-size="9" fill="#3730a3" text-anchor="middle">① 端末の許可URLリスト</text>
  <path d="M200 61 L232 61" stroke="#94a3b8" stroke-width="1.5" marker-end="url(#a3)"/>
  <rect x="236" y="44" width="150" height="34" rx="6" fill="#d1fae5" stroke="#6ee7b7"/>
  <text x="311" y="65" font-size="9" fill="#065f46" text-anchor="middle">✓ 注意しない</text>
  <rect x="20" y="90" width="180" height="34" rx="6" fill="#eef2ff" stroke="#c7d2fe"/>
  <text x="110" y="111" font-size="9" fill="#3730a3" text-anchor="middle">② 学習ドメイン辞書</text>
  <path d="M200 107 L232 107" stroke="#94a3b8" stroke-width="1.5" marker-end="url(#a3)"/>
  <rect x="236" y="90" width="150" height="34" rx="6" fill="#d1fae5" stroke="#6ee7b7"/>
  <text x="311" y="111" font-size="9" fill="#065f46" text-anchor="middle">✓ 注意しない</text>
  <rect x="20" y="136" width="180" height="34" rx="6" fill="#fef3c7" stroke="#fcd34d"/>
  <text x="110" y="157" font-size="9" fill="#92400e" text-anchor="middle">③ 端末の規制URLリスト</text>
  <path d="M200 153 L232 153" stroke="#94a3b8" stroke-width="1.5" marker-end="url(#a3)"/>
  <rect x="236" y="136" width="150" height="34" rx="6" fill="#ffe4e6" stroke="#fda4af"/>
  <text x="311" y="157" font-size="9" fill="#9f1239" text-anchor="middle">⚠ 注意する</text>
  <rect x="20" y="182" width="180" height="34" rx="6" fill="#fef3c7" stroke="#fcd34d"/>
  <text x="110" y="203" font-size="9" fill="#92400e" text-anchor="middle">④ 非学習ドメイン辞書</text>
  <path d="M200 199 L232 199" stroke="#94a3b8" stroke-width="1.5" marker-end="url(#a3)"/>
  <rect x="236" y="182" width="150" height="34" rx="6" fill="#ffe4e6" stroke="#fda4af"/>
  <text x="311" y="203" font-size="9" fill="#9f1239" text-anchor="middle">⚠ 注意する</text>
  <rect x="410" y="90" width="210" height="88" rx="8" fill="#f1f5f9" stroke="#cbd5e1"/>
  <text x="515" y="112" font-size="9" fill="#334155" text-anchor="middle" font-weight="bold">⑤ どれにも当てはまらない</text>
  <text x="515" y="132" font-size="8" fill="#475569" text-anchor="middle">→ 未知のサイトは</text>
  <text x="515" y="148" font-size="8" fill="#475569" text-anchor="middle">　注意しない（誤検知防止）</text>
  <text x="410" y="196" font-size="8" fill="#64748b">上から順に判定し、最初に一致した</text>
  <text x="410" y="208" font-size="8" fill="#64748b">ルールが適用されます。</text>
  <defs><marker id="a3" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6" fill="#94a3b8"/></marker></defs>
</svg>
```

> ⚠ **先生の管理画面からON/OFFできます。** 監視設定は**管理者のみ**が変更できます（[第12章](#12-サイト監視の設定)）。
> OFFにすると、マークは全端末で即座に消えます。

---

## 8. 予約スケジュール（時間制限タイマー）

### これは何か

「**毎日 19:00〜21:00 は YouTube を規制する**」「**テスト期間中は朝から画面ロック**」のように、
**日時を決めておけば自動で ON／OFF してくれる**機能です。

| 項目 | 手動の操作（第4章・第5章） | 予約スケジュール（この章） |
|---|---|---|
| いつ効くか | 押した**その瞬間**から | 決めた**日時のあいだだけ** |
| いつ解除されるか | 先生が解除するまで | **終了時刻に自動で解除** |
| 向いている使い方 | いま注意を向けたい | 放課後・長期休業・テスト期間など**決まった時間帯** |

```svg
<svg viewBox="0 0 760 230" xmlns="http://www.w3.org/2000/svg" font-family="sans-serif">
  <rect width="760" height="230" fill="#f8fafc" rx="12"/>
  <text x="24" y="30" fill="#334155" font-size="13" font-weight="bold">予約は「決めた時間の窓」のあいだだけ効きます</text>
  <rect x="40" y="58" width="470" height="26" rx="6" fill="#e2e8f0"/>
  <text x="275" y="76" fill="#475569" font-size="10" text-anchor="middle">この時間帯は通常どおり（規制なし）</text>
  <rect x="520" y="58" width="200" height="26" rx="6" fill="#e0e7ff"/>
  <text x="620" y="76" fill="#3730a3" font-size="10" text-anchor="middle">予約の時間帯だけ自動で ON</text>
  <line x1="40" y1="150" x2="720" y2="150" stroke="#94a3b8" stroke-width="2"/>
  <text x="34" y="172" fill="#64748b" font-size="10">0:00</text>
  <text x="196" y="172" fill="#64748b" font-size="10">8:00</text>
  <text x="352" y="172" fill="#64748b" font-size="10">12:00</text>
  <text x="512" y="172" fill="#64748b" font-size="10">19:00</text>
  <text x="668" y="172" fill="#64748b" font-size="10">24:00</text>
  <rect x="520" y="106" width="160" height="44" rx="8" fill="#4f46e5"/>
  <text x="600" y="126" fill="#ffffff" font-size="11" font-weight="bold" text-anchor="middle">19:00 - 21:00</text>
  <text x="600" y="142" fill="#c7d2fe" font-size="9" text-anchor="middle">YouTube 規制 ON</text>
  <text x="24" y="208" fill="#64748b" font-size="10">開始時刻になると自動で ON、終了時刻になると自動で OFF になります。先生が押す必要はありません。</text>
</svg>
```

### 画面の開き方

1. 管理コンソールにログインします。
2. 上部のタブから **「スケジュール管理」** を選びます。
3. 予約の一覧が出ます。右上の **「新規予約作成」** ボタンで新しい予約を作ります。

```svg
<svg viewBox="0 0 720 120" xmlns="http://www.w3.org/2000/svg" font-family="sans-serif">
  <rect width="720" height="120" fill="#f1f5f9" rx="10"/>
  <rect x="16" y="18" width="688" height="40" rx="8" fill="#1e1b4b"/>
  <text x="32" y="36" fill="#ffffff" font-size="11" font-weight="bold">教員管理コンソール</text>
  <rect x="24" y="46" width="96" height="0" fill="#1e1b4b"/>
  <text x="300" y="43" fill="#ffffff" font-size="10" text-anchor="middle">端末一覧</text>
  <text x="400" y="43" fill="#ffffff" font-size="10" text-anchor="middle">画面一覧</text>
  <rect x="286" y="26" width="80" height="26" rx="6" fill="#4f46e5"/>
  <text x="326" y="43" fill="#ffffff" font-size="10" text-anchor="middle">スケジュール管理</text>
  <rect x="560" y="24" width="128" height="28" rx="6" fill="#047857"/>
  <text x="624" y="42" fill="#ffffff" font-size="10" text-anchor="middle">＋ 新規予約作成</text>
  <rect x="16" y="72" width="688" height="34" rx="6" fill="#ffffff" stroke="#cbd5e1"/>
  <text x="32" y="93" fill="#334155" font-size="10">19:00-21:00　5年1組　URL規制（YouTube）　毎日</text>
  <rect x="590" y="78" width="46" height="20" rx="5" fill="#dcfce7"/>
  <text x="613" y="92" fill="#166534" font-size="9" text-anchor="middle">有効</text>
  <text x="660" y="93" fill="#475569" font-size="10">編集｜取消</text>
</svg>
```

### 対象の選び方（クラス／複数クラス／全校／児童個人）

「だれに効かせるか」を4通りから選べます。

| 選び方 | 使いどころ | 注意 |
|---|---|---|
| **クラスを選ぶ** | 学級単位で規制したい | チェックを複数入れると**複数クラス同時**に指定できます |
| **全校生徒** | 全校一斉（長期休業中など） | その学校の全児童が対象。他校は絶対に含まれません |
| **児童を個別に選ぶ** | 特定の児童だけ | 名簿からチェックを入れます |
| クラス＋児童の併用 | クラス全体＋欠席者の補完など | 指定した対象すべてに同じ内容が適用されます |

> 💡 **迷ったら「クラスを選ぶ」** がおすすめです。児童個人を選ぶと、転入・転出のたびに直す必要があります。

### 新規予約作成の手順

```svg
<svg viewBox="0 0 620 470" xmlns="http://www.w3.org/2000/svg" font-family="sans-serif">
  <rect width="620" height="470" fill="#e2e8f0" rx="10"/>
  <rect x="40" y="20" width="540" height="430" rx="12" fill="#ffffff" stroke="#cbd5e1"/>
  <text x="64" y="52" fill="#1e293b" font-size="14" font-weight="bold">新規予約作成</text>
  <text x="64" y="82" fill="#475569" font-size="11">対象の選び方</text>
  <rect x="64" y="90" width="108" height="26" rx="6" fill="#4f46e5"/>
  <text x="118" y="108" fill="#ffffff" font-size="10" text-anchor="middle">クラス</text>
  <rect x="180" y="90" width="108" height="26" rx="6" fill="#f1f5f9" stroke="#cbd5e1"/>
  <text x="234" y="108" fill="#475569" font-size="10" text-anchor="middle">全校生徒</text>
  <rect x="296" y="90" width="108" height="26" rx="6" fill="#f1f5f9" stroke="#cbd5e1"/>
  <text x="350" y="108" fill="#475569" font-size="10" text-anchor="middle">児童を選ぶ</text>
  <text x="64" y="146" fill="#475569" font-size="11">クラス（複数選択できます）</text>
  <rect x="64" y="154" width="140" height="24" rx="12" fill="#e0e7ff"/>
  <text x="134" y="170" fill="#3730a3" font-size="9" text-anchor="middle">5年1組</text>
  <rect x="212" y="154" width="140" height="24" rx="12" fill="#f1f5f9" stroke="#cbd5e1"/>
  <text x="282" y="170" fill="#64748b" font-size="9" text-anchor="middle">5年2組</text>
  <text x="64" y="206" fill="#475569" font-size="11">制限タイプ</text>
  <rect x="64" y="214" width="150" height="26" rx="6" fill="#f1f5f9" stroke="#cbd5e1"/>
  <text x="139" y="232" fill="#475569" font-size="10" text-anchor="middle">URL規制</text>
  <rect x="222" y="214" width="150" height="26" rx="6" fill="#4f46e5"/>
  <text x="297" y="232" fill="#ffffff" font-size="10" text-anchor="middle">画面ロック</text>
  <text x="64" y="266" fill="#475569" font-size="11">期間（開始日／終了日）</text>
  <rect x="64" y="274" width="150" height="28" rx="6" fill="#f8fafc" stroke="#cbd5e1"/>
  <text x="76" y="293" fill="#334155" font-size="10">2026/11/10</text>
  <rect x="222" y="274" width="150" height="28" rx="6" fill="#f8fafc" stroke="#cbd5e1"/>
  <text x="234" y="293" fill="#334155" font-size="10">2026/11/14</text>
  <text x="64" y="326" fill="#475569" font-size="11">時刻（開始／終了）</text>
  <rect x="64" y="334" width="150" height="28" rx="6" fill="#f8fafc" stroke="#cbd5e1"/>
  <text x="76" y="353" fill="#334155" font-size="10">19:00</text>
  <rect x="222" y="334" width="150" height="28" rx="6" fill="#f8fafc" stroke="#cbd5e1"/>
  <text x="234" y="353" fill="#334155" font-size="10">21:00</text>
  <text x="64" y="386" fill="#475569" font-size="11">繰り返し</text>
  <rect x="64" y="394" width="90" height="26" rx="6" fill="#f1f5f9" stroke="#cbd5e1"/>
  <text x="109" y="412" fill="#475569" font-size="10" text-anchor="middle">単発</text>
  <rect x="162" y="394" width="90" height="26" rx="6" fill="#4f46e5"/>
  <text x="207" y="412" fill="#ffffff" font-size="10" text-anchor="middle">毎日</text>
  <rect x="260" y="394" width="90" height="26" rx="6" fill="#f1f5f9" stroke="#cbd5e1"/>
  <text x="305" y="412" fill="#475569" font-size="10" text-anchor="middle">毎週</text>
  <rect x="380" y="394" width="120" height="30" rx="7" fill="#4f46e5"/>
  <text x="440" y="414" fill="#ffffff" font-size="11" font-weight="bold" text-anchor="middle">保存する</text>
  <text x="40" y="466" fill="#64748b" font-size="10">必須は「対象・制限タイプ・期間・時刻」の4つです。</text>
</svg>
```

1. **「新規予約作成」** を押します。
2. **対象** を選びます（クラス／全校生徒／児童を選ぶ）。
3. **制限タイプ** を選びます。
   - `URL規制` … 見られるサイトを制限する（許可／規制のどちらのモードかも選びます）
   - `画面ロック` … 画面を操作できない状態にする
4. **期間**（開始日・終了日）を入れます。
5. **時刻**（開始時刻・終了時刻）を入れます。
6. **繰り返し** を選びます。
7. **保存する** を押します。

> 💡 期間の終了日は「この日まで有効」です。終了日を過ぎた予約は自動で効かなくなります（行は消えません＝記録として残ります）。

### 繰り返しの3種類

| 表示 | 意味 | 例 |
|---|---|---|
| **単発** | 開始日の1回だけ | 11/10 の 19:00〜21:00 だけ |
| **毎日** | 期間中の**毎日** | 11/10〜11/14 の毎日 19:00〜21:00 |
| **毎週** | 期間中の**指定した曜日だけ** | 毎週 月・水・金 の 19:00〜21:00 |

「毎週」を選ぶと**曜日**のチェックが出ます（日〜土）。チェックが1つも入っていないと、その予約は一度も発動しません。

### 深夜帯（翌日またぎ）

**終了時刻が開始時刻より前**のときは、「**翌日またぎ**」として扱われます。

| 開始 | 終了 | 実際に効く時間 |
|---|---|---|
| 22:00 | 06:00 | 22:00 〜 **翌日** 06:00 |
| 20:00 | 21:00 | 20:00 〜 同日 21:00（普通の予約） |

> ⚠ 「22:00〜6:00 のつもりが、6:00 で終わってしまう」という取り違えが起きやすい箇所です。
> 画面には「翌日 6:00 まで」と表示されるので、保存前に確認してください。

### 予約の編集

一覧の **「編集」** を押すと、保存済みの内容が入った状態で画面が開きます。

```svg
<svg viewBox="0 0 660 180" xmlns="http://www.w3.org/2000/svg" font-family="sans-serif">
  <rect width="660" height="180" fill="#f8fafc" rx="10"/>
  <text x="24" y="30" fill="#334155" font-size="12" font-weight="bold">「編集」を押すと、前回の内容がそのまま復元されます</text>
  <rect x="24" y="48" width="612" height="46" rx="8" fill="#ffffff" stroke="#cbd5e1"/>
  <text x="40" y="70" fill="#1e293b" font-size="11" font-weight="bold">19:00-21:00　5年1組　URL規制（YouTube）</text>
  <text x="40" y="86" fill="#64748b" font-size="9">2026/11/10 〜 2026/11/14　毎日</text>
  <rect x="500" y="60" width="56" height="22" rx="5" fill="#dcfce7"/>
  <text x="528" y="75" fill="#166534" font-size="9" text-anchor="middle">実行中</text>
  <rect x="564" y="60" width="56" height="22" rx="5" fill="#e0e7ff"/>
  <text x="592" y="75" fill="#3730a3" font-size="9" text-anchor="middle">編集</text>
  <text x="24" y="120" fill="#475569" font-size="10">復元される項目：対象クラス・チェック済みの児童・開始日／終了日・開始時刻／終了時刻・繰り返し・曜日</text>
  <text x="24" y="140" fill="#475569" font-size="10">※ 日付は「2026/11/10」の形で保存されていますが、画面では自動的に日付入力欄へ入ります。</text>
  <rect x="24" y="150" width="612" height="18" rx="5" fill="#fef3c7"/>
  <text x="36" y="163" fill="#92400e" font-size="9">保存済みクラス・児童は「対象外」のものと混ざらないよう、編集画面を開いたときに選び直されます。</text>
</svg>
```

- 対象・期間・時刻・繰り返しが**すべて元のとおり**に入ります。
- 変更したい項目だけ直して **保存する** を押してください。
- すでに効いている予約は一覧に **「実行中」** のバッジが付きます。

### 「手動解除」と「取消」の違い（ここがいちばん大事）

この2つは**まったく別のもの**です。取り違えると「明日も効くつもりが効かない」「止めたつもりがまた効く」という事故になります。

```svg
<svg viewBox="0 0 740 250" xmlns="http://www.w3.org/2000/svg" font-family="sans-serif">
  <rect width="740" height="250" fill="#f8fafc" rx="12"/>
  <text x="24" y="30" fill="#334155" font-size="13" font-weight="bold">「解除」は今回だけ／「取消」は予約ごと止める</text>
  <rect x="24" y="50" width="330" height="170" rx="10" fill="#ffffff" stroke="#cbd5e1"/>
  <rect x="24" y="50" width="330" height="34" rx="10" fill="#0ea5e9"/>
  <text x="44" y="73" fill="#ffffff" font-size="12" font-weight="bold">手動解除</text>
  <text x="44" y="104" fill="#334155" font-size="10">・いま効いている分だけを解除する</text>
  <text x="44" y="126" fill="#334155" font-size="10">・予約そのものは残る</text>
  <text x="44" y="148" fill="#334155" font-size="10">・次の時間帯にはまた効く</text>
  <text x="44" y="176" fill="#0c4a6e" font-size="10" font-weight="bold">＝ 今回の時間帯だけ止める</text>
  <text x="44" y="198" fill="#64748b" font-size="9">「今日はもう帰るので今だけ止めたい」</text>
  <rect x="386" y="50" width="330" height="170" rx="10" fill="#ffffff" stroke="#cbd5e1"/>
  <rect x="386" y="50" width="330" height="34" rx="10" fill="#dc2626"/>
  <text x="406" y="73" fill="#ffffff" font-size="12" font-weight="bold">取消</text>
  <text x="406" y="104" fill="#334155" font-size="10">・予約を「無効」にする</text>
  <text x="406" y="126" fill="#334155" font-size="10">・行は消えずに残る（記録）</text>
  <text x="406" y="148" fill="#334155" font-size="10">・以降は一度も効かない</text>
  <text x="406" y="176" fill="#7f1d1d" font-size="10" font-weight="bold">＝ 予約ごと止める</text>
  <text x="406" y="198" fill="#64748b" font-size="9">「この予約はもう不要なので止めたい」</text>
</svg>
```

| ボタン | 何が起きるか | 予約は残るか | 次回も効くか |
|---|---|---|---|
| **手動解除** | いま効いている制限を**今回の時間帯だけ**解除 | 残る | **効く** |
| **取消** | 予約を**無効**にする（以降効かない） | 残る（監査ログ） | **効かない** |

> ⚠ **どちらも予約の行は消しません。**
> 「消したのに効いている」「止めたのに残っている」と感じたら、まずこの表を見てください。

### 予約が動く仕組み

1. 親GASが予約を解釈して「いつからいつまで」の**時間の窓**に展開します。
2. その窓が**子GAS（学校ごと）**へ送られます。
3. 児童端末は通信のたびに「いま窓の中か」だけを見ます。
4. 窓に入れば制限ON、出れば自動でOFF。

> 💡 繰り返しや曜日の解釈は**親GASが1回だけ**行います。端末や子GASは再計算しません（ズレが起きないようにするため）。

### 予約が入るシート（4枚目）

予約は **「スケジュール管理」** シートに1行1件で保存されます。
1校につき1つのスプレッドシートなので、**他校の予約とは完全に分かれています**。

| 項目 | 例 |
|---|---|
| スケジュールID | `sch_1762500000000_a1b2` |
| 対象種別／学校名／クラス名／児童ID | `class` ／ `第一小学校` ／ `5年1組` ／ 空欄 |
| 制限タイプ／URL規制モード | `url_block` ／ `BLACKLIST` |
| 許可URLリスト／規制URLリスト | 空欄 ／ `youtube.com` |
| 開始日／終了日／開始時刻／終了時刻 | `2026/11/10` ／ `2026/11/14` ／ `19:00` ／ `21:00` |
| 繰り返し／曜日 | `DAILY` ／ 空欄 |
| 有効／手動解除／手動解除日時 | `TRUE` ／ `FALSE` ／ 空欄 |
| 作成者／作成日時／更新日時／備考 | `teacher@...` ／ … ／ … ／ `放課後YouTube対策` |

> 💡 **シートを直接編集してもかまいません**が、**日付は `2026/11/10`、時刻は `19:00` の形式**で入れてください。
> 自動で日付型に変換されると正しく読めなくなるため、このシートの日付・時刻列は**書式なしテキスト**に固定してあります。

### うまく動かないとき

| 症状 | 確認すること |
|---|---|
| **時刻になっても発動しない** | 端末の電源とログイン状態。予約の「有効」が `TRUE` か。「手動解除」が `TRUE` のままになっていないか |
| **解除されない** | 終了時刻を過ぎているか。深夜帯（翌日またぎ）の予約ではないか |
| **予約が一覧に出ない** | 「再読込」を押す。学校・クラスの絞り込みがかかっていないか |
| **思った日だけ動かない** | 「毎週」の曜日にチェックが入っているか。「単発」は開始日の1回だけ |
| **編集画面でクラスや児童のチェックが消える** | 選んでいたクラスが名簿から削除されていないか。保存し直してください |
| **編集画面の日付が空になる** | シートの開始日／終了日が `2026/11/10` 形式でない可能性があります。書式なしテキストで入れ直してください |
| **一部のクラスだけ効かない** | そのクラスに担当の子GASが割り当てられているか管理者に確認してください（[第10章](#10-システムの全体像)） |

---

## 9. 困ったときは

「あれ？」と思ったときは、まずこの章を開いてください。
**症状から探す** → **エラーメッセージから探す** の順で読むと早く見つかります。

### 9-1. 症状から探す

**Q. 操作しても児童の画面が変わらない**

管理画面を閉じていませんか？ 児童端末は**管理画面が開いている間だけ**通信します。開いたままにしてください。
それでも変わらない場合は、児童の端末がスリープ／電源OFFの可能性があります。「接続状態」がオフラインなら電源を確認してください。

**Q. 特定の児童だけ反映されない**

その児童がGoogleアカウントでログインしているか確認してください。ログインしていないと一覧に出ません。

**Q. 児童が一覧に出てこない**

端末の電源が入り、Googleアカウントでログインしていれば数秒で出ます。
それでも出ない場合は、拡張機能が入っているか（[第11章](#11-初期設定の手順)）を管理者に確認してください。

**Q. 「取得待ち」のまま画面が出ない**

児童がオフラインか、管理画面を閉じています。オンラインにして、管理画面を開いたまま再度取得してください。
児童が `chrome://newtab` などの**保護されたページ**を開いていると、Chrome の仕様上撮影できません。その場合は「保護されたページを表示中」と表示されます（故障ではありません）。

**Q. 他校の児童が表示されない**

仕様です。一般の先生（TEACHER）は**自校の児童のみ**表示・操作できます（安全のため）。必要な場合は管理者に相談してください（[第13章](#13-アカウントと権限admin-と-teacher-の違い)）。

**Q. マークが出るはずのサイトで出ない**

サイト監視がOFFになっている可能性があります。管理者に確認してください（[第12章](#12-サイト監視の設定)）。

**Q. マークが消えない**

児童がそのサイトを閉じても、履歴として残ります（最後に検知した記録）。消したい場合は管理者へ。

**Q. ロックしたのに児童が自分で解除できてしまう**

ロックは端末側の拡張機能が担っています。拡張機能が無効化されていないか管理者に確認してください。

### 9-2. 予約スケジュールのQ&A

**Q. 時刻になっても予約が発動しない**

| 確認すること | 見る場所 |
|---|---|
| 予約の「有効」が `TRUE` か | スケジュール管理シートの「有効」列 |
| 「手動解除」が `TRUE` のままになっていないか | 同「手動解除」列 |
| 今日が「期間」に入っているか | 同「開始日」「終了日」 |
| 「毎週」の曜日にチェックが入っているか | 管理画面の編集 |
| 児童端末がオンラインか | 端末一覧の「接続状態」 |

**Q. 時間が来ても解除されない**

終了時刻を過ぎているか確認してください。**深夜帯（翌日またぎ）**の予約ではないかも確認してください（22:00〜06:00 は**翌朝**まで続きます）。

**Q. 予約が一覧に出ない**

「再読込」を押してください。学校・クラスの絞り込みがかかっていないかも確認してください。

**Q. 「解除」と「取消」を間違えた**

| 押したボタン | 起きたこと | 戻し方 |
|---|---|---|
| **手動解除** | 今回の時間帯だけ止まった | 何もしなくてよい（次の時間帯にまた効きます） |
| **取消** | 予約ごと無効になった | 同じ内容で**新しく予約を作り直す**（取消は取り消せません） |

> ⚠ 取消は「無効にする」だけで行は消えません。もう一度効かせたいときは新規作成してください。

**Q. 編集画面でクラスや児童のチェックが消えている**

選んでいたクラス・児童が名簿から削除されていないか確認し、選び直して保存してください。

**Q. 編集画面の日付が空になっている**

シートの開始日／終了日が `2026/11/10` の形式でない可能性があります。書式なしテキストで入れ直してください。

**Q. 一部のクラスだけ予約が効かない**

そのクラスに**担当の子GAS**が割り当てられているか管理者に確認してください。
担当が無いクラスは「親GASのみで運用」となり、子GASへは送られません（[第11章](#11-初期設定の手順)のスクリプトプロパティ）。

### 9-3. エラーメッセージから探す

| 画面に出るメッセージ | 意味と対処 |
|---|---|
| **未対応のアクション** | 画面とサーバーの版がずれています。ブラウザを再読込（`Ctrl`+`Shift`+`R`）してください |
| **権限がありません** | その操作は管理者（ADMIN）専用です。管理者に依頼してください（[第13章](#13-アカウントと権限admin-と-teacher-の違い)） |
| **ログインが必要です** | ログインの有効期限が切れました。もう一度ログインしてください（[第2章](#2-ログインする)） |
| **メールアドレスまたはパスワードが違います** | 入力ミス、または管理者による変更。管理者に確認してください |
| **このメールアドレスは既に登録されています** | アカウント管理で同じメールを二重登録しようとしています（[第14章](#14-マイ設定とアカウント管理)） |
| **年次更新は管理者のみ実行できます** | 実行できるのは ADMIN だけです |
| **共有シークレットが一致しません** | 親GASと子GASの `SHARD_SECRET` が違います。同じ値にそろえてください |
| **子GASとして構成されていません** | 子GASに `SHARD_CHILD_MODE=true` が入っていません（[第11章](#11-初期設定の手順)） |
| **時間をおいて再度お試しください** | 同時アクセスが集中しています。少し待ってからもう一度押してください |

### 9-4. それでも解決しないとき

管理者（情報担当の先生）に、次の4つを伝えてください。

1. **どの操作をしたか**（例：「一斉URL配信を押した」）
2. **画面にどんなメッセージが出たか**（できれば画面の写真）
3. **児童の端末がオンラインだったか**
4. **いつ頃からか**（例：「昨日の放課後から」）

> 💡 管理者は GAS の**実行ログ**で原因を追えます。
> ログには `[SHARD]` で始まる行（子GASへの伝達）と `[SCHEDULE]` で始まる行（予約）が出ます。
> この2つがあるかどうかで、原因の場所が切り分けられます。

---

# 後半：管理者の初期設定

ここからは、**情報担当の先生（管理者）** が最初に1回だけ行う作業です。
日々の操作だけなら、前半を読めば十分です。

---

## 10. システムの全体像

このシステムは、**3つの部品**でできています。

```svg
<svg viewBox="0 0 760 320" xmlns="http://www.w3.org/2000/svg" font-family="sans-serif">
  <rect width="760" height="320" fill="#f8fafc" rx="12"/>
  <text x="24" y="34" fill="#1e293b" font-size="14" font-weight="bold">3つの部品</text>

  <!-- 1 -->
  <rect x="24" y="54" width="220" height="106" rx="9" fill="#fff" stroke="#4f46e5" stroke-width="2"/>
  <rect x="24" y="54" width="220" height="26" rx="9" fill="#4f46e5"/>
  <text x="134" y="72" fill="#fff" font-size="11" font-weight="bold" text-anchor="middle">① 拡張機能</text>
  <text x="36" y="100" fill="#334155" font-size="9">Chromeの拡張機能（児童端末に入る）</text>
  <text x="36" y="118" fill="#64748b" font-size="8">・管理コンソールからの指示を受け取る</text>
  <text x="36" y="132" fill="#64748b" font-size="8">・今開いているURLを送る</text>
  <text x="36" y="146" fill="#64748b" font-size="8">・ロック画面／ブロック画面を出す</text>

  <!-- 2 -->
  <rect x="268" y="54" width="220" height="106" rx="9" fill="#fff" stroke="#059669" stroke-width="2"/>
  <rect x="268" y="54" width="220" height="26" rx="9" fill="#059669"/>
  <text x="378" y="72" fill="#fff" font-size="11" font-weight="bold" text-anchor="middle">② GAS（中継役）</text>
  <text x="280" y="100" fill="#334155" font-size="9">Google Apps Script（クラウド上）</text>
  <text x="280" y="118" fill="#64748b" font-size="8">・指示を記録表に書く</text>
  <text x="280" y="132" fill="#64748b" font-size="8">・学校ごとに振り分ける</text>
  <text x="280" y="146" fill="#64748b" font-size="8">・サイト監視の判定をする</text>

  <!-- 3 -->
  <rect x="512" y="54" width="224" height="106" rx="9" fill="#fff" stroke="#0284c7" stroke-width="2"/>
  <rect x="512" y="54" width="224" height="26" rx="9" fill="#0284c7"/>
  <text x="624" y="72" fill="#fff" font-size="11" font-weight="bold" text-anchor="middle">③ スプレッドシート</text>
  <text x="524" y="100" fill="#334155" font-size="9">記録表（データの置き場所）</text>
  <text x="524" y="118" fill="#64748b" font-size="8">・端末一覧（誰がどの端末か）</text>
  <text x="524" y="132" fill="#64748b" font-size="8">・教員マスタ（先生のID）</text>
  <text x="524" y="146" fill="#64748b" font-size="8">・画面情報（撮った写真）</text>

  <path d="M244 107 L264 107" stroke="#94a3b8" stroke-width="2" marker-end="url(#b1)"/>
  <path d="M488 107 L508 107" stroke="#94a3b8" stroke-width="2" marker-end="url(#b1)"/>

  <!-- 管理コンソール -->
  <rect x="24" y="196" width="350" height="100" rx="9" fill="#fff" stroke="#d97706" stroke-width="2"/>
  <rect x="24" y="196" width="350" height="26" rx="9" fill="#d97706"/>
  <text x="199" y="214" fill="#fff" font-size="11" font-weight="bold" text-anchor="middle">④ 管理コンソール（先生が使う画面）</text>
  <text x="36" y="242" fill="#334155" font-size="9">GAS が表示する Web 画面</text>
  <text x="36" y="260" fill="#64748b" font-size="8">・ブラウザで開くだけ（インストール不要）</text>
  <text x="36" y="274" fill="#64748b" font-size="8">・ログインして操作する</text>
  <path d="M199 196 L199 164" stroke="#94a3b8" stroke-width="2" marker-end="url(#b1)"/>

  <rect x="398" y="196" width="338" height="100" rx="9" fill="#fef3c7" stroke="#f59e0b"/>
  <text x="410" y="218" fill="#78350f" font-size="10" font-weight="bold">💡 なぜ3つに分かれているか</text>
  <text x="410" y="238" fill="#92400e" font-size="8">拡張機能だけでは、児童端末の外から指示を届けられません。</text>
  <text x="410" y="252" fill="#92400e" font-size="8">GAS（クラウド）が間に入ることで、先生は学校のネットワーク</text>
  <text x="410" y="266" fill="#92400e" font-size="8">内からでも、校内の児童端末をまとめて操作できます。</text>
  <text x="410" y="284" fill="#92400e" font-size="8">また、記録表に残るので後から確認できます。</text>

  <defs><marker id="b1" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6" fill="#94a3b8"/></marker></defs>
</svg>
```

### 親GAS と 子GAS（Hub-Spoke 構成）

このシステムの GAS は、役割の違う**2種類**があります。

```svg
<svg viewBox="0 0 720 300" xmlns="http://www.w3.org/2000/svg" font-family="sans-serif">
  <rect width="720" height="300" fill="#f8fafc" rx="12"/>
  <text x="24" y="28" fill="#1e293b" font-size="13" font-weight="bold">親GAS（Hub）が全校をまとめ、子GAS（Spoke）が学校ごとに受ける</text>

  <rect x="24" y="52" width="150" height="76" rx="9" fill="#4f46e5"/>
  <text x="99" y="80" fill="#fff" font-size="11" font-weight="bold" text-anchor="middle">親GAS（Hub）</text>
  <text x="99" y="98" fill="#c7d2fe" font-size="8" text-anchor="middle">教育委員会で1つ</text>
  <text x="99" y="114" fill="#c7d2fe" font-size="8" text-anchor="middle">全校の名簿を集約</text>

  <rect x="286" y="52" width="150" height="76" rx="9" fill="#059669"/>
  <text x="361" y="80" fill="#fff" font-size="11" font-weight="bold" text-anchor="middle">子GAS（Spoke）</text>
  <text x="361" y="98" fill="#a7f3d0" font-size="8" text-anchor="middle">学校ごとに1つ</text>
  <text x="361" y="114" fill="#a7f3d0" font-size="8" text-anchor="middle">校内の端末を配信</text>

  <rect x="548" y="52" width="148" height="76" rx="9" fill="#0284c7"/>
  <text x="622" y="80" fill="#fff" font-size="11" font-weight="bold" text-anchor="middle">児童端末</text>
  <text x="622" y="98" fill="#bae6fd" font-size="8" text-anchor="middle">Chromebook</text>
  <text x="622" y="114" fill="#bae6fd" font-size="8" text-anchor="middle">拡張機能 v1.6.11</text>

  <path d="M174 90 L282 90" stroke="#94a3b8" stroke-width="2" marker-end="url(#e1)"/>
  <text x="228" y="82" fill="#64748b" font-size="8" text-anchor="middle">指示を振り分け</text>
  <path d="M436 90 L544 90" stroke="#94a3b8" stroke-width="2" marker-end="url(#e1)"/>
  <text x="490" y="82" fill="#64748b" font-size="8" text-anchor="middle">予約・制限を配信</text>

  <rect x="24" y="152" width="672" height="60" rx="8" fill="#fff" stroke="#cbd5e1"/>
  <text x="40" y="174" fill="#334155" font-size="10" font-weight="bold">なぜ分けるのか（負荷分散）</text>
  <text x="40" y="192" fill="#64748b" font-size="8">全校の端末が1つのGASに集中すると、Google の実行回数上限に当たって応答が遅くなります。</text>
  <text x="40" y="206" fill="#64748b" font-size="8">学校ごとに分ければ、1校あたりの負荷が小さく、他校の影響を受けません。</text>

  <rect x="24" y="226" width="672" height="56" rx="8" fill="#fee2e2" stroke="#f87171"/>
  <text x="40" y="248" fill="#991b1b" font-size="10" font-weight="bold">⚠ 大事な前提：1校 = 1つの独立したスプレッドシート</text>
  <text x="40" y="266" fill="#b91c1c" font-size="8">学校ごとにスプレッドシートもGASも別物です。データは学校の外に出ません。</text>

  <defs><marker id="e1" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6" fill="#94a3b8"/></marker></defs>
</svg>
```

| 種類 | 台数 | 役割 |
|---|---|---|
| **親GAS** | 教育委員会で1つ | 全校の端末名簿を集約して見る。各校へ指示を振り分ける |
| **子GAS** | 学校ごとに1つ（14校分） | 自校の端末へ制限・予約を配信する。自校のシートだけを読み書きする |

> 💡 **データは PropertiesService にだけ流れます。**
> 子GAS が子スプレッドシートに行を書き込むことはありません。
> 端末への配信内容は「プロパティ（設定値）」として受け渡します。

### 学校ごとに GAS を分ける仕組み

美作市の14校は、**学校ごとに別のスプレッドシート**で管理します。
1つの拡張機能が、端末の設定（ポリシー）を見て**自動で正しい学校のGASに接続**します。

```svg
<svg viewBox="0 0 700 250" xmlns="http://www.w3.org/2000/svg" font-family="sans-serif">
  <rect width="700" height="250" fill="#f8fafc" rx="12"/>
  <rect x="24" y="100" width="130" height="56" rx="8" fill="#4f46e5"/>
  <text x="89" y="124" fill="#fff" font-size="11" font-weight="bold" text-anchor="middle">1つの拡張機能</text>
  <text x="89" y="142" fill="#c7d2fe" font-size="8" text-anchor="middle">全14校で共通</text>
  <path d="M154 128 L196 128" stroke="#94a3b8" stroke-width="2" marker-end="url(#b2)"/>
  <rect x="200" y="88" width="140" height="80" rx="8" fill="#fff" stroke="#cbd5e1"/>
  <text x="270" y="110" fill="#334155" font-size="9" font-weight="bold" text-anchor="middle">端末の設定を見る</text>
  <text x="270" y="130" fill="#64748b" font-size="8" text-anchor="middle">管理ポリシーの</text>
  <text x="270" y="144" fill="#64748b" font-size="8" text-anchor="middle">「school_name」で</text>
  <text x="270" y="158" fill="#64748b" font-size="8" text-anchor="middle">自動で判断</text>

  <rect x="380" y="20" width="150" height="40" rx="6" fill="#059669"/>
  <text x="455" y="45" fill="#fff" font-size="9" text-anchor="middle">英田小学校のGAS</text>
  <rect x="380" y="76" width="150" height="40" rx="6" fill="#059669"/>
  <text x="455" y="101" fill="#fff" font-size="9" text-anchor="middle">大原小学校のGAS</text>
  <rect x="380" y="132" width="150" height="40" rx="6" fill="#059669"/>
  <text x="455" y="157" fill="#fff" font-size="9" text-anchor="middle">第一小学校のGAS</text>
  <text x="455" y="192" fill="#64748b" font-size="9" text-anchor="middle">… 全14校</text>

  <path d="M340 128 L376 44" stroke="#94a3b8" stroke-width="1.5" marker-end="url(#b2)"/>
  <path d="M340 128 L376 96" stroke="#94a3b8" stroke-width="1.5" marker-end="url(#b2)"/>
  <path d="M340 128 L376 152" stroke="#94a3b8" stroke-width="1.5" marker-end="url(#b2)"/>

  <rect x="548" y="20" width="130" height="200" rx="8" fill="#fef3c7" stroke="#f59e0b"/>
  <text x="613" y="44" fill="#78350f" font-size="9" font-weight="bold" text-anchor="middle">それぞれ別の</text>
  <text x="613" y="58" fill="#78350f" font-size="9" font-weight="bold" text-anchor="middle">スプレッドシート</text>
  <text x="560" y="84" fill="#92400e" font-size="8">・データが混ざらない</text>
  <text x="560" y="102" fill="#92400e" font-size="8">・他校から見えない</text>
  <text x="560" y="120" fill="#92400e" font-size="8">・学校ごとに運用</text>
  <text x="560" y="138" fill="#92400e" font-size="8">　できる</text>
  <defs><marker id="b2" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6" fill="#94a3b8"/></marker></defs>
</svg>
```

**対象は次の14校です。**

英田小学校／大原小学校／江見小学校／勝田小学校／勝田東小学校／第一小学校／北小学校／土居小学校
英田中学校／大原中学校／作東中学校／勝田中学校／美作中学校／樸学園

> ⚠ **東粟倉小学校は廃校のため、一覧に含めないでください。**

### データの置き場所（スプレッドシートの4シート）

| シート名 | 何が入るか |
|---|---|
| **端末一覧** | 児童ID・学校名・氏名・クラス・ロック状態・URL規制・現在のURL・注意マーク など |
| **教員マスタ** | 先生のメールアドレス・パスワード・所属学校・権限・対象クラス |
| **画面情報** | 「画面情報取得」で撮った写真（1児童=1行で上書き） |
| **スケジュール管理** | 予約スケジュール（第8章）。1行=1件の予約 |

---

## 11. 初期設定の手順

**全体の流れ（5ステップ）**

```svg
<svg viewBox="0 0 760 150" xmlns="http://www.w3.org/2000/svg" font-family="sans-serif">
  <rect width="760" height="150" fill="#f8fafc" rx="12"/>
  <g font-size="9">
    <rect x="20" y="40" width="130" height="66" rx="8" fill="#4f46e5"/>
    <text x="85" y="62" fill="#c7d2fe" font-size="8" text-anchor="middle">ステップ 1</text>
    <text x="85" y="80" fill="#fff" font-weight="bold" text-anchor="middle">スプレッド</text>
    <text x="85" y="94" fill="#fff" font-weight="bold" text-anchor="middle">シート準備</text>

    <rect x="168" y="40" width="130" height="66" rx="8" fill="#059669"/>
    <text x="233" y="62" fill="#a7f3d0" font-size="8" text-anchor="middle">ステップ 2</text>
    <text x="233" y="80" fill="#fff" font-weight="bold" text-anchor="middle">GASを設定</text>
    <text x="233" y="94" fill="#fff" font-weight="bold" text-anchor="middle">デプロイ</text>

    <rect x="316" y="40" width="130" height="66" rx="8" fill="#0284c7"/>
    <text x="381" y="62" fill="#bae6fd" font-size="8" text-anchor="middle">ステップ 3</text>
    <text x="381" y="80" fill="#fff" font-weight="bold" text-anchor="middle">教員アカウント</text>
    <text x="381" y="94" fill="#fff" font-weight="bold" text-anchor="middle">登録</text>

    <rect x="464" y="40" width="130" height="66" rx="8" fill="#d97706"/>
    <text x="529" y="62" fill="#fde68a" font-size="8" text-anchor="middle">ステップ 4</text>
    <text x="529" y="80" fill="#fff" font-weight="bold" text-anchor="middle">拡張機能を</text>
    <text x="529" y="94" fill="#fff" font-weight="bold" text-anchor="middle">配布</text>

    <rect x="612" y="40" width="130" height="66" rx="8" fill="#e11d48"/>
    <text x="677" y="62" fill="#fecdd3" font-size="8" text-anchor="middle">ステップ 5</text>
    <text x="677" y="80" fill="#fff" font-weight="bold" text-anchor="middle">ポリシー設定</text>
    <text x="677" y="94" fill="#fff" font-weight="bold" text-anchor="middle">動作確認</text>
  </g>
  <path d="M150 73 L164 73" stroke="#94a3b8" stroke-width="2" marker-end="url(#c1)"/>
  <path d="M298 73 L312 73" stroke="#94a3b8" stroke-width="2" marker-end="url(#c1)"/>
  <path d="M446 73 L460 73" stroke="#94a3b8" stroke-width="2" marker-end="url(#c1)"/>
  <path d="M594 73 L608 73" stroke="#94a3b8" stroke-width="2" marker-end="url(#c1)"/>
  <text x="20" y="130" fill="#64748b" font-size="8">※ ステップ1〜2は学校ごとに1回。ステップ3以降も学校ごとに設定します。</text>
  <defs><marker id="c1" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6" fill="#94a3b8"/></marker></defs>
</svg>
```

---

### ステップ 1: スプレッドシートを準備する

1. Google ドライブで**新しいスプレッドシート**を作ります（学校ごとに1つ）。
2. 名前を分かりやすく付けます（例：`英田小学校_端末管理`）。
3. メニューの **「拡張機能」→「Apps Script」** を開きます。

---

### ステップ 2: GAS を設定してデプロイする

1. Apps Script のエディタで、最初から入っている `function myFunction() {...}` を**全部消します**。
2. `gas/Code.gs` の内容を**全部貼り付け**ます。
3. **保存**します（💾 アイコン）。
4. 関数を選ぶプルダウンで **`setupSpreadsheet`** を選び、**▶ 実行** を押します。
   - 初回は権限の確認が出ます。「詳細」→「（安全でないページ）に移動」→「許可」。
   - これで4つのシート（端末一覧／教員マスタ／画面情報／スケジュール管理）が自動で作られます。
5. 続けて **`initializeTeacherAccount`**（または同様の初期アカウント作成関数）を実行し、
   **管理者アカウント**を作ります（教員メールアドレス＋パスワード）。
6. **「デプロイ」→「新しいデプロイ」** を押します。
   - 種類：**ウェブアプリ**
   - 実行ユーザー：**自分**
   - アクセスできるユーザー：**全員**
7. 表示された **`/exec` で終わるURL** をコピーします。**これが GAS URL です。**

```svg
<svg viewBox="0 0 640 220" xmlns="http://www.w3.org/2000/svg" font-family="sans-serif">
  <rect width="640" height="220" fill="#f8fafc" rx="12"/>
  <rect x="30" y="24" width="580" height="70" rx="8" fill="#fff" stroke="#cbd5e1"/>
  <text x="46" y="46" fill="#334155" font-size="10" font-weight="bold">デプロイを管理</text>
  <line x1="30" y1="56" x2="610" y2="56" stroke="#e2e8f0"/>
  <text x="46" y="76" fill="#64748b" font-size="8">バージョン 3　／　ウェブアプリ　／　全員</text>
  <text x="560" y="76" fill="#94a3b8" font-size="12">✏️</text>
  <rect x="30" y="112" width="580" height="86" rx="8" fill="#fef3c7" stroke="#f59e0b"/>
  <text x="46" y="136" fill="#78350f" font-size="10" font-weight="bold">⚠ 更新するときは「鉛筆（✏️）」から</text>
  <text x="46" y="158" fill="#92400e" font-size="9">コードを直したら「デプロイを管理」→ 既存デプロイの ✏️ → バージョン「新バージョン」→「デプロイ」。</text>
  <text x="46" y="176" fill="#b91c1c" font-size="9" font-weight="bold">「新しいデプロイ」を押すと URL が変わり、全端末のポリシー設定が無効になります。</text>
  <text x="46" y="192" fill="#92400e" font-size="8">URL を変えずに更新するのが正しい手順です。</text>
</svg>
```

> ⚠ **いちばん大事な注意点**
> コードを更新するときは、**必ず「既存のデプロイ」の鉛筆アイコンから**新バージョンを作ってください。
> 「新しいデプロイ」を押すと **URLが変わってしまい**、全端末で設定し直しになります。

---

### ステップ 2-2: スクリプトプロパティを設定する（親GAS・子GAS）

`setupSpreadsheet` を実行すると**シートが4枚**作られます。それに加えて、
**スクリプトプロパティ**（GASの設定値）を入れると、学校をまたぐ運用や予約の自動反映が正しく動きます。

> 💡 設定場所：Apps Script の画面 → 左の歯車アイコン **「プロジェクトの設定」** → 一番下の **「スクリプト プロパティ」** → **「スクリプト プロパティを追加」**。

```svg
<svg viewBox="0 0 700 260" xmlns="http://www.w3.org/2000/svg" font-family="sans-serif">
  <rect width="700" height="260" fill="#f8fafc" rx="12"/>
  <text x="24" y="30" fill="#334155" font-size="13" font-weight="bold">プロジェクトの設定 → スクリプト プロパティ</text>
  <rect x="24" y="46" width="200" height="180" rx="8" fill="#ffffff" stroke="#cbd5e1"/>
  <text x="40" y="70" fill="#475569" font-size="10">⚙ プロジェクトの設定</text>
  <rect x="32" y="80" width="184" height="24" rx="5" fill="#e0e7ff"/>
  <text x="44" y="96" fill="#3730a3" font-size="9">スクリプト プロパティ</text>
  <text x="44" y="124" fill="#94a3b8" font-size="9">トリガー</text>
  <text x="44" y="146" fill="#94a3b8" font-size="9">タイムゾーン</text>
  <rect x="244" y="46" width="432" height="180" rx="8" fill="#ffffff" stroke="#cbd5e1"/>
  <text x="262" y="70" fill="#1e293b" font-size="10" font-weight="bold">スクリプト プロパティ</text>
  <rect x="262" y="80" width="180" height="24" rx="5" fill="#f8fafc" stroke="#cbd5e1"/>
  <text x="272" y="96" fill="#64748b" font-size="9">プロパティ</text>
  <rect x="450" y="80" width="150" height="24" rx="5" fill="#f8fafc" stroke="#cbd5e1"/>
  <text x="460" y="96" fill="#64748b" font-size="9">値</text>
  <rect x="262" y="112" width="180" height="24" rx="5" fill="#ffffff" stroke="#e2e8f0"/>
  <text x="272" y="128" fill="#334155" font-size="9">SHARD_MODE</text>
  <rect x="450" y="112" width="150" height="24" rx="5" fill="#ffffff" stroke="#e2e8f0"/>
  <text x="460" y="128" fill="#334155" font-size="9">true</text>
  <rect x="262" y="144" width="180" height="24" rx="5" fill="#ffffff" stroke="#e2e8f0"/>
  <text x="272" y="160" fill="#334155" font-size="9">SHARD_SECRET</text>
  <rect x="450" y="144" width="150" height="24" rx="5" fill="#ffffff" stroke="#e2e8f0"/>
  <text x="460" y="160" fill="#334155" font-size="9">ランダムな長い文字列</text>
  <rect x="262" y="180" width="338" height="26" rx="6" fill="#047857"/>
  <text x="431" y="198" fill="#ffffff" font-size="9" text-anchor="middle" font-weight="bold">＋ スクリプト プロパティを追加</text>
  <text x="24" y="248" fill="#64748b" font-size="9">保存を押し忘れないでください。保存しないと反映されません。</text>
</svg>
```

#### 親GAS（ハブ）に設定するもの

| プロパティ名 | 値の例 | 必須 | 意味 |
|---|---|---|---|
| `SHARD_MODE` | `true` | **必須** | このスクリプトを「親（ハブ）」として動かす |
| `SHARD_SECRET` | `Mimasaka-2026-x7Kq9pLm` | **必須** | 親と子で**同じ値**にする合言葉（他人に推測されない長い文字列） |
| `SHARD_MAP_V1` | `{"5年1組":"https://…/exec"}` | 任意 | クラス → 子GASのURL の対応表（JSON） |
| `SHARD_DEFAULT_URL` | `https://…/exec` | 任意 | クラスが分からない端末の既定の子GAS |

> ⚠ `SHARD_SECRET` は**推測されにくい長い文字列**にしてください。これが一致しないと子GASは指示を受け付けません（`共有シークレットが一致しません` と出ます）。

**`SHARD_MAP_V1` の書き方（実例）**

```json
{
  "5年1組": "https://script.google.com/macros/s/AKfy…/exec",
  "5-1":    "https://script.google.com/macros/s/AKfy…/exec",
  "6年1組": "https://script.google.com/macros/s/AKfy…の2つ目…/exec",
  "":       "https://script.google.com/macros/s/AKfy…既定…/exec"
}
```

- キーは **`5年1組`** でも **`5-1`** でも同じに扱われます（全角数字・空白も吸収します）。
- **同じクラスを複数の書き方で登録**しておくと、名簿の表記ゆれで届かなくなる事故を防げます。
- 最後の **`""`（空キー）** は「クラスが分からない端末の行き先」です。

> ⚠ **担当の子GASが無いクラスは「親GASのみで運用」になります。**
> そのクラスの児童へは子GASに送られず、子のシートに行が作られることもありません（意図した動作です）。
> 実行ログに `SHARD_MAP_V1 にクラス「3年1組」がありません。このクラスは親GASのみで運用します` と出ます。

#### 子GAS（スポーク）に設定するもの

| プロパティ名 | 値の例 | 必須 | 意味 |
|---|---|---|---|
| `SHARD_CHILD_MODE` | `true` | **必須** | このスクリプトを「子（スポーク）」として動かす |
| `SHARD_MODE` | `false` | **必須** | 親ではないことを明示する（両方trueにしない） |
| `SHARD_SECRET` | `Mimasaka-2026-x7Kq9pLm` | **必須** | 親と**同じ値** |
| `SHARD_PARENT_URL` | `https://…親の…/exec` | 推奨 | 親のURL（子から親へ問い合わせる経路） |
| `SPREADSHEET_ID` | `1_zSGoaoyUq…` | 推奨 | この子GASが書き込む**自分の**スプレッドシートID |

```svg
<svg viewBox="0 0 720 240" xmlns="http://www.w3.org/2000/svg" font-family="sans-serif">
  <rect width="720" height="240" fill="#f8fafc" rx="12"/>
  <text x="24" y="30" fill="#334155" font-size="13" font-weight="bold">親と子で「同じ合言葉」、役割だけを分ける</text>
  <rect x="24" y="50" width="300" height="150" rx="10" fill="#eef2ff" stroke="#c7d2fe"/>
  <text x="44" y="76" fill="#3730a3" font-size="12" font-weight="bold">親GAS（ハブ）</text>
  <text x="44" y="102" fill="#3730a3" font-size="10">SHARD_MODE = true</text>
  <text x="44" y="124" fill="#3730a3" font-size="10">SHARD_SECRET = ★同じ値</text>
  <text x="44" y="146" fill="#3730a3" font-size="10">SHARD_MAP_V1 = {…}</text>
  <text x="44" y="168" fill="#3730a3" font-size="10">SHARD_DEFAULT_URL = …</text>
  <text x="44" y="190" fill="#64748b" font-size="9">＝ 指示を出す側</text>
  <rect x="396" y="50" width="300" height="150" rx="10" fill="#ecfdf5" stroke="#a7f3d0"/>
  <text x="416" y="76" fill="#065f46" font-size="12" font-weight="bold">子GAS（スポーク）</text>
  <text x="416" y="102" fill="#065f46" font-size="10">SHARD_CHILD_MODE = true</text>
  <text x="416" y="124" fill="#065f46" font-size="10">SHARD_MODE = false</text>
  <text x="416" y="146" fill="#065f46" font-size="10">SHARD_SECRET = ★同じ値</text>
  <text x="416" y="168" fill="#065f46" font-size="10">SHARD_PARENT_URL = …</text>
  <text x="416" y="190" fill="#065f46" font-size="10">SPREADSHEET_ID = …</text>
  <path d="M330 120 L390 120" stroke="#94a3b8" stroke-width="2" marker-end="url(#sp1)"/>
  <text x="360" y="110" fill="#94a3b8" font-size="8" text-anchor="middle">指示</text>
  <defs><marker id="sp1" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6" fill="#94a3b8"/></marker></defs>
</svg>
```

> ⚠ **`SHARD_MODE` と `SHARD_CHILD_MODE` を両方 `true` にしないでください。**
> 親が子として振る舞うと、全校の端末が正しく動かなくなります。

> 💡 `SHARD_SECRET` が空だと、子GASは**すべての指示を拒否**します（安全側の設計）。
> 必ず**親・子の両方に同じ値**を入れてください。

#### 設定できたかの確認

Apps Script のエディタで次の関数を実行すると、設定内容がログに出ます。

| 実行する関数 | 確認できること |
|---|---|
| `setupSpreadsheet` | 4つのシートが揃っているか（無ければ作られます） |
| `getShardSettingsForAdmin` | `shard_mode` / `child_mode` / `classes` / `default_url` |

> 💡 `getShardSettingsForAdmin` の結果に `secret_configured: true` が出ていれば、
> `SHARD_SECRET` は入っています（値そのものは安全のため表示されません）。

### ステップ 2-3: 学校ごとに子GASを追加する場合

「1校 = 1つの独立したスプレッドシート」が前提です（R41）。
学校を分けるときは、**学校の数だけ同じ手順**を繰り返します。

1. 新しいスプレッドシートを作る（例：`大原小学校_端末管理`）。
2. 拡張機能 → Apps Script → `gas/Code.gs` を貼り付け。
3. `setupSpreadsheet` を実行。
4. スクリプトプロパティに**子GASの設定**を入れる（`SHARD_CHILD_MODE=true` など）。
5. **ウェブアプリ**としてデプロイし、`/exec` のURLをコピー。
6. 親GASの `SHARD_MAP_V1` に、**その学校のクラス**を追加する。

> ⚠ 手順6を忘れると、その学校の児童は**親GASのみで運用**になります。
> 「予約が一部のクラスだけ効かない」ときは、ここを疑ってください（[第9章](#9-困ったときは)）。

---

### ステップ 3: 教員アカウントを登録する

管理コンソールにログインし、**「アカウント管理」**（管理者のみ表示）から先生を登録します。

| 項目 | 説明 |
|---|---|
| **教員ID（メールアドレス）** | ログインに使うメールアドレス |
| **パスワード** | ログインに使うパスワード |
| **氏名** | 画面に表示される名前 |
| **所属学校** | この先生が見られる学校（14校から選択） |
| **権限** | `ADMIN`（管理者・全校）または `TEACHER`（一般・自校のみ） |
| **対象クラス** | 担当クラス。**管理者のみ**設定できます |

> 💡 **権限の違い**
> - `ADMIN` … 全校の児童を閲覧・操作できる。アカウント管理・監視設定も使える。
> - `TEACHER` … **自校の児童のみ**。他校の児童は表示されず、操作もできません（安全のため）。

---

### ステップ 4: 拡張機能を配布する

**児童に操作させないための設定**が2つあります。

| 設定 | 内容 |
|---|---|
| **アイコンを押しても何も出ない** | 児童が誤って触っても、設定画面が開きません |
| **強制インストール** | 児童が自分で削除できません |

手順:
1. Chrome ウェブストアに `dist/extension.zip` をアップロードし、審査を通して公開します。
2. Google 管理コンソール → **「Chrome」→「アプリと拡張機能」** を開きます。
3. 児童用のOU（組織部門）を選び、**「追加」→「Chrome ウェブストアから追加」**。
4. 公開した拡張機能の**ID**を指定して追加します。
5. インストールポリシーを **「強制インストール」** にします。

---

### ステップ 5: ポリシー（Managed Storage）を設定する

ここが**つまずきやすいところ**です。キー名が1文字でも違うと、**Chromeが黙って無視**します。

#### ✅ 正しいキー名（この4つだけ）

| キー | 意味 | 例 |
|---|---|---|
| `gas_url` | GAS の URL（1校だけのとき） | `https://script.google.com/macros/s/AKfy.../exec` |
| `gas_url_map` | 学校名 → GAS URL（複数校のとき） | `{"英田小学校":"https://...", ...}` |
| `school_name` | 端末の所属学校名 | `英田小学校` |
| `student_id` | 固定の児童ID（任意） | `${USER_EMAIL}` |

#### ❌ よくある間違い

| 間違い | 正しい |
|---|---|
| `gasApiUrl` | `gas_url` |
| `schoolId` | `school_name` |
| `schoolName` | `school_name` |
| `gasUrl` | `gas_url` |

#### 設定するJSON（1校ずつの場合）

```json
{
  "gas_url":     { "Value": "https://script.google.com/macros/s/AKfy.../exec" },
  "school_name": { "Value": "英田小学校" },
  "student_id":  { "Value": "${USER_EMAIL}" }
}
```

> 💡 `{ "Value": ... }` の形は**正しい**書き方です（管理コンソールの形式）。変えるのは**キー名**だけです。

```svg
<svg viewBox="0 0 700 240" xmlns="http://www.w3.org/2000/svg" font-family="sans-serif">
  <rect width="700" height="240" fill="#f8fafc" rx="12"/>
  <text x="24" y="30" fill="#1e293b" font-size="12" font-weight="bold">設定が届くまで</text>
  <rect x="24" y="48" width="150" height="70" rx="8" fill="#fff" stroke="#cbd5e1"/>
  <text x="99" y="72" fill="#334155" font-size="9" text-anchor="middle" font-weight="bold">管理コンソール</text>
  <text x="99" y="90" fill="#64748b" font-size="8" text-anchor="middle">ポリシーを保存</text>
  <text x="99" y="106" fill="#64748b" font-size="8" text-anchor="middle">（JSON）</text>
  <path d="M174 83 L212 83" stroke="#94a3b8" stroke-width="2" marker-end="url(#d1)"/>
  <rect x="216" y="48" width="150" height="70" rx="8" fill="#e0e7ff" stroke="#818cf8"/>
  <text x="291" y="72" fill="#3730a3" font-size="9" text-anchor="middle" font-weight="bold">Chrome が読む</text>
  <text x="291" y="90" fill="#4338ca" font-size="8" text-anchor="middle">schema.json に</text>
  <text x="291" y="106" fill="#4338ca" font-size="8" text-anchor="middle">あるキーだけ採用</text>
  <path d="M366 83 L404 83" stroke="#94a3b8" stroke-width="2" marker-end="url(#d1)"/>
  <rect x="408" y="48" width="150" height="70" rx="8" fill="#d1fae5" stroke="#34d399"/>
  <text x="483" y="72" fill="#065f46" font-size="9" text-anchor="middle" font-weight="bold">拡張機能が受け取る</text>
  <text x="483" y="90" fill="#047857" font-size="8" text-anchor="middle">gas_url で</text>
  <text x="483" y="106" fill="#047857" font-size="8" text-anchor="middle">GAS につながる</text>

  <rect x="24" y="140" width="534" height="76" rx="8" fill="#fee2e2" stroke="#f87171"/>
  <text x="40" y="162" fill="#991b1b" font-size="9" font-weight="bold">❌ キー名が違うと…</text>
  <text x="40" y="182" fill="#b91c1c" font-size="8">エラーは出ません。設定したのに「反映されない」という症状になります。</text>
  <text x="40" y="200" fill="#b91c1c" font-size="8">Chrome は schema.json にないキーを、黙って捨ててしまうためです。</text>

  <rect x="572" y="140" width="104" height="76" rx="8" fill="#f1f5f9" stroke="#cbd5e1"/>
  <text x="624" y="164" fill="#334155" font-size="8" text-anchor="middle">確認方法</text>
  <text x="624" y="182" fill="#64748b" font-size="7" text-anchor="middle">chrome://policy</text>
  <text x="624" y="196" fill="#94a3b8" font-size="7" text-anchor="middle">（児童端末では</text>
  <text x="624" y="208" fill="#94a3b8" font-size="7" text-anchor="middle">開けない場合あり）</text>
  <defs><marker id="d1" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6" fill="#94a3b8"/></marker></defs>
</svg>
```

#### 確認方法

1. 児童端末（またはテスト用のChromebook）で Chrome を開きます。
2. `chrome://policy` を開きます。
3. `gas_url` と `school_name` が**表示されていれば成功**です。
4. 「ポリシーを再読み込み」を押すと、すぐ反映されます。

> ⚠ 学校の設定によっては `chrome://policy` を開けない場合があります。
> その場合は、児童端末で拡張機能が動いているか（名簿に児童が出るか）で確認してください。

---

### 学校名が「未設定」のままになるとき

バージョン **1.6.3** 以降で解決済みです。**1.6.4** ではポリシー未配布の端末でも一度は通信するよう改善しました。
それでも「未設定」になる場合は次を確認してください。

| 確認すること | 対処 |
|---|---|
| 拡張機能が 1.6.11 未満 | ストアから 1.6.11 を配布し直す |
| GAS を再デプロイしていない | 鉛筆アイコンから新バージョンでデプロイ |
| ポリシーのキー名が違う | `school_name` になっているか確認 |
| 学校名の綴りが違う | `CONFIG.SCHOOL_LIST` と完全に一致させる（「英田小」などの略称は不可） |

> 💡 1.6.3 以降は「**端末が学校名を送る**」＋「**GASが受け取る**」の**両方**が揃って初めて動きます。
> 片方だけでは動きません。

---

## 12. サイト監視の設定

**管理者のみ**が変更できます。

### 設定場所

管理コンソールのヘッダーにある **赤い「監視設定」ボタン** を押します。

```svg
<svg viewBox="0 0 660 300" xmlns="http://www.w3.org/2000/svg" font-family="sans-serif">
  <rect width="660" height="300" fill="#e2e8f0" rx="12"/>
  <rect x="40" y="16" width="580" height="270" rx="10" fill="#fff" stroke="#cbd5e1"/>
  <text x="60" y="42" fill="#1e293b" font-size="13" font-weight="bold">サイト監視設定（システム全体）</text>
  <text x="596" y="42" fill="#94a3b8" font-size="12" text-anchor="end">✕</text>
  <line x1="40" y1="52" x2="620" y2="52" stroke="#e2e8f0"/>

  <rect x="60" y="64" width="540" height="56" rx="7" fill="#fff1f2" stroke="#fda4af"/>
  <rect x="74" y="80" width="16" height="16" rx="3" fill="#e11d48"/>
  <text x="82" y="92" fill="#fff" font-size="11" text-anchor="middle">✓</text>
  <text x="100" y="86" fill="#881337" font-size="10" font-weight="bold">サイト監視を有効にする（システム全体）</text>
  <text x="100" y="104" fill="#9f1239" font-size="8">有効にすると、学習に関係のないサイトを開いたときに名簿へ「⚠ 注意」が出ます。</text>

  <text x="60" y="140" fill="#334155" font-size="9" font-weight="bold">非学習ドメイン辞書（開いたら注意マークを出す）</text>
  <text x="596" y="140" fill="#94a3b8" font-size="8" text-anchor="end">1行に1ドメイン</text>
  <rect x="60" y="146" width="540" height="46" rx="5" fill="#f8fafc" stroke="#cbd5e1"/>
  <text x="70" y="162" fill="#334155" font-size="8" font-family="monospace">youtube.com</text>
  <text x="70" y="175" fill="#334155" font-size="8" font-family="monospace">tiktok.com</text>
  <text x="70" y="188" fill="#334155" font-size="8" font-family="monospace">roblox.com</text>

  <text x="60" y="212" fill="#334155" font-size="9" font-weight="bold">学習ドメイン辞書（注意マークを出さない）</text>
  <rect x="60" y="218" width="540" height="40" rx="5" fill="#f8fafc" stroke="#cbd5e1"/>
  <text x="70" y="234" fill="#334155" font-size="8" font-family="monospace">google.com</text>
  <text x="70" y="247" fill="#334155" font-size="8" font-family="monospace">nhk.or.jp</text>

  <rect x="452" y="264" width="62" height="16" rx="4" fill="#e2e8f0"/>
  <text x="483" y="275" font-size="8" fill="#475569" text-anchor="middle">閉じる</text>
  <rect x="520" y="264" width="62" height="16" rx="4" fill="#e11d48"/>
  <text x="551" y="275" font-size="8" fill="#fff" text-anchor="middle">保存する</text>
</svg>
```

### 設定できること

| 項目 | 説明 |
|---|---|
| **サイト監視を有効にする** | システム全体のON/OFF。**初期値はOFF** |
| **非学習ドメイン辞書** | 開いたら注意マークを出すサイト（YouTube・SNS・ゲームなど） |
| **学習ドメイン辞書** | 注意マークを出さないサイト（授業で使うサイト） |

辞書は **1行に1ドメイン**で入力します。
`youtube.com` と書けば、`www.youtube.com` や `m.youtube.com` も対象になります。

### 押さえておきたい動き

| 動き | 説明 |
|---|---|
| **初期値はOFF** | ONにしない限り、注意マークは一切出ません |
| **OFFにすると即座に消える** | 全端末でマークが消えます。ただし**記録は残ります** |
| **URLが変わったときだけ判定** | 毎回の通信で判定しないので、端末が増えても重くなりません |
| **管理者だけが変更できる** | 一般の先生が操作しても、サーバー側で拒否されます |

### シートに増える列

「端末一覧」シートの末尾に4列が自動で追加されます（既存のシートでも自動）。

| 列名 | 内容 |
|---|---|
| **要注意** | TRUE / FALSE |
| **注意理由** | 例「学習に関係のないサイト（youtube.com）」 |
| **要注意URL** | サイトの名前 |
| **注意検知日時** | 検知した日時 |

### 推奨する運用

1. **最初はOFF**のまま、通常授業を1週間ほど行います。
2. 児童がよく開くサイトを確認します。
3. 授業で使うサイトを**学習ドメイン辞書**に追加します。
4. そのうえで**ON**にします。

> 💡 いきなりONにすると、授業で使うサイトまで「注意」と出てしまうことがあります。
> 先に学習ドメイン辞書を整えると、誤検知が減ります。

---

## 13. アカウントと権限（ADMIN と TEACHER の違い）

このシステムには**2種類のアカウント**があります。
「できること」がはっきり違うので、まずここを読んでください。

```svg
<svg viewBox="0 0 760 300" xmlns="http://www.w3.org/2000/svg" font-family="sans-serif">
  <rect width="760" height="300" fill="#f8fafc" rx="12"/>
  <text x="24" y="30" fill="#334155" font-size="13" font-weight="bold">ADMIN（管理者）と TEACHER（一般教員）の守備範囲</text>
  <rect x="24" y="48" width="348" height="230" rx="10" fill="#ffffff" stroke="#cbd5e1"/>
  <rect x="24" y="48" width="348" height="40" rx="10" fill="#4f46e5"/>
  <text x="44" y="74" fill="#ffffff" font-size="13" font-weight="bold">ADMIN（管理者）</text>
  <text x="248" y="74" fill="#c7d2fe" font-size="10">情報担当の先生</text>
  <text x="44" y="112" fill="#334155" font-size="10">・全校の児童を表示・操作できる</text>
  <text x="44" y="134" fill="#334155" font-size="10">・アカウント管理（教員の登録・編集・削除）</text>
  <text x="44" y="156" fill="#334155" font-size="10">・年次更新・一括インポート</text>
  <text x="44" y="178" fill="#334155" font-size="10">・サイト監視のON/OFF</text>
  <text x="44" y="200" fill="#334155" font-size="10">・子GAS分散の設定</text>
  <text x="44" y="222" fill="#334155" font-size="10">・卒業生アーカイブの閲覧</text>
  <text x="44" y="252" fill="#4f46e5" font-size="10" font-weight="bold">＝ 学校の「管理者」</text>
  <text x="44" y="270" fill="#64748b" font-size="9">所属学校が「全校管理」でも ADMIN と同じ扱い</text>
  <rect x="388" y="48" width="348" height="230" rx="10" fill="#ffffff" stroke="#cbd5e1"/>
  <rect x="388" y="48" width="348" height="40" rx="10" fill="#047857"/>
  <text x="408" y="74" fill="#ffffff" font-size="13" font-weight="bold">TEACHER（一般教員）</text>
  <text x="612" y="74" fill="#a7f3d0" font-size="10">担任の先生</text>
  <text x="408" y="112" fill="#334155" font-size="10">・自校（＋担当クラス）の児童のみ</text>
  <text x="408" y="134" fill="#334155" font-size="10">・画面ロック／一斉URL配信／URL規制</text>
  <text x="408" y="156" fill="#334155" font-size="10">・画面情報取得</text>
  <text x="408" y="178" fill="#334155" font-size="10">・予約スケジュールの作成・編集</text>
  <text x="408" y="200" fill="#334155" font-size="10">・マイ設定（自分のURL情報）</text>
  <text x="408" y="222" fill="#64748b" font-size="10">・アカウント管理／年次更新は✕</text>
  <text x="408" y="252" fill="#047857" font-size="10" font-weight="bold">＝ 教室の「操作担当」</text>
  <text x="408" y="270" fill="#64748b" font-size="9">他校・担当外クラスは表示されません</text>
</svg>
```

### 13-1. できることの比較表

| できること | ADMIN | TEACHER |
|---|---|---|
| 自校の児童を表示・操作 | **○** | **○** |
| 他校の児童を表示・操作 | **○** | **✕**（仕様） |
| 画面ロック／一斉URL配信／URL規制 | **○** | **○**（担当範囲内） |
| 画面情報取得（スクリーンショット） | **○** | **○**（担当範囲内） |
| 予約スケジュールの作成・編集・取消 | **○** | **○**（担当範囲内） |
| サイト監視の ON/OFF | **○** | **✕** |
| 子GAS分散の設定（`SHARD_MAP_V1` 等） | **○** | **✕** |
| アカウント管理（教員の登録・編集） | **○** | **✕** |
| 教員の一括インポート（CSV） | **○** | **✕** |
| 年次更新（卒業処理・予約実行） | **○** | **✕** |
| 卒業生アーカイブの閲覧 | **○** | **✕** |
| マイ設定（自分の個別URL・規制URL） | **○** | **○** |

### 13-2. 「担当クラス」という権限の境界

TEACHER は**所属学校**の中でも、さらに**担当クラス**で絞り込めます。

```svg
<svg viewBox="0 0 720 250" xmlns="http://www.w3.org/2000/svg" font-family="sans-serif">
  <rect width="720" height="250" fill="#f8fafc" rx="12"/>
  <text x="24" y="30" fill="#334155" font-size="13" font-weight="bold">担当クラスを設定すると、そのクラスだけが見えます</text>
  <rect x="24" y="48" width="330" height="180" rx="10" fill="#ffffff" stroke="#cbd5e1"/>
  <text x="44" y="72" fill="#1e293b" font-size="11" font-weight="bold">担当クラス：空欄（制限なし）</text>
  <rect x="44" y="88" width="86" height="26" rx="6" fill="#dbeafe"/>
  <text x="87" y="105" fill="#1e40af" font-size="9" text-anchor="middle">5年1組</text>
  <rect x="138" y="88" width="86" height="26" rx="6" fill="#dbeafe"/>
  <text x="181" y="105" fill="#1e40af" font-size="9" text-anchor="middle">5年2組</text>
  <rect x="232" y="88" width="86" height="26" rx="6" fill="#dbeafe"/>
  <text x="275" y="105" fill="#1e40af" font-size="9" text-anchor="middle">6年1組</text>
  <text x="44" y="146" fill="#475569" font-size="10">自校の全クラスが表示されます。</text>
  <text x="44" y="168" fill="#475569" font-size="10">（学校全体を見る先生向け）</text>
  <text x="44" y="204" fill="#0c4a6e" font-size="10" font-weight="bold">＝ 学校のすべての児童</text>
  <rect x="366" y="48" width="330" height="180" rx="10" fill="#ffffff" stroke="#cbd5e1"/>
  <text x="386" y="72" fill="#1e293b" font-size="11" font-weight="bold">担当クラス：5年1組</text>
  <rect x="386" y="88" width="86" height="26" rx="6" fill="#4f46e5"/>
  <text x="429" y="105" fill="#ffffff" font-size="9" text-anchor="middle">5年1組</text>
  <rect x="480" y="88" width="86" height="26" rx="6" fill="#f1f5f9"/>
  <text x="523" y="105" fill="#cbd5e1" font-size="9" text-anchor="middle">5年2組</text>
  <rect x="574" y="88" width="86" height="26" rx="6" fill="#f1f5f9"/>
  <text x="617" y="105" fill="#cbd5e1" font-size="9" text-anchor="middle">6年1組</text>
  <text x="386" y="146" fill="#475569" font-size="10">5年1組の児童だけが表示・操作できます。</text>
  <text x="386" y="168" fill="#475569" font-size="10">（担任の先生向け）</text>
  <text x="386" y="204" fill="#3730a3" font-size="10" font-weight="bold">＝ 自分のクラスだけ</text>
</svg>
```

- **空欄**にすると、自校の**全クラス**が対象になります。
- クラス名を入れると、そのクラス**だけ**が対象になります。
- `5年1組,5年2組` のように**カンマ区切りで複数**指定できます（`、` `／` `・` も可）。
- `全クラス` `ALL` `すべて` `指定なし` と書いた場合も「制限なし」になります。

> ⚠ 担当クラスは**一覧の表示だけでなく、一括操作の対象判定にも使われます**。
> 担当外の児童IDを指定しても操作できません（安全のため）。

> 💡 **クラスが「未設定」の児童**（初回ログイン直後など）は、どの先生でも見えます。
> 学校への紐付けが終わる前に一覧へ出ないと、運用が始められないためです。

### 13-3. アカウントの列（教員マスタ）

「教員マスタ」シートには、1人1行で次の列があります。

| 列名 | 意味 | 例 |
|---|---|---|
| 教員ID(メールアドレス) | ログインID。**これが唯一のキー** | `taro@mimasaka.ed.jp` |
| パスワード | 手動ログイン用（SSOのみなら空でも可） | `********` |
| 氏名 | 画面に表示される名前 | `美作 太郎` |
| 所属学校 | 権限の境界（学校） | `第一小学校` |
| 権限 | `ADMIN` か `TEACHER` | `TEACHER` |
| 対象クラス | 権限の境界（クラス） | `5年1組` |
| 登録URL情報 | 個別に登録したURL | `https://…` |
| 個別ホワイトリスト | その先生だけの許可URL | `youtube.com` |
| 個別ブラックリスト | その先生だけの規制URL | `game.com` |
| 最終ログイン日時 | 自動で記録 | `2026/11/10 08:12:33` |
| Google SSO許可 | Googleアカウントでのログイン可否 | `TRUE` |

> 💡 **所属学校が「全校管理」**の先生は、学校の境界がなくなります（全児童が見えます）。
> ただし**対象クラス**の指定は、この場合でも効きます。

---

## 14. マイ設定とアカウント管理

ここでは**2つ**を説明します。

- **マイ設定** … 先生**自身**が自分の設定を変える画面（TEACHER も使えます）
- **アカウント管理** … 管理者が**他の先生のアカウント**を作る・直す画面（**ADMIN のみ**）

```svg
<svg viewBox="0 0 720 170" xmlns="http://www.w3.org/2000/svg" font-family="sans-serif">
  <rect width="720" height="170" fill="#f8fafc" rx="10"/>
  <text x="24" y="30" fill="#334155" font-size="12" font-weight="bold">「自分の設定」と「他人の管理」は別の入口です</text>
  <rect x="24" y="50" width="320" height="96" rx="10" fill="#ffffff" stroke="#cbd5e1"/>
  <rect x="24" y="50" width="320" height="30" rx="10" fill="#047857"/>
  <text x="44" y="70" fill="#ffffff" font-size="11" font-weight="bold">マイ設定（全員）</text>
  <text x="44" y="102" fill="#334155" font-size="10">・自分の個別URL</text>
  <text x="44" y="122" fill="#334155" font-size="10">・自分の許可／規制URL</text>
  <rect x="376" y="50" width="320" height="96" rx="10" fill="#ffffff" stroke="#cbd5e1"/>
  <rect x="376" y="50" width="320" height="30" rx="10" fill="#4f46e5"/>
  <text x="396" y="70" fill="#ffffff" font-size="11" font-weight="bold">アカウント管理（ADMIN のみ）</text>
  <text x="396" y="102" fill="#334155" font-size="10">・先生の新規登録／編集／削除</text>
  <text x="396" y="122" fill="#334155" font-size="10">・権限（ADMIN／TEACHER）の付与</text>
</svg>
```

### 14-1. マイ設定（先生が自分の設定を変える）

**開き方**：ログイン後、右上の**自分の名前**を押します。

```svg
<svg viewBox="0 0 620 300" xmlns="http://www.w3.org/2000/svg" font-family="sans-serif">
  <rect width="620" height="300" fill="#e2e8f0" rx="10"/>
  <rect x="40" y="20" width="540" height="260" rx="12" fill="#ffffff" stroke="#cbd5e1"/>
  <text x="64" y="50" fill="#1e293b" font-size="13" font-weight="bold">マイ設定（個別URL・規制URL）</text>
  <text x="64" y="78" fill="#475569" font-size="10">自分のアカウントにだけ適用される設定です。</text>
  <text x="64" y="106" fill="#475569" font-size="10">表示するURL</text>
  <rect x="64" y="114" width="440" height="28" rx="6" fill="#f8fafc" stroke="#cbd5e1"/>
  <text x="76" y="133" fill="#94a3b8" font-size="10">https://www.mext.go.jp/</text>
  <text x="64" y="164" fill="#475569" font-size="10">許可URLリスト（ホワイトリスト）</text>
  <rect x="64" y="172" width="440" height="28" rx="6" fill="#f8fafc" stroke="#cbd5e1"/>
  <text x="76" y="191" fill="#94a3b8" font-size="10">youtube.com, wikipedia.org</text>
  <text x="64" y="222" fill="#475569" font-size="10">規制URLリスト（ブラックリスト）</text>
  <rect x="64" y="230" width="440" height="28" rx="6" fill="#f8fafc" stroke="#cbd5e1"/>
  <text x="76" y="249" fill="#94a3b8" font-size="10">game.example.com</text>
  <text x="40" y="296" fill="#64748b" font-size="10">※ 複数のURLはカンマ（,）で区切って入力します。</text>
</svg>
```

**できること**

| 項目 | 説明 |
|---|---|
| **表示するURL** | 自分が管理画面を開いたときに最初に見るページ |
| **許可URLリスト** | 自分専用の「見てよいサイト」 |
| **規制URLリスト** | 自分専用の「見せないサイト」 |

1. 右上の**自分の名前**を押します。
2. タイトルが **「マイ設定（個別URL・規制URL）」** になっていることを確認します。
3. 必要な項目を入力します。
4. **保存** を押します。

> 💡 管理者（ADMIN）が同じ画面を開くと、タイトルが
> **「教員アカウント設定（対象クラス・個別URL・規制URL）」** に変わります。
> これは「自分だけでなく、他の先生の分も設定できる」という意味です。

> ⚠ マイ設定の内容は**その先生だけ**に効きます。児童の端末設定は変わりません。
> 児童に効かせたいときは、第4章・第5章の操作（画面ロック・URL規制）を使ってください。

### 14-2. アカウント管理（ADMIN のみ）

**開き方**：ログイン後、上部の **「アカウント管理」** ボタンを押します（ADMIN にだけ表示されます）。

```svg
<svg viewBox="0 0 720 270" xmlns="http://www.w3.org/2000/svg" font-family="sans-serif">
  <rect width="720" height="270" fill="#e2e8f0" rx="10"/>
  <rect x="30" y="20" width="660" height="230" rx="12" fill="#ffffff" stroke="#cbd5e1"/>
  <text x="54" y="50" fill="#1e293b" font-size="13" font-weight="bold">アカウント管理（管理者専用）</text>
  <rect x="54" y="66" width="120" height="30" rx="6" fill="#4f46e5"/>
  <text x="114" y="86" fill="#ffffff" font-size="10" text-anchor="middle">教員アカウント</text>
  <rect x="182" y="66" width="120" height="30" rx="6" fill="#f1f5f9" stroke="#cbd5e1"/>
  <text x="242" y="86" fill="#475569" font-size="10" text-anchor="middle">児童アカウント</text>
  <rect x="310" y="66" width="180" height="30" rx="6" fill="#f1f5f9" stroke="#cbd5e1"/>
  <text x="400" y="86" fill="#475569" font-size="10" text-anchor="middle">年次更新・一括インポート</text>
  <rect x="540" y="66" width="126" height="30" rx="6" fill="#047857"/>
  <text x="603" y="86" fill="#ffffff" font-size="10" text-anchor="middle">＋ 新規登録</text>
  <rect x="54" y="112" width="612" height="28" rx="5" fill="#f8fafc" stroke="#cbd5e1"/>
  <text x="66" y="131" fill="#475569" font-size="9">メールアドレス　　氏名　　所属学校　　権限　　対象クラス</text>
  <rect x="54" y="146" width="612" height="26" rx="5" fill="#ffffff" stroke="#e2e8f0"/>
  <text x="66" y="164" fill="#334155" font-size="9">taro@mimasaka.ed.jp　　美作 太郎　　第一小学校　　TEACHER　　5年1組</text>
  <text x="580" y="164" fill="#4f46e5" font-size="9">編集｜削除</text>
  <rect x="54" y="178" width="612" height="26" rx="5" fill="#ffffff" stroke="#e2e8f0"/>
  <text x="66" y="196" fill="#334155" font-size="9">admin@mimasaka.ed.jp　　管理 花子　　全校管理　　ADMIN　　　—</text>
  <text x="580" y="196" fill="#4f46e5" font-size="9">編集｜削除</text>
  <rect x="54" y="214" width="612" height="24" rx="5" fill="#eef2ff"/>
  <text x="66" y="231" fill="#3730a3" font-size="9">3つのタブ：教員アカウント／児童アカウント／年次更新・一括インポート</text>
</svg>
```

#### 新規登録の手順

```svg
<svg viewBox="0 0 620 420" xmlns="http://www.w3.org/2000/svg" font-family="sans-serif">
  <rect width="620" height="420" fill="#e2e8f0" rx="10"/>
  <rect x="40" y="20" width="540" height="380" rx="12" fill="#ffffff" stroke="#cbd5e1"/>
  <text x="64" y="52" fill="#1e293b" font-size="14" font-weight="bold">教員アカウントの新規登録</text>
  <text x="64" y="82" fill="#475569" font-size="10">メールアドレス（必須）</text>
  <rect x="64" y="90" width="440" height="28" rx="6" fill="#f8fafc" stroke="#cbd5e1"/>
  <text x="76" y="109" fill="#94a3b8" font-size="10">hanako@mimasaka.ed.jp</text>
  <text x="64" y="140" fill="#475569" font-size="10">パスワード（SSO許可なら空でも可）</text>
  <rect x="64" y="148" width="440" height="28" rx="6" fill="#f8fafc" stroke="#cbd5e1"/>
  <text x="76" y="167" fill="#94a3b8" font-size="12">••••••••</text>
  <text x="64" y="198" fill="#475569" font-size="10">氏名</text>
  <rect x="64" y="206" width="440" height="28" rx="6" fill="#f8fafc" stroke="#cbd5e1"/>
  <text x="76" y="225" fill="#94a3b8" font-size="10">美作 花子</text>
  <text x="64" y="256" fill="#475569" font-size="10">所属学校</text>
  <rect x="64" y="264" width="210" height="28" rx="6" fill="#f8fafc" stroke="#cbd5e1"/>
  <text x="76" y="283" fill="#334155" font-size="10">第一小学校</text>
  <text x="292" y="256" fill="#475569" font-size="10">権限</text>
  <rect x="292" y="264" width="210" height="28" rx="6" fill="#f8fafc" stroke="#cbd5e1"/>
  <text x="304" y="283" fill="#334155" font-size="10">TEACHER</text>
  <text x="64" y="314" fill="#475569" font-size="10">対象クラス（空欄なら全クラス）</text>
  <rect x="64" y="322" width="440" height="28" rx="6" fill="#f8fafc" stroke="#cbd5e1"/>
  <text x="76" y="341" fill="#94a3b8" font-size="10">5年1組</text>
  <rect x="360" y="364" width="144" height="30" rx="7" fill="#4f46e5"/>
  <text x="432" y="384" fill="#ffffff" font-size="11" font-weight="bold" text-anchor="middle">登録する</text>
  <text x="40" y="416" fill="#64748b" font-size="10">メールアドレスが既に登録されているとエラーになります。</text>
</svg>
```

1. **「アカウント管理」** を押します。
2. **「教員アカウント」** タブを選びます。
3. **「＋ 新規登録」** を押します。
4. 次の項目を入力します。
   - **メールアドレス**（必須・ログインIDになります）
   - **パスワード**（Google SSO を許可するなら空でも登録できます）
   - **氏名**
   - **所属学校**（権限の境界。全児童を見せたいなら `全校管理`）
   - **権限**（`TEACHER` または `ADMIN`）
   - **対象クラス**（空欄なら全クラス）
5. **登録する** を押します。

> ⚠ **パスワードと Google SSO の関係**
> - **Google SSO許可** が ON なら、パスワードは空でもかまいません（Googleアカウントでログインします）。
> - SSO を許可**しない**場合は、パスワードが**必須**です。
> - どちらも空にすると「パスワードを入力するか、Google SSO許可を有効にしてください」と出ます。

#### 編集の手順

1. 一覧から対象の先生の **「編集」** を押します。
2. 変更したい項目だけ直します。
3. **保存** を押します。

変更できるもの：氏名／所属学校／権限／対象クラス／パスワード／URL情報／個別リスト／SSO許可

> 💡 **メールアドレス（教員ID）は変更できません。**
> 変わった場合は「新規登録」してから古い方を削除してください。

#### 削除の手順

1. 一覧から対象の先生の **「削除」** を押します。
2. 確認が出るので **OK** を押します。

> ⚠ **自分自身（ログイン中のアカウント）は削除しないでください。**
> 管理者が誰もいなくなると、アカウント管理を開けなくなります。
> 必ず **ADMIN を2人以上**残しておいてください。

#### 児童アカウントタブ

児童の情報（学校名・クラス・氏名）を直したいときに使います。
**「児童アカウント」** タブで児童を探し、**「編集」** を押すと、通常の児童編集画面が開きます。

> 💡 児童は端末から自動で登録されるため、通常は**手動で新規登録する必要はありません**。
> 学校名が「未設定」のままの児童を、正しい学校・クラスに直すときに使います。

### 14-3. 教員の一括インポート（CSV）

年度替わりなど、先生が大きく入れ替わるときに使います。

**「年次更新・一括インポート」** タブ → **教員一括インポート** で、次の列を持つテキストを貼り付けます。

| 列 | 必須 | 例 |
|---|---|---|
| email | **必須** | `taro@mimasaka.ed.jp` |
| password | SSO無効なら必須 | `********` |
| name | 任意 | `美作 太郎` |
| school | 任意 | `第一小学校` |
| role | 任意（既定 `TEACHER`） | `TEACHER` |
| target_class | 任意 | `5年1組` |

- **同じメールアドレスが既にあれば更新**、無ければ**新規追加**します（重複しません）。
- `role` は `ADMIN` と `TEACHER` 以外を書くと `TEACHER` になります。

---

## 15. 年次更新設定

年度が変わるとき、**卒業する児童を「卒業生」シートへ移し、端末一覧から外す**作業が必要です。
これを**年次更新**と呼びます。**ADMIN だけ**が実行できます。

```svg
<svg viewBox="0 0 760 230" xmlns="http://www.w3.org/2000/svg" font-family="sans-serif">
  <rect width="760" height="230" fill="#f8fafc" rx="12"/>
  <text x="24" y="30" fill="#334155" font-size="13" font-weight="bold">年次更新：卒業生を退避してから削除する（記録は残す）</text>
  <rect x="24" y="56" width="180" height="70" rx="9" fill="#dbeafe"/>
  <text x="114" y="84" fill="#1e40af" font-size="11" font-weight="bold" text-anchor="middle">端末一覧</text>
  <text x="114" y="104" fill="#1e40af" font-size="9" text-anchor="middle">6年生・3年生を含む</text>
  <path d="M212 91 L268 91" stroke="#94a3b8" stroke-width="2" marker-end="url(#ry)"/>
  <rect x="276" y="56" width="180" height="70" rx="9" fill="#fef3c7"/>
  <text x="366" y="84" fill="#92400e" font-size="11" font-weight="bold" text-anchor="middle">卒業生シート</text>
  <text x="366" y="104" fill="#92400e" font-size="9" text-anchor="middle">まずここへ退避（コピー）</text>
  <path d="M464 91 L520 91" stroke="#94a3b8" stroke-width="2" marker-end="url(#ry)"/>
  <rect x="528" y="56" width="200" height="70" rx="9" fill="#fee2e2"/>
  <text x="628" y="84" fill="#991b1b" font-size="11" font-weight="bold" text-anchor="middle">端末一覧から削除</text>
  <text x="628" y="104" fill="#991b1b" font-size="9" text-anchor="middle">退避できた児童だけ</text>
  <rect x="24" y="146" width="704" height="58" rx="8" fill="#ecfdf5"/>
  <text x="44" y="170" fill="#065f46" font-size="10" font-weight="bold">大事なこと</text>
  <text x="44" y="190" fill="#065f46" font-size="10">・端末一覧のヘッダー行と「教員マスタ」は消えません。</text>
  <text x="420" y="190" fill="#065f46" font-size="10">・卒業した児童は「卒業生」シートに残ります（記録）。</text>
  <defs><marker id="ry" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6" fill="#94a3b8"/></marker></defs>
</svg>
```

### 15-1. 2通りのやり方

| やり方 | いつ使うか | 特徴 |
|---|---|---|
| **今すぐ実行** | 年度末に手動で1回 | その場で卒業処理が走る |
| **予約実行型** | 新年度の切替日時を決めておく | 指定日時に**自動**で実行される |

### 15-2. 今すぐ実行する手順

1. **「アカウント管理」** を押します。
2. **「年次更新・一括インポート」** タブを選びます。
3. **🎓 年次更新（卒業生の退避・削除）** の欄で、**対象の学校**を選びます。
4. **プレビュー** で対象児童を確認します（何人消えるかが出ます）。
5. **「年次更新を実行」** を押します。
6. 確認ダイアログで **OK** を押します。

```svg
<svg viewBox="0 0 700 250" xmlns="http://www.w3.org/2000/svg" font-family="sans-serif">
  <rect width="700" height="250" fill="#e2e8f0" rx="10"/>
  <rect x="30" y="20" width="640" height="210" rx="12" fill="#ffffff" stroke="#cbd5e1"/>
  <text x="54" y="50" fill="#1e293b" font-size="13" font-weight="bold">🎓 年次更新（卒業生の退避・削除）</text>
  <text x="54" y="80" fill="#475569" font-size="10">対象の学校</text>
  <rect x="54" y="88" width="200" height="28" rx="6" fill="#f8fafc" stroke="#cbd5e1"/>
  <text x="66" y="107" fill="#334155" font-size="10">第一小学校</text>
  <rect x="270" y="88" width="110" height="28" rx="6" fill="#f1f5f9" stroke="#cbd5e1"/>
  <text x="325" y="107" fill="#475569" font-size="10" text-anchor="middle">プレビュー</text>
  <rect x="396" y="88" width="150" height="28" rx="6" fill="#b45309"/>
  <text x="471" y="107" fill="#ffffff" font-size="10" text-anchor="middle">年次更新を実行</text>
  <rect x="54" y="132" width="492" height="56" rx="8" fill="#fffbeb"/>
  <text x="68" y="154" fill="#92400e" font-size="10" font-weight="bold">対象：6年生 62名（第一小学校）</text>
  <text x="68" y="174" fill="#92400e" font-size="9">実行すると「卒業生」シートへ退避し、端末一覧から削除します。取り消せません。</text>
  <text x="30" y="248" fill="#64748b" font-size="10">実行前に必ずプレビューで人数を確認してください。</text>
</svg>
```

> ⚠ **この操作は取り消せません。**
> 実行前に必ず **プレビュー** で人数を確認してください。
> 心配なときは、先にスプレッドシートの**コピー（バックアップ）**を取ってください。

### 15-3. 予約実行型 年次更新（新年度の一括切替）

新年度の切替日時を**あらかじめ決めておく**と、その日時に自動で実行されます。

```svg
<svg viewBox="0 0 720 260" xmlns="http://www.w3.org/2000/svg" font-family="sans-serif">
  <rect width="720" height="260" fill="#f8fafc" rx="12"/>
  <text x="24" y="30" fill="#334155" font-size="13" font-weight="bold">🗓 予約実行型 年次更新：指定日時に自動で切り替わります</text>
  <rect x="24" y="52" width="200" height="60" rx="9" fill="#e0e7ff"/>
  <text x="124" y="78" fill="#3730a3" font-size="10" font-weight="bold" text-anchor="middle">① 日時を決めて保存</text>
  <text x="124" y="96" fill="#4338ca" font-size="9" text-anchor="middle">例：2027/04/01 00:00</text>
  <path d="M232 82 L284 82" stroke="#94a3b8" stroke-width="2" marker-end="url(#ry2)"/>
  <rect x="292" y="52" width="200" height="60" rx="9" fill="#fef3c7"/>
  <text x="392" y="78" fill="#92400e" font-size="10" font-weight="bold" text-anchor="middle">② 時刻トリガーが起動</text>
  <text x="392" y="96" fill="#92400e" font-size="9" text-anchor="middle">GASが自動で実行</text>
  <path d="M500 82 L552 82" stroke="#94a3b8" stroke-width="2" marker-end="url(#ry2)"/>
  <rect x="560" y="52" width="136" height="60" rx="9" fill="#dcfce7"/>
  <text x="628" y="78" fill="#166534" font-size="10" font-weight="bold" text-anchor="middle">③ 新年度へ切替</text>
  <text x="628" y="96" fill="#166534" font-size="9" text-anchor="middle">卒業生を退避</text>
  <rect x="24" y="130" width="672" height="110" rx="9" fill="#ffffff" stroke="#cbd5e1"/>
  <text x="44" y="154" fill="#1e293b" font-size="10" font-weight="bold">予約で決められること</text>
  <text x="44" y="178" fill="#334155" font-size="10">・実行日時（新年度の切替日時）</text>
  <text x="44" y="198" fill="#334155" font-size="10">・対象の学校（すべて／特定の1校）</text>
  <text x="44" y="218" fill="#334155" font-size="10">・前年度データ削除の ON／OFF（子GASの前年度行も一斉クリア）</text>
  <text x="400" y="178" fill="#64748b" font-size="9">保存後は「年次更新を予約保存済み」と表示されます。</text>
  <text x="400" y="198" fill="#64748b" font-size="9">予約を取り消したいときは「予約をキャンセル」を押します。</text>
  <defs><marker id="ry2" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6" fill="#94a3b8"/></marker></defs>
</svg>
```

**手順**

1. **「アカウント管理」** → **「年次更新・一括インポート」** タブ。
2. **🗓 予約実行型 年次更新** の欄で、**実行日時**を入れます。
3. **対象の学校**を選びます（`すべて` も選べます）。
4. **前年度データ削除** の ON／OFF を決めます。
5. **「年次更新を予約保存」** を押します。

> 💡 保存しただけでは**まだ実行されません**。指定日時になると自動で走ります。
> 管理者が管理画面を開いたときに、未実行の予約があれば自動実行される仕組みも入っています。

**予約のキャンセル**：**「予約をキャンセル」** を押します。

**今すぐ試したいとき**：予約内容を保存したうえで **「今すぐ実行」** を押します。

### 15-4. 年次更新で消えるもの・残るもの

| 対象 | どうなるか |
|---|---|
| 卒業する児童の行（端末一覧） | **削除**（卒業生シートへ退避） |
| 卒業生シート | **増える**（記録として残る） |
| 端末一覧のヘッダー行 | **残る** |
| 教員マスタ | **残る**（年度替わりは一括インポートで入れ替え） |
| スケジュール管理シート | **残る**（不要な予約は取消で無効化してください） |
| 子GASの前年度行 | 前年度データ削除がONなら**一斉クリア** |

### 15-5. 年次更新のQ&A

**Q. 実行したら児童が消えてしまった**

「卒業生」シートに退避されています。**消えてはいません**。必要なら端末一覧へ戻せます（管理者に相談してください）。

**Q. 間違えて実行してしまった**

スプレッドシートの**バージョン履歴**（ファイル → 変更履歴）から戻せます。
ただし時間が経つと戻しづらくなるので、**早めに**気づいてください。

**Q. 予約したのに実行されない**

| 確認すること | 見る場所 |
|---|---|
| 予約日時が未来か（過去だと即実行 or 無効） | 予約欄の表示 |
| 時刻トリガーが作られているか | GAS の「トリガー」画面 |
| `setupSpreadsheet` を実行済みか | GAS の実行ログ |

**Q. 子GAS側に前年度の行が残っている**

「前年度データ削除」を ON にして実行してください。
ON のとき、親から子GASへ**一斉クリア指令**が送られます。

> 💡 「1校 = 1つの独立したスプレッドシート」が前提です（R41）。
> 子GASの前年度行は、その子GAS自身が消します。親のシートは消しません。

---

## 付録A. 用語集

| 用語 | 意味 |
|---|---|
| **管理コンソール** | 先生が操作する画面。ブラウザで開く |
| **拡張機能** | 児童端末に入る小さなプログラム |
| **GAS** | Google Apps Script。クラウド上で動く中継役 |
| **ポリシー** | 端末に配る設定。JSONで書く |
| **ホワイトリスト** | 許可リスト。ここに入れたサイトだけ見られる |
| **ブラックリスト** | 規制リスト。ここに入れたサイトだけ見られない |
| **OU** | 組織部門。学校や学年ごとに設定を分ける単位 |
| **サイト監視** | 学習に関係ないサイトを検知する機能 |

## 付録B. よく使う画面の場所

| やりたいこと | どこを押すか |
|---|---|
| 児童の画面を止める | 名簿でチェック →「ロック / 解除」 |
| URLを配る | 「一斉URL配信」 |
| サイトを制限する | 「URL規制変更」 |
| 児童の画面を見る | 「画面一覧」タブ →「画面情報取得」 |
| 監視のON/OFF | ヘッダーの「監視設定」（管理者のみ） |
| 先生を登録する | ヘッダーの「アカウント管理」（管理者のみ） |
| 自分の設定 | ヘッダーの「設定」 |

---

**困ったときは**：まず[第9章](#9-困ったときは)を確認してください。
解決しない場合は、管理者（情報担当の先生）に連絡してください。
