// --- portable path prelude: 絶対パス(/home/user/webapp/...)を tests からの相対へ解決 ---
(function(){
  const fs0 = require('fs'); const path0 = require('path');
  const PREFIX = '/home/user/webapp/';
  const _rf = fs0.readFileSync;
  fs0.readFileSync = function(p, ...a){
    if (typeof p === 'string' && p.startsWith(PREFIX)) {
      p = path0.join(__dirname, '..', p.slice(PREFIX.length));
    }
    return _rf.call(this, p, ...a);
  };
})();
// ============================================================================
// フェーズ2（GAS API）単体テスト: スケジュール CRUD
//
//   検証の狙い
//     1) 認可: 他校・他クラスの予約は作れない／触れない（教員スコープ）
//     2) 解除(override) と 取消(cancel) が別物であること
//        - 取消 は 有効=FALSE（予約は残る＝監査ログ）
//        - 解除 は 手動解除=TRUE（予約は残り、次回以降また効く）
//     3) 行を削除しない（監査ログ保全）
//     4) 有効=false の文字列でも「無効」と判定できる（R38の罠）
//     5) ルーティングが認証ブロックの後ろにあること
//     6) シートへのテレメトリ書き戻しをしないこと
// ============================================================================
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync('/home/user/webapp/gas/Code.gs', 'utf8');

function extractFn(name) {
  const re = new RegExp('^function ' + name + '\\s*\\(', 'm');
  const start = src.search(re);
  if (start < 0) throw new Error('fn not found: ' + name);
  let i = src.indexOf('{', start), depth = 0, end = -1;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  return src.slice(start, end + 1);
}
function extractConst(name) {
  const idx = src.indexOf('const ' + name + ' = ');
  if (idx < 0) throw new Error('const not found: ' + name);
  const oi = src.indexOf('{', idx), ai = src.indexOf('[', idx);
  const useObj = oi >= 0 && (ai < 0 || oi < ai);
  const open = useObj ? '{' : '[', close = useObj ? '}' : ']';
  const at = src.indexOf(open, idx);
  let d = 0, end = -1;
  for (let i = at; i < src.length; i++) {
    if (src[i] === open) d++;
    else if (src[i] === close) { d--; if (d === 0) { end = i; break; } }
  }
  return 'const ' + name + ' = ' + src.slice(at, end + 1) + ';';
}

let pass = 0, fail = 0;
function check(n, c, e) {
  if (c) { console.log('PASS ' + n, e !== undefined ? '=> ' + JSON.stringify(e) : ''); pass++; }
  else { console.log('FAIL ' + n, e !== undefined ? '=> ' + JSON.stringify(e) : ''); fail++; }
}

// ---------------------------------------------------------------- fake sheet
function makeSheet(cols, rows) {
  return {
    _cols: (cols || []).slice(),
    _rows: (rows || []).map(function (r) { return r.slice(); }),
    _writes: 0,
    getLastColumn() { return this._cols.length; },
    getLastRow() { return this._rows.length; },
    getRange(r, c, nr, nc) {
      const self = this;
      if (nr === undefined) nr = 1;
      if (nc === undefined) nc = 1;
      return {
        getValues() {
          const out = [];
          for (let i = 0; i < nr; i++) {
            const row = [];
            for (let j = 0; j < nc; j++) row.push((self._rows[r - 1 + i] || [])[c - 1 + j]);
            out.push(row);
          }
          return out;
        },
        setValue(v) {
          self._writes++;
          if (!self._rows[r - 1]) self._rows[r - 1] = [];
          self._rows[r - 1][c - 1] = v;
          return this;
        },
        setValues(vals) {
          self._writes++;
          vals.forEach(function (rr, i) {
            rr.forEach(function (v, j) {
              if (!self._rows[r - 1 + i]) self._rows[r - 1 + i] = [];
              self._rows[r - 1 + i][c - 1 + j] = v;
            });
          });
          return this;
        },
        setBackground() { return this; },
        setFontColor() { return this; },
        setFontWeight() { return this; },
        setNumberFormat() { return this; }
      };
    },
    getDataRange() {
      const self = this;
      return { getValues() { return self._rows.map(function (r) { return r.slice(); }); } };
    },
    appendRow(row) { this._writes++; this._rows.push(row.slice()); },
    insertSheet() { return this; },
    setFrozenRows() {},
    getSheetName() { return 'sheet'; }
  };
}

const CONFIG_SRC = extractConst('CONFIG');
const sandboxStub = 'var __CFG = ' + CONFIG_SRC.replace('const CONFIG = ', '') + ';';

const sheets = {};
// 端末一覧: https:// の児童名簿
const DEVICE_COLUMNS = ['児童ID', '学校名', '氏名', 'クラス', '画面ロック', 'URL規制モード',
  '許可URLリスト', '規制URLリスト', '一斉表示URL', '一斉表示実行ID', '現在開いているURL',
  '最終同期日時', '備考', '画面情報要求日時', '画面情報更新日時'];

const SCHEDULE_COLUMNS = JSON.parse(
  JSON.stringify(
    (function () {
      const m = src.match(/SCHEDULE_COLUMNS:\s*\[([\s\S]*?)\n\s*\],/);
      if (!m) throw new Error('SCHEDULE_COLUMNS not found');
      return m[1].split('\n')
        .map(function (l) { return l.replace(/\/\/.*$/, '').trim(); })
        .filter(function (l) { return /^'/.test(l); })
        .map(function (l) { return l.replace(/^'/, '').replace(/',?$/, ''); });
    })()
  )
);

const devRows = [
  DEVICE_COLUMNS.slice(),
  ['s1', '第一小学校', '第一 一郎', '5年1組', false, 'OFF', '', '', '', '', '', '', '', '', ''],
  ['s2', '第一小学校', '第一 二郎', '6年1組', false, 'OFF', '', '', '', '', '', '', '', '', ''],
  ['s3', '英田小学校', '英田 三郎', '5年1組', false, 'OFF', '', '', '', '', '', '', '', '', '']
];
sheets['端末一覧'] = makeSheet(DEVICE_COLUMNS, devRows);
sheets['スケジュール管理'] = makeSheet([], []); // 空 → ヘッダー自動補完を harness 側で行う

// -------------------------------------------------------------- vm context
const ctx = vm.createContext({
  console: { log: function () {} },
  Logger: { log: function () {} },
  LockService: {
    getScriptLock: function () {
      return { waitLock: function () {}, releaseLock: function () {} };
    }
  },
  Utilities: {
    formatDate: function () { return '2026/11/10 19:00:00'; },
    base64EncodeWebSafe: function () { return 'x'; },
    computeHmacSha256Signature: function () { return [1, 2, 3]; }
  },
  CacheService: undefined,
  PropertiesService: undefined,
  ContentService: {
    MimeType: { JSON: 'application/json' },
    createTextOutput: function (s) {
      return { _s: s, setMimeType: function () { return this; }, getContent: function () { return this._s; } };
    }
  }
});

const pieces = [];
pieces.push(CONFIG_SRC);
pieces.push('const SHEET_TZ_OFFSET_MS = 9 * 60 * 60 * 1000;');
pieces.push(extractConst('SCH_MONTHS_'));
// SCHOOL_ALIASES が定義されている場合のみ取り込む
try { pieces.push(extractConst('SCHOOL_ALIASES')); } catch (e) { pieces.push('const SCHOOL_ALIASES = {};'); }

const FNS = [
  // --- シート/ヘッダー ---
  'getHeaderMap',
  // --- 日時 ---
  'schPad2_', 'schIsDate_', 'schJstParts_', 'scheduleDatePart_', 'scheduleTimePart_',
  'schedulePartsToMs_', 'schMsToJstStr_', 'schTimeOfDayMs_', 'parseWeekdays_',
  'schJstDateStr_', 'schJstDow_', 'sheetTsToMs', 'expandScheduleWindows_',
  // --- 名簿/権限 ---
  'normalizeSchoolName', 'schoolNamesMatch', 'resolveCanonicalSchool',
  'isAllSchoolsName', 'normalizeClassName', 'isAdminTeacher',
  'getTeacherScopeInfo', 'getTeacherTargetClasses', 'isClassInTeacherScope',
  'scopeStudentIdsForTeacher', 'parseBoolean',
  // --- URLリストの配列化（シートは文字列 / 端末契約は string[]） ---
  'normalizeHostListToArray_', 'hostListToSheetString_',
  // --- スケジュール中核 ---
  'deviceMatchesSchedule_', 'readScheduleRows_', 'isAnyScheduleActive_',
  // --- CRUD ---
  'schNowJstSec_', 'generateScheduleId_', 'validateScheduleInput_',
  'authorizeScheduleTarget_', 'appendScheduleRow_', 'updateScheduleCells_',
  'isScheduleRowInTeacherScope_', 'scheduleRowToJson_',
  // --- 端末へ配る経路（配列化の検証対象） ---
  'buildSchedulePayloadForDevice_', 'shardBuildWindowsForStudent_',
  'handleSaveSchedule_', 'handleListSchedules_', 'handleCancelSchedule_', 'handleOverrideSchedule_',
  // --- フェーズ5: 子GAS伝播の入口（isShardParent が false なら即 skipped） ---
  'propagateScheduleToChildren_'
];
FNS.forEach(function (n) { pieces.push(extractFn(n)); });

// --- ハーネス側スタブ（テスト専用。製品コードには入れない） ---
// getTargetSheet: 名前でシートを返す
pieces.push('function getTargetSheet(name){ var s = __SHEETS[name]; if(!s) throw new Error("no sheet: "+name); return s; }');
// ensureScheduleHeaders: 空ならヘッダーを書き、不足列を末尾に足す（最小実装）
pieces.push([
  'function ensureScheduleHeaders(sheet){',
  '  if (sheet.getLastColumn() === 0) {',
  '    sheet._cols = CONFIG.SCHEDULE_COLUMNS.slice();',
  '    sheet._rows[0] = CONFIG.SCHEDULE_COLUMNS.slice();',
  '    return;',
  '  }',
  '  var hdr = sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0].map(function(h){return String(h).trim();});',
  '  CONFIG.SCHEDULE_COLUMNS.forEach(function(col){',
  '    if (hdr.indexOf(col) < 0) { sheet._cols.push(col); sheet._rows[0] = sheet._rows[0] || []; sheet._rows[0].push(col); }',
  '  });',
  '}'
].join('\n'));
// withWriteLock: ロックはスタブ化（実装は抽出せず、そのまま呼ぶだけ）
pieces.push([
  'function withWriteLock(fn){ return fn(); }',
  'function invalidateDevicesCache(){}',
  // フェーズ5: このスイートは「親でも子でもない」単体GASとして扱う。
  //   propagateScheduleToChildren_ は isShardParent()===false で即 skipped を返す。
  'function isShardParent(){ return false; }',
  // 索引は「使えない環境」を再現する。null を返すこと（[] だと truthy のため
  // scopeStudentIdsForTeacher がシート読みフォールバックへ落ちず、個別児童が
  // 全滅する）。
  'function shardDeviceEntries(){ return null; }',
].join('\n'));

// __SHEETS / __SCHOOLS は context 側で渡す（ここで var 宣言すると上書きしてしまう）
ctx.__SHEETS = sheets;
ctx.__SCHOOLS = sheets;

pieces.push('globalThis.__T = { CONFIG: CONFIG, SHEETS: __SHEETS, ' + FNS.join(', ') + ' };');

vm.runInContext(pieces.join('\n\n'), ctx, { filename: 'schedule_api_vm.js' });
const T = ctx.__T;

// ---------------------------------------------------------------- teachers
const admin = { email: 'admin@school.ed.jp', name: '管理者', school: '全校管理', role: 'ADMIN', target_class: '全クラス' };
const tDaiichi = { email: 't1@school.ed.jp', name: '第一小', school: '第一小学校', role: 'TEACHER', target_class: '5年1組' };
const tAida = { email: 't2@school.ed.jp', name: '英田小', school: '英田小学校', role: 'TEACHER', target_class: '5年1組' };

const baseClass = {
  target_type: 'class', school_name: '第一小学校', class_name: '5年1組',
  type: 'url_block', filter_mode: 'BLACKLIST',
  blacklist_urls: 'youtube.com,game.example',
  date_from: '2026/11/10', date_to: '2026/11/14',
  repeat: 'WEEKLY', weekdays: '1,2,3,4,5',
  start_time: '19:00', end_time: '21:00',
  note: '放課後'
};

// ================================================================ 正常系
const r1 = T.handleSaveSchedule_(baseClass, admin);
check('保存: 管理者はクラス一括で登録できる', r1.success === true, r1.error);
check('保存: スケジュールIDが採番される', /^sch_\d+_[a-z0-9]+$/.test(r1.schedule && r1.schedule.id), r1.schedule && r1.schedule.id);
check('保存: 窓が4件（火〜金）', r1.schedule && r1.schedule.window_count === 4, r1.schedule && r1.schedule.window_count);
check('保存: 有効で作成される', r1.schedule && r1.schedule.enabled === true);
check('保存: 手動解除は false', r1.schedule && r1.schedule.overridden === false);
check('保存: 作成者が記録される', r1.schedule && r1.schedule.created_by === 'admin@school.ed.jp');

const r2 = T.handleSaveSchedule_(baseClass, tDaiichi);
check('保存: 担任は自分のクラスなら登録できる', r2.success === true, r2.error);

// 個別児童
const r3 = T.handleSaveSchedule_({
  target_type: 'student', student_ids: ['s1'],
  type: 'screen_lock',
  date_from: '2026/11/10', date_to: '2026/11/10',
  repeat: 'NONE', start_time: '18:00', end_time: '20:00'
}, tDaiichi);
check('保存: 個別児童（画面ロック）', r3.success === true, r3.error);
check('保存: screen_lock は window_count 1', r3.schedule && r3.schedule.window_count === 1, r3.schedule && r3.schedule.window_count);

// ================================================================ 認可
const r4 = T.handleSaveSchedule_(
  Object.assign({}, baseClass, { class_name: '6年1組' }), tDaiichi);
check('認可: 対象クラス外は登録できない', r4.success === false && r4.error_code === 'forbidden', r4.error);

const r5 = T.handleSaveSchedule_(
  Object.assign({}, baseClass, { school_name: '英田小学校', class_name: '5年1組' }), tDaiichi);
check('認可: 他校のクラスは登録できない', r5.success === false && r5.error_code === 'forbidden', r5.error);

const r6 = T.handleSaveSchedule_({
  target_type: 'student', student_ids: ['s3'], // 英田小の児童
  type: 'url_block', filter_mode: 'BLACKLIST', blacklist_urls: 'youtube.com',
  date_from: '2026/11/10', date_to: '2026/11/10', repeat: 'NONE',
  start_time: '19:00', end_time: '21:00'
}, tDaiichi);
check('認可: 他校の児童は登録できない', r6.success === false && r6.error_code === 'forbidden', r6.error);

const r7 = T.handleSaveSchedule_({
  target_type: 'student', student_ids: ['s1', 's3'], // 自校＋他校の混在
  type: 'url_block', filter_mode: 'BLACKLIST', blacklist_urls: 'youtube.com',
  date_from: '2026/11/10', date_to: '2026/11/10', repeat: 'NONE',
  start_time: '19:00', end_time: '21:00'
}, tDaiichi);
check('認可: 自校と他校の混在は全体拒否', r7.success === false && r7.error_code === 'forbidden', r7.error);

// ================================================================ 入力検証
const v1 = T.handleSaveSchedule_(Object.assign({}, baseClass, { start_time: '' }), admin);
check('検証: 開始時刻なしは弾く', v1.success === false && v1.error_code === 'validation_failed');
const v2 = T.handleSaveSchedule_(Object.assign({}, baseClass, { blacklist_urls: '' }), admin);
check('検証: BLACKLIST で規制URLなしは弾く', v2.success === false && v2.error_code === 'validation_failed');
const v3 = T.handleSaveSchedule_(Object.assign({}, baseClass, { weekdays: '' }), admin);
check('検証: WEEKLY で曜日なしは弾く', v3.success === false && v3.error_code === 'validation_failed');
const v4 = T.handleSaveSchedule_(Object.assign({}, baseClass, { start_time: '19:00', end_time: '19:00' }), admin);
check('検証: 開始=終了（0分）は弾く', v4.success === false && v4.error_code === 'validation_failed');
const v5 = T.handleSaveSchedule_(Object.assign({}, baseClass, { filter_mode: 'WHITELIST', whitelist_urls: '' }), admin);
check('検証: WHITELIST で許可URLなしは弾く', v5.success === false && v5.error_code === 'validation_failed');
const v6 = T.handleSaveSchedule_(Object.assign({}, baseClass, { target_type: 'bogus' }), admin);
check('検証: 不正な対象種別は弾く', v6.success === false && v6.error_code === 'validation_failed');
const v7 = T.handleSaveSchedule_(Object.assign({}, baseClass, { date_from: '2026/11/14', date_to: '2026/11/10' }), admin);
check('検証: 終了日<開始日は弾く', v7.success === false && v7.error_code === 'validation_failed');

// ================================================================ 一覧
const lAdmin = T.handleListSchedules_({}, admin);
check('一覧: 管理者は全部見える', lAdmin.success === true && lAdmin.count === 3, lAdmin.count);
const lDaiichi = T.handleListSchedules_({}, tDaiichi);
check('一覧: 担任は自校のみ', lDaiichi.success === true && lDaiichi.count === 3, lDaiichi.count);
const lAida = T.handleListSchedules_({}, tAida);
check('一覧: 他校の担任には見えない', lAida.success === true && lAida.count === 0, lAida.count);
check('一覧: server_time_ms を返す', typeof lAdmin.server_time_ms === 'number' && lAdmin.server_time_ms > 0);

// ================================================================ 取消 vs 解除
const sheetSch = sheets['スケジュール管理'];
const rowsBefore = sheetSch.getLastRow();
const id1 = r1.schedule.id;

const c1 = T.handleCancelSchedule_({ schedule_id: id1 }, admin);
check('取消: 成功する', c1.success === true, c1.error);
check('取消: enabled=false を返す', c1.enabled === false);
check('取消: 行は削除しない（監査ログ保全）', sheetSch.getLastRow() === rowsBefore,
  sheetSch.getLastRow() + ' / ' + rowsBefore);

const rowsNow = T.readScheduleRows_();
const row1 = rowsNow.filter(function (r) { return r.id === id1; })[0];
check('取消: シートの 有効 が false になった', !!row1 && row1.enabled === false, row1 && row1.enabled);
check('取消: 予約自体は残っている', !!row1);

// 解除（別の予約に対して）
const o1 = T.handleOverrideSchedule_({ schedule_id: r2.schedule.id }, admin);
check('解除: 成功する', o1.success === true, o1.error);
check('解除: overridden=true を返す', o1.overridden === true);
const rowsNow2 = T.readScheduleRows_();
const row2 = rowsNow2.filter(function (r) { return r.id === r2.schedule.id; })[0];
check('解除: 手動解除 が true', !!row2 && row2.overridden === true);
check('解除: 手動解除日時 が入る', !!row2 && /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/.test(row2.overrideAt), row2 && row2.overrideAt);
check('解除: 有効 は true のまま（予約は生きている）', !!row2 && row2.enabled === true);

// 解除済みは配信対象から外れる
const payload = T.buildSchedulePayloadForDevice_ ?
  null : null; // 未抽出（下のソース検査で担保）
const overriddenInList = T.handleListSchedules_({}, admin).data
  .filter(function (s) { return s.overridden === true; });
check('一覧: 解除済みフラグが立って返る', overriddenInList.length === 1, overriddenInList.length);

// ================================================================ 権限（取消/解除）
const c2 = T.handleCancelSchedule_({ schedule_id: id1 }, tAida);
check('認可: 他校の予約は取り消せない', c2.success === false && c2.error_code === 'forbidden', c2.error);
const o2 = T.handleOverrideSchedule_({ schedule_id: id1 }, tAida);
check('認可: 他校の予約は解除できない', o2.success === false && o2.error_code === 'forbidden', o2.error);

const c3 = T.handleCancelSchedule_({ schedule_id: 'sch_nope' }, admin);
check('取消: 存在しないIDは not_found', c3.success === false && c3.error_code === 'not_found');
const c4 = T.handleCancelSchedule_({}, admin);
check('取消: IDなしは validation_failed', c4.success === false && c4.error_code === 'validation_failed');

// ================================================================ R38の罠
// シートに文字列 "FALSE" が入っていても「無効」と判定できること
(function () {
  const map = T.getHeaderMap(sheetSch, SCHEDULE_COLUMNS);
  const idCol = map['スケジュールID'];
  const enCol = map['有効'];
  const rows = sheetSch.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][idCol - 1]) === r3.schedule.id) {
      sheetSch.getRange(i + 1, enCol).setValue('FALSE');
      break;
    }
  }
})();
const rowsStr = T.readScheduleRows_();
const row3 = rowsStr.filter(function (r) { return r.id === r3.schedule.id; })[0];
check('R38: 文字列 "FALSE" を無効として読む', !!row3 && row3.enabled === false, row3 && row3.enabled);

// 空欄は「有効」とみなす（列を後から足した既存行の後方互換）
(function () {
  const map = T.getHeaderMap(sheetSch, SCHEDULE_COLUMNS);
  const idCol = map['スケジュールID'];
  const enCol = map['有効'];
  const rows = sheetSch.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][idCol - 1]) === r3.schedule.id) {
      sheetSch.getRange(i + 1, enCol).setValue('');
      break;
    }
  }
})();
const rowsBlank = T.readScheduleRows_();
const row3b = rowsBlank.filter(function (r) { return r.id === r3.schedule.id; })[0];
check('後方互換: 有効が空欄なら有効扱い', !!row3b && row3b.enabled === true, row3b && row3b.enabled);

// ================================================================ ソース検査
// ルーティングが認証ブロックの後ろにあること（未認証で CRUD に入れない）
const idxAuth = src.indexOf("const auth = verifyToken(payload.token);");
const idxSave = src.indexOf("action === 'save_schedule'");
const idxList = src.indexOf("action === 'list_schedules'");
const idxCancel = src.indexOf("action === 'cancel_schedule'");
const idxOverride = src.indexOf("action === 'override_schedule'");
check('ルート: save_schedule は認証ブロックの後', idxAuth > 0 && idxSave > idxAuth, { idxAuth: idxAuth, idxSave: idxSave });
check('ルート: list_schedules は認証ブロックの後', idxList > idxAuth);
check('ルート: cancel_schedule は認証ブロックの後', idxCancel > idxAuth);
check('ルート: override_schedule は認証ブロックの後', idxOverride > idxAuth);
check('ルート: 4つのアクションが揃っている',
  idxSave > 0 && idxList > 0 && idxCancel > 0 && idxOverride > 0);
check('ルート: currentTeacher を渡している',
  /handleSaveSchedule_\(payload, currentTeacher\)/.test(src) &&
  /handleListSchedules_\(payload, currentTeacher\)/.test(src) &&
  /handleCancelSchedule_\(payload, currentTeacher\)/.test(src) &&
  /handleOverrideSchedule_\(payload, currentTeacher\)/.test(src));

// getAllDevices に schedule_active が載っている
check('一覧: schedule_active を端末レコードに付与', /schedule_active:/.test(src));
// 読み取り時集計のみ（書き戻しをしない）
check('不変条件: 予約シートへの書き込みは CRUD 経由のみ',
  !/readScheduleRows_[\s\S]{0,400}?appendRow/.test(src));

// 監査ログ方針: スケジュール関連の実装が行削除 API を呼んでいないこと
//   ※ deleteRow は年次更新（run_annual_rollover）で正当に使われているため、
//     ファイル全体ではなくスケジュール関連の関数だけを対象に検査する。
(function () {
  const SCHEDULE_FNS = [
    'appendScheduleRow_', 'updateScheduleCells_', 'handleSaveSchedule_',
    'handleListSchedules_', 'handleCancelSchedule_', 'handleOverrideSchedule_',
    'readScheduleRows_', 'isScheduleRowInTeacherScope_', 'scheduleRowToJson_'
  ];
  let bad = [];
  SCHEDULE_FNS.forEach(function (n) {
    let body = '';
    try { body = extractFn(n); } catch (e) { body = ''; }
    if (/deleteRow\s*\(|deleteRows\s*\(/.test(body)) bad.push(n);
  });
  check('不変条件: スケジュール実装は行削除しない（監査ログ保全）', bad.length === 0, bad);
})();

// ================================================================ M. Web API ラッパー
//   背景（実害）: 過去のラッパーは存在しないヘルパー（getTeacherByToken_ /
//     authenticateToken_ / getSessionUserEmail_）を呼んでいたため teacher が
//     常に null になり、
//        ・isScheduleRowInTeacherScope_ が全行 false → 一覧 0 件（カレンダーが空）
//        ・createdBy（by=）が空文字 → 監査ログが壊れる
//     という 2 つの不具合を同時に起こしていた。
//   再発防止として「認証は verifyToken のみ」「架空ヘルパー禁止」
//   「teacher.school_name 禁止（正は teacher.school）」を機械的に固定する。
console.log('===== M. Web API ラッパー（認証チェーン） =====');
{
  const API_FNS = [
    'extractTeacherFromToken_', 'api_listSchedules', 'api_saveSchedule',
    'api_cancelSchedule', 'api_overrideSchedule'
  ];
  const bodies = {};
  API_FNS.forEach(function (n) { bodies[n] = extractFn(n); });

  // ① 認証の入口は verifyToken だけ
  check('extractTeacherFromToken_ は verifyToken で検証する',
    /verifyToken\s*\(/.test(bodies.extractTeacherFromToken_));
  check('extractTeacherFromToken_ は res.valid と res.teacher を確認する',
    /\.valid/.test(bodies.extractTeacherFromToken_) && /\.teacher/.test(bodies.extractTeacherFromToken_));

  // ② 架空ヘルパーの呼び出しが無い（関数本体だけを見る＝説明コメントは対象外）
  const PHANTOM = ['getTeacherByToken_', 'authenticateToken_', 'getSessionUserEmail_'];
  const phantomHits = [];
  API_FNS.forEach(function (n) {
    PHANTOM.forEach(function (p) {
      if (bodies[n].indexOf(p) >= 0) phantomHits.push(n + ' -> ' + p);
    });
  });
  check('架空ヘルパーを一切呼ばない', phantomHits.length === 0, phantomHits);

  // ③ teacher.school_name を使わない（verifyToken が返す正しいキーは school）
  const wrongProp = [];
  API_FNS.forEach(function (n) {
    if (/teacher\s*\.\s*school_name/.test(bodies[n])) wrongProp.push(n);
  });
  check('teacher.school_name を使わない', wrongProp.length === 0, wrongProp);
  check('Code.gs 全体でも teacher.school_name を参照しない',
    !/teacher\s*\.\s*school_name/.test(src));

  // ④ 4 本すべてが既存ハンドラへ委譲する（ロジックを二重実装しない）
  check('api_listSchedules は handleListSchedules_ に委譲',
    /handleListSchedules_\s*\(/.test(bodies.api_listSchedules));
  check('api_saveSchedule は handleSaveSchedule_ に委譲',
    /handleSaveSchedule_\s*\(/.test(bodies.api_saveSchedule));
  check('api_cancelSchedule は handleCancelSchedule_ に委譲',
    /handleCancelSchedule_\s*\(/.test(bodies.api_cancelSchedule));
  check('api_overrideSchedule は handleOverrideSchedule_ に委譲',
    /handleOverrideSchedule_\s*\(/.test(bodies.api_overrideSchedule));
}

// ================================================================ N. 実行: 認証チェーン
//   ソース検査だけでは「teacher が実際に解決されるか」は分からないため、
//   verifyToken / resolveCurrentTeacher / handle*_ を差し替えた小さな VM で
//   ラッパーを実際に走らせ、引数の中身まで確認する。
console.log('===== N. Web API ラッパーの実行 =====');
{
  const vmMod = require('vm');
  const API_SRC_FNS = [
    'extractTeacherFromToken_', 'apiNeedAuth_', 'api_listSchedules',
    'api_saveSchedule', 'api_cancelSchedule', 'api_overrideSchedule'
  ];
  const apiSrc = API_SRC_FNS.map(function (n) { return extractFn(n); }).join('\n');

  function buildApi(o) {
    o = o || {};
    const stash = { tokens: [], calls: [], list: null, save: null, cancel: null, override: null };
    const sandbox = {
      __stash: stash,
      __verifyRes: o.verifyRes === undefined ? null : o.verifyRes,
      __verifyThrows: !!o.verifyThrows,
      __resolved: o.resolved || null,
      __resolveThrows: !!o.resolveThrows,
      Logger: { log: function () {} }
    };
    const pre = [
      'function verifyToken(t){ __stash.tokens.push(t); if (__verifyThrows) throw new Error("boom"); return __verifyRes; }',
      'function resolveCurrentTeacher(t){ if (__resolveThrows) throw new Error("boom"); return __resolved || t; }',
      'function handleListSchedules_(p, t){ __stash.list = p; __stash.calls.push({fn:"list", teacher:t}); return {success:true, data:[], src:"list"}; }',
      'function handleSaveSchedule_(p, t){ __stash.save = p; __stash.calls.push({fn:"save", teacher:t}); return {success:true, src:"save"}; }',
      'function handleCancelSchedule_(p, t){ __stash.cancel = p; __stash.calls.push({fn:"cancel", teacher:t}); return {success:true, src:"cancel"}; }',
      'function handleOverrideSchedule_(p, t){ __stash.override = p; __stash.calls.push({fn:"override", teacher:t}); return {success:true, src:"override"}; }'
    ].join('\n');
    const tail = '\n__API = { extract: extractTeacherFromToken_, list: api_listSchedules,' +
      ' save: api_saveSchedule, cancel: api_cancelSchedule, override: api_overrideSchedule };';
    vmMod.createContext(sandbox);
    vmMod.runInContext(pre + '\n' + apiSrc + '\n' + tail, sandbox);
    return sandbox;
  }

  const TCH = { email: 't@example.com', name: '担任', school: '第一小学校', role: 'TEACHER', target_class: '5年1組' };

  // ① トークン無し → null
  check('トークン無しは teacher を返さない', buildApi({ verifyRes: { valid: true, teacher: TCH } }).__API.extract('') === null);

  // ② 無効トークン → null
  check('valid=false は teacher を返さない', buildApi({ verifyRes: { valid: false } }).__API.extract('bad.token') === null);

  // ③ 有効トークン → teacher
  (function () {
    const ctx = buildApi({ verifyRes: { valid: true, teacher: TCH } });
    const t = ctx.__API.extract('a.b');
    check('有効トークンは teacher を返す', !!t && t.email === 't@example.com', t);
    check('有効トークンは school を保持する', !!t && t.school === '第一小学校', t && t.school);
    check('トークンが verifyToken へ渡る', ctx.__stash.tokens[0] === 'a.b', ctx.__stash.tokens);
  })();

  // ④ verifyToken が例外を投げても落ちない
  (function () {
    const ctx = buildApi({ verifyThrows: true });
    let threw = false, out = 'unset';
    try { out = ctx.__API.extract('a.b'); } catch (e) { threw = true; }
    check('verifyToken の例外で落ちない', threw === false && out === null, out);
  })();

  // ⑤ resolveCurrentTeacher が最新レコードで上書きする
  (function () {
    const ctx = buildApi({
      verifyRes: { valid: true, teacher: TCH },
      resolved: { email: 't@example.com', name: '担任', school: '英田小学校', role: 'ADMIN' }
    });
    const t = ctx.__API.extract('a.b');
    check('最新の所属校で解決し直す', t.school === '英田小学校', t.school);
    check('最新の権限で解決し直す', t.role === 'ADMIN', t.role);
  })();

  // ⑥ resolveCurrentTeacher が例外 → トークン内容で続行
  (function () {
    const ctx = buildApi({ verifyRes: { valid: true, teacher: TCH }, resolveThrows: true });
    const t = ctx.__API.extract('a.b');
    check('最新化に失敗してもトークン内容で続行', !!t && t.school === '第一小学校', t && t.school);
  })();

  // ⑦ 認証できないときは need_auth を返す（黙って空配列を返さない）
  (function () {
    const ctx = buildApi({ verifyRes: { valid: false } });
    ['list', 'save', 'cancel', 'override'].forEach(function (k) {
      const r = ctx.__API[k]('bad.token', 'x', 'y');
      check('api_' + k + ' は未認証なら need_auth', !!r && r.success === false && r.need_auth === true, r);
    });
    check('未認証ではハンドラへ到達しない', ctx.__stash.calls.length === 0, ctx.__stash.calls.length);
  })();

  // ⑧ list: teacher.school が school_name に載り、teacher がそのまま渡る
  (function () {
    const ctx = buildApi({ verifyRes: { valid: true, teacher: TCH } });
    const r = ctx.__API.list('a.b', '');
    check('api_listSchedules はハンドラへ委譲する', r && r.src === 'list', r);
    check('api_listSchedules は school_name を所属校で補う',
      ctx.__stash.list && ctx.__stash.list.school_name === '第一小学校', ctx.__stash.list);
    check('api_listSchedules は解決済み teacher を渡す',
      ctx.__stash.calls[0] && ctx.__stash.calls[0].teacher && ctx.__stash.calls[0].teacher.email === 't@example.com');
  })();

  // ⑨ save: schoolName が補われ、token が載る
  (function () {
    const ctx = buildApi({ verifyRes: { valid: true, teacher: TCH } });
    const r = ctx.__API.save('a.b', { target_type: 'class', class_name: '5年1組' });
    check('api_saveSchedule はハンドラへ委譲する', r && r.src === 'save', r);
    check('api_saveSchedule は schoolName を所属校で補う',
      ctx.__stash.save && ctx.__stash.save.schoolName === '第一小学校', ctx.__stash.save);
    check('api_saveSchedule は token を載せる',
      ctx.__stash.save && ctx.__stash.save.token === 'a.b', ctx.__stash.save && ctx.__stash.save.token);
    check('api_saveSchedule は解決済み teacher を渡す',
      ctx.__stash.calls[0] && ctx.__stash.calls[0].teacher && ctx.__stash.calls[0].teacher.school === '第一小学校');
  })();

  // ⑩ save: 既に学校名が入っていれば上書きしない
  (function () {
    const ctx = buildApi({ verifyRes: { valid: true, teacher: TCH } });
    ctx.__API.save('a.b', { schoolName: '英田小学校' });
    check('api_saveSchedule は明示された学校名を尊重する',
      ctx.__stash.save && ctx.__stash.save.schoolName === '英田小学校', ctx.__stash.save);
  })();

  // ⑪ cancel / override: schedule_id を載せて委譲する
  (function () {
    const ctx = buildApi({ verifyRes: { valid: true, teacher: TCH } });
    const rc = ctx.__API.cancel('a.b', 'sch_1');
    const ro = ctx.__API.override('a.b', 'sch_2', 'manual');
    check('api_cancelSchedule はハンドラへ委譲する', rc && rc.src === 'cancel', rc);
    check('api_cancelSchedule は schedule_id を載せる',
      ctx.__stash.cancel && (ctx.__stash.cancel.schedule_id === 'sch_1' || ctx.__stash.cancel.id === 'sch_1'), ctx.__stash.cancel);
    check('api_overrideSchedule はハンドラへ委譲する', ro && ro.src === 'override', ro);
    check('api_overrideSchedule は schedule_id を載せる',
      ctx.__stash.override && (ctx.__stash.override.schedule_id === 'sch_2' || ctx.__stash.override.id === 'sch_2'), ctx.__stash.override);
  })();
}

// ================================================================ O. 保存の性能
//   実害: 「予約を登録」→「完了表示」までが数秒かかっていた。原因の 1 つが
//     書き込み直後の readScheduleRows_()（予約シート全読み）だった。
//     追加した行は obj にそのまま在るので読み直す必要が無い。
console.log('===== O. 保存の性能（全読み回帰） =====');
{
  const saveBody = extractFn('handleSaveSchedule_');
  // コメントは「説明」であって「呼び出し」ではない。
  //   （実装の意図を残すためコメントには関数名を書いているので、
  //     判定の前にコメントを落として“実際の呼び出し”だけを見る）
  const codeOnly = saveBody
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  check('保存時に予約シートを全読みしない', codeOnly.indexOf('readScheduleRows_') < 0,
    codeOnly.indexOf('readScheduleRows_'));
  check('保存時に appendScheduleRow_ で追記する', /appendScheduleRow_\s*\(/.test(codeOnly));
  check('保存時に保存行を自前で組み立てる（saved）', /var\s+saved\s*=|const\s+saved\s*=/.test(codeOnly));
  check('保存時に子GAS伝播を呼ぶ', codeOnly.indexOf('propagateScheduleToChildren_') >= 0);
  check('保存行は新規＝有効で作られる', /enabled\s*:\s*true/.test(codeOnly));
  check('保存行は新規＝未解除で作られる', /overridden\s*:\s*false/.test(codeOnly));
  // appendScheduleRow_ が書く条件付き列を、saved 側でも同じ条件で落としていること
  check('URL規制モードは url_block のときだけ載せる',
    /filterMode\s*:\s*isUrlBlock/.test(codeOnly) && /isUrlBlock\s*=\s*obj\.type\s*===\s*'url_block'/.test(codeOnly));
}


// ================================================================ P. URLリストの配列化
//   実害: シートの「許可URLリスト」「規制URLリスト」は 1 セルに
//     "youtube.com, game.example" の「文字列」で入っている。
//   一方、拡張機能側の normalizeHostList(list) は
//     if (!Array.isArray(list)) return [];
//   なので、GAS が文字列のまま配ると URL規制が端末で一切効かない。
//   ここでは 6 つの経路すべてが string[] を返すことを実測で確かめる。
console.log('===== P. URLリストの配列化（文字列 → string[]） =====');
{
  // 子GASが予約キャッシュを持つプロパティキー（製品コードと同じ値）
  const SHARD_PROP = 'SHARD_SCHEDULES_CACHE';
  const WL = 'allow.example, ok.example';
  const BL = 'youtube.com,game.example';
  const WL_ARR = ['allow.example', 'ok.example'];
  const BL_ARR = ['youtube.com', 'game.example'];

  // ---------------------------------------------------------- ① ヘルパー単体
  check('P1 normalizeHostListToArray_: カンマ区切り文字列を配列化',
    JSON.stringify(T.normalizeHostListToArray_(BL)) === JSON.stringify(BL_ARR),
    T.normalizeHostListToArray_(BL));
  check('P2 normalizeHostListToArray_: 改行区切りも配列化',
    JSON.stringify(T.normalizeHostListToArray_('a.example\nb.example')) === JSON.stringify(['a.example', 'b.example']));
  check('P3 normalizeHostListToArray_: 配列はそのまま（trim のみ）',
    JSON.stringify(T.normalizeHostListToArray_([' a.example ', 'b.example'])) === JSON.stringify(['a.example', 'b.example']));
  check('P4 normalizeHostListToArray_: null/undefined は空配列',
    T.normalizeHostListToArray_(null).length === 0 && T.normalizeHostListToArray_(undefined).length === 0);
  check('P5 normalizeHostListToArray_: 空文字は空配列', T.normalizeHostListToArray_('').length === 0);
  check('P6 normalizeHostListToArray_: 数値など非文字列は空配列', T.normalizeHostListToArray_(123).length === 0);
  check('P7 normalizeHostListToArray_: 空要素は落とす',
    JSON.stringify(T.normalizeHostListToArray_('a,,b,')) === JSON.stringify(['a', 'b']));
  check('P8 normalizeHostListToArray_: 大文字小文字は保持（表示用）',
    T.normalizeHostListToArray_('YouTube.com')[0] === 'YouTube.com', T.normalizeHostListToArray_('YouTube.com')[0]);
  check('P9 hostListToSheetString_: 配列を 1 セル文字列へ戻す',
    T.hostListToSheetString_(['a.example', 'b.example']) === 'a.example, b.example',
    T.hostListToSheetString_(['a.example', 'b.example']));
  check('P10 hostListToSheetString_: 空配列は空文字', T.hostListToSheetString_([]) === '');

  // シート保存 → 読み取りの往復で壊れないこと（1 セルに配列を入れない）
  (function () {
    const cell = T.hostListToSheetString_(BL_ARR);
    check('P11 往復: セル文字列 → 読み取りで元の配列に戻る',
      JSON.stringify(T.normalizeHostListToArray_(cell)) === JSON.stringify(BL_ARR), cell);
  })();

  // ---------------------------------------------------------- ② readScheduleRows_
  const SID = 'sch_arr01';
  const schSheet = sheets['スケジュール管理'];
  (function () {
    const map = T.getHeaderMap(schSheet, SCHEDULE_COLUMNS);
    const row = new Array(SCHEDULE_COLUMNS.length).fill('');
    const put = function (k, v) { const c = map[k]; if (c) row[c - 1] = v; };
    put('スケジュールID', SID);
    put('対象種別', 'class');
    put('学校名', '第一小学校');
    put('クラス名', '5年1組');
    put('制限タイプ', 'url_block');
    put('URL規制モード', 'BLACKLIST');
    put('許可URLリスト', WL);
    put('規制URLリスト', BL);
    put('開始日', '2026/11/10');
    put('終了日', '2026/11/14');
    put('繰り返し', 'NONE');
    put('開始時刻', '19:00');
    put('終了時刻', '21:00');
    put('有効', 'TRUE');
    put('手動解除', 'FALSE');
    schSheet._rows.push(row);
  })();

  const rowsP = T.readScheduleRows_();
  const rowP = rowsP.filter(function (r) { return r.id === SID; })[0];
  check('P12 readScheduleRows_: 行が読める', !!rowP, SID);
  check('P13 readScheduleRows_: whitelist が string[]',
    !!rowP && Array.isArray(rowP.whitelist) && JSON.stringify(rowP.whitelist) === JSON.stringify(WL_ARR),
    rowP && rowP.whitelist);
  check('P14 readScheduleRows_: blacklist が string[]',
    !!rowP && Array.isArray(rowP.blacklist) && JSON.stringify(rowP.blacklist) === JSON.stringify(BL_ARR),
    rowP && rowP.blacklist);

  // ---------------------------------------------------------- ③ scheduleRowToJson_
  if (rowP) {
    const j = T.scheduleRowToJson_(rowP, Date.UTC(2026, 10, 10, 10, 30));
    check('P15 scheduleRowToJson_: whitelist_urls が string[]',
      Array.isArray(j.whitelist_urls) && JSON.stringify(j.whitelist_urls) === JSON.stringify(WL_ARR), j.whitelist_urls);
    check('P16 scheduleRowToJson_: blacklist_urls が string[]',
      Array.isArray(j.blacklist_urls) && JSON.stringify(j.blacklist_urls) === JSON.stringify(BL_ARR), j.blacklist_urls);
  } else {
    check('P15 scheduleRowToJson_: whitelist_urls が string[]', false, 'row missing');
    check('P16 scheduleRowToJson_: blacklist_urls が string[]', false, 'row missing');
  }

  // ---------------------------------------------------------- ④⑤ 端末へ配る経路
  //   「文字列のまま」の行を渡しても、出口で必ず配列になること。
  const legacyRow = {
    rowIndex: 999, id: 'sch_legacy', targetType: 'class', schoolName: '第一小学校',
    className: '5年1組', studentIds: [], type: 'url_block', filterMode: 'BLACKLIST',
    whitelist: WL, blacklist: BL,               // ← 旧データを再現（文字列）
    dateFrom: '2026/11/10', dateTo: '2026/11/14', repeat: 'NONE',
    startTime: '19:00', endTime: '21:00', weekdaysRaw: '', enabled: true,
    overridden: false, overrideAt: '', createdBy: '', createdAt: '', updatedAt: '', note: ''
  };
  const NOW_IN = Date.UTC(2026, 10, 10, 10, 30); // 11/10 19:30 JST（窓の内側）

  const p4 = T.buildSchedulePayloadForDevice_('s1', '5年1組', '第一小学校', NOW_IN, [legacyRow]);
  check('P17 buildSchedulePayloadForDevice_: active に載る', p4.active.length === 1, p4.active.length);
  check('P18 buildSchedulePayloadForDevice_: whitelist が string[]',
    p4.active.length === 1 && Array.isArray(p4.active[0].whitelist) &&
    JSON.stringify(p4.active[0].whitelist) === JSON.stringify(WL_ARR),
    p4.active[0] && p4.active[0].whitelist);
  check('P19 buildSchedulePayloadForDevice_: blacklist が string[]',
    p4.active.length === 1 && Array.isArray(p4.active[0].blacklist) &&
    JSON.stringify(p4.active[0].blacklist) === JSON.stringify(BL_ARR),
    p4.active[0] && p4.active[0].blacklist);

  const p5 = T.shardBuildWindowsForStudent_([legacyRow], 's1', '5年1組', '第一小学校', NOW_IN);
  check('P20 shardBuildWindowsForStudent_: 窓を返す', p5.windows.length > 0, p5.windows.length);
  check('P21 shardBuildWindowsForStudent_: whitelist が string[]',
    p5.windows.length > 0 && Array.isArray(p5.windows[0].whitelist) &&
    JSON.stringify(p5.windows[0].whitelist) === JSON.stringify(WL_ARR),
    p5.windows[0] && p5.windows[0].whitelist);
  check('P22 shardBuildWindowsForStudent_: blacklist が string[]',
    p5.windows.length > 0 && Array.isArray(p5.windows[0].blacklist) &&
    JSON.stringify(p5.windows[0].blacklist) === JSON.stringify(BL_ARR),
    p5.windows[0] && p5.windows[0].blacklist);

  // 拡張機能の契約そのもの（Array.isArray でなければ捨てられる）を再現して確認
  function extNormalizeHostList(list) {
    if (!Array.isArray(list)) return [];
    return list.map(function (s) { return String(s).trim().toLowerCase(); })
      .filter(function (s) { return s.length > 0 && s.indexOf('*') < 0; });
  }
  check('P23 端末側 normalizeHostList が GAS の出力を受け付ける',
    extNormalizeHostList(p4.active[0] && p4.active[0].blacklist).length === 2,
    extNormalizeHostList(p4.active[0] && p4.active[0].blacklist));

  // ---------------------------------------------------------- ⑥ 子GASのキャッシュ経路
  //   旧バージョンのキャッシュ（文字列で保存された回）が残っていても救うこと。
  (function () {
    const vmMod = require('vm');
    const srcP = [
      'const SHEET_TZ_OFFSET_MS = 9 * 60 * 60 * 1000;',
      extractFn('normalizeHostListToArray_'),
      extractFn('hostListToSheetString_'),
      extractFn('emptySchedulePayload_'),
      extractFn('shardLoadScheduleCache_'),
      extractFn('shardSchedulePayloadFromCache_'),
      extractFn('schPad2_'), extractFn('schMsToJstStr_')
    ].join('\n');
    const legacyCache = {
      updated_ms: NOW_IN,
      by_student: {
        s1: {
          windows: [{
            id: 'sch_legacy', type: 'url_block', filter_mode: 'BLACKLIST',
            whitelist: WL, blacklist: BL,                 // ← 文字列で保存された旧キャッシュ
            start_ms: NOW_IN - 600000, end_ms: NOW_IN + 600000
          }],
          overridden_ids: []
        }
      }
    };
    const store = {};
    store[SHARD_PROP] = JSON.stringify(legacyCache);
    const sandbox = {
      CONFIG: JSON.parse(JSON.stringify(ctx.CONFIG || {})),
      SHARD_SCHEDULES_PROP: SHARD_PROP,
      SHARD_SCHEDULES_MEMO_SEC: 30,
      SHARD_SCHEDULES_MEMO_KEY: 'shard_sched_memo1',
      CacheService: {
        getScriptCache: function () {
          return { get: function () { return null; }, put: function () {}, remove: function () {} };
        }
      },
      PropertiesService: {
        getScriptProperties: function () {
          return { getProperty: function (k) { return store[k] || null; }, setProperty: function (k, v) { store[k] = v; } };
        }
      }
    };
    vmMod.createContext(sandbox);
    vmMod.runInContext(srcP + '\n__P = { fromCache: shardSchedulePayloadFromCache_ };', sandbox);
    const out = sandbox.__P.fromCache('s1', NOW_IN);
    check('P24 shardSchedulePayloadFromCache_: 旧キャッシュでも active に載る', out.active.length === 1, out.active.length);
    check('P25 shardSchedulePayloadFromCache_: whitelist が string[]',
      out.active.length === 1 && Array.isArray(out.active[0].whitelist) &&
      JSON.stringify(out.active[0].whitelist) === JSON.stringify(WL_ARR),
      out.active[0] && out.active[0].whitelist);
    check('P26 shardSchedulePayloadFromCache_: blacklist が string[]',
      out.active.length === 1 && Array.isArray(out.active[0].blacklist) &&
      JSON.stringify(out.active[0].blacklist) === JSON.stringify(BL_ARR),
      out.active[0] && out.active[0].blacklist);
  })();

  // ---------------------------------------------------------- ⑦ 端末一覧の出力部
  (function () {
    const vmMod = require('vm');
    const devCols = ['児童ID', '学校名', '氏名', 'クラス', '画面ロック', 'URL規制モード',
      '許可URLリスト', '規制URLリスト', '一斉表示URL', '一斉表示実行ID', '現在開いているURL',
      '最終同期日時', '備考', '画面情報要求日時', '画面情報更新日時'];
    const devSheet = makeSheet(devCols, [
      devCols.slice(),
      ['s1', '第一小学校', '第一 一郎', '5年1組', false, 'BLACKLIST', WL, BL, '', '', '', '', '', '', '']
    ]);
    const cfg = extractConst('CONFIG');
    const srcD = [
      cfg,
      extractFn('normalizeHostListToArray_'),
      extractFn('getHeaderMap'),
      extractFn('parseBoolean'),
      extractFn('sheetTsToMs'),
      extractFn('getAllDevices')
    ].join('\n');
    const sandbox = {
      CacheService: undefined,
      PropertiesService: undefined,
      LockService: { getScriptLock: function () { return { waitLock: function () {}, releaseLock: function () {} }; } },
      console: { log: function () {} },
      getTargetSheet: function () { return devSheet; },
      applyMonitorVisibility: function (r) { return r; },
      getTeacherScopeInfo: function () { return { type: 'admin', school: '' }; },
      getTeacherTargetClasses: function () { return []; },
      isClassInTeacherScope: function () { return true; },
      isAdminTeacher: function () { return true; },
      normalizeSchoolName: function (s) { return String(s || '').trim(); },
      schoolNamesMatch: function (a, b) { return String(a).trim() === String(b).trim(); },
      resolveCanonicalSchool: function (s) { return String(s || '').trim(); },
      isAllSchoolsName: function () { return false; },
      normalizeClassName: function (s) { return String(s || '').trim(); },
      invalidateDevicesCache: function () {},
      readScheduleRows_: function () { return []; },
      isAnyScheduleActive_: function () { return false; }
    };
    vmMod.createContext(sandbox);
    vmMod.runInContext(srcD + '\n__D = { all: getAllDevices };', sandbox);
    const list = sandbox.__D.all('ALL', { email: 'a@b.c', role: 'ADMIN', school: '全校管理' }, false);
    check('P27 getAllDevices: 1 件返る', list.length === 1, list.length);
    check('P28 getAllDevices: whitelist_urls が string[]',
      list.length === 1 && Array.isArray(list[0].whitelist_urls) &&
      JSON.stringify(list[0].whitelist_urls) === JSON.stringify(WL_ARR),
      list[0] && list[0].whitelist_urls);
    check('P29 getAllDevices: blacklist_urls が string[]',
      list.length === 1 && Array.isArray(list[0].blacklist_urls) &&
      JSON.stringify(list[0].blacklist_urls) === JSON.stringify(BL_ARR),
      list[0] && list[0].blacklist_urls);
  })();

  // ---------------------------------------------------------- ⑧ 書き込み側は文字列に戻す
  //   配列をそのままセルへ書くと、次回の読み取りが壊れる。
  check('P30 appendScheduleRow_: 配列をセル文字列へ戻す',
    /hostListToSheetString_\(obj\.whitelist\)/.test(extractFn('appendScheduleRow_')) &&
    /hostListToSheetString_\(obj\.blacklist\)/.test(extractFn('appendScheduleRow_')));

  // ---------------------------------------------------------- ⑨ 検証は .length で見る
  const vArr = T.validateScheduleInput_({
    target_type: 'class', school_name: '第一小学校', class_name: '5年1組',
    type: 'url_block', filter_mode: 'BLACKLIST', blacklist_urls: ['youtube.com'],
    date_from: '2026/11/10', date_to: '2026/11/14', repeat: 'WEEKLY', weekdays: '1,2,3,4,5',
    start_time: '19:00', end_time: '21:00'
  });
  check('P31 validateScheduleInput_: 配列入力を受け付ける', vArr.ok === true, vArr.errors);
  check('P32 validateScheduleInput_: norm は string[]',
    vArr.ok === true && Array.isArray(vArr.norm.blacklist) &&
    JSON.stringify(vArr.norm.blacklist) === JSON.stringify(['youtube.com']),
    vArr.ok && vArr.norm && vArr.norm.blacklist);
  // 空配列は truthy なので !norm.blacklist では弾けない（.length で判定する回帰）
  const vEmpty = T.validateScheduleInput_({
    target_type: 'class', school_name: '第一小学校', class_name: '5年1組',
    type: 'url_block', filter_mode: 'BLACKLIST', blacklist_urls: [],
    date_from: '2026/11/10', date_to: '2026/11/14', repeat: 'WEEKLY', weekdays: '1,2,3,4,5',
    start_time: '19:00', end_time: '21:00'
  });
  check('P33 validateScheduleInput_: 空配列の blacklist は弾く', vEmpty.ok === false, vEmpty.errors);
}


// ================================================================ Q. 伝播経路の静かな脱落
//   実害: 親の「選択日の予約」は有効に見え、子GASの実行ログも HTTP 200。
//         しかし子GASへは 1 件も送られておらず（sent: []）、端末で規制が効かない。
//   原因: shardPropagatePolicy の宛先解決で、端末のクラス表記が SHARD_MAP_V1 の
//         キーと一致せず、既定URLも未設定だと、その児童を「黙って」捨てていた。
//         1校=1子GAS（R41）でも同じ脱落が起きていた。
console.log('===== Q. 伝播経路（宛先解決とフォールバック） =====');
{
  const vmMod = require('vm');
  const CHAIN_FNS = [
    'normalizeClassName', 'normalizeShardClass', 'normalizeSchoolName', 'schoolNamesMatch',
    'schPad2_', 'schIsDate_', 'schJstParts_', 'scheduleDatePart_', 'scheduleTimePart_',
    'schedulePartsToMs_', 'schMsToJstStr_', 'schTimeOfDayMs_', 'parseWeekdays_',
    'schJstDateStr_', 'schJstDow_', 'sheetTsToMs', 'expandScheduleWindows_', 'parseBoolean',
    'normalizeHostListToArray_', 'hostListToSheetString_',
    'deviceMatchesSchedule_', 'shardBuildWindowsForStudent_', 'shardBuildScheduleByStudent_',
    'shardMapIndexFromMap', 'shardMapDefaultFromEmptyKey',
    'shardPropagatePolicy', 'propagateScheduleToChildren_'
  ];
  const chainSrc = ['const SHEET_TZ_OFFSET_MS = 9 * 60 * 60 * 1000;', 'const SHARD_ASYNC_ENABLED = false;']
    .concat([extractConst('CONFIG')])
    .concat(CHAIN_FNS.map(function (n) { return extractFn(n); }))
    .join('\n');

  const STUDENT_ROW = {
    rowIndex: 2, id: 'sch_q1', targetType: 'student', schoolName: '第一小学校', className: '',
    studentIds: ['s1'], type: 'screen_lock', filterMode: '', whitelist: [], blacklist: [],
    dateFrom: '2026/11/10', dateTo: '2026/11/10', repeat: 'NONE', startTime: '12:02', endTime: '12:03',
    weekdaysRaw: '', enabled: true, overridden: false, overrideAt: '',
    createdBy: 't@school.ed.jp', createdAt: '', updatedAt: '', note: ''
  };
  const CLASS_ROW = Object.assign({}, STUDENT_ROW, {
    id: 'sch_q2', targetType: 'class', className: '5年1組', studentIds: [],
    type: 'url_block', filterMode: 'BLACKLIST',
    whitelist: [], blacklist: ['youtube.com']
  });

  // 送信された payload を捕捉して、子GASへ何が渡ったかを実測する
  function runChain(o) {
    const sent = [];
    const warns = [];
    const sandbox = {
      __sent: sent, __warns: warns,
      console: { log: function () {} },
      Logger: { log: function (m) { warns.push(String(m)); } },
      isShardParent: function () { return true; },
      shardConfigCached: function () { return { map: o.map, sec: 'sk_test', def: o.def || '' }; },
      shardDeviceEntries: function () { return o.entries; },
      // 予約行は呼び出し側が明示しない限り「今回の 1 行」を返す
      //   （空配列を返すと schedules が同封されず、テストが無意味になる）
      readScheduleRows_: function () { return o.rows !== undefined ? o.rows : [o.row]; },
      shardFetchMany: function (reqs) {
        for (let i = 0; i < reqs.length; i++) sent.push(JSON.parse(reqs[i].payload));
        return reqs.map(function () {
          return { getResponseCode: function () { return 200; }, getContentText: function () { return '{"success":true}'; } };
        });
      },
      shardQueuePending: function () { return false; },
      shardWarnOnce: function (k, m) { warns.push(String(m)); },
      bulkTraceMark: function () {}
    };
    vmMod.createContext(sandbox);
    vmMod.runInContext(chainSrc + '\n__Q = { prop: propagateScheduleToChildren_ };', sandbox);
    return { res: sandbox.__Q.prop(o.row), sent: sent, warns: warns };
  }

  // 端末一覧のクラスは「5年1組」、SHARD_MAP_V1 のキーは「5-1」（実環境の表記）
  const ENTRIES = [['s1', '第一小学校', '5年1組']];

  // ① 個別指定（student）: 正規化が効いて宛先が解決する
  (function () {
    const r = runChain({ row: STUDENT_ROW, entries: ENTRIES, map: { '5-1': 'https://child1.example/exec' } });
    check('Q1 student: 子GASへ送信される（脱落しない）', r.sent.length === 1, r.sent.length);
    check('Q2 student: student_ids に対象児童が入る',
      r.sent.length === 1 && r.sent[0].student_ids[0] === 's1',
      r.sent[0] && r.sent[0].student_ids);
    check('Q3 student: schedules.by_student に児童が載る',
      r.sent.length === 1 && !!r.sent[0].schedules && !!r.sent[0].schedules.by_student.s1,
      r.sent[0] && r.sent[0].schedules && Object.keys(r.sent[0].schedules.by_student));
    check('Q4 student: 窓が数値の start_ms/end_ms を持つ（v1.6.4 の判定契約）',
      r.sent.length === 1 &&
      !!r.sent[0].schedules && !!r.sent[0].schedules.by_student.s1 &&
      Array.isArray(r.sent[0].schedules.by_student.s1.windows) &&
      r.sent[0].schedules.by_student.s1.windows.length > 0 && (function () {
        const w = r.sent[0].schedules.by_student.s1.windows[0];
        return !!w && typeof w.start_ms === 'number' && typeof w.end_ms === 'number' && w.end_ms > w.start_ms;
      })(), r.sent[0] && r.sent[0].schedules && r.sent[0].schedules.by_student);
  })();

  // ② クラス指定（class）: 同じく解決する
  (function () {
    const r = runChain({ row: CLASS_ROW, entries: ENTRIES, map: { '5-1': 'https://child1.example/exec' } });
    check('Q5 class: 子GASへ送信される', r.sent.length === 1, r.sent.length);
    check('Q6 class: blacklist が string[] で届く',
      r.sent.length === 1 && Array.isArray(r.sent[0].schedules.by_student.s1.windows[0].blacklist) &&
      r.sent[0].schedules.by_student.s1.windows[0].blacklist[0] === 'youtube.com',
      r.sent.length === 1 && r.sent[0].schedules.by_student.s1.windows[0].blacklist);
  })();

  // ③ 表記不一致＋子GASが1つだけ（R41: 1校=1子GAS）→ 唯一の子へフォールバック
  (function () {
    const r = runChain({ row: STUDENT_ROW, entries: ENTRIES, map: { '1-1': 'https://child1.example/exec' } });
    check('Q7 表記不一致でも唯一の子GASへフォールバックする', r.sent.length === 1, r.sent.length);
    check('Q8 フォールバック時も schedules が同封される',
      r.sent.length === 1 && !!r.sent[0].schedules && !!r.sent[0].schedules.by_student.s1,
      r.sent.length === 1 && r.sent[0].schedules && Object.keys(r.sent[0].schedules.by_student));
    check('Q9 フォールバックした事実をログに残す（静かに落とさない）',
      r.warns.some(function (m) { return m.indexOf('SHARD_MAP_V1') >= 0 && m.indexOf('フォールバック') >= 0; }),
      r.warns);
  })();

  // ④ 宛先が本当に無い（子GAS 2つ・どれも不一致・既定URLなし）→ 明示的に失敗を返す
  (function () {
    const r = runChain({
      row: STUDENT_ROW, entries: ENTRIES,
      map: { '1-1': 'https://childA.example/exec', '2-1': 'https://childB.example/exec' }
    });
    check('Q10 宛先不明は sent:[] のまま', r.sent.length === 0, r.sent.length);
    check('Q11 宛先不明は黙って成功にせず no_route を返す',
      !!r.res && r.res.reason === 'no_route' && r.res.dropped === 1, r.res);
    check('Q12 宛先不明はログにも残す', r.warns.length > 0, r.warns.length);
  })();

  // ⑤ 既定URLがあればそちらへ送る（従来動作の維持）
  (function () {
    const r = runChain({
      row: STUDENT_ROW, entries: ENTRIES,
      map: { '1-1': 'https://childA.example/exec' }, def: 'https://def.example/exec'
    });
    check('Q13 既定URLがあるときは既定URLへ送る',
      r.sent.length === 1 && r.res.sent[0].url === 'https://def.example/exec', r.res);
  })();

  // ⑥ 索引が「空配列」で固まってもシート読みへ落ちる（[] は truthy の罠）
  const propBody = extractFn('shardPropagatePolicy');
  check('Q14 空の索引([])でもシート読みへフォールバックする',
    /if\s*\(\s*!entries\s*\|\|\s*!entries\.length\s*\)/.test(propBody));
  check('Q15 宛先解決に unique子GAS フォールバックが入っている',
    /singleChildUrl/.test(propBody) && /idxKeys\.length === 1/.test(propBody));
}

console.log('');
console.log('===== 結果: PASS=' + pass + ' FAIL=' + fail + ' =====');
process.exit(fail > 0 ? 1 : 0);
