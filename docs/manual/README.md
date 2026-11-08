# Chromebook 児童端末管理システム 操作説明書

**美作市教育委員会 ／ 14小中学校**

はじめてこのシステムを使う先生向けの説明書です。
「このボタンを押すと、児童の画面はこうなる」という**操作例**を中心にまとめました。

> **この説明書の読み方**
> - **前半（第1〜5章）** … 先生が毎日の授業で使う操作。まずはここだけ読めば使えます。
> - **後半（第6〜9章）** … 管理者（情報担当の先生）が最初に1回だけ行う設定。

---

## 目次

**前半：先生の日常操作**

1. [このシステムでできること](#1-このシステムでできること)
2. [ログインする](#2-ログインする)
3. [画面の見方](#3-画面の見方)
4. [操作例：児童の画面をロックする](#4-操作例児童の画面をロックする)
5. [操作例：URLを配信する・規制する](#5-操作例urlを配信する規制する)
6. [操作例：児童の画面を見る](#6-操作例児童の画面を見る)
7. [操作例：注意マーク（AI監視）](#7-操作例注意マークai監視)
8. [困ったときは](#8-困ったときは)

**後半：管理者の初期設定**

9. [システムの全体像](#9-システムの全体像)
10. [初期設定の手順](#10-初期設定の手順)
11. [AI監視の設定](#11-ai監視の設定)

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
| **AI監視** | 学習に関係ないサイトを開くと名簿に「⚠ 注意」が出る | 見回りなしで気づきたい |

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
| **⚠ 注意** | AI監視が学習に関係ないサイトを検知した印（第7章） |

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
> 変わるまで少し待っても変わらない場合は、[第8章](#8-困ったときは)を確認してください。

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

## 7. 操作例：注意マーク（AI監視）

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
  <text x="20" y="26" fill="#1e293b" font-size="12" font-weight="bold">AI監視の判定の流れ</text>
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

> ⚠ **先生の管理画面からON/OFFできます。** 監視設定は**管理者のみ**が変更できます（[第11章](#11-ai監視の設定)）。
> OFFにすると、マークは全端末で即座に消えます。

---

## 8. 困ったときは

| 症状 | 原因と対処 |
|---|---|
| **操作しても児童の画面が変わらない** | 管理画面を閉じていませんか？ 開いたままにしてください。児童端末は管理画面が開いている間だけ通信します |
| | 児童の端末がスリープ／電源OFFの可能性。「接続状態」がオフラインなら電源を確認してください |
| **特定の児童だけ反映されない** | その児童がGoogleアカウントでログインしているか確認してください。ログインしていないと一覧に出ません |
| **「取得待ち」のまま画面が出ない** | 児童がオフラインか、管理画面を閉じています。オンラインにして、管理画面を開いたまま再度取得してください |
| **児童が一覧に出てこない** | 端末の電源が入り、Googleアカウントでログインしていれば数秒で出ます。それでも出ない場合は管理者へ |
| **他校の児童が表示されない** | 仕様です。一般の先生は自校の児童のみ表示・操作できます（安全のため） |
| **マークが出るはずのサイトで出ない** | AI監視がOFFになっている可能性があります。管理者に確認してください |
| **マークが消えない** | 児童がそのサイトを閉じても、履歴として残ります（最後に検知した記録）。消したい場合は管理者へ |

### それでも解決しないとき
管理者（情報担当の先生）に、次の3つを伝えてください。

1. どの操作をしたか（例：「一斉URL配信を押した」）
2. 画面にどんなメッセージが出たか
3. 児童の端末がオンラインだったか

---

# 後半：管理者の初期設定

ここからは、**情報担当の先生（管理者）** が最初に1回だけ行う作業です。
日々の操作だけなら、前半を読めば十分です。

---

## 9. システムの全体像

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
  <text x="280" y="146" fill="#64748b" font-size="8">・AI監視の判定をする</text>

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

### データの置き場所（スプレッドシートの3シート）

| シート名 | 何が入るか |
|---|---|
| **端末一覧** | 児童ID・学校名・氏名・クラス・ロック状態・URL規制・現在のURL・注意マーク など |
| **教員マスタ** | 先生のメールアドレス・パスワード・所属学校・権限・対象クラス |
| **画面情報** | 「画面情報取得」で撮った写真（1児童=1行で上書き） |

---

## 10. 初期設定の手順

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
   - これで3つのシート（端末一覧／教員マスタ／画面情報）が自動で作られます。
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

バージョン **1.6.3** 以降で解決済みです。それでも「未設定」になる場合は次を確認してください。

| 確認すること | 対処 |
|---|---|
| 拡張機能が 1.6.3 未満 | ストアから 1.6.3 を配布し直す |
| GAS を再デプロイしていない | 鉛筆アイコンから新バージョンでデプロイ |
| ポリシーのキー名が違う | `school_name` になっているか確認 |
| 学校名の綴りが違う | `CONFIG.SCHOOL_LIST` と完全に一致させる（「英田小」などの略称は不可） |

> 💡 1.6.3 は「**端末が学校名を送る**」＋「**GASが受け取る**」の**両方**が揃って初めて動きます。
> 片方だけでは動きません。

---

## 11. AI監視の設定

**管理者のみ**が変更できます。

### 設定場所

管理コンソールのヘッダーにある **赤い「監視設定」ボタン** を押します。

```svg
<svg viewBox="0 0 660 300" xmlns="http://www.w3.org/2000/svg" font-family="sans-serif">
  <rect width="660" height="300" fill="#e2e8f0" rx="12"/>
  <rect x="40" y="16" width="580" height="270" rx="10" fill="#fff" stroke="#cbd5e1"/>
  <text x="60" y="42" fill="#1e293b" font-size="13" font-weight="bold">AI監視設定（システム全体）</text>
  <text x="596" y="42" fill="#94a3b8" font-size="12" text-anchor="end">✕</text>
  <line x1="40" y1="52" x2="620" y2="52" stroke="#e2e8f0"/>

  <rect x="60" y="64" width="540" height="56" rx="7" fill="#fff1f2" stroke="#fda4af"/>
  <rect x="74" y="80" width="16" height="16" rx="3" fill="#e11d48"/>
  <text x="82" y="92" fill="#fff" font-size="11" text-anchor="middle">✓</text>
  <text x="100" y="86" fill="#881337" font-size="10" font-weight="bold">AI監視を有効にする（システム全体）</text>
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
| **AI監視を有効にする** | システム全体のON/OFF。**初期値はOFF** |
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
| **AI監視** | 学習に関係ないサイトを検知する機能 |

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

**困ったときは**：まず[第8章](#8-困ったときは)を確認してください。
解決しない場合は、管理者（情報担当の先生）に連絡してください。
