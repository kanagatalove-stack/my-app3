# タイマー／スケジュール機能（指定時間・日時の機能制限自動ON/OFF）設計プラン

> ステータス: **設計プラン（実装前・承認待ち）**
> 対象: 美作市教育委員会 / Chromebook 児童端末管理システム（14校）
> 既存構成: Chrome MV3 拡張 + GAS（親/子 Web App）+ Google Spreadsheet
> 前提制約: 1校 = 1完全独立 Spreadsheet/GAS（R41）／拡張 v1.6.4（`default_popup` なし）

---

## 0. 確定済みの方針（ご指定）

| # | 判断軸 | 確定方針 |
|---|---|---|
| 1 | 制限の実体 | **`url_block`（URL/ドメイン規制）を基本**、拡張性として **`screen_lock`（画面ロック）** も `type` で選択可能 |
| 2 | 判定時刻の権威 | **端末（拡張）の時刻を主**とし、**GAS のサーバー時刻でオフセット補正**するハイブリッド |
| 3 | カレンダー粒度 | **月表示（Month view）のみ**。週表示は初期版では作らない |

---

## 1. 全体アーキテクチャ

```
[教員画面 index.html]
   │ ① 予約の作成/取消/手動解除（apiRequest）
   ▼
[親GAS Code.gs] ── 'スケジュール管理' シート（予約の正本）
   │ ② heartbeat 応答に「その端末に関係する予約」だけを同梱
   │    （＋ server_time_ms = 数値 epoch ミリ秒）
   ▼
[拡張 background.js]
   │ ③ オフセット補正した端末時計で「今この瞬間」を判定
   │ ④ 発動/解除をアラーム（境界時刻ぴったり）で実行
   ▼
[content.js / blocked.html] ── 既存の規制・ロック機構をそのまま利用
```

**重要原則**: 予約の**正本はシート**、**発動判定の実行主体は端末**。
端末は「次にいつ ON/OFF すべきか」を予約データから自前で計算できるため、
`ka_active=false`（教員コンソール非稼働＝定期同期停止）やオフラインでも時刻どおりに発動・解除できる。

---

## 2. データ構造

### 2-1. 新シート「スケジュール管理」

`CONFIG.SCHEDULE_SHEET_NAME = 'スケジュール管理'`

| # | 列名 | 例 | 説明 |
|---|---|---|---|
| 1 | スケジュールID | `sch_1762500000000_a1b2` | 一意ID。取消・解除のキー |
| 2 | 対象種別 | `class` / `student` | クラス一括 or 個別児童 |
| 3 | 学校名 | `第一小学校` | class の所属校（student は空でも可） |
| 4 | クラス名 | `5年1組` | 対象種別=class のとき必須 |
| 5 | 児童ID | `a@x.ed.jp,b@x.ed.jp` | 対象種別=student のとき。**カンマ区切りで複数可** |
| 6 | 制限タイプ | `url_block` / `screen_lock` | 方針(1) |
| 7 | URL規制モード | `BLACKLIST` / `WHITELIST` | type=url_block のとき有効 |
| 8 | 許可URLリスト | `nhk.or.jp,scratch.mit.edu` | 同上（WHITELIST 用） |
| 9 | 規制URLリスト | `youtube.com,game.example` | 同上（BLACKLIST 用） |
| 10 | 開始日 | `2026/11/10` | **日付部のみ**（時刻は列13） |
| 11 | 終了日 | `2026/11/14` | **日付部のみ**（時刻は列14） |
| 12 | 繰り返し | `NONE` / `DAILY` / `WEEKLY` | 下記 2-2 |
| 13 | 開始時刻 | `19:00` | HH:mm |
| 14 | 終了時刻 | `21:00` | HH:mm。**< 開始時刻なら翌日またぎ**（深夜帯ロック） |
| 15 | 曜日 | `1,2,3,4,5` | WEEKLY のとき。0=日 … 6=土 |
| 16 | 有効 | `TRUE` / `FALSE` | FALSE＝一時停止（削除せず残せる） |
| 17 | 手動解除 | `TRUE` / `FALSE` | **方針(3)のオーバーライド** |
| 18 | 手動解除日時 | `2026/11/10 19:42:03` | 監査用 |
| 19 | 作成者 | `teacher@x.ed.jp` | |
| 20 | 作成日時 | `2026/11/08 09:12:00` | |
| 21 | 更新日時 | `2026/11/10 19:42:03` | |
| 22 | 備考 | `放課後YouTube対策` | 任意メモ |

#### 日付・時刻を**列10〜14 に分割**する理由（重要）

既存システムで実際に踏んだ事故の再発防止：

- セルに `2026/11/10 19:00` を `setValue()` すると、Sheets が**日付型セルに自動変換**する。
  以後 `getValues()` は `Date` オブジェクトを返し、`String()` すると
  `"Tue Nov 10 2026 19:00:00 GMT+0900 (日本標準時)"` になる。
- この文字列を素朴に大小比較すると `"Nov" < "Oct"`（月名の辞書順）で**新しい予約が古い予約に負ける**（R42.1 と同じ罠）。
- 時刻を日付と分離すると、日付列は `yyyy/MM/dd` のみ・時刻列は `HH:mm` のみになり、
  **変換の影響を受けにくく、目視でも読みやすい**。

**三重の防御**:
1. `setupSpreadsheet()` で当該列を `setNumberFormat('@')`（書式なしテキスト）に固定する
2. パースは必ず既存の `sheetTsToMs()` を使う（`Date` インスタンス・数値・文字列すべて吸収）
3. 日付と時刻を別列にして、複合パースを不要にする

#### `sheetTsToMs()` の再利用について

`sheetTsToMs` は既に `"2026/11/02 11:19:32"` を `SHEET_TZ_OFFSET_MS = 9h` で
TZ非依存に解釈する（実行環境のタイムゾーンに左右されない）。
スケジュールでは日付と時刻が分離しているため、**結合ヘルパー**を1本追加する：

```js
/** 日付列 + 時刻列 -> epoch ms（JST基準・TZ非依存） */
function schedulePartsToMs_(dateVal, timeVal) {
  const d = String(dateVal || '').trim();
  const t = String(timeVal || '').trim() || '00:00';
  if (!d) return 0;
  return sheetTsToMs(d + ' ' + t);
}
```

### 2-2. 繰り返しの解決規則

| `繰り返し` | 意味 | 判定 |
|---|---|---|
| `NONE` | **単発**。開始日のみ有効 | 日付 == 開始日 かつ 時刻 ∈ [開始, 終了) |
| `DAILY` | 開始日〜終了日の**毎日** | 日付 ∈ [開始日, 終了日] |
| `WEEKLY` | 開始日〜終了日のうち**指定曜日のみ** | 上記 かつ 曜日 ∈ 曜日列 |

- 「今日18:00〜20:00」 → `NONE` / 開始日=今日 / 18:00 / 20:00
- 「来週月〜金 19:00〜21:00」 → `WEEKLY` / 開始日=来週月 / 終了日=来週金 / `1,2,3,4,5`
- 「長期休業中ずっと 8:00〜17:00」 → `DAILY` / 開始日〜終了日
- 深夜帯（22:00〜翌6:00） → 終了時刻 < 開始時刻 で表現（**翌日またぎ**）

### 2-3. 端末へ配る JSON（heartbeat 応答に同梱）

**全予約を配らない**のが要点。その端末に関係し、かつ「今」または「近い将来」のものだけを送る。
（30人×全予約を毎1.5秒送ると通信量とJSONパースで重くなる＝R43 で学んだ教訓）

```jsonc
{
  "success": true,
  "student_id": "a@x.ed.jp",
  "server_time": "2026/11/10 19:02:11",      // 既存（JST文字列・表示用）
  "server_time_ms": 1762764131000,            // ★新規（数値 epoch ms・オフセット補正用）
  "schedules": {
    "active": [                               // 現在発動中
      {
        "id": "sch_1762500000000_a1b2",
        "type": "url_block",
        "filter_mode": "BLACKLIST",
        "whitelist": [],
        "blacklist": ["youtube.com", "game.example"],
        "start_ms": 1762764000000,
        "end_ms": 1762771200000,
        "start_jst": "2026/11/10 19:00",
        "end_jst":   "2026/11/10 21:00"
      }
    ],
    "upcoming": [                             // 次の1件だけ（端末が境界を予約するため）
      {
        "id": "sch_1762500000000_c3d4",
        "type": "screen_lock",
        "start_ms": 1762812000000,
        "end_ms": 1762815600000,
        "start_jst": "2026/11/11 08:00",
        "end_jst":   "2026/11/11 09:00"
      }
    ],
    "overridden_ids": ["sch_1762499999999_x9"] // 手動解除済み（端末側で除外）
  }
}
```

- `active` の上限 5 件、`upcoming` は 1 件のみ（超過分は次回同期で送る）
- `upcoming` を送るのは、**境界時刻ちょうどのアラーム**を端末が張れるようにするため
  （1分間隔のポーリングだけだと最大60秒のズレが出る）

---

## 3. UI 設計（index.html）

### 3-1. 配置

既存のビュー切替（`switchMainView('devices'|'screens')`）に **3つ目のタブ**を追加する。

```html
<button id="tabScheduleViewBtn" onclick="switchMainView('schedule')">…スケジュール…</button>
<div id="scheduleView" class="space-y-5 hidden"> … </div>
```

モーダルではなく**タブ**にする理由: 月カレンダーは縦に長く、モーダルだと窮屈。
既存のモーダル群（`#filterModal` 等）は「1操作で完結」するものなので、
一覧＋カレンダー＋新規作成を1画面で扱うタブの方が運用に合う。

### 3-2. 画面構成

```
┌─ スケジュール（タイマー） ────────────────────────────────┐
│ [+ 新規予約]   [今すぐ全解除]        対象: 現在表示中の児童 │
├──────────────────────────────────────────────────────────┤
│  ┌── 月カレンダー ──────────┐  ┌── 選択日の予約一覧 ──────┐│
│  │ ‹ 2026年11月 ›           │  │ 19:00-21:00 YouTube規制  ││
│  │ 日 月 火 水 木 金 土      │  │ 対象: 5年1組(30台)       ││
│  │        1  2  3  4  5  6   │  │ 状態: 発動中 [解除][取消]││
│  │  7  8  9 10 11 12 13     │  │──────────────────────────││
│  │ 14 15 16 17 18 19 20     │  │ 08:00-09:00 画面ロック   ││
│  │ 21 22 23 24 25 26 27     │  │ 対象: 児童3名            ││
│  │ 28 29 30         ● ●     │  │ 状態: 予定 [取消]        ││
│  └──────────────────────────┘  └──────────────────────────┘│
└──────────────────────────────────────────────────────────┘
```

- 予約のある日には**ドット（●）**を表示（件数が多い日は色を変える）
- 日をクリック → 右ペインがその日の予約一覧に切り替わる
- 一覧の各行に **「解除」（一時的に今すぐ止める）** と **「取消」（予約自体を削除）** を分けて置く
  - 解除 = 手動解除フラグ（列17）。予約は残る
  - 取消 = 行を論理削除（`有効=FALSE`、または物理削除）

### 3-3. カレンダーの実装方針

**外部ライブラリを使わない**（自前実装）。

理由:
- GAS HtmlService は iframe サンドボックスで、外部CDN依存は読み込み失敗・遅延のリスク
- 月表示のみなら 7×6 グリッドの素朴な実装で足りる（`new Date(y, m, 1).getDay()` で先頭空白を決めるだけ）
- 依存ゼロなら**オフラインでも表示できる**

```js
/** 月グリッドを組み立てる（日曜始まり） */
function buildMonthGrid(year, month /* 0-11 */) {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const cells = [];
  for (let i = 0; i < first.getDay(); i++) cells.push(null);      // 先頭の空白
  for (let d = 1; d <= last.getDate(); d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);                 // 末尾の空白
  while (cells.length < 42) cells.push(null);                      // 6週で固定（高さの揺れ防止）
  return cells;
}
```

### 3-4. 新規予約モーダル（`#scheduleModal`）

既存の `closeModal()` / `#…Modal` の作法に合わせる。

| 項目 | コントロール |
|---|---|
| 対象 | ラジオ `クラス一括` / `個別児童` |
| 　└ クラス一括 | 既存のクラスチップ（`renderClassChips` 相当）を再利用 |
| 　└ 個別児童 | チェックボックス複数選択（検索ボックス付き） |
| 制限タイプ | ラジオ `URL規制` / `画面ロック` |
| 　└ URL規制 | モード選択（BLACKLIST/WHITELIST）＋URL入力（既存 `addFilterAddress()` のUIを流用） |
| 期間 | 開始日 / 終了日（カレンダーのクリックで自動入力可） |
| 時間帯 | 開始時刻 / 終了時刻（`<input type="time">`） |
| 繰り返し | `なし` / `毎日` / `毎週`（毎週なら曜日チェックボックス） |
| 備考 | テキスト |
| プレビュー | 「5年1組 30台 / 11/10〜11/14 毎日 19:00〜21:00」を動的表示 |

`<input type="time">` は Chromebook の Chrome でネイティブ対応しており、
キーボードでも「1900」と打てば 19:00 になるため、児童端末と同様の操作感で入力できる。

---

## 4. 端末（background.js）の判定・適用ロジック

### 4-1. 時計オフセットの算出（方針2）

```js
// 状態（chrome.storage.local）
//   schedule_offset_ms : GASとの時計差分（サーバー - 端末）
//   schedule_offset_at : 最終更新時刻（端末時計）
//   schedule_cache     : 直近の schedules（SW休止を跨いで保持）
//   schedule_state     : 現在の適用状態（active_ids / effective）

const OFFSET_SMOOTH = 0.3;      // EMA係数。1回の遅延スパイクで飛ばないようにする
const OFFSET_MAX_ABS = 300000;  // 5分超は異常値として捨てる

function updateClockOffset(serverMs, sentMs, recvMs, curOffset) {
  if (!serverMs || !sentMs || !recvMs) return curOffset || 0;
  const mid = (sentMs + recvMs) / 2;          // RTT の中点＝サーバー時刻の写像先
  const sample = serverMs - mid;
  if (Math.abs(sample) > OFFSET_MAX_ABS) return curOffset || 0;
  if (typeof curOffset !== 'number' || !isFinite(curOffset)) return sample;
  return curOffset + (sample - curOffset) * OFFSET_SMOOTH;
}

/** 補正済みの「今」を JST の epoch ms として返す */
function correctedNowMs(offset) {
  return Date.now() + (offset || 0);
}
```

- `sentMs` は fetch 直前に `Date.now()`、`recvMs` は応答受信直後に `Date.now()` を取る。
- **RTT 中点**を使うのは NTP と同じ考え方。片道遅延を打ち消せる。
- `server_time_ms` は **GAS が `new Date().getTime()` を返すだけ**（既存 `nowMs` 変数がそのまま使える）。
  ※ 既存の `server_time` は JST 文字列なのでオフセット計算には使えない。**数値列を新設する**。

### 4-2. 発動判定（純粋関数として切り出す）

テスト容易性のため、**副作用なしの純粋関数**にする（既存 `screenTsToMs` で実績のある方針）。

```js
/**
 * ある予約が「指定時刻に発動中か」を判定する（純粋関数）。
 * @param {object} s  予約
 * @param {number} nowMs 補正済み現在時刻（epoch ms）
 * @returns {boolean}
 */
function isScheduleActiveAt(s, nowMs) {
  if (!s || !s.start_ms || !s.end_ms) return false;
  if (nowMs >= s.start_ms && nowMs < s.end_ms) return true;   // 単純な窓
  return false;
}
```

GAS 側で**実際の各発動区間を ms に展開**してから端末へ送る設計にする。
こうすると端末側は「区間内か？」の比較だけで済み、曜日計算・繰り返し解決を
**端末ごとに毎回やらなくてよい**（電池・CPU の節約、ロジックの二重実装回避）。

GAS 側展開:

```js
/** 予約 -> 発動区間の配列 [{start_ms, end_ms}]（上限20区間） */
function expandScheduleWindows_(sched, nowMs, horizonMs) {
  const out = [];
  const HORIZON = horizonMs || 14 * 24 * 3600 * 1000;   // 14日先まで
  const dayMs = 24 * 3600 * 1000;
  const fromMs = Math.max(sched.dateFromMs, nowMs - dayMs);
  const toMs   = Math.min(sched.dateToMs, nowMs + HORIZON);
  for (let d = fromMs; d <= toMs && out.length < 20; d += dayMs) {
    const dow = new Date(d + SHEET_TZ_OFFSET_MS).getUTCDay();
    if (sched.repeat === 'WEEKLY' && sched.weekdays.indexOf(dow) < 0) continue;
    const start = d + sched.startTimeOfDayMs;
    let end = d + sched.endTimeOfDayMs;
    if (end <= start) end += dayMs;            // 翌日またぎ
    out.push({ start_ms: start, end_ms: end });
  }
  return out;
}
```

### 4-3. 適用（既存機構の再利用）

新規に規制エンジンを作らない。既存の副作用関数を呼ぶだけにする。

```js
async function applySchedules(schedPayload, oldStorage) {
  const offset = await getClockOffset();
  const now = correctedNowMs(offset);

  // 手動解除されたIDは除外
  const overridden = new Set((schedPayload.overridden_ids || []).map(String));

  let lockOn = false;
  let filterMode = 'OFF';
  let white = [], black = [];
  const activeIds = [];

  for (const s of (schedPayload.active || [])) {
    if (overridden.has(String(s.id))) continue;
    if (!isScheduleActiveAt(s, now)) continue;
    activeIds.push(String(s.id));
    if (s.type === 'screen_lock') {
      lockOn = true;
    } else if (s.type === 'url_block') {
      // 制限は「厳しい方が勝つ」。WHITELIST は BLACKLIST より強い
      if (s.filter_mode === 'WHITELIST') {
        filterMode = 'WHITELIST';
        white = white.concat(s.whitelist || []);
      } else if (filterMode !== 'WHITELIST') {
        filterMode = 'BLACKLIST';
        black = black.concat(s.blacklist || []);
      }
    }
  }

  // 端末の素のポリシーと合成（スケジュールは「締める」方向にのみ作用）
  const data = await chrome.storage.local.get(['screen_lock', 'filter_mode', 'whitelist_urls', 'blacklist_urls']);
  const effLock = Boolean(data.screen_lock) || lockOn;
  let effMode = data.filter_mode || 'OFF';
  let effWhite = data.whitelist_urls || [];
  let effBlack = data.blacklist_urls || [];
  if (filterMode === 'WHITELIST') { effMode = 'WHITELIST'; effWhite = white; }
  else if (filterMode === 'BLACKLIST' && effMode !== 'WHITELIST') { effMode = 'BLACKLIST'; effBlack = black; }

  await chrome.storage.local.set({
    schedule_active_ids: activeIds,
    schedule_effective: { screen_lock: effLock, filter_mode: effMode }
  });

  // ★既存機構をそのまま使う
  notifyAllTabsLockState(effLock);
  checkAllTabsFiltering(effMode, effWhite, effBlack);
  if (!effLock) releaseLockedTabs();
}
```

**合成規則（重要）**: スケジュールは**制限を強める方向にのみ**働く。
素のポリシーが `OFF` でも予約で `BLACKLIST` になる。逆に予約が `OFF` でも素のポリシーは維持。
これにより「学校の常時規制」と「放課後だけ追加規制」が自然に共存する。

### 4-4. 境界時刻ぴったりの発動（アラーム設計）

```
scheduleTick   : periodInMinutes = 1      … 保険（最大60秒の遅れを許容）
scheduleEdge   : when = 次の境界時刻       … 本命（秒単位でぴったり）
```

MV3 の service worker は休止するため、`setTimeout` は当てにできない。
`chrome.alarms` は休止から復帰させる唯一の確実な手段（既存 `syncAlarm` と同じ手法）。

```js
async function scheduleEdgeAlarm(schedPayload, offset) {
  const now = correctedNowMs(offset);
  let nextEdge = 0;
  const all = (schedPayload.active || []).concat(schedPayload.upcoming || []);
  for (const s of all) {
    for (const t of [Number(s.start_ms), Number(s.end_ms)]) {
      if (t > now && (!nextEdge || t < nextEdge)) nextEdge = t;
    }
  }
  try { await chrome.alarms.clear('scheduleEdge'); } catch (e) {}
  if (!nextEdge) return;
  const delayMs = nextEdge - now + 1000;   // 1秒の余裕（時計の微振動対策）
  if (delayMs < 1000) return;
  chrome.alarms.create('scheduleEdge', { when: Date.now() + delayMs });
}
```

`onAlarm` で `scheduleEdge` を受けたら、
`chrome.storage.local` に保持した `schedule_cache` で再判定 → 適用 → 次の境界を再予約する
（GAS へ問い合わせない＝オフラインでも動く）。

---

## 5. 手動オーバーライド（方針3）

### 5-1. 2種類を明確に分ける

| 操作 | 意味 | シート操作 | 端末の挙動 |
|---|---|---|---|
| **解除** | 今回の予約を**今だけ**止める | 列17 `手動解除=TRUE` ＋ 列18 日時 | `overridden_ids` で除外。**予約は残る** |
| **取消** | 予約そのものを**消す** | 列16 `有効=FALSE`（論理削除） | 配信対象から外れる |

「解除したのに明日また発動する」のが正しい（毎日の予約なら翌日は効くべき）。
「もう二度と要らない」なら取消。UI でもこの2つを別ボタンにし、文言で区別する。

### 5-2. オフライン時の限界（明示）

手動解除は教員画面 → GAS → シート → 端末の同期で伝わるため、
**端末がオフラインの間は解除が届かない**。この場合、
端末側の `end_ms` 到達で自動解除される（最大で予約終了時刻まで）。
これは仕様上の限界として運用マニュアルに明記する。

---

## 6. 段階的な実装・テストステップ

各フェーズで `bash tests/run_all.sh` が **27/27 を維持**することを受け入れ条件とする。

### フェーズ 1: データ層（GAS のみ・端末影響ゼロ）

- `CONFIG.SCHEDULE_SHEET_NAME` / `SCHEDULE_COLUMNS` 追加
- `setupSpreadsheet()` にシート生成＋日付列をテキスト書式に固定
- `ensureScheduleHeaders()`（既存 `ensureDeviceHeaders` と同じ後方互換パターン）
- `schedulePartsToMs_()` / `expandScheduleWindows_()` / `getActiveSchedulesFor_()`
- **テスト**: `tests/schedule_data.js` 新規 — 繰り返し3種・翌日またぎ・曜日解決・日付型セル耐性

### フェーズ 2: GAS API（CRUD。まだ端末は動かない）

- doPost 追加: `save_schedule` / `list_schedules` / `cancel_schedule` / `override_schedule`
- `get_all` の各端末に `schedule_active` フラグを追加（端末一覧にバッジを出すため）
- **認証**: 予約の作成・解除は**教員トークン必須**（`requireTeacher_()` 系）。
  児童端末から予約を書き換えられてはいけない（重要）
- **テスト**: `tests/schedule_api.js` 新規 — 権限（担任スコープ外は不可）・取消/解除の区別

### フェーズ 3: 端末判定エンジン（★中核。UI より先に実装）

- `server_time_ms` を heartbeat 応答に追加
- `updateClockOffset()` / `correctedNowMs()` / `isScheduleActiveAt()` / `applySchedules()`
- `scheduleTick` / `scheduleEdge` アラーム
- **テスト**: `tests/schedule_engine.js` 新規 —
  オフセット算出（RTT中点・異常値棄却）、境界の ON/OFF、
  `ka_active=false` でも発動する、手動解除IDの除外、素のポリシーとの合成（締める方向のみ）

### フェーズ 4: 教員画面 UI

- `switchMainView('schedule')` ＋ `#scheduleView`
- `buildMonthGrid()` / `renderScheduleCalendar()` / `renderScheduleList()`
- `#scheduleModal`（対象・タイプ・期間・時刻・繰り返し・プレビュー）
- 手動解除／取消ボタン
- **テスト**: `tests/schedule_ui.js` 新規（既存 `fe14`/`fe15` と同じ静的検証方式）

### フェーズ 5: 子GAS 分散への対応

- 予約を子GASへ伝達（既存 `shardPropagatePolicy` のパッチに `schedules` を追加）
- 子の `buildHeartbeatResponse` も `schedules` を返すよう統一
- **テスト**: `tests/schedule_shard.js` 新規

### フェーズ 6: 仕上げ

- `docs/manual/` に運用手順を追記
- `dist/` 再生成（`scripts/package_extension.sh`）
- 実機検証（オフライン発動・境界時刻・手動解除）

---

## 7. ファイル変更範囲（見積り）

| ファイル | 変更 | 規模感 |
|---|---|---|
| `gas/Code.gs` | CONFIG 2件追加 / `setupSpreadsheet` 拡張 / ヘルパー4本 / doPost 4ルート / `buildHeartbeatResponse` に `schedules`+`server_time_ms` / `getAllDevices` にフラグ | 中〜大（+400〜600行） |
| `gas/index.html` | タブ追加 / `#scheduleView` / `#scheduleModal` / カレンダー4関数 / API 4本 / スタイル | 中（+500〜700行） |
| `extension/background.js` | オフセット3関数 / 判定2関数 / 適用1関数 / アラーム2種 / `onAlarm` 分岐 / storage キー4つ | 中（+250〜350行） |
| `tests/schedule_data.js` | 新規 | 新規 |
| `tests/schedule_api.js` | 新規 | 新規 |
| `tests/schedule_engine.js` | 新規 | 新規 |
| `tests/schedule_ui.js` | 新規 | 新規 |
| `tests/run_all.sh` | 上記4本を追加（27 → 31 スイート） | 小 |
| `docs/manual/*` | 運用手順 | 小 |

**`extension/manifest.json` は変更不要**（`alarms` 権限は既に取得済み）。版数は v1.6.4 のまま据え置き。

---

## 8. 設計上のリスクと対策

| リスク | 対策 |
|---|---|
| 端末の時計が大きく狂い、境界をまたいで誤発動 | オフセットを EMA(0.3) で平滑化し、5分超は棄却。同期のたびに補正 |
| service worker 休止でタイマーが止まる | `chrome.alarms` のみに依存（`setTimeout` を使わない）。既存 `syncAlarm` と同じ手法 |
| 予約 JSON の肥大化で同期が重くなる | `active` 5件・`upcoming` 1件に制限。URL リストは発動中のみ同梱 |
| `ka_active=false` で同期が止まり解除されない | **端末が `end_ms` を自前で判定**して解除するため、同期不要 |
| 児童が端末時計を戻して制限を回避 | オフセット補正でサーバー時刻基準に戻す。大幅な巻き戻しは再同期で矯正 |
| 日付型セル変換で新旧比較が壊れる | 日付/時刻を分離 ＋ `setNumberFormat('@')` ＋ `sheetTsToMs` 経由のパース |
| 子GAS に予約が無く発動しない | フェーズ5で伝達経路を実装。それまで子担当端末は未対応と明示 |
| 教員が誰でも全クラスの予約を作れる | 既存の `scopeStudentIdsForTeacher` で担任スコープを強制 |

---

## 9. 承認いただきたい点

1. 上記 1〜7 の設計で実装に進んでよいか
2. **フェーズ3（端末判定エンジン）を UI より先**に実装する順序でよいか
   （UI が無くても GAS API 経由で予約を入れれば実機検証できるため、こちらを推奨）
3. 深夜帯（翌日またぎ）を初期版から対応するか、フェーズ6 へ回すか
4. 予約の保持期間（終了した予約を自動削除するか、監査用に残すか）
