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
  // --- スケジュール中核 ---
  'deviceMatchesSchedule_', 'readScheduleRows_', 'isAnyScheduleActive_',
  // --- CRUD ---
  'schNowJstSec_', 'generateScheduleId_', 'validateScheduleInput_',
  'authorizeScheduleTarget_', 'appendScheduleRow_', 'updateScheduleCells_',
  'isScheduleRowInTeacherScope_', 'scheduleRowToJson_',
  'handleSaveSchedule_', 'handleListSchedules_', 'handleCancelSchedule_', 'handleOverrideSchedule_'
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

console.log('');
console.log('===== 結果: PASS=' + pass + ' FAIL=' + fail + ' =====');
process.exit(fail > 0 ? 1 : 0);
