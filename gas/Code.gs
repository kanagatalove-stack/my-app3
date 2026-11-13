/**
 * Chromebook 児童端末管理システム - バックエンド (Google Apps Script)
 * スプレッドシートID: 1_zSGoaoyUqMNHY0rxuITIk25yAHDT7qrZwIj_024fPs
 */

// 設定定数
const CONFIG = {
  SPREADSHEET_ID: '1_zSGoaoyUqMNHY0rxuITIk25yAHDT7qrZwIj_024fPs',
  DEVICE_SHEET_NAME: '端末一覧',
  TEACHER_SHEET_NAME: '教員マスタ',
  ARCHIVE_SHEET_NAME: '卒業生', // 年次更新で卒業した児童のアーカイブ用
  // 画面一覧（スクリーンショット）用シート。全児童の画像をこの1シートで管理する
  // （1児童=1行。児童IDで上書き更新するため行は増え続けない）。
  // ※ この定数が欠けると getTargetSheet(undefined) が毎回 insertSheet して
  //    空シートが増え続けるため、必ず定義しておくこと。
  SCREENSHOT_SHEET_NAME: '画面情報',

  // スケジュール管理（タイマー）用シート。
  //   放課後・休日・家庭持ち帰り端末で「指定した時間帯だけ」URL規制/画面ロックを
  //   自動で ON にし、時間が来たら自動で解除するための予約を 1 行 1 件で保持する。
  //   ※ この定数が欠けると getTargetSheet(undefined) が毎回 insertSheet して
  //      空シートが増え続けるため、必ず定義しておくこと。
  SCHEDULE_SHEET_NAME: 'スケジュール管理',
  
  // 美作市 14校
  SCHOOL_LIST: [
    '英田小学校',
    '大原小学校',
    '江見小学校',
    '勝田小学校',
    '勝田東小学校',
    '第一小学校',
    '北小学校',
    '土居小学校',
    '英田中学校',
    '大原中学校',
    '作東中学校',
    '勝田中学校',
    '美作中学校',
    '樸学園'
  ],

  // ==========================================================
  // 子GAS分散（SHARD_MODE / ハブ＆スポーク）
  //   1校240台 × 1.5秒周期 ≒ 160 req/秒 を 1 実行で受けると、GAS の
  //   「同時実行 30/ユーザー」に達する。クラス単位で子GASへ分散して回避する。
  //
  //   SHARD_MODE       … このスクリプトが「親（ハブ）」として振る舞う
  //   SHARD_CHILD_MODE … このスクリプトが「子（スポーク）」として振る舞う
  //   両方 false（既定）… 従来の 1校1GAS と完全に同一動作（後方互換）
  //
  //   ※ 子GAS側のコードもこのファイル1つ。SHARD_CHILD_MODE=true にするだけ。
  //   ※ 子GASはハートビートのみ担当し、ロック/規制/配信の正は親に置く。
  //     親コンソールは親の端末一覧だけを見るため、教員は常に1画面のまま。
  // ==========================================================
  SHARD_MODE: false,
  SHARD_CHILD_MODE: false,
  // 子へポリシーを伝達したときの通信タイムアウト（ミリ秒）
  SHARD_FETCH_TIMEOUT_MS: 8000,
  // スクリプトプロパティが未設定・不正なときに使う既定値（フォールバック）。
  // ※ 通常運用ではスクリプトプロパティ側で設定する。ここは「最後の砦」。
  //   SHARD_MAP の空キー "" は「クラスが特定できない端末の既定ルーティング先」。
  SHARD_MAP: {},
  SHARD_DEFAULT_URL: '',

  // 端末一覧 列定義
  DEVICE_COLUMNS: [
    '児童ID',
    '学校名',
    '氏名',
    'クラス',
    '画面ロック',
    'URL規制モード',
    '許可URLリスト',
    '規制URLリスト',
    '一斉表示URL',
    '一斉表示実行ID',
    '現在開いているURL',
    '最終同期日時',
    '備考',
    // 画面一覧（押下時のみ取得）用の制御列。
    // 教員が「画面情報取得」を押すと要求日時が入り、児童端末がそれを検知して
    // スクリーンショットを撮影・アップロードする（結果は 画面情報 シートに保存）。
    '画面情報要求日時',
    '画面情報更新日時',
    // AI監視（学習に関係のないサイトの検知）用の列。
    // システム全体のON/OFF が管理者により切り替えられる。OFF のときは
    // getAllDevices 側で「要注意=false」に伏せて返すため、管理画面の注意マークは消える。
    // ※ 既存シートには ensureDeviceHeaders が末尾へ自動追加する（後方互換）。
    '要注意',
    '注意理由',
    '要注意URL',
    '注意検知日時',
    // 【R43.3】画面キャプチャの状態（撮影不可の通知先）。
    //   ログイン状態の新しいタブは chrome://newtab/ という特権ページになり、
    //   Chrome の仕様上 captureVisibleTab では撮影できない。
    //   端末は「撮れなかった」事実をここへ記録し、教員画面は
    //   「更新待ち」を解除して「保護されたページを表示中」と表示する。
    //   形式: "capture_blocked:<理由>|YYYY/MM/DD HH:mm:ss"（日時はシート時計）
    //   ※ 末尾に追加する（既存シートは ensureDeviceHeaders が自動追加＝後方互換）。
    '画面情報状態'
  ],

  // 画面情報 シート列定義（スクリーンショット本体を保持）
  SCREENSHOT_COLUMNS: [
    '児童ID',
    '更新日時',
    'MIMEタイプ',
    '画像データ(Base64)'
  ],

  // 教員マスタ 列定義
  TEACHER_COLUMNS: [
    '教員ID(メールアドレス)',
    'パスワード',
    '氏名',
    '所属学校',
    '権限',
    '対象クラス',
    '登録URL情報',
    '個別ホワイトリスト',
    '個別ブラックリスト',
    '最終ログイン日時'
  ],

  // ==========================================================
  // スケジュール管理 列定義（22列）
  //
  //   【設計意図】日付と時刻を別列に分ける。
  //     端末一覧では「2026/11/05 20:39:25」形式の文字列をシートに書いているが、
  //     getValues() が「日付型セル」を返すと
  //       "Tue Nov 10 2026 19:00:00 GMT+0900 (日本標準時)"
  //     のような英語表記になり、文字列比較では月名順（Nov < Oct）で
  //     並んでしまい新しいデータが負ける。ここでは
  //       ① 列を数値書式 '@'（書式なしテキスト）に固定
  //       ② 日付と時刻を別列に分割
  //       ③ 読むときは sheetTsToMs() で JST 決め打ちに変換
  //     の三重で防御する。
  //
  //   有効/手動解除 は R38 の教訓（Boolean("false") === true）に従い
  //   必ず parseBoolean() で判定する。
  // ==========================================================
  SCHEDULE_COLUMNS: [
    'スケジュールID',        // 1  sch_<epochms>_<rand>
    '対象種別',              // 2  class / student
    '学校名',                // 3
    'クラス名',              // 4  対称種別が class のとき
    '児童ID',                // 5  カンマ区切り（複数可）
    '制限タイプ',            // 6  url_block / screen_lock
    'URL規制モード',         // 7  BLACKLIST / WHITELIST（url_block のみ）
    '許可URLリスト',         // 8
    '規制URLリスト',         // 9
    '開始日',                // 10 yyyy/MM/dd（日付のみ）
    '終了日',                // 11 yyyy/MM/dd（日付のみ）
    '繰り返し',              // 12 NONE / DAILY / WEEKLY
    '開始時刻',              // 13 HH:mm
    '終了時刻',              // 14 HH:mm（開始より前なら翌日跨ぎ）
    '曜日',                  // 15 WEEKLY のみ "1,2,3,4,5"（0=日 … 6=土）
    '有効',                  // 16 TRUE / FALSE（取消＝FALSE）
    '手動解除',              // 17 TRUE / FALSE（今回だけ解除）
    '手動解除日時',          // 18
    '作成者',                // 19 教員メール
    '作成日時',              // 20
    '更新日時',              // 21
    '備考'                   // 22
  ],

  // スケジュールの「監査ログ」方針:
  //   終了した予約は削除しない（自動削除もしない）。教員が「解除」「取消」を
  //   押した履歴（列17/18/16）もそのまま残す。シートはそのまま監査証跡になる。
  SCHEDULE_HORIZON_DAYS: 14,     // 端末へ先出しする将来分の日数
  SCHEDULE_MAX_ACTIVE: 5,        // 1端末あたり同時に配る有効スケジュール上限
  SCHEDULE_MAX_WINDOWS: 20       // 1予約あたり展開する時間窓の上限
};

/**
 * シートオブジェクトを取得
 */
// ==================== 実行内キャッシュ（R31） ====================
// 【なぜ必要か / 実測】
//   端末一覧は 3〜4行 × 16列しかないのに api_bulkLock が 6〜7 秒かかっていた。
//   原因はデータ量ではなく「往復回数」。1回のロック操作で
//     openById 4回 / getSheetByName 4回 / ヘッダー読み 4回 / ensure*Headers 3回
//   が走っていた（実測: scope+lock だけで 11 往復）。
//   GAS は1実行が独立プロセスなので、この器は「その実行の中だけ」で生きる。
//   ＝ 別の教員・別の端末の操作に古い値を配ることはない。
const __execSheetCache = { sheets: {}, headerMaps: [], ensured: [] };

/** 実行内キャッシュからシートを取り出す（同一実行・同一シート名のみ）。 */
function __execSheetGet(key) {
  try {
    const v = __execSheetCache.sheets[key];
    return v || null;
  } catch (e) { return null; }
}

/** 実行内キャッシュへシートを保存する。 */
function __execSheetPut(key, sheet) {
  try { __execSheetCache.sheets[key] = sheet; } catch (e) {}
}

/** 実行内キャッシュ: ヘッダーマップ（シート実体の同一性で判定）。 */
function __execHeaderGet(sheet) {
  try {
    const arr = __execSheetCache.headerMaps;
    for (let i = 0; i < arr.length; i++) { if (arr[i][0] === sheet) return arr[i][1]; }
  } catch (e) {}
  return null;
}

/** 実行内キャッシュ: ヘッダーマップを保存する。 */
function __execHeaderPut(sheet, map) {
  try { __execSheetCache.headerMaps.push([sheet, map]); } catch (e) {}
}

/** 実行内キャッシュ: ヘッダーマップを捨てる（列を足した直後に呼ぶ）。 */
function __execHeaderDrop(sheet) {
  try {
    const arr = __execSheetCache.headerMaps;
    for (let i = arr.length - 1; i >= 0; i--) { if (arr[i][0] === sheet) arr.splice(i, 1); }
  } catch (e) {}
}

/** 実行内キャッシュ: ensure*Headers を実行済みか。 */
function __execEnsureDone(sheet) {
  try {
    const arr = __execSheetCache.ensured;
    for (let i = 0; i < arr.length; i++) { if (arr[i] === sheet) return true; }
  } catch (e) {}
  return false;
}

/** 実行内キャッシュ: ensure*Headers 済みとして記録する。 */
function __execEnsureMark(sheet) {
  try { __execSheetCache.ensured.push(sheet); } catch (e) {}
}

// ==================== キャッシュ（R33: 実行横断） ====================
// 【背景】
//   R32 の実測で、api_bulkLock 8,899ms のうち
//     resolveCurrentTeacher(教員マスタ読取)          1,666ms
//     scopeStudentIdsForTeacher(端末一覧読取)        1,117ms
//     shardPropagatePolicy の getDataRange(読取)      898ms
//   と、シート読み取りだけで 3,681ms を占めていた。
//   R31 の「実行内キャッシュ」は同一実行内の重複しか消せないため、
//   別関数であるこの3つには効かなかった。
//   → 実行をまたぐ CacheService に載せる（教員5分 / 端末2分）。
//
// 【無効化】
//   教員マスタ: saveTeacherSettings / addTeacher / updateTeacherRecord /
//               importTeachers が走った時点で tv_v を進める（全教員キャッシュ失効）。
//   端末マスタ: withWriteLock が書き込み成功時に dev_v を進める既存機構に相乗りする。
//   ＝「保存・更新系が走ったタイミングで該当キーをクリア」という承認済み仕様どおり。
//
// 【テスト環境】
//   この関数群を切り出さないテストがあるため、呼び出し側は必ず typeof ガードする。

/** スクリプトキャッシュを安全に取得する（無い環境では null）。 */
function __cacheSafe() {
  try {
    if (typeof CacheService === 'undefined' || !CacheService) return null;
    const c = CacheService.getScriptCache();
    return c || null;
  } catch (e) {
    return null;
  }
}

/** 教員キャッシュの版。保存・更新のたびに進める（全教員のキャッシュを一括失効）。 */
function __teacherCacheVersion() {
  const c = __cacheSafe();
  if (!c) return '0';
  try { return String(c.get('tv_v') || '0'); } catch (e) { return '0'; }
}

/** 教員キャッシュを全件失効させる（保存・更新系から呼ぶ）。 */
function invalidateTeacherCache() {
  const c = __cacheSafe();
  if (!c) return;
  try {
    const cur = Number(c.get('tv_v') || '0');
    c.put('tv_v', String((cur + 1) % 1000000000), 21600); // 6時間保持
  } catch (e) { /* キャッシュ不可でも本処理は続行 */ }
}

/** 教員1件分のキャッシュキー（版を混ぜるので、失効は版を進めるだけで済む）。 */
function __teacherCacheKey(email) {
  return 'tch_' + __teacherCacheVersion() + '_' + String(email || '').trim().toLowerCase();
}

// ==================== 端末索引（R35: dev_v から独立した版管理） =====================
// 【なぜ独立させるか】
//   R32 の実測で shardPropagatePolicy のシート読み取りが 4,946ms に達していた。
//   原因は行数ではなく「書き込み直後の再読み込み」で、withWriteLock が書き込み成功時に
//   dev_v を進めるため、索引キャッシュのキー（dvi_<dev_v>_...）が自分自身の書き込みで
//   失効し、直後の読み取りが必ずキャッシュミスになっていた。
//   （同じ実行内でも bulkUpdateScreenLock の読取が 236ms、その直後の索引読取が 4,946ms。
//     同一シート・同一行数で 21 倍の差が出ていた。）
//
// 【解決】索引だけを idx_v で版管理し、書き込み関数が変更差分を自分で索引へ反映する。
//   → ロック/配信/規制（＝クラス情報を変えない操作）では索引が一切失効しない。
//   → shardPropagatePolicy はキャッシュだけを見る（openById / getDataRange を呼ばない）。
//
// 【容量対策】
//   CacheService の 1 値あたり上限は 100KB。1,000〜2,000 行を 1 キーに入れると
//   JSON では溢れてキャッシュが効かなくなるため、250 行ずつに分割して保存する。
//   表現も「id\u0001学校名\u0001クラス」の連結文字列にして 1 行あたりの容量を抑える。
const SHARD_INDEX_TTL = 21600;         // 6時間（CacheService の上限）
const SHARD_INDEX_CHUNK_ROWS = 250;    // 1キーあたりの行数（100KB に対する安全弁）
const SHARD_INDEX_SEP = String.fromCharCode(2);    // 行区切り
const SHARD_INDEX_FIELD = String.fromCharCode(1);  // 列区切り
const SHARD_INDEX_VER_KEY = 'idx_v';

/** 索引の版数（dev_v とは無関係）。 */
function shardIndexVersion() {
  const c = __cacheSafe();
  if (!c) return '0';
  try { return String(c.get(SHARD_INDEX_VER_KEY) || '0'); } catch (e) { return '0'; }
}

/** 索引を丸ごと無効化する（構造が変わったときだけ使う）。 */
function shardIndexBump() {
  const c = __cacheSafe();
  if (!c) return;
  try {
    const cur = Number(c.get(SHARD_INDEX_VER_KEY) || '0');
    c.put(SHARD_INDEX_VER_KEY, String((cur + 1) % 1000000000), SHARD_INDEX_TTL);
  } catch (e) {}
}

/** 索引キー（版数を含むので、版が進むと自動的に別物になる）。 */
function shardIndexKey(suffix) {
  try { return 'dvi_' + shardIndexVersion() + '_' + suffix; } catch (e) { return 'dvi_0_' + suffix; }
}

/** 区切り文字を含む値を安全に潰す（索引の壊れを防ぐ）。 */
function shardIndexSanitize(v) {
  try {
    return String(v === undefined || v === null ? '' : v)
      .replace(/[\u0001\u0002\r\n]/g, ' ').trim();
  } catch (e) { return ''; }
}

/**
 * 索引（[児童ID, 学校名, クラス] の配列）をチャンク分割して保存する。
 * 失敗したら false（呼び出し側は従来のシート読みにフォールバックできる）。
 */
function shardIndexSave(entries) {
  const c = __cacheSafe();
  if (!c) return false;
  try {
    const list = Array.isArray(entries) ? entries : [];
    const chunkCount = Math.max(1, Math.ceil(list.length / SHARD_INDEX_CHUNK_ROWS));
    let prevChunks = 0;
    try {
      const pm = c.get(shardIndexKey('m'));
      if (pm) prevChunks = Number(JSON.parse(pm).c) || 0;
    } catch (e0) { prevChunks = 0; }

    for (let ci = 0; ci < chunkCount; ci++) {
      const from = ci * SHARD_INDEX_CHUNK_ROWS;
      const to = Math.min(list.length, from + SHARD_INDEX_CHUNK_ROWS);
      const lines = [];
      for (let i = from; i < to; i++) {
        const e = list[i] || [];
        lines.push(shardIndexSanitize(e[0]) + SHARD_INDEX_FIELD +
                   shardIndexSanitize(e[1]) + SHARD_INDEX_FIELD +
                   shardIndexSanitize(e[2]));
      }
      const payload = lines.join(SHARD_INDEX_SEP);
      // 1 チャンクが上限に迫る異常時はキャッシュせず諦める（壊れた値を配らない）
      if (payload.length > 95000) return false;
      c.put(shardIndexKey('c' + ci), payload, SHARD_INDEX_TTL);
    }
    // 前回より少なくなった場合、余ったチャンクを消す（古い行が混ざらないように）
    for (let ci = chunkCount; ci < prevChunks; ci++) {
      try { c.remove(shardIndexKey('c' + ci)); } catch (e1) {}
    }
    c.put(shardIndexKey('m'), JSON.stringify({ c: chunkCount, n: list.length }), SHARD_INDEX_TTL);
    return true;
  } catch (e) { return false; }
}

/** 索引を読み出す。無い/欠けている場合は null（呼び出し側が作り直す）。 */
function shardIndexLoad() {
  const c = __cacheSafe();
  if (!c) return null;
  try {
    const metaRaw = c.get(shardIndexKey('m'));
    if (!metaRaw) return null;
    const meta = JSON.parse(metaRaw);
    const chunkCount = Number(meta && meta.c) || 0;
    if (!chunkCount) return null;
    const out = [];
    for (let ci = 0; ci < chunkCount; ci++) {
      const raw = c.get(shardIndexKey('c' + ci));
      if (raw === null || raw === undefined) return null; // 欠け＝作り直す
      if (!raw) continue;
      const lines = String(raw).split(SHARD_INDEX_SEP);
      for (let li = 0; li < lines.length; li++) {
        const f = lines[li].split(SHARD_INDEX_FIELD);
        if (!f.length) continue;
        out.push([f[0] || '', f[1] || '', f[2] || '']);
      }
    }
    return out;
  } catch (e) { return null; }
}

/**
 * 索引を保証する。無ければシートから 1 回だけ作って保存する。
 * 以後は書き込み関数の差分更新で最新に保たれるため、ここは通常通らない。
 * 返り値: [ [児童ID, 学校名, クラス], ... ] / 失敗時 null
 */
function shardIndexEnsure() {
  try {
    const hit = shardIndexLoad();
    if (hit) return hit;

    const sheet = getTargetSheet(CONFIG.DEVICE_SHEET_NAME);
    const headerMap = getHeaderMap(sheet, CONFIG.DEVICE_COLUMNS);
    const idCol = headerMap['児童ID'];
    const schoolCol = headerMap['学校名'];
    const classCol = headerMap['クラス'];
    if (!idCol || !schoolCol || !classCol) return null;

    const lastRow = sheet.getLastRow() || 0;
    const out = [];
    if (lastRow >= 2) {
      // 必要 3 列だけを最小の連続範囲で読む（全 16 列は読まない）
      const minCol = Math.min(idCol, schoolCol, classCol);
      const maxCol = Math.max(idCol, schoolCol, classCol);
      const width = maxCol - minCol + 1;
      const block = sheet.getRange(2, minCol, lastRow - 1, width).getValues();
      for (let r = 0; r < block.length; r++) {
        const line = block[r];
        const sid = String(line[idCol - minCol] || '').trim();
        if (!sid) continue;
        out.push([sid,
          String(line[schoolCol - minCol] || '').trim(),
          String(line[classCol - minCol] || '').trim()]);
      }
    }
    shardIndexSave(out);
    return out;
  } catch (e) { return null; }
}

/**
 * 索引から差分を上書きする（書き込み関数が呼ぶ）。
 * updates: [{ id, school, cls }]（undefined の項目は既存値を維持）
 * 索引が無いときは何もしない（次回の shardIndexEnsure が正しく作り直す）。
 */
function shardIndexUpsert(updates) {
  const list = Array.isArray(updates) ? updates : [];
  if (!list.length) return false;
  const cur = shardIndexLoad();
  if (!cur) return false;
  try {
    const map = {};
    const order = [];
    for (let i = 0; i < cur.length; i++) {
      const id = String(cur[i][0] || '');
      if (!id) continue;
      if (!map[id]) order.push(id);
      map[id] = [id, String(cur[i][1] || ''), String(cur[i][2] || '')];
    }
    let changed = false;
    for (let j = 0; j < list.length; j++) {
      const u = list[j] || {};
      const id = shardIndexSanitize(u.id);
      if (!id) continue;
      const prev = map[id] || [id, '', ''];
      if (!map[id]) { order.push(id); changed = true; }
      const nextSchool = (u.school !== undefined && u.school !== null) ? shardIndexSanitize(u.school) : prev[1];
      const nextCls = (u.cls !== undefined && u.cls !== null) ? shardIndexSanitize(u.cls) : prev[2];
      if (!map[id] || nextSchool !== prev[1] || nextCls !== prev[2]) changed = true;
      map[id] = [id, nextSchool, nextCls];
    }
    if (!changed) return true; // 変化なし＝保存不要（無駄な書き込みを避ける）
    const out = [];
    for (let k = 0; k < order.length; k++) out.push(map[order[k]]);
    return shardIndexSave(out);
  } catch (e) { return false; }
}

/** 索引から指定児童を取り除く（卒業・削除など）。 */
function shardIndexRemove(ids) {
  const arr = Array.isArray(ids) ? ids : [];
  if (!arr.length) return false;
  const cur = shardIndexLoad();
  if (!cur) return false;
  try {
    const drop = {};
    for (let i = 0; i < arr.length; i++) drop[shardIndexSanitize(arr[i])] = true;
    const out = [];
    for (let i = 0; i < cur.length; i++) {
      if (!drop[String(cur[i][0] || '')]) out.push(cur[i]);
    }
    return shardIndexSave(out);
  } catch (e) { return false; }
}

/**
 * 端末シートの読み取り結果から索引を作り直す（getAllDevices が呼ぶ）。
 * get_all はどのみち全列を読むため、その結果を索引へ流し込めば
 * 「シートを直接編集された」場合のズレもコンソール表示のたびに解消される。
 */
function shardIndexRefreshFromRows(data, headerMap) {
  try {
    const rows = Array.isArray(data) ? data : [];
    const hm = headerMap || {};
    const idColIdx = hm['児童ID'] - 1;
    const schoolColIdx = hm['学校名'] - 1;
    const classColIdx = hm['クラス'] - 1;
    if (idColIdx < 0 || schoolColIdx < 0 || classColIdx < 0) return false;
    const out = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i] || [];
      const sid = String(r[idColIdx] || '').trim();
      if (!sid) continue;
      out.push([sid, String(r[schoolColIdx] || '').trim(), String(r[classColIdx] || '').trim()]);
    }
    return shardIndexSave(out);
  } catch (e) { return false; }
}

/**
 * 索引（無ければシートから 1 回だけ作成）を [児童ID, 学校名, クラス] で返す。
 * 索引が使えない環境では従来どおりシートから読む（機能は落とさない）。
 */
function shardDeviceEntries() {
  try {
    const idx = shardIndexEnsure();
    if (idx) return idx;
  } catch (e) { /* 下のフォールバックへ */ }
  try {
    const sheet = getTargetSheet(CONFIG.DEVICE_SHEET_NAME);
    const headerMap = getHeaderMap(sheet, CONFIG.DEVICE_COLUMNS);
    const idColIdx = headerMap['児童ID'] - 1;
    const schoolColIdx = headerMap['学校名'] - 1;
    const classColIdx = headerMap['クラス'] - 1;
    const data = sheet.getDataRange().getValues();
    const out = [];
    for (let i = 1; i < data.length; i++) {
      const row = data[i] || [];
      const sid = String(row[idColIdx] || '').trim();
      if (!sid) continue;
      out.push([sid, String(row[schoolColIdx] || '').trim(), String(row[classColIdx] || '').trim()]);
    }
    return out;
  } catch (e) { return null; }
}

function getTargetSheet(sheetName) {
  // 書き込み先スプレッドシートIDはスクリプトプロパティ優先（子GASはここで子シートを指定）。
  const spreadsheetId = getSpreadsheetId();

  // 【R31】同一実行内で同じシートを開き直さない。
  //   openById はスプレッドシート全体を開くため 200〜500ms かかる。
  //   1回のロック操作で4回呼ばれていたのが主因だった。
  const __ck = String(spreadsheetId) + '|' + String(sheetName);
  const __cached = __execSheetGet(__ck);
  if (__cached) return __cached;

  let ss;
  try {
    ss = SpreadsheetApp.openById(spreadsheetId);
  } catch (err) {
    ss = SpreadsheetApp.getActiveSpreadsheet();
  }
  if (!ss) {
    throw new Error('スプレッドシートを開けませんでした。ID: ' + spreadsheetId);
  }

  // シート名が未定義だと getSheetByName(undefined)→insertSheet(undefined) となり
  // 空シートが増え続けてしまう。定義漏れをここで明確に検知して止める（安全弁）。
  if (!sheetName || typeof sheetName !== 'string') {
    throw new Error('シート名が未定義です。CONFIG の *_SHEET_NAME を確認してください。');
  }

  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    if (sheetName === CONFIG.DEVICE_SHEET_NAME) {
      initializeDeviceHeaders(sheet);
    } else if (sheetName === CONFIG.TEACHER_SHEET_NAME) {
      initializeTeacherHeaders(sheet);
    } else if (sheetName === CONFIG.ARCHIVE_SHEET_NAME) {
      initializeDeviceHeaders(sheet); // 卒業生アーカイブは端末一覧と同一の列構成
    } else if (sheetName === CONFIG.SCREENSHOT_SHEET_NAME) {
      initializeScreenshotHeaders(sheet);
    } else if (sheetName === CONFIG.SCHEDULE_SHEET_NAME) {
      initializeScheduleHeaders(sheet);
    }
  } else if (sheetName === CONFIG.TEACHER_SHEET_NAME) {
    // 既存教員マスタシートの場合、不足列（対象クラス、登録URL情報等）があれば自動補完
    ensureTeacherHeaders(sheet);
  } else if (sheetName === CONFIG.DEVICE_SHEET_NAME) {
    // 既存端末一覧シートに画面一覧用の列が無ければ自動補完（既存運用の後方互換）
    ensureDeviceHeaders(sheet);
  } else if (sheetName === CONFIG.SCREENSHOT_SHEET_NAME) {
    ensureScreenshotHeaders(sheet);
  } else if (sheetName === CONFIG.SCHEDULE_SHEET_NAME) {
    // 既存のスケジュール管理シートに不足列があれば末尾へ自動補完（後方互換）
    ensureScheduleHeaders(sheet);
  }
  __execSheetPut(__ck, sheet);
  return sheet;
}

function initializeDeviceHeaders(sheet) {
  const range = sheet.getRange(1, 1, 1, CONFIG.DEVICE_COLUMNS.length);
  range.setValues([CONFIG.DEVICE_COLUMNS]);
  range.setBackground('#4f46e5');
  range.setFontColor('#ffffff');
  range.setFontWeight('bold');
  sheet.setFrozenRows(1);
}

/**
 * 既存の端末一覧シートに不足列（画面情報要求日時・画面情報更新日時）があれば末尾に自動補完。
 * これにより、既に運用中のスプレッドシートでもコード更新だけで画面一覧機能が使える。
 */
function ensureDeviceHeaders(sheet) {
  // 【R31】同一実行内では1回だけ確認する（列の有無は実行中に外部から変わらない）。
  //   列を足したときはヘッダーキャッシュを捨てる。
  let __ok = false;
  try { __ok = (typeof __execSheetCache !== 'undefined') && !!__execSheetCache; } catch (e) { __ok = false; }
  if (__ok && __execEnsureDone(sheet)) return;

  const lastCol = sheet.getLastColumn();
  if (lastCol === 0) {
    initializeDeviceHeaders(sheet);
    if (__ok) { __execEnsureMark(sheet); __execHeaderDrop(sheet); }
    return;
  }
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim());
  let added = false;
  CONFIG.DEVICE_COLUMNS.forEach(col => {
    if (!headers.includes(col)) {
      const newCol = sheet.getLastColumn() + 1;
      sheet.getRange(1, newCol).setValue(col)
        .setBackground('#4f46e5')
        .setFontColor('#ffffff')
        .setFontWeight('bold');
      added = true;
    }
  });
  if (__ok) {
    __execEnsureMark(sheet);
    if (added) __execHeaderDrop(sheet);
  }
}

function initializeScreenshotHeaders(sheet) {
  const range = sheet.getRange(1, 1, 1, CONFIG.SCREENSHOT_COLUMNS.length);
  range.setValues([CONFIG.SCREENSHOT_COLUMNS]);
  range.setBackground('#0ea5e9'); // スカイブルー
  range.setFontColor('#ffffff');
  range.setFontWeight('bold');
  sheet.setFrozenRows(1);
}

function ensureScreenshotHeaders(sheet) {
  const lastCol = sheet.getLastColumn();
  if (lastCol === 0) {
    initializeScreenshotHeaders(sheet);
    return;
  }
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim());
  CONFIG.SCREENSHOT_COLUMNS.forEach(col => {
    if (!headers.includes(col)) {
      const newCol = sheet.getLastColumn() + 1;
      sheet.getRange(1, newCol).setValue(col)
        .setBackground('#0ea5e9')
        .setFontColor('#ffffff')
        .setFontWeight('bold');
    }
  });
}

/**
 * スケジュール管理シートの日付・時刻列を「書式なしテキスト」に固定する。
 *   これが無いと Google スプレッドシートが "2026/11/10" を日付型として解釈し、
 *   getValues() が "Tue Nov 10 2026 00:00:00 GMT+0900 (日本標準時)" を返す。
 *   文字列比較では月名順に並ぶため新しいデータが負ける（既知の罠）。
 *   ※ テストハーネスの makeSheet には setNumberFormat が無いため必ず握りつぶす。
 */
function freezeScheduleTextColumns_(sheet) {
  try {
    if (!sheet || typeof sheet.getRange !== 'function') return;
    const map = getHeaderMap(sheet, CONFIG.SCHEDULE_COLUMNS);
    const names = ['開始日', '終了日', '開始時刻', '終了時刻', '手動解除日時', '作成日時', '更新日時', 'スケジュールID'];
    const lastRow = Math.max(sheet.getLastRow() || 1, 2);
    names.forEach(function (n) {
      const c = map[n];
      if (!c) return;
      try { sheet.getRange(2, c, lastRow, 1).setNumberFormat('@'); } catch (e1) {}
    });
  } catch (e) { /* 書式固定は本質ではない。失敗しても読む側で吸収する */ }
}

function initializeScheduleHeaders(sheet) {
  const range = sheet.getRange(1, 1, 1, CONFIG.SCHEDULE_COLUMNS.length);
  range.setValues([CONFIG.SCHEDULE_COLUMNS]);
  range.setBackground('#7c3aed'); // バイオレット（端末一覧=藍 / 画面情報=空 / 教員=緑 と区別）
  range.setFontColor('#ffffff');
  range.setFontWeight('bold');
  sheet.setFrozenRows(1);
  freezeScheduleTextColumns_(sheet);
}

/**
 * 既存のスケジュール管理シートに不足列があれば末尾へ自動補完（後方互換）。
 * ensureDeviceHeaders と同じ「同一実行内1回」の実行キャッシュを使う。
 */
function ensureScheduleHeaders(sheet) {
  let __ok = false;
  try { __ok = (typeof __execSheetCache !== 'undefined') && !!__execSheetCache; } catch (e) { __ok = false; }
  if (__ok && __execEnsureDone(sheet)) return;

  const lastCol = sheet.getLastColumn();
  if (lastCol === 0) {
    initializeScheduleHeaders(sheet);
    if (__ok) { __execEnsureMark(sheet); __execHeaderDrop(sheet); }
    return;
  }
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim());
  let added = false;
  CONFIG.SCHEDULE_COLUMNS.forEach(col => {
    if (!headers.includes(col)) {
      const newCol = sheet.getLastColumn() + 1;
      sheet.getRange(1, newCol).setValue(col)
        .setBackground('#7c3aed')
        .setFontColor('#ffffff')
        .setFontWeight('bold');
      added = true;
    }
  });
  if (__ok) {
    __execEnsureMark(sheet);
    if (added) __execHeaderDrop(sheet);
  }
  if (added) freezeScheduleTextColumns_(sheet);
}

function initializeTeacherHeaders(sheet) {
  const range = sheet.getRange(1, 1, 1, CONFIG.TEACHER_COLUMNS.length);
  range.setValues([CONFIG.TEACHER_COLUMNS]);
  range.setBackground('#059669'); // エメラルドグリーン
  range.setFontColor('#ffffff');
  range.setFontWeight('bold');
  sheet.setFrozenRows(1);
}

/**
 * 既存の教員マスタシートに新しい列（対象クラス、登録URL情報など）がなければ末尾に自動補完
 */
function ensureTeacherHeaders(sheet) {
  // 【R31】ensureDeviceHeaders と同じ理由で実行内1回に畳む。
  let __ok = false;
  try { __ok = (typeof __execSheetCache !== 'undefined') && !!__execSheetCache; } catch (e) { __ok = false; }
  if (__ok && __execEnsureDone(sheet)) return;

  const lastCol = sheet.getLastColumn();
  if (lastCol === 0) {
    initializeTeacherHeaders(sheet);
    if (__ok) { __execEnsureMark(sheet); __execHeaderDrop(sheet); }
    return;
  }
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim());
  let added = false;
  CONFIG.TEACHER_COLUMNS.forEach(col => {
    if (!headers.includes(col)) {
      const newCol = sheet.getLastColumn() + 1;
      sheet.getRange(1, newCol).setValue(col)
        .setBackground('#059669')
        .setFontColor('#ffffff')
        .setFontWeight('bold');
      added = true;
    }
  });
  if (__ok) {
    __execEnsureMark(sheet);
    if (added) __execHeaderDrop(sheet);
  }
}

function getHeaderMap(sheet, defaultColumns) {
  // 【R31】同一実行内ではヘッダー行を1回だけ読む。
  //   ヘッダーは 1 行のみで、書き込み中に変わるのは ensure*Headers が列を足すときだけ。
  //   そのときは __execHeaderDrop で捨てるので古い値を返すことはない。
  //   ※ テストはこの関数を単体で切り出して実行するため、
  //     キャッシュの器が無い環境では従来どおり毎回読む（typeof ガード）。
  let __cacheOk = false;
  try { __cacheOk = (typeof __execSheetCache !== 'undefined') && !!__execSheetCache; } catch (e) { __cacheOk = false; }
  if (__cacheOk) {
    const __hit = __execHeaderGet(sheet);
    if (__hit) return __hit;
  }

  const lastCol = sheet.getLastColumn() || defaultColumns.length;
  const headerRow = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const map = {};
  headerRow.forEach((name, index) => {
    map[String(name).trim()] = index + 1; // 1-indexed
  });
  if (__cacheOk) __execHeaderPut(sheet, map);
  return map;
}

/**
 * 初期化関数: GASエディタから手動実行して全14校のサンプル児童データおよび教員マスタを自動生成
 */
function setupSpreadsheet() {
  // 1. 端末一覧シート
  const deviceSheet = getTargetSheet(CONFIG.DEVICE_SHEET_NAME);
  initializeDeviceHeaders(deviceSheet);

  if (deviceSheet.getLastRow() <= 1) {
    const sampleDevices = [
      ['aida-es-001', '英田小学校', '英田 太郎', '5年1組', false, 'OFF', 'nhk.or.jp, scratch.mit.edu', 'youtube.com', '', '', '', new Date(), ''],
      ['ohara-es-001', '大原小学校', '大原 一郎', '5年1組', false, 'OFF', 'nhk.or.jp, scratch.mit.edu', 'youtube.com', '', '', '', new Date(), ''],
      ['emi-es-001', '江見小学校', '江見 二郎', '5年1組', false, 'OFF', 'nhk.or.jp, scratch.mit.edu', 'youtube.com', '', '', '', new Date(), ''],
      ['katsuta-es-001', '勝田小学校', '勝田 三郎', '6年1組', false, 'OFF', 'nhk.or.jp, scratch.mit.edu', 'youtube.com', '', '', '', new Date(), ''],
      ['katsuta-e-001', '勝田東小学校', '東 四郎', '6年1組', false, 'OFF', 'nhk.or.jp, scratch.mit.edu', 'youtube.com', '', '', '', new Date(), ''],
      ['daiichi-es-001', '第一小学校', '第一 健太', '5年1組', false, 'OFF', 'nhk.or.jp, scratch.mit.edu', 'youtube.com', '', '', '', new Date(), ''],
      ['kita-es-001', '北小学校', '北 花子', '5年1組', false, 'OFF', 'nhk.or.jp, scratch.mit.edu', 'youtube.com', '', '', '', new Date(), ''],
      ['doi-es-001', '土居小学校', '土居 優子', '5年1組', false, 'OFF', 'nhk.or.jp, scratch.mit.edu', 'youtube.com', '', '', '', new Date(), ''],
      ['aida-jhs-001', '英田中学校', '英田 翔太', '1年A組', false, 'OFF', 'nhk.or.jp, scratch.mit.edu', 'youtube.com', '', '', '', new Date(), ''],
      ['ohara-jhs-001', '大原中学校', '大原 陸', '1年A組', false, 'OFF', 'nhk.or.jp, scratch.mit.edu', 'youtube.com', '', '', '', new Date(), ''],
      ['sakuto-jhs-001', '作東中学校', '作東 陽菜', '2年A組', false, 'OFF', 'nhk.or.jp, scratch.mit.edu', 'youtube.com', '', '', '', new Date(), ''],
      ['katsuta-jhs-001', '勝田中学校', '勝田 蓮', '2年A組', false, 'OFF', 'nhk.or.jp, scratch.mit.edu', 'youtube.com', '', '', '', new Date(), ''],
      ['mimasaka-jhs-001', '美作中学校', '美作 葵', '3年A組', false, 'OFF', 'nhk.or.jp, scratch.mit.edu', 'youtube.com', '', '', '', new Date(), ''],
      ['araki-001', '樸学園', '木村 さくら', '前期5年', false, 'OFF', 'nhk.or.jp, scratch.mit.edu', 'youtube.com', '', '', '', new Date(), '']
    ];
    deviceSheet.getRange(2, 1, sampleDevices.length, sampleDevices[0].length).setValues(sampleDevices);
  }

  // 2. 教員マスタシート
  const teacherSheet = getTargetSheet(CONFIG.TEACHER_SHEET_NAME);
  initializeTeacherHeaders(teacherSheet);

  if (teacherSheet.getLastRow() <= 1) {
    const defaultUrlsAdmin = JSON.stringify([
      { title: 'Scratch', url: 'https://scratch.mit.edu' },
      { title: 'NHK for School', url: 'https://www.nhk.or.jp/school/' },
      { title: 'Google Classroom', url: 'https://classroom.google.com' }
    ]);
    const defaultUrlsDaiichi = JSON.stringify([
      { title: 'Scratch プログラミング', url: 'https://scratch.mit.edu' },
      { title: 'NHK for School 理科', url: 'https://www.nhk.or.jp/school/' }
    ]);
    const defaultUrlsAida = JSON.stringify([
      { title: 'NHK for School', url: 'https://www.nhk.or.jp/school/' },
      { title: 'Google Classroom', url: 'https://classroom.google.com' }
    ]);

    const defaultWhitelist = 'nhk.or.jp, scratch.mit.edu, google.com';
    const defaultBlacklist = 'youtube.com, twitter.com, tiktok.com, instagram.com';

    const sampleTeachers = [
      ['admin@school.ed.jp', 'Admin1234!', '教育委員会 管理者', '全校管理', 'ADMIN', '全クラス', defaultUrlsAdmin, defaultWhitelist, defaultBlacklist, ''],
      ['teacher.daiichi@school.ed.jp', 'Teacher1234!', '第一小 担任教員', '第一小学校', 'TEACHER', '5年1組', defaultUrlsDaiichi, defaultWhitelist, defaultBlacklist, ''],
      ['teacher.aida@school.ed.jp', 'Teacher1234!', '英田小 担任教員', '英田小学校', 'TEACHER', '5年1組', defaultUrlsAida, defaultWhitelist, defaultBlacklist, '']
    ];
    teacherSheet.getRange(2, 1, sampleTeachers.length, sampleTeachers[0].length).setValues(sampleTeachers);
  }

  // 3. スケジュール管理シート（タイマー機能）
  //    ヘッダーのみ作成する。予約は教員コンソールから追加する運用のため、
  //    サンプル行は入れない（実データと誤認されるのを避ける）。
  const scheduleSheet = getTargetSheet(CONFIG.SCHEDULE_SHEET_NAME);
  initializeScheduleHeaders(scheduleSheet);

  Logger.log('14校対応スプレッドシートのセットアップが完了しました。');
}

/**
 * Web App GETハンドラー
 */
function doGet(e) {
  try {
    const params = (e && e.parameter) || {};
    const api = params.api || '';
    // 【可観測性】受け取った時点で必ずログを残す。
    //   「端末が本当に届いているのか」を実行ログだけで100%判定できるようにする。
    try {
      Logger.log('[SHARD] heartbeat: received(GET) api=' + String(api || '(none)') +
        ' student_id=' + String(params.student_id || '(none)') +
        ' keys=' + Object.keys(params || {}).length);
    } catch (eRcv) {}

    // 1. 児童拡張機能からのハートビート (GET対応)
    if (api === 'heartbeat' || api === 'get_settings') {
      const studentId = params.student_id;
      const currentUrl = params.current_url || '';
      if (!studentId) return jsonResponse({ success: false, error: 'student_id is required' });
      const hbGet = processHeartbeat(studentId, currentUrl, params.school_name);
      return jsonResponse({ success: true, ...hbGet, ...resolveShardForHeartbeat(studentId, hbGet.class_name) });
    }

    // 1-b. 端末の起こし確認（GET・シート非接触の軽量応答）
    if (api === 'wake_check') {
      return jsonResponse(getWakeInfo());
    }

    // 2. 教員ダッシュボード向けリスト取得 (要認証トークン)
    if (api === 'list') {
      const auth = verifyToken(params.token);
      if (!auth.valid) {
        return jsonResponse({ success: false, error: '認証が必要です。ログインし直してください。', need_auth: true });
      }
      const data = getAllDevices(params.school_name, auth.teacher, parseBoolean(params.include_unassigned));
      return jsonResponse({ success: true, data: data, teacher: auth.teacher });
    }

    // 3. 学校リスト取得 (ログイン画面等向け)
    if (api === 'schools') {
      return jsonResponse({ success: true, schools: CONFIG.SCHOOL_LIST });
    }

    // 4. HTML画面配信
    const template = HtmlService.createTemplateFromFile('index');
    let webAppUrl = '';
    try {
      webAppUrl = ScriptApp.getService().getUrl();
    } catch (urlErr) {
      webAppUrl = '';
    }
    template.webAppUrl = webAppUrl;

    return template.evaluate()
      .setTitle('Chromebook 児童端末管理システム (美作市14校)')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);

  } catch (err) {
    return jsonResponse({ success: false, error: err.toString() });
  }
}

/**
 * Web App POSTハンドラー
 */
function doPost(e) {
  try {
    let payload = {};
    if (e && e.postData && e.postData.contents) {
      try { payload = JSON.parse(e.postData.contents); } catch (err) { payload = e.parameter || {}; }
    } else if (e && e.parameter) {
      payload = e.parameter;
    }

    const action = payload.action || payload.api;

    // 【可観測性】受け取った時点で必ずログを残す（本文形式・パラメータ形式を問わない）。
    //   実機では「子GASの実行数が完全にゼロ」で原因を切り分けられなかったため、
    //   到達の有無を1行で判別できるようにする。
    try {
      Logger.log('[SHARD] heartbeat: received(POST) action=' + String(action || '(none)') +
        ' student_id=' + String(payload.student_id || '(none)') +
        ' keys=' + Object.keys(payload || {}).length +
        ' postData=' + !!(e && e.postData));
    } catch (eRcvP) {}

    // A. 児童拡張機能からのハートビート (認証不要・student_id必須)
    if (action === 'heartbeat') {
      const studentId = payload.student_id;
      const currentUrl = payload.current_url || '';
      if (!studentId) {
        // 端末は届いているが ID が無い＝設定不良。無言で返さず理由を残す。
        try { Logger.log('[SHARD] heartbeat: student_id 未設定のため配信できません（端末側の児童ID設定を確認）'); } catch (eNoId) {}
        return jsonResponse({ success: false, error: 'student_id is required' });
      }
      const hb = processHeartbeat(studentId, currentUrl, payload.school_name);
      // 子GAS分散（SHARD_MODE）: 親は端末のクラスから「子GAS URL」を解決して返す。
      // 親でない場合 resolveShardForHeartbeat は {} を返すため、応答は従来と完全に同一。
      return jsonResponse({ success: true, ...hb, ...resolveShardForHeartbeat(studentId, hb.class_name) });
    }

    // A2. 児童拡張機能からの画面情報（スクリーンショット）アップロード
    //     ハートビートと同じく認証不要（児童端末にはトークンが無いため）。
    //     教員が「画面情報取得」を押した児童の端末だけが、要求を検知して送信する。
    if (action === 'screenshot' || action === 'upload_screenshot') {
      const studentId = payload.student_id;
      const imageData = payload.image_data || payload.data_url || '';
      const mimeType = payload.mime_type || payload.mime || '';
      const res = processScreenshotUpload(studentId, imageData, mimeType);
      return jsonResponse(res);
    }

    // A2-b. 【R43.3】「撮影できなかった」通知
    //     chrome://newtab/ など Chrome の特権ページを表示中は captureVisibleTab が
    //     仕様上できない。黙って諦めると教員画面の「更新待ち」が残り続けるため、
    //     画像の代わりに状態だけを送ってもらい、『画面情報状態』へ記録する。
    //     形式: "capture_blocked:<理由>|YYYY/MM/DD HH:mm:ss"
    //     ※ 認証不要（screenshot と同じ経路）。画像は一切保存しない。
    if (action === 'screenshot_blocked' || action === 'screenshot_unavailable') {
      const res = processScreenshotBlocked(
        payload.student_id,
        payload.reason || payload.kind || 'chrome_protected'
      );
      return jsonResponse(res);
    }

    // A3. 教員コンソールの稼働通知（ログイン中は 15 秒ごとに touch、ログアウト/タブ閉じで release）。
    //     児童端末はハートビート応答の ka_active を見て同期周期を切り替える。
    //     session_id を付けることで、複数アカウントのうち 1 つが終了しても他が稼働中なら維持される。
    //     ※ 認証不要（トークンを持たない経路もあるため）。稼働時刻を記録するだけの軽量処理。
    if (action === 'console_touch') {
      const touchRes = touchTeacherConsole(payload.session_id);
      // 子GAS分散: 子は親のコンソール稼働を知る手段が無いため、ここで配る。
      // （配らないと子担当の端末が ka_active=false を受け取り同期を止める）
      shardPropagateKaState(true);
      // 【R34】取りこぼし回収: この通知は誰も応答を待たないため、保留分の送信もここで行う。
      //   ブラウザのビーコンが届かなかった場合の自己修復経路（15秒ごとに必ず通る）。
      try { if (typeof shardFlushPending === 'function') shardFlushPending(); } catch (e) {}
      return jsonResponse(touchRes);
    }
    if (action === 'console_release') {
      const releaseRes = releaseTeacherConsole(payload.session_id);
      // 全セッションが消えた（＝非稼働）ときだけ子へ停止を伝える
      try { if (!isTeacherConsoleActive()) shardPropagateKaState(false); } catch (e) {}
      // 【R34】ブラウザ終了で最後の操作が消えないよう、停止時にも保留分を送る。
      try { if (typeof shardFlushPending === 'function') shardFlushPending(); } catch (e) {}
      return jsonResponse(releaseRes);
    }

    // A3-b. 子GASへの伝達フラッシュ（R34）
    //   教員操作の応答直後にブラウザが sendBeacon / fetch(keepalive:true) で投げる。
    //   誰も応答を待たないため、数秒かかる子GASへの送信をここで実行してよい。
    //   トークン必須（教員の操作結果を子へ流すため）。
    if (action === 'shard_flush') {
      const flushAuth = verifyToken(payload.token);
      if (!flushAuth.valid) {
        return jsonResponse({ success: false, error: '認証セッションが無効です', need_auth: true });
      }
      return jsonResponse(shardFlushPending());
    }

    // A4. 端末の「起こし確認」。シートに触らない軽量応答（通信負荷を増やさない）。
    //     端末は wake_epoch の変化、または ka_active=true を見たら通常同期へ復帰する。
    if (action === 'wake_check') {
      return jsonResponse(getWakeInfo());
    }
    // A5. 管理アプリからの明示的な一斉叩き起こし（ログイン直後に呼ばれる）。
    if (action === 'console_wake') {
      bumpWakeEpoch();
      return jsonResponse(getWakeInfo());
    }

    // A6. 子GAS分散（SHARD_MODE）: 親⇔子の通信。
    //     教員トークンではなく共有シークレット（SHARD_SECRET）で認証する。
    //     ・shard_apply … 子GASが親からポリシーを受け取る
    //     ・shard_push  … 親GASが子GASからテレメトリを受け取る
    if (action === 'shard_apply') {
      return jsonResponse(shardApplyFromParent(payload));
    }
    if (action === 'shard_push') {
      return jsonResponse(shardUpsertTelemetryFromChild(payload));
    }
    // 親が子の端末一覧を取りに来る（コンソールの1画面集約用）
    if (action === 'shard_list') {
      return jsonResponse(shardListForParent(payload));
    }
    // 子GASが「この児童は誰か（氏名・学校・クラス）」を親の名簿へ問い合わせる。
    // 子は名簿を持たないため、これが無いとクラス未取得の端末が永久に直らない。
    if (action === 'shard_lookup') {
      if (!shardSecretMatches(payload && payload.shard_secret)) {
        return jsonResponse({ success: false, found: false, error: 'unauthorized' });
      }
      return jsonResponse(shardLookupStudent(payload.student_id));
    }

    // A6-c. 【R42】画面情報のマルチスプレッドシート対応。
    //   「画面情報取得」の要求と、取得済み画像の読み出しを、ブラウザが
    //   親 /exec と子 /exec へ「並列」に投げる（R41 と同じ方式）。
    //   親の中で UrlFetchApp を使うと応答までブロックし /exec が遅くなるため、
    //   子への送受信はブラウザに担わせる。
    //   認証は教員トークンではなく共有シークレット（1校独立運用のため自校のみ到達可能）。
    if (action === 'shard_request_screens') {
      return jsonResponse(shardRequestScreensFromBrowser(payload));
    }
    if (action === 'shard_get_screens') {
      return jsonResponse(shardScreensFromBrowser(payload));
    }

    // B. 教員ログイン認証
    if (action === 'login') {
      const email = (payload.email || '').trim().toLowerCase();
      const password = (payload.password || '').trim();
      return handleTeacherLogin(email, password);
    }

    // C. セッション検証
    if (action === 'verify_session') {
      const auth = verifyToken(payload.token);
      if (!auth.valid) return jsonResponse({ success: false });
      try {
        const latestTeacher = getTeacherSettings(auth.teacher.email);
        return jsonResponse({ success: true, teacher: latestTeacher });
      } catch (e) {
        return jsonResponse({ success: true, teacher: auth.teacher });
      }
    }

    // これ以降の教員操作アクションは認証トークン必須
    const auth = verifyToken(payload.token);
    if (!auth.valid) {
      return jsonResponse({ success: false, error: '認証セッションが無効です。再ログインしてください。', need_auth: true });
    }

    // トークン内の教員情報は発行時点のスナップショットのため、
    // 教員マスタの最新レコード（所属学校・権限）で解決し直す。
    // 管理者が所属学校/権限を後から変更しても、直ちに正しいスコープで判定する。
    const currentTeacher = resolveCurrentTeacher(auth.teacher);

    // D. 端末一覧取得
    if (action === 'get_all') {
      // 子GAS分散: 子の端末も同じ画面に並べる（教員は1画面のまま）。
      // 子GASへは並列（fetchAll）で問い合わせ、集約結果を数秒キャッシュする。
      const data = getShardMergedDevices(
        payload.school_name, currentTeacher, Boolean(payload.include_unassigned));
      return jsonResponse({ success: true, data: data });
    }

    // D1. AI監視設定の取得（読み取りは全教員可。変更可否の判断材料として is_admin を返す）
    if (action === 'get_monitor_settings') {
      return jsonResponse({
        success: true,
        settings: getMonitoringSettings(),
        is_admin: isAdminTeacher(currentTeacher)
      });
    }

    // D1-2. AI監視設定の保存（システム全体・管理者のみ）
    if (action === 'save_monitor_settings') {
      const saved = saveMonitoringSettings(currentTeacher, payload.settings || {});
      return jsonResponse({ success: true, message: '監視設定を保存しました', settings: saved });
    }

    // D2. 画面情報取得要求（押下時のみ）：対象児童に要求IDを書き込む
    if (action === 'request_screens') {
      const result = requestScreenCapture(payload.student_ids, currentTeacher);
      if (result.requested === 0) {
        return jsonResponse({ success: false, error: '画面情報を要求できる児童がいません（自校の児童のみ対象）' });
      }
      return jsonResponse({ success: true, message: `${result.requested} 台の画面情報取得を要求しました`, result: result });
    }

    // D3. 画面情報一覧取得（画像付き）：console の「画面一覧」タブ表示に使用
    //   【R43】payload.meta_only = true を渡すと、画像(Base64)を含めずに
    //   「誰の画面がいつ撮られたか」だけを軽量に返す。ポーリング（送信待ちの監視）は
    //   これを使い、画像本体は「本当に新しい画像が来た1回」だけ取得する。
    if (action === 'get_screens') {
      const status = payload.status || 'all';
      const data = getScreenshots(
        payload.school_name, currentTeacher, Boolean(payload.include_unassigned),
        status, payload.student_ids, { meta_only: !!payload.meta_only }
      );
      return jsonResponse({ success: true, data: data, meta_only: !!payload.meta_only });
    }

    // E. 一括画面ロック（教員の所属学校スコープを適用）
    if (action === 'bulk_lock') {
      const scoped = scopeStudentIdsForTeacher(payload.student_ids, currentTeacher);
      if (Array.isArray(scoped.ids) && scoped.ids.length === 0) {
        return jsonResponse({ success: false, error: '操作対象の児童がありません（自校の児童のみ操作できます）' });
      }
      bulkUpdateScreenLock(scoped.ids, parseBoolean(payload.locked));
      // 子GAS分散: 該当クラスの子GASへも同じロック状態を伝達する（SHARD_MODE=false なら何もしない）
      // 【R41】子GASへの反映はブラウザが直接・並列で行う（親は待たない）
      const shardLock = shardPropagatePolicy(scoped.ids, { screen_lock: parseBoolean(payload.locked) });
      return jsonResponse({ success: true, message: `画面ロックを ${payload.locked ? 'ON' : 'OFF'} に更新しました`, shard: shardLock });
    }

    // F. 一斉URL配信（教員の所属学校スコープを適用）
    if (action === 'bulk_broadcast') {
      const targetUrl = payload.url;
      if (!targetUrl) return jsonResponse({ success: false, error: '配信URLが空です' });
      const scoped = scopeStudentIdsForTeacher(payload.student_ids, currentTeacher);
      if (Array.isArray(scoped.ids) && scoped.ids.length === 0) {
        return jsonResponse({ success: false, error: '操作対象の児童がありません（自校の児童のみ操作できます）' });
      }
      // 【要件1】配信IDは管理画面の押下時に1つだけ採番され、payload.broadcast_id で届く。
      //   ここで採番し直すと子GAS直送（ブラウザ→子）と別IDになり、
      //   端末が「新しい配信」と誤認して同じページを2枚開く（実機症状）。
      //   届かなかった場合のみ bulkUpdateBroadcastUrl 側がフォールバック発番する。
      const reqBcId = String((payload && payload.broadcast_id) || '').trim();
      const broadcastId = bulkUpdateBroadcastUrl(scoped.ids, targetUrl, reqBcId);
      const shardBc = shardPropagatePolicy(scoped.ids, {
        broadcast_url: targetUrl,
        broadcast_id: broadcastId
      });
      return jsonResponse({ success: true, message: '一斉URLを配信しました', broadcast_id: broadcastId, shard: shardBc });
    }

    // G. URL規制一括変更（教員の所属学校スコープを適用）
    if (action === 'bulk_filter') {
      const scoped = scopeStudentIdsForTeacher(payload.student_ids, currentTeacher);
      if (Array.isArray(scoped.ids) && scoped.ids.length === 0) {
        return jsonResponse({ success: false, error: '操作対象の児童がありません（自校の児童のみ操作できます）' });
      }
      bulkUpdateFilterMode(scoped.ids, payload.filter_mode, payload.whitelist_urls, payload.blacklist_urls);
      // 【R41】子GASへの反映はブラウザが直接・並列で行う（親は待たない）
      const shardFilter = shardPropagatePolicy(scoped.ids, {
        filter_mode: payload.filter_mode,
        whitelist_urls: payload.whitelist_urls,
        blacklist_urls: payload.blacklist_urls
      });
      // 教員アカウントの個別設定としても保持
      if (currentTeacher && currentTeacher.email) {
        try {
          saveTeacherSettings(currentTeacher.email, {
            filter_whitelist: payload.whitelist_urls,
            filter_blacklist: payload.blacklist_urls
          });
        } catch (saveErr) {
          Logger.log('教員規制設定保存スキップ: ' + saveErr);
        }
      }
      return jsonResponse({ success: true, message: `URL規制モードを ${payload.filter_mode} に更新しました`, shard: shardFilter });
    }

    // G2. 【スケジュール／タイマー】予約の登録（教員トークン必須）
    //   ここに到達している時点で payload.token は検証済み（認証ブロック通過）。
    //   さらに handleSaveSchedule_ の中で「自校のクラス／自校の児童」かを再確認する。
    if (action === 'save_schedule' || action === 'schedule_save') {
      return jsonResponse(handleSaveSchedule_(payload, currentTeacher));
    }

    // G3. 予約の一覧取得（自校スコープのみ返す）
    if (action === 'list_schedules' || action === 'schedule_list') {
      return jsonResponse(handleListSchedules_(payload, currentTeacher));
    }

    // G4. 予約の取消（予約そのものを止める。行は監査ログとして残す）
    if (action === 'cancel_schedule' || action === 'schedule_cancel') {
      return jsonResponse(handleCancelSchedule_(payload, currentTeacher));
    }

    // G5. 今回だけの解除（予約は残す。次回以降の時間帯は再び適用される）
    if (action === 'override_schedule' || action === 'schedule_override') {
      return jsonResponse(handleOverrideSchedule_(payload, currentTeacher));
    }

    // H. 単一児童端末の更新（他校の児童は更新不可）
    if (action === 'update_single') {
      const targetStudent = getDeviceByStudentId(payload.student_id);
      if (!targetStudent) {
        return jsonResponse({ success: false, error: '児童IDが見つかりません: ' + payload.student_id });
      }
      if (!isDeviceInTeacherScope(targetStudent.school_name, currentTeacher, targetStudent.class_name)) {
        return jsonResponse({ success: false, error: '対象外の児童は操作できません（学校・対象クラスの範囲外）' });
      }
      updateSingleDevice(payload.student_id, payload.data || {});
      const single = payload.data || {};
      const shardPatch = {};
      if (single.screen_lock !== undefined) shardPatch.screen_lock = parseBoolean(single.screen_lock);
      if (single.filter_mode !== undefined) shardPatch.filter_mode = single.filter_mode;
      if (single.whitelist_urls !== undefined) shardPatch.whitelist_urls = single.whitelist_urls;
      if (single.blacklist_urls !== undefined) shardPatch.blacklist_urls = single.blacklist_urls;
      if (single.broadcast_url !== undefined) shardPatch.broadcast_url = single.broadcast_url;
      // 【R41】子GASへの反映はブラウザが直接・並列で行う（親は待たない）
      const shardSingle = Object.keys(shardPatch).length
        ? shardPropagatePolicy([payload.student_id], shardPatch) : { skipped: true };
      return jsonResponse({ success: true, message: '設定を更新しました', shard: shardSingle });
    }

    // H2. 【R41】子GASの接続情報をブラウザへ配布する
    //   ブラウザが親 /exec と子 /exec を「並列」で叩けるようにするため、
    //   子GASのURLと共有シークレットを返す。
    //   1校独立運用（自校のブラウザは自校のGASにしかアクセスしない）を前提とする。
    //   SHARD_MODE が無効なら enabled:false を返すだけで、他は何もしない。
    if (action === 'shard_config') {
      return jsonResponse(shardClientConfig());
    }

    // I. 教員アカウント設定の保存（登録URL情報・個別規制URL・対象クラスの更新）
    //    ※ 一斉配信URL（マイURL）と個別規制URL（ホワイト/ブラックリスト）は
    //      TEACHER権限でもアカウント毎に登録・保存できる（要望対応）。
    //    ※ ただし「対象クラス」は権限の境界であるため、管理者(ADMIN)のみ変更可能。
    //      一般教員が自身の対象クラスを書き換えて権限を広げることを防ぐ。
    if (action === 'save_teacher_settings' || action === 'update_teacher_settings') {
      const safeSettings = sanitizeTeacherSettingsForSave(payload.settings || payload, currentTeacher);
      const updatedTeacher = saveTeacherSettings(currentTeacher.email, safeSettings);
      return jsonResponse({ success: true, message: '教員設定を保存しました', teacher: updatedTeacher });
    }

    // J. 教員アカウント設定の取得
    if (action === 'get_teacher_settings') {
      const teacher = getTeacherSettings(currentTeacher.email);
      return jsonResponse({ success: true, teacher: teacher });
    }

    // K. 教員アカウント一覧（管理者のみ）
    if (action === 'get_teachers') {
      return jsonResponse({ success: true, teachers: getAllTeachers(currentTeacher), schools: CONFIG.SCHOOL_LIST });
    }

    // L. 教員アカウントの新規登録（管理者のみ）
    if (action === 'add_teacher') {
      const t = addTeacher(currentTeacher, payload.data || payload);
      return jsonResponse({ success: true, message: '教員を登録しました', teacher: t });
    }

    // M. 教員アカウントの更新（管理者のみ）
    if (action === 'update_teacher') {
      const t = updateTeacherRecord(currentTeacher, payload.data || payload);
      return jsonResponse({ success: true, message: '教員情報を更新しました', teacher: t });
    }

    // N. 児童アカウントの新規登録（管理者のみ）
    if (action === 'add_student') {
      const s = addStudentRecord(currentTeacher, payload.data || payload);
      return jsonResponse({ success: true, message: '児童を登録しました', student: s });
    }

    // O. 児童データの一括インポート（管理者のみ・Excel/CSV対応）
    if (action === 'import_students') {
      const result = importStudents(currentTeacher, payload.data || payload);
      return jsonResponse({ success: true, message: '児童データをインポートしました', result: result });
    }

    // P. 教員データの一括インポート（管理者のみ・Excel/CSV対応）
    if (action === 'import_teachers') {
      const result = importTeachers(currentTeacher, payload.data || payload);
      return jsonResponse({ success: true, message: '教員データをインポートしました', result: result });
    }

    // Q. 年次更新（管理者のみ）：卒業生の退避・削除
    if (action === 'run_annual_rollover') {
      const result = runAnnualRollover(currentTeacher, payload.data || payload);
      return jsonResponse({ success: true, message: '年次更新を実行しました', result: result });
    }

    // R. 卒業生アーカイブの取得（管理者のみ）
    if (action === 'get_archived_students') {
      const archived = getArchivedStudents(currentTeacher);
      return jsonResponse({ success: true, data: archived });
    }

    // S. 子GAS分散の設定（管理者のみ）
    //    教員コンソールは「1画面」のまま。ここで子GASの割り当てを管理する。
    if (action === 'get_shard_settings') {
      return jsonResponse({ success: true, settings: getShardSettingsForAdmin(),
        is_admin: isAdminTeacher(currentTeacher) });
    }
    if (action === 'save_shard_settings') {
      try {
        const saved = saveShardSettingsForAdmin(currentTeacher, payload.settings || payload);
        return jsonResponse({ success: true, message: '子GASの割り当てを保存しました', settings: saved });
      } catch (e) {
        return jsonResponse({ success: false, error: String(e) });
      }
    }

    return jsonResponse({ success: false, error: 'Unknown action: ' + action });

  } catch (err) {
    return jsonResponse({ success: false, error: err.toString() });
  }
}

/**
 * 教員ログイン認証処理
 */
function handleTeacherLogin(email, password) {
  if (!email || !password) {
    return jsonResponse({ success: false, error: 'メールアドレスとパスワードを入力してください' });
  }

  const sheet = getTargetSheet(CONFIG.TEACHER_SHEET_NAME);
  ensureTeacherHeaders(sheet);
  const headerMap = getHeaderMap(sheet, CONFIG.TEACHER_COLUMNS);
  const data = sheet.getDataRange().getValues();

  const emailColIdx = headerMap['教員ID(メールアドレス)'] - 1;
  const pwColIdx = headerMap['パスワード'] - 1;

  for (let i = 1; i < data.length; i++) {
    const rowEmail = String(data[i][emailColIdx] || '').trim().toLowerCase();
    const rowPw = String(data[i][pwColIdx] || '').trim();

    if (rowEmail === email && rowPw === password) {
      // ログイン成功: 最終ログイン日時を記録
      const nowStr = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');
      if (headerMap['最終ログイン日時']) {
        sheet.getRange(i + 1, headerMap['最終ログイン日時']).setValue(nowStr);
      }

      const defaultWhitelist = 'nhk.or.jp, scratch.mit.edu, google.com';
      const defaultBlacklist = 'youtube.com, twitter.com, tiktok.com, instagram.com';

      const teacher = {
        email: rowEmail,
        name: String(data[i][headerMap['氏名'] - 1] || '教員'),
        school: String(data[i][headerMap['所属学校'] - 1] || '全校管理'),
        role: String(data[i][headerMap['権限'] - 1] || 'TEACHER'),
        target_class: String(data[i][headerMap['対象クラス'] - 1] || ''),
        urls: parseTeacherUrls(data[i][headerMap['登録URL情報'] - 1]),
        filter_whitelist: String(data[i][headerMap['個別ホワイトリスト'] - 1] || defaultWhitelist),
        filter_blacklist: String(data[i][headerMap['個別ブラックリスト'] - 1] || defaultBlacklist)
      };

      const token = generateToken(teacher);
      return jsonResponse({
        success: true,
        token: token,
        teacher: teacher,
        schools: CONFIG.SCHOOL_LIST
      });
    }
  }

  return jsonResponse({ success: false, error: 'メールアドレスまたはパスワードが正しくありません' });
}

/**
 * 簡易署名トークンの生成（24時間有効）
 */
function generateToken(teacher) {
  const payload = {
    email: teacher.email,
    name: teacher.name,
    school: teacher.school,
    role: teacher.role,
    target_class: teacher.target_class || '',
    exp: new Date().getTime() + (24 * 60 * 60 * 1000) // 24h
  };
  const jsonStr = JSON.stringify(payload);
  const base64 = Utilities.base64EncodeWebSafe(jsonStr);
  const signature = Utilities.computeHmacSha256Signature(base64, getTokenSecret());
  const sigBase64 = Utilities.base64EncodeWebSafe(signature);
  return `${base64}.${sigBase64}`;
}

/**
 * トークンの検証
 */
function verifyToken(token) {
  if (!token) return { valid: false };
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return { valid: false };

    const base64 = parts[0];
    const signature = parts[1];

    const expectedSig = Utilities.computeHmacSha256Signature(base64, getTokenSecret());
    const expectedSigBase64 = Utilities.base64EncodeWebSafe(expectedSig);

    if (signature !== expectedSigBase64) return { valid: false };

    const decoded = Utilities.newBlob(Utilities.base64DecodeWebSafe(base64)).getDataAsString();
    const payload = JSON.parse(decoded);

    if (new Date().getTime() > payload.exp) return { valid: false }; // 期限切れ

    return {
      valid: true,
      teacher: {
        email: payload.email,
        name: payload.name,
        school: payload.school,
        role: payload.role,
        target_class: payload.target_class || ''
      }
    };
  } catch (e) {
    return { valid: false };
  }
}

/**
 * 教員アカウントの登録URL情報のパース
 */
function parseTeacherUrls(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  const str = String(val).trim();
  if (!str) return [];
  try {
    const parsed = JSON.parse(str);
    if (Array.isArray(parsed)) {
      return parsed.map(item => {
        if (typeof item === 'string') return { title: item, url: item };
        return {
          title: String(item.title || item.name || item.url || 'URL'),
          url: String(item.url || '')
        };
      }).filter(item => item.url.length > 0);
    }
  } catch (e) {
    const lines = str.split(/[\r\n,]+/).map(s => s.trim()).filter(Boolean);
    return lines.map(line => {
      const parts = line.split('|');
      if (parts.length >= 2) {
        return { title: parts[0].trim(), url: parts[1].trim() };
      }
      return { title: line, url: line };
    });
  }
  return [];
}

/**
 * 教員アカウントの登録URL情報のシリアライズ
 */
function serializeTeacherUrls(urls) {
  if (!urls) return '[]';
  if (typeof urls === 'string') {
    try {
      const p = JSON.parse(urls);
      if (Array.isArray(p)) return JSON.stringify(p);
    } catch (e) {
      return JSON.stringify(parseTeacherUrls(urls));
    }
    return urls;
  }
  if (Array.isArray(urls)) {
    const cleanList = urls.map(item => {
      if (typeof item === 'string') return { title: item, url: item };
      return {
        title: String(item.title || item.url || 'URL').trim(),
        url: String(item.url || '').trim()
      };
    }).filter(item => item.url.length > 0);
    return JSON.stringify(cleanList);
  }
  return '[]';
}

/**
 * 教員アカウントの設定（対象クラス・登録URL・氏名）を取得
 */
function getTeacherSettings(email) {
  if (!email) throw new Error('教員メールアドレスが指定されていません');

  // 【R33】教員マスタは実行をまたいでキャッシュする（既定5分）。
  //   権限・所属校の変更は頻繁ではないため、数分の反映遅延は運用上許容（承認済み）。
  //   保存・更新系は invalidateTeacherCache() で版を進めるので、変更直後は必ず最新。
  let __tKey = '';
  let __tCache = null;
  try {
    if (typeof __teacherCacheKey === 'function' && typeof __cacheSafe === 'function') {
      __tCache = __cacheSafe();
      if (__tCache) {
        __tKey = __teacherCacheKey(email);
        const __hit = __tCache.get(__tKey);
        if (__hit) {
          const __obj = JSON.parse(__hit);
          if (__obj && __obj.email) return __obj;
        }
      }
    }
  } catch (e) { /* キャッシュ不調時はシートから読む */ }

  const sheet = getTargetSheet(CONFIG.TEACHER_SHEET_NAME);
  ensureTeacherHeaders(sheet);
  const headerMap = getHeaderMap(sheet, CONFIG.TEACHER_COLUMNS);
  const data = sheet.getDataRange().getValues();
  const emailColIdx = headerMap['教員ID(メールアドレス)'] - 1;

  for (let i = 1; i < data.length; i++) {
    const rowEmail = String(data[i][emailColIdx] || '').trim().toLowerCase();
    if (rowEmail === email.toLowerCase()) {
      const defaultWhitelist = 'nhk.or.jp, scratch.mit.edu, google.com';
      const defaultBlacklist = 'youtube.com, twitter.com, tiktok.com, instagram.com';
      const __found = {
        email: rowEmail,
        name: String(data[i][headerMap['氏名'] - 1] || '教員'),
        school: String(data[i][headerMap['所属学校'] - 1] || '全校管理'),
        role: String(data[i][headerMap['権限'] - 1] || 'TEACHER'),
        target_class: String(data[i][headerMap['対象クラス'] - 1] || ''),
        urls: parseTeacherUrls(data[i][headerMap['登録URL情報'] - 1]),
        filter_whitelist: String(data[i][headerMap['個別ホワイトリスト'] - 1] || defaultWhitelist),
        filter_blacklist: String(data[i][headerMap['個別ブラックリスト'] - 1] || defaultBlacklist)
      };
      if (__tCache && __tKey) {
        try { __tCache.put(__tKey, JSON.stringify(__found), 300); } catch (e) { /* 容量超過等は無視 */ }
      }
      return __found;
    }
  }
  throw new Error('教員アカウントが見つかりません: ' + email);
}
/**
 * 認証トークン内の教員情報（24時間有効・発行時点のスナップショット）を、
 * 教員マスタシートの「最新レコード」で解決し直す。
 *
 * 背景: トークンは発行時に school / role / target_class を埋め込むため、
 *      管理者が教員の所属学校や権限を後から変更しても、トークンが失効するまで
 *      古い情報でスコープ判定が行われてしまう。特に一般教員(TEACHER)で
 *      「自校の児童が表示されない」不具合の主因となる。
 *      → 各操作の都度シートから最新の所属学校・権限を読み直して判定する。
 *
 * トークンに email が無い / シートに該当が無い 等の場合は、
 * トークンの情報にフォールバックして致命的なエラーにしない。
 */
function resolveCurrentTeacher(authTeacher) {
  if (!authTeacher || !authTeacher.email) return authTeacher;
  try {
    const fresh = getTeacherSettings(authTeacher.email);
    // トークン側の情報よりシートの最新情報を優先（admin 判定に必要）
    return Object.assign({}, authTeacher, fresh);
  } catch (e) {
    Logger.log('教員情報の最新化に失敗（トークン情報を使用）: ' + e);
    return authTeacher;
  }
}

/**
 * 教員アカウントの設定（対象クラス・登録URL・個別規制URL・氏名）を保存
 */
function saveTeacherSettings(email, updateData) {
  if (!email) throw new Error('教員メールアドレスが指定されていません');
  return withWriteLock(function () {

  const sheet = getTargetSheet(CONFIG.TEACHER_SHEET_NAME);
  ensureTeacherHeaders(sheet);
  const headerMap = getHeaderMap(sheet, CONFIG.TEACHER_COLUMNS);
  const data = sheet.getDataRange().getValues();
  const emailColIdx = headerMap['教員ID(メールアドレス)'] - 1;

  let targetRow = -1;
  for (let i = 1; i < data.length; i++) {
    const rowEmail = String(data[i][emailColIdx] || '').trim().toLowerCase();
    if (rowEmail === email.toLowerCase()) {
      targetRow = i + 1;
      break;
    }
  }

  if (targetRow === -1) {
    throw new Error('教員アカウントが見つかりません: ' + email);
  }

  if (updateData.target_class !== undefined && headerMap['対象クラス']) {
    sheet.getRange(targetRow, headerMap['対象クラス']).setValue(String(updateData.target_class).trim());
  }

  if (updateData.urls !== undefined && headerMap['登録URL情報']) {
    sheet.getRange(targetRow, headerMap['登録URL情報']).setValue(serializeTeacherUrls(updateData.urls));
  }

  if (updateData.filter_whitelist !== undefined && headerMap['個別ホワイトリスト']) {
    sheet.getRange(targetRow, headerMap['個別ホワイトリスト']).setValue(String(updateData.filter_whitelist).trim());
  }

  if (updateData.filter_blacklist !== undefined && headerMap['個別ブラックリスト']) {
    sheet.getRange(targetRow, headerMap['個別ブラックリスト']).setValue(String(updateData.filter_blacklist).trim());
  }

  if (updateData.name !== undefined && headerMap['氏名']) {
    sheet.getRange(targetRow, headerMap['氏名']).setValue(String(updateData.name).trim());
  }

  // 【R33】教員マスタを変更したのでキャッシュを全件失効させる（承認済み仕様）。
  try { if (typeof invalidateTeacherCache === 'function') invalidateTeacherCache(); } catch (e) {}
  return getTeacherSettings(email);
  });
}

/**
 * 教員設定の保存内容を権限に応じてサニタイズする。
 * - マイURL（urls）と個別規制URL（filter_whitelist / filter_blacklist）は
 *   TEACHER権限でもアカウント毎に保存できる（要望対応）。
 * - 対象クラス（target_class）は権限の境界であるため、管理者(ADMIN)のみ反映する。
 *   一般教員からの target_class 指定は無視され、シート上の現在値が保持される。
 */
function sanitizeTeacherSettingsForSave(incoming, teacher) {
  const src = incoming || {};
  const safe = {
    filter_whitelist: src.filter_whitelist,
    filter_blacklist: src.filter_blacklist,
    urls: src.urls
  };
  if (isAdminTeacher(teacher) && src.target_class !== undefined) {
    safe.target_class = src.target_class;
  }
  return safe;
}

/**
 * ==================== 管理者(ADMIN)専用：アカウント管理 ====================
 */

// 教員マスタの全件取得（管理者専用）
function getAllTeachers(teacher) {
  if (!isAdminTeacher(teacher)) {
    throw new Error('教員アカウントの管理は管理者のみ可能です');
  }
  const sheet = getTargetSheet(CONFIG.TEACHER_SHEET_NAME);
  ensureTeacherHeaders(sheet);
  const headerMap = getHeaderMap(sheet, CONFIG.TEACHER_COLUMNS);
  const data = sheet.getDataRange().getValues();
  const results = [];
  for (let i = 1; i < data.length; i++) {
    const email = String(data[i][headerMap['教員ID(メールアドレス)'] - 1] || '').trim();
    if (!email) continue;
    results.push({
      email: email,
      name: String(data[i][headerMap['氏名'] - 1] || ''),
      school: String(data[i][headerMap['所属学校'] - 1] || ''),
      role: String(data[i][headerMap['権限'] - 1] || 'TEACHER'),
      target_class: String(data[i][headerMap['対象クラス'] - 1] || ''),
      last_login: headerMap['最終ログイン日時'] ? String(data[i][headerMap['最終ログイン日時'] - 1] || '') : ''
    });
  }
  return results;
}

// 教員アカウントの新規登録（管理者専用）
function addTeacher(teacher, payload) {
  if (!isAdminTeacher(teacher)) {
    throw new Error('教員アカウントの登録は管理者のみ可能です');
  }
  const email = String((payload && payload.email) || '').trim().toLowerCase();
  const password = String((payload && payload.password) || '').trim();
  const name = String((payload && payload.name) || '').trim();
  const school = String((payload && payload.school) || '').trim();
  const role = String((payload && payload.role) || 'TEACHER').trim().toUpperCase();
  const targetClass = String((payload && payload.target_class) || '').trim();
  if (!email) throw new Error('メールアドレスを入力してください');
  if (!password) throw new Error('パスワードを入力してください');
  return withWriteLock(function () {

  const sheet = getTargetSheet(CONFIG.TEACHER_SHEET_NAME);
  ensureTeacherHeaders(sheet);
  const headerMap = getHeaderMap(sheet, CONFIG.TEACHER_COLUMNS);
  const data = sheet.getDataRange().getValues();
  const emailColIdx = headerMap['教員ID(メールアドレス)'] - 1;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][emailColIdx] || '').trim().toLowerCase() === email) {
      throw new Error('このメールアドレスは既に登録されています: ' + email);
    }
  }
  const newRow = new Array(CONFIG.TEACHER_COLUMNS.length).fill('');
  newRow[headerMap['教員ID(メールアドレス)'] - 1] = email;
  newRow[headerMap['パスワード'] - 1] = password;
  newRow[headerMap['氏名'] - 1] = name || '教員';
  newRow[headerMap['所属学校'] - 1] = school || '全校管理';
  newRow[headerMap['権限'] - 1] = role || 'TEACHER';
  newRow[headerMap['対象クラス'] - 1] = targetClass;
  sheet.appendRow(newRow);
  // 【R33】教員を追加したのでキャッシュを失効させる
  try { if (typeof invalidateTeacherCache === 'function') invalidateTeacherCache(); } catch (e) {}
  return getTeacherSettings(email);
  });
}

// 教員アカウントの更新（管理者専用）
function updateTeacherRecord(teacher, payload) {
  if (!isAdminTeacher(teacher)) {
    throw new Error('教員アカウントの編集は管理者のみ可能です');
  }
  return withWriteLock(function () {
  const email = String((payload && payload.email) || '').trim().toLowerCase();
  if (!email) throw new Error('メールアドレスが必要です');
  const sheet = getTargetSheet(CONFIG.TEACHER_SHEET_NAME);
  ensureTeacherHeaders(sheet);
  const headerMap = getHeaderMap(sheet, CONFIG.TEACHER_COLUMNS);
  const data = sheet.getDataRange().getValues();
  const emailColIdx = headerMap['教員ID(メールアドレス)'] - 1;
  let targetRow = -1;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][emailColIdx] || '').trim().toLowerCase() === email) { targetRow = i + 1; break; }
  }
  if (targetRow === -1) throw new Error('教員が見つかりません: ' + email);
  if (payload.password !== undefined && payload.password !== null && String(payload.password).trim() !== '' && headerMap['パスワード']) {
    sheet.getRange(targetRow, headerMap['パスワード']).setValue(String(payload.password).trim());
  }
  if (payload.name !== undefined && headerMap['氏名']) sheet.getRange(targetRow, headerMap['氏名']).setValue(String(payload.name).trim());
  if (payload.school !== undefined && headerMap['所属学校']) sheet.getRange(targetRow, headerMap['所属学校']).setValue(String(payload.school).trim());
  if (payload.role !== undefined && headerMap['権限']) sheet.getRange(targetRow, headerMap['権限']).setValue(String(payload.role).trim().toUpperCase());
  if (payload.target_class !== undefined && headerMap['対象クラス']) sheet.getRange(targetRow, headerMap['対象クラス']).setValue(String(payload.target_class).trim());
  // 【R33】教員情報を更新したのでキャッシュを失効させる（所属校・権限の変更を即反映）
  try { if (typeof invalidateTeacherCache === 'function') invalidateTeacherCache(); } catch (e) {}
  return getTeacherSettings(email);
  });
}

// 児童アカウントの新規登録（管理者専用：手動追加）
function addStudentRecord(teacher, payload) {
  if (!isAdminTeacher(teacher)) {
    throw new Error('児童アカウントの登録は管理者のみ可能です');
  }
  return withWriteLock(function () {
  const studentId = String((payload && payload.student_id) || '').trim();
  if (!studentId) throw new Error('児童ID（Googleアカウント）を入力してください');
  const sheet = getTargetSheet(CONFIG.DEVICE_SHEET_NAME);
  const headerMap = getHeaderMap(sheet, CONFIG.DEVICE_COLUMNS);
  const data = sheet.getDataRange().getValues();
  const idColIdx = headerMap['児童ID'] - 1;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idColIdx] || '').trim() === studentId) {
      throw new Error('この児童IDは既に登録されています: ' + studentId);
    }
  }
  const nowStr = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');
  const newRow = new Array(CONFIG.DEVICE_COLUMNS.length).fill('');
  newRow[headerMap['児童ID'] - 1] = studentId;
  newRow[headerMap['学校名'] - 1] = String((payload && payload.school_name) || '').trim() || '未設定';
  newRow[headerMap['氏名'] - 1] = String((payload && payload.student_name) || '').trim() || '未登録児童';
  newRow[headerMap['クラス'] - 1] = String((payload && payload.class_name) || '').trim() || '未設定';
  newRow[headerMap['画面ロック'] - 1] = false;
  newRow[headerMap['URL規制モード'] - 1] = 'OFF';
  newRow[headerMap['許可URLリスト'] - 1] = 'nhk.or.jp, scratch.mit.edu, google.com';
  newRow[headerMap['規制URLリスト'] - 1] = 'youtube.com, twitter.com, tiktok.com, instagram.com';
  newRow[headerMap['最終同期日時'] - 1] = nowStr;
  sheet.appendRow(newRow);
  // 【R35】新規行を索引にも反映する（次回の全読みを待たない）
  try {
    if (typeof shardIndexUpsert === 'function') {
      shardIndexUpsert([{
        id: studentId,
        school: String(newRow[headerMap['学校名'] - 1] || ''),
        cls: String(newRow[headerMap['クラス'] - 1] || '')
      }]);
    }
  } catch (eIdx) {}
  return { student_id: studentId, school_name: newRow[headerMap['学校名'] - 1], student_name: newRow[headerMap['氏名'] - 1] };
  });
}

/**
 * ==================== 管理者(ADMIN)専用：一括インポート / 年次更新 ====================
 */

/**
 * 児童データの一括インポート（管理者のみ）。
 * Excel(.xlsx)/CSV からフロント側で JSON 配列に変換して渡される想定。
 * 各行は { student_id, student_name, school_name, class_name } を想定（列名は下表）。
 *
 * mode:
 *   'merge'  … 既存児童は更新、新規児童は追加（既定・upsert）
 *   'add'    … 新規のみ追加（既存IDはスキップ）
 *   'replace'… 端末一覧を全置換（画面ロック等の実行状態はリセット）
 *
 * 戻り値: { added, updated, skipped, errors:[...] }
 */
function importStudents(teacher, payload) {
  if (!isAdminTeacher(teacher)) {
    throw new Error('児童データのインポートは管理者のみ可能です');
  }
  const rows = (payload && Array.isArray(payload.rows)) ? payload.rows : [];
  const mode = String((payload && payload.mode) || 'merge').toLowerCase();
  if (!rows.length) throw new Error('インポートするデータがありません');

  return withWriteLock(function () {
    const sheet = getTargetSheet(CONFIG.DEVICE_SHEET_NAME);
    const headerMap = getHeaderMap(sheet, CONFIG.DEVICE_COLUMNS);
    let data = sheet.getDataRange().getValues();

    // replace モードはヘッダー行だけ残して全消去（実行状態もリセット）
    if (mode === 'replace') {
      if (sheet.getLastRow() > 1) {
        sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).clearContent();
      }
      data = sheet.getDataRange().getValues();
    }

    const idColIdx = headerMap['児童ID'] - 1;
    const indexById = {};
    for (let i = 1; i < data.length; i++) {
      const id = String(data[i][idColIdx] || '').trim();
      if (id) indexById[id] = i + 1; // 1-indexed row
    }

    const nowStr = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');
    const addedRows = [];   // 追記する行（一括 append）
    const errors = [];
    let added = 0, updated = 0, skipped = 0;

    rows.forEach(function (raw, idx) {
      const r = raw || {};
      const studentId = String(r.student_id || '').trim();
      if (!studentId) { errors.push('行' + (idx + 2) + ': 児童IDが空です'); skipped++; return; }
      const school = String(r.school_name || '').trim() || '未設定';
      const name = String(r.student_name || '').trim() || '未登録児童';
      const cls = String(r.class_name || '').trim() || '未設定';

      const existingRow = indexById[studentId];
      if (existingRow) {
        if (mode === 'add') { skipped++; return; } // 新規のみ追加モードは既存をスキップ
        sheet.getRange(existingRow, headerMap['学校名']).setValue(school);
        sheet.getRange(existingRow, headerMap['氏名']).setValue(name);
        sheet.getRange(existingRow, headerMap['クラス']).setValue(cls);
        updated++;
        return;
      }

      // 新規行を作成
      const newRow = new Array(CONFIG.DEVICE_COLUMNS.length).fill('');
      newRow[headerMap['児童ID'] - 1] = studentId;
      newRow[headerMap['学校名'] - 1] = school;
      newRow[headerMap['氏名'] - 1] = name;
      newRow[headerMap['クラス'] - 1] = cls;
      newRow[headerMap['画面ロック'] - 1] = false;
      newRow[headerMap['URL規制モード'] - 1] = 'OFF';
      newRow[headerMap['許可URLリスト'] - 1] = 'nhk.or.jp, scratch.mit.edu, google.com';
      newRow[headerMap['規制URLリスト'] - 1] = 'youtube.com, twitter.com, tiktok.com, instagram.com';
      newRow[headerMap['最終同期日時'] - 1] = nowStr;
      addedRows.push(newRow);
      indexById[studentId] = -1; // 同一インポート内の重複を防止
      added++;
    });

    // 新規行はまとめて1回で追記（往復削減）
    if (addedRows.length) {
      const startRow = sheet.getLastRow() + 1;
      sheet.getRange(startRow, 1, addedRows.length, CONFIG.DEVICE_COLUMNS.length).setValues(addedRows);
    }

    // 【R35】インポートした全件を索引に反映する。
    try {
      if (typeof shardIndexUpsert === 'function') {
        const __idxUp = [];
        rows.forEach(function (raw) {
          const r = raw || {};
          const sid = String(r.student_id || '').trim();
          if (!sid) return;
          __idxUp.push({
            id: sid,
            school: String(r.school_name || '').trim() || '未設定',
            cls: String(r.class_name || '').trim() || '未設定'
          });
        });
        if (__idxUp.length) shardIndexUpsert(__idxUp);
      }
    } catch (eIdx) {}

    return { added: added, updated: updated, skipped: skipped, errors: errors };
  });
}

/**
 * 教員データの一括インポート（管理者のみ）。年次更新での教員入れ替えに使用。
 * 各行は { email, password, name, school, role, target_class } を想定。
 * mode: 'merge'(upsert・既定) / 'add'(新規のみ) / 'replace'(教員マスタを全置換)
 * 戻り値: { added, updated, skipped, errors:[...] }
 */
function importTeachers(teacher, payload) {
  if (!isAdminTeacher(teacher)) {
    throw new Error('教員データのインポートは管理者のみ可能です');
  }
  const rows = (payload && Array.isArray(payload.rows)) ? payload.rows : [];
  const mode = String((payload && payload.mode) || 'merge').toLowerCase();
  if (!rows.length) throw new Error('インポートするデータがありません');

  return withWriteLock(function () {
    const sheet = getTargetSheet(CONFIG.TEACHER_SHEET_NAME);
    const headerMap = getHeaderMap(sheet, CONFIG.TEACHER_COLUMNS);

    if (mode === 'replace' && sheet.getLastRow() > 1) {
      sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).clearContent();
    }

    const data = sheet.getDataRange().getValues();
    const emailColIdx = headerMap['教員ID(メールアドレス)'] - 1;
    const indexByEmail = {};
    for (let i = 1; i < data.length; i++) {
      const em = String(data[i][emailColIdx] || '').trim().toLowerCase();
      if (em) indexByEmail[em] = i + 1;
    }

    const nowStr = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');
    const newRows = [];
    const errors = [];
    let added = 0, updated = 0, skipped = 0;

    rows.forEach(function (raw, idx) {
      const r = raw || {};
      const email = String(r.email || '').trim().toLowerCase();
      if (!email) { errors.push('行' + (idx + 2) + ': メールアドレスが空です'); skipped++; return; }
      const password = String(r.password || '').trim();
      const name = String(r.name || '').trim();
      const school = String(r.school || '').trim() || '未設定';
      let role = String(r.role || 'TEACHER').trim().toUpperCase();
      if (role !== 'ADMIN' && role !== 'TEACHER') role = 'TEACHER';
      const targetClass = String(r.target_class || '').trim();

      const existingRow = indexByEmail[email];
      if (existingRow) {
        if (mode === 'add') { skipped++; return; }
        // 既存更新（パスワードは空欄なら変更しない）
        if (password) sheet.getRange(existingRow, headerMap['パスワード']).setValue(password);
        sheet.getRange(existingRow, headerMap['氏名']).setValue(name);
        sheet.getRange(existingRow, headerMap['所属学校']).setValue(school);
        sheet.getRange(existingRow, headerMap['権限']).setValue(role);
        if (headerMap['対象クラス']) sheet.getRange(existingRow, headerMap['対象クラス']).setValue(targetClass);
        updated++;
        return;
      }

      const newRow = new Array(CONFIG.TEACHER_COLUMNS.length).fill('');
      newRow[headerMap['教員ID(メールアドレス)'] - 1] = email;
      newRow[headerMap['パスワード'] - 1] = password;
      newRow[headerMap['氏名'] - 1] = name;
      newRow[headerMap['所属学校'] - 1] = school;
      newRow[headerMap['権限'] - 1] = role;
      if (headerMap['対象クラス']) newRow[headerMap['対象クラス'] - 1] = targetClass;
      newRow[headerMap['最終ログイン日時'] - 1] = '';
      newRows.push(newRow);
      indexByEmail[email] = -1;
      added++;
    });

    if (newRows.length) {
      const startRow = sheet.getLastRow() + 1;
      sheet.getRange(startRow, 1, newRows.length, CONFIG.TEACHER_COLUMNS.length).setValues(newRows);
    }

    // 【R33】教員を一括反映したのでキャッシュを失効させる
    try { if (typeof invalidateTeacherCache === 'function') invalidateTeacherCache(); } catch (e) {}
    return { added: added, updated: updated, skipped: skipped, errors: errors };
  });
}

/**
 * 年次更新（管理者のみ）。
 * 新年度に向けて、指定した児童を「卒業生」シートへ退避し、端末一覧から削除する。
 * ・teacher は ADMIN のみ実行可。
 * ・payload.graduate_ids … 退避・削除する児童IDの配列（空/未指定なら何もしない）
 * ・payload.graduate_filter … { school_name } 指定でその学校の「卒業学年」を自動判定する補助（任意）
 *   （クラス名に含まれる学年が payload.graduation_grade のとき対象。既定は小6・中3=6/3）
 * ・端末一覧のヘッダー行・教員マスタは保持する。
 * 戻り値: { graduated, remaining }
 */
function runAnnualRollover(teacher, payload) {
  if (!isAdminTeacher(teacher)) {
    throw new Error('年次更新は管理者のみ実行できます');
  }
  const p = payload || {};
  const graduateIds = Array.isArray(p.graduate_ids) ? p.graduate_ids.map(x => String(x).trim()).filter(Boolean) : [];
  const schoolFilter = String(p.school_name || '').trim();
  const graduationGrade = String(p.graduation_grade || '').trim(); // 例: '6','3'
  const doGraduate = Boolean(p.graduate !== false); // 既定 true（卒業処理を行う）

  return withWriteLock(function () {
    const deviceSheet = getTargetSheet(CONFIG.DEVICE_SHEET_NAME);
    const archiveSheet = getTargetSheet(CONFIG.ARCHIVE_SHEET_NAME);
    const headerMap = getHeaderMap(deviceSheet, CONFIG.DEVICE_COLUMNS);
    const data = deviceSheet.getDataRange().getValues();
    const idColIdx = headerMap['児童ID'] - 1;
    const schoolColIdx = headerMap['学校名'] - 1;
    const classColIdx = headerMap['クラス'] - 1;

    // 対象児童の判定：
    //  1. graduate_ids が明示されていればそれに一致する児童
    //  2. 未指定なら school_name（任意）× 卒業学年（クラス名に含まれる数字）で自動判定
    const idSet = new Set(graduateIds);
    const useAuto = idSet.size === 0 && (schoolFilter || graduationGrade);

    const targetRows = []; // 端末一覧上の行番号（1-indexed）
    const archiveRows = [];
    for (let i = 1; i < data.length; i++) {
      const id = String(data[i][idColIdx] || '').trim();
      if (!id) continue;
      const school = String(data[i][schoolColIdx] || '').trim();
      const cls = String(data[i][classColIdx] || '').trim();

      let isTarget = false;
      if (idSet.size > 0) {
        isTarget = idSet.has(id);
      } else if (useAuto) {
        if (schoolFilter && !schoolNamesMatch(school, schoolFilter)) continue;
        if (graduationGrade) {
          // クラス名に含まれる学年（最初の数字）が卒業学年と一致するか
          const m = cls.match(/[0-9０-９]+/);
          const grade = m ? normalizeDigits(m[0]) : '';
          isTarget = (grade === normalizeDigits(graduationGrade));
        } else {
          isTarget = true; // 学校のみ指定 → その学校の全児童を対象
        }
      }

      if (isTarget) {
        targetRows.push(i + 1);
        archiveRows.push(data[i].slice());
      }
    }

    if (!doGraduate || !targetRows.length) {
      return { graduated: 0, remaining: data.length - 1 };
    }

    // 1. 卒業生シートへ追記
    if (archiveRows.length) {
      const startRow = archiveSheet.getLastRow() + 1;
      archiveSheet.getRange(startRow, 1, archiveRows.length, CONFIG.DEVICE_COLUMNS.length).setValues(archiveRows);
    }

    // 【R35】削除される児童を索引からも外す（次回の全読みを待たない）
    try {
      if (typeof shardIndexRemove === 'function') {
        const rmIds = [];
        for (let k = 0; k < targetRows.length; k++) {
          const r = data[targetRows[k] - 1] || [];
          const sid = String(r[headerMap['児童ID'] - 1] || '').trim();
          if (sid) rmIds.push(sid);
        }
        if (rmIds.length) shardIndexRemove(rmIds);
      }
    } catch (eIdx) {}

    // 2. 端末一覧から対象行を削除（下から消して行番号ズレを防ぐ）
    targetRows.sort(function (a, b) { return b - a; }).forEach(function (rowNum) {
      deviceSheet.deleteRow(rowNum);
    });

    return { graduated: targetRows.length, remaining: deviceSheet.getLastRow() - 1 };
  });
}

/**
 * 卒業生アーカイブの一覧取得（管理者のみ）。
 */
function getArchivedStudents(teacher) {
  if (!isAdminTeacher(teacher)) {
    throw new Error('卒業生一覧は管理者のみ閲覧できます');
  }
  const sheet = getTargetSheet(CONFIG.ARCHIVE_SHEET_NAME);
  const headerMap = getHeaderMap(sheet, CONFIG.DEVICE_COLUMNS);
  const data = sheet.getDataRange().getValues();
  const out = [];
  for (let i = 1; i < data.length; i++) {
    const id = String(data[i][headerMap['児童ID'] - 1] || '').trim();
    if (!id) continue;
    out.push({
      student_id: id,
      school_name: String(data[i][headerMap['学校名'] - 1] || ''),
      student_name: String(data[i][headerMap['氏名'] - 1] || ''),
      class_name: String(data[i][headerMap['クラス'] - 1] || '')
    });
  }
  return out;
}

/**
 * 全角数字を半角に正規化（卒業学年の比較用）。
 */
function normalizeDigits(s) {
  return String(s || '').replace(/[０-９]/g, function (c) {
    return String.fromCharCode(c.charCodeAt(0) - 0xFEE0);
  });
}

/**
 * 児童端末からのハートビート処理
 */
/**
 * 最終同期日時をシートへ書き込むべきかどうかを判定する（ハートビート高速化用）。
 * 児童端末が増えてもシート書き込みが増えないよう、約20秒間隔に間引く。
 * is_online の判定窓（60秒）より十分細かいため、オンライン表示は保たれる。
 * キャッシュが使えない環境では安全側（毎回書き込み）にフォールバックする。
 */
function shouldWriteSyncTime(studentId, nowMs) {
  const INTERVAL_MS = 20000;
  try {
    const cache = CacheService.getScriptCache();
    const key = 'hbt_' + studentId;
    const last = cache.get(key);
    if (last && (nowMs - Number(last)) < INTERVAL_MS) {
      return false; // 直近20秒以内に書き込み済み → スキップ
    }
    cache.put(key, String(nowMs), 300);
    return true;
  } catch (e) {
    return true; // CacheService が使えない場合は毎回書き込む（安全側）
  }
}

// ==================== 教員コンソールの稼働状態（GAS を共有の調整点にする） ====================
// 課題: 児童端末が常時 1.5 秒間隔でハートビート（doPost）し、管理アプリを開いていなくても
//       GAS 実行が数秒おきに走り続ける（通信負荷）。
// 対策: 「いま教員コンソールがログインして稼働しているか」を GAS 側で一元管理する。
//       ・児童端末はハートビート応答の ka_active を見て、同期周期を切り替える。
//           稼働中（＝管理アプリを誰かが開いている）: 1.5 秒（速い）
//           非稼働（＝管理アプリを誰も開いていない）: 同期しない（doPost = 0）
//       ※ 児童端末は GAS としか通信できないため、GAS を介するのが唯一確実な方法。
//
// 【v1.6.0 変更点】「管理アプリ未起動時の無駄な通信（doPost の数秒おき実行）」を完全に止める。
//   ・旧: 稼働/非稼働いずれでも syncWithGas が動き続けた（非稼働時も 15 秒ごとに doPost）。
//   ・新: 非稼働（ka_active=false）を確認したら児童端末側の同期を完全停止し、doPost を 0 にする。
//   ・ただし「停止」したまま管理アプリが再度開かれても気付けなくなるため、児童端末は
//     稼働→非稼働へ切り替わった直後だけ、ごく短い間（アイドル猶予）に限って低頻度で
//     再確認する。この猶予が尽きたら完全停止し、以後は一切通信しない（管理アプリの再起動は
//     端末側イベント＝タブ作成/URL更新/コンテンツPINGで即再開できる）。
//
// 【複数アカウント対応】
//   ・教員コンソール（管理アプリ）は、ログイン中にセッションID付きで console_touch を送る。
//   ・GAS は「現在生きているセッションID → 最終touch時刻」のマップで稼働を管理する。
//   ・1人のログアウト/タブ閉じ/ブラウザ終了では console_release(そのID) で当該セッションだけを
//     消し、**全セッションが消えたときだけ**非稼働（ka_active=false）になる。
const KA_KEY = 'ka_console';
const KA_PROP_KEY = 'KA_LAST_TOUCH'; // PropertiesService（永続）側のキー（後方互換の残置）
const KA_SESS_KEY = 'ka_sessions';   // 稼働セッションマップ（{sessionId: 最終touchエポックms}）のキャッシュキー
const KA_SESS_PROP_KEY = 'KA_SESSIONS'; // 同マップの PropertiesService 側キー（永続）
const KA_ACTIVE_WINDOW_MS = 120000;  // touch が 120 秒来なければそのセッションは失効とみなす
const KA_MAX_SESSIONS = 200;         // セッションマップの安全上限（際限ない増加を防止）
const KA_IDLE_DRIFT_SEC = 20;        // 稼働→非稼働に切替後、再開を確認するために低頻度(1秒)で再確認する猶予（秒）
const ACTIVE_SYNC_INTERVAL_SEC = 1.5; // 稼働中（管理アプリを誰かが開いている）の児童端末の同期周期（秒）

/**
 * 稼働セッションマップ（{sessionId: 最終touchエポックms}）を CacheService→PropertiesService の
 * 順で読み込む。片方しか無ければ他方で補完し、双方に反映する（キャッシュ失効による取りこぼし防止）。
 */
function readKaSessions() {
  let map = {};
  try {
    const v = CacheService.getScriptCache().get(KA_SESS_KEY);
    if (v) map = JSON.parse(v) || {};
  } catch (e) { map = {}; }
  if (!map || typeof map !== 'object' || Object.keys(map).length === 0) {
    try {
      const p = PropertiesService.getScriptProperties().getProperty(KA_SESS_PROP_KEY);
      if (p) map = JSON.parse(p) || {};
    } catch (e) {}
  }
  if (!map || typeof map !== 'object') map = {};
  return map;
}

/** 稼働セッションマップを CacheService（一時）と PropertiesService（永続）の両方へ保存する。 */
function writeKaSessions(map) {
  const json = JSON.stringify(map || {});
  try { CacheService.getScriptCache().put(KA_SESS_KEY, json, 240); } catch (e) {}
  try { PropertiesService.getScriptProperties().setProperty(KA_SESS_PROP_KEY, json); } catch (e) {}
}

function pruneKaSessions(map, nowMs) {
  const out = {};
  let count = 0;
  Object.keys(map || {}).forEach(function (id) {
    const t = Number(map[id]) || 0;
    if ((nowMs - t) < KA_ACTIVE_WINDOW_MS && count < KA_MAX_SESSIONS) {
      out[id] = t;
      count++;
    }
  });
  return out;
}

/**
 * 教員コンソールの稼働を記録する（ログイン中に 15 秒ごとに呼ばれる）。
 * sessionId をキーにしたマップで管理し、**複数アカウントが同時にログインしていても**
 * 1つのセッションの終了では他の稼働を止めない（全セッションが消えたときだけ非稼働）。
 * sessionId 未指定（後方互換）の場合は単一キーで記録する。
 */
function touchTeacherConsole(sessionId) {
  const nowMs = new Date().getTime();
  const id = String(sessionId || '').trim();

  // 「誰も管理アプリを開いていない」状態からの最初のログインを検出する。
  // この瞬間だけ緊急呼び出しフラグを更新し、眠っている端末を一斉に起こす。
  // 稼働中の 15 秒ごとの touch ではフラグを更新しない（無駄な検知・保存を避ける）。
  let wasActive = true;
  try { wasActive = isTeacherConsoleActive(); } catch (e) { wasActive = true; }

  try {
    const map = pruneKaSessions(readKaSessions(), nowMs);
    map[id || '__default__'] = nowMs;
    writeKaSessions(map);
  } catch (e) {}

  let wakeEpoch = 0;
  if (!wasActive) {
    try { wakeEpoch = bumpWakeEpoch(); } catch (e) { wakeEpoch = 0; }
  }
  // 後方互換（旧バージョンの判定・記録用）。sessionId 無しのときのみ更新する。
  if (!id) {
    try { CacheService.getScriptCache().put(KA_KEY, String(nowMs), 240); } catch (e) {}
    try { PropertiesService.getScriptProperties().setProperty(KA_PROP_KEY, String(nowMs)); } catch (e) {}
  }
  return { success: true, at: nowMs, wake_epoch: (wakeEpoch || readWakeEpoch()) };
}

/**
 * 教員コンソールの稼働を解除する（ログアウト・タブ閉じ・ブラウザ終了時）。
 * ・sessionId 指定時 … そのセッションだけをマップから削除（他アカウントの稼働は維持）
 * ・未指定時         … 全セッションを解除（従来動作）
 */
function releaseTeacherConsole(sessionId) {
  const nowMs = new Date().getTime();
  const id = String(sessionId || '').trim();
  try {
    if (id) {
      const map = pruneKaSessions(readKaSessions(), nowMs);
      delete map[id];
      writeKaSessions(map);
    } else {
      writeKaSessions({});
    }
  } catch (e) {}
  try { CacheService.getScriptCache().remove(KA_KEY); } catch (e) {}
  try { PropertiesService.getScriptProperties().deleteProperty(KA_PROP_KEY); } catch (e) {}
  return { success: true };
}

/**
 * 教員コンソールが稼働中かどうか。
 * 稼働セッションマップに「直近 KA_ACTIVE_WINDOW_MS 以内に touch されたセッション」が残っていれば稼働中。
 * 旧形式（単一キー）が残っている場合も後方互換で考慮する。
 */
function isTeacherConsoleActive() {
  const nowMs = new Date().getTime();
  try {
    const map = pruneKaSessions(readKaSessions(), nowMs);
    if (Object.keys(map).length > 0) return true;
  } catch (e) {}
  // 後方互換: 旧単一キー運用の残置値も見る
  try {
    const v = CacheService.getScriptCache().get(KA_KEY);
    if (v && (nowMs - Number(v)) < KA_ACTIVE_WINDOW_MS) return true;
  } catch (e) {}
  try {
    const p = PropertiesService.getScriptProperties().getProperty(KA_PROP_KEY);
    if (p && (nowMs - Number(p)) < KA_ACTIVE_WINDOW_MS) return true;
  } catch (e) {}
  return false;
}

// ==================== 緊急呼び出し（一斉叩き起こし） ====================
// 課題: 非稼働になると児童端末は同期を完全停止する（通信負荷ゼロのため）。
//       その状態で先生が再ログインしても、端末は眠ったままで復帰できない。
//       「蓋を閉じて開いただけ」では onStartup もタブ生成も発生しないため、
//       端末側に復帰のきっかけが存在しなかった。
// 対策: 誰も稼働していない状態から教員がログインした瞬間に「緊急呼び出しフラグ」
//       （wake_epoch）を更新する。端末は軽量な wake_check でこの値の変化を見て、
//       変化があれば即座に通常のハートビート（詳細なオンライン通知）を送る。
//       wake_check は CacheService / PropertiesService だけを読み、シートに触らない
//       ＝1回あたりの GAS 実行が非常に軽い（通信負荷を増やさないための要）。
const WAKE_CACHE_KEY = 'wake_epoch';
const WAKE_PROP_KEY = 'WAKE_EPOCH_V1';

/** 緊急呼び出しフラグの現在値を読む（0 = まだ一度も発行されていない）。 */
function readWakeEpoch() {
  try {
    const v = CacheService.getScriptCache().get(WAKE_CACHE_KEY);
    if (v) return Number(v) || 0;
  } catch (e) {}
  try {
    const p = PropertiesService.getScriptProperties().getProperty(WAKE_PROP_KEY);
    return Number(p) || 0;
  } catch (e) { return 0; }
}

/** 緊急呼び出しフラグを更新する（この値の変化を端末が検知して起きる）。 */
function bumpWakeEpoch() {
  const nowMs = new Date().getTime();
  try { CacheService.getScriptCache().put(WAKE_CACHE_KEY, String(nowMs), 21600); } catch (e) {}
  try { PropertiesService.getScriptProperties().setProperty(WAKE_PROP_KEY, String(nowMs)); } catch (e) {}
  return nowMs;
}

/**
 * 端末の「起こし確認」用の軽量応答。シートを一切読まない。
 * 端末はこの応答だけで「今すぐ詳細同期すべきか」を判断できる。
 */
function getWakeInfo() {
  const nowMs = new Date().getTime();
  const kaActive = isTeacherConsoleActive();
  return {
    success: true,
    ka_active: kaActive,
    wake_epoch: readWakeEpoch(),
    sync_interval_sec: kaActive ? ACTIVE_SYNC_INTERVAL_SEC : 0,
    idle_drift_until: kaActive ? 0 : (nowMs + (KA_IDLE_DRIFT_SEC * 1000)),
    server_time: nowMs
  };
}

/**
 * 児童端末の同期周期（秒）を GAS から一元配布する。
 *   ・稼働中（管理アプリを誰かが開いている）            : 1.5 秒（速い反映）
 *   ・非稼働（誰も開いていない）                        : 0（同期しない＝doPost を発生させない）
 *   ・稼働→非稼働へ切り替わってから KA_IDLE_DRIFT_SEC 秒以内: 1 秒（低頻度で再開を確認する猶予）
 * これにより「管理アプリを起動していないときは通信しない」を GAS 主導で制御できる
 * （GAS を更新すれば児童端末の拡張機能を再配布しなくても挙動を切り替えられる）。
 */
function computeKaInterval(res, nowMs) {
  const sec = typeof res === 'number' ? res : Number(res);
  const idleDriftUntil = nowMs + (KA_IDLE_DRIFT_SEC * 1000);
  if (!isFinite(sec) || sec <= 0) {
    return { ka_active: false, sync_interval_sec: 0, idle_drift_until: idleDriftUntil };
  }
  return { ka_active: true, sync_interval_sec: sec, idle_drift_until: 0 };
}

/**
 * 端末から届いた学校名を、端末一覧に書いてよい正式名称へ解決する。
 *
 * heartbeat は認証不要のため、任意の文字列をそのままシートへ書き込むと
 * 学校スコープ（教員が自校の児童だけを見る境界）を欺けてしまう。
 * そこで CONFIG.SCHOOL_LIST に解決できた正式名称だけを受け付け、
 * 解決できない値は「情報なし」として扱う（シートは従来どおり未設定のまま）。
 */
function canonicalizeIncomingSchool(raw) {
  const s = String(raw || '').trim();
  if (!s || s === '未設定') return '';
  if (typeof normalizeSchoolName !== 'function') return '';
  if (!CONFIG || !Array.isArray(CONFIG.SCHOOL_LIST)) return '';

  const n = normalizeSchoolName(s);
  if (!n) return '';

  // 1. 正式名称との完全一致（「美作市立〜」等の接頭辞は normalizeSchoolName が吸収する）
  for (let i = 0; i < CONFIG.SCHOOL_LIST.length; i++) {
    if (normalizeSchoolName(CONFIG.SCHOOL_LIST[i]) === n) return CONFIG.SCHOOL_LIST[i];
  }

  // 2. 明示的に定義した略称のみ許可（「英田小」「大原小」等）
  if (typeof SCHOOL_ALIASES === 'object' && SCHOOL_ALIASES) {
    for (const alias in SCHOOL_ALIASES) {
      if (normalizeSchoolName(alias) === n) {
        const canon = SCHOOL_ALIASES[alias];
        if (CONFIG.SCHOOL_LIST.indexOf(canon) !== -1) return canon;
      }
    }
  }

  // 3. 部分一致は使わない。
  //    resolveCanonicalSchool は「学校」「小」のような曖昧な入力でも先頭の学校に
  //    一致させてしまうため、認証不要の heartbeat から受け取る値の検証には使わない。
  return '';
}

// ==================== AI監視（学習に関係のないサイトの検知） ====================
// 判定方式はハイブリッド:
//   (a) あらかじめ用意したドメイン辞書（学習ドメイン / 非学習ドメイン）
//   (b) 先生が登録するリスト（端末の「許可URLリスト」「規制URLリスト」）
// 判定の優先順位（誤検知を避けるため「許可」を最優先にする）:
//   1. 端末の許可URLリストに一致            -> 注意しない
//   2. 学習ドメイン辞書に一致              -> 注意しない
//   3. 端末の規制URLリストに一致            -> 要注意（明示的に規制されたサイト）
//   4. 非学習ドメイン辞書に一致            -> 要注意（学習に関係のないサイト）
//   5. どれにも一致しない                  -> 注意しない（未知サイトは黙認）
// これにより、先生が許可URLリストへ追加すれば辞書より優先して誤検知を打ち消せる。
//
// システム全体のON/OFF は PropertiesService に保存し、管理者のみ変更できる。

/** 監視設定の保存キー（PropertiesService のスクリプトプロパティ） */
const MONITOR_PROP_KEY = 'MONITOR_SETTINGS_V1';

/** 辞書に登録できるドメイン数の上限（異常に大きな設定でGASが重くならないように） */
const MONITOR_MAX_DOMAINS = 500;

/** 既定の学習ドメイン（= 注意マークを出さないサイト） */
const MONITOR_DEFAULT_LEARNING_DOMAINS = [
  'google.com', 'google.co.jp', 'gstatic.com', 'googleusercontent.com',
  'classroom.google.com', 'docs.google.com', 'drive.google.com', 'sites.google.com',
  'meet.google.com', 'forms.google.com', 'jamboard.google.com',
  'microsoft.com', 'office.com', 'microsoftonline.com', 'live.com',
  'apple.com', 'icloud.com',
  'nhk.or.jp', 'nhk.jp',
  'scratch.mit.edu', 'code.org', 'codehs.com', 'eboard.ch',
  'tokyoshoseki.co.jp', 'gakken.co.jp', 'benesse.co.jp', 'z-kai.co.jp',
  'monoxer.com', 'qwerty.jp', 'atama-plus.jp', 'loilo.tv',
  'wikipedia.org', 'kotobank.jp', 'weblio.jp', 'jisho.org', 'britannica.com',
  'geogebra.org', 'desmos.com', 'wolframalpha.com', 'phet.colorado.edu',
  'typing.com', 'typingclub.com',
  'canva.com', 'figma.com', 'miro.com', 'padlet.com', 'edpuzzle.com',
  'kahoot.com', 'nearpod.com', 'seesaw.me', 'classdojo.com'
];

/** 既定の非学習ドメイン（= 開いていると注意マークを出すサイト） */
const MONITOR_DEFAULT_BLOCKED_DOMAINS = [
  // 動画・配信
  'youtube.com', 'youtu.be', 'niconico.jp', 'nicovideo.jp', 'dailymotion.com',
  'abema.tv', 'hulu.com', 'netflix.com', 'disneyplus.com', 'primevideo.com',
  // SNS・掲示板
  'tiktok.com', 'twitter.com', 'x.com', 'instagram.com', 'facebook.com',
  'threads.net', 'snapchat.com', 'reddit.com', 'pinterest.com', 'tumblr.com',
  'line.me', 'discord.com', 'twitch.tv',
  // ゲーム
  'roblox.com', 'minecraft.net', 'fortnite.com', 'epicgames.com',
  'steampowered.com', 'riotgames.com', 'poki.com', 'coolmathgames.com',
  'crazygames.com', 'kongregate.com', 'miniclip.com', 'y8.com', 'friv.com',
  'addictinggames.com', 'silvergames.com',
  // 音楽・通販
  'spotify.com', 'soundcloud.com',
  'amazon.co.jp', 'rakuten.co.jp', 'mercari.com'
];

/**
 * URL からホスト名だけを取り出して正規化する。
 * 例: https://www.YouTube.com/watch?v=x -> youtube.com
 * GAS(V8) には WHATWG URL が無いため正規表現で処理する。
 */
function normalizeMonitorHost(rawUrl) {
  let s = String(rawUrl || '').trim().toLowerCase();
  if (!s) return '';
  s = s.replace(/^[a-z][a-z0-9+.\-]*:\/\//, ''); // スキーム除去
  s = s.replace(/^\/\//, '');                     // プロトコル相対
  s = s.split(/[\/?#]/)[0];                       // パス・クエリ・ハッシュ除去
  s = s.split('@').pop();                         // userinfo 除去
  s = s.replace(/:\d+$/, '');                     // ポート除去
  s = s.replace(/^www\./, '');                    // www. 除去
  s = s.replace(/\.$/, '');                       // 末尾ドット除去
  return s;
}

/**
 * ホスト名がドメイン一覧のいずれかに一致するか。
 * 完全一致に加え、サブドメイン一致（host が ".<domain>" で終わる）も許可する。
 * 例: docs.google.com は google.com に一致する。
 */
function hostMatchesAnyDomain(host, domains) {
  const h = String(host || '').trim().toLowerCase();
  if (!h) return false;
  if (!Array.isArray(domains)) return false;
  for (let i = 0; i < domains.length; i++) {
    const d = normalizeMonitorHost(domains[i]);
    if (!d) continue;
    if (h === d) return true;
    if (h.length > d.length && h.slice(-(d.length + 1)) === '.' + d) return true;
  }
  return false;
}

/**
 * 監視設定を取得する。未保存なら既定値（enabled=false）を返す。
 * enabled の既定は false（明示的にONにしない限り注意マークは出さない）。
 */
function getMonitoringSettings() {
  const defaults = {
    enabled: false,
    learning_domains: MONITOR_DEFAULT_LEARNING_DOMAINS.slice(),
    blocked_domains: MONITOR_DEFAULT_BLOCKED_DOMAINS.slice(),
    updated_at: '',
    updated_by: ''
  };
  try {
    if (typeof PropertiesService === 'undefined') return defaults;
    const raw = PropertiesService.getScriptProperties().getProperty(MONITOR_PROP_KEY);
    if (!raw) return defaults;
    const o = JSON.parse(raw);
    if (!o || typeof o !== 'object') return defaults;
    return {
      enabled: o.enabled === true,
      learning_domains: Array.isArray(o.learning_domains)
        ? o.learning_domains.map(function (v) { return String(v); })
        : defaults.learning_domains,
      blocked_domains: Array.isArray(o.blocked_domains)
        ? o.blocked_domains.map(function (v) { return String(v); })
        : defaults.blocked_domains,
      updated_at: String(o.updated_at || ''),
      updated_by: String(o.updated_by || '')
    };
  } catch (e) {
    return defaults;
  }
}

/**
 * 管理者が送ってきたドメイン一覧を正規化・重複除去して安全な配列にする。
 */
function sanitizeMonitorDomainList(list) {
  const out = [];
  const seen = {};
  if (!Array.isArray(list)) return out;
  for (let i = 0; i < list.length && out.length < MONITOR_MAX_DOMAINS; i++) {
    const d = normalizeMonitorHost(list[i]);
    if (!d) continue;
    // ホスト名として妥当な文字だけ許可（空白・山括弧等を弾く）
    if (!/^[a-z0-9.\-]+$/.test(d)) continue;
    if (seen[d]) continue;
    seen[d] = true;
    out.push(d);
  }
  return out;
}

/**
 * 監視設定を保存する（管理者のみ）。システム全体に効く。
 */
function saveMonitoringSettings(teacher, incoming) {
  if (!isAdminTeacher(teacher)) {
    throw new Error('監視設定を変更できるのは管理者のみです');
  }
  const cur = getMonitoringSettings();
  const src = incoming || {};

  const next = {
    enabled: (src.enabled !== undefined) ? (src.enabled === true) : cur.enabled,
    learning_domains: Array.isArray(src.learning_domains)
      ? sanitizeMonitorDomainList(src.learning_domains)
      : cur.learning_domains,
    blocked_domains: Array.isArray(src.blocked_domains)
      ? sanitizeMonitorDomainList(src.blocked_domains)
      : cur.blocked_domains,
    updated_at: Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss'),
    updated_by: String((teacher && teacher.email) || '')
  };

  PropertiesService.getScriptProperties().setProperty(MONITOR_PROP_KEY, JSON.stringify(next));
  // 一覧の読み取りキャッシュを捨てて、次の取得で新しい設定を反映させる
  if (typeof invalidateDevicesCache === 'function') invalidateDevicesCache();
  return next;
}

/**
 * 監視判定の対象になるURLか（http/https のみ対象）。
 * chrome:// / chrome-extension:// / about: / file: / view-source: / devtools: 等は
 * 学習に関係のないサイト判定の対象外とする（誤検知防止）。
 * スキームが無い「裸のホスト名」（設定画面の手入力など）は http 相当として許可する。
 */
function isWebUrlForMonitoring(rawUrl) {
  const s = String(rawUrl || '').trim().toLowerCase();
  if (!s) return false;
  // スキーム無し（例: youtube.com/watch）は許可
  if (!/^[a-z][a-z0-9+.\-]*:/.test(s)) return true;
  // http / https のみ許可
  return /^https?:/.test(s);
}

/**
 * URL を監視ルールで評価する。
 * 戻り値: { flagged: boolean, reason: string, host: string }
 */
function evaluateUrlForMonitoring(rawUrl, whitelistUrls, blacklistUrls) {
  const settings = getMonitoringSettings();
  if (!settings.enabled) return { flagged: false, reason: '', host: '' };

  // 内部ページ・拡張機能ページ・ローカルファイルは判定対象外。
  // ※ ホスト名ではなく「元のURLのスキーム」で判定する。
  //   chrome://settings/ はホスト名抽出後に 'settings' となり、
  //   ホスト名だけを見る判定では内部ページを確実に弾けないため。
  if (!isWebUrlForMonitoring(rawUrl)) {
    return { flagged: false, reason: '', host: '' };
  }

  const host = normalizeMonitorHost(rawUrl);
  if (!host) return { flagged: false, reason: '', host: '' };

  // 1. 端末の許可URLリスト（先生が明示的に許可したサイト）が最優先
  if (hostMatchesAnyDomain(host, parseUrlList(whitelistUrls))) {
    return { flagged: false, reason: '', host: host };
  }

  // 2. 学習ドメイン辞書
  if (hostMatchesAnyDomain(host, settings.learning_domains)) {
    return { flagged: false, reason: '', host: host };
  }

  // 3. 端末の規制URLリスト（先生が明示的に規制したサイト）
  if (hostMatchesAnyDomain(host, parseUrlList(blacklistUrls))) {
    return { flagged: true, reason: '規制URLリストのサイト（' + host + '）', host: host };
  }

  // 4. 非学習ドメイン辞書（学習に関係のないサイト）
  if (hostMatchesAnyDomain(host, settings.blocked_domains)) {
    return { flagged: true, reason: '学習に関係のないサイト（' + host + '）', host: host };
  }

  // 5. 未知のサイトは注意しない（誤検知を避ける）
  return { flagged: false, reason: '', host: host };
}

/**
 * 監視がOFFのときは、シートに残っている注意フラグを伏せて返す。
 * これにより管理画面の注意マークが即座に消える（データは保持したまま非表示）。
 */
function applyMonitorVisibility(devices) {
  if (!Array.isArray(devices)) return devices;
  let enabled = false;
  try {
    enabled = getMonitoringSettings().enabled === true;
  } catch (e) {
    enabled = false;
  }
  if (enabled) return devices;
  for (let i = 0; i < devices.length; i++) {
    if (devices[i] && typeof devices[i] === 'object') {
      devices[i].monitor_flag = false;
      devices[i].monitor_reason = '';
      devices[i].monitor_url = '';
      devices[i].monitor_at = '';
    }
  }
  return devices;
}


// ==================== ハートビート用 行解決（キャッシュ廃止・毎回シートから引き直す） ====================
// 【バックエンド修正（拡張機能の版数は据え置き）：行番号キャッシュの廃止】
//   以前は児童ごとに「行番号」を CacheService へ最大6時間保持していた（旧 hbGetCachedRow）。
//   しかし書き込み版 dev_v は「教員が管理画面から書き込んだとき」しか進まないため、
//   スプレッドシート上で直接 行の削除・挿入・並べ替え を行うと、版は変わらないまま
//   行番号だけがズレる。実機では 2 行目の児童が 3 行目（空行）に書かれ、
//   A〜D列が空欄のまま K列/L列 だけが更新される事故になった（getLastRow() が 3 に）。
//
//   再発防止のため、行番号は一切キャッシュせず、毎回シートから児童IDで引き直す。
//   ヘッダー位置も同様に毎回読む（列の挿入・削除でも壊れないようにする）。
//   追加コストは 1 リクエストあたり getDataRange 1 回＋ヘッダー1行のみ。
//   行検索は文字列比較の線形走査なので、数百行規模では体感差はない。
//
// 【実測用ログ】
//   HB_DEBUG_LOG を true にすると、経路・探索結果・書き込み先の行番号を
//   実行ログへ出す。原因調査が済んだら false に戻す（既定 false）。
const HB_DEBUG_LOG = true; // ← 実測が終わったら false に戻してください
const HB_LOG_PREFIX = '[HB]';

/** 実測用ログ。HB_DEBUG_LOG=false のときは何もしない（本番の負荷を増やさない）。 */
function hbLog(msg) {
  if (!HB_DEBUG_LOG) return;
  try { Logger.log(HB_LOG_PREFIX + ' ' + msg); } catch (e) {}
}

/**
 * 児童IDから「いま何行目か」を引き直す（キャッシュしない）。
 *
 * 【返り値】
 *   { rowNum, row, total, orphanRowNum }
 *     rowNum      … 見つかった行番号（1-indexed）。見つからなければ -1
 *     row         … その行の値配列（見つかったときのみ）
 *     total       … シートの総行数（ヘッダー含む）
 *     orphanRowNum… 児童IDが空の行のうち最初のもの（過去の行ズレ事故の残骸）。
 *                   新規登録時に再利用して、空行を増やさず掃除するために使う。
 *
 * 【なぜキャッシュしないのか】
 *   行番号は他の行の増減で簡単に変わる。CacheService に保持すると
 *   「シート上で行を消した／挿入した」だけで恒久的にズレたままになる。
 *   数百行の線形走査はミリ秒未満なので、毎回引き直す方が安全で十分に速い。
 */
function hbResolveRowByStudentId(sheet, headerMap, studentId) {
  const idColIdx = headerMap['児童ID'] - 1;
  const data = sheet.getDataRange().getValues();
  const total = data.length;
  if (idColIdx < 0) {
    hbLog('resolve: 児童ID列が見つかりません（ヘッダー異常）');
    return { rowNum: -1, row: null, total: total, orphanRowNum: -1 };
  }

  const wantId = normalizeIdKey(studentId);
  if (!wantId) {
    hbLog('resolve: 児童IDが空のため照合しません');
    return { rowNum: -1, row: null, total: total, orphanRowNum: -1 };
  }

  // 一致行と「児童IDが空の残骸行」を 1 回の走査で確定させる。
  // 途中で return すると、一致行より後ろにある残骸行を見落とすため、
  // 最後まで走査する（data はメモリ上の配列なので追加の API 呼び出しは無い）。
  let orphanRowNum = -1;
  let foundRowNum = -1;
  let foundRow = null;
  let foundRawId = '';
  // 【表記ゆれの相互吸収】端末によっては student_id がメール全体で届くことも
  //   ローカル部だけで届くこともある。完全一致を第一とし、見つからない
  //   場合に限りローカル部一致の候補を1件だけ採用する。
  //   候補が複数あるときは別児童の可能性があるため解決せず、
  //   新規登録に回す（誤って別の児童の行へ書くより安全）。
  const looseRowNums = [];
  for (let i = 1; i < total; i++) {
    const rawId = data[i] ? data[i][idColIdx] : '';
    const key = normalizeIdKey(rawId);
    if (!key) {
      if (orphanRowNum < 0) orphanRowNum = i + 1;
      continue;
    }
    if (foundRowNum < 0 && key === wantId) {
      foundRowNum = i + 1;
      foundRow = data[i];
      foundRawId = rawId;
      continue;
    }
    if (idKeysMatch_(rawId, studentId)) looseRowNums.push(i + 1);
  }
  if (foundRowNum < 0 && looseRowNums.length === 1) {
    const ln = looseRowNums[0];
    foundRowNum = ln;
    foundRow = data[ln - 1];
    foundRawId = data[ln - 1] ? data[ln - 1][idColIdx] : '';
    hbLog('resolve: ローカル部一致で解決 row=' + ln + ' id=' + String(foundRawId) +
      ' 要求=' + studentId);
  } else if (foundRowNum < 0 && looseRowNums.length > 1) {
    hbLog('resolve: ローカル部一致が複数(' + looseRowNums.length + '件)のため解決しません id=' + studentId);
  }

  if (foundRowNum >= 0) {
    hbLog('resolve: 一致 row=' + foundRowNum + ' id=' + String(foundRawId) +
      ' (総行数=' + total + ', 空ID行の先頭=' + orphanRowNum + ')');
    return { rowNum: foundRowNum, row: foundRow, total: total, orphanRowNum: orphanRowNum };
  }

  hbLog('resolve: 不一致 id=' + studentId + ' (総行数=' + total +
    ', 空ID行の先頭=' + orphanRowNum + ')');
  return { rowNum: -1, row: null, total: total, orphanRowNum: orphanRowNum };
}

/**
 * ハートビート応答を1か所で組み立てる（3経路の重複を排除し、項目の欠けを防ぐ）。
 */
function buildHeartbeatResponse(row, headerMap, studentId, kaActive, kaInfo, now) {
  const reqCol = headerMap['画面情報要求日時'];
  const shotCol = headerMap['画面情報更新日時'];
  const monFlagCol = headerMap['要注意'];
  const monReasonCol = headerMap['注意理由'];

  // 【フェーズ3】スケジュール（タイマー）の配信。
  //   端末は受信した時間窓を storage にキャッシュし、chrome.alarms で
  //   「開始時刻ちょうど／終了時刻ちょうど」に発動する。オフラインでも
  //   予約が効くのはこのキャッシュがあるため。
  //   ※ 予約シートが読めなくてもハートビート自体は必ず返す（監視を止めない）。
  const schClassName = String(row[headerMap['クラス'] - 1] || '');
  const schSchoolName = String(row[headerMap['学校名'] - 1] || '');
  // server_time（文字列）と同じ瞬間を ms で表す。sheetTsToMs は JST 決め打ちなので
  // 実行環境のタイムゾーンに依存せず、server_time と server_time_ms がずれない。
  let serverTimeMs = 0;
  try { serverTimeMs = sheetTsToMs(now); } catch (eMs) { serverTimeMs = 0; }
  if (!serverTimeMs) serverTimeMs = new Date().getTime();

  let schedulesPayload = { active: [], upcoming: [], overridden_ids: [] };
  try {
    // 【フェーズ5】子GASは親から受け取った展開済みキャッシュだけを見る
    //   （シート読みを挟まないので、端末への応答が速い）。
    schedulesPayload = resolveSchedulePayloadForDevice_(
      studentId, schClassName, schSchoolName, serverTimeMs);
  } catch (eSch) {
    try { Logger.log('[SCHEDULE] payload build failed: ' + eSch); } catch (eLog) {}
  }

  return {
    student_id: studentId,
    school_name: String(row[headerMap['学校名'] - 1] || ''),
    student_name: String(row[headerMap['氏名'] - 1] || ''),
    class_name: String(row[headerMap['クラス'] - 1] || ''),
    screen_lock: parseBoolean(row[headerMap['画面ロック'] - 1]),
    filter_mode: String(row[headerMap['URL規制モード'] - 1] || 'OFF').toUpperCase(),
    whitelist_urls: parseUrlList(row[headerMap['許可URLリスト'] - 1]),
    blacklist_urls: parseUrlList(row[headerMap['規制URLリスト'] - 1]),
    broadcast_url: String(row[headerMap['一斉表示URL'] - 1] || '').trim(),
    broadcast_id: String(row[headerMap['一斉表示実行ID'] - 1] || '').trim(),
    current_url: String(row[headerMap['現在開いているURL'] - 1] || ''),
    screen_request_at: reqCol ? String(row[reqCol - 1] || '').trim() : '',
    screenshot_at: shotCol ? String(row[shotCol - 1] || '').trim() : '',
    monitor_flag: monFlagCol ? parseBoolean(row[monFlagCol - 1]) : false,
    monitor_reason: monReasonCol ? String(row[monReasonCol - 1] || '') : '',
    ka_active: kaActive,
    sync_interval_sec: kaInfo.sync_interval_sec,
    idle_drift_until: kaInfo.idle_drift_until,
    server_time: now,
    // 【フェーズ3】端末の時計補正とスケジュール判定のための配信契約。
    //   server_time_ms … server_time と同じ瞬間の epoch ms（端末はこれで時計を補正）
    //   schedules      … { active, upcoming, overridden_ids }
    //                    active=いま効いている窓 / upcoming=直近の1件 / overridden=解除済みID
    server_time_ms: serverTimeMs,
    schedules: schedulesPayload
  };
}

/**
 * AI監視（学習に関係のないサイトの検知）。
 * URL が変わったときだけ呼ばれ、4列が連続している場合のみ 1 回の getRange でまとめて書く。
 * 監視が OFF のときは列に一切触らない（履歴を保持したまま、表示側で伏せる）。
 */
function hbApplyMonitor(sheet, rowNum, row, headerMap, currentUrl, now) {
  const monFlagCol = headerMap['要注意'];
  const monReasonCol = headerMap['注意理由'];
  const monUrlCol = headerMap['要注意URL'];
  const monAtCol = headerMap['注意検知日時'];
  const contiguous = monFlagCol && monReasonCol && monUrlCol && monAtCol &&
    monReasonCol === monFlagCol + 1 && monUrlCol === monFlagCol + 2 && monAtCol === monFlagCol + 3;
  if (!contiguous) return;

  let monSettings = null;
  try { monSettings = getMonitoringSettings(); } catch (e) { monSettings = null; }
  if (!monSettings || !monSettings.enabled) return;

  const mon = evaluateUrlForMonitoring(
    currentUrl,
    row[headerMap['許可URLリスト'] - 1],
    row[headerMap['規制URLリスト'] - 1]
  );
  const prevFlag = parseBoolean(row[monFlagCol - 1]);
  if (mon.flagged === prevFlag) return; // 状態が変わったときだけ書く

  sheet.getRange(rowNum, monFlagCol, 1, 4).setValues([[
    mon.flagged,
    mon.flagged ? mon.reason : '',
    mon.flagged ? (mon.host || '') : '',
    mon.flagged ? now : ''
  ]]);
  row[monFlagCol - 1] = mon.flagged;
  row[monReasonCol - 1] = mon.flagged ? mon.reason : '';
  row[monUrlCol - 1] = mon.flagged ? (mon.host || '') : '';
  row[monAtCol - 1] = mon.flagged ? now : '';
}

/**
 * 新規自動登録（児童Googleアカウント対応）。
 * 同一アカウントが複数端末から同時に、または連続してアクセスした場合に
 * 重複行が作成されないよう、書き込みロック内で「再確認 → 登録」を行う。
 */
function hbRegisterDevice(studentId, currentUrl, incomingSchool, kaInfo, kaActive, now) {
  hbLog('register: 開始 id=' + studentId + ' url=' + currentUrl);
  return withWriteLock(function () {
    const sheet = getTargetSheet(CONFIG.DEVICE_SHEET_NAME);
    const headerMap = getHeaderMap(sheet, CONFIG.DEVICE_COLUMNS);
    const data = sheet.getDataRange().getValues();
    const idColIdx = headerMap['児童ID'] - 1;

    // 再確認（同時アクセス対策）。あわせて「児童IDが空の残骸行」も探す。
    // 残骸行＝過去の行ズレ事故で K列/L列 だけが書かれた行。新規行を増やさず再利用する。
    const wantId = normalizeIdKey(studentId);
    let reRow = -1;
    let orphanRowNum = -1;
    for (let i = 1; i < data.length; i++) {
      const key = normalizeIdKey(data[i][idColIdx]);
      if (!key) {
        if (orphanRowNum < 0) orphanRowNum = i + 1;
        continue;
      }
      if (key === wantId) { reRow = i + 1; break; }
    }
    hbLog('register: 再確認 reRow=' + reRow + ' 残骸行=' + orphanRowNum +
      ' 総行数=' + data.length);

    if (reRow !== -1) {
      // 先に登録されていた（同時アクセス）。学校名が未設定なら補完して返す。
      const row = data[reRow - 1];
      const reSchoolCol = headerMap['学校名'];
      if (incomingSchool && reSchoolCol) {
        const reSchool = String(row[reSchoolCol - 1] || '').trim();
        if (!reSchool || reSchool === '未設定') {
          sheet.getRange(reRow, reSchoolCol).setValue(incomingSchool);
          row[reSchoolCol - 1] = incomingSchool;
        }
      }
      hbLog('register: 既に登録済み（同時アクセス）row=' + reRow + ' → 新規行は作らない');
      return buildHeartbeatResponse(row, headerMap, studentId, kaActive, kaInfo, now);
    }

    let initialName = '未登録児童 (' + studentId + ')';
    if (studentId.indexOf('@') !== -1) {
      const userPart = studentId.split('@')[0];
      initialName = userPart + ' (Googleアカウント)';
    }
    let initialClass = '未設定';
    let initialSchool = incomingSchool || '未設定';

    // 子GASの初回登録時: 親の名簿に載っていれば、最初から正しい氏名・クラスで作る。
    // （後から補完するより、A〜D列が空の行を一瞬も作らない方が運用上きれい）
    if (typeof hbChildIdentityLookup === 'function') {
      try {
        const info = hbChildIdentityLookup(studentId);
        if (info && info.found) {
          const n = String(info.student_name || '').trim();
          const c = String(info.class_name || '').trim();
          const s = String(info.school_name || '').trim();
          if (n && n !== '未設定') initialName = n;
          if (c && c !== '未設定') initialClass = c;
          if (s && s !== '未設定') initialSchool = s;
        }
      } catch (e) { /* 名簿照会に失敗しても登録自体は続ける */ }
    }

    const newRow = new Array(CONFIG.DEVICE_COLUMNS.length).fill('');
    newRow[headerMap['児童ID'] - 1] = studentId;
    newRow[headerMap['学校名'] - 1] = initialSchool;
    newRow[headerMap['氏名'] - 1] = initialName;
    newRow[headerMap['クラス'] - 1] = initialClass;
    newRow[headerMap['画面ロック'] - 1] = false;
    newRow[headerMap['URL規制モード'] - 1] = 'OFF';
    newRow[headerMap['許可URLリスト'] - 1] = 'nhk.or.jp, scratch.mit.edu, google.com';
    newRow[headerMap['規制URLリスト'] - 1] = 'youtube.com, twitter.com, tiktok.com, instagram.com';
    newRow[headerMap['現在開いているURL'] - 1] = currentUrl;
    newRow[headerMap['最終同期日時'] - 1] = now;

    // AI監視: 初回登録時点のURLも判定する（監視OFFなら何もしない＝既定は空欄）。
    let newMon = { flagged: false, reason: '', host: '' };
    try {
      newMon = evaluateUrlForMonitoring(
        currentUrl,
        newRow[headerMap['許可URLリスト'] - 1],
        newRow[headerMap['規制URLリスト'] - 1]
      );
    } catch (e) {
      newMon = { flagged: false, reason: '', host: '' };
    }
    if (headerMap['要注意']) newRow[headerMap['要注意'] - 1] = newMon.flagged;
    if (headerMap['注意理由']) newRow[headerMap['注意理由'] - 1] = newMon.flagged ? newMon.reason : '';
    if (headerMap['要注意URL']) newRow[headerMap['要注意URL'] - 1] = newMon.flagged ? (newMon.host || '') : '';
    if (headerMap['注意検知日時']) newRow[headerMap['注意検知日時'] - 1] = newMon.flagged ? now : '';

    // 児童IDが空の残骸行（過去の行ズレ事故の跡）があれば、新規行を増やさずに
    // その行へ全体を書き直して掃除する。getLastRow() が水増しされたままにならない。
    if (orphanRowNum >= 2) {
      hbLog('register: 残骸行を再利用 row=' + orphanRowNum +
        '（新規行は追加しない） id=' + studentId);
      sheet.getRange(orphanRowNum, 1, 1, CONFIG.DEVICE_COLUMNS.length).setValues([newRow]);
      // 【R35】新規登録された端末を索引にも反映する。
    //   ここを漏らすと、初回ログイン直後の子童が一覧/配信の対象から漏れる。
    try {
      if (typeof shardIndexUpsert === 'function') {
        shardIndexUpsert([{
          id: studentId,
          school: String(newRow[headerMap['学校名'] - 1] || ''),
          cls: String(newRow[headerMap['クラス'] - 1] || '')
        }]);
      }
    } catch (eIdx) {}
    return buildHeartbeatResponse(newRow, headerMap, studentId, kaActive, kaInfo, now);
    }

    const beforeLast = sheet.getLastRow();
    sheet.appendRow(newRow);
    hbLog('register: 新規行を追加 row=' + (beforeLast + 1) + ' id=' + studentId +
      '（追加前の最終行=' + beforeLast + '）');

    // 【R35】新規登録された端末を索引にも反映する。
    //   ここを漏らすと、初回ログイン直後の子童が一覧/配信の対象から漏れる。
    try {
      if (typeof shardIndexUpsert === 'function') {
        shardIndexUpsert([{
          id: studentId,
          school: String(newRow[headerMap['学校名'] - 1] || ''),
          cls: String(newRow[headerMap['クラス'] - 1] || '')
        }]);
      }
    } catch (eIdx) {}
    return buildHeartbeatResponse(newRow, headerMap, studentId, kaActive, kaInfo, now);
  });
}

function processHeartbeat(studentId, currentUrl, schoolNameRaw) {
  // 端末から届いた学校名（管理ポリシーの school_name）。正式名称に解決できた場合のみ使う。
  const incomingSchool = canonicalizeIncomingSchool(schoolNameRaw);

  // 教員コンソールの稼働有無に応じた児童端末の同期周期を配布する（非稼働=0＝同期しない）。
  const kaInfo = (typeof computeKaInterval === 'function')
    ? computeKaInterval(isTeacherConsoleActive() ? ACTIVE_SYNC_INTERVAL_SEC : 0, new Date().getTime())
    : { ka_active: false, sync_interval_sec: 0, idle_drift_until: 0 };
  const kaActive = kaInfo.ka_active;

  const now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');
  const nowMs = new Date().getTime();

  const t0 = new Date().getTime();

  // ---- 1) 行番号はキャッシュしない。毎回シートから児童IDで引き直す ----
  //   旧実装は hbGetCachedRow が最大6時間「行番号」を保持していた。dev_v は教員の
  //   書き込みでしか進まないため、シート上で行を削除・挿入されると版は変わらないまま
  //   行番号だけがズレ、2行目の児童が3行目の空行に書かれる事故になった。
  //   ヘッダー位置も毎回読む（列の挿入・削除でも壊れない）。
  const sheet = getTargetSheet(CONFIG.DEVICE_SHEET_NAME);
  const headerMap = getHeaderMap(sheet, CONFIG.DEVICE_COLUMNS);
  const resolved = hbResolveRowByStudentId(sheet, headerMap, studentId);

  if (resolved.rowNum < 0) {
    // 未登録 → 新規自動登録へ（重複防止のため書き込みロック内で再確認する）
    hbLog('heartbeat: 未登録のため新規登録へ id=' + studentId);
    return hbRegisterDevice(studentId, currentUrl, incomingSchool, kaInfo, kaActive, now);
  }

  const row = resolved.row;
  const rowNum = resolved.rowNum;
  hbLog('heartbeat: id=' + studentId + ' -> row=' + rowNum +
    ' (総行数=' + resolved.total + ')');

  // ---- 2.5) 子GAS: 氏名・学校名・クラスが未取得なら親の名簿で補完する ----
  // 空キー既定のフォールバックで子へ直行した端末は、子に名簿が無いため
  // クラス='未設定' のままになる。放置すると assigned_gas_url が永久に返らない。
  if (typeof hbApplyChildIdentity === 'function') {
    try {
      if (hbApplyChildIdentity(sheet, rowNum, row, headerMap, studentId)) {
        hbLog('heartbeat: 子GASの名簿補完を反映 row=' + rowNum);
      }
    } catch (e) { /* 補完失敗でも通常のハートビートは続ける */ }
  }

  // ---- 3) 書き込みが必要かの判定（従来と同じ基準） ----
  const urlCol = headerMap['現在開いているURL'];
  const syncCol = headerMap['最終同期日時'];
  const schoolCol = headerMap['学校名'];

  const urlChanged = !!urlCol && String(row[urlCol - 1] || '') !== String(currentUrl || '');
  const syncDue = !!syncCol && shouldWriteSyncTime(studentId, nowMs);

  let schoolFill = false;
  if (incomingSchool && schoolCol) {
    const cur = String(row[schoolCol - 1] || '').trim();
    if (!cur || cur === '未設定') schoolFill = true;
  }

  if (!urlChanged && !syncDue && !schoolFill) {
    // 何も書かない → シートへは書かない（読み取りのみで応答）
    hbLog('heartbeat: 書き込み不要 row=' + rowNum +
      ' elapsed=' + (new Date().getTime() - t0) + 'ms');
    return buildHeartbeatResponse(row, headerMap, studentId, kaActive, kaInfo, now);
  }

  // ここから先は書き込みが必要（sheet は手順1で開済み）

  // 学校名の補完（未設定の行だけ。教員が設定済みの値は上書きしない）
  if (schoolFill) {
    sheet.getRange(rowNum, schoolCol).setValue(incomingSchool);
    row[schoolCol - 1] = incomingSchool;
  }

  if (urlChanged && syncDue && urlCol && syncCol && syncCol === urlCol + 1) {
    // 隣接2列ならまとめて1回で書く（GAS/シートの往復を削減）
    hbLog('heartbeat: 2列まとめ書き row=' + rowNum + ' cols=' + urlCol + '..' + syncCol +
      ' url=' + currentUrl + ' sync=' + now);
    sheet.getRange(rowNum, urlCol, 1, 2).setValues([[currentUrl, now]]);
    row[urlCol - 1] = currentUrl;
    row[syncCol - 1] = now;
  } else {
    // 片方だけのときは、その列だけを書く（触っていない値の書式を変えない）
    if (urlChanged) {
      hbLog('heartbeat: K列書き row=' + rowNum + ' col=' + urlCol + ' url=' + currentUrl);
      sheet.getRange(rowNum, urlCol).setValue(currentUrl);
      row[urlCol - 1] = currentUrl;
    }
    if (syncDue) {
      hbLog('heartbeat: L列書き row=' + rowNum + ' col=' + syncCol + ' sync=' + now);
      sheet.getRange(rowNum, syncCol).setValue(now);
      row[syncCol - 1] = now;
    }
  }

  // ---- AI監視（URLが変わったときだけ判定。毎回の同期で辞書照合しない＝GASを軽く保つ） ----
  if (urlChanged) hbApplyMonitor(sheet, rowNum, row, headerMap, currentUrl, now);

  hbLog('heartbeat: 書き込み完了 row=' + rowNum + ' urlChanged=' + urlChanged +
    ' syncDue=' + syncDue + ' schoolFill=' + schoolFill +
    ' elapsed=' + (new Date().getTime() - t0) + 'ms');

  return buildHeartbeatResponse(row, headerMap, studentId, kaActive, kaInfo, now);
}

/**
 * 教員が管理者(ADMIN)かどうかを判定
 * 管理者は全校の児童を閲覧・操作できる。それ以外の教員は所属学校のみに限定される。
 */
function isAdminTeacher(teacher) {
  if (!teacher) return false;
  const role = String(teacher.role || '').trim().toUpperCase();
  return role === 'ADMIN' || role === 'SUPERADMIN' || role === 'SYSTEM_ADMIN';
}

/**
 * 学校名の表記ゆれ（前後空白・全角スペース・全角/半角カッコ・全角英数字・
 * 市立/市名等の接頭辞）を吸収して比較するための正規化
 */
function normalizeSchoolName(name) {
  let s = String(name || '')
    .replace(/[\u3000\s]+/g, '')          // 半角/全角スペース・タブ・改行を除去
    .replace(/[（）()]/g, '')              // 括弧を除去
    .replace(/[０-９]/g, function (c) {     // 全角数字 → 半角
      return String.fromCharCode(c.charCodeAt(0) - 0xFEE0);
    })
    .replace(/[Ａ-Ｚａ-ｚ]/g, function (c) { // 全角英字 → 半角
      return String.fromCharCode(c.charCodeAt(0) - 0xFEE0);
    })
    .toUpperCase()
    .trim();
  // 「美作市立第一小学校」「美作市 第一小学校」「市立第一小学校」等を「第一小学校」に寄せる
  s = s.replace(/^美作市立/, '').replace(/^美作市/, '').replace(/^市立/, '').replace(/^公立/, '');
  return s;
}

/**
 * 学校名が同一校を指すかどうかの比較（正規化＋部分一致フォールバック）
 * 例: 「第一小学校」「美作市立第一小学校」「第一小」を同一視する。
 * 一般教員が自校の児童を取りこぼさないための頑健化。
 */
function schoolNamesMatch(a, b) {
  const na = normalizeSchoolName(a);
  const nb = normalizeSchoolName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // 短い方の長さが3以上の場合のみ部分一致を許容（「小」等の1文字での誤一致を防止）
  const shorter = na.length <= nb.length ? na : nb;
  const longer = na.length <= nb.length ? nb : na;
  if (shorter.length >= 3 && longer.indexOf(shorter) !== -1) return true;
  return false;
}

// 学校名の略称エイリアス（「第一小」→「第一小学校」等）。
// 教員マスタや児童データに略称が入力されている場合でも同一校として扱えるようにする。
const SCHOOL_ALIASES = {
  '第一小': '第一小学校',
  '英田小': '英田小学校',
  '大原小': '大原小学校',
  '江見小': '江見小学校',
  '勝田小': '勝田小学校',
  '勝田東小': '勝田東小学校',
  '北小': '北小学校',
  '土居小': '土居小学校',
  '英田中': '英田中学校',
  '大原中': '大原中学校',
  '作東中': '作東中学校',
  '勝田中': '勝田中学校',
  '美作中': '美作中学校'
};

/**
 * 学校名を「14校のいずれか」に正規化して解決する。
 * 完全一致 → 略称エイリアス → 部分一致（双方向）の順に判定し、
 * 一致した場合は canonical（SCHOOL_LIST の表記）を返す。
 * 一致しない場合は '' を返す（未設定・未知の学校名）。
 */
function resolveCanonicalSchool(name) {
  const raw = String(name || '').trim();
  if (!raw) return '';
  const n = normalizeSchoolName(raw);
  if (!n) return '';

  // 1. 完全一致
  for (let i = 0; i < CONFIG.SCHOOL_LIST.length; i++) {
    if (normalizeSchoolName(CONFIG.SCHOOL_LIST[i]) === n) return CONFIG.SCHOOL_LIST[i];
  }
  // 2. 略称エイリアス
  for (const alias in SCHOOL_ALIASES) {
    if (normalizeSchoolName(alias) === n) {
      const canon = SCHOOL_ALIASES[alias];
      if (CONFIG.SCHOOL_LIST.indexOf(canon) !== -1) return canon;
    }
  }
  // 3. 部分一致（双方向）
  for (let i = 0; i < CONFIG.SCHOOL_LIST.length; i++) {
    const cn = normalizeSchoolName(CONFIG.SCHOOL_LIST[i]);
    if (cn && (n.indexOf(cn) !== -1 || cn.indexOf(n) !== -1)) return CONFIG.SCHOOL_LIST[i];
  }
  return '';
}

/**
 * 教員が指定した学校名を「スコープ対象の canonical 校名」に解決する。
 * canonical に解決できればその校名のみを対象とし（＝自校判定を確実にする）、
 * 解決できない場合は「未設定でも全校でもない未知の学校名」として
 * 生の値を返す（呼び出し側で schoolNamesMatch による比較にフォールバック）。
 */
function resolveTeacherScopeSchoolName(schoolName) {
  const resolved = resolveCanonicalSchool(schoolName);
  if (resolved) return resolved;
  const raw = String(schoolName || '').trim();
  return raw;
}

/**
 * 教員の所属校スコープを表すオブジェクトを返す。
 * - admin: 管理者（全校）
 * - all:   所属が「全校管理」等（全校）
 * - none:  所属が空（全校扱い）
 * - school: 特定校のみ
 */
function getTeacherScopeInfo(teacher) {
  if (isAdminTeacher(teacher)) return { type: 'admin' };
  const raw = String((teacher && teacher.school) || '').trim();
  if (!raw) return { type: 'none' };
  if (isAllSchoolsName(raw)) return { type: 'all' };
  const canonical = resolveCanonicalSchool(raw);
  if (canonical) return { type: 'school', school: canonical };
  return { type: 'unknown', school: raw };
}

/**
 * 「全校」を意味する学校名かどうか（未設定・全校管理・全学校・ALL）
 */
function isAllSchoolsName(name) {
  const n = normalizeSchoolName(name);
  return !n || n === '全校管理' || n === '全学校' || n.toUpperCase() === 'ALL';
}

/**
 * クラス名の表記ゆれ（前後空白・全角スペース・全角英数字）を吸収して比較するための正規化
 */
function normalizeClassName(name) {
  return String(name || '')
    .replace(/[\u3000\s]+/g, '')
    .replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
    .replace(/[Ａ-Ｚａ-ｚ]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
    .toUpperCase();
}

/**
 * 教員アカウントの「対象クラス」を配列で返す。空配列＝クラス制限なし（＝全クラス）。
 * 管理者(ADMIN)は常に制限なし。「全クラス」「ALL」等が設定されている場合も制限なしとして扱う。
 * カンマ・読点・スラッシュ・全角中黒などの区切りで複数クラス指定を許容する。
 */
function getTeacherTargetClasses(teacher) {
  if (isAdminTeacher(teacher)) return [];
  const raw = String((teacher && teacher.target_class) || '').trim();
  if (!raw) return [];
  const n = normalizeClassName(raw);
  if (n === '全クラス' || n === 'ALL' || n === '全' || n === 'すべて' || n === '指定なし') return [];
  return raw.split(/[,、\/／・]+/).map(function (s) { return s.trim(); }).filter(Boolean);
}

/**
 * 指定クラスが教員の「対象クラス（権限の境界）」内かどうか。
 *  - 管理者 / 対象クラス未設定 → 制限なし（true）
 *  - クラス未設定（空・未設定）→ 新規端末の割り当て前に表示が必要なため true
 *    （学校未設定の児童を表示している既存挙動と揃える）
 *  ※「対象クラス」は権限の境界であり、一覧表示だけでなく一括操作の対象判定にも用いる。
 */
function isClassInTeacherScope(className, teacher) {
  if (isAdminTeacher(teacher)) return true;
  const targets = getTeacherTargetClasses(teacher);
  if (targets.length === 0) return true;
  const cn = String(className || '').trim();
  if (!cn || cn === '未設定') return true;
  const nc = normalizeClassName(cn);
  return targets.some(function (t) { return normalizeClassName(t) === nc; });
}

/**
 * 端末レコードが教員のアクセス権限範囲内かどうかを判定
 * - 管理者: すべての学校にアクセス可能
 * - 一般教員: 所属学校の児童 + 学校未設定（新規登録直後の児童）にアクセス可能
 *   ※ 児童は初回ログイン時に「学校未設定」で自動登録されるため、所属校へ紐付ける前に
 *      まず一覧へ表示されなければならない。未設定児童は全教員が閲覧・紐付け可能とする。
 * - 「全校管理」等の管理用所属は全校扱い
 * - さらに「対象クラス」が設定されている教員は、そのクラスのみ（＋未設定クラス）に限定される。
 *   ※ 対象クラスは権限の境界であり、一覧表示だけでなく一括操作の対象判定にも用いる。
 */
function isDeviceInTeacherScope(schoolName, teacher, className) {
  if (isAdminTeacher(teacher)) return true;

  const scope = getTeacherScopeInfo(teacher);
  // 所属が未設定 / 全校管理系の場合は制限しない（管理者相当の運用を許可）
  // ただし「対象クラス」による制限は、所属が全校扱いであっても適用する。
  const schoolUnrestricted = (scope.type === 'admin' || scope.type === 'all' || scope.type === 'none');

  if (!schoolUnrestricted) {
    const sName = String(schoolName || '').trim();
    // 学校未設定（新規登録直後の児童）は自校への紐付け前のため許可
    if (sName && sName !== '未設定') {
      // 所属校が canonical に解決できた場合は、児童の学校名も canonical に解決して比較する。
      // 「第一小」「美作市立第一小学校」「第一小学校」等の表記ゆれ・略称を同一視する。
      const devCanonical = resolveCanonicalSchool(sName);
      const isOwn = devCanonical ? (devCanonical === scope.school) : schoolNamesMatch(sName, scope.school);
      if (!isOwn) return false;
    }
  }

  // 対象クラス境界（学校境界を通過したうえで、さらにクラスで限定する）
  if (!isClassInTeacherScope(className, teacher)) return false;

  return true;
}

/**
 * 教員のアクセス範囲（所属学校）を一括操作の対象IDリストに反映する。
 * 一般教員が他校の児童IDを指定しても操作できないよう、IDリストを自校のみに絞り込む。
 * 'ALL' 指定時は自校のみを意味する配列に変換する（管理者は 'ALL' のまま＝全校）。
 * 戻り値: { ids: 'ALL' | string[], denied: number } / ids が空配列の場合は対象なし
 */
function scopeStudentIdsForTeacher(studentIds, teacher) {
  if (isAdminTeacher(teacher)) {
    return { ids: studentIds, denied: 0 };
  }

  const scope = getTeacherScopeInfo(teacher);
  const restrictToOwnSchool = (scope.type === 'school' || scope.type === 'unknown');
  const teacherSchool = scope.school || '';
  // 「対象クラス」は権限の境界。学校が全校扱い（all/none）でもクラス制限は適用する。
  const classRestricted = getTeacherTargetClasses(teacher).length > 0;

  // 学校・クラスのどちらの制限も無い場合は元のIDリストをそのまま返す（'ALL' を保持）
  if (!restrictToOwnSchool && !classRestricted) {
    return { ids: studentIds, denied: 0 };
  }

  const sheet = getTargetSheet(CONFIG.DEVICE_SHEET_NAME);
  const headerMap = getHeaderMap(sheet, CONFIG.DEVICE_COLUMNS);
  // 【R33】スコープ判定に必要な3列だけを読み、実行をまたいでキャッシュする。
  //   実測 1,117ms の大半は「16列 × 全行」の取得そのものだった。
  // 【R35】索引（idx_v で独立版管理）だけを見る。
  //   dev_v は withWriteLock が書き込みごとに進めるため、これをキーにすると
  //   書き込み直後の読み取りが必ずキャッシュミスになり、1,000〜2,000行を
  //   毎回読み直していた（実測 1,210ms）。索引は書き込み関数が差分を自分で反映する。
  let entries = null;
  try {
    if (typeof shardDeviceEntries === 'function') entries = shardDeviceEntries();
  } catch (e) { entries = null; }
  if (!entries) {
    // 索引が使えない環境のみ従来通りのシート読み
    const data = sheet.getDataRange().getValues();
    const idColIdx = headerMap['児童ID'] - 1;
    const schoolColIdx = headerMap['学校名'] - 1;
    const classColIdx = headerMap['クラス'] - 1;
    entries = [];
    for (let i = 1; i < data.length; i++) {
      const row = data[i] || [];
      const sid = String(row[idColIdx] || '').trim();
      if (!sid) continue;
      entries.push([sid, String(row[schoolColIdx] || '').trim(), String(row[classColIdx] || '').trim()]);
    }
  }

  // 教員のスコープ内（学校境界＋クラス境界）に所属する児童IDのセット
  const scopedIds = {};
  for (let i = 0; i < entries.length; i++) {
    const id = String(entries[i][0] || '').trim();
    if (!id) continue;
    const sName = String(entries[i][1] || '').trim();
    const cName = String(entries[i][2] || '').trim();

    // 学校境界: 自校の児童、および学校未設定（新規登録直後）の児童を対象に含める
    // ※ canonical 解決 → 表記ゆれ比較の順で判定し、略称・接頭辞付き表記も同一視する
    if (restrictToOwnSchool) {
      const devCanonical = resolveCanonicalSchool(sName);
      const isOwn = !sName || sName === '未設定' ||
        (devCanonical ? devCanonical === teacherSchool : schoolNamesMatch(sName, teacherSchool));
      if (!isOwn) continue;
    }

    // クラス境界（権限の境界）
    if (!isClassInTeacherScope(cName, teacher)) continue;

    scopedIds[id] = true;
  }

  if (studentIds === 'ALL' || !Array.isArray(studentIds)) {
    return { ids: Object.keys(scopedIds), denied: 0 };
  }

  const allowed = [];
  let denied = 0;
  studentIds.forEach(id => {
    const key = String(id).trim();
    if (scopedIds[key]) allowed.push(key);
    else denied++;
  });

  return { ids: allowed, denied: denied };
}
/**
 * 児童IDから端末レコード（学校名など）を取得
 */
function getDeviceByStudentId(studentId) {
  if (!studentId) return null;
  const sheet = getTargetSheet(CONFIG.DEVICE_SHEET_NAME);
  const headerMap = getHeaderMap(sheet, CONFIG.DEVICE_COLUMNS);
  const data = sheet.getDataRange().getValues();
  const idColIdx = headerMap['児童ID'] - 1;

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idColIdx] || '').trim() === String(studentId).trim()) {
      return {
        student_id: String(data[i][idColIdx] || '').trim(),
        school_name: String(data[i][headerMap['学校名'] - 1] || '').trim(),
        student_name: String(data[i][headerMap['氏名'] - 1] || ''),
        class_name: String(data[i][headerMap['クラス'] - 1] || '')
      };
    }
  }
  return null;
}

/**
 * 全端末一覧取得（学校フィルター対応 & 教員の所属学校スコープ適用）
 * 同時接続対策: 短時間（5秒）の読み取りキャッシュで、複数教員の同時再読み込みによる
 * シート読み取り回数を抑える。書き込み系は 'dev_v' を進めてキャッシュを無効化するため、
 * 教員の操作結果は次の読み取りで必ず最新が返る（誤情報を残さない）。
 * ※ CacheService が無い環境（GAS以外のテスト等）では従来どおり毎回シートを読む。
 */
function getAllDevices(filterSchool, teacher, includeUnassigned) {
  const cacheEnabled = (typeof CacheService !== 'undefined');
  let devCache = null;
  let devCacheKey = '';
  if (cacheEnabled) {
    try {
      devCache = CacheService.getScriptCache();
      const t = teacher || {};
      const version = String(devCache.get('dev_v') || '0');
      const scopeKey = [
        filterSchool || 'ALL',
        includeUnassigned ? '1' : '0',
        t.email || '', t.school || '', t.role || '', t.target_class || ''
      ].join('|');
      devCacheKey = 'dev2_' + version + '_' + scopeKey;
      const hit = devCache.get(devCacheKey);
      if (hit) return JSON.parse(hit);
    } catch (e) {
      devCache = null;
    }
  }

  const sheet = getTargetSheet(CONFIG.DEVICE_SHEET_NAME);
  const headerMap = getHeaderMap(sheet, CONFIG.DEVICE_COLUMNS);
  const data = sheet.getDataRange().getValues();

  // 【R35】どのみち全列を読んでいるので、その結果で索引を作り直す。
  //   シートを直接編集された場合のズレも、コンソール表示ごとに解消される。
  try { if (typeof shardIndexRefreshFromRows === 'function') shardIndexRefreshFromRows(data, headerMap); } catch (eIdx) {}

  if (data.length <= 1) return [];

  const results = [];
  const now = new Date().getTime();

  // 【スケジュール】一覧に「いま時間制限が効いている端末」を出すための材料。
  //   予約シートは 1 回だけ読み、全端末ぶんをメモリ上で判定する。
  //   シートが無い・読めない環境（テスト等）では空配列のままで従来どおり動く。
  let schRows = [];
  try {
    if (typeof readScheduleRows_ === 'function') schRows = readScheduleRows_();
  } catch (eSch) { schRows = []; }

  // 教員の所属学校スコープ（管理者は全校）
  const scopeInfo = getTeacherScopeInfo(teacher);
  const restrictToOwnSchool = scopeInfo.type === 'school' || scopeInfo.type === 'unknown';
  const teacherSchool = scopeInfo.school || '';
  // 「対象クラス」は権限の境界。学校が全校扱い（all/none）でもクラス制限は適用する。
  const classRestricted = getTeacherTargetClasses(teacher).length > 0;

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const studentId = String(row[headerMap['児童ID'] - 1] || '').trim();
    if (!studentId) continue;

    const schoolName = String(row[headerMap['学校名'] - 1] || '').trim();
    const className = String(row[headerMap['クラス'] - 1] || '').trim();

    // 0. 所属学校スコープ: 一般教員は自校の児童 + 学校未設定（新規登録児童）のみ
    //    他の学校に所属する児童は一切返さない。
    //    ※ 児童は初回ログイン時に「学校未設定」で登録されるため、所属校へ紐付ける前に
    //      まず一覧へ表示する必要がある。
    //    ※ canonical 解決（「第一小」「美作市立第一小学校」等）→ 表記ゆれ比較の順で判定
    if (restrictToOwnSchool && schoolName && schoolName !== '未設定') {
      const devCanonical = resolveCanonicalSchool(schoolName);
      const isOwn = devCanonical ? (devCanonical === teacherSchool) : schoolNamesMatch(schoolName, teacherSchool);
      if (!isOwn) continue;
    }

    // 0.5 対象クラススコープ（権限の境界）: 対象クラス設定がある教員はそのクラスのみ
    //     （＋クラス未設定の児童）に限定する。他クラスの児童は一切返さない。
    if (classRestricted && !isClassInTeacherScope(className, teacher)) continue;

    // 学校絞り込み
    if (filterSchool && filterSchool !== 'ALL') {
      if (filterSchool === 'UNASSIGNED') {
        if (schoolName && schoolName !== '未設定') continue;
      } else if (includeUnassigned) {
        if (schoolName !== '未設定' && schoolName !== '' && !schoolNamesMatch(schoolName, filterSchool)) continue;
      } else {
        if (!schoolNamesMatch(schoolName, filterSchool)) continue;
      }
    }

    const lastSeenStr = row[headerMap['最終同期日時'] - 1];
    let isOnline = false;
    if (lastSeenStr) {
      // シートの日時は日本時間。実行環境のタイムゾーンに依存しないよう
      // sheetTsToMs で解釈する（9 時間ずれて常時オフラインになる事故の防止）。
      const seenMs = sheetTsToMs(lastSeenStr);
      if (seenMs) isOnline = (now - seenMs) < 60000;
    }

    // 画面一覧用の制御列（列が無い既存シートでも安全に '' を返す）
    const reqColIdx = headerMap['画面情報要求日時'];
    const shotColIdx = headerMap['画面情報更新日時'];
    // AI監視の列（既存シートでも ensureDeviceHeaders により末尾へ自動追加される）
    const monFlagIdx = headerMap['要注意'];
    const monReasonIdx = headerMap['注意理由'];
    const monUrlIdx = headerMap['要注意URL'];
    const monAtIdx = headerMap['注意検知日時'];

    results.push({
      student_id: studentId,
      school_name: schoolName,
      student_name: String(row[headerMap['氏名'] - 1] || ''),
      class_name: String(row[headerMap['クラス'] - 1] || ''),
      screen_lock: parseBoolean(row[headerMap['画面ロック'] - 1]),
      filter_mode: String(row[headerMap['URL規制モード'] - 1] || 'OFF').toUpperCase(),
      // 【配列化】シートのセルは "a.com, b.com" の文字列。端末（拡張機能）側の
      //   normalizeHostList は Array.isArray でない入力を捨てるため、ここで
      //   string[] に直してから返す（教員コンソールの画面も配列を前提にする）。
      whitelist_urls: normalizeHostListToArray_(row[headerMap['許可URLリスト'] - 1]),
      blacklist_urls: normalizeHostListToArray_(row[headerMap['規制URLリスト'] - 1]),
      broadcast_url: String(row[headerMap['一斉表示URL'] - 1] || ''),
      broadcast_id: String(row[headerMap['一斉表示実行ID'] - 1] || ''),
      current_url: String(row[headerMap['現在開いているURL'] - 1] || ''),
      last_seen: lastSeenStr ? String(lastSeenStr) : '',
      is_online: isOnline,
      notes: String(row[headerMap['備考'] - 1] || ''),
      screen_request_at: reqColIdx ? String(row[reqColIdx - 1] || '').trim() : '',
      screenshot_at: shotColIdx ? String(row[shotColIdx - 1] || '').trim() : '',
      monitor_flag: monFlagIdx ? parseBoolean(row[monFlagIdx - 1]) : false,
      monitor_reason: monReasonIdx ? String(row[monReasonIdx - 1] || '') : '',
      monitor_url: monUrlIdx ? String(row[monUrlIdx - 1] || '') : '',
      monitor_at: monAtIdx ? String(row[monAtIdx - 1] || '') : '',
      // 【スケジュール】いま時間制限（タイマー）が効いている端末か。
      //   教員一覧に「予約により制限中」を出すための読み取り専用フラグ。
      //   シートへの書き戻しは一切しない（集計は読み取り時のみ）。
      schedule_active: (function () {
        try {
          return isAnyScheduleActive_(schRows, studentId, String(row[headerMap['クラス'] - 1] || ''), schoolName, now);
        } catch (e) { return false; }
      })()
    });
  }

  // 読み取りキャッシュへ保存（5秒）。書き込み時は invalidateDevicesCache() で無効化する。
  // ※ 監視設定の変更時にも invalidateDevicesCache() を呼ぶため、OFFにした直後に
  //    注意マークが残ることはない。
  if (devCache && devCacheKey) {
    try { devCache.put(devCacheKey, JSON.stringify(results), 5); } catch (e) {}
  }

  // 監視がOFFのときは注意フラグを伏せて返す（シートのデータは保持したまま非表示）。
  return applyMonitorVisibility(results);
}

/**
 * 端末一覧の読み取りキャッシュを無効化する。
 * 教員による書き込み（ロック/配信/規制/単一更新/年次更新/取込/画面要求）の直後に呼び、
 * 次の get_all が必ず最新のシート内容を返すようにする（古い一覧を配らない）。
 * ※ CacheService が無い環境でも安全（例外は握りつぶす）。
 */
function invalidateDevicesCache() {
  if (typeof CacheService === 'undefined') return;
  try {
    const cache = CacheService.getScriptCache();
    const cur = Number(cache.get('dev_v') || '0');
    cache.put('dev_v', String((cur + 1) % 1000000000), 21600); // 6時間保持
  } catch (e) {}
}

// ==================== 画面一覧（スクリーンショット） ====================
// 設計方針（通信負担の最小化）:
//  ・教員が「画面情報取得」を押した児童だけを対象にする（全端末の常時収集はしない）。
//  ・要求は 端末一覧 シートの『画面情報要求日時』に要求IDを書き込むだけで、
//    児童端末は次のハートビート応答でそれを検知してスクリーンショットを撮影・送信する。
//  ・画像本体は『画面情報』シートに分離保存し、端末一覧の読み取り（get_all）を重くしない。
//  ・取得した画像はデータURL(data:image/...;base64,...)として console が直接表示する。

/**
 * 端末一覧シートが画面一覧用の列を持つことを保証し、ヘッダーマップを返す。
 * 既存運用のシートでも、初回利用時に自動で列を補完する（ensureDeviceHeaders）。
 */
function ensureDeviceHeaderMap() {
  const sheet = getTargetSheet(CONFIG.DEVICE_SHEET_NAME);
  return { sheet: sheet, headerMap: getHeaderMap(sheet, CONFIG.DEVICE_COLUMNS) };
}

/**
 * 教員が「画面情報取得」を押した児童に、画面情報要求IDを書き込む（押下時のみ）。
 * studentIds は教員スコープで絞り込まれた ID を想定。
 */
function requestScreenCapture(studentIds, teacher) {
  const scoped = scopeStudentIdsForTeacher(studentIds, teacher);
  const scopedIds = Array.isArray(scoped.ids) ? scoped.ids : [];
  if (scopedIds.length === 0) {
    return { requested: 0, ids: [] };
  }
  return withWriteLock(function () {
    const sheet = getTargetSheet(CONFIG.DEVICE_SHEET_NAME);
    const headerMap = getHeaderMap(sheet, CONFIG.DEVICE_COLUMNS);
    const reqCol = headerMap['画面情報要求日時'];
    if (!reqCol) throw new Error('画面一覧用の列がありません。setupSpreadsheet を実行してください。');

    const data = sheet.getDataRange().getValues();
    const idColIdx = headerMap['児童ID'] - 1;
    const target = {};
    scopedIds.forEach(id => { target[String(id).trim()] = true; });

    const now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');
    const reqId = 'sr_' + new Date().getTime() + '_' + Math.random().toString(36).slice(2, 7);

    let count = 0;
    const requestedIds = [];
    // 行ごとに個別書き込み（対象は教員が選んだ児童のみ＝上書きコストは限定的）
    for (let i = 1; i < data.length; i++) {
      const sid = String(data[i][idColIdx] || '').trim();
      if (!target[sid]) continue;
      // 「日時 + 要求ID」を書き込む。要求IDは児童端末側で二重撮影を防ぐ識別子。
      sheet.getRange(i + 1, reqCol).setValue(now + '|' + reqId);
      count++;
      requestedIds.push(sid);
    }
    return { requested: count, ids: requestedIds, request_id: reqId, at: now };
  });
}

// 1枚あたりの上限（Base64 の文字数）。
// ※ Google スプレッドシートの 1 セルは 50,000 文字が上限のため、それを超える画像は
//    セルへ書き込めず（＝保存に失敗し画面が表示されない）、必ずこの範囲に収める。
//    児童端末側は送信前に OffscreenCanvas で縮小し、この上限未満にしてから送る。
const SCREENSHOT_MAX_BYTES = 45000;

/**
 * 児童端末から届いたスクリーンショットを『画面情報』シートへ保存し、
 * 端末一覧の『画面情報更新日時』を更新する。
 * ※ 認証不要（ハートビートと同じ経路）。データURLは画像として検証する。
 *
 * 【R43.2】関数全体を try-catch で保護する。
 *   R43.1 までは途中で例外が起きると doPost の外へ抜け、GAS が HTTP 500 を返していた。
 *   端末側は 500 を受け取ると保存できていないのに「更新待ち」のままになる。
 *   ここで例外を捕まえて JSON を返せば、500 にならず、端末側でも
 *   「保存に失敗した理由」をログに出せる（原因究明が進む）。
 */
function processScreenshotUpload(studentId, imageData, mimeType) {
  try {
    if (!studentId) return { success: false, error: 'student_id is required' };
    const data = String(imageData || '');
    if (!/^data:image\/(png|jpeg|jpg|webp);base64,/i.test(data) && !/^[A-Za-z0-9+/=\s]+$/.test(data)) {
      return { success: false, error: 'invalid image data' };
    }
    const mime = (mimeType || 'image/jpeg').toString();
    const base64 = data.replace(/^data:image\/[a-z]+;base64,/i, '');
    if (base64.length > SCREENSHOT_MAX_BYTES) {
      return { success: false, error: 'image too large', base64_len: base64.length, limit: SCREENSHOT_MAX_BYTES };
    }

    const sheet = getTargetSheet(CONFIG.SCREENSHOT_SHEET_NAME);
    const headerMap = getHeaderMap(sheet, CONFIG.SCREENSHOT_COLUMNS);
    const rows = sheet.getDataRange().getValues();
    const idColIdx = headerMap['児童ID'] - 1;
    const now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');

    let targetRow = -1;
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][idColIdx] || '').trim() === String(studentId).trim()) { targetRow = i + 1; break; }
    }
    const rowValues = [[studentId, now, mime, base64]];
    if (targetRow !== -1) {
      sheet.getRange(targetRow, 1, 1, CONFIG.SCREENSHOT_COLUMNS.length).setValues(rowValues);
    } else {
      sheet.appendRow(rowValues[0]);
    }

    // 端末一覧の『画面情報更新日時』を更新（取得完了の可視化）
    try {
      const dSheet = getTargetSheet(CONFIG.DEVICE_SHEET_NAME);
      const dMap = getHeaderMap(dSheet, CONFIG.DEVICE_COLUMNS);
      const shotCol = dMap['画面情報更新日時'];
      if (shotCol) {
        const dRows = dSheet.getDataRange().getValues();
        const dIdCol = dMap['児童ID'] - 1;
        for (let i = 1; i < dRows.length; i++) {
          if (String(dRows[i][dIdCol] || '').trim() === String(studentId).trim()) {
            dSheet.getRange(i + 1, shotCol).setValue(now);
            break;
          }
        }
      }
    } catch (e) {
      Logger.log('画面情報更新日時の更新に失敗: ' + e);
    }

    return { success: true, student_id: studentId, at: now };

  } catch (err) {
    // 【R43.2】未捕捉例外を HTTP 500 にせず JSON で返す（端末側が理由を記録できる）。
    const msg = (err && err.message) ? err.message : String(err);
    try {
      Logger.log('[SCREENSHOT] upload failed: student=' + String(studentId || '') +
                 ' error=' + msg);
    } catch (eLog) {}
    return { success: false, error: msg, error_code: 'upload_failed' };
  }
}

/**
 * 【R43.3】「撮影できない状態」を端末から受け取り、『端末一覧』の『画面情報状態』へ記録する。
 *
 * 背景（実機で確定した真因）:
 *   ログイン状態の新しいタブは Chrome の仕様上 chrome://newtab/ という特権ページになり、
 *   chrome.tabs.captureVisibleTab では撮影できない。ログアウト時は https://www.google.com
 *   になるため撮影できていた（＝症状の差はこれで完全に説明できる）。
 *
 *   これまでは拡張が無言で return していたため教員画面へ何も届かず、
 *   「更新待ち」が残り続けていた。撮れないこと自体は Chrome の仕様なので、
 *   「撮れなかった」という事実を状態として記録し、教員画面が
 *   「保護されたページを表示中（キャプチャ不可）」と表示できるようにする。
 *
 * 画像は保存しない（撮れていないため）。認証不要（screenshot と同じ経路）。
 * reason: 'chrome_protected'（chrome:// 等）/ 'capture_error'（captureVisibleTab 例外）
 *         / 'image_too_large'（縮小しても上限に収まらない）
 */
function processScreenshotBlocked(studentId, reason) {
  try {
    const sid = String(studentId || '').trim();
    if (!sid) return { success: false, error: 'student_id is required' };

    // 想定外の文字列がセルに入らないよう、英数字と _ : - だけに制限する
    let kind = String(reason || 'chrome_protected').trim().replace(/[^A-Za-z0-9_:-]/g, '');
    if (!kind) kind = 'chrome_protected';

    const now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');
    let updated = false;

    withWriteLock(function () {
      const dSheet = getTargetSheet(CONFIG.DEVICE_SHEET_NAME);
      // 既存シートに『画面情報状態』列が無ければ末尾へ追加する（後方互換）
      try { if (typeof ensureDeviceHeaders === 'function') ensureDeviceHeaders(dSheet); } catch (eEns) {}
      const dMap = getHeaderMap(dSheet, CONFIG.DEVICE_COLUMNS);
      const stateCol = dMap['画面情報状態'];
      if (!stateCol) throw new Error('『画面情報状態』列がありません。setupSpreadsheet を実行してください。');

      const dRows = dSheet.getDataRange().getValues();
      const dIdCol = dMap['児童ID'] - 1;
      for (let i = 1; i < dRows.length; i++) {
        if (String(dRows[i][dIdCol] || '').trim() !== sid) continue;
        // 形式: "capture_blocked:<理由>|YYYY/MM/DD HH:mm:ss"
        //   日時はシート時計（GAS が書く）なので、要求日時とそのまま比較できる。
        dSheet.getRange(i + 1, stateCol).setValue('capture_blocked:' + kind + '|' + now);
        updated = true;
        break;
      }
    });

    Logger.log('[SCREENSHOT] blocked: student=' + sid + ' kind=' + kind + ' updated=' + updated);
    return { success: true, blocked: true, student_id: sid, kind: kind, at: now, updated: updated };

  } catch (err) {
    // 【R43.2 の方針】未捕捉例外を HTTP 500 にせず JSON で返す。
    const msg = (err && err.message) ? err.message : String(err);
    try {
      Logger.log('[SCREENSHOT] blocked failed: student=' + String(studentId || '') + ' error=' + msg);
    } catch (eLog) {}
    return { success: false, error: msg, error_code: 'blocked_write_failed' };
  }
}

/**
 * 要求済み児童のスクリーンショット一覧を取得（console の「画面情報取得」で使用）。
 * status: 'all' | 'ready' | 'pending'
 *  - 各児童について、端末一覧側の要求／更新日時と、画面情報シートの画像有無を突き合わせる。
 *  - 画像は base64 データURLに組み立てて返す（console が <img src> へ直接渡せる）。
 */
function getScreenshots(filterSchool, teacher, includeUnassigned, status, studentIds, opts) {
  // 【R43】opts.meta_only = true のとき、画像(Base64)を一切読まず・返さない。
  //   1児童あたり最大 42,000 文字の Base64 を人数分連結すると、30人で 1MB を超え、
  //   その JSON 生成・転送・ブラウザ側 parse だけで数秒かかる（＝体感の遅延とUI停止の主因）。
  //   ポーリングは「撮影日時が進んだか」だけ分かればよいので、メタのみを返す。
  const __metaOnly = !!(opts && opts.meta_only);
  const scoped = scopeStudentIdsForTeacher(studentIds, teacher);
  const only = (Array.isArray(studentIds) && studentIds.length) ? scoped.ids : null;

  const devSheet = getTargetSheet(CONFIG.DEVICE_SHEET_NAME);
  const dMap = getHeaderMap(devSheet, CONFIG.DEVICE_COLUMNS);
  const devRows = devSheet.getDataRange().getValues();

  const shotSheet = getTargetSheet(CONFIG.SCREENSHOT_SHEET_NAME);
  const sMap = getHeaderMap(shotSheet, CONFIG.SCREENSHOT_COLUMNS);
  // 【R43】メタのみのときは「児童ID」「更新日時」の2列だけを読む。
  //   画像列の読み込みを外すだけで Apps Script 内部の転送量が激減する。
  //   getRange が使えない環境（テスト用の擬似シート等）では従来どおり全列を読む。
  let shotRows = null;
  if (__metaOnly) {
    // 「児童ID / 更新日時 / MIMEタイプ」まで読む（画像列(4列目)は読まない）。
    //   MIMEタイプが入っていれば「画像行が存在する」と判定できるため、
    //   Base64 を読まずに has_image を返せる。
    try {
      const srLast = shotSheet.getLastRow();
      const srCols = Math.max(
        Number(sMap['更新日時'] || 2),
        Number(sMap['MIMEタイプ'] || 3),
        2
      );
      shotRows = (srLast > 1) ? shotSheet.getRange(1, 1, srLast, srCols).getValues() : [];
    } catch (eMeta) {
      shotRows = null; // getRange が無い環境（テスト用の擬似シート等）は全列読みへフォールバック
    }
  }
  if (!shotRows) shotRows = shotSheet.getDataRange().getValues();

  const shotIndex = {};
  for (let i = 1; i < shotRows.length; i++) {
    const sid = String(shotRows[i][sMap['児童ID'] - 1] || '').trim();
    if (!sid) continue;
    const atVal = String(shotRows[i][sMap['更新日時'] - 1] || '');
    const mimeVal = String(shotRows[i][sMap['MIMEタイプ'] - 1] || '');
    const b64Val = __metaOnly ? '' : String(shotRows[i][sMap['画像データ(Base64)'] - 1] || '');
    const prev = shotIndex[sid];
    // 同一児童が複数行ある場合は「更新日時が新しい行」を残す（古い行が勝つのを防ぐ）
    if (prev && sheetTsToMs(prev.at) > sheetTsToMs(atVal)) continue;
    shotIndex[sid] = {
      // 【R42.3】「画面情報」シート自身の更新日時。これが撮影日時の正。
      at: atVal,
      mime: mimeVal || 'image/jpeg',
      b64: b64Val,
      // 画像行が存在するか（メタのみのときは MIME の有無で判定する）
      exists: __metaOnly ? !!mimeVal : !!b64Val
    };
  }

  const scopeInfo = getTeacherScopeInfo(teacher);
  const restrictToOwnSchool = scopeInfo.type === 'school' || scopeInfo.type === 'unknown';
  const teacherSchool = scopeInfo.school || '';
  const classRestricted = getTeacherTargetClasses(teacher).length > 0;
  const want = (status || 'all').toLowerCase();

  const out = [];
  for (let i = 1; i < devRows.length; i++) {
    const row = devRows[i];
    const studentId = String(row[dMap['児童ID'] - 1] || '').trim();
    if (!studentId) continue;
    if (only && only.indexOf(studentId) === -1) continue;

    const schoolName = String(row[dMap['学校名'] - 1] || '').trim();
    const className = String(row[dMap['クラス'] - 1] || '').trim();

    if (restrictToOwnSchool && schoolName && schoolName !== '未設定') {
      const devCanonical = resolveCanonicalSchool(schoolName);
      const isOwn = devCanonical ? (devCanonical === teacherSchool) : schoolNamesMatch(schoolName, teacherSchool);
      if (!isOwn) continue;
    }
    if (classRestricted && !isClassInTeacherScope(className, teacher)) continue;
    if (filterSchool && filterSchool !== 'ALL') {
      if (filterSchool === 'UNASSIGNED') {
        if (schoolName && schoolName !== '未設定') continue;
      } else if (includeUnassigned) {
        if (schoolName !== '未設定' && schoolName !== '' && !schoolNamesMatch(schoolName, filterSchool)) continue;
      } else {
        if (!schoolNamesMatch(schoolName, filterSchool)) continue;
      }
    }

    const shot = shotIndex[studentId];
    const requestAt = dMap['画面情報要求日時'] ? String(row[dMap['画面情報要求日時'] - 1] || '').trim() : '';

    // 【R42.3】撮影日時の参照先を統一する。
    //   旧実装は「端末一覧」シートの『画面情報更新日時』を screenshot_at にしていた。
    //   しかし画像の実体は「画面情報」シートにあり、その行の『更新日時』こそが撮影時刻。
    //   端末一覧側の列は過去の要求や別経路の書き込みで古い値が残ることがあり、
    //   「子シートには 11:15:14 の新しい画像があるのに、カードは 10/28 のまま」
    //   という実機症状（R42.3）を生んでいた。
    //   したがって、画像行が存在する場合は『画面情報』シートの更新日時を正とし、
    //   画像が無い場合のみ端末一覧側の列を（要求の痕跡として）使う。
    const devShotAt = dMap['画面情報更新日時'] ? String(row[dMap['画面情報更新日時'] - 1] || '').trim() : '';
    const sheetShotAt = shot ? String(shot.at || '').trim() : '';
    const useSheetAt = !!(shot && shot.exists && sheetShotAt);
    const shotAt = useSheetAt ? sheetShotAt : devShotAt;

    // ready = 画像が保存されている、pending = 要求済みだが未取得
    //   【R43】メタのみ取得のときは Base64 を持たないため shot.exists で判定する。
    const ready = !!(shot && (shot.exists || shot.b64));
    if (want === 'ready' && !ready) continue;
    if (want === 'pending' && ready) continue;

    // 【R42.1】最終同期日時は親シートと子シートで書式が異なる。
    //   ・シート書式           "2026/11/05 20:39:25"
    //   ・日付値の String() 形 "Wed Oct 28 2026 09:44:57 GMT+0900 (日本標準時)"
    //   後者は Google スプレッドシートが日付型として保持しているセルを getValues() で
    //   読むと返る。生の文字列で大小比較すると "Nov" < "Oct"（月名の辞書順）となり
    //   子の新しいデータが古い親データに負ける。必ず数値（ミリ秒）へ直して判定する。
    //
    //   last_seen はブラウザへそのまま返す。ブラウザ側（mergeScreenRows）が
    //   親・子の last_seen を併合し、is_online を再計算するために使う。
    const lastSeenRaw = row[dMap['最終同期日時'] - 1];
    const lastSeenStr = lastSeenRaw ? String(lastSeenRaw) : '';
    const lastSeenMs = sheetTsToMs(lastSeenRaw);

    // 【R43.3】『画面情報状態』を解釈する。
    //   端末が chrome://newtab/ 等の特権ページを表示していて撮影できなかった場合、
    //   "capture_blocked:<理由>|YYYY/MM/DD HH:mm:ss" が入っている。
    //   ブラウザはこれを受けて「更新待ち」を解除し、
    //   「保護されたページを表示中」と表示する（撮れないことは Chrome の仕様）。
    //   ※ 列が無い（旧シート）場合は空文字のまま＝従来と完全に同じ挙動。
    const stateRaw = dMap['画面情報状態']
      ? String(row[dMap['画面情報状態'] - 1] || '').trim() : '';
    const stateIsBlocked = /^capture_blocked:/.test(stateRaw);
    const stateBlockedAt = stateIsBlocked ? String(stateRaw.split('|')[1] || '') : '';
    const stateBlockedMs = stateIsBlocked ? sheetTsToMs(stateBlockedAt) : 0;
    //   ブロック状態の自動解消（読み取り時に判定する。書き戻しはしない）:
    //     「撮れない」と報告した時刻より後に撮影に成功していれば、
    //     そのブロックはもう古い（端末は普通のページに戻って撮影できた）。
    //   端末は撮影成功時に『画面情報状態』を消さないため、ここで比較して
    //   実効値を決める。これにより余計な書き込み経路を増やさずに解消できる。
    const shotMsForBlock = sheetTsToMs(shotAt);
    const captureBlockedOn = !!(stateIsBlocked &&
      !(ready && shotMsForBlock > 0 && shotMsForBlock >= stateBlockedMs));
    const captureBlockedReason = captureBlockedOn
      ? (String(stateRaw.split('|')[0]).replace(/^capture_blocked:/, '') || 'chrome_protected')
      : '';
    const captureBlockedAt = captureBlockedOn ? stateBlockedAt : '';
    const captureBlockedMs = captureBlockedOn ? stateBlockedMs : 0;

    out.push({
      student_id: studentId,
      school_name: schoolName,
      student_name: String(row[dMap['氏名'] - 1] || ''),
      class_name: className,
      current_url: String(row[dMap['現在開いているURL'] - 1] || ''),
      last_seen: lastSeenStr,
      is_online: lastSeenMs ? ((new Date().getTime() - lastSeenMs) < 60000) : false,
      screen_request_at: requestAt,
      // 【R43.1】要求日時をミリ秒でも返す。
      //   ブラウザは「押した時刻(Date.now)」ではなく、この値（GASが書いた
      //   シート時計）と screenshot_ms を比較する。同じGASが同じ時計で
      //   書いた値どうしなので、秒未満の精度差で永久に「更新待ち」に
      //   なることが原理的に起きない（R43 のデッドロックの恒久対策）。
      //   形式 "2026/11/06 13:46:40|sr_..." なので '|' の前だけを見る。
      screen_request_ms: sheetTsToMs(String(requestAt || '').split('|')[0]),
      screenshot_at: shotAt,
      // 【R43】撮影日時をミリ秒でも返す。ブラウザ側で日時文字列を再解釈せずに
      //   新旧比較・要求時刻との突き合わせができる（TZ 依存のブレを無くす）。
      screenshot_ms: sheetTsToMs(shotAt),
      // 【R42.3/R43】この日時がどこ由来かを明示する。
      //   'sheet'  = 『画面情報』シートの更新日時（＝実際の撮影時刻。正）
      //   'device' = 『端末一覧』シートの画面情報更新日時（撮影時刻ではない）
      //   ブラウザは 'device' 由来の値を「撮影時刻」として信用しない。
      screenshot_from: useSheetAt ? 'sheet' : 'device',
      has_image: ready,
      // 【R43.3】撮影不可（chrome://newtab/ 等の特権ページ表示中）の状態通知。
      //   capture_blocked = true のとき、端末は「撮れなかった」ことを報告済み。
      //   ブラウザはこの行の「更新待ち」を解除し、
      //   「保護されたページ（設定/新しいタブ等）を表示中」と表示する。
      capture_blocked: captureBlockedOn,
      capture_blocked_reason: captureBlockedReason,
      //   シート時計（GAS が書いた日時）をミリ秒で返す。要求日時と同じ時計どうしの
      //   比較になるため、ブラウザの時計とのズレで誤判定しない（R43.1 と同じ方針）。
      capture_blocked_at: captureBlockedAt,
      capture_blocked_ms: captureBlockedMs,
      // 【R43】メタのみ取得のときは画像本体を返さない（転送量を 1/100 以下に）。
      image_data_url: (!__metaOnly && ready && shot && shot.b64)
        ? ('data:' + shot.mime + ';base64,' + shot.b64)
        : ''
    });
  }

  return out;
}

/**
 * 画面一覧の取得状況サマリー（未要求／要求中／取得済 の件数）。
 * console 側でボタンの状態表示・進捗表示に使う。
 */
function getScreenStatus(filterSchool, teacher, includeUnassigned, studentIds) {
  const list = getScreenshots(filterSchool, teacher, includeUnassigned, 'all', studentIds);
  let ready = 0, pending = 0, none = 0;
  list.forEach(function (d) {
    if (d.has_image) ready++;
    else if (d.screen_request_at) pending++;
    else none++;
  });
  return { total: list.length, ready: ready, pending: pending, none: none };
}

// ==================== 同時操作の直列化（競合対策） ====================
// 同じ学校に複数の教員が同時ログインし、各クラスで一括操作を行う運用を想定する。
// 端末一覧シートに対する「読み取り → 書き込み」が同時に走ると、
// 後から来た書き込みが先行の書き込みを上書き（更新の取りこぼし）する恐れがあるため、
// スクリプトロックで書き込み処理を直列化する。
// ※ ハートビート（各児童端末からの高頻度アクセス）はロック対象外とし、
//    教員による操作（一括ロック/配信/規制/単一更新）のみを保護して影響を最小化する。
function withWriteLock(fn) {
  // 【R31】入れ子（同じ実行の中で既にロックを持っている）場合は取り直さない。
  //   子GASの shardApplyFromParent は
  //     shardEnsureDeviceRows（lock）→ bulkUpdateScreenLock（lock）
  //   と2回続けて取得していた。2回目は自分が持っているロックを待つだけの無駄で、
  //   実行時間を押し上げる要因になっていた。
  //   ※ 深さは関数オブジェクトのプロパティに持つ（グローバル変数を作らないため、
  //     この関数を単体で切り出して実行するテストでも参照エラーにならない）。
  if (typeof withWriteLock.__depth !== 'number') withWriteLock.__depth = 0;
  if (withWriteLock.__depth > 0) {
    withWriteLock.__depth++;
    try {
      return fn();
    } finally {
      withWriteLock.__depth--;
    }
  }

  const lock = LockService.getScriptLock();
  let acquired = false;
  try {
    lock.waitLock(15000);
    acquired = true;
  } catch (e) {
    throw new Error('他の操作と競合しました。少し待って再試行してください。');
  }
  withWriteLock.__depth = 1;
  // 【R32 計測】待ち時間（他実行との競合）を実行ログに出す。
  try { if (typeof bulkTraceMark === 'function') bulkTraceMark('withWriteLock:排他ロック取得(waitLock)'); } catch (e) {}
  try {
    const result = fn();
    // 書き込みが成功したので端末一覧の読み取りキャッシュを無効化する。
    // （次回の get_all が必ず最新のシート内容を返すようにする）
    // ※ テスト等で invalidateDevicesCache が未定義でも安全（typeof ガード）
    try { if (typeof invalidateDevicesCache === 'function') invalidateDevicesCache(); } catch (e) {}
    return result;
  } finally {
    withWriteLock.__depth = 0;
    if (acquired) {
      try { lock.releaseLock(); } catch (e) {}
    }
    // 【R32 計測】ロック保持中の実処理＋解放までの時間。
    try { if (typeof bulkTraceMark === 'function') bulkTraceMark('withWriteLock:ロック解放(releaseLock)'); } catch (e) {}
  }
}

// 一斉表示の実行IDを生成する。同時配信でも衝突しないよう、時刻＋乱数で生成する。
// （旧実装はミリ秒のみで、同時実行時に同一IDとなり2回目の配信が児童端末で無視される恐れがあった）
function generateBroadcastId() {
  return 'bc_' + new Date().getTime() + '_' + Math.random().toString(36).slice(2, 7);
}

function bulkUpdateScreenLock(studentIds, lockState) {
  // 【R32 計測】
  const __bt = function (label) {
    try { if (typeof bulkTraceMark === 'function') bulkTraceMark(label); } catch (e) {}
  };
  return withWriteLock(function () {
    const sheet = getTargetSheet(CONFIG.DEVICE_SHEET_NAME);
    const headerMap = getHeaderMap(sheet, CONFIG.DEVICE_COLUMNS);
    __bt('bulkUpdateScreenLock:openById+見出し行');
    const data = sheet.getDataRange().getValues();
    __bt('bulkUpdateScreenLock:getDataRange(読取)');
    const lockCol = headerMap['画面ロック'];
    const idColIdx = headerMap['児童ID'] - 1;

    const isAll = (studentIds === 'ALL' || !Array.isArray(studentIds));
    const idSet = Array.isArray(studentIds) ? new Set(studentIds) : null;

    // 行ごとの setValue をやめ、対象列をまとめて1回で書き込む（GAS/シートの往復を削減）。
    // 対象行が飛び飛びでも、対象範囲を1回だけ読み書きすれば往復は1回で済む。
    let firstRow = -1, lastRow = -1;
    for (let i = 1; i < data.length; i++) {
      const id = String(data[i][idColIdx]).trim();
      if (isAll || (idSet && idSet.has(id))) {
        if (firstRow === -1) firstRow = i + 1;
        lastRow = i + 1;
      }
    }
    if (firstRow !== -1) {
      const range = sheet.getRange(firstRow, lockCol, lastRow - firstRow + 1, 1);
      const cur = range.getValues(); // 既存値を取得し、対象行だけ書き換えて一括反映
      for (let r = 0; r < cur.length; r++) {
        const id = String(data[firstRow - 1 + r][idColIdx]).trim();
        if (isAll || (idSet && idSet.has(id))) cur[r][0] = lockState;
      }
      range.setValues(cur);
      __bt('bulkUpdateScreenLock:setValues(書込)');
    }
    __bt('bulkUpdateScreenLock:完了');
  });
}

// 一斉表示URLを配信し、実行IDを生成して返す。
// ※ 実行IDの生成は必ずロック内で行い、同時配信でも別IDとなることを保証する。
function bulkUpdateBroadcastUrl(studentIds, targetUrl, broadcastId) {
  return withWriteLock(function () {
    const bcId = broadcastId || generateBroadcastId();
    const sheet = getTargetSheet(CONFIG.DEVICE_SHEET_NAME);
    const headerMap = getHeaderMap(sheet, CONFIG.DEVICE_COLUMNS);
    const data = sheet.getDataRange().getValues();
    const urlCol = headerMap['一斉表示URL'];
    const bcIdCol = headerMap['一斉表示実行ID'];
    const idColIdx = headerMap['児童ID'] - 1;

    const isAll = (studentIds === 'ALL' || !Array.isArray(studentIds));
    const idSet = Array.isArray(studentIds) ? new Set(studentIds) : null;

    // 対象行の範囲を求め、URL列・実行ID列をまとめて1回で書き込む（往復削減）。
    let firstRow = -1, lastRow = -1;
    for (let i = 1; i < data.length; i++) {
      const id = String(data[i][idColIdx]).trim();
      if (isAll || (idSet && idSet.has(id))) {
        if (firstRow === -1) firstRow = i + 1;
        lastRow = i + 1;
      }
    }
    if (firstRow !== -1) {
      const n = lastRow - firstRow + 1;
      const range = sheet.getRange(firstRow, urlCol, n, 2); // URL列と実行ID列（隣接）
      const cur = range.getValues();
      for (let r = 0; r < n; r++) {
        const id = String(data[firstRow - 1 + r][idColIdx]).trim();
        if (isAll || (idSet && idSet.has(id))) {
          cur[r][0] = targetUrl;
          cur[r][1] = bcId;
        }
      }
      range.setValues(cur);
    }
    return bcId;
  });
}

function bulkUpdateFilterMode(studentIds, filterMode, whitelistUrls, blacklistUrls) {
  return withWriteLock(function () {
    const sheet = getTargetSheet(CONFIG.DEVICE_SHEET_NAME);
    const headerMap = getHeaderMap(sheet, CONFIG.DEVICE_COLUMNS);
    const data = sheet.getDataRange().getValues();
    const modeCol = headerMap['URL規制モード'];
    const whiteCol = headerMap['許可URLリスト'];
    const blackCol = headerMap['規制URLリスト'];
    const idColIdx = headerMap['児童ID'] - 1;

    const isAll = (studentIds === 'ALL' || !Array.isArray(studentIds));
    const idSet = Array.isArray(studentIds) ? new Set(studentIds) : null;

    // 対象行の範囲を求め、モード列・許可/規制リスト列をまとめて1回で書き込む（往復削減）。
    let firstRow = -1, lastRow = -1;
    for (let i = 1; i < data.length; i++) {
      const id = String(data[i][idColIdx]).trim();
      if (isAll || (idSet && idSet.has(id))) {
        if (firstRow === -1) firstRow = i + 1;
        lastRow = i + 1;
      }
    }
    if (firstRow !== -1) {
      const n = lastRow - firstRow + 1;
      const range = sheet.getRange(firstRow, modeCol, n, 3); // モード・許可・規制（隣接3列）
      const cur = range.getValues();
      for (let r = 0; r < n; r++) {
        const id = String(data[firstRow - 1 + r][idColIdx]).trim();
        if (isAll || (idSet && idSet.has(id))) {
          cur[r][0] = filterMode;
          // 【配列化】呼び出し側は string[] で渡してくる。シートは 1 セルなので
          //   必ず文字列へ戻す（配列をそのまま setValues するとセルが壊れる）。
          if (whitelistUrls !== undefined && whitelistUrls !== null) cur[r][1] = hostListToSheetString_(whitelistUrls);
          if (blacklistUrls !== undefined && blacklistUrls !== null) cur[r][2] = hostListToSheetString_(blacklistUrls);
        }
      }
      range.setValues(cur);
    }
  });
}

function updateSingleDevice(studentId, updateData) {
  return withWriteLock(function () {
    const sheet = getTargetSheet(CONFIG.DEVICE_SHEET_NAME);
    const headerMap = getHeaderMap(sheet, CONFIG.DEVICE_COLUMNS);
    const data = sheet.getDataRange().getValues();
    const idColIdx = headerMap['児童ID'] - 1;

    let targetRow = -1;
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][idColIdx]).trim() === String(studentId).trim()) {
        targetRow = i + 1;
        break;
      }
    }

    if (targetRow === -1) throw new Error('児童IDが見つかりません: ' + studentId);

    if (updateData.screen_lock !== undefined && headerMap['画面ロック']) {
      sheet.getRange(targetRow, headerMap['画面ロック']).setValue(parseBoolean(updateData.screen_lock));
    }
    if (updateData.filter_mode !== undefined && headerMap['URL規制モード']) {
      sheet.getRange(targetRow, headerMap['URL規制モード']).setValue(updateData.filter_mode);
    }
    // 【配列化】string[] が来てもセルは文字列で保つ（次回の読み取りが壊れない）。
    if (updateData.whitelist_urls !== undefined && headerMap['許可URLリスト']) {
      sheet.getRange(targetRow, headerMap['許可URLリスト']).setValue(hostListToSheetString_(updateData.whitelist_urls));
    }
    if (updateData.blacklist_urls !== undefined && headerMap['規制URLリスト']) {
      sheet.getRange(targetRow, headerMap['規制URLリスト']).setValue(hostListToSheetString_(updateData.blacklist_urls));
    }
    if (updateData.broadcast_url !== undefined && headerMap['一斉表示URL']) {
      sheet.getRange(targetRow, headerMap['一斉表示URL']).setValue(updateData.broadcast_url);
      sheet.getRange(targetRow, headerMap['一斉表示実行ID']).setValue(generateBroadcastId());
    }
    if (updateData.student_name !== undefined && headerMap['氏名']) {
      sheet.getRange(targetRow, headerMap['氏名']).setValue(String(updateData.student_name).trim());
    }
    if (updateData.class_name !== undefined && headerMap['クラス']) {
      sheet.getRange(targetRow, headerMap['クラス']).setValue(String(updateData.class_name).trim());
    }
    if (updateData.school_name !== undefined && headerMap['学校名']) {
      sheet.getRange(targetRow, headerMap['学校名']).setValue(String(updateData.school_name).trim());
    }
    if (updateData.notes !== undefined && headerMap['備考']) {
      sheet.getRange(targetRow, headerMap['備考']).setValue(String(updateData.notes).trim());
    }

    // 【R35】クラス/学校が変わったときだけ索引に反映する。
    //   ロック/規制などの属性変更では索引は変わらないため、触らない（＝速度を落とさない）。
    try {
      if ((updateData.class_name !== undefined || updateData.school_name !== undefined) &&
          typeof shardIndexUpsert === 'function') {
        shardIndexUpsert([{
          id: studentId,
          school: updateData.school_name !== undefined ? String(updateData.school_name).trim() : undefined,
          cls: updateData.class_name !== undefined ? String(updateData.class_name).trim() : undefined
        }]);
      }
    } catch (eIdx) {}
  });
}

function parseBoolean(val) {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'string') {
    const s = val.trim().toUpperCase();
    return s === 'TRUE' || s === '1' || s === 'ON';
  }
  if (typeof val === 'number') return val === 1;
  return false;
}

function parseUrlList(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  return String(val).split(/[\r\n,]+/).map(s => s.trim().toLowerCase()).filter(s => s.length > 0);
}

/**
 * 改行・カンマ区切りの文字列、または未知のオブジェクトを文字列配列へ安全に変換する。
 *
 * 【なぜ必要か】
 *   シートの「許可URLリスト」「規制URLリスト」は 1 セルに
 *   "youtube.com, game.example" のような「文字列」で入っている。
 *   一方、端末（拡張機能）側の composeFilterRestriction -> normalizeHostList は
 *   Array.isArray(list) でなければ [] を返す（＝文字列は黙って捨てる）。
 *   そのため GAS が文字列のまま whitelist/blacklist を配ると、URL規制の
 *   予約が端末に届いても規制が一切効かなかった。
 *   ここで配列に正規化してから配る（シートへ書くときは逆向きに戻す）。
 *
 *   大文字小文字は変えない（利用者が入れた表記をそのまま見せる）。
 *   ホスト名の突き合わせは端末側の normalizeHostList が小文字化して行う。
 */
function normalizeHostListToArray_(input) {
  if (Array.isArray(input)) {
    return input.map(function (item) { return String(item).trim(); }).filter(Boolean);
  }
  if (!input || typeof input !== 'string') return [];
  return input.split(/[\r\n,]+/).map(function (s) { return s.trim(); }).filter(Boolean);
}

/**
 * normalizeHostListToArray_ の逆方向。配列（または文字列）を 1 セルに書ける
 * カンマ区切り文字列へ戻す。シートへの書き込みは必ずこれを通す
 * （配列をそのまま setValue するとセルに配列が入り、次回の読み取りが壊れる）。
 */
function hostListToSheetString_(input) {
  const arr = normalizeHostListToArray_(input);
  return arr.length ? arr.join(', ') : '';
}

// ==================== 子GAS分散（SHARD_MODE / ハブ＆スポーク） ====================
// 役割分担:
//   親（ハブ）  … 教員コンソール。全校・全クラスの端末一覧を集約し、操作の「正」を持つ。
//   子（スポーク）… 1クラス分のハートビートだけを受ける。ポリシーは親から受け取る。
//
// 端末の流れ:
//   ① 端末 → 親（初回）: 児童ID と クラス から子GAS URL を解決し assigned_gas_url を返す
//   ② 端末 → 子（以降）: 以後は子GASへ直接ハートビートする（1.5秒周期を維持）
//   ③ 教員操作 → 親: 親のシートを更新し、該当する子へ shard_apply で伝達
//
// 認証:
//   親⇔子の通信は教員トークンではなく「共有シークレット（SHARD_SECRET）」で認証する。
//   シークレット未設定の子は shard_apply を一切受け付けない（安全側）。

const SHARD_MAP_PROP = 'SHARD_MAP_V1';       // { "5年1組": "https://…/exec" }
const SHARD_DEFAULT_PROP = 'SHARD_DEFAULT_URL'; // クラス不明時の既定の子GAS
const SHARD_SECRET_PROP = 'SHARD_SECRET';    // 親⇔子の共有シークレット
// 子GASが「親の名簿に問い合わせる先」＝親GASのデプロイURL（子にだけ設定する）
const SHARD_PARENT_PROP = 'SHARD_PARENT_URL';
const SHARD_LOOKUP_CACHE_PREFIX = 'shlk_';   // 名簿照会のキャッシュ
const SHARD_CFG_CACHE = 'shard_cfg3';        // 設定のキャッシュキー（5分）

// ==================== 設定値の動的解決（スクリプトプロパティ優先） ====================
//
// 【設計】
//   コード内の CONFIG は「既定値」であり、実運用の値はスクリプトプロパティに置く。
//   読み取り順は スクリプトプロパティ → CONFIG の順（プロパティ優先）。
//   プロパティが未設定・空・型変換不能な場合は、警告を出したうえで CONFIG に戻す。
//   これにより「クラス追加・子GAS追加のたびにコードを書き換えて再デプロイする」
//   必要がなくなる（プロパティを変えるだけでよい）。
//
// 【性能】
//   isShardParent() はハートビートのホットパスから呼ばれる。毎回 PropertiesService を
//   読むと 3〜5ms の応答が崩れるため、真偽値は CacheService に 60 秒キャッシュする
//   （管理画面で保存したときは invalidateShardConfig() が即時破棄する）。

const PROP_SHARD_MODE = 'SHARD_MODE';
const PROP_SHARD_CHILD_MODE = 'SHARD_CHILD_MODE';
const PROP_SPREADSHEET_ID = 'SPREADSHEET_ID';
const SHARD_MODE_CACHE = 'shard_mode1';   // 真偽値キャッシュ（60秒）
const SHARD_SSID_CACHE = 'shard_ssid1';   // スプレッドシートIDキャッシュ（300秒）

/** 設定の警告を実行ログへ出す（Logger が無い環境でも落ちない）。 */
function cfgWarn(msg) {
  try { Logger.log('[CONFIG] ' + msg); } catch (e) { /* ログ不可は無視 */ }
}

/** プロパティの生値を返す。未設定は null（空文字と区別する）。 */
function propRaw(name) {
  try {
    const v = PropertiesService.getScriptProperties().getProperty(name);
    if (v === null || v === undefined) return null;
    return String(v);
  } catch (e) {
    return null;
  }
}

/** プロパティを真偽値として読む。不正値・空は fallback へ戻す。 */
function propBool(name, fallback) {
  const fb = !!fallback;
  const raw = propRaw(name);
  if (raw === null) return fb;
  const s = raw.trim().toLowerCase();
  if (!s) {
    cfgWarn(name + ' が空です。CONFIG の既定値（' + fb + '）を使用します。');
    return fb;
  }
  if (s === 'true' || s === '1' || s === 'yes' || s === 'on') return true;
  if (s === 'false' || s === '0' || s === 'no' || s === 'off') return false;
  cfgWarn(name + ' の値「' + raw + '」は真偽値として解釈できません。CONFIG の既定値（' + fb + '）を使用します。');
  return fb;
}

/** プロパティを文字列として読む。空は fallback へ戻す。 */
function propStr(name, fallback) {
  const fb = String(fallback === undefined || fallback === null ? '' : fallback);
  const raw = propRaw(name);
  if (raw === null) return fb;
  const s = raw.trim();
  if (!s) {
    if (fb) cfgWarn(name + ' が空です。CONFIG の既定値を使用します。');
    return fb;
  }
  return s;
}

/** SHARD_MODE / SHARD_CHILD_MODE をプロパティ優先で解決する（60秒キャッシュ）。 */
function shardModeFlags() {
  try {
    const c = CacheService.getScriptCache();
    const hit = c.get(SHARD_MODE_CACHE);
    if (hit) {
      const o = JSON.parse(hit);
      if (o && typeof o === 'object' && typeof o.parent === 'boolean' && typeof o.child === 'boolean') return o;
    }
  } catch (e) { /* キャッシュ不可時は都度評価 */ }

  const flags = {
    parent: propBool(PROP_SHARD_MODE, !!(CONFIG && CONFIG.SHARD_MODE === true)),
    child: propBool(PROP_SHARD_CHILD_MODE, !!(CONFIG && CONFIG.SHARD_CHILD_MODE === true))
  };
  try { CacheService.getScriptCache().put(SHARD_MODE_CACHE, JSON.stringify(flags), 60); } catch (e) {}
  return flags;
}

/**
 * 書き込み先スプレッドシートIDを解決する（プロパティ優先）。
 * 親は親シート、子は子シートを指す。プロパティを変えるだけで切り替えられる。
 */
function getSpreadsheetId() {
  const fallback = String((CONFIG && CONFIG.SPREADSHEET_ID) || '').trim();
  try {
    const c = CacheService.getScriptCache();
    const hit = c.get(SHARD_SSID_CACHE);
    if (hit) return hit;
  } catch (e) { /* 無視 */ }

  const id = propStr(PROP_SPREADSHEET_ID, fallback);
  if (!id) {
    cfgWarn('SPREADSHEET_ID を解決できませんでした（プロパティも CONFIG も空）。');
  }
  try { CacheService.getScriptCache().put(SHARD_SSID_CACHE, id, 300); } catch (e) {}
  return id;
}

/**
 * トークン署名鍵。SPREADSHEET_ID に依存させず、共有シークレットを最優先する。
 *   SHARD_SECRET（プロパティ）→ CONFIG.SHARD_SECRET → SHARD_SECRET 自動生成 → SPREADSHEET_ID
 * これにより子が自分のシートIDへ切り替えても、教員ログイン／トークン検証は壊れない。
 */
function getTokenSecret() {
  const fromProp = propStr(SHARD_SECRET_PROP, '');
  if (fromProp) return fromProp;
  const fromCfg = String((CONFIG && CONFIG.SHARD_SECRET) || '').trim();
  if (fromCfg) return fromCfg;
  const generated = getOrCreateShardSecret();
  if (generated) return generated;
  return getSpreadsheetId();
}

/** どの設定がプロパティで上書きされているかを返す（管理画面・診断用）。 */
function shardConfigSources() {
  const out = {};
  out.SHARD_MODE = (propRaw(PROP_SHARD_MODE) === null) ? 'CONFIG' : 'PROPERTY';
  out.SHARD_CHILD_MODE = (propRaw(PROP_SHARD_CHILD_MODE) === null) ? 'CONFIG' : 'PROPERTY';
  const ss = propRaw(PROP_SPREADSHEET_ID);
  out.SPREADSHEET_ID = (ss === null || !String(ss).trim()) ? 'CONFIG' : 'PROPERTY';
  const mp = propRaw(SHARD_MAP_PROP);
  out.SHARD_MAP_V1 = (mp === null || !String(mp).trim()) ? 'CONFIG' : 'PROPERTY';
  out.SHARD_DEFAULT_URL = (propRaw(SHARD_DEFAULT_PROP) === null) ? 'CONFIG' : 'PROPERTY';
  const sk = propRaw(SHARD_SECRET_PROP);
  out.SHARD_SECRET = (sk === null || !String(sk).trim()) ? 'CONFIG' : 'PROPERTY';
  return out;
}

/**
 * 同じ警告を300秒に1回だけ出す（ハートビート毎のログ氾濫を防ぐ）。
 * キャッシュが使えない環境では都度出力する（取りこぼしより冗長を選ぶ）。
 */
function shardWarnOnce(key, msg) {
  try {
    const c = CacheService.getScriptCache();
    const k = 'sw_' + shardHash(key);
    if (c.get(k)) return;
    c.put(k, '1', 300);
  } catch (e) { /* キャッシュ不可時は都度出力 */ }
  try { Logger.log('[SHARD] ' + msg); } catch (e) {}
}

// ==================== 児童IDの照合と名簿検索（表記ゆれ対策） ====================
//
// 児童IDは端末（Googleアカウントのメール）とシート（手入力・CSV取込）で
// 表記が揺れる。大文字小文字・全角半角・前後/途中の空白を吸収して比較する。
// 例: 「 1607002@City-Mimasaka.ED.jp 」と「１６０７００２＠city-mimasaka.ed.jp」は同一。

function normalizeIdKey(value) {
  let s = String(value === null || value === undefined ? '' : value);
  s = s.trim();
  if (!s) return '';
  // 全角英数字 → 半角
  s = s.replace(/[Ａ-Ｚａ-ｚ０-９]/g, function (c) {
    return String.fromCharCode(c.charCodeAt(0) - 0xFEE0);
  });
  // 全角記号 → 半角（メールアドレスで使われ得るもの）
  s = s.replace(/＠/g, '@').replace(/．/g, '.').replace(/＿/g, '_').replace(/[－ー]/g, '-');
  // 空白（全角含む）は除去する
  s = s.replace(/[\s\u3000]+/g, '');
  return s.toLowerCase();
}

/**
 * 児童IDの「ローカル部（@より前）」を正規化して返す。
 *   端末は Google アカウントのメール（1607002@city-mimasaka.ed.jp）を送ることも、
 *   ローカル部だけ（1607002）を送ることもある。@ が無い場合は全体をローカル部とみなす。
 */
function normalizeUserLocalPart_(value) {
  const key = normalizeIdKey(value);
  if (!key) return '';
  const at = key.indexOf('@');
  return at >= 0 ? key.slice(0, at) : key;
}

/**
 * 児童IDの同一性判定（表記ゆれの相互吸収）。
 *   ① 正規化した完全一致 → true
 *   ② 片方だけがメール形式のとき、ローカル部が一致すれば true
 *      「1607002」と「1607002@city-mimasaka.ed.jp」→ 同一児童
 *   ③ 双方がメール形式でドメインが違う場合は false（別児童の可能性）
 *      「1607002@a.ed.jp」と「1607002@b.ed.jp」→ 別人として扱う
 */
function idKeysMatch_(a, b) {
  const ka = normalizeIdKey(a);
  const kb = normalizeIdKey(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  if (ka.indexOf('@') >= 0 && kb.indexOf('@') >= 0) return false;
  const la = normalizeUserLocalPart_(ka);
  const lb = normalizeUserLocalPart_(kb);
  return !!(la && lb && la === lb);
}

/** 児童IDの配列に対象の児童が含まれるかを idKeysMatch_ で判定する。 */
function idMatchesAny_(list, studentId) {
  if (!Array.isArray(list) || !list.length) return false;
  const sid = String(studentId || '').trim();
  if (!sid) return false;
  for (let i = 0; i < list.length; i++) {
    if (idKeysMatch_(list[i], sid)) return true;
  }
  return false;
}

/**
 * 児童IDから端末一覧の行を探す（親・子のどちらでも使える）。
 * 見つかれば { row_number, student_id, school_name, student_name, class_name } を返す。
 *
 * 列位置は getHeaderMap で動的に解決する（列順が変わっても壊れない）。
 * 返す値はシートの表示どおり（整形前）とし、比較だけを正規化して行う。
 */
function findStudentById(studentId) {
  const want = normalizeIdKey(studentId);
  if (!want) return null;

  let sheet = null;
  try { sheet = getTargetSheet(CONFIG.DEVICE_SHEET_NAME); } catch (e) { return null; }
  if (!sheet) return null;

  let headerMap = null;
  try { headerMap = getHeaderMap(sheet, CONFIG.DEVICE_COLUMNS); } catch (e) { return null; }
  const idCol = headerMap && headerMap['児童ID'];
  if (!idCol) return null;

  let data = null;
  try { data = sheet.getDataRange().getValues(); } catch (e) { return null; }
  if (!data || !data.length) return null;

  const cell = function (row, colName) {
    const c = headerMap[colName];
    if (!c) return '';
    return String(row[c - 1] === null || row[c - 1] === undefined ? '' : row[c - 1]).trim();
  };

  const __pick = function (i) {
    return {
      row_number: i + 1,
      student_id: cell(data[i], '児童ID'),
      school_name: cell(data[i], '学校名'),
      student_name: cell(data[i], '氏名'),
      class_name: cell(data[i], 'クラス')
    };
  };
  // 【表記ゆれの相互吸収】完全一致 → ローカル部一致（候補が1件のときだけ）。
  //   子GASからの名簿照会が「@の有無」だけの差異で失敗するのを防ぐ。
  const looseIdx = [];
  for (let i = 1; i < data.length; i++) {
    if (normalizeIdKey(data[i][idCol - 1]) === want) return __pick(i);
    if (idKeysMatch_(data[i][idCol - 1], studentId)) looseIdx.push(i);
  }
  if (looseIdx.length === 1) return __pick(looseIdx[0]);
  return null;
}

/**
 * 親GAS側: 子GASからの名簿照会に答える。
 * 氏名・学校名・クラスに加え、その場で割り当て先（assigned_gas_url）も解決して返す。
 * これにより子は「クラスが分からない端末」を正しい子GASへ送り直せる。
 */
function shardLookupStudent(studentId) {
  const sid = String(studentId || '').trim();
  if (!sid) return { success: true, found: false, student_id: '' };
  const hit = findStudentById(sid);
  if (!hit) {
    return { success: true, found: false, student_id: sid };
  }
  const route = resolveShardForHeartbeat(hit.student_id, hit.class_name);
  const out = {
    success: true, found: true,
    student_id: hit.student_id,
    student_name: hit.student_name,
    school_name: hit.school_name,
    class_name: hit.class_name
  };
  const keys = Object.keys(route || {});
  for (let i = 0; i < keys.length; i++) out[keys[i]] = route[keys[i]];
  return out;
}

/** 子GASが問い合わせる親GASのURL（子にだけ設定する）。 */
function readShardParentUrl() {
  try {
    return String(PropertiesService.getScriptProperties().getProperty(SHARD_PARENT_PROP) || '').trim();
  } catch (e) {
    return '';
  }
}

/**
 * 子GAS側: 親へ名簿を問い合わせる（10分キャッシュ・失敗は1分キャッシュ）。
 * 親URLが未設定、または通信できない場合は null を返す（呼び出し側は従来動作を続ける）。
 */
function shardLookupFromParent(studentId) {
  const sid = String(studentId || '').trim();
  if (!sid) return null;
  const parent = readShardParentUrl();
  if (!parent) return null;

  const key = SHARD_LOOKUP_CACHE_PREFIX + shardHash(normalizeIdKey(sid) + '|' + parent);
  try {
    const c = CacheService.getScriptCache();
    const cached = c.get(key);
    if (cached) {
      const o = JSON.parse(cached);
      return (o && o.found) ? o : null;
    }
  } catch (e) { /* キャッシュ不可時は通信へ */ }

  let result = null;
  try {
    if (typeof UrlFetchApp === 'undefined') return null;
    const body = JSON.stringify({
      action: 'shard_lookup',
      shard_secret: getOrCreateShardSecret(),
      student_id: sid
    });
    const res = UrlFetchApp.fetch(parent, {
      method: 'post',
      contentType: 'application/json',
      payload: body,
      muteHttpExceptions: true
    });
    const code = res.getResponseCode();
    if (code >= 200 && code < 300) {
      const j = JSON.parse(res.getContentText());
      if (j && j.found) result = j;
    }
  } catch (e) {
    result = null;
  }

  try {
    const c = CacheService.getScriptCache();
    // 見つかった場合は長め（10分）、見つからない場合は短め（1分）に保持する
    c.put(key, JSON.stringify(result || { found: false }), result ? 600 : 60);
  } catch (e) {}

  return result;
}

/** 子モードのときだけ親へ問い合わせる薄いラッパ（他テスト環境でも安全に null）。 */
function hbChildIdentityLookup(studentId) {
  try {
    if (typeof isShardChild !== 'function' || !isShardChild()) return null;
    if (typeof shardLookupFromParent !== 'function') return null;
    return shardLookupFromParent(studentId);
  } catch (e) {
    return null;
  }
}

/**
 * 子GAS側: 子シートの「氏名・学校名・クラス」が未取得なら、親の名簿で補完する。
 * 補完した場合は row 配列を書き換え、シートにも書く（A〜D列が空のまま残らない）。
 * 戻り値: 補完したら true。
 */
function hbApplyChildIdentity(sheet, rowNum, row, headerMap, studentId) {
  try {
    if (!headerMap || !row || !(rowNum >= 2)) return false;
    const clsCol = headerMap['クラス'];
    if (!clsCol) return false;

    const curClass = String(row[clsCol - 1] === undefined ? '' : row[clsCol - 1]).trim();
    const classMissing = (!curClass || curClass === '未設定');

    const nameCol = headerMap['氏名'];
    const curName = nameCol ? String(row[nameCol - 1] === undefined ? '' : row[nameCol - 1]).trim() : '';
    const nameMissing = !curName || /^未登録児童/.test(curName) || /\(Googleアカウント\)/.test(curName);

    const schoolCol = headerMap['学校名'];
    const curSchool = schoolCol ? String(row[schoolCol - 1] === undefined ? '' : row[schoolCol - 1]).trim() : '';
    const schoolMissing = !curSchool || curSchool === '未設定';

    if (!classMissing && !nameMissing && !schoolMissing) return false;

    const info = hbChildIdentityLookup(studentId);
    if (!info || !info.found) return false;

    const patch = {};
    const newClass = String(info.class_name || '').trim();
    if (classMissing && newClass && newClass !== '未設定') patch[clsCol] = newClass;
    if (nameCol && nameMissing) {
      const newName = String(info.student_name || '').trim();
      if (newName && newName !== '未設定') patch[nameCol] = newName;
    }
    if (schoolCol && schoolMissing) {
      const newSchool = String(info.school_name || '').trim();
      if (newSchool && newSchool !== '未設定') patch[schoolCol] = newSchool;
    }
    const cols = Object.keys(patch);
    if (!cols.length) return false;

    let target = sheet;
    if (!target) target = getTargetSheet(CONFIG.DEVICE_SHEET_NAME);
    if (!target) return false;

    for (let i = 0; i < cols.length; i++) {
      const c = Number(cols[i]);
      const v = patch[cols[i]];
      target.getRange(rowNum, c).setValue(v);
      row[c - 1] = v;
    }
    return true;
  } catch (e) {
    return false;
  }
}

function isShardParent() {
  try { return shardModeFlags().parent === true; } catch (e) { return false; }
}

/**
 * 子GASを「設定漏れがあっても」自動判別する安全網。
 *
 * 【なぜ必要か】
 *   子GASのスクリプトプロパティ SHARD_CHILD_MODE=true を入れ忘れると
 *   isShardChild() が false になり、resolveSchedulePayloadForDevice_ が
 *   親用ロジック（buildSchedulePayloadForDevice_）へ落ちて子シートを直接読む。
 *   ところが「子シートにはスケジュール行を書かない」のが確定仕様なので、
 *   端末には常に空の schedules が返り、予約が一切効かなくなる。
 *   実機ではこれが「親→子は HTTP 200 なのに端末で制限が動かない」症状になった。
 *
 * 【判定材料に SHARD_SECRET を使わない理由】
 *   親GASも getOrCreateShardSecret() で SHARD_SECRET を保持している。
 *   これを子の証拠にすると親が子と誤判定され、全端末のハートビートが
 *   空キャッシュ参照になって全滅する。よって「親が絶対に書かないキー」だけを見る。
 *
 *   ・SHARD_SCHEDULES_CACHE … 親から schedules を受け取ったときだけ書かれる
 *   ・SHARD_INBOX_SEEN      … shard_apply を受けた痕跡（予約0件でも残す）
 */
function shardDetectChildByInbox_() {
  try {
    if (typeof PropertiesService === 'undefined') return false;
    // 明示設定が最優先。明示的に「親」なら絶対に子と判定しない。
    var explicitChild = false;
    var explicitParent = false;
    try { explicitChild = propBool(PROP_SHARD_CHILD_MODE, false); } catch (eC1) {}
    try { explicitParent = propBool(PROP_SHARD_MODE, false); } catch (eC2) {}
    if (explicitChild) return true;
    if (explicitParent) return false;

    var props = PropertiesService.getScriptProperties();
    var cacheRaw = props.getProperty('SHARD_SCHEDULES_CACHE');
    if (cacheRaw !== null && cacheRaw !== undefined && String(cacheRaw).trim() !== '') return true;
    var seen = props.getProperty('SHARD_INBOX_SEEN');
    if (seen !== null && seen !== undefined && String(seen).trim() !== '') return true;
    return false;
  } catch (e) {
    return false;
  }
}

function isShardChild() {
  try { if (shardModeFlags().child === true) return true; } catch (e) { /* 自動判別へ */ }
  // 設定漏れの救済（実機で発生した断線の再発防止）
  try { if (typeof shardDetectChildByInbox_ === 'function' && shardDetectChildByInbox_()) return true; } catch (e2) {}
  return false;
}

/**
 * クラス名を比較用の正規化キーへ寄せる。
 *   「5年1組」「５年１組」「5-1」「5/1」「5組」→「5-1」
 *   学年の数字と組の数字を「学年-組」に統一する（全角数字も吸収）。
 */
function normalizeShardClass(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  // 全角数字・全角英字を半角へ
  s = s.replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); });
  s = s.replace(/[Ａ-Ｚａ-ｚ]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); });
  // 空白（全角含む）を除去
  s = s.replace(/[\s\u3000]+/g, '');
  if (!s || s === '未設定') return '';
  // 「5年1組」「5-1」「5/1」「5年1組」など
  let m = s.match(/^(\d{1,2})\s*[年\-ー/／]\s*(\d{1,2})/);
  if (m) return Number(m[1]) + '-' + Number(m[2]);
  // 「5組」だけ → 5-1 とみなす
  m = s.match(/^(\d{1,2})組?$/);
  if (m) return Number(m[1]) + '-1';
  return s;
}

/**
 * マッピング（{ クラス名: 子GASのURL }）を読む。プロパティ優先・CONFIG フォールバック。
 *
 * プロパティの JSON が壊れていても親の実行は止めない。
 *   ・パース失敗／配列／非オブジェクト → 警告を出して CONFIG.SHARD_MAP を使う
 *   ・空キー ""（または正規化して空になるキー）は「既定のルーティング先」として残す
 */
function readShardMapRaw() {
  const cfgFallback = (CONFIG && CONFIG.SHARD_MAP && typeof CONFIG.SHARD_MAP === 'object' && !Array.isArray(CONFIG.SHARD_MAP))
    ? CONFIG.SHARD_MAP : {};
  const copyFallback = function () {
    const out = {};
    const ks = Object.keys(cfgFallback);
    for (let i = 0; i < ks.length; i++) out[ks[i]] = cfgFallback[ks[i]];
    return out;
  };

  let raw = null;
  try {
    raw = PropertiesService.getScriptProperties().getProperty(SHARD_MAP_PROP);
  } catch (e) {
    cfgWarn('SHARD_MAP_V1 を読み取れませんでした（' + String((e && e.message) || e) + '）。CONFIG の既定マップを使用します。');
    return copyFallback();
  }
  if (raw === null || raw === undefined || String(raw).trim() === '') {
    return copyFallback();
  }

  let o = null;
  try {
    o = JSON.parse(String(raw));
  } catch (e) {
    cfgWarn('SHARD_MAP_V1 の JSON パースに失敗しました（' + String((e && e.message) || e) + '）。CONFIG の既定マップを使用します。');
    return copyFallback();
  }
  if (!o || typeof o !== 'object' || Array.isArray(o)) {
    cfgWarn('SHARD_MAP_V1 がオブジェクトではありません。CONFIG の既定マップを使用します。');
    return copyFallback();
  }
  return o;
}

function readShardDefaultUrl() {
  const fallback = String((CONFIG && CONFIG.SHARD_DEFAULT_URL) || '').trim();
  try {
    const raw = PropertiesService.getScriptProperties().getProperty(SHARD_DEFAULT_PROP);
    if (raw === null || raw === undefined) return fallback;
    const s = String(raw).trim();
    return s || fallback;
  } catch (e) {
    return fallback;
  }
}

/**
 * 空キー（"" / 空白のみ / 「未設定」など正規化して空になるキー）で指定された
 * 既定のルーティング先を返す。無ければ ''。
 * SHARD_MAP_V1 の {"": "https://…/exec"} を「フォールバック指定」として扱う。
 */
function shardMapDefaultFromEmptyKey(map) {
  const src = (map && typeof map === 'object') ? map : {};
  const keys = Object.keys(src);
  for (let i = 0; i < keys.length; i++) {
    if (normalizeShardClass(keys[i]) !== '') continue;
    const v = String(src[keys[i]] || '').trim();
    if (v && /^https?:\/\//i.test(v)) return v;
    if (v) {
      shardWarnOnce('emptydflt-bad:' + i, 'SHARD_MAP_V1 の空キー既定URLが http(s):// で始まりません（' + v + '）。無視します。');
    }
  }
  return '';
}

/** 親⇔子の共有シークレット。未生成なら生成して保存する（親のみ）。 */
function getOrCreateShardSecret() {
  try {
    const props = PropertiesService.getScriptProperties();
    let s = String(props.getProperty(SHARD_SECRET_PROP) || '').trim();
    if (!s) {
      s = 'sk_' + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
      props.setProperty(SHARD_SECRET_PROP, s);
    }
    return s;
  } catch (e) {
    return '';
  }
}

/**
 * 【初期設定用】親GASの共有シークレットを生成して実行ログに出す。
 * エディタ上部の関数選択から実行する（手順書 §4-1）。
 * 生成は冪等。既に値があればそれを返す（変更しない）。
 */
function generateShardSecretForSetup() {
  const s = getOrCreateShardSecret();
  if (!s) {
    Logger.log('SHARD_SECRET の生成に失敗しました。スクリプトプロパティへの書き込み権限を確認してください。');
    return '';
  }
  Logger.log('SHARD_SECRET = ' + s);
  Logger.log('この値を全子GASのスクリプトプロパティ SHARD_SECRET に同じ内容で設定してください。');
  return s;
}

/**
 * 【初期設定用】共有シークレットを再発行する（漏洩時のみ）。
 * 実行後は全子GASに新しい値を設定し直すこと（手順書 §4-3）。
 */
function rotateShardSecretForSetup() {
  try {
    PropertiesService.getScriptProperties().deleteProperty(SHARD_SECRET_PROP);
  } catch (e) {
    Logger.log('既存 SHARD_SECRET の削除に失敗しました: ' + e);
  }
  const s = getOrCreateShardSecret();
  invalidateShardConfig();
  if (!s) {
    Logger.log('SHARD_SECRET の再発行に失敗しました。');
    return '';
  }
  Logger.log('新しい SHARD_SECRET = ' + s);
  Logger.log('全子GASのスクリプトプロパティ SHARD_SECRET をこの値に更新してください。');
  return s;
}

/** 受け取ったシークレットが正しいか。未設定なら常に false（安全側）。 */
function shardSecretMatches(given) {
  let expect = '';
  try {
    expect = String(PropertiesService.getScriptProperties().getProperty(SHARD_SECRET_PROP) || '').trim();
  } catch (e) {
    return false;
  }
  if (!expect) return false;
  const g = String(given || '').trim();
  if (!g) return false;
  // 長さが違えば早期に false（比較は全文字走査）
  if (g.length !== expect.length) return false;
  let diff = 0;
  for (let i = 0; i < g.length; i++) diff |= (g.charCodeAt(i) ^ expect.charCodeAt(i));
  return diff === 0;
}

/**
 * 分散設定（マップ・既定URL・シークレット）をキャッシュ経由で取得する。
 * ハートビート毎の PropertiesService 読み取りを避ける（SHARD_MODE 有効時のみ使われる）。
 */
function shardConfigCached() {
  try {
    const cache = CacheService.getScriptCache();
    const hit = cache.get(SHARD_CFG_CACHE);
    if (hit) {
      const o = JSON.parse(hit);
      if (o && typeof o === 'object') return o;
    }
  } catch (e) { /* キャッシュ不可時は下へ */ }

  const cfg = { map: readShardMapRaw(), def: readShardDefaultUrl(), sec: getOrCreateShardSecret() };
  try {
    CacheService.getScriptCache().put(SHARD_CFG_CACHE, JSON.stringify(cfg), 300);
  } catch (e) {}
  return cfg;
}

function invalidateShardConfig() {
  try {
    const c = CacheService.getScriptCache();
    c.remove(SHARD_CFG_CACHE);
    // プロパティを変えた直後に反映されるよう、動的解決のキャッシュも破棄する
    c.remove(SHARD_MODE_CACHE);
    c.remove(SHARD_SSID_CACHE);
  } catch (e) {}
}

/** { 生のクラス名: URL } → { 正規化キー: URL } の索引を作る。 */
function shardMapIndexFromMap(map) {
  const idx = {};
  const src = (map && typeof map === 'object') ? map : {};
  const keys = Object.keys(src);
  for (let i = 0; i < keys.length; i++) {
    const rawKey = String(keys[i]);
    const v = String(src[keys[i]] || '').trim();

    // 値が無い項目は索引に入れない（設定ミスで端末がどこにも繋がらないのを防ぐ）
    if (!v) {
      shardWarnOnce('map-noval:' + rawKey, 'SHARD_MAP_V1 の「' + rawKey + '」に URL がありません。この項目は無視します。');
      continue;
    }
    // URL として不正な値は捨てる（誤ったURLへ端末を飛ばさない）
    if (!/^https?:\/\//i.test(v)) {
      shardWarnOnce('map-badurl:' + rawKey, 'SHARD_MAP_V1 の「' + rawKey + '」の URL が http(s):// で始まりません（' + v + '）。この項目は無視します。');
      continue;
    }

    const k = normalizeShardClass(rawKey);
    if (!k) continue; // 空キーは既定URLとして shardMapDefaultFromEmptyKey が扱う

    if (idx[k] && idx[k] !== v) {
      shardWarnOnce('map-dup:' + k, 'SHARD_MAP_V1 でクラス「' + k + '」が重複しています。先に見つかった URL を使用します。');
      continue;
    }
    idx[k] = v;
  }
  return idx;
}

/**
 * 端末に返す割り当て先を解決する（親のみ）。
 * 親でない／子GASが未設定なら {} を返す＝応答に何も足さない（従来動作と同一）。
 */
function resolveShardForHeartbeat(studentId, classHint) {
  if (!isShardParent()) return {};
  try {
    const cfg = shardConfigCached();
    const idx = shardMapIndexFromMap(cfg.map);
    const key = normalizeShardClass(classHint);

    // ① クラスが一致 → そのクラスの子GAS
    if (key && idx[key]) {
      return { assigned_gas_url: idx[key], assigned_class: key, shard_mode: true };
    }

    // ② クラスが未取得・不一致 → SHARD_MAP_V1 の空キー（既定）→ SHARD_DEFAULT_URL の順
    const emptyDefault = shardMapDefaultFromEmptyKey(cfg.map);
    if (emptyDefault) {
      shardWarnOnce('route-empty:' + String(classHint || '(none)'),
        'クラス「' + String(classHint || '(未取得)') + '」はマップに無いため、SHARD_MAP_V1 の空キー既定URLへ割り当てました。');
      return { assigned_gas_url: emptyDefault, assigned_class: '', shard_mode: true };
    }
    const def = String(cfg.def || '').trim();
    if (def) {
      shardWarnOnce('route-def:' + String(classHint || '(none)'),
        'クラス「' + String(classHint || '(未取得)') + '」はマップに無いため、SHARD_DEFAULT_URL へ割り当てました。');
      return { assigned_gas_url: def, assigned_class: '', shard_mode: true };
    }

    // ③ どこにも繋げない → 親のまま動かす（端末を止めない）。原因究明用に警告を残す。
    shardWarnOnce('route-none:' + String(classHint || '(none)'),
      'クラス「' + String(classHint || '(未取得)') + '」に一致する子GASがありません。端末は親に接続したままです。'
      + ' SHARD_MAP_V1 のキー（例: "5年1組"）と端末側のクラス名を確認してください。');
  } catch (e) {
    // 解決に失敗しても端末の通信は止めない（親に繋がったまま＝従来動作）
    cfgWarn('resolveShardForHeartbeat で例外: ' + String((e && e.message) || e));
  }
  return {};
}

/**
 * 子GAS側: 親から受け取ったポリシーを自分のシートへ適用する。
 * ポリシーの「正」は親にあるため、子は受け取った内容をそのまま反映するだけ。
 */
/**
 * 子GAS側: 親から指示された児童の行が無ければ作る。
 *
 * 子のシートには「その子へハートビートした端末」しか行が無い。
 * bulkUpdateScreenLock 等は対象行が無いと無言で何もしないため、
 * 指示より先に行を用意しておかないと一括操作が永久に効かなくなる。
 *
 * classMap（{ 児童ID: クラス名 }）は親が付ける。子の行が最初から
 * 正しいクラスを持つようにして、子のシートが「未設定」で埋まるのを防ぐ。
 */
function shardEnsureDeviceRows(idList, classMap) {
  if (!Array.isArray(idList) || !idList.length) return 0;
  return withWriteLock(function () {
    const sheet = getTargetSheet(CONFIG.DEVICE_SHEET_NAME);
    const headerMap = getHeaderMap(sheet, CONFIG.DEVICE_COLUMNS);
    const data = sheet.getDataRange().getValues();
    const idCol = headerMap['児童ID'] - 1;

    const existing = {};
    for (let i = 1; i < data.length; i++) {
      const id = String(data[i][idCol] || '').trim();
      if (id) existing[id] = true;
    }

    let created = 0;
    for (let k = 0; k < idList.length; k++) {
      const id = String(idList[k] || '').trim();
      if (!id || existing[id]) continue;
      const newRow = new Array(CONFIG.DEVICE_COLUMNS.length).fill('');
      newRow[headerMap['児童ID'] - 1] = id;
      newRow[headerMap['学校名'] - 1] = '未設定';
      newRow[headerMap['氏名'] - 1] = '未登録児童 (' + id + ')';
      newRow[headerMap['クラス'] - 1] = String((classMap && classMap[id]) || '未設定');
      newRow[headerMap['画面ロック'] - 1] = false;
      newRow[headerMap['URL規制モード'] - 1] = 'OFF';
      sheet.appendRow(newRow);
      existing[id] = true;
      created++;
    }
    return created;
  });
}

function shardApplyFromParent(payload) {
  if (!isShardChild() && !isShardParent()) {
    // 役割未設定のスクリプトが外部から操作されないようにする
    return { success: false, error: '子GASとして構成されていません' };
  }
  if (!shardSecretMatches(payload && payload.shard_secret)) {
    return { success: false, error: 'unauthorized（共有シークレットが一致しません）' };
  }
  // ① 教員稼働状態の同期（親コンソールにしかログインしないため、子は親から受け取る）。
  //    子の既存の ka 機構（touchTeacherConsole / releaseTeacherConsole）をそのまま使う。
  //    これにより子の isTeacherConsoleActive() が正しく true になり、端末が同期を続けられる。
  let kaApplied = null;
  if (payload && payload.ka_active !== undefined) {
    try {
      if (payload.ka_active) {
        touchTeacherConsole('__shard_parent__');
        kaApplied = true;
      } else {
        releaseTeacherConsole('__shard_parent__');
        kaApplied = false;
      }
    } catch (e) {
      kaApplied = null;
    }
  }

  // 【フェーズ5】親から同封された「展開済みスケジュール」を PropertiesService へ保存する。
  //   ・親が繰り返し・曜日を解釈済みなので、子は再計算しない
  //   ・シートには書かない（子シートへのI/Oを増やさず、ハートビートを速く保つ）
  //   ・保存に失敗してもポリシー適用は続ける（スケジュールだけの欠落に留める）
  let scheduleSaved = null;
  if (payload && payload.schedules) {
    try {
      let sch = payload.schedules;
      if (typeof sch === 'string') {
        try { sch = JSON.parse(sch); } catch (eS) { sch = null; }
      }
      if (sch && typeof sch === 'object') {
        if (sch.by_student && typeof sch.by_student === 'object') {
          // 【確定仕様3】親は「その子GASの全児童」を丸ごと送ってくる。
          //   差分マージではなく置き換えにして、取消した予約が子に残り続ける
          //   不整合を原理的に排除する。
          scheduleSaved = shardSaveScheduleCache_(sch.by_student, sch.updated_ms, true);
        } else {
          // 児童ID→ウィンドウ の素の地図でも受け付ける（後方互換・こちらはマージ）
          scheduleSaved = shardSaveScheduleCache_(sch, 0, false);
        }
      }
    } catch (eSch) {
      scheduleSaved = { saved: 0, error: String((eSch && eSch.message) ? eSch.message : eSch) };
    }
  }

  // 【子GAS自動判別】shard_apply を受けた痕跡を残す。
  //   SHARD_CHILD_MODE の設定漏れがあっても、次回以降のハートビートで
  //   子GASとして判別できるようにする（設定漏れで制限が届かない事故の対策）。
  //   明示的に「親」と設定されているスクリプトには痕跡を残さない
  //   （親が子扱いされると全端末が壊れるため）。
  try {
    var __explicitParent = false;
    try { __explicitParent = propBool(PROP_SHARD_MODE, false); } catch (eXP) {}
    if (!__explicitParent) {
      PropertiesService.getScriptProperties()
        .setProperty('SHARD_INBOX_SEEN', String(new Date().getTime()));
    }
  } catch (eMark) { /* 記録できなくても本処理は続ける */ }

  // 【可観測性】子側で「実際に何件保存できたか」をログに残す。
  //   親のログには ensure しか出ておらず、保存件数が見えなかった。
  try {
    Logger.log('[SHARD] apply: 受信 schedules=' + JSON.stringify(scheduleSaved) +
      ' student_ids=' + (((payload && payload.student_ids) || []).length));
  } catch (eLg) {}

  const ids = (payload && payload.student_ids) || [];
  // 【R38】patch の正規化。
  //   ・文字列で届いた場合は JSON として解釈する（false が文字列になっても落とさない）
  //   ・isLock / locked という別名で届いても screen_lock として扱う
  //   Boolean("false") が true になる事故を避けるため、値の解釈は parseBoolean に一本化する。
  let patch = (payload && payload.patch) || {};
  if (typeof patch === 'string') {
    try { patch = JSON.parse(patch); } catch (eP) { patch = {}; }
  }
  if (!patch || typeof patch !== 'object') patch = {};
  if (patch.screen_lock === undefined) {
    if (patch.isLock !== undefined) patch.screen_lock = patch.isLock;
    else if (patch.locked !== undefined) patch.screen_lock = patch.locked;
  }
  const idList = Array.isArray(ids) ? ids : [];
  if (!idList.length) {
    // ka 伝達だけの呼び出しは正常（ポリシー変更なし）。
    // 【フェーズ5】ただし schedules は「ポリシーではない」ため、児童IDが空でも
    //   保存結果を必ず返す。返さないと親が「同期できたか」を確認できない。
    return { success: true, applied: 0, ka_active: kaApplied, schedules: scheduleSaved };
  }

  // 行の用意結果。try の外で宣言する（return が try の外にあるため、
  // try 内で let 宣言すると参照できず ReferenceError になる）。
  let ensureResult = { created: 0, error: '' };

  try {
    // 先に行を用意する。これが無いと、まだ子と通信していない児童への
    // 一括操作が「成功」を返しながら実際には何も適用されない。
    // ※ ここで失敗を握りつぶさない。行が作れない＝一括操作が効かない状態なので、
    //   応答に残して親（＝コンソールの操作結果）から見えるようにする。
    const classMap = (payload && payload.class_map) || null;
    try {
      ensureResult.created = shardEnsureDeviceRows(idList, classMap) || 0;
    } catch (e) {
      ensureResult.error = String((e && e.message) ? e.message : e);
    }

    if (patch.screen_lock !== undefined) {
      bulkUpdateScreenLock(idList, parseBoolean(patch.screen_lock));
    }
    // 【R38】真偽値判定だと空文字（配信の取り消し）が落ちる。undefined で判定する。
    if (patch.broadcast_url !== undefined && patch.broadcast_url !== null) {
      // 【要件1】親が採番した broadcast_id をそのまま使う。
      //   ここで '' を渡して子が generateBroadcastId() すると、同じ配信に別IDが付き、
      //   端末が「新しい配信」と誤認して同じページを新しいタブで開く（実機症状）。
      //   空のときだけ bulkUpdateBroadcastUrl 側がフォールバック発番する（後方互換）。
      bulkUpdateBroadcastUrl(idList, String(patch.broadcast_url), String(patch.broadcast_id || ''));
    }
    if (patch.filter_mode !== undefined) {
      bulkUpdateFilterMode(idList, String(patch.filter_mode),
        patch.whitelist_urls, patch.blacklist_urls);
    }
  } catch (e) {
    return { success: false, error: String(e) };
  }
  return {
    success: true,
    applied: idList.length,
    ka_active: kaApplied,
    ensure: ensureResult,
    // 【フェーズ5】スケジュールを保存できたかを親が確認できるようにする
    schedules: scheduleSaved
  };
}

/** 設定から子GASのURL一覧を取り出す（重複除去・既定URL含む）。 */
const SHARD_LIST_CACHE_TTL = 4;   // 秒。集約結果のキャッシュ（3〜5秒の範囲）
const SHARD_LIST_CACHE_PREFIX = 'shard_ls_';

/** キャッシュキー用の短いハッシュ（CacheService のキー長・可読性のため）。 */
function shardHash(str) {
  const s = String(str || '');
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) & 0x7fffffff;
  }
  return h.toString(36);
}

/** 端末一覧の版数（親が書き込むと進む）。キャッシュキーに混ぜて古い一覧を配らない。 */
function shardDevVersion() {
  try {
    if (typeof CacheService === 'undefined') return '0';
    return String(CacheService.getScriptCache().get('dev_v') || '0');
  } catch (e) {
    return '0';
  }
}

/**
 * 複数リクエストを並列で送る。
 * fetchAll が使える環境では 1 回分の待ち時間で全件を取得する（今回の主目的）。
 * 使えない環境（テスト・古いランタイム）では直列 fetch へフォールバックし、挙動を変えない。
 */
function shardFetchMany(requests) {
  const reqs = Array.isArray(requests) ? requests : [];
  if (!reqs.length) return [];
  try {
    if (UrlFetchApp && typeof UrlFetchApp.fetchAll === 'function') {
      const out = UrlFetchApp.fetchAll(reqs);
      if (out && out.length === reqs.length) return out;
    }
  } catch (e) {
    // 並列化に失敗しても取得自体は諦めない（直列へ）
  }
  const out = [];
  for (let i = 0; i < reqs.length; i++) {
    const params = {};
    const keys = Object.keys(reqs[i] || {});
    for (let k = 0; k < keys.length; k++) {
      if (keys[k] !== 'url') params[keys[k]] = reqs[i][keys[k]];
    }
    try {
      out.push(UrlFetchApp.fetch(reqs[i].url, params));
    } catch (e2) {
      out.push(null);
    }
  }
  return out;
}

/**
 * この教員のために問い合わせる必要がある子GASのURLを選ぶ。
 *
 * ・管理者 / 対象クラス未設定 … 全子GAS（全校・全学年の表示に対応）
 * ・対象クラスあり（専科等） … そのクラスを担当する子GASのみ
 *   ＝ 1 クラス分の通信で済む（並列化と合わせて最も効く経路）
 * ・該当が無い場合は安全側で全件へフォールバック（設定不備で児童が消えないように）
 */
function shardUrlsForTeacher(cfg, teacher) {
  const all = shardAllChildUrls(cfg);
  if (!all.length) return all;

  let targets = [];
  try {
    targets = (typeof getTeacherTargetClasses === 'function') ? getTeacherTargetClasses(teacher) : [];
  } catch (e) {
    targets = [];
  }
  if (!targets.length) return all;

  const idx = shardMapIndexFromMap(cfg && cfg.map);
  const want = {};
  let wantCount = 0;
  for (let i = 0; i < targets.length; i++) {
    const k = normalizeShardClass(targets[i]);
    if (k) { want[k] = true; wantCount++; }
  }
  if (!wantCount) return all;

  const hit = {};
  const keys = Object.keys(idx);
  for (let i = 0; i < keys.length; i++) {
    if (want[keys[i]]) hit[idx[keys[i]]] = true;
  }

  const out = [];
  for (let i = 0; i < all.length; i++) {
    if (hit[all[i]]) out.push(all[i]);
  }
  // 既定URL（クラス不明の児童の受け皿）は取りこぼさないよう常に含める。
  const def = String((cfg && cfg.def) || '').trim();
  if (def && all.indexOf(def) >= 0 && out.indexOf(def) < 0) out.push(def);

  return out.length ? out : all;
}

function shardAllChildUrls(cfg) {
  const out = [];
  const seen = {};
  const push = function (u) {
    const s = String(u || '').trim();
    if (!s || seen[s]) return;
    seen[s] = true;
    out.push(s);
  };
  const idx = shardMapIndexFromMap(cfg && cfg.map);
  const keys = Object.keys(idx);
  for (let i = 0; i < keys.length; i++) push(idx[keys[i]]);
  // 空キー既定（SHARD_MAP_V1 の ""）も子GASの1台として数える
  push(shardMapDefaultFromEmptyKey(cfg && cfg.map));
  push(cfg && cfg.def);
  return out;
}

/**
 * 親GAS側: 教員コンソールの稼働状態を子GASへ伝達する。
 *
 * 【なぜ必要か】
 *   教員は親コンソールにしかログインしない。子GASの isTeacherConsoleActive() は
 *   自分への touch が無いため永久に false になり、子が担当する端末は
 *   ka_active=false を受け取って同期を停止してしまう（分散化した瞬間に全端末停止）。
 *   そこで親が touch/release のたびに子へ稼働状態を配る。
 *
 * 【負荷】
 *   active=true は 30 秒に 1 回へ間引く（子側の判定窓は 120 秒なので十分）。
 *   release は即時。子は 6 クラス程度なので、追加通信は毎分 12 回程度に収まる。
 */
function shardPropagateKaState(active) {
  if (!isShardParent()) return { skipped: true };
  try {
    const cfg = shardConfigCached();
    const urls = shardAllChildUrls(cfg);
    if (!urls.length) return { skipped: true, reason: 'no_child' };

    if (active) {
      // 30 秒に 1 回へ間引く（子の KA_ACTIVE_WINDOW_MS=120秒 に対して十分細かい）
      try {
        const cache = CacheService.getScriptCache();
        const k = 'shard_ka_ts';
        const last = Number(cache.get(k) || '0');
        const nowMs = new Date().getTime();
        if (last && (nowMs - last) < 30000) return { throttled: true };
        cache.put(k, String(nowMs), 180);
      } catch (e) { /* キャッシュ不可時は毎回送る */ }
    }

    const body = JSON.stringify({
      action: 'shard_apply',
      shard_secret: cfg.sec,
      student_ids: [],
      ka_active: !!active
    });
    // 全校分あっても 1 回分の待ち時間で配信する（並列）。
    const requests = [];
    for (let i = 0; i < urls.length; i++) {
      requests.push({
        url: urls[i], method: 'post', contentType: 'application/json',
        payload: body, muteHttpExceptions: true
      });
    }
    const responses = shardFetchMany(requests);
    const results = [];
    for (let i = 0; i < responses.length; i++) {
      const res = responses[i];
      if (res) results.push({ ok: true, status: res.getResponseCode() });
      else results.push({ ok: false, error: 'no_response' });
    }
    return { sent: results.length, active: !!active };
  } catch (e) {
    return { error: String(e) };
  }
}

/**
 * 親GAS側: 子GASの端末一覧を取得してマージするための材料を集める。
 * 子側は shard_list で「その子が持つ全端末（スコープ適用前）」を返す。
 * スコープ（学校・対象クラス）の適用は親が行う＝教員マスタの正は親にあるため。
 */
/**
 * 教員コンソールの get_all 用: 親のシート + 子GASの端末を集約して返す。
 *
 * 分散が無効（SHARD_MODE=false）のときは getAllDevices をそのまま返す＝従来と完全同一。
 * 有効なときは「集約後の全件レスポンス」を 3〜5 秒キャッシュする。
 * キーに dev_v を混ぜているため、ロック/配信/規制などの書き込みで自動的に失効する
 * （＝操作直後は必ず最新、自動更新や連続操作ではキャッシュに当たる）。
 */
// ==================== 診断用（R30 実測） ====================
// 原因が判明したら SHARD_DIAG_MODE を false にしてください（ログが止まります）。
const SHARD_DIAG_MODE = true;

/**
 * 診断ログ。SHARD_DIAG_MODE=false のときは何もしない。
 *
 * 【テスト環境で落とさないための工夫】
 *   この関数はテストが gas/Code.gs から関数単体で切り出して実行する。
 *   その環境には SHARD_DIAG_MODE / Logger が無い場合があるため、
 *   typeof で存在確認してから触る（ReferenceError を出さない）。
 */
function shardDiagLog(msg) {
  try {
    if (typeof SHARD_DIAG_MODE === 'undefined' || !SHARD_DIAG_MODE) return;
    if (typeof Logger === 'undefined') return;
    Logger.log('[SHARD-DIAG] ' + String(msg));
  } catch (e) { /* ログ失敗は本処理に影響させない */ }
}

/** ログ用に長い文字列を切り詰める（応答本文をそのまま出すとログが溢れるため）。 */
function shardDiagClip(v, n) {
  const s = String(v === undefined || v === null ? '' : v);
  const max = n || 400;
  return s.length > max ? (s.slice(0, max) + '…(全' + s.length + '文字)') : s;
}

/**
 * 【手動実行用】SHARD 構成を一括診断する。
 *
 * 使い方: GAS エディタ上部の関数選択で diagShardSetup を選び「実行」→「実行ログ」を見る。
 * 親GAS と 子GAS の両方で実行すると、どちら側の設定が欠けているか即座に分かる。
 */
// ==================== 診断用（R32 実測: api_bulkLock の内訳） ====================
// 「画面ロックが 5 秒かかる」の内訳（どこで何秒）を実行ログに出す一時計測。
//   Logger.log -> GAS エディタの「実行数 / 実行トランスクリプト」に出る。
//   出力例:
//     [BULK-TRACE] STEP bulkUpdateScreenLock:getDataRange +820ms (累計 1210ms)
//     [BULK-TRACE] 集計 api_bulkLock 総計 4321ms
//     1. verifyToken(HMAC検証): 12ms
//     2. ...
// 不要になったら BULK_LOCK_TRACE = false にする（ログが止まる。処理は一切変わらない）。
const BULK_LOCK_TRACE = true;

/** 計測が有効か（GAS 以外のテスト環境では Logger/BULK_LOCK_TRACE が無い）。 */
function bulkTraceEnabled() {
  try {
    if (typeof BULK_LOCK_TRACE === 'undefined' || !BULK_LOCK_TRACE) return false;
    if (typeof Logger === 'undefined') return false;
    return true;
  } catch (e) {
    return false;
  }
}

/** 現在時刻(ms)。失敗しても 0 を返し、本処理を止めない。 */
function bulkTraceNow() {
  try { return new Date().getTime(); } catch (e) { return 0; }
}

/**
 * 計測状態。グローバル変数を作らず関数オブジェクトのプロパティに持つ
 * （このファイルの関数を単体で切り出して実行するテストでも安全）。
 */
function bulkTraceState() {
  try {
    if (!bulkTraceState.__s) bulkTraceState.__s = { t0: 0, last: 0, steps: [], label: '' };
    return bulkTraceState.__s;
  } catch (e) {
    return { t0: 0, last: 0, steps: [], label: '' };
  }
}

/** 計測開始。t0 をリセットして区間の起点にする。 */
function bulkTraceBegin(label) {
  try {
    if (!bulkTraceEnabled()) return;
    const s = bulkTraceState();
    const now = bulkTraceNow();
    s.t0 = now;
    s.last = now;
    s.steps = [];
    s.label = String(label || '');
    let stamp = '';
    try { stamp = new Date().toISOString(); } catch (e2) { stamp = ''; }
    Logger.log('[BULK-TRACE] 開始 ' + s.label + (stamp ? ' @ ' + stamp : ''));
  } catch (e) { /* 計測失敗は本処理に影響させない */ }
}

/** 区間の区切り。直前のマークからの経過msを記録してログに出す。 */
function bulkTraceMark(label) {
  try {
    if (!bulkTraceEnabled()) return;
    const s = bulkTraceState();
    if (!s.t0) return; // 計測外（begin されていない実行）では何もしない
    const now = bulkTraceNow();
    const dt = now - s.last;
    s.steps.push([String(label), dt]);
    s.last = now;
    Logger.log('[BULK-TRACE] STEP ' + String(label) + ' +' + dt + 'ms (累計 ' + (now - s.t0) + 'ms)');
  } catch (e) { /* 計測失敗は本処理に影響させない */ }
}

/** 計測終了。区間ごとの内訳と総計をまとめて1ブロックで出す。 */
function bulkTraceEnd(name) {
  try {
    if (!bulkTraceEnabled()) return;
    const s = bulkTraceState();
    if (!s.t0) return;
    const now = bulkTraceNow();
    const total = now - s.t0;
    const lines = [];
    for (let i = 0; i < s.steps.length; i++) {
      lines.push((i + 1) + '. ' + s.steps[i][0] + ': ' + s.steps[i][1] + 'ms');
    }
    const title = String(name || s.label || '');
    Logger.log('[BULK-TRACE] 集計 ' + title + ' 総計 ' + total + 'ms\n' + lines.join('\n'));
    s.t0 = 0;
    s.steps = [];
  } catch (e) { /* 計測失敗は本処理に影響させない */ }
}

function diagShardSetup() {
  const lines = [];
  const p = function (s) { lines.push(String(s)); };
  const safe = function (label, fn) {
    try { p(label + ' = ' + String(fn())); }
    catch (e) { p(label + ' = 例外: ' + String((e && e.message) || e)); }
  };

  p('===== SHARD 構成診断 =====');
  p('日時: ' + new Date().toString());

  safe('SHARD_MODE(プロパティ生値)', function () { return propRaw(PROP_SHARD_MODE); });
  safe('SHARD_CHILD_MODE(プロパティ生値)', function () { return propRaw(PROP_SHARD_CHILD_MODE); });
  safe('SPREADSHEET_ID(解決後)', function () { return getSpreadsheetId(); });

  p('--- 役割判定 ---');
  safe('isShardParent()', function () { return isShardParent(); });
  safe('isShardChild()', function () { return isShardChild(); });

  p('--- 共有シークレット ---');
  safe('SHARD_SECRET の長さ', function () {
    const v = String(PropertiesService.getScriptProperties().getProperty(SHARD_SECRET_PROP) || '');
    return v ? (v.length + ' 文字（値そのものは表示しません）') : '未設定（空）';
  });

  p('--- 子GASのURL一覧 ---');
  let urls = [];
  try {
    const cfg = shardConfigCached();
    urls = shardAllChildUrls(cfg);
    p('子GASの台数 = ' + urls.length);
    for (let i = 0; i < urls.length; i++) p('  [' + i + '] ' + urls[i]);
    p('SHARD_MAP_V1 = ' + String(shardDiagClip(JSON.stringify(cfg.map || {}), 600)));
    p('SHARD_DEFAULT_URL = ' + String(cfg.def || '(未設定)'));
  } catch (e) {
    p('子GASのURL解決で例外: ' + String((e && e.message) || e));
  }

  // 子GASへ実際に shard_list を投げて応答をそのまま観察する（これが核心）
  p('--- 子GASへの shard_list 実測 ---');
  if (!urls.length) {
    p('子GASが1台も設定されていません（親GASとしては集約できません）');
  } else {
    try {
      const cfg2 = shardConfigCached();
      const body = JSON.stringify({ action: 'shard_list', shard_secret: cfg2.sec });
      for (let i = 0; i < urls.length; i++) {
        try {
          const res = UrlFetchApp.fetch(urls[i], {
            method: 'post', contentType: 'application/json', payload: body,
            muteHttpExceptions: true
          });
          const code = res.getResponseCode();
          const text = res.getContentText() || '';
          let judge = '';
          try {
            const o = JSON.parse(text);
            if (o && o.success === true) {
              judge = '正常（data ' + (Array.isArray(o.data) ? o.data.length : '?') + ' 件）';
            } else if (o && o.success === false) {
              judge = '★失敗: success=false error=' + String(o.error || '(理由なし)');
            } else {
              judge = '応答形式が想定外';
            }
          } catch (e2) {
            judge = '★JSONではありません（ログイン画面/HTML の可能性）';
          }
          p('  [' + i + '] status=' + code + ' → ' + judge);
          p('      本文先頭: ' + shardDiagClip(text, 300));
        } catch (e3) {
          p('  [' + i + '] 通信例外: ' + String((e3 && e3.message) || e3));
        }
      }
    } catch (e4) {
      p('実測中に例外: ' + String((e4 && e4.message) || e4));
    }
  }

  p('--- 親シートの生データ（先頭3件） ---');
  try {
    const dev = getAllDevices('ALL', { role: 'ADMIN' }, true);
    p('親シート由来 = ' + (Array.isArray(dev) ? dev.length : '?') + ' 件');
    for (let i = 0; i < dev.length && i < 3; i++) {
      p('  [' + i + '] id=' + String(dev[i].student_id || '空') +
        ' last_seen=' + String(dev[i].last_seen || '空') +
        ' is_online=' + String(dev[i].is_online));
    }
  } catch (e5) {
    p('親シート読み取りで例外: ' + String((e5 && e5.message) || e5));
  }

  p('--- 集約結果（getShardMergedDevices） ---');
  try {
    const merged = getShardMergedDevices('ALL', { role: 'ADMIN' }, true);
    p('集約後 = ' + (Array.isArray(merged) ? merged.length : '?') + ' 件');
    let on = 0;
    for (let i = 0; i < merged.length; i++) {
      if (merged[i] && merged[i].is_online === true) on++;
      if (i < 5) {
        p('  [' + i + '] id=' + String((merged[i] || {}).student_id || '空') +
          ' last_seen=' + String((merged[i] || {}).last_seen || '空') +
          ' src=' + String((merged[i] || {}).last_seen_source || '-') +
          ' is_online=' + String((merged[i] || {}).is_online));
      }
    }
    p('オンライン件数 = ' + on + ' / ' + (Array.isArray(merged) ? merged.length : '?'));
  } catch (e6) {
    p('集約で例外: ' + String((e6 && e6.message) || e6));
  }

  p('===== 診断ここまで =====');
  const text = lines.join('\n');
  try { Logger.log(text); } catch (e) {}
  return text;
}

function getShardMergedDevices(filterSchool, teacher, includeUnassigned) {
  // 【DIAG-1】集約が「親モード」として動いているか。
  // false の場合、子GASには一切問い合わせず親シートの古い日時だけで判定する（＝症状の直接原因）。
  if (typeof shardDiagLog === 'function') {
    shardDiagLog('DIAG-1 集約開始 isShardParent=' + String(isShardParent()) +
      ' filterSchool=' + String(filterSchool) +
      ' includeUnassigned=' + String(!!includeUnassigned));
  }
  if (!isShardParent()) {
    if (typeof shardDiagLog === 'function') {
      shardDiagLog('DIAG-2 ★親モードではありません（子GASへ問い合わせません）' +
        ' → 親GASのスクリプトプロパティ SHARD_MODE=true が必要です');
    }
    return getAllDevices(filterSchool, teacher, includeUnassigned);
  }

  const t = teacher || {};
  const scopeKey = [
    filterSchool || 'ALL',
    includeUnassigned ? '1' : '0',
    t.email || '', t.school || '', t.role || '', t.target_class || ''
  ].join('|');
  const cacheKey = 'shard_ga_' + shardHash(scopeKey) + '_' + shardDevVersion();

  let cache = null;
  try {
    if (typeof CacheService !== 'undefined') {
      cache = CacheService.getScriptCache();
      const hit = cache.get(cacheKey);
      if (hit) {
        const arr = JSON.parse(hit);
        if (Array.isArray(arr)) return arr;
      }
    }
  } catch (e) {
    cache = null;
  }

  const baseData = getAllDevices(filterSchool, teacher, includeUnassigned);
  const data = shardMergeDevices(baseData, filterSchool, teacher, includeUnassigned);

  if (cache) {
    try { cache.put(cacheKey, JSON.stringify(data), SHARD_LIST_CACHE_TTL); } catch (e) {}
  }
  // 【DIAG-5】最終的にコンソールへ返る内容（ここが is_online=false の実体）
  if (typeof shardDiagLog === 'function') {
    const arrD = Array.isArray(data) ? data : [];
    let onN = 0;
    const heads = [];
    for (let di = 0; di < arrD.length; di++) {
      if (arrD[di] && arrD[di].is_online === true) onN++;
      if (di < 5) {
        heads.push(String((arrD[di] || {}).student_id || '?') +
          '[seen=' + String((arrD[di] || {}).last_seen || '空') +
          ',src=' + String((arrD[di] || {}).last_seen_source || '-') +
          ',on=' + String((arrD[di] || {}).is_online) + ']');
      }
    }
    shardDiagLog('DIAG-5 集約結果 ' + arrD.length + '件 オンライン=' + onN +
      '件 先頭=' + heads.join(' / '));
  }
  return data;
}

function shardFetchChildDevices(urlsOverride) {
  if (!isShardParent()) return [];
  try {
    const cfg = shardConfigCached();
    const urls = Array.isArray(urlsOverride) ? urlsOverride : shardAllChildUrls(cfg);
    if (!urls.length) return [];

    // 集約結果の短時間キャッシュ（3〜5秒）。
    // キーに dev_v を混ぜるため、教員がロック/配信/規制を行うと自動的に無効化される。
    // ＝ 操作直後は必ず最新、自動更新や連続操作ではキャッシュに当たる。
    const cacheKey = SHARD_LIST_CACHE_PREFIX + shardHash(urls.join(',') + '|' + shardDevVersion());
    let cache = null;
    try {
      if (typeof CacheService !== 'undefined') {
        cache = CacheService.getScriptCache();
        const hit = cache.get(cacheKey);
        if (hit) {
          const arr = JSON.parse(hit);
          if (Array.isArray(arr)) return arr;
        }
      }
    } catch (e) {
      cache = null;
    }

    if (typeof shardDiagLog === 'function') {
      shardDiagLog('DIAG-6 子GASへ問い合わせ 台数=' + urls.length + ' ' + urls.join(' , '));
    }
    const body = JSON.stringify({ action: 'shard_list', shard_secret: cfg.sec });
    const requests = [];
    for (let i = 0; i < urls.length; i++) {
      requests.push({
        url: urls[i], method: 'post', contentType: 'application/json',
        payload: body, muteHttpExceptions: true
      });
    }
    // 取得できた／できなかった子GASを記録する（診断用。配列のプロパティとして載せる）
    const diag = { requested: urls.length, ok: 0, failed: [], rows: 0 };

    // 並列（一括）取得。12 クラスあっても 1 回分の待ち時間で揃う。
    const responses = shardFetchMany(requests);

    const out = [];
    for (let i = 0; i < responses.length; i++) {
      const res = responses[i];
      if (!res) continue;
      try {
        const code = res.getResponseCode();
        if (code !== 200) {
          // 子GASが 200 以外を返した（共有シークレット不一致・公開範囲の誤り等）。
          // 以前はここで黙って捨てていたため、親コンソールには「親の古い行」だけが
          // 残り、端末がオフラインに見える原因が画面から全く分からなかった。
          diag.failed.push({ url: urls[i], status: code });
          if (typeof shardDiagLog === 'function') {
            shardDiagLog('DIAG-8 ★子GASが非200 status=' + code + ' url=' + urls[i] +
              ' 本文=' + shardDiagClip(res.getContentText(), 200));
          }
          continue;
        }
        const parsed = JSON.parse(res.getContentText() || '{}');
        // 【DIAG-9 最重要】子GASは失敗時も HTTP 200 で {success:false,error:...} を返す。
        // 従来はステータスしか見ていなかったため「成功・0件」と誤記録していた（R29 の穴）。
        if (typeof shardDiagLog === 'function') {
          shardDiagLog('DIAG-9 子GAS応答 status=' + code +
            ' success=' + String(parsed && parsed.success) +
            ' error=' + String((parsed && parsed.error) || '-') +
            ' data件数=' + String(parsed && parsed.data ? parsed.data.length : 'なし') +
            ' url=' + urls[i] +
            ' 本文=' + shardDiagClip(res.getContentText(), 300));
        }
        const list = (parsed && parsed.data) || [];
        if (!Array.isArray(list)) continue;
        diag.ok++;
        diag.rows += list.length;
        for (let k = 0; k < list.length; k++) {
          list[k]._shard_source = urls[i];
          out.push(list[k]);
        }
      } catch (e) {
        // JSON でない応答（ログイン画面の HTML 等）も原因として残す。
        if (typeof shardDiagLog === 'function') {
          let rawB = '';
          try { rawB = res.getContentText(); } catch (eB) { rawB = '(本文取得不可)'; }
          shardDiagLog('DIAG-10 ★JSONとして解釈できません url=' + urls[i] +
            ' 本文=' + shardDiagClip(rawB, 300));
        }
        diag.failed.push({ url: urls[i], status: -1, error: 'not_json' });
      }
    }

    if (cache) {
      try { cache.put(cacheKey, JSON.stringify(out), SHARD_LIST_CACHE_TTL); } catch (e) {}
    }
    if (typeof shardDiagLog === 'function') {
      shardDiagLog('DIAG-11 子集約サマリ 要求=' + diag.requested + '台 OK=' + diag.ok +
        '台 行=' + diag.rows + '件 失敗=' + diag.failed.length + '件 ' +
        (diag.failed.length ? JSON.stringify(diag.failed) : ''));
    }
    try { out._diag = diag; } catch (e) { /* 添付できなくても一覧は返す */ }
    return out;
  } catch (e) {
    // 分散が未設定・失敗なら空配列＝親の一覧だけを返す（従来動作）。
    // ただし「失敗した」ことは残す（黙って親の古い行だけ返すと原因が追えない）。
    const empty = [];
    try { empty._diag = { requested: 0, ok: 0, failed: [{ status: -1, error: String(e) }], rows: 0 }; } catch (e2) {}
    return empty;
  }
}


/**
 * 子GAS側: 親へ返す端末一覧（スコープ適用前の生データ）。
 * 共有シークレットで認証するため、外部からは取得できない。
 */
function shardListForParent(payload) {
  if (!isShardChild() && !isShardParent()) {
    return { success: false, error: '子GASとして構成されていません' };
  }
  if (!shardSecretMatches(payload && payload.shard_secret)) {
    return { success: false, error: 'unauthorized' };
  }
  // 教員情報を渡さずに呼ぶ＝スコープ無効（全件）。親が改めてスコープを掛ける。
  const list = getAllDevices('ALL', { role: 'ADMIN' }, true);
  return { success: true, data: list };
}

/**
 * 親GAS側: マージ後の端末一覧に教員スコープを適用する。
 * 学校スコープ・対象クラス・学校絞り込みの 3 条件を、getAllDevices と同じ規則で適用する。
 * 解決済みの既存ヘルパー（getTeacherScopeInfo / isClassInTeacherScope /
 * resolveCanonicalSchool / schoolNamesMatch）を再利用し、判定の二重実装を避ける。
 */
function shardFilterMergedDevices(list, filterSchool, teacher, includeUnassigned) {
  const src = Array.isArray(list) ? list : [];
  const scopeInfo = getTeacherScopeInfo(teacher);
  const restrictToOwnSchool = scopeInfo.type === 'school' || scopeInfo.type === 'unknown';
  const teacherSchool = scopeInfo.school || '';
  const classRestricted = getTeacherTargetClasses(teacher).length > 0;

  const out = [];
  for (let i = 0; i < src.length; i++) {
    const d = src[i] || {};
    const schoolName = String(d.school_name || '').trim();
    const className = String(d.class_name || '').trim();

    // 0. 所属学校スコープ（一般教員は自校＋学校未設定のみ）
    if (restrictToOwnSchool && schoolName && schoolName !== '未設定') {
      const devCanonical = resolveCanonicalSchool(schoolName);
      const isOwn = devCanonical ? (devCanonical === teacherSchool)
                                 : schoolNamesMatch(schoolName, teacherSchool);
      if (!isOwn) continue;
    }

    // 0.5 対象クラススコープ（権限の境界）
    if (classRestricted && !isClassInTeacherScope(className, teacher)) continue;

    // 1. 学校絞り込み（画面のフィルタ）
    if (filterSchool && filterSchool !== 'ALL') {
      if (filterSchool === 'UNASSIGNED') {
        if (schoolName && schoolName !== '未設定') continue;
      } else if (includeUnassigned) {
        if (schoolName !== '未設定' && schoolName !== '' &&
            !schoolNamesMatch(schoolName, filterSchool)) continue;
      } else {
        if (!schoolNamesMatch(schoolName, filterSchool)) continue;
      }
    }

    out.push(d);
  }
  return applyMonitorVisibility(out);
}

/**
 * 親GAS側: 親の端末一覧に子GASの端末を足して返す（教員は1画面のまま）。
 * SHARD_MODE=false なら base をそのまま返す（従来動作と完全に同一）。
 */
/**
 * 親の行と子の行を1台分だけ突き合わせて統合する。
 *
 * 【なぜ必要か（split-brain）】
 *   端末は割り当て後「子GAS」にしかハートビートしないため、子のシートだけが更新される。
 *   親のシートの最終同期日時は切り替え時点で止まる。以前は「親が持っていれば子を捨てる」
 *   だったので、親の古い日時だけを見て is_online=false（オフライン）になっていた。
 *
 * 【統合の規則】
 *   ・名簿（氏名・学校・クラス）… 親が正。親が「未設定」「未登録児童…」なら子で補う
 *   ・テレメトリ（最終同期・現在URL・監視・画面更新）… 最終同期が新しい方を採用
 *   ・コマンド（ロック・規制・一斉表示・画面要求・備考）… 親が正。
 *     親が空で子に入っていれば子を残す（伝達済みの値を消さない）
 *   ・is_online … 統合後の最終同期から再計算する（親だけ見ると誤判定する）
 */
/**
 * シートの日時セル（"2026/11/02 11:19:32" 等）をエポックmsへ変換する。
 *
 * 【なぜ new Date() に任せないか（R29 の実測で判明）】
 *   "2026/11/02 11:19:32" はタイムゾーン表記を持たないため、解釈が実行環境の
 *   タイムゾーンに依存する。実測では同じデータ・同じ比較時刻でも
 *     TZ=UTC        → is_online=true
 *     TZ=Asia/Tokyo → is_online=false
 *   と結果が反転した。GAS のスクリプトタイムゾーンが変わると is_online（60秒窓）が
 *   全端末で誤判定する。
 *   シートへ書いているのは常に日本時間なので、ここでは UTC+9 と決め打ちして
 *   組み立てる＝実行環境に依存せず同じ結果になる。
 */
const SHEET_TZ_OFFSET_MS = 9 * 60 * 60 * 1000; // Asia/Tokyo (UTC+9)

function sheetTsToMs(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (v instanceof Date) {
    const t0 = v.getTime();
    return isNaN(t0) ? 0 : t0;
  }
  if (typeof v === 'number') return v > 0 ? v : 0;
  const s = String(v).trim();
  if (!s) return 0;
  // "2026/11/02 11:19:32" / "2026-11-02T11:19:32" 等（秒・時刻は省略可）
  const m = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    const utc = Date.UTC(
      Number(m[1]), Number(m[2]) - 1, Number(m[3]),
      Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0));
    if (!isNaN(utc)) return utc - SHEET_TZ_OFFSET_MS;
  }
  const t = new Date(s).getTime();
  return isNaN(t) ? 0 : t;
}

function shardMergeDeviceRow(parentDev, childDev) {
  const p = parentDev || {};
  const c = childDev || {};

  // シートの日時（"2026/11/02 11:19:32"）は日本時間。実行環境のタイムゾーンに
  // 依存させないため sheetTsToMs で解釈する（9 時間ずれると常時オフラインになる）。
  const toMs = function (v) { return sheetTsToMs(v); };
  const pSeen = toMs(p.last_seen);
  const cSeen = toMs(c.last_seen);
  const childFresher = cSeen > pSeen;

  // 親を土台にし、親に無いキーだけ子から足す
  const out = {};
  const pk = Object.keys(p);
  for (let i = 0; i < pk.length; i++) out[pk[i]] = p[pk[i]];
  const ck = Object.keys(c);
  for (let i = 0; i < ck.length; i++) { if (!(ck[i] in out)) out[ck[i]] = c[ck[i]]; }

  // ---- 名簿: 親が正。親が無効値なら子で補う ----
  const roster = ['student_name', 'school_name', 'class_name'];
  for (let i = 0; i < roster.length; i++) {
    const k = roster[i];
    const pv = String(p[k] === undefined || p[k] === null ? '' : p[k]).trim();
    const cv = String(c[k] === undefined || c[k] === null ? '' : c[k]).trim();
    const parentBad = !pv || pv === '未設定' ||
      /^未登録児童/.test(pv) || /\(Googleアカウント\)/.test(pv);
    if (parentBad && cv && cv !== '未設定') out[k] = c[k];
  }

  // ---- テレメトリ: 子の方が新しいときだけ子を採用 ----
  if (childFresher) {
    const telemetry = ['last_seen', 'current_url', 'screenshot_at',
      'monitor_flag', 'monitor_reason', 'monitor_url', 'monitor_at'];
    for (let i = 0; i < telemetry.length; i++) {
      const k = telemetry[i];
      if (k in c) out[k] = c[k];
    }
  }

  // ---- 最終同期とオンライン判定（ここが症状の本体）----
  const bestSeen = Math.max(pSeen, cSeen);
  // どちらを採ったかを残す（実機で「なぜオンライン/オフラインか」を追えるようにする）
  out.last_seen_source = childFresher ? 'child' : (pSeen ? 'parent' : 'none');
  const bestStr = childFresher
    ? String(c.last_seen || p.last_seen || '')
    : String(p.last_seen || c.last_seen || '');
  out.last_seen = bestStr;
  out.is_online = bestSeen ? ((new Date().getTime() - bestSeen) < 60000) : false;

  // ---- コマンド: 親が正。親が空なら子を残す ----
  const commands = ['screen_lock', 'filter_mode', 'whitelist_urls', 'blacklist_urls',
    'broadcast_url', 'broadcast_id', 'screen_request_at', 'notes'];
  for (let i = 0; i < commands.length; i++) {
    const k = commands[i];
    const pv = p[k];
    const parentEmpty = (pv === undefined || pv === null || pv === '' ||
      (Array.isArray(pv) && pv.length === 0));
    if (parentEmpty && (k in c)) out[k] = c[k];
  }

  return out;
}

function shardMergeDevices(base, filterSchool, teacher, includeUnassigned) {
  if (!isShardParent()) return base;
  try {
    const cfg = shardConfigCached();
    // 専科教員（対象クラスあり）は該当する子GASだけへ問い合わせる。
    // 管理者・全クラス担当は全校分（並列取得なので待ち時間は1回分）。
    const urls = shardUrlsForTeacher(cfg, teacher);
    if (!urls.length) return base;

    const childList = shardFetchChildDevices(urls);
    const childDiag = (childList && childList._diag) || null;
    if (typeof shardDiagLog === 'function') {
      shardDiagLog('DIAG-12 子から受領=' + (Array.isArray(childList) ? childList.length : -1) +
        '件 親(集約前)=' + (Array.isArray(base) ? base.length : -1) + '件');
    }
    if (!childList.length) {
      // 子が1台も返さなかった＝親の行だけでは「オフライン」と誤表示される。
      // 原因（非200／JSONでない／0件）をログに残す。HB_DEBUG_LOG で ON/OFF できる。
      if (childDiag && childDiag.failed && childDiag.failed.length) {
        try {
          if (typeof hbLog === 'function') {
            hbLog('shard: 子GASから取得できません ' + JSON.stringify(childDiag.failed) +
              '（この児童は親シートの古い最終同期で判定されます）');
          }
        } catch (e) { /* ログ失敗は本処理に影響させない */ }
      }
      return base;
    }

    const merged = (Array.isArray(base) ? base.slice() : []);
    const rowOf = {};
    for (let i = 0; i < merged.length; i++) {
      const id = String(merged[i] && merged[i].student_id || '').trim();
      if (id) rowOf[id] = i;
    }

    // 子の端末を1台ずつ処理する。
    //   ・親にも居る → 突き合わせて統合（テレメトリは新しい方＝通常は子）
    //   ・親に居ない → 新規として追加（スコープ適用の対象）
    // 以前は「親に居れば子を捨てる」だったため、切り替え直後から親の古い日時で
    // オフライン表示になっていた。ここが split-brain の修正点。
    const extra = [];
    const newIds = {};
    const diagMatched = [];
    const diagUnmatched = [];
    for (let i = 0; i < childList.length; i++) {
      const child = childList[i] || {};
      const id = String(child.student_id || '').trim();
      if (!id) continue;

      if (rowOf[id] !== undefined) {
        const diagBefore = merged[rowOf[id]] || {};
        merged[rowOf[id]] = shardMergeDeviceRow(merged[rowOf[id]], child);
        diagMatched.push(id);
        if (typeof shardDiagLog === 'function' && diagMatched.length <= 3) {
          const diagAfter = merged[rowOf[id]] || {};
          shardDiagLog('DIAG-14 突き合わせ id=' + id +
            ' 親seen=' + String(diagBefore.last_seen || '空') +
            ' 子seen=' + String(child.last_seen || '空') +
            ' 採用seen=' + String(diagAfter.last_seen || '空') +
            ' src=' + String(diagAfter.last_seen_source || '-') +
            ' on=' + String(diagAfter.is_online));
        }
        continue;
      }
      if (newIds[id]) continue; // 複数の子GASが同じ児童を返した場合は先着を採る
      newIds[id] = true;
      diagUnmatched.push(id);
      extra.push(child);
    }
    if (typeof shardDiagLog === 'function') {
      shardDiagLog('DIAG-15 突き合わせ結果 一致=' + diagMatched.length +
        '件 親に無い=' + diagUnmatched.length + '件' +
        (diagMatched.length ? ' 一致ID見本=' + diagMatched.slice(0, 3).join(',') : '') +
        (diagUnmatched.length ? ' 親に無いID見本=' + diagUnmatched.slice(0, 3).join(',') : ''));
      if (!diagMatched.length && diagUnmatched.length) {
        shardDiagLog('DIAG-16 ★重大: 子の児童IDが親の一覧に1件も一致していません。' +
          ' 親子でIDの表記（全角/半角・先頭ゼロ・空白）が揃っているか確認してください。');
      }
    }
    if (!extra.length) return merged;

    // 子から来た分だけスコープを適用してから連結する
    const filtered = shardFilterMergedDevices(extra, filterSchool, teacher, includeUnassigned);
    return merged.concat(filtered);
  } catch (e) {
    return base; // マージに失敗しても親の一覧は必ず返す
  }
}


/**
 * 親GAS側: 子GASから届いたテレメトリ（在席状況・現在URL）を集約シートへ反映する。
 * ロック/規制/配信などのポリシー列には一切触らない（正は親が持つ）。
 */
function shardUpsertTelemetryFromChild(payload) {
  if (!isShardParent()) {
    return { success: false, error: '親GASとして構成されていません' };
  }
  if (!shardSecretMatches(payload && payload.shard_secret)) {
    return { success: false, error: 'unauthorized（共有シークレットが一致しません）' };
  }
  const rows = (payload && payload.rows) || [];
  if (!Array.isArray(rows) || !rows.length) {
    return { success: true, updated: 0 };
  }

  return withWriteLock(function () {
    const sheet = getTargetSheet(CONFIG.DEVICE_SHEET_NAME);
    const headerMap = getHeaderMap(sheet, CONFIG.DEVICE_COLUMNS);
    const data = sheet.getDataRange().getValues();
    const idCol = headerMap['児童ID'] - 1;

    // 既存行を索引化（毎回の全走査を1回に限定）
    const rowIndex = {};
    for (let i = 1; i < data.length; i++) {
      const id = String(data[i][idCol] || '').trim();
      if (id) rowIndex[id] = i + 1;
    }

    let updated = 0;
    let appended = 0;

    for (let k = 0; k < rows.length; k++) {
      const r = rows[k] || {};
      const id = String(r.student_id || '').trim();
      if (!id) continue;

      let rowNum = rowIndex[id];
      if (!rowNum) {
        // 親がまだ知らない端末（子から先に登録された場合）→ 行を作る
        const newRow = new Array(CONFIG.DEVICE_COLUMNS.length).fill('');
        newRow[headerMap['児童ID'] - 1] = id;
        newRow[headerMap['学校名'] - 1] = String(r.school_name || '未設定');
        newRow[headerMap['氏名'] - 1] = String(r.student_name || ('未登録児童 (' + id + ')'));
        newRow[headerMap['クラス'] - 1] = String(r.class_name || '未設定');
        newRow[headerMap['画面ロック'] - 1] = false;
        newRow[headerMap['URL規制モード'] - 1] = 'OFF';
        newRow[headerMap['現在開いているURL'] - 1] = String(r.current_url || '');
        newRow[headerMap['最終同期日時'] - 1] = String(r.last_seen || '');
        sheet.appendRow(newRow);
        rowIndex[id] = data.length + appended + 1;
        appended++;
        continue;
      }

      // テレメトリ列のみ更新（ポリシー列は触らない）
      const cells = [];
      const put = function (colName, value) {
        const c = headerMap[colName];
        if (c) cells.push({ c: c, v: value });
      };
      if (r.current_url !== undefined) put('現在開いているURL', String(r.current_url || ''));
      if (r.last_seen !== undefined) put('最終同期日時', String(r.last_seen || ''));
      if (r.student_name !== undefined) put('氏名', String(r.student_name || ''));
      if (r.class_name !== undefined) put('クラス', String(r.class_name || ''));
      // 学校名は「未設定」のときだけ補完する（教員の手動設定を上書きしない）
      if (r.school_name) {
        const sc = headerMap['学校名'];
        if (sc) {
          const cur = String(data[rowNum - 1][sc - 1] || '').trim();
          if (!cur || cur === '未設定') put('学校名', String(r.school_name));
        }
      }

      for (let c = 0; c < cells.length; c++) {
        sheet.getRange(rowNum, cells[c].c).setValue(cells[c].v);
      }
      updated++;
    }

    // 【R35】反映した行（新規追加含む）を索引にも反映する。
    try {
      if (typeof shardIndexUpsert === 'function') {
        const __telUp = [];
        for (let k = 0; k < rows.length; k++) {
          const r = rows[k] || {};
          const sid = String(r.student_id || '').trim();
          if (!sid) continue;
          __telUp.push({
            id: sid,
            school: String(r.school_name || '').trim() || undefined,
            cls: String(r.class_name || '').trim() || undefined
          });
        }
        if (__telUp.length) shardIndexUpsert(__telUp);
      }
    } catch (eIdx) {}

    invalidateDevicesCache();
    return { success: true, updated: updated, appended: appended };
  });
}

/**
 * 親GAS側: 教員操作を該当する子GASへ伝達する。
 * 対象児童をクラスで束ね、子GASごとに 1 リクエストへまとめる（通信回数を最小化）。
 * SHARD_MODE が false なら即 return（従来動作に一切影響しない）。
 */
// ---- R34: 子GAS伝達を「ブラウザ起点の投げっぱなし送信」へ移行 ----
// 【なぜトリガーをやめたか】
//   R33 は ScriptApp の1回限りトリガーで別実行に逃がしていたが、
//   Google 側の遅延でトリガーが「エラー（無効）」判定され、
//   保留分が送られずに残る実害が出た。トリガーは実行環境の都合に
//   左右されるため、伝達経路の本線には使わない。
// 【R34 の方式】
//   1) 教員操作（ロック/配信/規制）は、子GASへの送信内容を
//      スクリプトプロパティに貯めるだけで即座に応答を返す（＝教員は待たない）。
//   2) ブラウザが応答直後に sendBeacon / fetch(keepalive:true) で
//      action='shard_flush' を投げる（投げっぱなし。応答は誰も待たない）。
//   3) 取りこぼし対策として、コンソールの稼働通知（15秒ごとの console_touch）と
//      停止通知（console_release）でも同じフラッシュを実行する。
//      → どのみち応答を待たない実行なので、追加の待ち時間は発生しない。
//   4) ブラウザが落ちても、次に誰かがコンソールを開いた時点で必ず回収される。
// 【安全性】
//   貯められない環境（Properties 不可・容量超過）では従来どおり同期送信する。
//   ＝ 機能が落ちることはない（速度の恩恵だけが受けられない）。
const SHARD_ASYNC_ENABLED = true;      // false にすると常に同期送信（従来動作）
const SHARD_ASYNC_PROP = 'SHARD_ASYNC_QUEUE';
const SHARD_ASYNC_MAX_CHARS = 8000;    // Properties 1件あたりの上限(9KB)に対する安全弁

/** 保留中の送信を読む（削除はしない）。 */
function shardReadPending() {
  try {
    if (typeof PropertiesService === 'undefined') return [];
    const props = PropertiesService.getScriptProperties();
    const raw = props.getProperty(SHARD_ASYNC_PROP);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}

/**
 * 保留中の送信を貯める。成功したら true（＝呼び出し側は応答を待たなくてよい）。
 *
 * 同じ内容（url + payload）の再送は畳む。shard_apply は
 * 指定した値を書く冦等操作なので、畳んでも敷き換わらない。
 */
function shardQueuePending(requests) {
  // 【R38】保留（PropertiesService）の read-modify-write をスクリプトロックで直列化する。
  //   ビーコンと本体処理が同時に走ると、後から積んだ指示（解除など）が
  //   古い読み込み結果で上書きされ、消えることがあった。
  //   ロックが取れない環境でも従来どおり動作させる（機能を落とさない）。
  let qLock = null;
  try {
    if (typeof LockService !== 'undefined') {
      try {
        const lk = LockService.getScriptLock();
        lk.waitLock(2000);
        qLock = lk;
      } catch (eL) { qLock = null; }
    }
  } catch (e0) { qLock = null; }
  try {
    if (typeof PropertiesService === 'undefined') return false;
    const reqs = Array.isArray(requests) ? requests : [];
    if (!reqs.length) return true; // 送るものが無い＝待つ必要なし

    const props = PropertiesService.getScriptProperties();
    // 既に保留があれば追加する（連続操作で先の指示を落とさない）
    let pending = [];
    try {
      const raw = props.getProperty(SHARD_ASYNC_PROP);
      if (raw) {
        const old = JSON.parse(raw);
        if (Array.isArray(old)) pending = old;
      }
    } catch (e0) { pending = []; }

    const seen = {};
    for (let i = 0; i < pending.length; i++) {
      try { seen[String(pending[i].url) + '\u0000' + String(pending[i].payload)] = true; } catch (e1) {}
    }
    for (let j = 0; j < reqs.length; j++) {
      const key = String(reqs[j].url) + '\u0000' + String(reqs[j].payload);
      if (seen[key]) continue;
      seen[key] = true;
      pending.push(reqs[j]);
    }

    const payload = JSON.stringify(pending);
    if (payload.length > SHARD_ASYNC_MAX_CHARS) {
      // 大きすぎる（全校一括など）ときは同期送信に任せる
      try { Logger.log('[SHARD-ASYNC] 保留が大きいため同期送信します (' + payload.length + '文字)'); } catch (e2) {}
      return false;
    }
    props.setProperty(SHARD_ASYNC_PROP, payload);
    return true;
  } catch (e) {
    try { Logger.log('[SHARD-ASYNC] 保留できません（同期送信へ切り替え）: ' + e); } catch (e2) {}
    return false;
  } finally {
    // 【R38】read-modify-write を守ったロックを必ず解放する。
    try { if (qLock) qLock.releaseLock(); } catch (eR) {}
  }
}

/**
 * 送信に成功した分だけを保留から取り除く。
 * 失敗分は残すので、次回のフラッシュで自動的に再送される（自己修復）。
 */
function shardDropPending(doneKeys) {
  const keys = doneKeys || {};
  let locked = null;
  try {
    if (typeof LockService !== 'undefined') {
      try {
        const lk = LockService.getScriptLock();
        lk.waitLock(2000);
        locked = lk;
      } catch (eL) { locked = null; }
    }
  } catch (e0) { locked = null; }
  try {
    if (typeof PropertiesService === 'undefined') return 0;
    const props = PropertiesService.getScriptProperties();
    const raw = props.getProperty(SHARD_ASYNC_PROP);
    if (!raw || raw === '[]') return 0;
    let arr = [];
    try { arr = JSON.parse(raw); } catch (e1) { arr = []; }
    if (!Array.isArray(arr)) arr = [];
    const keep = [];
    let removed = 0;
    for (let i = 0; i < arr.length; i++) {
      const key = String(arr[i].url) + '\u0000' + String(arr[i].payload);
      if (keys[key]) { removed++; continue; } // 送信済み
      keep.push(arr[i]);
    }
    props.setProperty(SHARD_ASYNC_PROP, JSON.stringify(keep));
    return removed;
  } catch (e) {
    try { Logger.log('[SHARD-ASYNC] 保留の整理に失敗: ' + e); } catch (e2) {}
    return 0;
  } finally {
    try { if (locked) locked.releaseLock(); } catch (eR) {}
  }
}

/**
 * 保留分を子GASへ送る。
 *
 * 呼び出し元は「ブラウザ起点のビーコン（shard_flush）」と
 * 「コンソールの稼働/停止通知」だけで、どちらも誰も応答を待たない。
 * したがって、ここで数秒かかっても教員の操作感に影響しない。
 */
/**
 * 保留分を「子GASごとの 1 リクエスト」に畳む。
 *
 * 【なぜ畳むのか】
 *   保留は数百ミリ秒以内に送られるが、その間に同じ児童への指示が
 *   複数入ることがある（例: ロックONを押してすぐOFFに直す）。
 *   そのまま並列で送ると、子GASがどちらを後に処理するか保証されず、
 *   古い指示が勝ってしまう（＝画面はOFFなのに子はONのまま）。
 *   ここで児童単位に合流し、同じ項目（screen_lock など）は
 *   後から来た指示で上書きすることで、子の最終状態を一意に定める。
 *   別の項目（例: ロックとURL配信）は両方保つので、片方が消えることはない。
 *
 * 返り値: { requests: [送信するリクエスト], sources: [[元の保留キー]] }
 *   sources[i] は requests[i] が担当する元の保留。送信成功時にそれだけを除去する。
 */
function shardCoalescePending(reqs) {
  const list = Array.isArray(reqs) ? reqs : [];
  const requests = [];
  const sources = [];
  const order = [];
  const state = {};
  const secrets = {};

  for (let i = 0; i < list.length; i++) {
    const r = list[i] || {};
    const key = String(r.url) + '\u0000' + String(r.payload);
    let body = null;
    try { body = JSON.parse(String(r.payload || '')); } catch (e) { body = null; }

    // 形式が違うもの（将来の拡張や解析不能）はそのまま送る
    if (!body || body.action !== 'shard_apply' ||
        !Array.isArray(body.student_ids) || !body.student_ids.length) {
      requests.push(r);
      sources.push([key]);
      continue;
    }

    const url = String(r.url || '');
    if (!state[url]) { state[url] = {}; order.push(url); }
    secrets[url] = body.shard_secret;
    const ids = body.student_ids;
    const cm = body.class_map || {};
    const patch = body.patch || {};
    for (let j = 0; j < ids.length; j++) {
      const sid = String(ids[j]);
      const prev = state[url][sid] || { patch: {}, cls: undefined, keys: [] };
      const pk = Object.keys(patch);
      // 【R38】後から来た指示が勝つ。ただし undefined では前の値を消さない。
      //   false は「解除」という意味のある指示なので、必ず上書きする
      //   （ここで false を落とすと、子シートがロックされたままになる）。
      for (let k = 0; k < pk.length; k++) {
        if (patch[pk[k]] === undefined) continue;
        prev.patch[pk[k]] = patch[pk[k]];
      }
      if (cm[sid] !== undefined) prev.cls = cm[sid];
      if (prev.keys.indexOf(key) < 0) prev.keys.push(key);
      state[url][sid] = prev;
    }
  }

  // 同じ patch の児童をまとめて 1 リクエストにする
  for (let u = 0; u < order.length; u++) {
    const url = order[u];
    const buckets = {};
    const sigOrder = [];
    const sids = Object.keys(state[url]);
    for (let k = 0; k < sids.length; k++) {
      const sid = sids[k];
      const st = state[url][sid];
      const sig = JSON.stringify(st.patch || {});
      if (!buckets[sig]) { buckets[sig] = { ids: [], classMap: {}, patch: st.patch || {}, keys: [] }; sigOrder.push(sig); }
      buckets[sig].ids.push(sid);
      if (st.cls !== undefined) buckets[sig].classMap[sid] = st.cls;
      for (let m = 0; m < st.keys.length; m++) {
        if (buckets[sig].keys.indexOf(st.keys[m]) < 0) buckets[sig].keys.push(st.keys[m]);
      }
    }
    for (let s = 0; s < sigOrder.length; s++) {
      const b = buckets[sigOrder[s]];
      requests.push({
        url: url,
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify({
          action: 'shard_apply',
          shard_secret: secrets[url],
          student_ids: b.ids,
          class_map: b.classMap,
          patch: b.patch
        }),
        muteHttpExceptions: true
      });
      sources.push(b.keys);
    }
  }
  return { requests: requests, sources: sources };
}

/**
 * 保留分を子GASへ送る。
 *
 * 呼び出し元は「ブラウザ起点のビーコン（shard_flush）」と
 * 「コンソールの稼働/停止通知」だけで、どちらも誰も応答を待たない。
 * したがって、ここで数秒かかっても教員の操作感に影響しない。
 */
function shardFlushPending() {
  let reqs = [];
  try {
    if (typeof PropertiesService === 'undefined') return { skipped: true };
    if (typeof SHARD_ASYNC_PROP === 'undefined') return { skipped: true };
    reqs = shardReadPending();
  } catch (e) {
    return { error: String(e) };
  }
  if (!reqs.length) {
    // 【R40】空振りの可視化。ビーコンが親の書き込みより先に着くと必ずここに来る。
    //   GAS の実行ログに残すことで「なぜ子シートが遅れたか」を後から追える。
    try {
      if (typeof shardDiagLog === 'function') shardDiagLog('[R40] shard_flush: 保留なし（空振り）');
    } catch (eE) {}
    return { sent: 0, removed: 0, empty: true, queued: 0 };
  }

  // 【R34b】同じ児童への複数指示を畳む（最後の指示が勝つ）
  let plan = null;
  try {
    plan = (typeof shardCoalescePending === 'function')
      ? shardCoalescePending(reqs)
      : { requests: reqs, sources: reqs.map(function (r) { return [String(r.url) + '\u0000' + String(r.payload)]; }) };
  } catch (eC) {
    plan = { requests: reqs, sources: reqs.map(function (r) { return [String(r.url) + '\u0000' + String(r.payload)]; }) };
  }
  const sendReqs = (plan && plan.requests) || [];
  const sendSrc = (plan && plan.sources) || [];
  if (!sendReqs.length) return { sent: 0, removed: 0 };

  let responses = [];
  try {
    responses = shardFetchMany(sendReqs);
  } catch (e) {
    // 送れなかったら保留は残したままにする（次回回収）
    try { Logger.log('[SHARD-ASYNC] 子GASへの送信に失敗（' + sendReqs.length + '件・次回再送）: ' + e); } catch (e2) {}
    return { error: String(e), sent: 0 };
  }

  const done = {};
  for (let i = 0; i < sendReqs.length; i++) {
    const res = responses[i];
    const url = String((sendReqs[i] && sendReqs[i].url) || '');
    let ok = false;
    if (!res) {
      try { Logger.log('[SHARD-ASYNC] 応答なし: ' + url); } catch (e3) {}
    } else {
      try {
        const code = res.getResponseCode();
        if (code !== 200) {
          try { Logger.log('[SHARD-ASYNC] 子GASが ' + code + ' を返しました: ' + url); } catch (e4) {}
        } else {
          ok = true;
          // 子が拒否（success:false）でも HTTP 200 のことがある。本文も確認して残す。
          let body = '';
          try { body = String(res.getContentText() || ''); } catch (e5) { body = ''; }
          if (body) {
            try {
              const parsed = JSON.parse(body);
              if (parsed && parsed.success === false) {
                ok = false; // 次回再送する
                try { Logger.log('[SHARD-ASYNC] 子GASが拒否しました: ' + url + ' / ' + String(parsed.error || '')); } catch (e6) {}
              }
            } catch (e7) { /* JSONでない応答は成功扱い（ログイン画面等） */ }
          }
        }
      } catch (e8) {
        try { Logger.log('[SHARD-ASYNC] 応答確認に失敗: ' + url + ' / ' + e8); } catch (e9) {}
      }
    }
    if (ok) {
      const keys = sendSrc[i] || [];
      for (let k = 0; k < keys.length; k++) done[keys[k]] = true;
    }
  }

  const removed = (typeof shardDropPending === 'function') ? shardDropPending(done) : 0;
  // 【R40】子GASへ実際に蹴られたかを実行ログで確認できるようにする。
  try {
    if (typeof shardDiagLog === 'function') {
      shardDiagLog('[R40] shard_apply 送信: ' + sendReqs.length + '件中 ' + removed + '件完了 / 残り ' +
        Math.max(0, reqs.length - removed) + '件');
    }
  } catch (eD2) {}
  return { sent: sendReqs.length, removed: removed, queued: Math.max(0, reqs.length - removed) };
}

function shardPropagatePolicy(studentIds, patch, forceSync) {
  // forceSync=true … 保留キューを使わず、その場で同期送信する。
  //   【フェーズ5】スケジュール（タイマー）の反映漏れ・遅延を防ぐために使う。
  // 【R41】子GASへの送信はブラウザが直接・並列で行う（親の /exec は待たない）。
  //   ここでは保留（PropertiesService）へ積むだけにして、親の実行時間を短く保つ。
  //   積んだ内容は 15秒周期の console_touch が回収する（取りこぼし防止）。
  // 【R32 計測】
  const __bt = function (label) {
    try { if (typeof bulkTraceMark === 'function') bulkTraceMark(label); } catch (e) {}
  };
  if (!isShardParent()) {
    try { Logger.log('[SHARD] policy: skip（親GASではありません）'); } catch (eL0) {}
    return { skipped: true, reason: 'not_parent' };
  }
  try {
    const cfg = shardConfigCached();
    __bt('shardPropagatePolicy:設定読込(CacheService/Properties)');
    const idx = shardMapIndexFromMap(cfg.map);
    const defUrl = String(cfg.def || '').trim();
    // SHARD_MAP_V1 の空キー（""）で指定された既定の子GAS。
    // これを見落とすと、クラス未設定の児童にコマンドが一切届かない。
    const emptyDef = shardMapDefaultFromEmptyKey(cfg.map);
    if (!Object.keys(idx).length && !defUrl && !emptyDef) {
      try { Logger.log('[SHARD] policy: skip（子GASが1つも登録されていません。SHARD_MAP_V1 / SHARD_DEFAULT_URL を設定してください）'); } catch (eL1) {}
      return { skipped: true, reason: 'no_child' };
    }

    // 【R35】索引（CacheService）だけで解決する。
    //   【重要】ここで openById / getDataRange を呼んではいけない。
    //   書き込み直後はシート側の反映待ちで読取が待たされ、
    //   実測 4,946ms を占めていた。索引は書き込み関数が差分を自分で反映するので、
    //   ここで再読みしなくても常に最新である。
    let entries = null;
    try {
      if (typeof shardDeviceEntries === 'function') entries = shardDeviceEntries();
    } catch (e) { entries = null; }
    if (!entries || !entries.length) {
      // 索引が使えない環境のみ従来通りのシート読み（機能は落とさない）
      //   ※ [] は truthy なので `if (!entries)` だけでは素通りしてしまう。
      //     索引キャッシュが空で固まった場合に全児童が脱落するのを防ぐ。
      const sheet = getTargetSheet(CONFIG.DEVICE_SHEET_NAME);
      const headerMap = getHeaderMap(sheet, CONFIG.DEVICE_COLUMNS);
      const d = sheet.getDataRange().getValues();
      const idCol = headerMap['児童ID'] - 1;
      const sCol = headerMap['学校名'] - 1;
      const cCol = headerMap['クラス'] - 1;
      entries = [];
      for (let i = 1; i < d.length; i++) {
        const row = d[i] || [];
        const sid = String(row[idCol] || '').trim();
        if (!sid) continue;
        entries.push([sid, String(row[sCol] || '').trim(), String(row[cCol] || '').trim()]);
      }
    }
    __bt('shardPropagatePolicy:索引取得(シートI/Oなし)');

    const isAll = (studentIds === 'ALL' || !Array.isArray(studentIds));
    const idSet = Array.isArray(studentIds) ? new Set(studentIds) : null;

    // 【伝播の安全ガード】静かな脱落（sent: []）を根絶する。
    //   従来、SHARD_MAP_V1 に一致するクラスが無く、空キー既定も SHARD_DEFAULT_URL も
    //   未設定のとき、この児童は「黙って」捨てられていた。その結果、
    //   子GASへは 1 件も送られないのに親の予約は正常に見え、子の実行ログも
    //   HTTP 200 で返るため「成功しているのに端末で規制が効かない」という
    //   最も厄介な壊れ方をする（本不具合の正体）。
    //   1校=1子GAS の運用（R41）では、登録が 1 件だけならそれが正しい宛先なので
    //   それを最終フォールバックに使う。加えて、落とした事実を必ずログに残す。
    const idxKeys = Object.keys(idx);
    const singleChildUrl = (idxKeys.length === 1) ? String(idx[idxKeys[0]] || '').trim() : '';

    const groups = {}; // url -> [studentId]
    const groupClasses = {}; // url -> { studentId: 元のクラス名 }
    let droppedCount = 0;
    for (let i = 0; i < entries.length; i++) {
      const id = String(entries[i][0] || '').trim();
      if (!id) continue;
      if (!isAll && !(idSet && idSet.has(id))) continue;
      const rawClass = String(entries[i][2] || '').trim();
      const cls = normalizeShardClass(rawClass);
      // クラス一致 → 空キー既定 → SHARD_DEFAULT_URL → 唯一の子GAS の順で解決する
      const url = idx[cls] || emptyDef || defUrl || singleChildUrl;
      if (!url) { droppedCount++; continue; }
      // 一致しなかった理由を残す（表記揺れ／マップ未登録の切り分け用）。
      if (!idx[cls] && rawClass) {
        shardWarnOnce('cls-fb:' + cls + '|' + url,
          'SHARD_MAP_V1 にクラス「' + rawClass + '」（正規化: ' + cls + '）がありません。' +
          'フォールバック先へ送ります（' + url + '）。');
      }
      if (!groups[url]) groups[url] = [];
      groups[url].push(id);
      // 子のシートで行を作るときにクラスを埋めるため、元の表記のまま渡す。
      if (!groupClasses[url]) groupClasses[url] = {};
      groupClasses[url][id] = rawClass;
    }

    // 宛先が 1 つも無いのに児童が居た＝設定不備。成功に見せず理由を返す。
    if (droppedCount > 0 && !Object.keys(groups).length) {
      shardWarnOnce('no-route:' + droppedCount,
        'SHARD_MAP_V1 のどのクラスにも一致せず、既定URLも無いため伝播先がありません（対象 ' +
        droppedCount + ' 名）。子GASへは何も送られていません。');
      return { skipped: true, reason: 'no_route', dropped: droppedCount };
    }

    const urls = Object.keys(groups);
    try {
      Logger.log('[SHARD] policy: 宛先=' + urls.length + '件 児童=' +
        (function () { var n = 0; for (var k in groups) n += groups[k].length; return n; })() +
        '名 forceSync=' + !!forceSync);
    } catch (eL2) {}

    // 【フェーズ5】スケジュール（タイマー）の同封。
    //   確定仕様:
    //     ・繰り返し・曜日を親が解釈し、start_ms/end_ms まで確定した
    //       「展開済みウィンドウ」を渡す（子は再計算しない）
    //     ・子GASごとの“全児童”を丸ごと送る（差分管理をしない＝不整合が出ない）
    //     ・予約が1件も無いときは同封そのものを省く（通信量ゼロ）
    let schRows = null;
    let entriesByUrl = null;
    try {
      if (typeof readScheduleRows_ === 'function') {
        // 予約が 0 件でも配列として読む（forceSync 時に「空」を丸ごと上書きするため）
        schRows = readScheduleRows_();
        if (Array.isArray(schRows)) {
          entriesByUrl = {};
          for (let i = 0; i < entries.length; i++) {
            const sid0 = String(entries[i][0] || '').trim();
            if (!sid0) continue;
            const u0 = idx[normalizeShardClass(entries[i][2])] || emptyDef || defUrl || singleChildUrl;
            if (!u0) continue;
            if (!entriesByUrl[u0]) entriesByUrl[u0] = [];
            entriesByUrl[u0].push([sid0, String(entries[i][1] || ''), String(entries[i][2] || '')]);
          }
        }
      }
    } catch (eSch0) { schRows = null; entriesByUrl = null; }
    const schNowMs = new Date().getTime();
    let scheduleAttached = false;

    // 全校一括ロック／一括URL配信でも、全子GASへ 1 回分の待ち時間で一斉に伝達する（並列）。
    const requests = [];
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      const body = {
        action: 'shard_apply',
        shard_secret: cfg.sec,
        student_ids: groups[url],
        // 子が行を作るときにクラスを埋められるよう、児童ID→クラス名を添える。
        class_map: groupClasses[url] || {},
        patch: patch
      };
      // この子GASに属する全児童の展開済みウィンドウを丸ごと添える。
      if (entriesByUrl && entriesByUrl[url]) {
        try {
          const byStudent = shardBuildScheduleByStudent_(schRows, entriesByUrl[url], schNowMs);
          // 【確定仕様2】有効な予約が無い児童は地図に入れない（子は「制限なし」と解釈）。
          // 【確定仕様3】ただし forceSync（予約CRUD起点）では 0 件でも「空の地図」を送る。
          //   最後の1件を取り消したとき、何も送らないと子に古い制限が残り続けるため。
          if (Object.keys(byStudent).length || forceSync) {
            body.schedules = { updated_ms: schNowMs, by_student: byStudent };
            scheduleAttached = true;
          }
        } catch (eSch1) { /* 同封に失敗してもポリシー伝達は続ける */ }
      }
      requests.push({
        url: url,
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify(body),
        muteHttpExceptions: true
      });
    }

    __bt('shardPropagatePolicy:子GASへ送信開始(' + urls.length + '件)');

    // 【R34】応答を待たずに保留へ積み、ブラウザ起点のビーコンで送る（実測 4,122ms の解消）。
    //   積めなければ従来どおり同期送信するため、機能は落ちない。
    // 【フェーズ5】ただしスケジュールを同封したリクエストは保留に積まない。
    //   タイマーの反映漏れ・遅延を防ぐため、必ず即時の同期送信にする（確定仕様1・2）。
    try {
      if (!scheduleAttached && !forceSync &&
          typeof SHARD_ASYNC_ENABLED !== 'undefined' && SHARD_ASYNC_ENABLED &&
          typeof shardQueuePending === 'function' && shardQueuePending(requests)) {
        __bt('shardPropagatePolicy:保留へ積む(応答待ちなし)');
        const queuedResults = [];
        for (let qi = 0; qi < urls.length; qi++) {
          queuedResults.push({ url: urls[qi], count: groups[urls[qi]].length, queued: true });
        }
        return { sent: queuedResults, deferred: true };
      }
    } catch (eq) { /* 委譲の失敗は同期送信でカバー */ }

    const responses = shardFetchMany(requests);
    __bt('shardPropagatePolicy:子GAS応答受信(fetchAll)');
    const results = [];
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      const res = responses[i];
      if (!res) {
        results.push({ url: url, count: groups[url].length, error: 'no_response' });
        continue;
      }
      try {
        const code = res.getResponseCode();
        // 子が「行を用意できなかった」場合は一括操作が効いていない。握りつぶさず伝える。
        let childEnsure = null;
        let childSchedules = null;
        try {
          const parsed = JSON.parse(res.getContentText() || '{}');
          childEnsure = (parsed && parsed.ensure) || null;
          childSchedules = (parsed && parsed.schedules) || null;
          if (childEnsure && childEnsure.error) {
            results.push({ url: url, count: groups[url].length, status: code, ensure_error: childEnsure.error });
            continue;
          }
        } catch (e2) { /* 本文が読めなくてもステータスは残す */ }
        results.push({ url: url, count: groups[url].length, status: code,
          ensure: childEnsure, schedules: childSchedules });
      } catch (e) {
        results.push({ url: url, count: groups[url].length, error: String(e) });
      }
    }
    __bt('shardPropagatePolicy:応答解析(完了)');
    try { Logger.log('[SHARD] policy: 送信完了 ' + JSON.stringify(results)); } catch (eL3) {}
    return { sent: results };
  } catch (e) {
    // 子への伝達に失敗しても、親のシート更新（＝コンソール表示）は成立させる
    return { error: String(e) };
  }
}
/** 管理画面向け: 子GAS分散の現在の設定を返す（シークレットは伏せる）。 */
function getShardSettingsForAdmin() {
  const map = readShardMapRaw();
  const idx = shardMapIndexFromMap(map);
  const classes = Object.keys(map).map(function (k) {
    return { class_name: k, normalized: normalizeShardClass(k), url: String(map[k] || '').trim() };
  });
  return {
    shard_mode: isShardParent(),
    child_mode: isShardChild(),
    classes: classes,
    normalized_count: Object.keys(idx).length,
    default_url: readShardDefaultUrl(),
    secret_configured: !!String((function () {
      try { return PropertiesService.getScriptProperties().getProperty(SHARD_SECRET_PROP) || ''; }
      catch (e) { return ''; }
    })()),
    // どの設定がプロパティで上書きされているか（CONFIG / PROPERTY）
    sources: shardConfigSources(),
    // 空キー（""）で指定された既定ルーティング先
    empty_key_default: shardMapDefaultFromEmptyKey(map),
    max_per_class: 40
  };
}

/** 管理画面向け: 子GAS分散の設定を保存する（管理者のみ）。 */
function saveShardSettingsForAdmin(teacher, incoming) {
  if (!isAdminTeacher(teacher)) throw new Error('管理者のみ設定できます');
  const data = incoming || {};
  const props = PropertiesService.getScriptProperties();

  if (data.classes !== undefined) {
    const src = Array.isArray(data.classes) ? data.classes : [];
    const map = {};
    for (let i = 0; i < src.length; i++) {
      const cls = String((src[i] && src[i].class_name) || '').trim();
      const url = String((src[i] && src[i].url) || '').trim();
      if (!cls) continue;
      if (!url) continue;
      if (!/^https?:\/\//.test(url)) {
        throw new Error('子GASのURLは http(s):// で始めてください: ' + cls);
      }
      map[cls] = url;
    }
    props.setProperty(SHARD_MAP_PROP, JSON.stringify(map));
  }

  if (data.default_url !== undefined) {
    const d = String(data.default_url || '').trim();
    if (d && !/^https?:\/\//.test(d)) throw new Error('既定URLは http(s):// で始めてください');
    if (d) props.setProperty(SHARD_DEFAULT_PROP, d);
    else props.deleteProperty(SHARD_DEFAULT_PROP);
  }

  // シークレットは「再発行」指定時のみ作り直す（子GASへ配り直しが必要になるため）
  if (data.rotate_secret === true) {
    props.deleteProperty(SHARD_SECRET_PROP);
    getOrCreateShardSecret();
  }

  invalidateShardConfig();
  return getShardSettingsForAdmin();
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ==================== google.script.run 用エクスポート関数 ====================

// ---- 教員コンソールの稼働通知 API (google.script.run 用) ----
// GAS ネイティブ画面（script.google.com）からは content script へ postMessage が
// 届かない場合があるため、確実に届く google.script.run 経由の経路を用意する。
function api_consoleTouch(sessionId) {
  // 子GAS分散: 教員は親コンソールにしかログインしないため、子GASは自分の
  // isTeacherConsoleActive() が永久に false になる。ここで稼働を配らないと、
  // 子担当の端末が ka_active=false を受け取り「同期周期：停止」のまま止まる。
  // （doPost の console_touch だけが配っていたため、google.script.run 経由では届かなかった）
  let res = null;
  try { res = touchTeacherConsole(sessionId); }
  catch (err) { return { success: false, error: err.toString() }; }
  try { shardPropagateKaState(true); } catch (e) { /* 配信失敗でも稼働記録は成立させる */ }
  // 【R34】取りこぼし回収（google.script.run 経由でも 15 秒ごとに必ず通る）
  try { if (typeof shardFlushPending === 'function') shardFlushPending(); } catch (e) {}
  return res;
}

function api_consoleRelease(sessionId) {
  let res = null;
  try { res = releaseTeacherConsole(sessionId); }
  catch (err) { return { success: false, error: err.toString() }; }
  // 全セッションが消えた（＝非稼働）ときだけ子へ停止を伝える（従来の doPost と同じ規則）
  try { if (!isTeacherConsoleActive()) shardPropagateKaState(false); } catch (e) {}
  // 【R34】停止時にも保留分を送る（ブラウザ終了で最後の操作を落とさない）
  try { if (typeof shardFlushPending === 'function') shardFlushPending(); } catch (e) {}
  return res;
}

function api_login(email, password) {
  try {
    const res = handleTeacherLogin(email, password);
    return JSON.parse(res.getContent());
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

/**
 * セッション検証 & 最新の教員情報の取得（google.script.run 用）。
 * ローカルに保存された教員情報（所属学校・権限）が古い場合でも、
 * 教員マスタの最新レコードを返すことでフロントのスコープ判定を正しく保つ。
 */
function api_verifySession(token) {
  try {
    const auth = verifyToken(token);
    if (!auth.valid) return { success: false, need_auth: true, error: '認証セッションが無効です' };
    const currentTeacher = resolveCurrentTeacher(auth.teacher);
    return { success: true, teacher: currentTeacher };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

/**
 * 【R42】この子GASが持つ端末の児童IDをすべて返す。
 *   ブラウザから student_ids が配列で来なかった（'ALL' 等）ときの展開用。
 *   索引（shardDeviceEntries）を使うのでシート全読みはしない。
 */
function shardAllStudentIdsForChild() {
  const out = [];
  try {
    const entries = shardDeviceEntries();
    if (entries && entries.length) {
      for (let i = 0; i < entries.length; i++) {
        const id = String(entries[i][0] || '').trim();
        if (id) out.push(id);
      }
    }
  } catch (e) { /* 索引が無ければ空で返す（要求0件として扱う） */ }
  return out;
}

/**
 * 【R42】ブラウザから子GASへ直接届く「画面情報取得の要求」。
 *   子の「端末一覧」の『画面情報要求日時』に「日時|要求ID」を書き込む。
 *   子GASを参照している児童端末は、この列の変化を見て撮影・送信する。
 *
 *   親が既に学校・クラスのスコープを適用したIDを渡してくるため、
 *   ここでは改めてスコープ制限を掛けない（掛けると親の判断と食い違う）。
 */
function shardRequestScreensFromBrowser(payload) {
  if (!isShardChild() && !isShardParent()) {
    return { success: false, error: '子GASとして構成されていません', requested: 0 };
  }
  if (!shardSecretMatches(payload && payload.shard_secret)) {
    return { success: false, error: 'unauthorized（共有シークレットが一致しません）', requested: 0 };
  }

  let ids = (payload && payload.student_ids);
  if (!Array.isArray(ids)) ids = shardAllStudentIdsForChild();
  ids = ids.map(function (x) { return String(x || '').trim(); }).filter(Boolean);
  if (!ids.length) return { success: true, requested: 0, ids: [] };

  const classMap = (payload && payload.class_map) || null;

  // 子のシートに行が無い児童は要求を書けない。先に行を用意する。
  //   （クラス名が分かる場合のみ。分からなくても requestScreenCapture は動く）
  try {
    if (classMap && typeof shardEnsureDeviceRows === 'function') {
      shardEnsureDeviceRows(ids, classMap);
    }
  } catch (eE) { /* 行の用意に失敗しても要求自体は試す */ }

  const adminLike = { email: '__shard_parent__', role: 'ADMIN', school: '全校管理', target_class: '' };
  const res = requestScreenCapture(ids, adminLike);
  return {
    success: true,
    requested: res.requested,
    ids: res.ids,
    request_id: res.request_id,
    at: res.at,
    missing: Math.max(0, ids.length - (res.requested || 0))
  };
}

/**
 * 【R42】ブラウザから子GASへ直接届く「画面情報の読み出し」。
 *   子の「画面情報」シートから Base64 画像を取り出して返す。
 *   親コンソールは、この結果と親自身の結果を児童IDで突き合わせ、
 *   撮影日時が新しい方を採用して描画する（＝子の最新画像が出る）。
 */
function shardScreensFromBrowser(payload) {
  if (!isShardChild() && !isShardParent()) {
    return { success: false, error: '子GASとして構成されていません', data: [] };
  }
  if (!shardSecretMatches(payload && payload.shard_secret)) {
    return { success: false, error: 'unauthorized（共有シークレットが一致しません）', data: [] };
  }

  let ids = (payload && payload.student_ids);
  if (!Array.isArray(ids)) ids = shardAllStudentIdsForChild();
  ids = ids.map(function (x) { return String(x || '').trim(); }).filter(Boolean);
  if (!ids.length) return { success: true, data: [] };

  const adminLike = { email: '__shard_parent__', role: 'ADMIN', school: '全校管理', target_class: '' };
  // 【R43】meta_only を透過する。ポーリングは「新しい撮影が来たか」だけ分かればよいので、
  //   Base64 を含めずに返す（転送量と JSON 生成コストを大幅に削減）。
  const metaOnly = !!(payload && payload.meta_only);
  const data = getScreenshots('ALL', adminLike, false, 'all', ids, { meta_only: metaOnly });
  return { success: true, data: data, meta_only: metaOnly };
}

/**
 * 【R41】ブラウザへ配布する子GAS接続情報。
 *
 *   ブラウザが「親 /exec」と「子 /exec」を同じ tick で並列に POST するために必要。
 *   Google のリダイレクト待ち（約3.8秒）を親・子で同時に消化させるのが目的。
 *
 *   1校独立運用のため、自校のブラウザが自校の子GAS URLとシークレットを持つことは
 *   許容される（他校のGASへは到達できない）。
 *
 *   SHARD_MODE が無効な環境では enabled:false を返し、ブラウザは並列直送を行わない
 *   （＝従来どおり親だけに送る。機能は落ちない）。
 */
function shardClientConfig() {
  try {
    if (!isShardParent()) return { success: true, enabled: false };
    const cfg = shardConfigCached();
    const idx = shardMapIndexFromMap(cfg.map);
    const classes = Object.keys(idx).map(function (k) {
      return { normalized: k, url: String(idx[k] || '') };
    });
    // 子GASが1つも無ければ並列直送の意味がない
    const emptyDefault = shardMapDefaultFromEmptyKey(cfg.map);
    const defUrl = String(cfg.def || '').trim();
    if (!classes.length && !emptyDefault && !defUrl) {
      return { success: true, enabled: false };
    }
    return {
      success: true,
      enabled: true,
      secret: String(cfg.sec || ''),
      classes: classes,
      empty_default: String(emptyDefault || ''),
      default_url: defUrl
    };
  } catch (e) {
    return { success: false, enabled: false, error: String(e) };
  }
}

function api_getAllDevices(token, schoolName, includeUnassigned) {
  try {
    const auth = verifyToken(token);
    if (!auth.valid) return { success: false, need_auth: true, error: '認証セッションが無効です' };
    const currentTeacher = resolveCurrentTeacher(auth.teacher);
    // 子GAS分散: 教員コンソールの経路は google.script.run（この関数）と
    // doPost の get_all の2つがある。以前はここが getAllDevices を直接呼んでいたため、
    // google.script.run 経由のときだけ子GASの端末が見えなかった（経路による差）。
    // 集約（親＋子の統合）を通る getShardMergedDevices に統一する。
    // SHARD_MODE=false のときは内部で getAllDevices をそのまま返す＝従来と完全同一。
    const data = getShardMergedDevices(schoolName, currentTeacher, Boolean(includeUnassigned));
    return { success: true, data: data };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

// ---- 画面一覧（スクリーンショット）API (google.script.run 用) ----

function api_requestScreens(token, studentIds) {
  try {
    const auth = verifyToken(token);
    if (!auth.valid) return { success: false, need_auth: true, error: '認証セッションが無効です' };
    const currentTeacher = resolveCurrentTeacher(auth.teacher);
    const result = requestScreenCapture(studentIds, currentTeacher);
    if (result.requested === 0) {
      return { success: false, error: '画面情報を要求できる児童がいません（自校の児童のみ対象）' };
    }
    return { success: true, message: `${result.requested} 台の画面情報取得を要求しました`, result: result };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

function api_getScreens(token, schoolName, includeUnassigned, status, studentIds) {
  try {
    const auth = verifyToken(token);
    if (!auth.valid) return { success: false, need_auth: true, error: '認証セッションが無効です' };
    const currentTeacher = resolveCurrentTeacher(auth.teacher);
    const data = getScreenshots(schoolName, currentTeacher, Boolean(includeUnassigned), status || 'all', studentIds);
    return { success: true, data: data };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

function api_bulkLock(token, studentIds, locked) {
  // 【R32 一時計測】各ステップの所要時間を実行ログに出す。
  //   BULK_LOCK_TRACE = false にすればログは止まる（処理内容は変わらない）。
  const __bt = function (label) {
    try { if (typeof bulkTraceMark === 'function') bulkTraceMark(label); } catch (e) {}
  };
  try {
    try { if (typeof bulkTraceBegin === 'function') bulkTraceBegin('api_bulkLock'); } catch (e) {}
    const auth = verifyToken(token);
    __bt('verifyToken(HMAC検証)');
    if (!auth.valid) {
      try { if (typeof bulkTraceEnd === 'function') bulkTraceEnd('api_bulkLock(認証エラー)'); } catch (e) {}
      return { success: false, need_auth: true, error: '認証セッションが無効です' };
    }
    const currentTeacher = resolveCurrentTeacher(auth.teacher);
    __bt('resolveCurrentTeacher(教員マスタ読取)');
    const scoped = scopeStudentIdsForTeacher(studentIds, currentTeacher);
    __bt('scopeStudentIdsForTeacher(端末一覧読取)');
    if (Array.isArray(scoped.ids) && scoped.ids.length === 0) {
      try { if (typeof bulkTraceEnd === 'function') bulkTraceEnd('api_bulkLock(対象0件)'); } catch (e) {}
      return { success: false, error: '操作対象の児童がありません（自校の児童のみ操作できます）' };
    }
    __bt('--- 親シート書込 開始 ---');
    bulkUpdateScreenLock(scoped.ids, parseBoolean(locked));
    __bt('--- 親シート書込 完了 ---');
    // 子GAS分散: 教員コンソールは google.script.run（この関数）を使うため、
    // ここで伝達しないと子担当の端末にロック指示が届かない。
    // doPost の bulk_lock と同じ内容を渡す（SHARD_MODE=false なら何もしない）。
    __bt('--- 子GAS伝達 開始 ---');
    const shardLock = shardPropagatePolicy(scoped.ids, { screen_lock: parseBoolean(locked) });
    __bt('--- 子GAS伝達 完了 ---');
    try { if (typeof bulkTraceEnd === 'function') bulkTraceEnd('api_bulkLock'); } catch (e) {}
    return { success: true, message: `画面ロックを ${locked ? 'ON' : 'OFF'} に更新しました`, shard: shardLock };
  } catch (err) {
    try { if (typeof bulkTraceEnd === 'function') bulkTraceEnd('api_bulkLock(異常終了)'); } catch (e) {}
    return { success: false, error: err.toString() };
  }
}

function api_bulkBroadcast(token, studentIds, url, broadcastId) {
  try {
    const auth = verifyToken(token);
    if (!auth.valid) return { success: false, need_auth: true, error: '認証セッションが無効です' };
    if (!url) return { success: false, error: 'URLが空です' };
    const currentTeacher = resolveCurrentTeacher(auth.teacher);
    const scoped = scopeStudentIdsForTeacher(studentIds, currentTeacher);
    if (Array.isArray(scoped.ids) && scoped.ids.length === 0) {
      return { success: false, error: '操作対象の児童がありません（自校の児童のみ操作できます）' };
    }
    // 【要件1】管理画面が押下時に採番したIDをそのまま使う（空なら従来どおり発番）。
    //   親・子直送・保留キューflush の3経路で同一IDになることが二重タブ防止の要。
    const bcId = bulkUpdateBroadcastUrl(scoped.ids, url, String(broadcastId || '').trim());
    // 子GAS分散: 一斉URL配信も子へ伝達する（届かないと端末側で配信されない）
    const shardBc = shardPropagatePolicy(scoped.ids, {
      broadcast_url: url,
      broadcast_id: bcId
    });
    return { success: true, broadcast_id: bcId, shard: shardBc };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

function api_bulkFilter(token, studentIds, mode, whitelist, blacklist) {
  try {
    const auth = verifyToken(token);
    if (!auth.valid) return { success: false, need_auth: true, error: '認証セッションが無効です' };
    const currentTeacher = resolveCurrentTeacher(auth.teacher);
    const scoped = scopeStudentIdsForTeacher(studentIds, currentTeacher);
    if (Array.isArray(scoped.ids) && scoped.ids.length === 0) {
      return { success: false, error: '操作対象の児童がありません（自校の児童のみ操作できます）' };
    }
    bulkUpdateFilterMode(scoped.ids, mode, whitelist, blacklist);
    // 子GAS分散: URL規制も子へ伝達する
    const shardFilter = shardPropagatePolicy(scoped.ids, {
      filter_mode: mode,
      whitelist_urls: whitelist,
      blacklist_urls: blacklist
    });
    try {
      saveTeacherSettings(currentTeacher.email, {
        filter_whitelist: whitelist,
        filter_blacklist: blacklist
      });
    } catch (e) {
      Logger.log('教員規制設定保存エラー: ' + e);
    }
    return { success: true, message: `URL規制モードを ${mode} に更新しました`, shard: shardFilter };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

function api_updateSingle(token, studentId, data) {
  try {
    const auth = verifyToken(token);
    if (!auth.valid) return { success: false, need_auth: true, error: '認証セッションが無効です' };
    const currentTeacher = resolveCurrentTeacher(auth.teacher);
    const targetStudent = getDeviceByStudentId(studentId);
    if (!targetStudent) return { success: false, error: '児童IDが見つかりません: ' + studentId };
    if (!isDeviceInTeacherScope(targetStudent.school_name, currentTeacher, targetStudent.class_name)) {
      return { success: false, error: '対象外の児童は操作できません（学校・対象クラスの範囲外）' };
    }
    updateSingleDevice(studentId, data || {});
    // 子GAS分散: 個別更新も子へ伝達する（doPost の update_single と同じ組み立て）
    const single = data || {};
    const shardPatch = {};
    if (single.screen_lock !== undefined) shardPatch.screen_lock = parseBoolean(single.screen_lock);
    if (single.filter_mode !== undefined) shardPatch.filter_mode = single.filter_mode;
    if (single.whitelist_urls !== undefined) shardPatch.whitelist_urls = single.whitelist_urls;
    if (single.blacklist_urls !== undefined) shardPatch.blacklist_urls = single.blacklist_urls;
    if (single.broadcast_url !== undefined) shardPatch.broadcast_url = single.broadcast_url;
    const shardSingle = Object.keys(shardPatch).length
      ? shardPropagatePolicy([studentId], shardPatch) : { skipped: true };
    return { success: true, message: '設定を更新しました', shard: shardSingle };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

function api_saveTeacherSettings(token, settings) {
  try {
    const auth = verifyToken(token);
    if (!auth.valid) return { success: false, need_auth: true, error: '認証セッションが無効です' };
    const currentTeacher = resolveCurrentTeacher(auth.teacher);
    // マイURL・個別規制URLは TEACHER 権限でも保存可。対象クラスは管理者のみ反映。
    const safeSettings = sanitizeTeacherSettingsForSave(settings || {}, currentTeacher);
    const updatedTeacher = saveTeacherSettings(currentTeacher.email, safeSettings);
    return { success: true, message: '教員設定を保存しました', teacher: updatedTeacher };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

function api_getTeacherSettings(token) {
  try {
    const auth = verifyToken(token);
    if (!auth.valid) return { success: false, need_auth: true, error: '認証セッションが無効です' };
    const teacher = getTeacherSettings(auth.teacher.email);
    return { success: true, teacher: teacher };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

// ---- 管理者(ADMIN)専用：アカウント管理 API ----
function api_getTeachers(token) {
  try {
    const auth = verifyToken(token);
    if (!auth.valid) return { success: false, need_auth: true, error: '認証セッションが無効です' };
    return { success: true, teachers: getAllTeachers(auth.teacher), schools: CONFIG.SCHOOL_LIST };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

function api_addTeacher(token, data) {
  try {
    const auth = verifyToken(token);
    if (!auth.valid) return { success: false, need_auth: true, error: '認証セッションが無効です' };
    return { success: true, message: '教員を登録しました', teacher: addTeacher(auth.teacher, data || {}) };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

function api_updateTeacher(token, data) {
  try {
    const auth = verifyToken(token);
    if (!auth.valid) return { success: false, need_auth: true, error: '認証セッションが無効です' };
    return { success: true, message: '教員情報を更新しました', teacher: updateTeacherRecord(auth.teacher, data || {}) };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

function api_addStudent(token, data) {
  try {
    const auth = verifyToken(token);
    if (!auth.valid) return { success: false, need_auth: true, error: '認証セッションが無効です' };
    return { success: true, message: '児童を登録しました', student: addStudentRecord(auth.teacher, data || {}) };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

// ---- 管理者(ADMIN)専用：インポート / 年次更新 API (google.script.run 用) ----
function api_importStudents(token, data) {
  try {
    const auth = verifyToken(token);
    if (!auth.valid) return { success: false, need_auth: true, error: '認証セッションが無効です' };
    const result = importStudents(auth.teacher, data || {});
    return { success: true, message: '児童データをインポートしました', result: result };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

function api_importTeachers(token, data) {
  try {
    const auth = verifyToken(token);
    if (!auth.valid) return { success: false, need_auth: true, error: '認証セッションが無効です' };
    const result = importTeachers(auth.teacher, data || {});
    return { success: true, message: '教員データをインポートしました', result: result };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

function api_runAnnualRollover(token, data) {
  try {
    const auth = verifyToken(token);
    if (!auth.valid) return { success: false, need_auth: true, error: '認証セッションが無効です' };
    const result = runAnnualRollover(auth.teacher, data || {});
    return { success: true, message: '年次更新を実行しました', result: result };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

function api_getArchivedStudents(token) {
  try {
    const auth = verifyToken(token);
    if (!auth.valid) return { success: false, need_auth: true, error: '認証セッションが無効です' };
    return { success: true, data: getArchivedStudents(auth.teacher) };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

// ---- AI監視設定 API (google.script.run 用) ----

function api_getMonitorSettings(token) {
  try {
    const auth = verifyToken(token);
    if (!auth.valid) return { success: false, need_auth: true, error: '認証セッションが無効です' };
    const currentTeacher = resolveCurrentTeacher(auth.teacher);
    return {
      success: true,
      settings: getMonitoringSettings(),
      is_admin: isAdminTeacher(currentTeacher)
    };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

function api_saveMonitorSettings(token, settings) {
  try {
    const auth = verifyToken(token);
    if (!auth.valid) return { success: false, need_auth: true, error: '認証セッションが無効です' };
    const currentTeacher = resolveCurrentTeacher(auth.teacher);
    const saved = saveMonitoringSettings(currentTeacher, settings || {});
    return { success: true, message: '監視設定を保存しました', settings: saved };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

// ============================================================================
// スケジュール管理（タイマー機能）  ―  フェーズ1: データ層
//
//   放課後・休日・家庭持ち帰り端末で「指定した時間帯だけ」URL規制/画面ロックを
//   自動で ON にし、時間が来たら自動で解除するための予約を『スケジュール管理』
//   シートに保持する。
//
//   【このモジュールの最重要原則】
//     1) 日付と時刻は必ず別列。日付型セルが
//        "Tue Nov 10 2026 19:00:00 GMT+0900 (日本標準時)"
//        に化けても壊れないよう、読むときは必ず
//        scheduleDatePart_ / scheduleTimePart_ を通す。
//     2) 日時→ms の変換は必ず sheetTsToMs()（JST 決め打ち）。
//        実行環境のタイムゾーンに依存させない（9時間ずれ事故の防止）。
//     3) 有効/手動解除 は必ず parseBoolean()（Boolean("false")===true の罠）。
//     4) 1校=1スプレッドシート（R41）。このシートは自校の予約だけを持つ。
// ============================================================================

/** 2桁ゼロ詰め（null/不正は 0 として扱う） */
function schPad2_(v) {
  const n = Math.floor(Number(v));
  const num = (isNaN(n) || n < 0) ? 0 : n;
  const s = String(num);
  return s.length >= 2 ? s : ('0' + s);
}

/**
 * クロスレルムでも安全な Date 判定。
 * （vm サンドボックスから渡された Date は instanceof Date が false になるため）
 */
function schIsDate_(v) {
  try {
    return !!v && typeof v === 'object' &&
      typeof v.getTime === 'function' && !isNaN(v.getTime());
  } catch (e) { return false; }
}

/**
 * 日付セル → "yyyy/MM/dd"
 *   Date でも "2026/11/10" でも "Tue Nov 10 2026 ..." でも受け付ける。
 *   Date はローカル getter（GAS のスクリプトTZ＝シートTZ）で壁時計を取り出す。
 */
const SCH_MONTHS_ = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/**
 * シートの日付型セル（Date）を JST の壁時計へ直す。
 *   セルは「日本時間の 0:00」を絶対時刻として持つため、+9h してから
 *   getUTC* で読めば、実行環境のタイムゾーンに一切依存しない。
 *   （getFullYear()/getMonth() は実行TZ依存で、UTC環境では9時間ずれる）
 */
function schJstParts_(d) {
  const j = new Date(d.getTime() + SHEET_TZ_OFFSET_MS);
  return {
    y: j.getUTCFullYear(),
    mo: j.getUTCMonth() + 1,
    da: j.getUTCDate(),
    h: j.getUTCHours(),
    mi: j.getUTCMinutes(),
    dow: j.getUTCDay()
  };
}

function scheduleDatePart_(val) {
  if (val === null || val === undefined || val === '') return '';
  if (schIsDate_(val)) {
    const p = schJstParts_(val);
    return p.y + '/' + schPad2_(p.mo) + '/' + schPad2_(p.da);
  }
  const s = String(val).trim();
  if (!s) return '';
  // "2026/11/10" / "2026-11-10"
  const m = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (m) return m[1] + '/' + schPad2_(m[2]) + '/' + schPad2_(m[3]);
  // 英語表記（シートの日付型セルが String() されたもの）
  //   "Tue Nov 10 2026 00:00:00 GMT+0900 (日本標準時)"
  //   ※ new Date(s) に投げると実行TZで壁時計がずれるため、月名を直接引く。
  const e = s.match(/^(?:[A-Za-z]{3}\s+)?([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})/);
  if (e) {
    const moIdx = SCH_MONTHS_.indexOf(e[1].toUpperCase());
    if (moIdx >= 0) return e[3] + '/' + schPad2_(moIdx + 1) + '/' + schPad2_(e[2]);
  }
  return '';
}

/**
 * 時刻セル → "HH:mm"
 *   Date（時刻型セル）/ "19:00" / "7:00 PM" を受け付ける。
 */
function scheduleTimePart_(val) {
  if (val === null || val === undefined || val === '') return '00:00';
  if (schIsDate_(val)) {
    const p = schJstParts_(val);
    return schPad2_(p.h) + ':' + schPad2_(p.mi);
  }
  const s = String(val).trim();
  if (!s) return '00:00';

  // ① 12時間制（"7:00 PM"）を必ず最初に処理する。
  //    素の HH:mm 判定を先に置くと "7:00 PM" が "07:00" に化ける（実測で踏んだ）。
  const ap = s.match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)/i);
  if (ap) {
    let h = Number(ap[1]);
    const mi = ap[2];
    const mer = ap[3].toUpperCase();
    if (mer === 'PM' && h < 12) h += 12;
    if (mer === 'AM' && h === 12) h = 0;
    return schPad2_(h) + ':' + mi;
  }
  // ② 先頭が時刻（"19:00" / "19:00:00"）
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  if (m) return schPad2_(m[1]) + ':' + m[2];
  // ③ 英語表記に埋め込まれた時刻
  //    "Tue Nov 10 2026 19:00:00 GMT+0900 (日本標準時)"
  //    ※ 先頭アンカーだと取れないため、ここだけ非アンカーで探す。
  //      タイムゾーン表記 "+09:00" より前の時刻が先に一致するので取り違えない。
  const em = s.match(/(\d{1,2}):(\d{2})/);
  if (em) return schPad2_(em[1]) + ':' + em[2];
  return '00:00';
}

/**
 * 日付列 + 時刻列 -> epoch ms（JST基準・実行TZ非依存）
 *   これがフェーズ1の変換の唯一の入口。日付と時刻が別列であることが前提。
 */
function schedulePartsToMs_(dateVal, timeVal) {
  const d = scheduleDatePart_(dateVal);
  if (!d) return 0;
  const t = scheduleTimePart_(timeVal);
  const ms = sheetTsToMs(d + ' ' + t);
  return ms > 0 ? ms : 0;
}

/** epoch ms -> JST の "yyyy/MM/dd HH:mm"（表示・配信用） */
function schMsToJstStr_(ms) {
  const n = Number(ms);
  if (!n || isNaN(n)) return '';
  const j = new Date(n + SHEET_TZ_OFFSET_MS);
  return j.getUTCFullYear() + '/' + schPad2_(j.getUTCMonth() + 1) + '/' + schPad2_(j.getUTCDate()) +
    ' ' + schPad2_(j.getUTCHours()) + ':' + schPad2_(j.getUTCMinutes());
}

/** "HH:mm" -> その日の 0:00 からの経過ms */
function schTimeOfDayMs_(hhmm) {
  const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return 0;
  return (Number(m[1]) * 60 + Number(m[2])) * 60 * 1000;
}

/** 曜日列 "1,2,3,4,5" -> [1,2,3,4,5]（0=日 … 6=土） */
function parseWeekdays_(raw) {
  if (Array.isArray(raw)) {
    return raw.map(function (x) { return Number(x); })
      .filter(function (n) { return !isNaN(n) && n >= 0 && n <= 6; });
  }
  const s = String(raw === null || raw === undefined ? '' : raw).trim();
  if (!s) return [];
  return s.split(/[,\u3001\/\s]+/).map(function (x) { return Number(String(x).trim()); })
    .filter(function (n) { return !isNaN(n) && n >= 0 && n <= 6; });
}

/** epoch ms（JST基準の表現） -> JST の日付文字列 */
function schJstDateStr_(ms) {
  const j = new Date(Number(ms) + SHEET_TZ_OFFSET_MS);
  return j.getUTCFullYear() + '/' + schPad2_(j.getUTCMonth() + 1) + '/' + schPad2_(j.getUTCDate());
}

/** epoch ms（JST基準の表現） -> 曜日 0..6 */
function schJstDow_(ms) {
  return new Date(Number(ms) + SHEET_TZ_OFFSET_MS).getUTCDay();
}

/**
 * 1つの予約を実際の「時間窓」の配列へ展開する。
 *
 *   入力 sched:
 *     { dateFrom:'2026/11/10', dateTo:'2026/11/14', repeat:'WEEKLY',
 *       startTimeOfDayMs, endTimeOfDayMs, weekdays:[1,2,3,4,5] }
 *
 *   戻り値: [{ start_ms, end_ms }, ...]  （最大 CONFIG.SCHEDULE_MAX_WINDOWS 件）
 *
 *   - 終了時刻 <= 開始時刻 のときは「翌日跨ぎ」として +24h する
 *     （設計上は表現可能。検証はフェーズ6で行う）
 *   - now から見て「1日前〜先14日」の範囲だけを返す（無駄な展開をしない）
 */
function expandScheduleWindows_(sched, nowMs, horizonMs) {
  const out = [];
  if (!sched) return out;
  const DAY = 24 * 60 * 60 * 1000;
  const now = (typeof nowMs === 'number' && nowMs > 0) ? nowMs : new Date().getTime();
  const horizon = (typeof horizonMs === 'number' && horizonMs > 0)
    ? horizonMs : ((CONFIG.SCHEDULE_HORIZON_DAYS || 14) * DAY);
  const maxN = CONFIG.SCHEDULE_MAX_WINDOWS || 20;

  const fromStr = scheduleDatePart_(sched.dateFrom);
  if (!fromStr) return out;
  const fromMs = sheetTsToMs(fromStr + ' 00:00');
  if (!fromMs) return out;

  let toMs = sheetTsToMs(scheduleDatePart_(sched.dateTo) + ' 00:00');
  if (!toMs || toMs < fromMs) toMs = fromMs;

  const startOfDay = Number(sched.startTimeOfDayMs) || 0;
  const endOfDay = Number(sched.endTimeOfDayMs) || 0;
  const repeat = String(sched.repeat || 'NONE').trim().toUpperCase();
  const weekdays = Array.isArray(sched.weekdays) ? sched.weekdays : [];

  const lo = Math.max(fromMs, now - DAY);
  const hi = Math.min(toMs, now + horizon);
  if (hi < lo) return out;

  // lo を JST の 0:00 に丸めてから 24h ずつ進める（JST は DST 無しなので安全）
  let d = sheetTsToMs(schJstDateStr_(lo) + ' 00:00');
  for (; d <= hi && out.length < maxN; d += DAY) {
    if (repeat === 'WEEKLY') {
      if (weekdays.indexOf(schJstDow_(d)) < 0) continue;
    } else if (repeat === 'NONE') {
      // 単発: 開始日当日のみ
      if (d !== fromMs) continue;
    }
    // repeat === 'DAILY' は全日
    const start = d + startOfDay;
    let end = d + endOfDay;
    if (end <= start) end += DAY; // 翌日跨ぎ
    out.push({ start_ms: start, end_ms: end });
  }
  return out;
}

/** 予約がこの端末（児童ID / クラス / 学校）に該当するか */
function deviceMatchesSchedule_(row, studentId, normClassName, schoolName) {
  if (!row) return false;
  const sid = String(studentId || '').trim();
  const tt = String(row.targetType || '').trim().toLowerCase();
  if (tt === 'class') {
    const rc = String(row.className || '').trim();
    if (!rc) return false;
    if (normalizeClassName(rc) !== String(normClassName || '')) return false;
    // 学校名が入っていれば一致確認（表記ゆれは schoolNamesMatch で吸収）
    if (row.schoolName && schoolName && !schoolNamesMatch(row.schoolName, schoolName)) return false;
    return true;
  }
  if (tt === 'student') {
    // 【表記ゆれの相互吸収】予約シートの対象児童IDは教員の手入力で、
    //   メール形式とローカル部の両方が存在し得る。indexOf の生比較だけだと
    //   「@の有無」だけの差異で対象から外れ、子GASの by_student が空になる。
    return idMatchesAny_(row.studentIds, sid);
  }
  // 対象種別が空（手入力行の保険）→ 児童ID一致で判定
  return !!(sid && idMatchesAny_(row.studentIds, sid));
}

/**
 * 『スケジュール管理』シートを全行読み、正規化した予約オブジェクトの配列を返す。
 *   ※ 行番号(rowIndex)も返す（更新時に使う）
 */
function readScheduleRows_() {
  const sheet = getTargetSheet(CONFIG.SCHEDULE_SHEET_NAME);
  try { if (typeof ensureScheduleHeaders === 'function') ensureScheduleHeaders(sheet); } catch (eEns) {}
  const map = getHeaderMap(sheet, CONFIG.SCHEDULE_COLUMNS);
  const rows = sheet.getDataRange().getValues();
  const out = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const get = function (name) {
      const c = map[name];
      if (!c) return '';
      const v = row[c - 1];
      return (v === null || v === undefined) ? '' : v;
    };
    const id = String(get('スケジュールID') || '').trim();
    if (!id) continue;

    // 有効: 空欄は「有効」とみなす（列を後から足した既存行の後方互換）。
    //       明示的な FALSE/false/0 のときだけ無効（R38の罠を踏まない）。
    const enabledRaw = get('有効');
    const enabled = (String(enabledRaw).trim() === '') ? true : parseBoolean(enabledRaw);

    const idsRaw = String(get('児童ID') || '');
    out.push({
      rowIndex: i + 1,
      id: id,
      targetType: String(get('対象種別') || '').trim().toLowerCase(),
      schoolName: String(get('学校名') || '').trim(),
      className: String(get('クラス名') || '').trim(),
      studentIds: idsRaw.split(/[,\u3001\s]+/).map(function (s) { return s.trim(); }).filter(Boolean),
      type: String(get('制限タイプ') || 'url_block').trim().toLowerCase(),
      filterMode: String(get('URL規制モード') || '').trim().toUpperCase(),
      // 【配列化】シートは "a.com, b.com" の文字列。端末側の normalizeHostList は
      //   配列以外を捨てるため、読み取り時点で string[] に直しておく
      //   （シートへ書き戻すときは hostListToSheetString_ で文字列に戻す）。
      whitelist: normalizeHostListToArray_(get('許可URLリスト')),
      blacklist: normalizeHostListToArray_(get('規制URLリスト')),
      dateFrom: scheduleDatePart_(get('開始日')),
      dateTo: scheduleDatePart_(get('終了日')),
      repeat: String(get('繰り返し') || 'NONE').trim().toUpperCase(),
      startTime: scheduleTimePart_(get('開始時刻')),
      endTime: scheduleTimePart_(get('終了時刻')),
      weekdaysRaw: String(get('曜日') || '').trim(),
      enabled: enabled,
      overridden: parseBoolean(get('手動解除')),
      overrideAt: String(get('手動解除日時') || '').trim(),
      createdBy: String(get('作成者') || '').trim(),
      createdAt: String(get('作成日時') || '').trim(),
      updatedAt: String(get('更新日時') || '').trim(),
      note: String(get('備考') || '').trim()
    });
  }
  return out;
}

/** 端末のハートビートに載せる「有効/予定/解除済み」の塊を作る */
function buildSchedulePayloadForDevice_(studentId, className, schoolName, nowMs, rowsArg) {
  const payload = { active: [], upcoming: [], overridden_ids: [] };
  const now = (typeof nowMs === 'number' && nowMs > 0) ? nowMs : new Date().getTime();
  // 【フェーズ5】親が全校ぶんを一度に組み立てるとき、予約シートを児童数だけ
  //   読み直してしまう。読み込み済みの行を渡せるようにして 1 回に畳む。
  let rows = [];
  if (Array.isArray(rowsArg)) rows = rowsArg;
  else { try { rows = readScheduleRows_(); } catch (e) { return payload; } }
  if (!rows.length) return payload;

  const sid = String(studentId || '').trim();
  const cn = normalizeClassName(className);
  const upcoming = [];
  const maxActive = CONFIG.SCHEDULE_MAX_ACTIVE || 5;

  rows.forEach(function (r) {
    if (!deviceMatchesSchedule_(r, sid, cn, schoolName)) return;
    // 解除済み（今回だけ停止）は台帳に残すが配信しない
    if (r.overridden) { payload.overridden_ids.push(r.id); return; }
    if (!r.enabled) return;

    const sched = {
      dateFrom: r.dateFrom, dateTo: r.dateTo, repeat: r.repeat,
      startTimeOfDayMs: schTimeOfDayMs_(r.startTime),
      endTimeOfDayMs: schTimeOfDayMs_(r.endTime),
      weekdays: parseWeekdays_(r.weekdaysRaw)
    };
    const wins = expandScheduleWindows_(sched, now, (CONFIG.SCHEDULE_HORIZON_DAYS || 14) * 86400000);
    wins.forEach(function (w) {
      const item = {
        id: r.id,
        type: r.type,
        filter_mode: r.filterMode,
        // 【配列化】端末（拡張機能）の normalizeHostList は配列以外を捨てる。
        //   文字列のまま配ると URL規制が無効化される。
        whitelist: normalizeHostListToArray_(r.whitelist),
        blacklist: normalizeHostListToArray_(r.blacklist),
        start_ms: w.start_ms,
        end_ms: w.end_ms,
        start_jst: schMsToJstStr_(w.start_ms),
        end_jst: schMsToJstStr_(w.end_ms)
      };
      if (w.start_ms <= now && now < w.end_ms) {
        if (payload.active.length < maxActive) payload.active.push(item);
      } else if (w.start_ms > now) {
        upcoming.push(item);
      }
    });
  });

  upcoming.sort(function (a, b) { return a.start_ms - b.start_ms; });
  if (upcoming.length) payload.upcoming = [upcoming[0]]; // 直近の1件だけ先出し
  return payload;
}

// ============================================================================
// 【フェーズ5】子GAS 伝播: 展開済みスケジュールの受け取りと配信
//
//   設計（確定）:
//     ・親が繰り返し・曜日を解釈し、start_ms / end_ms まで確定した
//       「展開済みウィンドウ」を子へ渡す（子は再計算しない）
//     ・子はシートではなく PropertiesService に保持する（シートI/Oを増やさない）
//     ・経路は既存の shard_apply に schedules を同封する 1 本に集約する
//
//   子のハートビートは PropertiesService（+ 30秒のCacheServiceメモ）から
//   引くだけになるため、端末への応答がシート読みに引きずられない。
// ============================================================================

/** 子GASが親から受け取った展開済みスケジュールを持つプロパティキー */
const SHARD_SCHEDULES_PROP = 'SHARD_SCHEDULES_CACHE';
/** ハートビート毎の PropertiesService 読みを避けるためのメモ（秒） */
const SHARD_SCHEDULES_MEMO_SEC = 30;
const SHARD_SCHEDULES_MEMO_KEY = 'shard_sched_memo1';

/** 予約の無い端末へ返す空の配信契約（フェーズ3と同じ形） */
function emptySchedulePayload_() {
  return { active: [], upcoming: [], overridden_ids: [] };
}

/**
 * 子GAS: 親から受け取った展開済みスケジュールを保存する。
 *   byStudent = { "<児童ID>": { windows:[{id,type,filter_mode,whitelist,blacklist,start_ms,end_ms}],
 *                              overridden_ids:["..."] } }
 *   マージではなく「受け取った児童ぶんを置き換える」方式。親が常に正である。
 */
function shardSaveScheduleCache_(byStudent, updatedMs, replace) {
  const now = (typeof updatedMs === 'number' && updatedMs > 0) ? updatedMs : new Date().getTime();
  // 【確定仕様3】親は「その子GASの全児童」を丸ごと送る。差分マージではなく
  //   置き換え（replace=true）にすることで、取消した予約が子に残り続ける
  //   不整合を原理的に排除する。replace が無いときは従来どおりマージ。
  let cur = {};
  if (replace !== true) {
    try {
      const existing = shardLoadScheduleCache_();
      if (existing && existing.by_student) cur = existing.by_student;
    } catch (e0) { cur = {}; }
  }

  let n = 0;
  Object.keys(byStudent || {}).forEach(function (sid) {
    const key = String(sid || '').trim();
    if (!key) return;
    const rec = byStudent[sid] || {};
    cur[key] = {
      windows: Array.isArray(rec.windows) ? rec.windows : [],
      overridden_ids: Array.isArray(rec.overridden_ids) ? rec.overridden_ids : []
    };
    n++;
  });

  const obj = { updated_ms: now, by_student: cur };
  try {
    PropertiesService.getScriptProperties().setProperty(SHARD_SCHEDULES_PROP, JSON.stringify(obj));
  } catch (e) {
    return { saved: 0, error: String(e) };
  }
  // メモを捨てて、次のハートビートから新しい内容を読ませる
  try { CacheService.getScriptCache().remove(SHARD_SCHEDULES_MEMO_KEY); } catch (e2) {}
  return { saved: n, total: Object.keys(cur).length };
}

/** 子GAS: 保持しているスケジュールキャッシュを読む（無ければ null） */
function shardLoadScheduleCache_() {
  try {
    const memo = CacheService.getScriptCache().get(SHARD_SCHEDULES_MEMO_KEY);
    if (memo) {
      const o = JSON.parse(memo);
      if (o && typeof o === 'object' && o.by_student) return o;
    }
  } catch (eM) { /* キャッシュ不可時はプロパティへ */ }
  try {
    const raw = PropertiesService.getScriptProperties().getProperty(SHARD_SCHEDULES_PROP);
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (!o || typeof o !== 'object' || !o.by_student || typeof o.by_student !== 'object') return null;
    try { CacheService.getScriptCache().put(SHARD_SCHEDULES_MEMO_KEY, raw, SHARD_SCHEDULES_MEMO_SEC); } catch (eC) {}
    return o;
  } catch (e) { return null; }
}

/**
 * 親GAS: 1児童ぶんの「展開済みウィンドウ」を組み立てる。
 *   buildSchedulePayloadForDevice_ と違い、active / upcoming に振り分けず
 *   全ウィンドウをそのまま渡す（子の時刻で判定させるため）。
 *   rows を渡すことで予約シートの読みを呼び出し側で1回に畳める。
 */
function shardBuildWindowsForStudent_(rows, studentId, className, schoolName, nowMs) {
  const out = { windows: [], overridden_ids: [] };
  if (!rows || !rows.length) return out;
  const now = (typeof nowMs === 'number' && nowMs > 0) ? nowMs : new Date().getTime();
  const sid = String(studentId || '').trim();
  const cn = normalizeClassName(className);
  const horizon = (CONFIG.SCHEDULE_HORIZON_DAYS || 14) * 86400000;
  const maxWin = CONFIG.SCHEDULE_MAX_WINDOWS || 20;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!deviceMatchesSchedule_(r, sid, cn, schoolName)) continue;
    // 解除済みは窓を配信せずIDだけ渡す（端末は「今回解除」の表示に使う）
    if (r.overridden) { out.overridden_ids.push(r.id); continue; }
    if (!r.enabled) continue;
    const sched = {
      dateFrom: r.dateFrom, dateTo: r.dateTo, repeat: r.repeat,
      startTimeOfDayMs: schTimeOfDayMs_(r.startTime),
      endTimeOfDayMs: schTimeOfDayMs_(r.endTime),
      weekdays: parseWeekdays_(r.weekdaysRaw)
    };
    let wins = [];
    try { wins = expandScheduleWindows_(sched, now, horizon); } catch (eW) { wins = []; }
    for (let w = 0; w < wins.length; w++) {
      if (out.windows.length >= maxWin) break;
      out.windows.push({
        id: r.id,
        type: r.type,
        filter_mode: r.filterMode,
        // 【配列化】親から子GASへ渡す展開済みウィンドウも string[] で運ぶ。
        whitelist: normalizeHostListToArray_(r.whitelist),
        blacklist: normalizeHostListToArray_(r.blacklist),
        start_ms: wins[w].start_ms,
        end_ms: wins[w].end_ms
      });
    }
  }
  out.windows.sort(function (a, b) { return a.start_ms - b.start_ms; });
  return out;
}

/** 親GAS: 子GASへ渡す「児童ID→展開済みウィンドウ」の地図を作る */
function shardBuildScheduleByStudent_(rows, entries, nowMs) {
  const by = {};
  if (!Array.isArray(entries) || !entries.length) return by;
  const now = (typeof nowMs === 'number' && nowMs > 0) ? nowMs : new Date().getTime();
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return by; // 予約が1件も無ければ同封そのものを省く（通信量ゼロ）
  for (let i = 0; i < entries.length; i++) {
    const sid = String(entries[i][0] || '').trim();
    if (!sid || by[sid]) continue;
    const school = String(entries[i][1] || '').trim();
    const cls = String(entries[i][2] || '').trim();
    const r = shardBuildWindowsForStudent_(list, sid, cls, school, now);
    if (r.windows.length || r.overridden_ids.length) by[sid] = r;
  }
  return by;
}

/** 親GAS: 地図から、その子GASへ送る児童ぶんだけを抜き出す */
function shardPickSchedulesFor_(byStudent, ids, nowMs) {
  if (!byStudent) return null;
  const now = (typeof nowMs === 'number' && nowMs > 0) ? nowMs : new Date().getTime();
  const picked = {};
  let n = 0;
  const list = Array.isArray(ids) ? ids : [];
  for (let i = 0; i < list.length; i++) {
    const k = String(list[i] || '').trim();
    if (!k || !byStudent[k]) continue;
    picked[k] = byStudent[k];
    n++;
  }
  if (!n) return null;
  return { updated_ms: now, by_student: picked };
}

/**
 * 子GAS: 保持しているキャッシュから、端末へ返す配信契約を組み立てる。
 *   時刻比較（start_ms <= now < end_ms）だけを行う。繰り返しの再解釈はしない。
 */
function shardSchedulePayloadFromCache_(studentId, nowMs) {
  const payload = emptySchedulePayload_();
  const cache = shardLoadScheduleCache_();
  if (!cache || !cache.by_student) return payload;
  const sid = String(studentId || '').trim();
  if (!sid) return payload;

  // 【二段構えの照合】端末の student_id は「メール全体」と「@より前のローカル部」の
  //   両方が届く。生の完全一致（cache.by_student[sid]）だけで引くと、「@の有無」だけの
  //   差異で無言の空配列になり、「親→子は saved:1 なのに端末で規制が効かない」
  //   という最も厄介な壊れ方をする（実機で発生した断線の正体）。
  //   ① 正規化した完全一致 → ② ローカル部一致（片方だけメール形式のとき）の順で解決する。
  let rec = null;
  let hitKey = '';
  try {
    const want = normalizeIdKey(sid);
    const keys = Object.keys(cache.by_student || {});
    for (let i = 0; i < keys.length; i++) {
      if (normalizeIdKey(keys[i]) === want) { hitKey = keys[i]; break; }
    }
    if (!hitKey) {
      // 候補が1件に絞れたときだけ採用する。
      //   複数候補＝別児童の同名ローカル部。誤配信して無実の児童を
      //   止めるより、配信しないほうが安全なので採用しない。
      const cands = [];
      for (let j = 0; j < keys.length; j++) {
        if (idKeysMatch_(keys[j], sid)) cands.push(keys[j]);
      }
      if (cands.length === 1) {
        hitKey = cands[0];
      } else if (cands.length > 1) {
        try {
          Logger.log('[SHARD] heartbeat: ID照合が曖昧 sid=' + sid +
            ' 候補=' + cands.length + '（配信を見送り）');
        } catch (eA) {}
      }
    }
    if (hitKey) rec = cache.by_student[hitKey];
  } catch (eM) {
    rec = null;
  }
  if (!rec) {
    try {
      Logger.log('[SHARD] heartbeat: 照合なし sid=' + sid +
        ' 保持キー数=' + Object.keys(cache.by_student || {}).length);
    } catch (eN) {}
    return payload;
  }

  const now = (typeof nowMs === 'number' && nowMs > 0) ? nowMs : new Date().getTime();
  const active = [];
  const upcoming = [];
  const wins = Array.isArray(rec.windows) ? rec.windows : [];
  for (let i = 0; i < wins.length; i++) {
    const w = wins[i];
    if (!w || typeof w.start_ms !== 'number' || typeof w.end_ms !== 'number') continue;
    const item = {
      id: w.id,
      type: w.type,
      filter_mode: w.filter_mode,
      // 【配列化】親から受け取った時点で既に配列だが、旧バージョンのキャッシュ
      //   （文字列で保存された回）が残っている端末を救うため、ここでも正規化する。
      whitelist: normalizeHostListToArray_(w.whitelist),
      blacklist: normalizeHostListToArray_(w.blacklist),
      start_ms: w.start_ms,
      end_ms: w.end_ms,
      start_jst: schMsToJstStr_(w.start_ms),
      end_jst: schMsToJstStr_(w.end_ms)
    };
    if (w.start_ms <= now && now < w.end_ms) active.push(item);
    else if (w.start_ms > now) upcoming.push(item);
  }
  active.sort(function (a, b) { return a.start_ms - b.start_ms; });
  upcoming.sort(function (a, b) { return a.start_ms - b.start_ms; });

  const maxActive = CONFIG.SCHEDULE_MAX_ACTIVE || 5;
  payload.active = active.slice(0, maxActive);
  // 直近の1件だけ先出し（次に来る制限を端末が事前に把握できるようにする）
  if (upcoming.length) payload.upcoming = [upcoming[0]];
  payload.overridden_ids = Array.isArray(rec.overridden_ids) ? rec.overridden_ids.slice() : [];
  return payload;
}

/**
 * 端末へ渡す配信契約の解決口（buildHeartbeatResponse から呼ぶ）。
 *   子GASで、かつ親から受け取ったキャッシュがあるときはキャッシュだけを見る。
 *   これにより子のハートビートがスケジュールシート読みに引きずられない。
 */
function resolveSchedulePayloadForDevice_(studentId, className, schoolName, nowMs) {
  let isChild = false;
  try { isChild = (typeof isShardChild === 'function' && isShardChild()); } catch (eC) { isChild = false; }
  // 【設定漏れの救済】isShardChild が false でも、親から受け取った痕跡があれば
  //   子として扱い、空の子シートではなくプロパティストアを読む。
  if (!isChild) {
    try { if (typeof shardDetectChildByInbox_ === 'function' && shardDetectChildByInbox_()) isChild = true; } catch (eD) {}
  }
  if (isChild) {
    // 【確定仕様2】子GASは親から受け取ったキャッシュだけを正とする。
    //   キャッシュが無い＝まだ親から同期されていない＝制限なし。
    //   ここでシート読みへフォールバックすると、子側に残った古い行が復活し
    //   「解除したのに制限が残る」不整合になるため、あえて読みに行かない。
    try {
      var __pl = shardSchedulePayloadFromCache_(studentId, nowMs);
      try {
        Logger.log('[SHARD] heartbeat: 子GASとして配信 sid=' + String(studentId || '') +
          ' active=' + ((__pl && __pl.active) ? __pl.active.length : 0) +
          ' upcoming=' + ((__pl && __pl.upcoming) ? __pl.upcoming.length : 0));
      } catch (eL) {}
      return __pl;
    }
    catch (eC2) { return emptySchedulePayload_(); }
  }
  // 親・単体GASは従来どおり自前のシートから組み立てる。
  return buildSchedulePayloadForDevice_(studentId, className, schoolName, nowMs);
}

/**
 * 親GAS: 予約の作成・取消・解除を、該当する子GASへ即時伝播する。
 *   確定仕様:
 *     ・保留キューを使わず、その場で同期送信する（forceSync=true）
 *     ・子GASごとに「全児童の最新構造体」を丸ごと送る（差分管理しない）
 *   対象校の児童が1人もいない（子GAS未設定など）ときは何もしない。
 */
function propagateScheduleToChildren_(schedRow) {
  // 【可観測性】この関数は無言で成功もスキップもできてしまうため、実機で
  //   「伝播が走ったのか」をログから切り分けられなかった。どの分岐を通ったかを
  //   必ず 1 行残す（無言の成功／無言のスキップを作らない）。
  const __plog = function (msg) { try { Logger.log('[SHARD] ' + msg); } catch (eL) {} };
  try {
    if (typeof isShardParent !== 'function' || !isShardParent()) {
      __plog('propagate: skip（このスクリプトは親GASではありません。' +
        'スクリプトプロパティ SHARD_MODE=true を確認してください）');
      return { skipped: true, reason: 'not_parent' };
    }
    if (!schedRow) {
      __plog('propagate: skip（予約行がありません）');
      return { skipped: true, reason: 'no_row' };
    }

    const ids = [];
    if (schedRow.targetType === 'student') {
      const list = Array.isArray(schedRow.studentIds) ? schedRow.studentIds : [];
      for (let i = 0; i < list.length; i++) {
        const s = String(list[i] || '').trim();
        if (s) ids.push(s);
      }
    } else {
      // クラス対象: 索引から該当クラスの児童IDを集める（シート全読みはしない）
      let entries = [];
      try { entries = (typeof shardDeviceEntries === 'function') ? (shardDeviceEntries() || []) : []; }
      catch (eE) { entries = []; }
      const cn = normalizeClassName(schedRow.className);
      for (let i = 0; i < entries.length; i++) {
        const sid = String(entries[i][0] || '').trim();
        if (!sid) continue;
        if (normalizeClassName(entries[i][2]) !== cn) continue;
        // 学校名が入っていれば一致確認（表記ゆれは schoolNamesMatch で吸収）
        if (schedRow.schoolName && entries[i][1] &&
            !schoolNamesMatch(schedRow.schoolName, entries[i][1])) continue;
        ids.push(sid);
      }
    }
    if (!ids.length) {
      __plog('propagate: skip（対象児童が見つかりません target=' + schedRow.targetType +
        ' class=' + String(schedRow.className || '') + '）。' +
        '端末一覧に児童が居るか、クラス表記が一致するかを確認してください');
      return { skipped: true, reason: 'no_target' };
    }
    __plog('propagate: 開始 target=' + schedRow.targetType + ' ids=' + ids.length);

    // patch は空（ロック・配信・規制には触れない）。スケジュールだけを運ぶ。
    const __res = shardPropagatePolicy(ids, {}, true);
    __plog('propagate: 完了 ' + JSON.stringify(__res));
    return __res;
  } catch (e) {
    // 伝播に失敗しても予約自体は成立させる（次回の伝播で追いつく）
    __plog('propagate: 例外 ' + String((e && e.message) ? e.message : e));
    return { error: String(e) };
  }
}

/**
 * 一覧表示用の軽量判定（予約行を1回読んだだけで全端末ぶんを判定する）。
 * getAllDevices から呼ぶため、シート読みは呼び出し側で1回に畳む。
 */
function isAnyScheduleActive_(rows, studentId, className, schoolName, nowMs) {
  if (!rows || !rows.length) return false;
  const now = (typeof nowMs === 'number' && nowMs > 0) ? nowMs : new Date().getTime();
  const sid = String(studentId || '').trim();
  const cn = normalizeClassName(className);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r.enabled || r.overridden) continue;
    if (!deviceMatchesSchedule_(r, sid, cn, schoolName)) continue;
    const sched = {
      dateFrom: r.dateFrom, dateTo: r.dateTo, repeat: r.repeat,
      startTimeOfDayMs: schTimeOfDayMs_(r.startTime),
      endTimeOfDayMs: schTimeOfDayMs_(r.endTime),
      weekdays: parseWeekdays_(r.weekdaysRaw)
    };
    const wins = expandScheduleWindows_(sched, now, 2 * 86400000);
    for (let k = 0; k < wins.length; k++) {
      if (wins[k].start_ms <= now && now < wins[k].end_ms) return true;
    }
  }
  return false;
}

// ============================================================================
// スケジュール管理（タイマー機能）  ―  フェーズ2: GAS API (CRUD)
//
//   save_schedule / list_schedules / cancel_schedule / override_schedule
//
//   【認可の原則】
//     これらはすべて教員操作なので doPost の認証ブロック通過後に到達する
//     （＝ payload.token は検証済み）。加えて行ごとに
//     「自校のクラス／自校の児童」だけを触れるよう再確認する。
//     他校のIDを混ぜて送っても 1 件も書けない（denied で落とす）。
//
//   【解除 と 取消 は別物】
//     解除(override) … 今回の時間帯だけ止める。列17=TRUE/列18=日時。
//                      予約自体は残るので、次回以降の時間帯はまた効く。
//     取消(cancel)   … 予約そのものを止める。列16=有効 FALSE。配信対象外。
//     どちらも行を削除しない（監査ログとして残す）。
// ============================================================================

/** JST の "yyyy/MM/dd HH:mm:ss"（シートの他の日時列と書式を揃える） */
function schNowJstSec_() {
  const d = new Date();
  const ms = d.getTime();
  const j = new Date(ms + SHEET_TZ_OFFSET_MS);
  return j.getUTCFullYear() + '/' + schPad2_(j.getUTCMonth() + 1) + '/' + schPad2_(j.getUTCDate()) +
    ' ' + schPad2_(j.getUTCHours()) + ':' + schPad2_(j.getUTCMinutes()) + ':' + schPad2_(j.getUTCSeconds());
}

/** スケジュールID採番（衝突しない・並べ替え可能） */
function generateScheduleId_() {
  const rand = Math.random().toString(36).slice(2, 6);
  return 'sch_' + new Date().getTime() + '_' + rand;
}

/**
 * 入力の正規化と検証。
 *   戻り値 { ok, errors:[], norm:{...} }
 */
function validateScheduleInput_(p) {
  const src = p || {};
  const errs = [];
  const norm = {
    targetType: String(src.target_type || src.targetType || '').trim().toLowerCase(),
    schoolName: String(src.school_name || src.schoolName || '').trim(),
    className: String(src.class_name || src.className || '').trim(),
    studentIds: [],
    type: String(src.type || src.restriction_type || 'url_block').trim().toLowerCase(),
    filterMode: String(src.filter_mode || src.filterMode || 'BLACKLIST').trim().toUpperCase(),
    // 【配列化】入力は「カンマ区切り文字列」でも「配列」でも受ける（後方互換）。
    //   内部（norm）では string[] に統一する。空判定は .length で行う（下記）。
    whitelist: normalizeHostListToArray_(src.whitelist_urls || src.whitelist || ''),
    blacklist: normalizeHostListToArray_(src.blacklist_urls || src.blacklist || ''),
    dateFrom: '',
    dateTo: '',
    repeat: String(src.repeat || 'NONE').trim().toUpperCase(),
    startTime: '',
    endTime: '',
    weekdays: [],
    note: String(src.note || '').trim()
  };

  // --- 対象種別 ---
  if (norm.targetType !== 'class' && norm.targetType !== 'student') {
    errs.push('対象種別は class か student を指定してください');
  }

  // --- 児童ID（student のとき） ---
  const rawIds = src.student_ids || src.studentIds || [];
  if (Array.isArray(rawIds)) {
    norm.studentIds = rawIds.map(function (s) { return String(s || '').trim(); }).filter(Boolean);
  } else {
    norm.studentIds = String(rawIds || '').split(/[,\u3001\s]+/)
      .map(function (s) { return s.trim(); }).filter(Boolean);
  }
  if (norm.targetType === 'student' && norm.studentIds.length === 0) {
    errs.push('児童IDを1つ以上指定してください');
  }
  if (norm.targetType === 'class' && !norm.className) {
    errs.push('クラス名を指定してください');
  }

  // --- 制限タイプ ---
  if (norm.type !== 'url_block' && norm.type !== 'screen_lock') {
    errs.push('制限タイプは url_block か screen_lock を指定してください');
  }
  // --- URL規制モード（url_block のときだけ意味を持つ） ---
  if (norm.type === 'url_block') {
    if (norm.filterMode !== 'BLACKLIST' && norm.filterMode !== 'WHITELIST') {
      errs.push('URL規制モードは BLACKLIST か WHITELIST を指定してください');
    }
    // 【配列化】norm.* は string[] になった。空配列は truthy なので
    //   !norm.blacklist では判定できない（必ず .length を見る）。
    if (norm.filterMode === 'BLACKLIST' && norm.blacklist.length === 0) {
      errs.push('BLACKLIST を選んだ場合は規制URLリストが必要です');
    }
    if (norm.filterMode === 'WHITELIST' && norm.whitelist.length === 0) {
      errs.push('WHITELIST を選んだ場合は許可URLリストが必要です');
    }
  }

  // --- 日付 ---
  norm.dateFrom = scheduleDatePart_(src.date_from || src.dateFrom || '');
  if (!norm.dateFrom) errs.push('開始日を yyyy/MM/dd で指定してください');
  norm.dateTo = scheduleDatePart_(src.date_to || src.dateTo || '') || norm.dateFrom;

  // --- 時刻 ---
  const stRaw = src.start_time || src.startTime || '';
  const etRaw = src.end_time || src.endTime || '';
  norm.startTime = stRaw === '' ? '' : scheduleTimePart_(stRaw);
  norm.endTime = etRaw === '' ? '' : scheduleTimePart_(etRaw);
  if (!/^\d{2}:\d{2}$/.test(norm.startTime)) errs.push('開始時刻を HH:mm で指定してください');
  if (!/^\d{2}:\d{2}$/.test(norm.endTime)) errs.push('終了時刻を HH:mm で指定してください');
  if (norm.startTime && norm.endTime && norm.startTime === norm.endTime) {
    errs.push('開始時刻と終了時刻が同じです（0分の予約は作成できません）');
  }

  // --- 繰り返し ---
  if (['NONE', 'DAILY', 'WEEKLY'].indexOf(norm.repeat) < 0) {
    norm.repeat = 'NONE';
  }
  if (norm.repeat === 'WEEKLY') {
    norm.weekdays = parseWeekdays_(src.weekdays || src.week_days || '');
    if (!norm.weekdays.length) {
      errs.push('毎週(WEEKLY)の場合は曜日を1つ以上指定してください');
    }
  }
  if (norm.repeat === 'NONE' && norm.dateFrom && norm.dateTo && norm.dateTo !== norm.dateFrom) {
    // 単発なのに期間が複数日 → 開始日のみに寄せる
    norm.dateTo = norm.dateFrom;
  }
  if (norm.dateFrom && norm.dateTo && sheetTsToMs(norm.dateTo + ' 00:00') < sheetTsToMs(norm.dateFrom + ' 00:00')) {
    errs.push('終了日は開始日以降にしてください');
  }

  return { ok: errs.length === 0, errors: errs, norm: norm };
}

/**
 * 予約の対象が教員の権限内かを確認する（書き込み直前に必ず通す）。
 *   norm は破壊的に補正される（schoolName を自校へ寄せる等）。
 */
function authorizeScheduleTarget_(norm, teacher) {
  if (!teacher) return { ok: false, error: '認証情報がありません' };
  const scope = getTeacherScopeInfo(teacher);

  if (norm.targetType === 'class') {
    // 学校境界
    if (scope.type === 'school' || scope.type === 'unknown') {
      if (!norm.schoolName) {
        norm.schoolName = scope.school || '';
      } else if (!schoolNamesMatch(norm.schoolName, scope.school)) {
        return { ok: false, error: '自校以外のクラスは予約できません' };
      } else {
        norm.schoolName = scope.school;
      }
    }
    // クラス境界（「対象クラス」は権限の境界）
    if (!isClassInTeacherScope(norm.className, teacher)) {
      return { ok: false, error: '対象クラスの権限がありません: ' + norm.className };
    }
    return { ok: true };
  }

  // student: 指定された児童IDがすべて自校スコープ内であること
  if (!norm.studentIds.length) return { ok: false, error: '児童IDが空です' };
  const scoped = scopeStudentIdsForTeacher(norm.studentIds, teacher);
  if (!Array.isArray(scoped.ids) || scoped.ids.length === 0) {
    return { ok: false, error: '操作対象の児童がありません（自校の児童のみ予約できます）' };
  }
  if (scoped.ids.length !== norm.studentIds.length) {
    return { ok: false, error: '自校以外の児童が含まれています（全員が自校の児童である必要があります）' };
  }
  norm.studentIds = scoped.ids;
  return { ok: true };
}

/**
 * シートの1行を書き込む。ヘッダー名→列番号で詰めるので、
 * 列の増減（ensureScheduleHeaders の自動補完）にも追従する。
 */
function appendScheduleRow_(obj) {
  const sheet = getTargetSheet(CONFIG.SCHEDULE_SHEET_NAME);
  try { ensureScheduleHeaders(sheet); } catch (eEns) {}
  const map = getHeaderMap(sheet, CONFIG.SCHEDULE_COLUMNS);
  const lastCol = Math.max(sheet.getLastColumn() || 0, CONFIG.SCHEDULE_COLUMNS.length);
  const values = [];
  for (let i = 0; i < lastCol; i++) values.push('');

  const set = function (name, val) {
    const c = map[name];
    if (!c) return;
    values[c - 1] = (val === undefined || val === null) ? '' : val;
  };
  set('スケジュールID', obj.id);
  set('対象種別', obj.targetType);
  set('学校名', obj.schoolName);
  set('クラス名', obj.className);
  set('児童ID', Array.isArray(obj.studentIds) ? obj.studentIds.join(',') : String(obj.studentIds || ''));
  set('制限タイプ', obj.type);
  set('URL規制モード', obj.type === 'url_block' ? obj.filterMode : '');
  // 【配列化】obj.whitelist / obj.blacklist は string[]（または文字列）で来る。
  //   シートは 1 セルなので、必ずカンマ区切り文字列へ戻してから書く
  //   （配列をそのまま setValues するとセルに配列が入り、次回の読み取りが壊れる）。
  set('許可URLリスト', obj.type === 'url_block' ? hostListToSheetString_(obj.whitelist) : '');
  set('規制URLリスト', obj.type === 'url_block' ? hostListToSheetString_(obj.blacklist) : '');
  set('開始日', obj.dateFrom);
  set('終了日', obj.dateTo);
  set('繰り返し', obj.repeat);
  set('開始時刻', obj.startTime);
  set('終了時刻', obj.endTime);
  set('曜日', Array.isArray(obj.weekdays) && obj.weekdays.length ? obj.weekdays.join(',') : '');
  set('有効', true);          // 新規は必ず有効（文字列 "TRUE" ではなく真偽値で書く）
  set('手動解除', false);
  set('手動解除日時', '');
  set('作成者', obj.createdBy);
  set('作成日時', obj.createdAt);
  set('更新日時', obj.updatedAt);
  set('備考', obj.note);

  sheet.appendRow(values);
  return sheet.getLastRow();
}

/** 特定行の指定列だけを更新する（監査ログを壊さない） */
function updateScheduleCells_(rowIndex, patch) {
  const sheet = getTargetSheet(CONFIG.SCHEDULE_SHEET_NAME);
  try { ensureScheduleHeaders(sheet); } catch (eEns) {}
  const map = getHeaderMap(sheet, CONFIG.SCHEDULE_COLUMNS);
  Object.keys(patch).forEach(function (name) {
    const c = map[name];
    if (!c) return;
    sheet.getRange(rowIndex, c).setValue(patch[name]);
  });
}

/**
 * 予約行が教員の権限内か（list / cancel / override の共通判定）。
 *  class   → 学校一致 ＋ 対象クラス境界
 *  student → 児童が1人でも自校スコープ内なら「触れる」（取消は自校分に限る）
 */
function isScheduleRowInTeacherScope_(row, teacher) {
  if (!row || !teacher) return false;
  if (isAdminTeacher(teacher)) return true;
  const scope = getTeacherScopeInfo(teacher);

  if (row.schoolName && (scope.type === 'school' || scope.type === 'unknown')) {
    if (!schoolNamesMatch(row.schoolName, scope.school)) return false;
  }
  if (row.targetType === 'class') {
    return isClassInTeacherScope(row.className, teacher);
  }
  if (row.targetType === 'student') {
    const scoped = scopeStudentIdsForTeacher(row.studentIds || [], teacher);
    return Array.isArray(scoped.ids) && scoped.ids.length > 0;
  }
  return true;
}

/** 予約1件をクライアント向けのJSONへ整形する */
function scheduleRowToJson_(r, nowMs) {
  const sched = {
    dateFrom: r.dateFrom, dateTo: r.dateTo, repeat: r.repeat,
    startTimeOfDayMs: schTimeOfDayMs_(r.startTime),
    endTimeOfDayMs: schTimeOfDayMs_(r.endTime),
    weekdays: parseWeekdays_(r.weekdaysRaw)
  };
  const wins = expandScheduleWindows_(sched, nowMs, (CONFIG.SCHEDULE_HORIZON_DAYS || 14) * 86400000);
  let activeNow = false;
  let nextStart = 0;
  for (let i = 0; i < wins.length; i++) {
    if (wins[i].start_ms <= nowMs && nowMs < wins[i].end_ms) activeNow = true;
    if (!nextStart && wins[i].start_ms > nowMs) nextStart = wins[i].start_ms;
  }
  return {
    id: r.id,
    target_type: r.targetType,
    school_name: r.schoolName,
    class_name: r.className,
    student_ids: r.studentIds,
    type: r.type,
    filter_mode: r.filterMode,
    // 【配列化】一覧APIの応答も string[] で返す（端末/画面側の契約に合わせる）。
    whitelist_urls: normalizeHostListToArray_(r.whitelist),
    blacklist_urls: normalizeHostListToArray_(r.blacklist),
    date_from: r.dateFrom,
    date_to: r.dateTo,
    repeat: r.repeat,
    start_time: r.startTime,
    end_time: r.endTime,
    weekdays: parseWeekdays_(r.weekdaysRaw),
    enabled: r.enabled,
    overridden: r.overridden,
    override_at: r.overrideAt,
    created_by: r.createdBy,
    created_at: r.createdAt,
    updated_at: r.updatedAt,
    note: r.note,
    is_active_now: activeNow,
    next_start_ms: nextStart,
    next_start_jst: nextStart ? schMsToJstStr_(nextStart) : '',
    window_count: wins.length
  };
}

/** save_schedule */
function handleSaveSchedule_(payload, teacher) {
  const v = validateScheduleInput_(payload);
  if (!v.ok) {
    return { success: false, error: v.errors.join(' / '), error_code: 'validation_failed', errors: v.errors };
  }
  const authz = authorizeScheduleTarget_(v.norm, teacher);
  if (!authz.ok) {
    return { success: false, error: authz.error, error_code: 'forbidden' };
  }

  const nowStr = schNowJstSec_();
  const obj = {
    id: generateScheduleId_(),
    targetType: v.norm.targetType,
    schoolName: v.norm.schoolName,
    className: v.norm.targetType === 'class' ? v.norm.className : '',
    studentIds: v.norm.targetType === 'student' ? v.norm.studentIds : [],
    type: v.norm.type,
    filterMode: v.norm.filterMode,
    whitelist: v.norm.whitelist,
    blacklist: v.norm.blacklist,
    dateFrom: v.norm.dateFrom,
    dateTo: v.norm.dateTo,
    repeat: v.norm.repeat,
    startTime: v.norm.startTime,
    endTime: v.norm.endTime,
    weekdays: v.norm.weekdays,
    note: v.norm.note,
    createdBy: String((teacher && teacher.email) || ''),
    createdAt: nowStr,
    updatedAt: nowStr
  };

  let rowIndex = 0;
  withWriteLock(function () { rowIndex = appendScheduleRow_(obj); });

  const nowMs = new Date().getTime();

  // 【性能】書き込み直後に readScheduleRows_() でシート全体を読み直していた。
  //   予約シートが 1,000〜2,000 行に育つと、この 1 回の往復だけで
  //   「予約を登録」→「完了表示」が数秒遅れていた（追加した行は obj に
  //   そのまま在るので、読み直す必要が無い）。
  //   appendScheduleRow_ が書く値と readScheduleRows_ が返す正規化済みの形を
  //   ここで 1:1 に再現する（条件付きで空になる列も同じ条件で落とす）。
  const isUrlBlock = obj.type === 'url_block';
  const saved = {
    rowIndex: rowIndex,
    id: obj.id,
    targetType: obj.targetType,
    schoolName: String(obj.schoolName || '').trim(),
    className: String(obj.className || '').trim(),
    studentIds: Array.isArray(obj.studentIds) ? obj.studentIds : [],
    type: obj.type,
    // 規制モード／URL リストは url_block のときだけ列に載る（appendScheduleRow_ と同じ）
    filterMode: isUrlBlock ? String(obj.filterMode || '').trim().toUpperCase() : '',
    // 【配列化】readScheduleRows_ が返す形（string[]）を 1:1 で再現する。
    //   obj.whitelist は norm 由来の配列（または空文字）なので正規化して載せる。
    whitelist: isUrlBlock ? normalizeHostListToArray_(obj.whitelist) : [],
    blacklist: isUrlBlock ? normalizeHostListToArray_(obj.blacklist) : [],
    dateFrom: obj.dateFrom,
    dateTo: obj.dateTo,
    repeat: obj.repeat,
    startTime: obj.startTime,
    endTime: obj.endTime,
    weekdaysRaw: (Array.isArray(obj.weekdays) && obj.weekdays.length) ? obj.weekdays.join(',') : '',
    enabled: true,          // 新規は必ず有効（appendScheduleRow_ が true を書く）
    overridden: false,      // 新規は必ず未解除
    overrideAt: '',
    createdBy: obj.createdBy,
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt,
    note: obj.note
  };

  Logger.log('[SCHEDULE] saved id=' + obj.id + ' target=' + obj.targetType +
    ' by=' + obj.createdBy + ' row=' + rowIndex);

  // 【フェーズ5】子GASへ即時伝播（保留キューを使わない同期送信）。
  //   saved は上のとおり必ず非 null。propagateScheduleToChildren_ が参照するのは
  //   targetType / className / schoolName / studentIds のみ。
  const shardProp = propagateScheduleToChildren_(saved);

  return {
    success: true,
    message: 'スケジュールを登録しました',
    schedule: scheduleRowToJson_(saved, nowMs),
    row_index: rowIndex,
    shard: shardProp
  };
}

/** list_schedules */
function handleListSchedules_(payload, teacher) {
  const nowMs = new Date().getTime();
  const wantId = String((payload && (payload.schedule_id || payload.id)) || '').trim();
  let rows = readScheduleRows_();

  const out = [];
  rows.forEach(function (r) {
    if (wantId && r.id !== wantId) return;
    if (!isScheduleRowInTeacherScope_(r, teacher)) return;
    out.push(scheduleRowToJson_(r, nowMs));
  });
  out.sort(function (a, b) { return String(a.created_at).localeCompare(String(b.created_at)); });

  return { success: true, data: out, count: out.length, server_time_ms: nowMs, server_time: schNowJstSec_() };
}

/** cancel_schedule … 予約そのものを止める（有効=FALSE／行は残す） */
function handleCancelSchedule_(payload, teacher) {
  const id = String((payload && (payload.schedule_id || payload.id)) || '').trim();
  if (!id) return { success: false, error: 'スケジュールIDが必要です', error_code: 'validation_failed' };

  const rows = readScheduleRows_();
  let target = null;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].id === id) { target = rows[i]; break; }
  }
  if (!target) return { success: false, error: 'スケジュールが見つかりません: ' + id, error_code: 'not_found' };
  if (!isScheduleRowInTeacherScope_(target, teacher)) {
    return { success: false, error: 'この予約を操作する権限がありません', error_code: 'forbidden' };
  }

  const nowStr = schNowJstSec_();
  withWriteLock(function () {
    updateScheduleCells_(target.rowIndex, { '有効': false, '更新日時': nowStr });
  });

  Logger.log('[SCHEDULE] cancelled id=' + id + ' by=' + String((teacher && teacher.email) || ''));

  // 【フェーズ5】取消を子GASへ即時伝播する。
  //   子は丸ごと上書きなので、この予約が子のキャッシュからも消える。
  const shardProp = propagateScheduleToChildren_(target);

  return { success: true, message: '予約を取り消しました（履歴は残ります）', schedule_id: id, enabled: false, updated_at: nowStr, shard: shardProp };
}

/** override_schedule … 今回の時間帯だけ解除（予約は残す） */
function handleOverrideSchedule_(payload, teacher) {
  const id = String((payload && (payload.schedule_id || payload.id)) || '').trim();
  if (!id) return { success: false, error: 'スケジュールIDが必要です', error_code: 'validation_failed' };

  const rows = readScheduleRows_();
  let target = null;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].id === id) { target = rows[i]; break; }
  }
  if (!target) return { success: false, error: 'スケジュールが見つかりません: ' + id, error_code: 'not_found' };
  if (!isScheduleRowInTeacherScope_(target, teacher)) {
    return { success: false, error: 'この予約を操作する権限がありません', error_code: 'forbidden' };
  }

  const nowStr = schNowJstSec_();
  withWriteLock(function () {
    updateScheduleCells_(target.rowIndex, {
      '手動解除': true,
      '手動解除日時': nowStr,
      '更新日時': nowStr
    });
  });

  Logger.log('[SCHEDULE] overridden id=' + id + ' by=' + String((teacher && teacher.email) || ''));

  // 【フェーズ5】解除を子GASへ即時伝播する（子は overridden_ids として端末へ配る）。
  const shardProp = propagateScheduleToChildren_(target);

  return { success: true, message: 'この予約を今回だけ解除しました（次回以降は再び適用されます）', schedule_id: id, overridden: true, override_at: nowStr, shard: shardProp };
}

/**
 * スケジュール機能用 Web API エントリーポイント（google.script.run 用）
 *
 * 【確定仕様】teacher オブジェクトの正しいプロパティ
 *     email … 教員ID（メールアドレス）  ← これが空だと by= が空になり監査ログが壊れる
 *     school … 所属学校（school_name ではない）
 *   認証検証は既存の verifyToken(authToken) のみを信頼する。
 *   存在しないヘルパー（getTeacherByToken_ / authenticateToken_ /
 *   getSessionUserEmail_）は一切呼び出さない。
 *
 * 【過去の不具合】存在しないヘルパーを呼んでいたため teacher が常に null になり、
 *   isScheduleRowInTeacherScope_ が全行 false を返して一覧が 0 件（カレンダーが空）
 *   になっていた。また by= が空文字になっていた。
 */
function extractTeacherFromToken_(authToken) {
  if (!authToken) return null;
  var res = null;
  try { res = (typeof verifyToken === 'function') ? verifyToken(authToken) : null; } catch (e) { res = null; }
  if (!res || !res.valid || !res.teacher) return null;
  // トークンは発行時点のスナップショット。教員マスタの最新レコードで解決し直す
  // （api_getAllDevices と同じ鎖。所属校・権限の変更を即座に反映させる）。
  try {
    if (typeof resolveCurrentTeacher === 'function') return resolveCurrentTeacher(res.teacher);
  } catch (e2) { /* 最新化に失敗してもトークン内容で続行する */ }
  return res.teacher;
}

/**
 * 認証できなかったときの共通応答。
 *   null のまま内部ハンドラへ渡すと「権限外＝0件」として黙って空になるため、
 *   ここで明示的に失敗させてフロントを再ログインへ誘導する。
 */
function apiNeedAuth_() {
  return { success: false, need_auth: true, error: '認証セッションが無効です。再ログインしてください。' };
}

function api_listSchedules(authToken, schoolName) {
  var teacher = extractTeacherFromToken_(authToken);
  if (!teacher) return apiNeedAuth_();
  var payload = {
    school_name: schoolName || (teacher.school || ''),
    token: authToken
  };
  return handleListSchedules_(payload, teacher);
}

function api_saveSchedule(authToken, scheduleData) {
  var teacher = extractTeacherFromToken_(authToken);
  if (!teacher) return apiNeedAuth_();
  var payload = (scheduleData && typeof scheduleData === 'object') ? scheduleData : {};
  payload.token = authToken;
  // 学校名が未指定なら教員の所属校で補う（スコープ判定の取りこぼしを防ぐ）
  if (!payload.schoolName && !payload.school_name && teacher.school) {
    payload.schoolName = teacher.school;
    payload.school_name = teacher.school;
  }
  return handleSaveSchedule_(payload, teacher);
}

function api_cancelSchedule(authToken, scheduleId) {
  var teacher = extractTeacherFromToken_(authToken);
  if (!teacher) return apiNeedAuth_();
  return handleCancelSchedule_({ schedule_id: scheduleId, id: scheduleId, token: authToken }, teacher);
}

function api_overrideSchedule(authToken, scheduleId, actionType) {
  var teacher = extractTeacherFromToken_(authToken);
  if (!teacher) return apiNeedAuth_();
  return handleOverrideSchedule_({
    schedule_id: scheduleId,
    id: scheduleId,
    action_type: actionType,
    override_type: actionType,
    token: authToken
  }, teacher);
}
