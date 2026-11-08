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
// フェーズ1（データ層）単体テスト: タイマー／スケジュール
//
//   検証の狙い（この機能で実際に事故になり得る箇所だけを突く）
//     1) シートの日付型セルが
//        "Tue Nov 10 2026 00:00:00 GMT+0900 (日本標準時)"
//        に化けても日付・時刻を取り違えないこと
//     2) 日時→ms が実行環境のタイムゾーンに依存しないこと（9時間ずれの再発防止）
//     3) 単発 / 毎日 / 毎週(曜日) の展開が正しいこと
//     4) 翌日跨ぎ（終了 < 開始）が表現できること
//     5) 対象判定（class / student）が正しいこと
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
// const CONFIG = {...} / const SCH_MONTHS_ = [...] をそのまま取り出す（定義の二重管理を避ける）
function extractConst(name) {
  const idx = src.indexOf('const ' + name + ' = ');
  if (idx < 0) throw new Error('const not found: ' + name);
  const oi = src.indexOf('{', idx);
  const ai = src.indexOf('[', idx);
  const useObj = oi >= 0 && (ai < 0 || oi < ai);
  const open = useObj ? '{' : '[';
  const close = useObj ? '}' : ']';
  const at = src.indexOf(open, idx);
  let d = 0, end = -1;
  for (let i = at; i < src.length; i++) {
    if (src[i] === open) d++;
    else if (src[i] === close) { d--; if (d === 0) { end = i; break; } }
  }
  if (end < 0) throw new Error('unbalanced const: ' + name);
  return 'const ' + name + ' = ' + src.slice(at, end + 1) + ';';
}

let pass = 0, fail = 0;
function check(n, c, e) {
  if (c) { console.log('PASS ' + n, e !== undefined ? '=> ' + JSON.stringify(e) : ''); pass++; }
  else { console.log('FAIL ' + n, e !== undefined ? '=> ' + JSON.stringify(e) : ''); fail++; }
}

const FNS = [
  'schPad2_', 'schIsDate_', 'schJstParts_', 'scheduleDatePart_', 'scheduleTimePart_',
  'schedulePartsToMs_', 'schMsToJstStr_', 'schTimeOfDayMs_', 'parseWeekdays_',
  'schJstDateStr_', 'schJstDow_', 'sheetTsToMs', 'expandScheduleWindows_',
  'normalizeSchoolName', 'normalizeClassName', 'schoolNamesMatch', 'deviceMatchesSchedule_'
];

const pieces = [extractConst('CONFIG')];
pieces.push('const SHEET_TZ_OFFSET_MS = 9 * 60 * 60 * 1000;');
pieces.push(extractConst('SCH_MONTHS_'));
FNS.forEach(function (n) { pieces.push(extractFn(n)); });
pieces.push('globalThis.__T = { CONFIG: CONFIG, ' + FNS.join(', ') + ' };');

const ctx = vm.createContext({ console: { log: function () {} } });
vm.runInContext(pieces.join('\n\n'), ctx, { filename: 'schedule_data_vm.js' });
const T = ctx.__T;

/** JST の壁時計 -> epoch ms */
function jst(y, mo, d, h, mi) { return Date.UTC(y, mo - 1, d, (h || 0) - 9, mi || 0); }

// ---------------------------------------------------------------- CONFIG
check('CONFIG.SCHEDULE_COLUMNS は 22 列', T.CONFIG.SCHEDULE_COLUMNS.length === 22, T.CONFIG.SCHEDULE_COLUMNS.length);
check('必須ヘッダーが揃っている',
  ['スケジュールID', '対象種別', '開始日', '終了日', '開始時刻', '終了時刻', '繰り返し', '曜日', '有効', '手動解除', '手動解除日時']
    .every(function (h) { return T.CONFIG.SCHEDULE_COLUMNS.indexOf(h) >= 0; }));
check('シート名は スケジュール管理', T.CONFIG.SCHEDULE_SHEET_NAME === 'スケジュール管理', T.CONFIG.SCHEDULE_SHEET_NAME);
check('廃校(東粟倉)は学校一覧に無い',
  T.CONFIG.SCHOOL_LIST.length === 14 && T.CONFIG.SCHOOL_LIST.indexOf('東粟倉小学校') < 0,
  T.CONFIG.SCHOOL_LIST.length);

// ------------------------------------------------- 日付の取り出し（罠つぶし）
check('日付: "2026/11/10"', T.scheduleDatePart_('2026/11/10') === '2026/11/10', T.scheduleDatePart_('2026/11/10'));
check('日付: "2026-11-10"', T.scheduleDatePart_('2026-11-10') === '2026/11/10', T.scheduleDatePart_('2026-11-10'));
check('日付: 1桁月日のゼロ詰め', T.scheduleDatePart_('2026/1/5') === '2026/01/05', T.scheduleDatePart_('2026/1/5'));
check('日付: 日付型セルの英語表記を吸収',
  T.scheduleDatePart_('Tue Nov 10 2026 00:00:00 GMT+0900 (日本標準時)') === '2026/11/10',
  T.scheduleDatePart_('Tue Nov 10 2026 00:00:00 GMT+0900 (日本標準時)'));
check('日付: 12月(Dec)も月名で解決',
  T.scheduleDatePart_('Thu Dec 24 2026 00:00:00 GMT+0900 (日本標準時)') === '2026/12/24',
  T.scheduleDatePart_('Thu Dec 24 2026 00:00:00 GMT+0900 (日本標準時)'));
check('日付: 空は空', T.scheduleDatePart_('') === '');

// Date オブジェクト（別レルム）でも JST の壁時計を返す
//   2026-11-09T15:00:00Z = 2026/11/10 00:00 JST
const dJstMidnight = new Date(Date.UTC(2026, 10, 9, 15, 0, 0));
check('日付: Date(別レルム) を JST で解決',
  T.scheduleDatePart_(dJstMidnight) === '2026/11/10', T.scheduleDatePart_(dJstMidnight));

// ------------------------------------------------- 時刻の取り出し
check('時刻: "19:00"', T.scheduleTimePart_('19:00') === '19:00', T.scheduleTimePart_('19:00'));
check('時刻: "7:00" -> ゼロ詰め', T.scheduleTimePart_('7:00') === '07:00', T.scheduleTimePart_('7:00'));
check('時刻: "7:00 PM" -> 19:00', T.scheduleTimePart_('7:00 PM') === '19:00', T.scheduleTimePart_('7:00 PM'));
check('時刻: 日付型セル内の時刻を吸収',
  T.scheduleTimePart_('Tue Nov 10 2026 19:00:00 GMT+0900 (日本標準時)') === '19:00',
  T.scheduleTimePart_('Tue Nov 10 2026 19:00:00 GMT+0900 (日本標準時)'));
const dJst1900 = new Date(Date.UTC(2026, 10, 10, 10, 0, 0)); // 19:00 JST
check('時刻: Date(別レルム) を JST で解決', T.scheduleTimePart_(dJst1900) === '19:00', T.scheduleTimePart_(dJst1900));

// ------------------------------------------------- 日時 -> ms（TZ非依存）
check('ms: 2026/11/10 19:00 JST が正しい絶対時刻',
  T.schedulePartsToMs_('2026/11/10', '19:00') === jst(2026, 11, 10, 19, 0),
  T.schedulePartsToMs_('2026/11/10', '19:00'));
check('ms: 日付型セルでも同じ結果',
  T.schedulePartsToMs_(new Date(Date.UTC(2026, 10, 9, 15, 0, 0)), '19:00') === jst(2026, 11, 10, 19, 0));
check('ms: 日付が空なら 0', T.schedulePartsToMs_('', '19:00') === 0);
check('ms -> JST表示の往復', T.schMsToJstStr_(jst(2026, 11, 10, 19, 0)) === '2026/11/10 19:00',
  T.schMsToJstStr_(jst(2026, 11, 10, 19, 0)));
check('時刻文字列 -> 経過ms', T.schTimeOfDayMs_('19:00') === 19 * 3600 * 1000);

// ------------------------------------------------- 曜日
check('曜日: "1,2,3,4,5"', JSON.stringify(T.parseWeekdays_('1,2,3,4,5')) === '[1,2,3,4,5]');
check('曜日: 全角カンマ区切り', JSON.stringify(T.parseWeekdays_('1、2')) === '[1,2]');
check('曜日: 不正値は捨てる', JSON.stringify(T.parseWeekdays_('1,9,x')) === '[1]', T.parseWeekdays_('1,9,x'));

// ------------------------------------------------- 時間窓の展開
const NOW_BEFORE = jst(2026, 11, 9, 0, 0); // 11/9 00:00 JST（予約開始日の前日）

// 単発（NONE）
const wNone = T.expandScheduleWindows_({
  dateFrom: '2026/11/10', dateTo: '2026/11/10', repeat: 'NONE',
  startTimeOfDayMs: 19 * 3600e3, endTimeOfDayMs: 21 * 3600e3, weekdays: []
}, NOW_BEFORE, 14 * 864e5);
check('展開: 単発は1窓', wNone.length === 1, wNone.length);
check('展開: 単発の開始は 19:00 JST', wNone[0].start_ms === jst(2026, 11, 10, 19, 0), wNone[0] && wNone[0].start_ms);
check('展開: 単発の終了は 21:00 JST', wNone[0].end_ms === jst(2026, 11, 10, 21, 0));

// 単発は開始日以外に窓を作らない
const wNone2 = T.expandScheduleWindows_({
  dateFrom: '2026/11/10', dateTo: '2026/11/12', repeat: 'NONE',
  startTimeOfDayMs: 19 * 3600e3, endTimeOfDayMs: 21 * 3600e3, weekdays: []
}, NOW_BEFORE, 14 * 864e5);
check('展開: NONE は開始日1日だけ（dateTo が複数日でも）', wNone2.length === 1, wNone2.length);

// 毎日（DAILY）
const wDaily = T.expandScheduleWindows_({
  dateFrom: '2026/11/10', dateTo: '2026/11/12', repeat: 'DAILY',
  startTimeOfDayMs: 19 * 3600e3, endTimeOfDayMs: 21 * 3600e3, weekdays: []
}, NOW_BEFORE, 14 * 864e5);
check('展開: 毎日 3日間 = 3窓', wDaily.length === 3, wDaily.length);
check('展開: 毎日は1日ずつ進む',
  wDaily.length === 3 && (wDaily[1].start_ms - wDaily[0].start_ms) === 864e5);

// 毎週（WEEKLY 平日のみ） 2026/11/10 は火曜
const wWeekly = T.expandScheduleWindows_({
  dateFrom: '2026/11/10', dateTo: '2026/11/15', repeat: 'WEEKLY',
  startTimeOfDayMs: 19 * 3600e3, endTimeOfDayMs: 21 * 3600e3, weekdays: [1, 2, 3, 4, 5]
}, NOW_BEFORE, 14 * 864e5);
check('展開: 毎週(平日) 火〜金の4窓', wWeekly.length === 4, wWeekly.length);
check('展開: 毎週は土日を飛ばす',
  wWeekly.every(function (w) {
    const dow = new Date(w.start_ms + 9 * 3600e3).getUTCDay();
    return dow >= 1 && dow <= 5;
  }));

// 翌日跨ぎ（22:00 -> 02:00 は終了 <= 開始なので翌日へ）
const wCross = T.expandScheduleWindows_({
  dateFrom: '2026/11/10', dateTo: '2026/11/10', repeat: 'NONE',
  startTimeOfDayMs: 22 * 3600e3, endTimeOfDayMs: 2 * 3600e3, weekdays: []
}, NOW_BEFORE, 14 * 864e5);
check('展開: 翌日跨ぎを表現できる（長さ4時間）',
  wCross.length === 1 && (wCross[0].end_ms - wCross[0].start_ms) === 4 * 3600e3,
  wCross.length ? (wCross[0].end_ms - wCross[0].start_ms) / 3600e3 : null);
check('展開: 跨いだ終了は翌日の 02:00 JST',
  wCross[0].end_ms === jst(2026, 11, 11, 2, 0), wCross[0] && wCross[0].end_ms);

// 先読み範囲（14日）より遠い予約は展開しない（端末へ無駄を配らない）
const wFar = T.expandScheduleWindows_({
  dateFrom: '2027/03/01', dateTo: '2027/03/01', repeat: 'NONE',
  startTimeOfDayMs: 19 * 3600e3, endTimeOfDayMs: 21 * 3600e3, weekdays: []
}, NOW_BEFORE, 14 * 864e5);
check('展開: 先読み範囲外は0窓', wFar.length === 0, wFar.length);

// ------------------------------------------------- 対象判定
const rowClass = { targetType: 'class', className: '5年1組', schoolName: '第一小学校', studentIds: [] };
check('対象: クラス一致', T.deviceMatchesSchedule_(rowClass, 's1', T.normalizeClassName('5年1組'), '第一小学校') === true);
check('対象: クラス不一致', T.deviceMatchesSchedule_(rowClass, 's1', T.normalizeClassName('6年1組'), '第一小学校') === false);
check('対象: 別校は不一致', T.deviceMatchesSchedule_(rowClass, 's1', T.normalizeClassName('5年1組'), '英田小学校') === false);
check('対象: 全角/空白の表記ゆれを吸収',
  T.deviceMatchesSchedule_(rowClass, 's1', T.normalizeClassName(' ５年１組 '), '第一小学校') === true);

const rowStudent = { targetType: 'student', className: '', schoolName: '第一小学校', studentIds: ['s1', 's2'] };
check('対象: 個別児童に含まれる', T.deviceMatchesSchedule_(rowStudent, 's2', '', '第一小学校') === true);
check('対象: 個別児童に含まれない', T.deviceMatchesSchedule_(rowStudent, 's3', '', '第一小学校') === false);

console.log('');
console.log('===== 結果: PASS=' + pass + ' FAIL=' + fail + ' =====');
process.exit(fail > 0 ? 1 : 0);
