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
// フェーズ5（子GAS 伝播）単体テスト: スケジュールの親→子同期
//
//   確定仕様（ユーザー承認済み）
//     1. 伝播単位 = 「展開済みウィンドウ」＋手動解除ID（子は再計算しない）
//     2. 保持先     = PropertiesService（子シートへの書き込みは行わない）
//     3. 同期経路   = 既存 shard_apply に schedules を同封（保留キューは使わない）
//     4. 送信範囲   = 子GASごとの全児童を丸ごと（差分管理をしない）
//
//   検証の狙い
//     A. 親: 展開済みウィンドウの組み立て（繰り返し・解除・無効の扱い）
//     B. 親: 子GASごとの地図づくりと抜き出し
//     C. 子: PropertiesService への保存・読込（丸ごと上書き／マージ）
//     D. 子: キャッシュ→端末配信契約（時刻比較のみ・再計算しない）
//     E. 子: buildHeartbeatResponse がキャッシュ経由で配信する
//     F. 経路: shardApplyFromParent が schedules を受け取って保存する
//     G. 経路: shardPropagatePolicy が同封時に保留キューを迂回する
//     H. 操作: 予約CRUD → 子GAS伝播の配線
//     I. 不変条件: 子シート無書き込み / manifest 不変 / 東粟倉なし
// ============================================================================
const fs = require('fs');
const vm = require('vm');
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
// 数値・文字列の const を拾う（extractConst は { [ しか扱えない）
function extractScalar(name) {
  const re = new RegExp('const\\s+' + name + '\\s*=\\s*([^;\\n]+);');
  const m = src.match(re);
  if (!m) throw new Error('scalar const not found: ' + name);
  return 'const ' + name + ' = ' + m[1].trim() + ';';
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
    _rows: (rows || []).map(r => r.slice()),
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
        setValue(v) { self._writes++; if (!self._rows[r - 1]) self._rows[r - 1] = []; self._rows[r - 1][c - 1] = v; return this; },
        setValues() { self._writes++; return this; },
        setBackground() { return this; }, setFontColor() { return this; },
        setFontWeight() { return this; }, setNumberFormat() { return this; }
      };
    },
    getDataRange() { const self = this; return { getValues() { return self._rows.map(r => r.slice()); } }; },
    appendRow(row) { this._writes++; this._rows.push(row.slice()); },
    setFrozenRows() {}, getSheetName() { return 'sheet'; }
  };
}

const DEVICE_COLUMNS = ['児童ID', '学校名', '氏名', 'クラス', '画面ロック', 'URL規制モード',
  '許可URLリスト', '規制URLリスト', '一斉表示URL', '一斉表示実行ID', '現在開いているURL',
  '最終同期日時', '備考', '画面情報要求日時', '画面情報更新日時'];

const SCHEDULE_COLUMNS = (function () {
  const m = src.match(/SCHEDULE_COLUMNS:\s*\[([\s\S]*?)\n\s*\],/);
  if (!m) throw new Error('SCHEDULE_COLUMNS not found');
  return m[1].split('\n').map(l => l.replace(/\/\/.*$/, '').trim())
    .filter(l => /^'/.test(l)).map(l => l.replace(/^'/, '').replace(/',?$/, ''));
})();

function mkRow(cols, map) {
  const row = cols.map(() => '');
  Object.keys(map).forEach(k => { const i = cols.indexOf(k); if (i >= 0) row[i] = map[k]; });
  return row;
}

// 端末一覧（親が見る名簿）
const devRows = [
  DEVICE_COLUMNS.slice(),
  ['s1', '第一小学校', '第一 一郎', '5年1組', false, 'OFF', '', '', '', '', '', '', '', '', ''],
  ['s2', '第一小学校', '第一 二郎', '6年1組', false, 'OFF', '', '', '', '', '', '', '', '', ''],
  ['s3', '英田小学校', '英田 三郎', '5年1組', false, 'OFF', '', '', '', '', '', '', '', '', '']
];

// スケジュール（19:00-21:00 / 2026-11-10 / 単発）
const schRows = [
  SCHEDULE_COLUMNS.slice(),
  mkRow(SCHEDULE_COLUMNS, {
    'スケジュールID': 'sch_a', '対象種別': 'class', '学校名': '第一小学校',
    'クラス名': '5年1組', '制限タイプ': 'url_block', 'URL規制モード': 'BLACKLIST',
    '規制URLリスト': 'youtube.com', '開始日': '2026/11/10', '終了日': '2026/11/10',
    '繰り返し': 'NONE', '開始時刻': '19:00', '終了時刻': '21:00',
    '有効': true, '手動解除': false
  }),
  mkRow(SCHEDULE_COLUMNS, {
    'スケジュールID': 'sch_b', '対象種別': 'student', '学校名': '第一小学校',
    '児童ID': 's2', '制限タイプ': 'screen_lock',
    '開始日': '2026/11/10', '終了日': '2026/11/10',
    '繰り返し': 'NONE', '開始時刻': '19:00', '終了時刻': '21:00',
    '有効': true, '手動解除': false
  })
];

const sheets = {
  '端末一覧': makeSheet(DEVICE_COLUMNS, devRows),
  'スケジュール管理': makeSheet(SCHEDULE_COLUMNS, schRows)
};

// -------------------------------------------------------------- GAS スタブ
const propStore = {};
const cacheStore = {};

const PropertiesService = {
  getScriptProperties() {
    return {
      getProperty(k) { return (k in propStore) ? propStore[k] : null; },
      setProperty(k, v) { propStore[k] = String(v); },
      deleteProperty(k) { delete propStore[k]; }
    };
  }
};
const CacheService = {
  getScriptCache() {
    return {
      get(k) { return (k in cacheStore) ? cacheStore[k] : null; },
      put(k, v) { cacheStore[k] = String(v); },
      remove(k) { delete cacheStore[k]; }
    };
  }
};

const ctx = vm.createContext({
  console: { log() {} },
  Logger: { log() {} },
  PropertiesService,
  CacheService,
  __SHEETS: sheets,
  __PROPS: propStore,
  __CACHE: cacheStore
});

const pieces = [];
pieces.push(extractConst('CONFIG'));
pieces.push('const SHEET_TZ_OFFSET_MS = 9 * 60 * 60 * 1000;');
pieces.push(extractConst('SCH_MONTHS_'));
try { pieces.push(extractConst('SCHOOL_ALIASES')); } catch (e) { pieces.push('const SCHOOL_ALIASES = {};'); }

// フェーズ5 の定数（数値・文字列）
pieces.push(extractScalar('SHARD_SCHEDULES_PROP'));
pieces.push(extractScalar('SHARD_SCHEDULES_MEMO_SEC'));
pieces.push(extractScalar('SHARD_SCHEDULES_MEMO_KEY'));
pieces.push('const SHARD_ASYNC_ENABLED = true;');

const FNS = [
  // 日時
  'schPad2_', 'schIsDate_', 'schJstParts_', 'scheduleDatePart_', 'scheduleTimePart_',
  'schedulePartsToMs_', 'schMsToJstStr_', 'schTimeOfDayMs_', 'parseWeekdays_',
  'schJstDateStr_', 'schJstDow_', 'sheetTsToMs', 'expandScheduleWindows_',
  // 名簿・正規化
  'normalizeSchoolName', 'schoolNamesMatch', 'resolveCanonicalSchool', 'isAllSchoolsName',
  'normalizeClassName', 'parseBoolean', 'parseUrlList', 'getHeaderMap',
  'normalizeShardClass',
  // URLリストの配列化（シートは文字列 / 端末契約は string[]）
  'normalizeHostListToArray_', 'hostListToSheetString_',
  // 児童IDの表記ゆれ吸収（メール全体 / ローカル部）— deviceMatchesSchedule_ が使う
  'normalizeIdKey', 'normalizeUserLocalPart_', 'idKeysMatch_', 'idMatchesAny_',
  // スケジュール中核（子）
  'deviceMatchesSchedule_', 'readScheduleRows_',
  'buildSchedulePayloadForDevice_', 'buildHeartbeatResponse',
  // フェーズ5（子）
  'emptySchedulePayload_', 'shardSaveScheduleCache_', 'shardLoadScheduleCache_',
  'shardSchedulePayloadFromCache_', 'resolveSchedulePayloadForDevice_',
  // フェーズ5（親）
  'shardBuildWindowsForStudent_', 'shardBuildScheduleByStudent_', 'shardPickSchedulesFor_',
  'propagateScheduleToChildren_',
  // 経路
  'shardApplyFromParent', 'shardPropagatePolicy'
];
FNS.forEach(n => pieces.push(extractFn(n)));

// --- ハーネス側スタブ ---
pieces.push('function getTargetSheet(name){ var s = __SHEETS[name]; if(!s) throw new Error("no sheet: "+name); return s; }');
pieces.push([
  'function ensureScheduleHeaders(sheet){',
  '  if (sheet.getLastColumn() === 0) {',
  '    sheet._cols = CONFIG.SCHEDULE_COLUMNS.slice();',
  '    sheet._rows[0] = CONFIG.SCHEDULE_COLUMNS.slice();',
  '  }',
  '}'
].join('\n'));
pieces.push([
  'function withWriteLock(fn){ return fn(); }',
  'function invalidateDevicesCache(){}',
  'function bulkTraceMark(){}',
  // 役割（テストごとに差し替える）
  'var __IS_PARENT = false, __IS_CHILD = false;',
  'function isShardParent(){ return __IS_PARENT; }',
  'function isShardChild(){ return __IS_CHILD; }',
  // 索引は「使えない環境」を再現（null でシート読みへフォールバック）
  'function shardDeviceEntries(){ return null; }',
  // 子GAS適用時の副作用（子シートへの書き込みは数えない）
  'function shardEnsureDeviceRows(){ return 0; }',
  'function bulkUpdateScreenLock(){}',
  'function bulkUpdateBroadcastUrl(){}',
  'function bulkUpdateFilterMode(){}',
  'function shardSecretMatches(){ return true; }',
  'function touchTeacherConsole(){}',
  'function releaseTeacherConsole(){}',
  // 【重要】ここで shardPropagatePolicy をスタブ宣言してはいけない。
  //   FNS が本物を抽出して pieces に積んだ後に同名の function 宣言を置くと、
  //   巻き上げで後勝ちになり、G 節が「スタブ」を検証してしまう（偽陽性）。
  //   H 節で差し替えたいときは __PROP_WRAP で代入する。
  'var __PROPAGATED = [];'
].join('\n'));

// 内部定数もテストから参照できるよう併せて公開する。
//   （本番 Code.gs に __T を置くと 14 校へ無駄なコードが出るため、公開はハーネス側で行う）
pieces.push('globalThis.__T = { CONFIG: CONFIG, ' +
  'SHARD_SCHEDULES_PROP: SHARD_SCHEDULES_PROP, ' +
  'SHARD_SCHEDULES_MEMO_KEY: SHARD_SCHEDULES_MEMO_KEY, ' +
  'SHARD_SCHEDULES_MEMO_SEC: SHARD_SCHEDULES_MEMO_SEC, ' +
  'SHARD_ASYNC_ENABLED: SHARD_ASYNC_ENABLED, ' +
  FNS.join(', ') + ' };');
pieces.push('globalThis.__setRoles = function(p,c){ __IS_PARENT = !!p; __IS_CHILD = !!c; };');
pieces.push('globalThis.__resetProps = function(){ Object.keys(__PROPS).forEach(function(k){ delete __PROPS[k]; }); Object.keys(__CACHE).forEach(function(k){ delete __CACHE[k]; }); };');

vm.runInContext(pieces.join('\n\n'), ctx, { filename: 'schedule_shard_vm.js' });
const T = ctx.__T;
const setRoles = ctx.__setRoles;
const resetProps = ctx.__resetProps;

function resetAll() {
  resetProps();
  setRoles(false, false);
}

// 時刻ヘルパ（JST 壁時計の文字列で指定する）
const AT_IN = '2026/11/10 19:30:00';   // 窓の内側
const AT_BEFORE = '2026/11/10 18:00:00'; // 窓の手前
const AT_AFTER = '2026/11/10 21:30:00';  // 窓の後
function ms(str) { return T.sheetTsToMs(str); }

// ============================================================ A. 親: ウィンドウ
console.log('===== A. 親: 展開済みウィンドウの組み立て =====');
{
  const rows = T.readScheduleRows_();
  check('予約シートを読める', Array.isArray(rows) && rows.length === 2, rows && rows.length);

  const w1 = T.shardBuildWindowsForStudent_(rows, 's1', '5年1組', '第一小学校', ms(AT_IN));
  check('クラス一致でウィンドウが返る', w1.windows.length === 1, w1.windows.length);
  check('start_ms/end_ms が確定している',
    w1.windows[0].start_ms === ms('2026/11/10 19:00:00') && w1.windows[0].end_ms === ms('2026/11/10 21:00:00'),
    [w1.windows[0].start_ms, w1.windows[0].end_ms]);
  check('制限タイプと規制URLが伝わる',
    w1.windows[0].type === 'url_block' && w1.windows[0].filter_mode === 'BLACKLIST' &&
    String(w1.windows[0].blacklist).indexOf('youtube.com') >= 0, w1.windows[0]);
  check('解除IDが空', Array.isArray(w1.overridden_ids) && w1.overridden_ids.length === 0);

  // 個別指定（s2 は screen_lock）
  const w2 = T.shardBuildWindowsForStudent_(rows, 's2', '6年1組', '第一小学校', ms(AT_IN));
  check('個別指定の児童に自分の予約が届く', w2.windows.length === 1 && w2.windows[0].type === 'screen_lock', w2.windows.length);

  // 対象外クラス
  const w3 = T.shardBuildWindowsForStudent_(rows, 's3', '5年1組', '英田小学校', ms(AT_IN));
  check('他校の児童には届かない（学校不一致）', w3.windows.length === 0, w3.windows.length);

  // 予約0件
  const w4 = T.shardBuildWindowsForStudent_([], 's1', '5年1組', '第一小学校', ms(AT_IN));
  check('予約0件なら空', w4.windows.length === 0 && w4.overridden_ids.length === 0);

  // 手動解除 → ウィンドウを出さずIDだけ渡す
  const rowsOver = JSON.parse(JSON.stringify(rows));
  rowsOver[0].overridden = true;
  const w5 = T.shardBuildWindowsForStudent_(rowsOver, 's1', '5年1組', '第一小学校', ms(AT_IN));
  check('解除済みはウィンドウを出さない', w5.windows.length === 0, w5.windows.length);
  check('解除済みは overridden_ids に入る', w5.overridden_ids.indexOf('sch_a') >= 0, w5.overridden_ids);

  // 無効（取消）→ 何も出さない
  const rowsOff = JSON.parse(JSON.stringify(rows));
  rowsOff[0].enabled = false;
  const w6 = T.shardBuildWindowsForStudent_(rowsOff, 's1', '5年1組', '第一小学校', ms(AT_IN));
  check('取消済みは配信しない', w6.windows.length === 0 && w6.overridden_ids.length === 0,
    [w6.windows.length, w6.overridden_ids.length]);

  // 昇順（shardBuildWindowsForStudent_ は readScheduleRows_ の“正規化済み行”を前提とする。
  //   生のシート行配列を混ぜると対象外として無視されるため、正規化オブジェクトで足す）
  const rowsTwo = JSON.parse(JSON.stringify(rows));
  rowsTwo.push({
    rowIndex: 99, id: 'sch_c', targetType: 'class', schoolName: '第一小学校',
    className: '5年1組', studentIds: [], type: 'screen_lock', filterMode: '',
    whitelist: '', blacklist: '', dateFrom: '2026/11/10', dateTo: '2026/11/10',
    repeat: 'NONE', startTime: '18:00', endTime: '18:30', weekdaysRaw: '',
    enabled: true, overridden: false, overrideAt: '', createdBy: '', createdAt: '',
    updatedAt: '', note: ''
  });
  const w7 = T.shardBuildWindowsForStudent_(rowsTwo, 's1', '5年1組', '第一小学校', ms(AT_IN));
  check('ウィンドウは開始時刻の昇順',
    w7.windows.length === 2 && w7.windows[0].start_ms <= w7.windows[1].start_ms &&
    w7.windows[0].id === 'sch_c',
    w7.windows.map(w => w.id));
}

// ============================================================ B. 親: 地図
console.log('===== B. 親: 子GASへ渡す地図と抜き出し =====');
{
  const rows = T.readScheduleRows_();
  const entries = [
    ['s1', '第一小学校', '5年1組'],   // sch_a（クラス予約）が該当
    ['s2', '第一小学校', '6年1組'],   // sch_b（個別予約）が該当
    // 予約に該当しない児童。5年1組は sch_a が該当してしまうため、
    // どの予約にも掛からないクラス（4年2組）で用意する。
    ['s9', '第一小学校', '4年2組']
  ];
  const by = T.shardBuildScheduleByStudent_(rows, entries, ms(AT_IN));
  check('予約のある児童だけが地図に入る', Object.keys(by).length === 2 && !!by.s1 && !!by.s2,
    Object.keys(by));
  check('予約に該当しない児童は入らない', !by.s9);
  check('s1 は自分のクラス予約だけ', by.s1.windows.length === 1 && by.s1.windows[0].id === 'sch_a');
  check('s2 は自分の個別予約だけ', by.s2.windows.length === 1 && by.s2.windows[0].id === 'sch_b');

  const emptyMap = T.shardBuildScheduleByStudent_([], entries, ms(AT_IN));
  check('予約0件なら空の地図', Object.keys(emptyMap).length === 0);

  const picked = T.shardPickSchedulesFor_(by, ['s1'], ms(AT_IN));
  check('指定児童ぶんだけ抜き出せる', picked && Object.keys(picked.by_student).length === 1 && !!picked.by_student.s1);
  check('抜き出しに updated_ms が入る', picked && typeof picked.updated_ms === 'number' && picked.updated_ms > 0);
  check('該当なしは null', T.shardPickSchedulesFor_(by, ['zzz'], ms(AT_IN)) === null);
  check('null 地図は null', T.shardPickSchedulesFor_(null, ['s1'], ms(AT_IN)) === null);
}

// ============================================================ C. 子: 保存/読込
console.log('===== C. 子: PropertiesService への保存・読込 =====');
{
  resetAll();
  const rec = { windows: [{ id: 'w1', type: 'url_block', start_ms: 1, end_ms: 2 }], overridden_ids: ['o1'] };
  const r = T.shardSaveScheduleCache_({ s1: rec }, 12345, true);
  check('保存できる', r.saved === 1 && r.total === 1, r);
  check('プロパティに実体が入る', !!propStore[T.SHARD_SCHEDULES_PROP]);

  const loaded = T.shardLoadScheduleCache_();
  check('読み戻せる', loaded && loaded.by_student && !!loaded.by_student.s1);
  check('ウィンドウが保持される', loaded.by_student.s1.windows.length === 1);
  check('解除IDが保持される', loaded.by_student.s1.overridden_ids[0] === 'o1');
  check('updated_ms が保持される', loaded.updated_ms === 12345, loaded.updated_ms);

  // 丸ごと上書き
  const r2 = T.shardSaveScheduleCache_({ s2: { windows: [], overridden_ids: [] } }, 22222, true);
  const after2 = T.shardLoadScheduleCache_();
  check('replace=true で前の児童が消える', !after2.by_student.s1 && !!after2.by_student.s2,
    Object.keys(after2.by_student));
  check('丸ごと上書きの件数', r2.total === 1, r2.total);

  // マージ
  T.shardSaveScheduleCache_({ s3: { windows: [], overridden_ids: [] } }, 33333, false);
  const after3 = T.shardLoadScheduleCache_();
  check('replace=false はマージされる', !!after3.by_student.s2 && !!after3.by_student.s3,
    Object.keys(after3.by_student));

  // 保存時にメモが捨てられる（次回はプロパティから読む）
  cacheStore[T.SHARD_SCHEDULES_MEMO_KEY] = JSON.stringify({ by_student: { stale: { windows: [] } } });
  T.shardSaveScheduleCache_({ s4: { windows: [], overridden_ids: [] } }, 44444, true);
  const after4 = T.shardLoadScheduleCache_();
  check('保存時にメモを捨てて最新を読む', !after4.by_student.stale && !!after4.by_student.s4,
    Object.keys(after4.by_student));

  // 壊れた JSON
  propStore[T.SHARD_SCHEDULES_PROP] = '{壊れ';
  delete cacheStore[T.SHARD_SCHEDULES_MEMO_KEY];
  let threw = false, bad = null;
  try { bad = T.shardLoadScheduleCache_(); } catch (e) { threw = true; }
  check('壊れたJSONでも例外を投げない', threw === false);
  check('壊れたJSONは null（空扱い）', bad === null);

  // 空なら null
  resetAll();
  check('未保存は null', T.shardLoadScheduleCache_() === null);
}

// ============================================================ D. 子: 配信契約
console.log('===== D. 子: キャッシュ→端末配信契約 =====');
{
  resetAll();
  const inWin = { id: 'w_in', type: 'url_block', filter_mode: 'BLACKLIST',
    whitelist: '', blacklist: 'youtube.com',
    start_ms: ms(AT_BEFORE), end_ms: ms(AT_AFTER) };
  const future = { id: 'w_fu', type: 'screen_lock', start_ms: ms('2026/11/10 20:00:00'),
    end_ms: ms('2026/11/10 22:00:00') };
  T.shardSaveScheduleCache_({ s1: { windows: [inWin, future], overridden_ids: ['o9'] } }, 1, true);

  const p = T.shardSchedulePayloadFromCache_('s1', ms(AT_IN));
  check('3キーが揃う', Array.isArray(p.active) && Array.isArray(p.upcoming) && Array.isArray(p.overridden_ids));
  check('時間内の窓が active に入る', p.active.length === 1 && p.active[0].id === 'w_in',
    p.active.map(x => x.id));
  check('未来の窓は upcoming（直近1件）', p.upcoming.length === 1 && p.upcoming[0].id === 'w_fu',
    p.upcoming.map(x => x.id));
  check('解除IDが伝わる', p.overridden_ids[0] === 'o9');
  check('start_jst/end_jst が付く', typeof p.active[0].start_jst === 'string' && /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}$/.test(p.active[0].start_jst),
    p.active[0].start_jst);

  // 開始ちょうど=含む / 終了ちょうど=含まない（半開区間 start <= now < end）
  //   s1 には 20:00-22:00 の別窓もあるため、半開区間の判定は専用の児童で行う。
  T.shardSaveScheduleCache_({
    sHalf: {
      windows: [{ id: 'w_half', type: 'url_block',
        start_ms: ms(AT_BEFORE), end_ms: ms(AT_AFTER) }],
      overridden_ids: []
    }
  }, 1, false);
  const atStart = T.shardSchedulePayloadFromCache_('sHalf', ms(AT_BEFORE));
  check('開始時刻ちょうどは active', atStart.active.length === 1 && atStart.active[0].id === 'w_half',
    atStart.active.map(x => x.id));
  const atEnd = T.shardSchedulePayloadFromCache_('sHalf', ms(AT_AFTER));
  check('終了時刻ちょうどは active でない', atEnd.active.length === 0, atEnd.active.length);
  const justBeforeEnd = T.shardSchedulePayloadFromCache_('sHalf', ms(AT_AFTER) - 1);
  check('終了1ms手前はまだ active', justBeforeEnd.active.length === 1, justBeforeEnd.active.length);
  const justAfterStart = T.shardSchedulePayloadFromCache_('sHalf', ms(AT_BEFORE) + 1);
  check('開始1ms後は active', justAfterStart.active.length === 1, justAfterStart.active.length);

  // キャッシュに無い児童
  const none = T.shardSchedulePayloadFromCache_('zzz', ms(AT_IN));
  check('未登録の児童は空の3キー', none.active.length === 0 && none.upcoming.length === 0 && none.overridden_ids.length === 0);

  // キャッシュ自体が無い
  resetAll();
  const noCache = T.shardSchedulePayloadFromCache_('s1', ms(AT_IN));
  check('キャッシュ無しでも空の3キー', noCache.active.length === 0 && Array.isArray(noCache.overridden_ids));

  // active の上限
  resetAll();
  const many = { by_student: { s1: { windows: [], overridden_ids: [] } } };
  for (let i = 0; i < 9; i++) {
    many.by_student.s1.windows.push({ id: 'm' + i, type: 'screen_lock',
      start_ms: ms(AT_BEFORE), end_ms: ms(AT_AFTER) });
  }
  T.shardSaveScheduleCache_(many.by_student, 1, true);
  const cap = T.shardSchedulePayloadFromCache_('s1', ms(AT_IN));
  check('active は SCHEDULE_MAX_ACTIVE 件まで', cap.active.length === (T.CONFIG.SCHEDULE_MAX_ACTIVE || 5),
    cap.active.length);

  // 再計算していないこと（ソース確認）
  const fbody = extractFn('shardSchedulePayloadFromCache_');
  check('子は繰り返しを再解釈しない（expandScheduleWindows_ を呼ばない）',
    fbody.indexOf('expandScheduleWindows_') < 0);
  check('子は予約シートを読まない（readScheduleRows_ を呼ばない）',
    fbody.indexOf('readScheduleRows_') < 0);
}

// ============================================================ E. 子: ハートビート
console.log('===== E. 子: buildHeartbeatResponse がキャッシュ経由で配信する =====');
{
  resetAll();
  setRoles(false, true); // 子GAS

  // シート上の予約（19:00-21:00 BLACKLIST）とは違う内容をキャッシュに入れ、
  // どちらが配信されるかで「キャッシュ経由」を判定する。
  T.shardSaveScheduleCache_({
    s1: {
      windows: [{ id: 'cache_w', type: 'screen_lock', start_ms: ms(AT_BEFORE), end_ms: ms(AT_AFTER) }],
      overridden_ids: []
    }
  }, 1, true);

  const sheet = sheets['端末一覧'];
  const headerMap = T.getHeaderMap(sheet, T.CONFIG.DEVICE_COLUMNS);
  const row = DEVICE_COLUMNS.map(() => '');
  row[DEVICE_COLUMNS.indexOf('児童ID')] = 's1';
  row[DEVICE_COLUMNS.indexOf('学校名')] = '第一小学校';
  row[DEVICE_COLUMNS.indexOf('氏名')] = '第一 一郎';
  row[DEVICE_COLUMNS.indexOf('クラス')] = '5年1組';
  row[DEVICE_COLUMNS.indexOf('画面ロック')] = false;
  row[DEVICE_COLUMNS.indexOf('URL規制モード')] = 'OFF';

  const res = T.buildHeartbeatResponse(row, headerMap, 's1', true,
    { sync_interval_sec: 1.5, idle_drift_until: 0 }, AT_IN);

  check('ハートビートに server_time_ms が入る', typeof res.server_time_ms === 'number' && res.server_time_ms > 0,
    res.server_time_ms);
  check('server_time_ms は server_time と同じ瞬間', res.server_time_ms === ms(AT_IN), res.server_time_ms);
  check('schedules の3キーが揃う',
    Array.isArray(res.schedules.active) && Array.isArray(res.schedules.upcoming) &&
    Array.isArray(res.schedules.overridden_ids));
  check('子はキャッシュの内容を配信する（シート値ではない）',
    res.schedules.active.length === 1 && res.schedules.active[0].id === 'cache_w',
    res.schedules.active.map(x => x.id));
  check('キャッシュの制限タイプが伝わる', res.schedules.active[0].type === 'screen_lock');
  check('既存の応答項目は壊れていない',
    res.student_id === 's1' && res.class_name === '5年1組' && res.filter_mode === 'OFF' && res.ka_active === true);

  // 子だがキャッシュが無い → 空（シートを読みに行かない）
  resetAll();
  setRoles(false, true);
  const res2 = T.buildHeartbeatResponse(row, headerMap, 's1', true,
    { sync_interval_sec: 1.5, idle_drift_until: 0 }, AT_IN);
  check('子でキャッシュ無しなら空の契約', res2.schedules.active.length === 0, res2.schedules.active.length);
  check('キャッシュ無しでもハートビートは返る', res2.student_id === 's1');

  // 子でない（単体GAS）→ 従来どおりシートから
  resetAll();
  setRoles(false, false);
  const res3 = T.buildHeartbeatResponse(row, headerMap, 's1', true,
    { sync_interval_sec: 1.5, idle_drift_until: 0 }, AT_IN);
  check('子でないGASは従来どおりシートから配信',
    res3.schedules.active.length === 1 && res3.schedules.active[0].id === 'sch_a',
    res3.schedules.active.map(x => x.id));

  // resolveSchedulePayloadForDevice_ の分岐
  resetAll();
  setRoles(false, true);
  T.shardSaveScheduleCache_({ s1: { windows: [], overridden_ids: ['zz'] } }, 1, true);
  const rp = T.resolveSchedulePayloadForDevice_('s1', '5年1組', '第一小学校', ms(AT_IN));
  check('resolve は子ならキャッシュを優先', rp.overridden_ids.indexOf('zz') >= 0, rp.overridden_ids);
}

// ============================================================ F. 経路: shard_apply
console.log('===== F. shardApplyFromParent が schedules を保存する =====');
{
  resetAll();
  setRoles(false, true);

  const payload = {
    shard_secret: 'x',
    student_ids: [],
    schedules: {
      updated_ms: 999,
      by_student: {
        s1: { windows: [{ id: 'from_parent', type: 'url_block', start_ms: 10, end_ms: 20 }], overridden_ids: ['o1'] }
      }
    }
  };
  const r = T.shardApplyFromParent(payload);
  check('schedules のみの伝達でも success', r.success === true, r.error);
  check('保存件数を応答に含む', r.schedules && r.schedules.saved === 1, r.schedules);

  const after = T.shardLoadScheduleCache_();
  check('PropertiesService に保存される', after && !!after.by_student.s1);
  check('ウィンドウが保存される', after.by_student.s1.windows[0].id === 'from_parent');
  check('解除IDが保存される', after.by_student.s1.overridden_ids[0] === 'o1');

  // 文字列で届いても解釈する
  resetAll();
  setRoles(false, true);
  const r2 = T.shardApplyFromParent({
    shard_secret: 'x', student_ids: [],
    schedules: JSON.stringify({ updated_ms: 1, by_student: { s2: { windows: [], overridden_ids: ['q'] } } })
  });
  check('schedules が文字列でも解釈する', r2.success === true && r2.schedules && r2.schedules.saved === 1,
    r2.schedules);

  // 丸ごと上書き（前回の児童が残らない）
  resetAll();
  setRoles(false, true);
  T.shardApplyFromParent({ shard_secret: 'x', student_ids: [], schedules: { by_student: { old: { windows: [], overridden_ids: [] } } } });
  T.shardApplyFromParent({ shard_secret: 'x', student_ids: [], schedules: { by_student: { fresh: { windows: [], overridden_ids: [] } } } });
  const after2 = T.shardLoadScheduleCache_();
  check('親が送った内容で丸ごと上書きされる', !after2.by_student.old && !!after2.by_student.fresh,
    Object.keys(after2.by_student));

  // schedules が無い従来の呼び出し
  resetAll();
  setRoles(false, true);
  const r3 = T.shardApplyFromParent({ shard_secret: 'x', student_ids: [] });
  check('schedules 無しでも従来どおり成功', r3.success === true && r3.schedules === null, r3.schedules);

  // 不正な schedules でもポリシー適用は成立
  resetAll();
  setRoles(false, true);
  const r4 = T.shardApplyFromParent({ shard_secret: 'x', student_ids: [], schedules: 12345 });
  check('不正な schedules でも success を保つ', r4.success === true, r4.success);
}

// ============================================================ G. 経路: 伝播
console.log('===== G. shardPropagatePolicy の同封と保留キュー迂回 =====');
{
  resetAll();
  setRoles(true, false);

  // shardPropagatePolicy が必要とする周辺を差し替える
  vm.runInContext([
    'shardMapIndexFromMap = function(){ return { "5-1": "https://child51/exec" }; };',
    'shardMapDefaultFromEmptyKey = function(){ return ""; };',
    'shardDeviceEntries = function(){ return [["s1","第一小学校","5年1組"]]; };',
    'shardConfigCached = function(){ return { map: {}, def: "", sec: "sec" }; };',
    'shardFetchMany = function(reqs){ globalThis.__LAST_REQS = reqs; return reqs.map(function(){ return { getResponseCode: function(){ return 200; }, getContentText: function(){ return "{}"; } }; }); };',
    'shardQueuePending = function(reqs){ globalThis.__QUEUED = reqs; return true; };'
  ].join('\n'), ctx);

  ctx.__LAST_REQS = null; ctx.__QUEUED = null;
  const r1 = T.shardPropagatePolicy(['s1'], { screen_lock: true });
  check('通常時（予約あり）は schedules を同封する',
    !!(ctx.__LAST_REQS && ctx.__LAST_REQS[0] &&
       JSON.parse(ctx.__LAST_REQS[0].payload).schedules), 'attached');
  const body1 = JSON.parse(ctx.__LAST_REQS[0].payload);
  check('同封された schedules に子の全児童が入る',
    body1.schedules && body1.schedules.by_student && !!body1.schedules.by_student.s1,
    Object.keys((body1.schedules || {}).by_student || {}));
  check('同封時は保留キューに積まない（即時同期送信）', ctx.__QUEUED === null, ctx.__QUEUED);

  // forceSync は予約が無くても保留を迂回
  resetAll();
  setRoles(true, false);
  vm.runInContext([
    'shardMapIndexFromMap = function(){ return { "5-1": "https://child51/exec" }; };',
    'shardMapDefaultFromEmptyKey = function(){ return ""; };',
    'shardDeviceEntries = function(){ return [["s1","第一小学校","5年1組"]]; };',
    'shardConfigCached = function(){ return { map: {}, def: "", sec: "sec" }; };',
    'shardFetchMany = function(reqs){ globalThis.__LAST_REQS = reqs; return reqs.map(function(){ return { getResponseCode: function(){ return 200; }, getContentText: function(){ return "{}"; } }; }); };',
    'shardQueuePending = function(reqs){ globalThis.__QUEUED = reqs; return true; };'
  ].join('\n'), ctx);
  sheets['スケジュール管理'] = makeSheet(SCHEDULE_COLUMNS, [SCHEDULE_COLUMNS.slice()]); // 予約0件
  ctx.__LAST_REQS = null; ctx.__QUEUED = null;
  const r2 = T.shardPropagatePolicy(['s1'], {}, true);
  // 【確定仕様3】最後の1件を取り消したとき、子に古い制限が残り続けないよう
  //   forceSync では「空の地図」も明示的に同封して子のキャッシュを空にする。
  const body2 = ctx.__LAST_REQS && JSON.parse(ctx.__LAST_REQS[0].payload);
  check('forceSync＋予約0件は空の schedules を同封する（取消を子へ伝える）',
    !!(body2 && body2.schedules && body2.schedules.by_student &&
       Object.keys(body2.schedules.by_student).length === 0),
    body2 && body2.schedules);
  check('forceSync は保留キューを使わない（同期送信）', ctx.__QUEUED === null, ctx.__QUEUED);

  // forceSync でない＋予約0件 → 従来どおり保留キューへ（schedules は同封しない）
  ctx.__LAST_REQS = null; ctx.__QUEUED = null;
  T.shardPropagatePolicy(['s1'], { screen_lock: true }, false);
  check('通常時（予約0件）は保留キューへ積む（従来動作を維持）', ctx.__QUEUED !== null);

  // 元に戻す
  sheets['スケジュール管理'] = makeSheet(SCHEDULE_COLUMNS, schRows);
}

// ============================================================ H. 操作→伝播
console.log('===== H. 予約CRUD → 子GAS伝播の配線 =====');
{
  resetAll();
  setRoles(false, false); // 非親 → skipped

  const skip = T.propagateScheduleToChildren_({
    targetType: 'class', className: '5年1組', schoolName: '第一小学校', studentIds: []
  });
  check('親でなければ伝播しない', skip && skip.skipped === true, skip);

  setRoles(true, false);
  // 伝播呼び出しを観測する
  const calls = [];
  vm.runInContext('globalThis.__PROP_WRAP = function(fn){ shardPropagatePolicy = fn; };', ctx);
  ctx.__PROP_WRAP(function (ids, patch, force) {
    calls.push({ ids: ids, patch: patch, force: force });
    return { sent: [], deferred: false };
  });
  vm.runInContext('shardDeviceEntries = function(){ return [["s1","第一小学校","5年1組"],["s2","第一小学校","6年1組"]]; };', ctx);

  const r1 = T.propagateScheduleToChildren_({
    targetType: 'class', className: '5年1組', schoolName: '第一小学校', studentIds: []
  });
  check('クラス対象は該当児童だけを伝播する', calls.length === 1 && calls[0].ids.join(',') === 's1',
    calls[0] && calls[0].ids);
  check('伝播は forceSync=true（即時同期送信）', calls[0] && calls[0].force === true);
  check('patch は空（ロック等に触れない）', calls[0] && JSON.stringify(calls[0].patch) === '{}', calls[0] && calls[0].patch);

  calls.length = 0;
  T.propagateScheduleToChildren_({
    targetType: 'student', className: '', schoolName: '第一小学校', studentIds: ['s2']
  });
  check('個別対象はその児童を伝播する', calls.length === 1 && calls[0].ids.join(',') === 's2');

  calls.length = 0;
  const r3 = T.propagateScheduleToChildren_({
    targetType: 'class', className: '9年9組', schoolName: '第一小学校', studentIds: []
  });
  check('対象0件なら伝播しない', calls.length === 0 && r3.skipped === true, r3);
  check('行が無ければ skipped', T.propagateScheduleToChildren_(null).skipped === true);

  // 予約CRUDハンドラが伝播を呼ぶ（ソース確認）
  ['handleSaveSchedule_', 'handleCancelSchedule_', 'handleOverrideSchedule_'].forEach(function (fn) {
    const body = extractFn(fn);
    check(fn + ' が子GAS伝播を呼ぶ', body.indexOf('propagateScheduleToChildren_') >= 0);
  });
}

// ============================================================ I. 不変条件
console.log('===== I. 不変条件 =====');
{
  resetAll();
  setRoles(false, true);

  // 子シートへの書き込みが発生しないこと
  const beforeWrites = sheets['スケジュール管理']._writes + sheets['端末一覧']._writes;
  T.shardApplyFromParent({
    shard_secret: 'x', student_ids: [],
    schedules: JSON.stringify({ by_student: { s1: { windows: [], overridden_ids: [] } } })
  });
  const afterWrites = sheets['スケジュール管理']._writes + sheets['端末一覧']._writes;
  check('スケジュール同期はシートへ書き込まない（PropertiesService のみ）',
    afterWrites === beforeWrites, { before: beforeWrites, after: afterWrites });

  // 保存関数のソースがシートAPIを使っていないこと
  const saveBody = extractFn('shardSaveScheduleCache_');
  check('保存関数は getTargetSheet を使わない', saveBody.indexOf('getTargetSheet') < 0);
  check('保存関数は PropertiesService を使う', saveBody.indexOf('PropertiesService') >= 0);

  // 子のハートビート経路がシート読みに落ちないこと
  const resolveBody = extractFn('resolveSchedulePayloadForDevice_');
  check('resolve は isShardChild でキャッシュ経路へ分岐する',
    resolveBody.indexOf('isShardChild') >= 0 && resolveBody.indexOf('shardSchedulePayloadFromCache_') >= 0);

  // shard_apply の受け口が schedules を扱う
  const applyBody = extractFn('shardApplyFromParent');
  check('shard_apply は schedules を受け取る', applyBody.indexOf('payload.schedules') >= 0);
  check('shard_apply は shardSaveScheduleCache_ を呼ぶ', applyBody.indexOf('shardSaveScheduleCache_') >= 0);

  // 伝播関数のソース
  const propBody = extractFn('propagateScheduleToChildren_');
  check('伝播は forceSync を渡す', /shardPropagatePolicy\([^)]*true\s*\)/.test(propBody));

  // manifest 不変
  const mf = JSON.parse(fs.readFileSync('/home/user/webapp/extension/manifest.json', 'utf8'));
  check('拡張のバージョンは v1.6.4 のまま', mf.version === '1.6.4', mf.version);
  check('alarms 権限を保持', (mf.permissions || []).indexOf('alarms') !== -1);
  check('default_popup を持たない（児童端末で何も出ない）', !mf.action || !mf.action.default_popup);

  // 東粟倉小学校は廃校
  check('東粟倉小学校は存在しない', src.indexOf('東粟倉') < 0);

  // 保留キューの合流処理には手を入れていない（確定仕様2）
  const coal = extractFn('shardCoalescePending');
  check('保留キューに schedules のマージ処理を足していない', coal.indexOf('schedules') < 0);
}

console.log('\n===== 結果: PASS=' + pass + ' FAIL=' + fail + ' =====');
process.exit(fail ? 1 : 0);
