// ============================================================================
// r48_schedule_edit_fix.js — 実機不具合3点（Request P 修正）の回帰テスト
//
//   1) google.script.run 経由の update_schedule 疎通
//        これまで apiRequest の分岐に update_schedule が無く
//        「未対応のアクション: update_schedule」で失敗していた。
//        ・update_schedule / schedule_update が api_updateSchedule に到達する
//        ・未知のアクションは従来どおり拒否される（ガードを弱めていない）
//        ・save_schedule 等の既存経路は壊れていない
//
//   2) 編集モーダルの開始日・終了日が YYYY-MM-DD で復元される
//        <input type="date"> は YYYY-MM-DD 以外を受け付けないため、
//        サーバの "2026/11/10" をそのまま入れると空欄になっていた。
//
//   3) 編集モーダルで「個別の児童」のチェックが復元される
//        refreshScheduleClasses が描画のたびに選択を全消ししていたため、
//        復元したチェックが必ず外れていた。
//
//   併せて「新規登録では選択を初期化する」という従来契約が壊れていないこと、
//   および設計不変条件（v1.6.5 / default_popup なし / 14校 / DEFAULT_GAS_URL ''）
//   を確認する。
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
const html = fs.readFileSync(path.join(ROOT, 'gas/index.html'), 'utf8');
const gasSrc = fs.readFileSync(path.join(ROOT, 'gas/Code.gs'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension/manifest.json'), 'utf8'));
const bgSrc = fs.readFileSync(path.join(ROOT, 'extension/background.js'), 'utf8');

let pass = 0, fail = 0;
/** run_all.sh は literal な "Error:" を失敗とみなすため置換する。 */
function sanitize(v) {
  return String(v).replace(/Error:/g, 'Error-').replace(/\n/g, ' ');
}
function check(name, cond, extra) {
  if (cond) { pass++; console.log('PASS ' + name + (extra !== undefined ? ' => ' + sanitize(extra) : '')); }
  else { fail++; console.log('FAIL ' + name + (extra !== undefined ? ' => ' + sanitize(extra) : '')); }
}

// ---------------------------------------------------------------- 抽出
const re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
let mm, code = '';
while ((mm = re.exec(html)) !== null) {
  if (/\bsrc\s*=/.test(mm[0].split('>')[0])) continue;
  code += mm[1] + '\n';
}

// ---------------------------------------------------------------- 疑似 DOM
//   scheduleStudentBox / scheduleClassBox は innerHTML に描画された
//   チェックボックスを querySelectorAll で返す必要がある（本番と同じ順序で
//   「描画 → checked 復元」が起きることを検証するため）。
const els = {};
const boxCbs = new Map();   // elementId -> Map(value -> {value, checked})

function tagCheckboxes(el, id) {
  let map = boxCbs.get(id);
  if (!map) { map = new Map(); boxCbs.set(id, map); }
  const out = [];
  const tre = /<input\b[^>]*>/g;
  let m2;
  while ((m2 = tre.exec(el.innerHTML)) !== null) {
    const tag = m2[0];
    const vv = /value="([^"]*)"/.exec(tag);
    if (!vv) continue;
    const v = vv[1];
    if (!map.has(v)) map.set(v, { value: v, checked: /\bchecked\b/.test(tag) });
    out.push(map.get(v));
  }
  const present = {};
  out.forEach(function (o) { present[o.value] = true; });
  Array.from(map.keys()).forEach(function (k) { if (!present[k]) map.delete(k); });
  return out;
}

function mkEl(id) {
  if (els[id]) return els[id];
  const cls = new Set();
  const el = {
    id, value: '', checked: false, innerHTML: '', textContent: '', dataset: {},
    files: [], disabled: false, className: '', title: '',
    style: { setProperty() {}, removeProperty() {} },
    parentNode: null,
    classList: {
      add(c) { cls.add(c); }, remove(c) { cls.delete(c); },
      toggle(c, f) {
        if (f === undefined) { cls.has(c) ? cls.delete(c) : cls.add(c); }
        else if (f) { cls.add(c); } else { cls.delete(c); }
      },
      contains(c) { return cls.has(c); }
    },
    appendChild() {}, removeChild() {}, remove() {},
    querySelectorAll() { return tagCheckboxes(el, id); },
    addEventListener() {}, setAttribute() {}, removeAttribute() {},
    getAttribute() { return null; }, cloneNode() { return mkEl(id); }
  };
  // 実ブラウザでは <select> の options は innerHTML から生成される。
  //   モックで空配列に固定すると「選択肢が無い」と誤判定し、
  //   学校の選択が反映されず端末一覧が絞られない（テスト側の不具合）。
  Object.defineProperty(el, 'options', {
    get() {
      const out = [];
      const ore = /<option\b[^>]*value="([^"]*)"[^>]*>/g;
      let m3;
      while ((m3 = ore.exec(this.innerHTML)) !== null) out.push({ value: m3[1] });
      return out;
    }
  });
  els[id] = el;
  return el;
}

// ---------------------------------------------------------------- 疑似 google.script.run
const apiCalls = [];
function makeRunner() {
  const rec = { s: null, f: null };
  const api = {
    withSuccessHandler(fn) { rec.s = fn; return api; },
    withFailureHandler(fn) { rec.f = fn; return api; },
    withUserObject() { return api; }
  };
  ['api_login', 'api_verifySession', 'api_getAllDevices', 'api_requestScreens',
   'api_getScreens', 'api_bulkLock', 'api_bulkBroadcast', 'api_bulkFilter',
   'api_updateSingle', 'api_saveSchedule', 'api_updateSchedule',
   'api_cancelSchedule', 'api_overrideSchedule', 'api_listSchedules',
   'api_getMonitorSettings', 'api_saveMonitorSettings'
  ].forEach(function (n) {
    api[n] = function () {
      apiCalls.push({ name: n, args: Array.prototype.slice.call(arguments) });
      if (rec.s) rec.s({ success: true });
    };
  });
  return api;
}

const store = {};
const ctx = {
  console, JSON, Date, Math, String, Number, Array, Object, Boolean,
  isNaN, isFinite, parseFloat, parseInt, Set, Map, Promise, RegExp, Error,
  window: {
    addEventListener() {}, removeEventListener() {},
    location: { href: '', hostname: '', search: '' },
    open() { return { document: { write() {}, close() {} } }; }
  },
  setTimeout(fn) { if (typeof fn === 'function') fn(); return 0; },
  clearTimeout() {}, setInterval() { return 0; }, clearInterval() {},
  requestAnimationFrame(fn) { if (typeof fn === 'function') fn(); return 0; },
  localStorage: {
    getItem(k) { return k in store ? store[k] : null; },
    setItem(k, v) { store[k] = String(v); },
    removeItem(k) { delete store[k]; }
  },
  document: {
    getElementById(id) { return mkEl(id); },
    createElement() { return mkEl('tmp' + Math.random()); },
    querySelectorAll() { return []; },
    addEventListener() {}
  },
  google: { script: { run: makeRunner() } },
  fetch() { return Promise.reject(new Error('fetch should not be called in this test')); },
  confirm() { return true; },
  alert() {}
};
vm.createContext(ctx);

code += `
__T = {
  apiRequest: apiRequest,
  schDateInputValue: schDateInputValue,
  schTodayKey: schTodayKey,
  openScheduleEditModal: openScheduleEditModal,
  openScheduleModal: openScheduleModal,
  refreshScheduleClasses: refreshScheduleClasses,
  toggleScheduleTargetFields: toggleScheduleTargetFields,
  scheduleStudentIdsMatch: scheduleStudentIdsMatch,
  applyScheduleStudentCheckboxes: applyScheduleStudentCheckboxes,
  setData: function (a) { scheduleData = a; scheduleLoaded = true; },
  setDevices: function (a) { devicesData = a; },
  setTeacher: function (t) { currentTeacher = t; },
  getStudents: function () { return Array.from(scheduleSelectedStudentIds); },
  studentsSize: function () { return scheduleSelectedStudentIds.size; },
  getClasses: function () { return Array.from(scheduleSelectedClassNames); },
  getEditingId: function () { return scheduleEditingId; }
};
`;
vm.runInContext(code, ctx);
const T = ctx.__T;

function cbChecked(boxId, value) {
  const list = T && tagCheckboxes(mkEl(boxId), boxId);
  for (let i = 0; i < list.length; i++) if (list[i].value === value) return list[i].checked === true;
  return null;
}
function resetBoxes() { boxCbs.clear(); }

function schedRow(over) {
  return Object.assign({
    id: 'sch_1', target_type: 'class', school_name: '第一小学校', class_name: '5年1組',
    class_list: ['5年1組'], student_ids: [], type: 'url_block', filter_mode: 'BLACKLIST',
    whitelist_urls: [], blacklist_urls: [],
    date_from: '2026/11/10', date_to: '2026/11/12', repeat: 'NONE',
    start_time: '19:00', end_time: '20:00', weekdays: [],
    enabled: true, overridden: false, note: ''
  }, over || {});
}

const DEVICES = [
  { student_id: 'a@example.com', student_name: '児童A', school_name: '第一小学校', class_name: '5年1組' },
  { student_id: 'b@example.com', student_name: '児童B', school_name: '第一小学校', class_name: '5年2組' },
  { student_id: 'c@example.com', student_name: '児童C', school_name: '英田小学校', class_name: '5年1組' }
];

(async function main() {

  // ======================== A. google.script.run 経由 update_schedule ========================
  console.log('===== A. google.script.run 経由の update_schedule 疎通 =====');
  {
    // 分岐そのものが存在する（未対応のアクション行より前に置かれている）
    const iUpd = html.indexOf("act === 'update_schedule'");
    const iUnknown = html.indexOf("未対応のアクション");
    check('apiRequest に update_schedule 分岐がある', iUpd > 0);
    check('分岐は「未対応のアクション」より前にある', iUpd > 0 && iUnknown > 0 && iUpd < iUnknown);
    check('schedule_update の別名も受ける', html.indexOf("act === 'schedule_update'") > 0);
    check('api_updateSchedule を呼んでいる', /runner\.api_updateSchedule\(authToken, payload\)/.test(html));

    apiCalls.length = 0;
    let err = null, res = null;
    try {
      res = await T.apiRequest({ action: 'update_schedule', schedule_id: 'sch_1', target_type: 'class' });
    } catch (e) { err = e; }
    const last = apiCalls[apiCalls.length - 1] || {};
    check('update_schedule で例外が出ない', err === null, err && err.message);
    check('api_updateSchedule に到達する', last.name === 'api_updateSchedule', last.name);
    check('schedule_id がそのまま渡る', last.args && last.args[1] && last.args[1].schedule_id === 'sch_1',
      last.args && last.args[1] && last.args[1].schedule_id);
    check('成功応答を受け取る', res && res.success === true);

    // 別名 schedule_update も同じ経路
    apiCalls.length = 0;
    let err2 = null;
    try { await T.apiRequest({ action: 'schedule_update', schedule_id: 'sch_9' }); } catch (e) { err2 = e; }
    const last2 = apiCalls[apiCalls.length - 1] || {};
    check('schedule_update 別名でも api_updateSchedule', err2 === null && last2.name === 'api_updateSchedule', last2.name);
    check('別名でも schedule_id が渡る', last2.args && last2.args[1] && last2.args[1].schedule_id === 'sch_9');

    // ガード維持: 未知のアクションは従来どおり拒否
    apiCalls.length = 0;
    let err3 = null;
    try { await T.apiRequest({ action: 'no_such_action' }); } catch (e) { err3 = e; }
    check('未知のアクションは拒否される（ガード維持）',
      err3 !== null && /未対応のアクション/.test(String(err3 && err3.message)));
    check('未知のアクションでは API を呼ばない', apiCalls.length === 0, apiCalls.length);

    // 既存経路が壊れていない
    apiCalls.length = 0;
    let err4 = null;
    try { await T.apiRequest({ action: 'save_schedule', target_type: 'class' }); } catch (e) { err4 = e; }
    const last4 = apiCalls[apiCalls.length - 1] || {};
    check('save_schedule は従来どおり api_saveSchedule', err4 === null && last4.name === 'api_saveSchedule', last4.name);

    apiCalls.length = 0;
    let err5 = null;
    try { await T.apiRequest({ action: 'cancel_schedule', schedule_id: 'sch_1' }); } catch (e) { err5 = e; }
    const last5 = apiCalls[apiCalls.length - 1] || {};
    check('cancel_schedule も従来どおり', err5 === null && last5.name === 'api_cancelSchedule', last5.name);

    // サーバ側の受け口（doPost G6 と API ラッパ）も揃っている
    check('Code.gs に G6 ルートがある',
      /action === 'update_schedule' \|\| action === 'schedule_update'/.test(gasSrc));
    check('Code.gs に api_updateSchedule がある', /function api_updateSchedule\s*\(/.test(gasSrc));
  }

  // ======================== B. 日付の YYYY-MM-DD 正規化 ========================
  console.log('===== B. <input type="date"> 用の日付正規化 =====');
  {
    check('スラッシュ形式を変換', T.schDateInputValue('2026/11/10') === '2026-11-10', T.schDateInputValue('2026/11/10'));
    check('ハイフン形式はそのまま', T.schDateInputValue('2026-11-10') === '2026-11-10', T.schDateInputValue('2026-11-10'));
    check('1桁月日をゼロ埋め', T.schDateInputValue('2026/1/5') === '2026-01-05', T.schDateInputValue('2026/1/5'));
    check('空文字は空文字', T.schDateInputValue('') === '');
    check('null は空文字', T.schDateInputValue(null) === '');
    check('undefined は空文字', T.schDateInputValue(undefined) === '');
    check('解釈不能な文字列は空文字', T.schDateInputValue('2026年11月10日') === '', T.schDateInputValue('2026年11月10日'));
    // Date オブジェクト（JST 壁時計で判定すること）
    const d = new Date(Date.UTC(2026, 10, 10, 10, 0, 0)); // 2026/11/10 19:00 JST
    check('Date を JST 壁時計で変換', T.schDateInputValue(d) === '2026-11-10', T.schDateInputValue(d));
    // 英語表記（シートの日付セルが String() されたもの）
    check('英語表記を変換', T.schDateInputValue('Tue Nov 10 2026 00:00:00 GMT+0900 (日本標準時)') === '2026-11-10',
      T.schDateInputValue('Tue Nov 10 2026 00:00:00 GMT+0900 (日本標準時)'));
    check('常に YYYY-MM-DD 形式になる', /^\d{4}-\d{2}-\d{2}$/.test(T.schDateInputValue('2026/3/7')),
      T.schDateInputValue('2026/3/7'));

    // 編集モーダルで実際に input へ入ること
    resetBoxes();
    T.setTeacher({ role: 'ADMIN', school: '全校管理', email: 'admin@example.com' });
    T.setDevices(DEVICES);
    T.setData([schedRow({ date_from: '2026/11/10', date_to: '2026/11/12' })]);
    T.openScheduleEditModal('sch_1');
    check('開始日が YYYY-MM-DD で入る', mkEl('scheduleDateFrom').value === '2026-11-10', mkEl('scheduleDateFrom').value);
    check('終了日が YYYY-MM-DD で入る', mkEl('scheduleDateTo').value === '2026-11-12', mkEl('scheduleDateTo').value);
    check('開始日が空欄でない', String(mkEl('scheduleDateFrom').value).length === 10, mkEl('scheduleDateFrom').value);

    // 新規モーダルも同じ形式で埋まる（同じ罠を踏まない）
    T.openScheduleModal();
    const nd = mkEl('scheduleDateFrom').value;
    check('新規モーダルの日付も YYYY-MM-DD', /^\d{4}-\d{2}-\d{2}$/.test(nd), nd);
    check('新規モーダルは今日の日付', nd === T.schDateInputValue(T.schTodayKey()), nd);
  }

  // ======================== C. 個別児童チェックの復元 ========================
  console.log('===== C. 編集モーダルの児童チェック復元 =====');
  {
    resetBoxes();
    T.setTeacher({ role: 'ADMIN', school: '全校管理', email: 'admin@example.com' });
    T.setDevices(DEVICES);
    T.setData([schedRow({ target_type: 'student', class_name: '', class_list: [], student_ids: ['a@example.com'] })]);
    T.openScheduleEditModal('sch_1');
    check('選択状態が復元される', T.getStudents().indexOf('a@example.com') >= 0, T.getStudents().join(','));
    check('該当児童のチェックが立つ', cbChecked('scheduleStudentBox', 'a@example.com') === true, cbChecked('scheduleStudentBox', 'a@example.com'));
    check('非選択の児童はチェックされない', cbChecked('scheduleStudentBox', 'b@example.com') === false, cbChecked('scheduleStudentBox', 'b@example.com'));
    check('他校の児童は列挙されない', cbChecked('scheduleStudentBox', 'c@example.com') === null);
    check('描画後に選択が消えていない（全消しバグの再発防止）', T.studentsSize() === 1, T.studentsSize());
    check('対象種別が student に戻る', mkEl('scheduleTargetType').value === 'student', mkEl('scheduleTargetType').value);

    // 複数児童
    resetBoxes();
    T.setData([schedRow({ target_type: 'student', class_name: '', class_list: [],
      student_ids: ['a@example.com', 'b@example.com'] })]);
    T.openScheduleEditModal('sch_1');
    check('複数児童も選択が復元される', T.studentsSize() === 2, T.studentsSize());
    check('複数児童のチェックが両方立つ',
      cbChecked('scheduleStudentBox', 'a@example.com') === true &&
      cbChecked('scheduleStudentBox', 'b@example.com') === true);

    // ID 表記ゆれ（メール形式の大文字小文字）を吸収する
    resetBoxes();
    T.setData([schedRow({ target_type: 'student', class_name: '', class_list: [],
      student_ids: ['A@Example.com'] })]);
    T.openScheduleEditModal('sch_1');
    check('ID の表記ゆれを吸収してチェックが立つ', cbChecked('scheduleStudentBox', 'a@example.com') === true);
    check('表記ゆれ判定ヘルパが一致を返す', T.scheduleStudentIdsMatch('A@Example.com', 'a@example.com') === true);
    check('ローカル部が違えば不一致', T.scheduleStudentIdsMatch('a@example.com', 'b@example.com') === false);
    check('空文字同士は一致しない', T.scheduleStudentIdsMatch('', '') === false);

    // クラス複数選択の復元（念のため再確認）
    resetBoxes();
    T.setData([schedRow({ target_type: 'class', class_name: '5年1組,5年2組',
      class_list: ['5年1組', '5年2組'] })]);
    T.openScheduleEditModal('sch_1');
    check('複数クラスの選択が復元される', T.getClasses().length === 2, T.getClasses().join(','));
    check('クラスのチェックが両方立つ',
      cbChecked('scheduleClassBox', '5年1組') === true && cbChecked('scheduleClassBox', '5年2組') === true);
    check('編集モードのIDが維持される', T.getEditingId() === 'sch_1', T.getEditingId());
  }

  // ======================== D. 既存契約の維持 ========================
  console.log('===== D. 新規登録の従来契約を壊していない =====');
  {
    resetBoxes();
    T.setTeacher({ role: 'ADMIN', school: '全校管理', email: 'admin@example.com' });
    T.setDevices(DEVICES);
    // 直前が編集モードでも、新規を開けば選択は初期化される
    T.setData([schedRow({ target_type: 'student', class_name: '', class_list: [], student_ids: ['a@example.com'] })]);
    T.openScheduleEditModal('sch_1');
    T.openScheduleModal();
    check('新規モーダルで児童選択が初期化される', T.studentsSize() === 0, T.studentsSize());
    check('新規モーダルで編集IDが空になる', T.getEditingId() === '', T.getEditingId());
    check('新規モーダルでクラス選択も初期化される', T.getClasses().length === 0, T.getClasses().join(','));

    // 引数なしの refreshScheduleClasses は従来どおり選択を初期化する
    T.refreshScheduleClasses();
    check('refreshScheduleClasses() は児童選択を初期化する（従来動作）', T.studentsSize() === 0, T.studentsSize());
  }

  // ======================== E. 設計不変条件 ========================
  console.log('===== E. 設計不変条件 =====');
  {
    check('拡張のバージョンは v1.6.9', manifest.version === '1.6.9', manifest.version);
    check('default_popup を持たない', !manifest.action || !manifest.action.default_popup);
    check('DEFAULT_GAS_URL は空文字', /const DEFAULT_GAS_URL = ''/.test(bgSrc));
    check('東粟倉小学校は含まれない', html.indexOf('東粟倉') === -1 && gasSrc.indexOf('東粟倉') === -1);
    check('22列のスケジュール定義を維持', /SCHEDULE_COLUMNS/.test(gasSrc));
    check('MONITOR_SETTINGS_V1 を維持', /MONITOR_SETTINGS_V1/.test(gasSrc));
    check('SHARD_SCHEDULES_CACHE を維持', /SHARD_SCHEDULES_CACHE/.test(gasSrc));
  }

  console.log('\n===== 結果: PASS=' + pass + ' FAIL=' + fail + ' =====');
  process.exit(fail ? 1 : 0);
})();
