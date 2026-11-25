// ============================================================================
// r47_schedule_advanced.js — Request P の3機能の回帰テスト
//
//   1) 予約実行中バッジ（端末一覧）
//        GAS が schedule_active / schedule_active_label / _count / _ids を返し、
//        単一GAS（予約シート）と R41 子GAS（親から配られたキャッシュ）の
//        両方で同じ判定になること。
//   2) 複数クラス＋全校生徒
//        クラスは既存の単一「クラス名」セルにカンマ区切りで入る（列追加なし）。
//        全校生徒は自校のみ（他校越境は forbidden）。
//        対象クラスが限定された教員は全校生徒を予約できない。
//   3) 予約編集（update_schedule）
//        schedule_id を維持して行を書き換える。
//        有効/手動解除/手動解除日時（16/17/18）と 作成者/作成日時（19/20）は不変。
//        更新日時（21）は必ず更新される。
//
//   設計不変条件（壊していないことの確認）
//       ・version 1.6.5 / default_popup なし / DEFAULT_GAS_URL ''
//       ・14校（東粟倉小学校なし）／ シートへのテレメトリ書き戻しなし
// ============================================================================
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
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const gasSrc = fs.readFileSync(path.join(ROOT, 'gas/Code.gs'), 'utf8');
const htmlSrc = fs.readFileSync(path.join(ROOT, 'gas/index.html'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension/manifest.json'), 'utf8'));

let pass = 0, fail = 0;
/** run_all.sh は出力中の literal な "Error:" を失敗とみなすため置換する。 */
function sanitize(v) {
  return String(v).replace(/Error:/g, 'Error-').replace(/\n/g, ' ');
}
function check(name, cond, extra) {
  if (cond) { pass++; console.log('PASS ' + name + (extra !== undefined ? ' => ' + sanitize(extra) : '')); }
  else { fail++; console.log('FAIL ' + name + (extra !== undefined ? ' => ' + sanitize(extra) : '')); }
}
const ok = check;

// ---------------------------------------------------------------- 抽出ヘルパ
function extractFn(src, name) {
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
function extractConst(src, name) {
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

// ---------------------------------------------------------------- 固定時計
//   expandScheduleWindows_ は実時刻で窓を切り詰めるため、フィクスチャの
//   2026/11/10 19:00 JST に固定する（実行日で静かに壊れないように）。
const PINNED_NOW_MS = Date.UTC(2026, 10, 10, 10, 0, 0); // 2026/11/10 19:00 JST
function makePinnedDate(pinnedMs) {
  const PIN = pinnedMs;
  class PinnedDate extends Date {
    constructor(...args) { if (args.length === 0) super(PIN); else super(...args); }
    static now() { return PIN; }
  }
  return PinnedDate;
}

// ---------------------------------------------------------------- 疑似シート
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
        setBackground() { return this; }, setFontColor() { return this; },
        setFontWeight() { return this; }, setNumberFormat() { return this; }
      };
    },
    getDataRange() {
      const self = this;
      return { getValues() { return self._rows.map(function (r) { return r.slice(); }); } };
    },
    appendRow(row) { this._writes++; this._rows.push(row.slice()); },
    insertSheet() { return this; }, setFrozenRows() {},
    getSheetName() { return 'sheet'; }
  };
}

const CONFIG_SRC = extractConst(gasSrc, 'CONFIG');
const SCHEDULE_COLUMNS = JSON.parse(JSON.stringify(
  (function () {
    const m = gasSrc.match(/SCHEDULE_COLUMNS:\s*\[([\s\S]*?)\n\s*\],/);
    if (!m) throw new Error('SCHEDULE_COLUMNS not found');
    return m[1].split('\n')
      .map(function (l) { return l.replace(/\/\/.*$/, '').trim(); })
      .filter(function (l) { return /^'/.test(l); })
      .map(function (l) { return l.replace(/^'/, '').replace(/',?$/, ''); });
  })()
));

const DEVICE_COLUMNS = ['児童ID', '学校名', '氏名', 'クラス', '画面ロック', 'URL規制モード',
  '許可URLリスト', '規制URLリスト', '一斉表示URL', '一斉表示実行ID', '現在開いているURL',
  '最終同期日時', '備考', '画面情報要求日時', '画面情報更新日時'];

/**
 * GAS のミニVMを組み立てる。
 *   opts.schedRows  … 予約シートの行（ヘッダーなし）
 *   opts.devRows    … 端末一覧の行（ヘッダーなし）
 *   opts.isParent   … propagateScheduleToChildren_ を親として動かすか
 *   opts.onPropagate… shardPropagatePolicy のスタブ（呼ばれた ids を記録する）
 */
function buildGas(opts) {
  opts = opts || {};
  const schRows = (opts.schedRows || []).map(function (r) { return r.slice(); });
  const devRows = (opts.devRows || []).map(function (r) { return r.slice(); });

  const sheets = {};
  sheets['端末一覧'] = makeSheet(DEVICE_COLUMNS, [DEVICE_COLUMNS.slice()].concat(devRows));
  sheets['スケジュール管理'] = makeSheet(
    SCHEDULE_COLUMNS, [SCHEDULE_COLUMNS.slice()].concat(schRows));

  const FNS = [
    'getHeaderMap',
    'schPad2_', 'schIsDate_', 'schJstParts_', 'scheduleDatePart_', 'scheduleTimePart_',
    'schedulePartsToMs_', 'schMsToJstStr_', 'schTimeOfDayMs_', 'parseWeekdays_',
    'schJstDateStr_', 'schJstDow_', 'sheetTsToMs', 'expandScheduleWindows_',
    'normalizeSchoolName', 'schoolNamesMatch', 'resolveCanonicalSchool',
    'isAllSchoolsName', 'normalizeClassName', 'isAdminTeacher',
    'getTeacherScopeInfo', 'getTeacherTargetClasses', 'isClassInTeacherScope',
    'scopeStudentIdsForTeacher', 'parseBoolean',
    'normalizeHostListToArray_', 'hostListToSheetString_',
    'normalizeIdKey', 'normalizeUserLocalPart_', 'idKeysMatch_', 'idMatchesAny_',
    // Request P の中核ヘルパ
    'scheduleClassList_', 'scheduleActiveLabel_', 'scheduleTargetLabel_',
    'scheduleActiveDetail_', 'isAnyScheduleActive_', 'scheduleActiveDetailFromCache_',
    'deviceMatchesSchedule_', 'readScheduleRows_',
    'schNowJstSec_', 'generateScheduleId_', 'validateScheduleInput_',
    'authorizeScheduleTarget_', 'appendScheduleRow_', 'updateScheduleCells_',
    'isScheduleRowInTeacherScope_', 'scheduleRowToJson_',
    'buildSchedulePayloadForDevice_', 'shardBuildWindowsForStudent_',
    'handleSaveSchedule_', 'handleListSchedules_', 'handleCancelSchedule_',
    'handleOverrideSchedule_', 'handleUpdateSchedule_',
    'propagateScheduleToChildren_'
  ];

  const pieces = [CONFIG_SRC, 'const SHEET_TZ_OFFSET_MS = 9 * 60 * 60 * 1000;'];
  pieces.push(extractConst(gasSrc, 'SCH_MONTHS_'));
  try { pieces.push(extractConst(gasSrc, 'SCHOOL_ALIASES')); }
  catch (e) { pieces.push('const SCHOOL_ALIASES = {};'); }
  FNS.forEach(function (n) { pieces.push(extractFn(gasSrc, n)); });

  pieces.push('function getTargetSheet(name){ var s = __SHEETS[name]; if(!s) return null; return s; }');
  pieces.push([
    'function ensureScheduleHeaders(sheet){',
    '  if (sheet.getLastColumn() === 0) {',
    '    sheet._cols = CONFIG.SCHEDULE_COLUMNS.slice();',
    '    return;',
    '  }',
    '}'
  ].join('\n'));
  pieces.push('function withWriteLock(fn){ return fn(); }');
  pieces.push('function invalidateDevicesCache(){}');
  pieces.push('function isShardParent(){ return ' + (opts.isParent ? 'true' : 'false') + '; }');
  pieces.push('function shardDeviceEntries(){ return ' +
    JSON.stringify(opts.entries || null) + '; }');
  pieces.push('function shardPropagatePolicy(ids, patch, force){ ' +
    '__PROPAGATED.push({ ids: ids.slice(), patch: patch, force: force }); ' +
    'return { ok: true, count: ids.length }; }');

  // Logger は Node 側で定義する関数のため、サンドボックスの変数（__LOGS）は見えない。
  //   クロージャの配列に貯めて、あとから参照する。
  const logSink = [];
  const ctx = vm.createContext({
    console: { log: function () {} },
    Logger: { log: function (m) { logSink.push(String(m)); } },
    Date: makePinnedDate(PINNED_NOW_MS),
    LockService: { getScriptLock: function () { return { waitLock: function () {}, releaseLock: function () {} }; } },
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
  ctx.__SHEETS = sheets;
  ctx.__PROPAGATED = [];

  pieces.push('globalThis.__T = { CONFIG: CONFIG, SHEETS: __SHEETS, ' +
    'PROPAGATED: __PROPAGATED, ' + FNS.join(', ') + ' };');

  vm.runInContext(pieces.join('\n\n'), ctx, { filename: 'r47_gas_vm.js' });
  const T = ctx.__T;
  T.__sheets = sheets;
  T.__logs = logSink;
  return T;
}

function colIndex(name) { return SCHEDULE_COLUMNS.indexOf(name) + 1; }
function cellOf(sheet, rowIndex, name) {
  const c = colIndex(name);
  if (c <= 0) return undefined;
  return (sheet._rows[rowIndex - 1] || [])[c - 1];
}

const admin = { email: 'admin@school.ed.jp', name: '管理者', school: '全校管理', role: 'ADMIN', target_class: '全クラス' };
const tDaiichi = { email: 't1@school.ed.jp', name: '第一小', school: '第一小学校', role: 'TEACHER', target_class: '5年1組' };
const tAida = { email: 't2@school.ed.jp', name: '英田小', school: '英田小学校', role: 'TEACHER', target_class: '5年1組' };
// 対象クラス制限のない（校内すべてを見られる）教員
const tDaiichiAll = { email: 't3@school.ed.jp', name: '第一小(全クラス)', school: '第一小学校', role: 'TEACHER', target_class: '' };

const DEV_ROWS = [
  ['s1', '第一小学校', '第一 一郎', '5年1組', false, 'OFF', '', '', '', '', '', '', '', '', ''],
  ['s2', '第一小学校', '第一 二郎', '5年2組', false, 'OFF', '', '', '', '', '', '', '', '', ''],
  ['s3', '第一小学校', '第一 三郎', '6年1組', false, 'OFF', '', '', '', '', '', '', '', '', ''],
  ['s4', '英田小学校', '英田 四郎', '5年1組', false, 'OFF', '', '', '', '', '', '', '', '', '']
];

// ============================================================================
// A. 【機能2】複数クラス（カンマ区切り1セル・列追加なし）
// ============================================================================
console.log('===== A. 複数クラス（既存の単一セルにカンマ区切り） =====');
{
  const T = buildGas({ devRows: DEV_ROWS });

  // A-1 ヘルパ: 分割規則
  check('A-1 scheduleClassList_: カンマ分割',
    JSON.stringify(T.scheduleClassList_('5年1組,5年2組')) === JSON.stringify(['5年1組', '5年2組']),
    T.scheduleClassList_('5年1組,5年2組'));
  check('A-2 scheduleClassList_: 読点・スラッシュ・中黒も分割',
    JSON.stringify(T.scheduleClassList_('5年1組、5年2組／6年1組・6年2組')) ===
    JSON.stringify(['5年1組', '5年2組', '6年1組', '6年2組']),
    T.scheduleClassList_('5年1組、5年2組／6年1組・6年2組'));
  check('A-3 scheduleClassList_: 単一クラスは従来どおり',
    JSON.stringify(T.scheduleClassList_('5年1組')) === JSON.stringify(['5年1組']));
  check('A-4 scheduleClassList_: 空は空配列',
    T.scheduleClassList_('').length === 0 && T.scheduleClassList_(null).length === 0);
  check('A-5 scheduleClassList_: 配列もそのまま受ける',
    JSON.stringify(T.scheduleClassList_(['5年1組', ' 5年2組 '])) ===
    JSON.stringify(['5年1組', '5年2組']));

  // A-6 保存: class_names 配列で2クラス → 1セルにカンマ区切り
  const r = T.handleSaveSchedule_({
    target_type: 'class', school_name: '第一小学校',
    class_names: ['5年1組', '5年2組'],
    type: 'url_block', filter_mode: 'BLACKLIST', blacklist_urls: 'youtube.com',
    date_from: '2026/11/10', date_to: '2026/11/10', repeat: 'NONE',
    start_time: '19:00', end_time: '21:00', note: '複数クラス'
  }, admin);
  check('A-6 複数クラスを保存できる', r.success === true, r.error);
  check('A-7 応答の class_name はカンマ区切り',
    r.schedule && r.schedule.class_name === '5年1組,5年2組',
    r.schedule && r.schedule.class_name);
  check('A-8 応答の target_label は「・」区切り',
    r.schedule && r.schedule.target_label === '5年1組・5年2組',
    r.schedule && r.schedule.target_label);
  check('A-9 応答の class_list は配列',
    r.schedule && JSON.stringify(r.schedule.class_list) === JSON.stringify(['5年1組', '5年2組']),
    r.schedule && r.schedule.class_list);

  // A-10 シート上も 1 セル（列は増えない）
  const sheet = T.__sheets['スケジュール管理'];
  check('A-10 シートの列数は変わらない（22列のまま）',
    sheet._cols.length === 22, sheet._cols.length);
  // cellOf は「シート行番号（1始まり）」を受ける。appendRow 後は末尾行がそのまま行番号。
  const savedRowIdx = sheet._rows.length;
  check('A-11 シートのクラス名セルにカンマ区切りで1セル保存',
    cellOf(sheet, savedRowIdx, 'クラス名') === '5年1組,5年2組',
    cellOf(sheet, savedRowIdx, 'クラス名'));

  // A-12 読み戻し（list）で分割できる
  const L = T.handleListSchedules_({}, admin);
  const listed = (L.data || []).filter(function (x) { return x.id === (r.schedule && r.schedule.id); })[0];
  check('A-12 list が target_label を返す',
    listed && listed.target_label === '5年1組・5年2組', listed && listed.target_label);
  check('A-13 list が class_list を配列で返す',
    listed && Array.isArray(listed.class_list) && listed.class_list.length === 2,
    listed && listed.class_list);

  // A-14 権限: 2クラスのうち片方だけ権限内なら拒否（全件検査）
  const ng = T.handleSaveSchedule_({
    target_type: 'class', school_name: '第一小学校',
    class_names: ['5年1組', '6年1組'],
    type: 'url_block', filter_mode: 'BLACKLIST', blacklist_urls: 'youtube.com',
    date_from: '2026/11/10', date_to: '2026/11/10', repeat: 'NONE',
    start_time: '19:00', end_time: '21:00'
  }, tDaiichi);
  check('A-14 権限外クラスが混ざると拒否（全件検査）',
    ng.success === false && ng.error_code === 'forbidden', ng.error);

  // A-15 権限: 権限内だけの複数クラスは通る
  const okc = T.handleSaveSchedule_({
    target_type: 'class', school_name: '第一小学校',
    class_names: ['5年1組'],
    type: 'url_block', filter_mode: 'BLACKLIST', blacklist_urls: 'youtube.com',
    date_from: '2026/11/10', date_to: '2026/11/10', repeat: 'NONE',
    start_time: '19:00', end_time: '21:00'
  }, tDaiichi);
  check('A-15 権限内クラスは複数指定でも通る', okc.success === true, okc.error);

  // A-16 不正入力: クラス名が空なら拒否
  const empty = T.handleSaveSchedule_({
    target_type: 'class', school_name: '第一小学校', class_names: [],
    type: 'url_block', filter_mode: 'BLACKLIST', blacklist_urls: 'youtube.com',
    date_from: '2026/11/10', date_to: '2026/11/10', repeat: 'NONE',
    start_time: '19:00', end_time: '21:00'
  }, admin);
  check('A-16 クラス名が空なら拒否（不正入力拒否を維持）',
    empty.success === false && empty.error_code === 'validation_failed', empty.error);

  // A-17 端末判定: 複数クラスのどちらに属しても一致する
  const mrow = {
    id: 'sch_multi', targetType: 'class', schoolName: '第一小学校',
    className: '5年1組,5年2組', studentIds: [], type: 'url_block',
    enabled: true, overridden: false
  };
  check('A-17 deviceMatches: 1つ目のクラスは一致',
    T.deviceMatchesSchedule_(mrow, 's1', T.normalizeClassName('5年1組'), '第一小学校') === true);
  check('A-18 deviceMatches: 2つ目のクラスも一致',
    T.deviceMatchesSchedule_(mrow, 's2', T.normalizeClassName('5年2組'), '第一小学校') === true);
  check('A-19 deviceMatches: 含まれないクラスは不一致',
    T.deviceMatchesSchedule_(mrow, 's3', T.normalizeClassName('6年1組'), '第一小学校') === false);
  check('A-20 deviceMatches: 他校は不一致（越境しない）',
    T.deviceMatchesSchedule_(mrow, 's4', T.normalizeClassName('5年1組'), '英田小学校') === false);
}

// ============================================================================
// B. 【機能2】全校生徒（school）
// ============================================================================
console.log('===== B. 全校生徒（school） =====');
{
  const T = buildGas({ devRows: DEV_ROWS });

  // B-1 管理者は全校生徒を予約できる
  const rAdmin = T.handleSaveSchedule_({
    target_type: 'school', school_name: '第一小学校',
    type: 'screen_lock',
    date_from: '2026/11/10', date_to: '2026/11/10', repeat: 'NONE',
    start_time: '19:00', end_time: '21:00', note: '全校一斉'
  }, admin);
  check('B-1 管理者は全校生徒を予約できる', rAdmin.success === true, rAdmin.error);
  check('B-2 全校生徒の target_label は「全校生徒」',
    rAdmin.schedule && rAdmin.schedule.target_label === '全校生徒',
    rAdmin.schedule && rAdmin.schedule.target_label);
  check('B-3 全校生徒ではクラス名が空',
    rAdmin.schedule && rAdmin.schedule.class_name === '',
    rAdmin.schedule && rAdmin.schedule.class_name);

  // B-4 自校の教員（クラス制限なし）は自校全体を予約できる
  const rOwn = T.handleSaveSchedule_({
    target_type: 'school', school_name: '第一小学校',
    type: 'screen_lock',
    date_from: '2026/11/10', date_to: '2026/11/10', repeat: 'NONE',
    start_time: '19:00', end_time: '21:00'
  }, tDaiichiAll);
  check('B-4 自校の教員は自校の全校生徒を予約できる', rOwn.success === true, rOwn.error);

  // B-5 他校の全校生徒は越境できない（must keep）
  const rCross = T.handleSaveSchedule_({
    target_type: 'school', school_name: '英田小学校',
    type: 'screen_lock',
    date_from: '2026/11/10', date_to: '2026/11/10', repeat: 'NONE',
    start_time: '19:00', end_time: '21:00'
  }, tDaiichiAll);
  check('B-5 他校の全校生徒は越境できない（forbidden）',
    rCross.success === false && rCross.error_code === 'forbidden', rCross.error);

  // B-6 対象クラス限定の教員は全校生徒を作れない
  const rRestricted = T.handleSaveSchedule_({
    target_type: 'school', school_name: '第一小学校',
    type: 'screen_lock',
    date_from: '2026/11/10', date_to: '2026/11/10', repeat: 'NONE',
    start_time: '19:00', end_time: '21:00'
  }, tDaiichi);
  check('B-6 対象クラス限定の教員は全校生徒を予約できない',
    rRestricted.success === false && rRestricted.error_code === 'forbidden', rRestricted.error);

  // B-7 対象種別の不正値は拒否（既存の検証を維持）
  const rBad = T.handleSaveSchedule_({
    target_type: 'grade', school_name: '第一小学校',
    type: 'screen_lock',
    date_from: '2026/11/10', date_to: '2026/11/10', repeat: 'NONE',
    start_time: '19:00', end_time: '21:00'
  }, admin);
  check('B-7 未知の対象種別は拒否（不正入力拒否を維持）',
    rBad.success === false && rBad.error_code === 'validation_failed', rBad.error);

  // B-8 端末判定: 同じ学校なら一致／他校は不一致
  const srow = {
    id: 'sch_school', targetType: 'school', schoolName: '第一小学校',
    className: '', studentIds: [], type: 'screen_lock', enabled: true, overridden: false
  };
  check('B-8 deviceMatches: 同校の児童は一致',
    T.deviceMatchesSchedule_(srow, 's1', T.normalizeClassName('5年1組'), '第一小学校') === true);
  check('B-9 deviceMatches: 同校の別クラスも一致',
    T.deviceMatchesSchedule_(srow, 's3', T.normalizeClassName('6年1組'), '第一小学校') === true);
  check('B-10 deviceMatches: 他校は不一致（越境しない）',
    T.deviceMatchesSchedule_(srow, 's4', T.normalizeClassName('5年1組'), '英田小学校') === false);
}

// ============================================================================
// C. 【機能3】予約編集（update_schedule）
// ============================================================================
console.log('===== C. 予約編集（update_schedule） =====');
{
  // 既存予約行を1件用意する（有効/手動解除/作成者/作成日時 を埋めておく）
  const baseRow = [];
  for (let i = 0; i < SCHEDULE_COLUMNS.length; i++) baseRow.push('');
  function setCol(row, name, v) {
    const c = colIndex(name);
    if (c > 0) row[c - 1] = v;
  }
  setCol(baseRow, 'スケジュールID', 'sch_edit_1');
  setCol(baseRow, '対象種別', 'class');
  setCol(baseRow, '学校名', '第一小学校');
  setCol(baseRow, 'クラス名', '5年1組');
  setCol(baseRow, '児童ID', '');
  setCol(baseRow, '制限タイプ', 'url_block');
  setCol(baseRow, 'URL規制モード', 'BLACKLIST');
  setCol(baseRow, '規制URLリスト', 'youtube.com');
  setCol(baseRow, '開始日', '2026/11/10');
  setCol(baseRow, '終了日', '2026/11/10');
  setCol(baseRow, '繰り返し', 'NONE');
  setCol(baseRow, '開始時刻', '19:00');
  setCol(baseRow, '終了時刻', '21:00');
  setCol(baseRow, '曜日', '');
  setCol(baseRow, '有効', true);
  setCol(baseRow, '手動解除', true);              // 17
  setCol(baseRow, '手動解除日時', '2026/11/05 10:00:00'); // 18
  setCol(baseRow, '作成者', 'original@school.ed.jp'); // 19
  setCol(baseRow, '作成日時', '2026/11/01 09:00:00');  // 20
  setCol(baseRow, '更新日時', '2026/11/01 09:00:00');  // 21
  setCol(baseRow, '備考', '元の備考');

  const T = buildGas({ devRows: DEV_ROWS, schedRows: [baseRow] });
  const sheet = T.__sheets['スケジュール管理'];
  const ROW_IDX = 2; // ヘッダーが 1 行目

  const upd = T.handleUpdateSchedule_({
    schedule_id: 'sch_edit_1',
    note: '編集後の備考'
  }, admin);

  check('C-1 編集は成功する', upd.success === true, upd.error);
  check('C-2 予約IDは維持される（新規採番しない）',
    upd.schedule && upd.schedule.id === 'sch_edit_1', upd.schedule && upd.schedule.id);
  check('C-3 行は増えない（書き換えのみ）', sheet._rows.length === 2, sheet._rows.length);
  check('C-4 備考が更新される', cellOf(sheet, ROW_IDX, '備考') === '編集後の備考',
    cellOf(sheet, ROW_IDX, '備考'));
  check('C-5 更新日時が更新される（21列目）',
    String(cellOf(sheet, ROW_IDX, '更新日時')) !== '2026/11/01 09:00:00' &&
    /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/.test(String(cellOf(sheet, ROW_IDX, '更新日時'))),
    cellOf(sheet, ROW_IDX, '更新日時'));

  // 触れてはいけない列（16/17/18/19/20）
  check('C-6 有効(16)は不変',
    String(cellOf(sheet, ROW_IDX, '有効')) === 'true' ||
    cellOf(sheet, ROW_IDX, '有効') === true, cellOf(sheet, ROW_IDX, '有効'));
  check('C-7 手動解除(17)は不変',
    String(cellOf(sheet, ROW_IDX, '手動解除')) === 'true' ||
    cellOf(sheet, ROW_IDX, '手動解除') === true, cellOf(sheet, ROW_IDX, '手動解除'));
  check('C-8 手動解除日時(18)は不変',
    cellOf(sheet, ROW_IDX, '手動解除日時') === '2026/11/05 10:00:00',
    cellOf(sheet, ROW_IDX, '手動解除日時'));
  check('C-9 作成者(19)は不変',
    cellOf(sheet, ROW_IDX, '作成者') === 'original@school.ed.jp',
    cellOf(sheet, ROW_IDX, '作成者'));
  check('C-10 作成日時(20)は不変',
    cellOf(sheet, ROW_IDX, '作成日時') === '2026/11/01 09:00:00',
    cellOf(sheet, ROW_IDX, '作成日時'));

  // 対象の変更（複数クラスへ）
  const upd2 = T.handleUpdateSchedule_({
    schedule_id: 'sch_edit_1',
    class_names: ['5年1組', '5年2組']
  }, admin);
  check('C-11 対象を複数クラスへ変更できる', upd2.success === true, upd2.error);
  check('C-12 変更後もクラス名は1セルにカンマ区切り',
    cellOf(sheet, ROW_IDX, 'クラス名') === '5年1組,5年2組',
    cellOf(sheet, ROW_IDX, 'クラス名'));

  // 全校生徒へ変更
  const upd3 = T.handleUpdateSchedule_({
    schedule_id: 'sch_edit_1',
    target_type: 'school'
  }, admin);
  check('C-13 対象を全校生徒へ変更できる', upd3.success === true, upd3.error);
  check('C-14 全校生徒ではクラス名が空になる',
    cellOf(sheet, ROW_IDX, 'クラス名') === '', cellOf(sheet, ROW_IDX, 'クラス名'));
  check('C-15 対象種別が school になる',
    cellOf(sheet, ROW_IDX, '対象種別') === 'school', cellOf(sheet, ROW_IDX, '対象種別'));

  // 存在しないID
  const nf = T.handleUpdateSchedule_({ schedule_id: 'sch_nope' }, admin);
  check('C-16 存在しない予約IDは not_found',
    nf.success === false && nf.error_code === 'not_found', nf.error);

  // ID 未指定
  const noId = T.handleUpdateSchedule_({}, admin);
  check('C-17 予約ID未指定は validation_failed',
    noId.success === false && noId.error_code === 'validation_failed', noId.error);

  // 不正入力（0分予約）は拒否
  const bad = T.handleUpdateSchedule_({
    schedule_id: 'sch_edit_1', start_time: '19:00', end_time: '19:00'
  }, admin);
  check('C-18 0分予約への変更は拒否（不正入力拒否を維持）',
    bad.success === false && bad.error_code === 'validation_failed', bad.error);
}

// ============================================================================
// D. 編集の権限（他校の予約は編集できない）
// ============================================================================
console.log('===== D. 編集の権限境界 =====');
{
  const row = [];
  for (let i = 0; i < SCHEDULE_COLUMNS.length; i++) row.push('');
  function setCol(r, name, v) { const c = colIndex(name); if (c > 0) r[c - 1] = v; }
  setCol(row, 'スケジュールID', 'sch_aida_1');
  setCol(row, '対象種別', 'class');
  setCol(row, '学校名', '英田小学校');
  setCol(row, 'クラス名', '5年1組');
  setCol(row, '制限タイプ', 'url_block');
  setCol(row, 'URL規制モード', 'BLACKLIST');
  setCol(row, '規制URLリスト', 'youtube.com');
  setCol(row, '開始日', '2026/11/10');
  setCol(row, '終了日', '2026/11/10');
  setCol(row, '繰り返し', 'NONE');
  setCol(row, '開始時刻', '19:00');
  setCol(row, '終了時刻', '21:00');
  setCol(row, '有効', true);
  setCol(row, '作成者', 'aida@school.ed.jp');
  setCol(row, '作成日時', '2026/11/01 09:00:00');

  const T = buildGas({ devRows: DEV_ROWS, schedRows: [row] });

  const cross = T.handleUpdateSchedule_({ schedule_id: 'sch_aida_1', note: 'x' }, tDaiichi);
  check('D-1 他校の予約は編集できない（forbidden）',
    cross.success === false && cross.error_code === 'forbidden', cross.error);

  const own = T.handleUpdateSchedule_({ schedule_id: 'sch_aida_1', note: 'x' }, tAida);
  check('D-2 自校の教員は編集できる', own.success === true, own.error);
}

// ============================================================================
// E. 【機能1】予約実行中バッジ（単一GAS: 予約シートを直接判定）
// ============================================================================
console.log('===== E. 予約実行中バッジ（単一GAS） =====');
{
  // 19:00-21:00 の予約が「いま(19:00)」効いている状態を作る
  function mkRow(id, cls, note, type) {
    const row = [];
    for (let i = 0; i < SCHEDULE_COLUMNS.length; i++) row.push('');
    const set = function (n, v) { const c = colIndex(n); if (c > 0) row[c - 1] = v; };
    set('スケジュールID', id);
    set('対象種別', 'class');
    set('学校名', '第一小学校');
    set('クラス名', cls);
    set('制限タイプ', type || 'url_block');
    set('URL規制モード', 'BLACKLIST');
    set('規制URLリスト', 'youtube.com');
    set('開始日', '2026/11/10');
    set('終了日', '2026/11/10');
    set('繰り返し', 'NONE');
    set('開始時刻', '18:00');
    set('終了時刻', '21:00');
    set('有効', true);
    set('備考', note);
    return row;
  }

  const T = buildGas({
    devRows: DEV_ROWS,
    schedRows: [mkRow('sch_active_1', '5年1組', '家庭学習の時間帯')]
  });

  const d1 = T.scheduleActiveDetail_(
    T.readScheduleRows_(), 's1', T.normalizeClassName('5年1組'), '第一小学校', PINNED_NOW_MS);
  check('E-1 時間内なら active=true', d1.active === true, d1.active);
  check('E-2 件数を返す', d1.count === 1, d1.count);
  check('E-3 予約IDを返す', JSON.stringify(d1.ids) === JSON.stringify(['sch_active_1']), d1.ids);
  check('E-4 表示名は備考を優先', d1.label === '家庭学習の時間帯', d1.label);

  // 対象外のクラスは false
  const d2 = T.scheduleActiveDetail_(
    T.readScheduleRows_(), 's3', T.normalizeClassName('6年1組'), '第一小学校', PINNED_NOW_MS);
  check('E-5 対象外クラスは active=false', d2.active === false, d2.active);

  // 時間外（予約前）は false
  const beforeMs = Date.UTC(2026, 10, 10, 8, 0, 0); // 17:00 JST
  const d3 = T.scheduleActiveDetail_(
    T.readScheduleRows_(), 's1', T.normalizeClassName('5年1組'), '第一小学校', beforeMs);
  check('E-6 時間外は active=false', d3.active === false, d3.active);

  // 開始時刻ちょうどは「含む」（start inclusive）
  const startMs = Date.UTC(2026, 10, 10, 9, 0, 0); // 18:00 JST
  const d4 = T.scheduleActiveDetail_(
    T.readScheduleRows_(), 's1', T.normalizeClassName('5年1組'), '第一小学校', startMs);
  check('E-7 開始時刻ちょうどは active（開始を含む）', d4.active === true, d4.active);

  // 終了時刻ちょうどは「含まない」（end exclusive）
  const endMs = Date.UTC(2026, 10, 10, 12, 0, 0); // 21:00 JST
  const d5 = T.scheduleActiveDetail_(
    T.readScheduleRows_(), 's1', T.normalizeClassName('5年1組'), '第一小学校', endMs);
  check('E-8 終了時刻ちょうどは active=false（終了を含まない）', d5.active === false, d5.active);

  // 備考が無ければ制限タイプ名
  const T2 = buildGas({
    devRows: DEV_ROWS,
    schedRows: [mkRow('sch_active_2', '5年1組', '', 'screen_lock')]
  });
  const d6 = T2.scheduleActiveDetail_(
    T2.readScheduleRows_(), 's1', T2.normalizeClassName('5年1組'), '第一小学校', PINNED_NOW_MS);
  check('E-9 備考が無ければ制限タイプ名（画面ロック）', d6.label === '画面ロック', d6.label);

  // isAnyScheduleActive_ の後方互換
  check('E-10 isAnyScheduleActive_ は真偽値を返す（後方互換）',
    T.isAnyScheduleActive_(T.readScheduleRows_(), 's1', T.normalizeClassName('5年1組'), '第一小学校', PINNED_NOW_MS) === true);

  // 全校生徒の予約もバッジ対象
  const T3 = buildGas({
    devRows: DEV_ROWS,
    schedRows: [(function () {
      const row = mkRow('sch_school_active', '', '全校一斉');
      const c = colIndex('対象種別'); row[c - 1] = 'school';
      return row;
    })()]
  });
  const d7 = T3.scheduleActiveDetail_(
    T3.readScheduleRows_(), 's3', T3.normalizeClassName('6年1組'), '第一小学校', PINNED_NOW_MS);
  check('E-11 全校生徒の予約もバッジに出る', d7.active === true, d7.active);
}

// ============================================================================
// F. 【機能1】予約実行中バッジ（R41 子GAS: 親から配られたキャッシュ）
// ============================================================================
console.log('===== F. 予約実行中バッジ（R41 子GAS / キャッシュ経路） =====');
{
  const T = buildGas({ devRows: DEV_ROWS });

  const cache = {
    updated_ms: PINNED_NOW_MS,
    by_student: {
      's1': {
        windows: [{
          id: 'sch_child_1', type: 'url_block', filter_mode: 'BLACKLIST',
          whitelist: [], blacklist: ['youtube.com'],
          start_ms: PINNED_NOW_MS - 600000, end_ms: PINNED_NOW_MS + 600000,
          label: '家庭学習の時間帯', target_type: 'class', target_label: '5年1組'
        }],
        overridden_ids: []
      },
      's2': {
        windows: [{
          id: 'sch_child_2', type: 'screen_lock', filter_mode: '',
          whitelist: [], blacklist: [],
          start_ms: PINNED_NOW_MS + 600000, end_ms: PINNED_NOW_MS + 1200000,
          label: '就寝前', target_type: 'school', target_label: '全校生徒'
        }],
        overridden_ids: []
      },
      's3': {
        windows: [{
          id: 'sch_child_3', type: 'url_block', filter_mode: 'BLACKLIST',
          whitelist: [], blacklist: ['youtube.com'],
          start_ms: PINNED_NOW_MS - 600000, end_ms: PINNED_NOW_MS + 600000,
          label: '解除済みの予約', target_type: 'class', target_label: '6年1組'
        }],
        overridden_ids: ['sch_child_3']
      }
    }
  };

  const f1 = T.scheduleActiveDetailFromCache_(cache, 's1', PINNED_NOW_MS);
  check('F-1 キャッシュ経路でも active=true', f1.active === true, f1.active);
  check('F-2 キャッシュの label をそのまま使う（子で再解釈しない）',
    f1.label === '家庭学習の時間帯', f1.label);
  check('F-3 キャッシュの予約IDを返す',
    JSON.stringify(f1.ids) === JSON.stringify(['sch_child_1']), f1.ids);

  const f2 = T.scheduleActiveDetailFromCache_(cache, 's2', PINNED_NOW_MS);
  check('F-4 時間外の窓は active=false', f2.active === false, f2.active);

  const f3 = T.scheduleActiveDetailFromCache_(cache, 's3', PINNED_NOW_MS);
  check('F-5 手動解除済みの窓はバッジに出ない', f3.active === false, f3.active);

  const f4 = T.scheduleActiveDetailFromCache_(cache, 'unknown', PINNED_NOW_MS);
  check('F-6 未知の児童は active=false', f4.active === false && f4.count === 0);

  const f5 = T.scheduleActiveDetailFromCache_(null, 's1', PINNED_NOW_MS);
  check('F-7 キャッシュが無ければ安全に false',
    f5.active === false && Array.isArray(f5.ids) && f5.ids.length === 0);

  // メール全体 ⇄ ローカル部 の表記ゆれ吸収（親→子で起きる断線の再発防止）
  const f6 = T.scheduleActiveDetailFromCache_(cache, 's1@city-mimasaka.ed.jp', PINNED_NOW_MS);
  check('F-8 メール全体でもローカル部一致で解決する', f6.active === true, f6.active);

  // 親→子ウィンドウに表示メタデータが同封されること
  const rowsForWin = [{
    id: 'sch_meta_1', targetType: 'class', schoolName: '第一小学校',
    className: '5年1組,5年2組', studentIds: [], type: 'url_block',
    filterMode: 'BLACKLIST', whitelist: [], blacklist: ['youtube.com'],
    dateFrom: '2026/11/10', dateTo: '2026/11/10', repeat: 'NONE',
    startTime: '18:00', endTime: '21:00', weekdaysRaw: '',
    enabled: true, overridden: false, note: '複数クラス帯'
  }];
  const w = T.shardBuildWindowsForStudent_(rowsForWin, 's1', '5年1組', '第一小学校', PINNED_NOW_MS);
  check('F-9 親→子ウィンドウに label が入る',
    w.windows.length > 0 && w.windows[0].label === '複数クラス帯',
    w.windows.length ? w.windows[0].label : w.windows.length);
  check('F-10 親→子ウィンドウに target_label が入る',
    w.windows.length > 0 && w.windows[0].target_label === '5年1組・5年2組',
    w.windows.length ? w.windows[0].target_label : '');
  check('F-11 親→子ウィンドウに target_type が入る',
    w.windows.length > 0 && w.windows[0].target_type === 'class');
  check('F-12 親→子ウィンドウに school_name が入る',
    w.windows.length > 0 && w.windows[0].school_name === '第一小学校');
}

// ============================================================================
// G. 親→子の配信対象（全校生徒・複数クラス）
// ============================================================================
console.log('===== G. propagateScheduleToChildren_（全校・複数クラス） =====');
{
  // 全校生徒: 同校の全児童IDが配信対象（他校は含めない）
  const T1 = buildGas({
    isParent: true,
    entries: [
      ['s1', '第一小学校', '5年1組'],
      ['s2', '第一小学校', '5年2組'],
      ['s3', '第一小学校', '6年1組'],
      ['s4', '英田小学校', '5年1組']
    ]
  });
  const p1 = T1.propagateScheduleToChildren_({
    id: 'sch_school_1', targetType: 'school', schoolName: '第一小学校',
    className: '', studentIds: [], enabled: true, overridden: false
  });
  const ids1 = (T1.PROPAGATED[0] && T1.PROPAGATED[0].ids) || [];
  check('G-1 全校生徒は同校の全員が対象（3名）',
    ids1.length === 3, ids1.join(','));
  check('G-2 全校生徒に他校の児童は含まれない（越境しない）',
    ids1.indexOf('s4') < 0, ids1.join(','));
  check('G-3 全校生徒の伝播が実行された', !p1.skipped && !p1.error, JSON.stringify(p1));

  // 複数クラス: どちらかに属する児童が対象
  const T2 = buildGas({
    isParent: true,
    entries: [
      ['s1', '第一小学校', '5年1組'],
      ['s2', '第一小学校', '5年2組'],
      ['s3', '第一小学校', '6年1組'],
      ['s4', '英田小学校', '5年1組']
    ]
  });
  T2.propagateScheduleToChildren_({
    id: 'sch_multi_1', targetType: 'class', schoolName: '第一小学校',
    className: '5年1組,5年2組', studentIds: [], enabled: true, overridden: false
  });
  const ids2 = (T2.PROPAGATED[0] && T2.PROPAGATED[0].ids) || [];
  check('G-4 複数クラスは両クラスの児童が対象（2名）',
    ids2.length === 2, ids2.join(','));
  check('G-5 複数クラスに対象外クラスは含まれない',
    ids2.indexOf('s3') < 0 && ids2.indexOf('s4') < 0, ids2.join(','));
  check('G-6 重複IDは1回だけ（5年1組の他校児童も英田小なので除外）',
    ids2.filter(function (x) { return x === 's1'; }).length === 1, ids2.join(','));
}

// ============================================================================
// H. 画面（gas/index.html）の契約
// ============================================================================
console.log('===== H. 画面側の実装契約 =====');
{
  // H-1 対象種別に school がある
  check('H-1 対象種別に「全校生徒」がある',
    /<option value="school">全校生徒<\/option>/.test(htmlSrc));

  // H-2 クラスはチェックボックス（複数選択）
  check('H-2 クラスはチェックボックス一覧（scheduleClassBox）',
    /id="scheduleClassBox"/.test(htmlSrc));
  check('H-3 クラス選択の保持先は1つの input（カンマ区切り）',
    /<input type="hidden" id="scheduleClass"/.test(htmlSrc));
  check('H-4 クラス切替関数がある（toggleScheduleClass）',
    /function toggleScheduleClass\s*\(/.test(htmlSrc));
  check('H-5 クラス値を同期する関数がある（syncScheduleClassValue）',
    /function syncScheduleClassValue\s*\(/.test(htmlSrc));

  // H-6 全校生徒の注意書き
  check('H-6 全校生徒の説明欄がある（scheduleSchoolTargetWrap）',
    /id="scheduleSchoolTargetWrap"/.test(htmlSrc));

  // H-7 保存で class_names を送る（複数クラス）
  check('H-7 保存ペイロードに class_names が入る',
    /class_names:\s*classNames/.test(htmlSrc));
  check('H-8 複数クラスはカンマ結合して class_name にも入れる',
    /class_name:\s*classNames\.join\(','\)/.test(htmlSrc));

  // H-9 編集モード
  check('H-9 編集モーダルを開く関数がある（openScheduleEditModal）',
    /function openScheduleEditModal\s*\(/.test(htmlSrc));
  check('H-10 編集時は update_schedule を送る',
    /action:\s*isEdit\s*\?\s*'update_schedule'\s*:\s*'save_schedule'/.test(htmlSrc));
  check('H-11 編集時も予約IDを送る（schedule_id）',
    /payload\.schedule_id\s*=\s*editingId/.test(htmlSrc));
  check('H-12 カードに編集ボタンがある',
    /onclick="openScheduleEditModal\(/.test(htmlSrc));
  check('H-13 編集モードの状態変数がある（scheduleEditingId）',
    /let scheduleEditingId/.test(htmlSrc));

  // H-14 予約実行中バッジ
  check('H-14 端末一覧に「予約実行中」バッジがある',
    /予約実行中/.test(htmlSrc) && /schedule_active/.test(htmlSrc));
  check('H-15 バッジは schedule_active_label を使う',
    /d\.schedule_active_label/.test(htmlSrc));

  // H-16 カードは target_label を使う（GAS が返す表示名）
  check('H-16 カードは target_label を優先する',
    /r\.target_label/.test(htmlSrc));
}

// ============================================================================
// I. 設計不変条件
// ============================================================================
console.log('===== I. 設計不変条件 =====');
{
  check('I-1 manifest version は 1.6.14 のまま', manifest.version === '1.6.14', manifest.version);
  check('I-2 default_popup を持たない', !('default_popup' in (manifest.action || {})));

  const bgSrc = fs.readFileSync(path.join(ROOT, 'extension/background.js'), 'utf8');
  check('I-3 DEFAULT_GAS_URL は空のまま', /const DEFAULT_GAS_URL\s*=\s*''\s*;/.test(bgSrc));

  // 14校（東粟倉小学校は廃校のため含めない）
  const schoolsMatch = htmlSrc.match(/const SCHOOLS\s*=\s*\[([\s\S]*?)\];/);
  const schoolList = schoolsMatch
    ? schoolsMatch[1].split(',').map(function (s) { return s.replace(/['"\s]/g, ''); }).filter(Boolean)
    : [];
  check('I-4 学校数は14校', schoolList.length === 14, schoolList.length);
  check('I-5 東粟倉小学校は含まれない', htmlSrc.indexOf('東粟倉') < 0);

  // テレメトリ書き戻しなし（予約シートへの書き込みは CRUD の3関数のみ）
  check('I-6 予約実行中バッジは読み取り専用（書き込み関数を呼ばない）',
    !/scheduleActiveDetail_[\s\S]{0,200}updateScheduleCells_/.test(gasSrc));

  // DIAG 計装の維持
  check('I-7 DIAG 計装が残っている',
    /SHARD_DIAG_MODE/.test(gasSrc) && /\[SHARD-DIAG\]/.test(gasSrc) && /bulkTrace/.test(gasSrc));
}

// ---------------------------------------------------------------- 結果
console.log('===== r47_schedule_advanced: PASS=' + pass + ' FAIL=' + fail + ' =====');
process.exit(fail === 0 ? 0 : 1);
