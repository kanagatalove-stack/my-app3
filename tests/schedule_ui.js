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
// フェーズ4（教員画面 UI）単体テスト: スケジュール管理タブ
//
//   検証の狙い
//     A. カレンダー生成 … buildMonthGrid が常に 7×6=42 セル・先頭曜日が正しい
//     B. 日付ユーティリティ … 実行TZに依存しない JST 壁時計の日付計算
//     C. 展開 … NONE / DAILY / WEEKLY の予約が「どの日に出るか」
//     D. ビュー切替 … switchMainView の3ビュー化（未知値は端末一覧へ）
//     E. 描画 … 予約ドット・今日・選択日の強調・当日一覧
//     F. 操作 … 手動解除 / 取消 のボタンと API 呼び分け
//     G. 登録 … save_schedule のペイロードと入力検証
//     H. 不変条件 … キャッシュバスター付与・manifest v1.6.4・東粟倉なし
// ============================================================================
const fs = require('fs');
const vm = require('vm');

const HTML_PATH = '/home/user/webapp/gas/index.html';
const html = fs.readFileSync(HTML_PATH, 'utf8');

const re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
let m, code = '';
while ((m = re.exec(html)) !== null) {
  if (/\bsrc\s*=/.test(m[0].split('>')[0])) continue;
  code += m[1] + '\n';
}

// --- テストから触るための橋渡し -------------------------------------------
//   let / const で宣言された状態変数は context のプロパティではないため、
//   同じスクリプトスコープ内で代入する関数を経由して読み書きする。
code += `
__T = {
  buildMonthGrid: buildMonthGrid,
  scheduleDatesInMonth: scheduleDatesInMonth,
  scheduleRowSummary: scheduleRowSummary,
  scheduleCardHtml: scheduleCardHtml,
  renderScheduleCalendar: renderScheduleCalendar,
  renderScheduleDayList: renderScheduleDayList,
  selectScheduleDay: selectScheduleDay,
  switchMainView: switchMainView,
  loadSchedules: loadSchedules,
  saveSchedule: saveSchedule,
  cancelSchedule: cancelSchedule,
  overrideSchedule: overrideSchedule,
  openScheduleModal: openScheduleModal,
  refreshScheduleClasses: refreshScheduleClasses,
  toggleScheduleTargetFields: toggleScheduleTargetFields,
  schParseKey: schParseKey,
  schKeyFromParts: schKeyFromParts,
  schDowOfKey: schDowOfKey,
  schAddDays: schAddDays,
  schDaysInMonth: schDaysInMonth,
  schTodayKey: schTodayKey,
  setData: function (a) { scheduleData = a; scheduleLoaded = true; },
  getData: function () { return scheduleData; },
  setCursor: function (y, mo) { scheduleCursorYear = y; scheduleCursorMonth = mo; },
  setSelected: function (k) { scheduleSelectedDate = k; },
  getSelected: function () { return scheduleSelectedDate; },
  setTeacher: function (t) { currentTeacher = t; },
  setDevices: function (a) { devicesData = a; },
  resetStudents: function () { scheduleSelectedStudentIds = new Set(); },
  addStudent: function (id) { scheduleSelectedStudentIds.add(id); },
  studentsSize: function () { return scheduleSelectedStudentIds.size; },
  stubApi: function (fn) { apiRequest = fn; },
  stubToast: function (fn) { showToast = fn; }
};
`;

// --- 最小 DOM スタブ -------------------------------------------------------
const store = {};
const els = {};
function mkEl(id) {
  if (els[id]) return els[id];
  const set = new Set();
  const el = {
    id, value: '', checked: false, innerHTML: '', textContent: '', dataset: {},
    options: [], files: [], disabled: false, className: '', title: '',
    style: { setProperty() {}, removeProperty() {} },
    parentNode: null,
    classList: {
      add(c) { set.add(c); }, remove(c) { set.delete(c); },
      toggle(c, f) { if (f === undefined) { set.has(c) ? set.delete(c) : set.add(c); } else if (f) { set.add(c); } else { set.delete(c); } },
      contains(c) { return set.has(c); }
    },
    appendChild() {}, removeChild() {}, remove() {},
    querySelectorAll() { return []; }, addEventListener() {},
    setAttribute() {}, removeAttribute() {}, getAttribute() { return null; },
    cloneNode() { return mkEl(id); }
  };
  els[id] = el;
  return el;
}
function el(id) { return mkEl(id); }
function visible(id) { return !mkEl(id).classList.contains('hidden'); }

const ctx = {
  console, JSON, Date, Math, String, Number, Array, Object, Boolean,
  isNaN, isFinite, parseFloat, parseInt, Set, Map, Promise, RegExp, Error,
  window: {
    addEventListener() {}, removeEventListener() {},
    location: { href: '', hostname: '', search: '' },
    open() { return { document: { write() {}, close() {} } }; }
  },
  setTimeout(fn) { if (typeof fn === 'function') fn(); return 0; },
  clearTimeout() {},
  setInterval() { return 0; },
  clearInterval() {},
  requestAnimationFrame(fn) { if (typeof fn === 'function') fn(); return 0; },
  localStorage: {
    getItem(k) { return k in store ? store[k] : null; },
    setItem(k, v) { store[k] = String(v); },
    removeItem(k) { delete store[k]; }
  },
  document: {
    getElementById(id) { return mkEl(id); },
    createElement() { return mkEl('tmp' + Math.random()); },
    querySelectorAll() { return []; }
  },
  fetch() { return Promise.reject(new Error('fetch should not be called in this test')); },
  confirm() { return true; },
  alert() {}
};
vm.createContext(ctx);
vm.runInContext(code, ctx);

const T = ctx.__T;
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { console.log('PASS', name, extra !== undefined ? '=> ' + JSON.stringify(extra) : ''); pass++; }
  else { console.log('FAIL', name, extra !== undefined ? '=> ' + JSON.stringify(extra) : ''); fail++; }
}

// 予約データの雛形
function row(over) {
  return Object.assign({
    id: 'sch_1', target_type: 'class', school_name: '第一小学校', class_name: '5年1組',
    student_ids: [], type: 'url_block', filter_mode: 'BLACKLIST',
    whitelist_urls: '', blacklist_urls: 'https://example.com',
    date_from: '2026/11/10', date_to: '2026/11/10', repeat: 'NONE',
    start_time: '19:00', end_time: '20:00', weekdays: [],
    enabled: true, overridden: false, note: ''
  }, over || {});
}

function setVals(obj) {
  Object.keys(obj).forEach(function (k) { el(k).value = obj[k]; });
}
function setChecks(obj) {
  Object.keys(obj).forEach(function (k) { el(k).checked = obj[k]; });
}

(async function main() {
  T.setTeacher({ role: 'ADMIN', school: '全校管理', email: 'admin@example.com' });

  // ======================== A. カレンダー生成 ========================
  console.log('===== A. 月グリッド生成（7×6） =====');
  {
    const nov = T.buildMonthGrid(2026, 10); // 2026年11月（0-11）
    check('常に42セル', nov.length === 42, nov.length);
    check('2026/11/01 は日曜＝先頭の空白なし', nov[0] === 1, nov[0]);
    check('2026年11月は30日', nov.filter(function (x) { return x !== null; }).length === 30);
    check('末日30が29番目(index29)', nov[29] === 30, nov[29]);
    check('末尾はnull埋め', nov[30] === null && nov[41] === null);

    const oct = T.buildMonthGrid(2026, 9); // 2026年10月（木曜始まり）
    check('2026/10/01 は木曜＝先頭4マス空白', oct[0] === null && oct[3] === null && oct[4] === 1);
    const feb = T.buildMonthGrid(2026, 1); // 2026年2月（日曜始まり・28日）
    check('2026年2月は28日', feb.filter(function (x) { return x !== null; }).length === 28);
    check('2月も42セル', feb.length === 42);
    const leap = T.buildMonthGrid(2024, 1);
    check('2024年2月は29日（閏年）', leap.filter(function (x) { return x !== null; }).length === 29);
  }

  // ======================== B. 日付ユーティリティ ========================
  console.log('===== B. JST 壁時計の日付計算 =====');
  {
    check('yyyy/MM/dd を解析', JSON.stringify(T.schParseKey('2026/11/10')) === JSON.stringify({ y: 2026, mo: 11, da: 10 }));
    check('yyyy-MM-dd も解析（input[type=date]）', JSON.stringify(T.schParseKey('2026-11-10')) === JSON.stringify({ y: 2026, mo: 11, da: 10 }));
    check('不正な日付は null', T.schParseKey('2026年11月10日') === null);
    check('ゼロ埋めでキー生成', T.schKeyFromParts(2026, 11, 10) === '2026/11/10', T.schKeyFromParts(2026, 11, 10));
    check('2026/11/01 は日曜(0)', T.schDowOfKey('2026/11/01') === 0, T.schDowOfKey('2026/11/01'));
    check('2026/11/02 は月曜(1)', T.schDowOfKey('2026/11/02') === 1);
    check('月末+1で翌月へ繰り越し', T.schAddDays('2026/11/30', 1) === '2026/12/01', T.schAddDays('2026/11/30', 1));
    check('年跨ぎも正しい', T.schAddDays('2026/12/31', 1) === '2027/01/01');
    check('2026年2月は28日', T.schDaysInMonth(2026, 2) === 28);
    check('2024年2月は29日', T.schDaysInMonth(2024, 2) === 29);
    check('今日のキーは yyyy/MM/dd 形式', /^\d{4}\/\d{2}\/\d{2}$/.test(T.schTodayKey()), T.schTodayKey());
  }

  // ======================== C. 予約の日付展開 ========================
  console.log('===== C. 予約が「どの日に出るか」 =====');
  {
    const single = T.scheduleDatesInMonth(row({ repeat: 'NONE', date_from: '2026/11/10', date_to: '2026/11/20' }), 2026, 10);
    check('単発(NONE)は開始日のみ（終了日無視）', single.length === 1 && single[0] === '2026/11/10', single);

    const other = T.scheduleDatesInMonth(row({ date_from: '2026/10/10' }), 2026, 10);
    check('対象月に無ければ空', other.length === 0, other);

    const daily = T.scheduleDatesInMonth(row({ repeat: 'DAILY', date_from: '2026/11/10', date_to: '2026/11/12' }), 2026, 10);
    check('毎日(DAILY)は期間内すべて', daily.length === 3, daily);

    const clip = T.scheduleDatesInMonth(row({ repeat: 'DAILY', date_from: '2026/10/28', date_to: '2026/11/05' }), 2026, 10);
    check('月をまたぐ予約は表示月で切り取る', clip.length === 5 && clip[0] === '2026/11/01', clip);

    const weekly = T.scheduleDatesInMonth(row({
      repeat: 'WEEKLY', date_from: '2026/11/01', date_to: '2026/11/30', weekdays: [1, 3]
    }), 2026, 10);
    check('毎週(WEEKLY)は指定曜日のみ（月水＝9日）', weekly.length === 9, weekly);
    check('WEEKLY に火曜は含まれない', weekly.indexOf('2026/11/03') === -1);
    check('WEEKLY に月曜は含まれる', weekly.indexOf('2026/11/02') !== -1);
    check('曜日未指定の WEEKLY は空', T.scheduleDatesInMonth(row({ repeat: 'WEEKLY', date_from: '2026/11/01', date_to: '2026/11/30', weekdays: [] }), 2026, 10).length === 0);
  }

  // ======================== D. ビュー切替 ========================
  console.log('===== D. 3ビューの切替 =====');
  {
    T.setData([]); // loadSchedules を走らせない（取得は押下時のみ）
    T.switchMainView('schedule');
    check('schedule で #scheduleView を表示', visible('scheduleView'));
    check('schedule で #devicesView を非表示', !visible('devicesView'));
    check('schedule で #screensView を非表示', !visible('screensView'));
    check('schedule タブがアクティブ表示', /bg-indigo-600/.test(el('tabScheduleViewBtn').className));

    T.switchMainView('screens');
    check('screens で #screensView を表示', visible('screensView'));
    check('screens で #scheduleView を非表示', !visible('scheduleView'));
    check('screens タブがアクティブ表示', /bg-indigo-600/.test(el('tabScreensViewBtn').className));
    check('schedule タブは非アクティブ表示', /text-slate-500/.test(el('tabScheduleViewBtn').className));

    T.switchMainView('devices');
    check('devices で #devicesView を表示', visible('devicesView'));
    check('devices で #scheduleView を非表示', !visible('scheduleView'));

    T.switchMainView('unknown-value');
    check('未知のビューは端末一覧へフォールバック', visible('devicesView') && !visible('scheduleView') && !visible('screensView'));
  }

  // ======================== E. カレンダー描画 ========================
  console.log('===== E. カレンダー描画（ドット・今日・選択日） =====');
  {
    T.setData([row({ date_from: '2026/11/10', date_to: '2026/11/10' })]);
    T.setCursor(2026, 10);
    T.setSelected('');
    T.renderScheduleCalendar();
    const g1 = el('scheduleCalendarGrid').innerHTML;
    check('42セルを描画', (g1.match(/min-h-\[86px\]/g) || []).length === 42, (g1.match(/min-h-\[86px\]/g) || []).length);
    check('予約日にドットを表示', /bg-violet-500/.test(g1));
    check('予約日のセルから選択できる', g1.indexOf("selectScheduleDay('2026/11/10')") !== -1);
    check('月ラベルが正しい', el('scheduleMonthLabel').textContent === '2026年11月', el('scheduleMonthLabel').textContent);

    // 今日のセルには「今日」バッジ
    const today = T.schTodayKey();
    const tp = T.schParseKey(today);
    T.setCursor(tp.y, tp.mo - 1);
    T.setSelected('');
    T.renderScheduleCalendar();
    check('今日のセルに「今日」バッジ', /今日/.test(el('scheduleCalendarGrid').innerHTML));
    check('今日の日付がグリッドに存在', el('scheduleCalendarGrid').innerHTML.indexOf("selectScheduleDay('" + today + "')") !== -1);

    // 選択日の強調
    T.setSelected('2026/11/10');
    T.setCursor(2026, 10);
    T.renderScheduleCalendar();
    check('選択日は ring で強調', /ring-violet-400/.test(el('scheduleCalendarGrid').innerHTML));

    // 解除済みは琥珀色ドット
    T.setData([row({ overridden: true })]);
    T.setSelected('');
    T.renderScheduleCalendar();
    check('今回解除済みは琥珀色ドット', /bg-amber-500/.test(el('scheduleCalendarGrid').innerHTML));

    // 取消済みは灰色ドット
    T.setData([row({ enabled: false })]);
    T.renderScheduleCalendar();
    check('取消済みは灰色ドット', /bg-slate-300/.test(el('scheduleCalendarGrid').innerHTML));
  }

  // ======================== F. 選択日の予約一覧 ========================
  console.log('===== F. 選択日の予約一覧 =====');
  {
    T.setData([row({})]);
    T.setSelected('');
    T.renderScheduleDayList();
    check('未選択時は案内文', /カレンダーの日付を選択してください/.test(el('scheduleDayList').innerHTML));

    T.setSelected('2026/11/11');
    T.renderScheduleDayList();
    check('予約の無い日は空メッセージ', /この日の予約はありません/.test(el('scheduleDayList').innerHTML));

    T.setSelected('2026/11/10');
    T.renderScheduleDayList();
    const list = el('scheduleDayList').innerHTML;
    check('選択日に予約カードを表示', /data-schedule-id="sch_1"/.test(list));
    check('日付ラベルに曜日を表示', el('scheduleDayLabel').textContent === '2026/11/10（火）', el('scheduleDayLabel').textContent);
    check('時間帯を表示', list.indexOf('19:00〜20:00') !== -1);
    check('制限タイプを日本語表示', /URL制限/.test(list));
  }

  // ======================== G. 解除／取消ボタン ========================
  console.log('===== G. 手動解除／取消ボタン =====');
  {
    const h = T.scheduleCardHtml(row({}), '2026/11/10');
    check('「手動解除（今回のみ停止）」ボタンあり', h.indexOf('手動解除（今回のみ停止）') !== -1);
    check('「取消（設定破棄）」ボタンあり', h.indexOf('取消（設定破棄）') !== -1);
    check('手動解除は overrideSchedule を呼ぶ', /onclick="overrideSchedule\('sch_1'\)"/.test(h));
    check('取消は cancelSchedule を呼ぶ', /onclick="cancelSchedule\('sch_1'\)"/.test(h));

    const cancelled = T.scheduleCardHtml(row({ enabled: false }), '2026/11/10');
    check('取消済みカードは両ボタンが無効', (cancelled.match(/disabled/g) || []).length >= 2);
    check('取消済みは「取消済」バッジ', /取消済/.test(cancelled));

    const ovr = T.scheduleCardHtml(row({ overridden: true }), '2026/11/10');
    check('解除済みは「今回解除済」バッジ', /今回解除済/.test(ovr));
  }

  // ======================== H. API 呼び分け ========================
  console.log('===== H. 解除／取消の API 呼び分け =====');
  {
    let calls = [];
    T.stubApi(function (payload) { calls.push(payload); return Promise.resolve({ success: true, data: [] }); });
    const toasts = [];
    T.stubToast(function (msg, type) { toasts.push({ msg: msg, type: type }); });

    await T.overrideSchedule('sch_9');
    const ov = calls.filter(function (c) { return c.action === 'override_schedule'; });
    check('手動解除は override_schedule を送る', ov.length === 1);
    check('手動解除は schedule_id を送る', ov[0] && ov[0].schedule_id === 'sch_9', ov[0]);
    check('解除後に一覧を再取得する', calls.some(function (c) { return c.action === 'list_schedules'; }));

    calls = [];
    await T.cancelSchedule('sch_8');
    const cn = calls.filter(function (c) { return c.action === 'cancel_schedule'; });
    check('取消は cancel_schedule を送る', cn.length === 1);
    check('取消は schedule_id を送る', cn[0] && cn[0].schedule_id === 'sch_8', cn[0]);

    // confirm を拒否したら送らない
    ctx.confirm = function () { return false; };
    calls = [];
    await T.cancelSchedule('sch_7');
    check('確認をキャンセルしたら取消は送らない', calls.length === 0, calls.length);
    await T.overrideSchedule('sch_7');
    check('確認をキャンセルしたら解除も送らない', calls.length === 0, calls.length);
    ctx.confirm = function () { return true; };

    // ID 無しは何もしない
    calls = [];
    await T.cancelSchedule('');
    check('ID が空なら通信しない', calls.length === 0);
  }

  // ======================== I. 新規予約の保存 ========================
  console.log('===== I. save_schedule のペイロードと検証 =====');
  {
    let calls = [];
    const toasts = [];
    T.stubApi(function (payload) { calls.push(payload); return Promise.resolve({ success: true, data: [] }); });
    T.stubToast(function (msg, type) { toasts.push({ msg: msg, type: type }); });
    T.resetStudents();

    function baseVals() {
      setVals({
        scheduleTargetType: 'class',
        scheduleSchool: '第一小学校',
        scheduleClass: '5年1組',
        scheduleRestrictionType: 'url_block',
        scheduleFilterMode: 'BLACKLIST',
        scheduleWhitelist: '',
        scheduleBlacklist: 'https://example.com',
        scheduleDateFrom: '2026-11-10',
        scheduleDateTo: '2026-11-12',
        scheduleStartTime: '19:00',
        scheduleEndTime: '20:00',
        scheduleRepeat: 'NONE',
        scheduleNote: 'テスト'
      });
      setChecks({
        scheduleWeekday0: false, scheduleWeekday1: true, scheduleWeekday2: true,
        scheduleWeekday3: true, scheduleWeekday4: true, scheduleWeekday5: true, scheduleWeekday6: false
      });
    }

    // 有効な登録
    baseVals(); calls = []; toasts.length = 0;
    await T.saveSchedule();
    const saves = calls.filter(function (c) { return c.action === 'save_schedule'; });
    check('save_schedule を1回送る', saves.length === 1);
    const p = saves[0] || {};
    check('対象種別を送る', p.target_type === 'class', p.target_type);
    check('学校名を送る', p.school_name === '第一小学校');
    check('クラス名を送る', p.class_name === '5年1組');
    check('制限タイプを送る', p.type === 'url_block');
    check('規制モードを送る', p.filter_mode === 'BLACKLIST');
    check('開始日を送る', p.date_from === '2026-11-10', p.date_from);
    check('終了日を送る', p.date_to === '2026-11-12');
    check('開始時刻を送る', p.start_time === '19:00');
    check('終了時刻を送る', p.end_time === '20:00');
    check('繰り返しを送る', p.repeat === 'NONE');
    check('備考を送る', p.note === 'テスト');
    check('成功トーストを出す', toasts.some(function (t) { return t.type === 'success'; }));

    // 開始時刻なし
    baseVals(); calls = []; setVals({ scheduleStartTime: '' });
    await T.saveSchedule();
    check('開始時刻なしは送らない', calls.filter(function (c) { return c.action === 'save_schedule'; }).length === 0);

    // 0分予約
    baseVals(); calls = []; setVals({ scheduleEndTime: '19:00' });
    await T.saveSchedule();
    check('0分の予約は拒否', calls.filter(function (c) { return c.action === 'save_schedule'; }).length === 0);

    // BLACKLIST なのに規制URLが空
    baseVals(); calls = []; setVals({ scheduleBlacklist: '' });
    await T.saveSchedule();
    check('BLACKLIST で規制URL未入力は拒否', calls.filter(function (c) { return c.action === 'save_schedule'; }).length === 0);

    // WHITELIST なのに許可URLが空
    baseVals(); calls = [];
    setVals({ scheduleFilterMode: 'WHITELIST', scheduleWhitelist: '' });
    await T.saveSchedule();
    check('WHITELIST で許可URL未入力は拒否', calls.filter(function (c) { return c.action === 'save_schedule'; }).length === 0);

    // 個別指定なのに児童未選択
    baseVals(); calls = []; T.resetStudents();
    setVals({ scheduleTargetType: 'student' });
    await T.saveSchedule();
    check('個別指定で児童未選択は拒否', calls.filter(function (c) { return c.action === 'save_schedule'; }).length === 0);

    // 個別指定で児童を選べば通る
    baseVals(); calls = []; T.resetStudents();
    setVals({ scheduleTargetType: 'student' });
    T.addStudent('s001@example.com');
    await T.saveSchedule();
    const ps = calls.filter(function (c) { return c.action === 'save_schedule'; });
    check('個別指定は児童IDを送る', ps.length === 1 && ps[0].student_ids.length === 1 && ps[0].student_ids[0] === 's001@example.com');

    // WEEKLY で曜日未選択
    baseVals(); calls = [];
    setVals({ scheduleRepeat: 'WEEKLY' });
    setChecks({ scheduleWeekday0: false, scheduleWeekday1: false, scheduleWeekday2: false, scheduleWeekday3: false, scheduleWeekday4: false, scheduleWeekday5: false, scheduleWeekday6: false });
    await T.saveSchedule();
    check('WEEKLY で曜日未選択は拒否', calls.filter(function (c) { return c.action === 'save_schedule'; }).length === 0);

    // WEEKLY で曜日を選べば通る
    //   baseVals() は月〜金をONにするので、まず全解除してから選ぶ
    //   （前のチェックが残ると [1,2,3,4,5] になり誤検知する）
    baseVals(); calls = [];
    setVals({ scheduleRepeat: 'WEEKLY' });
    setChecks({
      scheduleWeekday0: false, scheduleWeekday1: false, scheduleWeekday2: false,
      scheduleWeekday3: false, scheduleWeekday4: false, scheduleWeekday5: false,
      scheduleWeekday6: false
    });
    setChecks({ scheduleWeekday1: true, scheduleWeekday3: true });
    await T.saveSchedule();
    const pw = calls.filter(function (c) { return c.action === 'save_schedule'; });
    check('WEEKLY は曜日配列を送る', pw.length === 1 && JSON.stringify(pw[0].weekdays) === JSON.stringify([1, 3]), pw[0] && pw[0].weekdays);

    // 画面ロックは URL リスト不要
    baseVals(); calls = [];
    setVals({ scheduleRestrictionType: 'screen_lock', scheduleBlacklist: '' });
    await T.saveSchedule();
    check('画面ロックはURL未入力でも通る', calls.filter(function (c) { return c.action === 'save_schedule'; }).length === 1);
  }

  // ======================== J. 対象校の固定 ========================
  console.log('===== J. 非管理者は自校固定 =====');
  {
    T.setTeacher({ role: 'TEACHER', school: '第一小学校', email: 't@example.com' });
    T.setDevices([
      { student_id: 'a@example.com', student_name: '児童A', school_name: '第一小学校', class_name: '5年1組' },
      { student_id: 'b@example.com', student_name: '児童B', school_name: '第一小学校', class_name: '5年2組' },
      { student_id: 'c@example.com', student_name: '児童C', school_name: '英田小学校', class_name: '5年1組' }
    ]);
    T.openScheduleModal();
    check('非管理者の学校は自校で固定', el('scheduleSchool').value === '第一小学校', el('scheduleSchool').value);
    check('非管理者の学校選択は無効化', el('scheduleSchool').disabled === true);
    const box = el('scheduleStudentBox').innerHTML;
    check('個別児童は自校のみ列挙', box.indexOf('a@example.com') !== -1 && box.indexOf('b@example.com') !== -1 && box.indexOf('c@example.com') === -1);
    check('クラス一覧は自校のみ', el('scheduleClass').innerHTML.indexOf('5年1組') !== -1 && el('scheduleClass').innerHTML.indexOf('5年2組') !== -1);

    T.setTeacher({ role: 'ADMIN', school: '全校管理', email: 'admin@example.com' });
    T.openScheduleModal();
    check('管理者は学校選択が有効', el('scheduleSchool').disabled === false);
    check('管理者は全校から選択できる', /英田小学校/.test(el('scheduleSchool').innerHTML));

    // 対象種別に応じた表示切替
    setVals({ scheduleTargetType: 'student' });
    T.toggleScheduleTargetFields();
    check('個別指定ではクラス欄を隠す', el('scheduleClassWrap').classList.contains('hidden'));
    check('個別指定では児童欄を出す', !el('scheduleStudentWrap').classList.contains('hidden'));
    setVals({ scheduleTargetType: 'class' });
    T.toggleScheduleTargetFields();
    check('クラス指定ではクラス欄を出す', !el('scheduleClassWrap').classList.contains('hidden'));

    setVals({ scheduleRestrictionType: 'screen_lock' });
    T.toggleScheduleTargetFields();
    check('画面ロックではURL欄を隠す', el('scheduleUrlWrap').classList.contains('hidden'));
    setVals({ scheduleRestrictionType: 'url_block' });
    T.toggleScheduleTargetFields();
    check('URL制限ではURL欄を出す', !el('scheduleUrlWrap').classList.contains('hidden'));

    setVals({ scheduleRepeat: 'WEEKLY' });
    T.toggleScheduleTargetFields();
    check('毎週では曜日欄を出す', !el('scheduleWeekdayWrap').classList.contains('hidden'));
    setVals({ scheduleRepeat: 'NONE' });
    T.toggleScheduleTargetFields();
    check('単発では曜日欄を隠す', el('scheduleWeekdayWrap').classList.contains('hidden'));
  }

  // ======================== K. 取得 ========================
  console.log('===== K. 一覧取得 =====');
  {
    let calls = [];
    T.stubApi(function (payload) {
      calls.push(payload);
      if (payload.action === 'list_schedules') {
        return Promise.resolve({ success: true, data: [row({})], count: 1, server_time_ms: 1762500000000 });
      }
      return Promise.resolve({ success: true });
    });
    T.stubToast(function () {});
    // 既存の選択が残っていない状態にする（未選択＝今日が選ばれることを見る）
    T.setSelected('');
    await T.loadSchedules(false);
    check('list_schedules を送る', calls.some(function (c) { return c.action === 'list_schedules'; }));
    check('取得結果を保持する', T.getData().length === 1, T.getData().length);
    check('件数表示を更新する', el('scheduleCount').textContent === '1', el('scheduleCount').textContent);
    check('未選択なら今日を選択状態にする', T.getSelected() === T.schTodayKey(), T.getSelected());
  }

  // ======================== L. 静的な不変条件 ========================
  console.log('===== L. HTML / manifest の不変条件 =====');
  {
    check('スケジュールタブのボタンがある', /id="tabScheduleViewBtn"[^>]*onclick="switchMainView\('schedule'\)"/.test(html));
    check('スケジュールビューがある', /id="scheduleView"/.test(html));
    check('新規予約モーダルがある', /id="scheduleModal"/.test(html));
    check('カレンダーグリッドがある', /id="scheduleCalendarGrid"/.test(html));
    check('選択日の一覧がある', /id="scheduleDayList"/.test(html));
    check('新規予約ボタンがある', /onclick="openScheduleModal\(\)"/.test(html));
    check('再読込ボタンがある', /onclick="loadSchedules\(true\)"/.test(html));
    check('前月/今日/翌月の操作がある', /shiftScheduleMonth\(-1\)/.test(html) && /goScheduleToday\(\)/.test(html) && /shiftScheduleMonth\(1\)/.test(html));
    check('モーダルに繰り返し設定がある', /id="scheduleRepeat"/.test(html) && /id="scheduleWeekdayWrap"/.test(html));

    // キャッシュ破棄用パラメータ
    check('キャッシュ破棄用の ?v= が付与されている', /\?v=20261108/.test(html));
    check('アセット版数のメタ情報がある', /name="app-asset-version"[^>]*content="20261108"/.test(html));

    // manifest は不変（v1.6.4 / alarms / default_popup なし）
    const manifestRaw = fs.readFileSync('/home/user/webapp/extension/manifest.json', 'utf8');
    const mf = JSON.parse(manifestRaw);
    check('拡張のバージョンは v1.6.4 のまま', mf.version === '1.6.4', mf.version);
    check('alarms 権限を保持', (mf.permissions || []).indexOf('alarms') !== -1);
    check('default_popup を持たない（児童端末で何も出ない）', !mf.action || !mf.action.default_popup);

    // 東粟倉小学校は廃校のため存在しない
    check('東粟倉小学校は一覧に含まれない', html.indexOf('東粟倉') === -1);
  }

  console.log('\n===== 結果: PASS=' + pass + ' FAIL=' + fail + ' =====');
  process.exit(fail ? 1 : 0);
})();
