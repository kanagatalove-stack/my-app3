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
// フェーズ3（端末判定エンジン）単体テスト: タイマー／スケジュール
//
//   検証の狙い
//     A. 時計補正  … NTP風のEMA平滑化／異常値の棄却／往復中央時刻の扱い
//     B. 判定      … isScheduleActiveAt の境界（開始=含む / 終了=含まない）
//     C. 合成      … 必ず「締める方向」にだけ倒れること（緩めない）
//     D. 解除      … overridden_ids が効いていること
//     E. アラーム  … scheduleEdge / scheduleTick の張り方と解除
//     F. 配信契約  … GAS の buildHeartbeatResponse が server_time_ms / schedules を返す
//     G. 不変条件  … manifest の version/permissions を変えない・通信なしで判定できる
// ============================================================================
const fs = require('fs'), vm = require('vm');
const bgSrc = fs.readFileSync('/home/user/webapp/extension/background.js', 'utf8');
const gasSrc = fs.readFileSync('/home/user/webapp/gas/Code.gs', 'utf8');
const manifestRaw = fs.readFileSync('/home/user/webapp/extension/manifest.json', 'utf8');

let pass = 0, fail = 0;
function check(n, c, e) {
  if (c) { console.log('PASS ' + n, e !== undefined ? '=> ' + JSON.stringify(e) : ''); pass++; }
  else { console.log('FAIL ' + n, e !== undefined ? '=> ' + JSON.stringify(e) : ''); fail++; }
}

// async 関数にも対応した抽出（bg の engine は async を含む）
function extractFn(src, name) {
  const re = new RegExp('^(?:async\\s+)?function ' + name + '\\s*\\(', 'm');
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

/**
 * スカラー定数（数値・文字列）の抽出。
 *   extractConst は { } [ ] を探すため、0.3 のようなスカラーに使うと
 *   後方の関数本体の波カッコを拾って壊れる。数値/文字列はこちらで取る。
 */
function extractScalar(src, name) {
  const re = new RegExp('^const ' + name + ' = (.+?);', 'm');
  const m = src.match(re);
  if (!m) throw new Error('scalar not found: ' + name);
  return 'const ' + name + ' = ' + m[1] + ';';
}

// ============================================================ 端末側エンジン
function makeSheet(cols, rows) {
  return {
    _cols: (cols || []).slice(), _rows: (rows || []).map(r => r.slice()),
    getLastColumn() { return this._cols.length; },
    getLastRow() { return this._rows.length; },
    getRange(r, c, nr, nc) {
      const self = this;
      if (nr === undefined) nr = 1; if (nc === undefined) nc = 1;
      return {
        getValues() {
          const out = [];
          for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) row.push((self._rows[r - 1 + i] || [])[c - 1 + j]); out.push(row); }
          return out;
        },
        setValue(v) { if (!self._rows[r - 1]) self._rows[r - 1] = []; self._rows[r - 1][c - 1] = v; return this; },
        setValues(vals) { vals.forEach((rr, i) => rr.forEach((v, j) => { if (!self._rows[r - 1 + i]) self._rows[r - 1 + i] = []; self._rows[r - 1 + i][c - 1 + j] = v; })); return this; },
        setBackground() { return this; }, setFontColor() { return this; },
        setFontWeight() { return this; }, setNumberFormat() { return this; }
      };
    },
    getDataRange() { const self = this; return { getValues() { return self._rows.map(r => r.slice()); } }; },
    appendRow(row) { this._rows.push(row.slice()); },
    setFrozenRows() {}, getSheetName() { return 'sheet'; }
  };
}

const BG_FNS = [
  'updateClockOffset', 'correctedNowMs', 'isScheduleActiveAt',
  'buildScheduleList', 'normalizeHostList', 'composeFilterRestriction',
  'computeEffectiveScheduleRestriction', 'composeEffectivePolicy',
  'persistScheduleCache', 'loadScheduleCache', 'loadBasePolicy',
  'armScheduleAlarms', 'applyScheduleFromHeartbeat'
];

const bgPieces = [
  extractScalar(bgSrc, 'SCHEDULE_OFFSET_SMOOTH'),
  extractScalar(bgSrc, 'SCHEDULE_OFFSET_MAX_ABS'),
  extractScalar(bgSrc, 'SCHEDULE_CACHE_KEY'),
  extractScalar(bgSrc, 'SCHEDULE_EDGE_ALARM'),
  extractScalar(bgSrc, 'SCHEDULE_TICK_ALARM'),
  'let clockOffsetMs = 0;',
  'let scheduleCache = null;',
  'let lastHeartbeatSentMs = 0;',
  'var __ALARMS_CREATED = [];',
  'var __ALARMS_CLEARED = [];',
  'var __STORE = {};'
];
BG_FNS.forEach(n => bgPieces.push(extractFn(bgSrc, n)));
bgPieces.push('globalThis.__T = { ' + BG_FNS.join(', ') + ' };');

const bgCtx = vm.createContext({
  console: { log() {}, warn() {} },
  chrome: {
    storage: {
      local: {
        async get(keys) {
          if (keys === null || keys === undefined) return Object.assign({}, bgCtx.__STORE);
          if (Array.isArray(keys)) {
            const o = {}; keys.forEach(k => { if (k in bgCtx.__STORE) o[k] = bgCtx.__STORE[k]; }); return o;
          }
          const o = {}; if (keys in bgCtx.__STORE) o[keys] = bgCtx.__STORE[keys]; return o;
        },
        async set(obj) { Object.assign(bgCtx.__STORE, obj); }
      }
    },
    alarms: {
      async create(name, info) { bgCtx.__ALARMS_CREATED.push({ name, info }); },
      async clear(name) { bgCtx.__ALARMS_CLEARED.push(name); return true; }
    }
  }
});

vm.runInContext(bgPieces.join('\n\n'), bgCtx, { filename: 'bg_engine_vm.js' });
const B = bgCtx.__T;
const STORE = bgCtx.__STORE;
const M = bgCtx;

function resetEnv() {
  BG_FNS.forEach(() => {});
  vm.runInContext('clockOffsetMs = 0; scheduleCache = null; lastHeartbeatSentMs = 0; __ALARMS_CREATED = []; __ALARMS_CLEARED = [];', M);
  Object.keys(STORE).forEach(k => delete STORE[k]);
}
function runIn(expr) { return vm.runInContext(expr, M); }

// ------------------------------------------------------------------ A. 時計補正
(function () {
  // 初回サンプルはそのまま採用（EMA を通さない）
  //   mid = (1000 + 1010) / 2 = 1005 → sample = 1500 - 1005 = 495
  check('時計: 初回はサンプルをそのまま採用（undefined）',
    B.updateClockOffset(1500, 1000, 1010, undefined) === 495,
    B.updateClockOffset(1500, 1000, 1010, undefined));

  // 送受信時刻が 0 でも妥当値として扱う（falsy 判定の罠）
  check('時計: sent/recv が 0 でも計算する',
    B.updateClockOffset(100, 0, 0, undefined) === 100,
    B.updateClockOffset(100, 0, 0, undefined));
  // 中央時刻を使う: sent=1000, recv=1100 → mid=1050, server=2050 → サンプル=1000
  check('時計: 往復中央時刻でサンプルを取る（片道遅延の影響を半減）',
    B.updateClockOffset(2050, 1000, 1100, undefined) === 1000);
  // EMA: cur=0, sample=100, 係数0.3 → 30
  const ema = B.updateClockOffset(100, 0, 0, 0);
  check('時計: EMA平滑化（0→100 で 30）', Math.abs(ema - 30) < 1e-9, ema);
  // 異常値は棄却
  const rej = B.updateClockOffset(999999999, 0, 0, 42);
  check('時計: 5分超のズレは棄却し既存値を維持', rej === 42, rej);
  // 引数不正は既存値維持
  check('時計: server_ms が 0 なら既存値維持', B.updateClockOffset(0, 1, 2, 7) === 7);
  check('時計: NaN は既存値維持', B.updateClockOffset(NaN, 1, 2, 9) === 9);
  // correctedNowMs
  const before = Date.now();
  const corr = B.correctedNowMs(5000);
  check('時計: correctedNowMs はオフセットを加算',
    corr - before >= 4990 && corr - before <= 5100, corr - before);
  check('時計: correctedNowMs(0) は現在時刻ほぼ一致', Math.abs(B.correctedNowMs(0) - Date.now()) < 50);
})();

// ------------------------------------------------------------------ B. 境界判定
(function () {
  const s = { id: 'a', start_ms: 1000, end_ms: 2000 };
  check('判定: 開始ちょうどは有効', B.isScheduleActiveAt(s, 1000) === true);
  check('判定: 中間は有効', B.isScheduleActiveAt(s, 1500) === true);
  check('判定: 終了ちょうどは無効（半開区間）', B.isScheduleActiveAt(s, 2000) === false);
  check('判定: 開始前は無効', B.isScheduleActiveAt(s, 999) === false);
  check('判定: null は無効', B.isScheduleActiveAt(null, 1500) === false);
  check('判定: start_ms 欠落は無効', B.isScheduleActiveAt({ id: 'x', end_ms: 2000 }, 1500) === false);
})();

// ------------------------------------------------------------------ C. 合成（締める方向）
(function () {
  // 1) WHITELIST × WHITELIST → 積集合
  const r1 = B.composeFilterRestriction(
    { filter_mode: 'WHITELIST', whitelist_urls: ['a.com', 'b.com'], blacklist_urls: [] },
    { type: 'url_block', filter_mode: 'WHITELIST', whitelist: ['b.com', 'c.com'], blacklist: [] });
  check('合成: WHITELIST同士は積集合', r1.filter_mode === 'WHITELIST' && JSON.stringify(r1.whitelist_urls) === '["b.com"]', r1);

  // 2) BLACKLIST × BLACKLIST → 和集合
  const r2 = B.composeFilterRestriction(
    { filter_mode: 'BLACKLIST', whitelist_urls: [], blacklist_urls: ['youtube.com'] },
    { type: 'url_block', filter_mode: 'BLACKLIST', whitelist: [], blacklist: ['game.example'] });
  check('合成: BLACKLIST同士は和集合',
    r2.filter_mode === 'BLACKLIST' && r2.blacklist_urls.length === 2 &&
    r2.blacklist_urls.indexOf('youtube.com') >= 0 && r2.blacklist_urls.indexOf('game.example') >= 0, r2);

  // 3) WHITELIST ベース × BLACKLIST 予約 → WHITELIST のまま、規制分を許可から差し引く
  const r3 = B.composeFilterRestriction(
    { filter_mode: 'WHITELIST', whitelist_urls: ['ok.com', 'bad.com'], blacklist_urls: [] },
    { type: 'url_block', filter_mode: 'BLACKLIST', whitelist: [], blacklist: ['bad.com'] });
  check('合成: WHITELISTベースは緩めず、規制分を許可から除外',
    r3.filter_mode === 'WHITELIST' && JSON.stringify(r3.whitelist_urls) === '["ok.com"]', r3);

  // 4) OFF ベース × BLACKLIST 予約
  const r4 = B.composeFilterRestriction(
    { filter_mode: 'OFF', whitelist_urls: [], blacklist_urls: [] },
    { type: 'url_block', filter_mode: 'BLACKLIST', whitelist: [], blacklist: ['youtube.com'] });
  check('合成: OFFベースでも予約で規制が入る',
    r4.filter_mode === 'BLACKLIST' && r4.blacklist_urls.indexOf('youtube.com') >= 0, r4);

  // 5) url_block 以外（screen_lock）はフィルタを変えない
  const r5 = B.composeFilterRestriction(
    { filter_mode: 'BLACKLIST', whitelist_urls: [], blacklist_urls: ['a.com'] },
    { type: 'screen_lock' });
  check('合成: screen_lock はフィルタ条件を変えない',
    r5.filter_mode === 'BLACKLIST' && JSON.stringify(r5.blacklist_urls) === '["a.com"]', r5);

  // 6) 正規化（大小文字・空白・重複）
  const r6 = B.composeFilterRestriction(
    { filter_mode: 'BLACKLIST', whitelist_urls: [], blacklist_urls: [' A.com '] },
    { type: 'url_block', filter_mode: 'BLACKLIST', whitelist: [], blacklist: ['a.com', ''] });
  check('合成: ホスト名を正規化して重複を排除', JSON.stringify(r6.blacklist_urls) === '["a.com"]', r6);
})();

// ------------------------------------------------------------------ D. 解除 / screen_lock
(function () {
  const now = 1000;
  const schedules = {
    active: [
      { id: 's1', type: 'url_block', filter_mode: 'BLACKLIST', whitelist: [], blacklist: ['youtube.com'], start_ms: 500, end_ms: 2000 },
      { id: 's2', type: 'screen_lock', start_ms: 500, end_ms: 2000 }
    ],
    upcoming: [],
    overridden_ids: []
  };
  const eff1 = B.computeEffectiveScheduleRestriction(schedules, now);
  check('解除: 未解除なら両方効く', eff1.screen_lock === true && eff1.url_block === true && eff1.active_ids.length === 2);

  const eff2 = B.computeEffectiveScheduleRestriction(
    { active: schedules.active, upcoming: [], overridden_ids: ['s1', 's2'] }, now);
  check('解除: overridden_ids で除外される',
    eff2.screen_lock === false && eff2.url_block === false && eff2.active_ids.length === 0, eff2);

  // 時間外は効かない
  const eff3 = B.computeEffectiveScheduleRestriction(schedules, 3000);
  check('判定: 時間外は効かない', eff3.screen_lock === false && eff3.url_block === false);

  // composeEffectivePolicy: ベース + 予約
  const eff4 = B.composeEffectivePolicy(
    { screen_lock: false, filter_mode: 'OFF', whitelist_urls: [], blacklist_urls: [] }, schedules, now);
  check('合成: 予約により画面ロックON', eff4.screen_lock === true);
  check('合成: 予約により URL規制 BLACKLIST', eff4.filter_mode === 'BLACKLIST', eff4.filter_mode);
  check('合成: 適用中の予約IDを返す', eff4.schedule_active_ids.length === 2, eff4.schedule_active_ids);

  // ベースがロック済みなら予約が無くても維持（緩めない）
  const eff5 = B.composeEffectivePolicy(
    { screen_lock: true, filter_mode: 'BLACKLIST', whitelist_urls: [], blacklist_urls: ['x.com'] },
    { active: [], upcoming: [], overridden_ids: [] }, now);
  check('合成: 常時ポリシーは予約が無くても維持される', eff5.screen_lock === true && eff5.filter_mode === 'BLACKLIST');
})();

// ------------------------------------------------- E. アラーム（非同期・storage 併用）
(async function () {
  resetEnv();

  // アラーム: 予約があれば Edge + Tick を張る
  const schedule = {
    active: [],
    upcoming: [{ id: 'u1', type: 'url_block', filter_mode: 'BLACKLIST', whitelist: [], blacklist: ['youtube.com'], start_ms: Date.now() + 60000, end_ms: Date.now() + 7200000 }],
    overridden_ids: []
  };
  await B.armScheduleAlarms(schedule, 0);
  const created = bgCtx.__ALARMS_CREATED.map(a => a.name);
  check('アラーム: scheduleEdge を張る', created.indexOf('scheduleEdge') >= 0, created);
  check('アラーム: scheduleTick(1分) を張る', created.indexOf('scheduleTick') >= 0, created);
  const edge = bgCtx.__ALARMS_CREATED.filter(a => a.name === 'scheduleEdge')[0];
  check('アラーム: edge に when（絶対時刻）を指定', !!(edge && typeof edge.info.when === 'number' && edge.info.when > Date.now()), edge && edge.info);

  // 予約が無ければ Tick を止める
  bgCtx.__ALARMS_CREATED = []; bgCtx.__ALARMS_CLEARED = [];
  await B.armScheduleAlarms({ active: [], upcoming: [], overridden_ids: [] }, 0);
  check('アラーム: 予約が無ければ scheduleTick を解除',
    bgCtx.__ALARMS_CLEARED.indexOf('scheduleTick') >= 0, bgCtx.__ALARMS_CLEARED);

  // 解除済みのみなら Edge を張らない
  bgCtx.__ALARMS_CREATED = []; bgCtx.__ALARMS_CLEARED = [];
  await B.armScheduleAlarms({ active: [], upcoming: [{ id: 'u2', start_ms: Date.now() + 60000, end_ms: Date.now() + 120000 }], overridden_ids: ['u2'] }, 0);
  check('アラーム: 解除済みの予約では Edge を張らない',
    bgCtx.__ALARMS_CREATED.map(a => a.name).indexOf('scheduleEdge') < 0, bgCtx.__ALARMS_CREATED);

  // -------------------------------------------------- applyScheduleFromHeartbeat
  resetEnv();
  const updates = {
    screen_lock: false, filter_mode: 'OFF', whitelist_urls: [], blacklist_urls: []
  };
  const nowMs = Date.now();
  const policy = {
    screen_lock: false,
    filter_mode: 'OFF',
    whitelist_urls: [],
    blacklist_urls: [],
    server_time_ms: nowMs,
    schedules: {
      active: [{ id: 's1', type: 'url_block', filter_mode: 'BLACKLIST', whitelist: [], blacklist: ['youtube.com'], start_ms: nowMs - 60000, end_ms: nowMs + 3600000 }],
      upcoming: [],
      overridden_ids: []
    }
  };
  const eff = await B.applyScheduleFromHeartbeat(policy, updates);
  check('適用: 予約により filter_mode が BLACKLIST になる', updates.filter_mode === 'BLACKLIST', updates.filter_mode);
  check('適用: 規制URLが合成される', updates.blacklist_urls.indexOf('youtube.com') >= 0, updates.blacklist_urls);
  check('適用: ベース値が保存される（緩めないための基準）',
    updates.base_filter_mode === 'OFF' && updates.base_blacklist_urls.length === 0);
  check('適用: 適用中の予約IDが入る', JSON.stringify(updates.schedule_active_ids) === '["s1"]', updates.schedule_active_ids);
  check('適用: 予約が storage にキャッシュされる', !!(STORE['schedule_cache'] && STORE['schedule_cache'].schedules), Object.keys(STORE));

  // 時計補正が入る（server が 2 秒進んでいる想定）
  resetEnv();
  const u2 = { screen_lock: false, filter_mode: 'OFF', whitelist_urls: [], blacklist_urls: [] };
  await B.applyScheduleFromHeartbeat({ screen_lock: false, filter_mode: 'OFF', server_time_ms: Date.now() + 2000, schedules: { active: [], upcoming: [], overridden_ids: [] } }, u2);
  check('適用: 時計補正値が updates に入る',
    typeof u2.clock_offset_ms === 'number' && Math.abs(u2.clock_offset_ms) > 0, u2.clock_offset_ms);

  // schedules が無い応答でもキャッシュで判定を続ける（オフライン保護）
  resetEnv();
  await B.persistScheduleCache({
    active: [{ id: 'c1', type: 'screen_lock', start_ms: Date.now() - 60000, end_ms: Date.now() + 3600000 }],
    upcoming: [], overridden_ids: []
  });
  const u3 = { screen_lock: false, filter_mode: 'OFF', whitelist_urls: [], blacklist_urls: [] };
  await B.applyScheduleFromHeartbeat({ screen_lock: false, filter_mode: 'OFF', server_time_ms: Date.now() }, u3);
  check('オフライン保護: schedules 欠落でもキャッシュで画面ロックが効く', u3.screen_lock === true, u3.screen_lock);

  // 解除済みは適用されない
  resetEnv();
  const u4 = { screen_lock: false, filter_mode: 'OFF', whitelist_urls: [], blacklist_urls: [] };
  await B.applyScheduleFromHeartbeat({
    screen_lock: false, filter_mode: 'OFF', server_time_ms: Date.now(),
    schedules: {
      active: [{ id: 'o1', type: 'screen_lock', start_ms: Date.now() - 60000, end_ms: Date.now() + 3600000 }],
      upcoming: [], overridden_ids: ['o1']
    }
  }, u4);
  check('解除: override 済みは画面ロックしない', u4.screen_lock === false, u4.screen_lock);

  // ============================================================ GAS 側 配信契約
  const CONFIG_SRC = extractConst(gasSrc, 'CONFIG');
  const SCHEDULE_COLUMNS = (function () {
    const m = gasSrc.match(/SCHEDULE_COLUMNS:\s*\[([\s\S]*?)\n\s*\],/);
    return m[1].split('\n').map(l => l.replace(/\/\/.*$/, '').trim())
      .filter(l => /^'/.test(l)).map(l => l.replace(/^'/, '').replace(/',?$/, ''));
  })();

  const gasPieces = [CONFIG_SRC, 'const SHEET_TZ_OFFSET_MS = 9 * 60 * 60 * 1000;'];
  gasPieces.push(extractConst(gasSrc, 'SCH_MONTHS_'));
  try { gasPieces.push(extractConst(gasSrc, 'SCHOOL_ALIASES')); } catch (e) { gasPieces.push('const SCHOOL_ALIASES = {};'); }

  const GAS_FNS = [
    'getHeaderMap', 'parseBoolean', 'parseUrlList',
    'schPad2_', 'schIsDate_', 'schJstParts_', 'scheduleDatePart_', 'scheduleTimePart_',
    'schedulePartsToMs_', 'schMsToJstStr_', 'schTimeOfDayMs_', 'parseWeekdays_',
    'schJstDateStr_', 'schJstDow_', 'sheetTsToMs', 'expandScheduleWindows_',
    'normalizeSchoolName', 'schoolNamesMatch', 'resolveCanonicalSchool', 'isAllSchoolsName',
    'normalizeClassName', 'deviceMatchesSchedule_', 'readScheduleRows_',
    'buildSchedulePayloadForDevice_', 'buildHeartbeatResponse'
  ];
  GAS_FNS.forEach(n => gasPieces.push(extractFn(gasSrc, n)));
  gasPieces.push('function getTargetSheet(name){ return __SHEETS[name]; }');
  gasPieces.push([
    'function ensureScheduleHeaders(sheet){',
    '  if (sheet.getLastColumn() === 0) {',
    '    sheet._cols = CONFIG.SCHEDULE_COLUMNS.slice();',
    '    sheet._rows[0] = CONFIG.SCHEDULE_COLUMNS.slice();',
    '  }',
    '}'
  ].join('\n'));
  gasPieces.push('globalThis.__G = { CONFIG: CONFIG, ' + GAS_FNS.join(', ') + ' };');

  const devCols = JSON.parse(JSON.stringify(
    (function () {
      const m = GAS_SRC_DEVICE_COLS();
      return m;
    })()
  ));
  function GAS_SRC_DEVICE_COLS() {
    const m = gasSrc.match(/DEVICE_COLUMNS:\s*\[([\s\S]*?)\n\s*\],/);
    return m[1].split('\n').map(l => l.replace(/\/\/.*$/, '').trim())
      .filter(l => /^'/.test(l)).map(l => l.replace(/^'/, '').replace(/',?$/, ''));
  }

  const mkRow = function (cols, map) {
    const row = cols.map(() => '');
    Object.keys(map).forEach(k => {
      const i = cols.indexOf(k);
      if (i >= 0) row[i] = map[k];
    });
    return row;
  };

  const devRow = mkRow(devCols, {
    '児童ID': 's1', '学校名': '第一小学校', '氏名': '第一 一郎', 'クラス': '5年1組',
    '画面ロック': false, 'URL規制モード': 'OFF', '許可URLリスト': '', '規制URLリスト': ''
  });
  const schRow = mkRow(SCHEDULE_COLUMNS, {
    'スケジュールID': 'sch_test_1', '対象種別': 'class', '学校名': '第一小学校',
    'クラス名': '5年1組', '制限タイプ': 'url_block', 'URL規制モード': 'BLACKLIST',
    '規制URLリスト': 'youtube.com', '開始日': '2026/11/10', '終了日': '2026/11/10',
    '繰り返し': 'NONE', '開始時刻': '19:00', '終了時刻': '21:00',
    '有効': true, '手動解除': false
  });

  const gasSheets = {
    '端末一覧': makeSheet(devCols, [devCols.slice(), devRow]),
    'スケジュール管理': makeSheet(SCHEDULE_COLUMNS, [SCHEDULE_COLUMNS.slice(), schRow])
  };

  const gasCtx = vm.createContext({
    console: { log() {} },
    Logger: { log() {} },
    __SHEETS: gasSheets
  });
  vm.runInContext(gasPieces.join('\n\n'), gasCtx, { filename: 'gas_contract_vm.js' });
  const G = gasCtx.__G;

  const headerMap = G.getHeaderMap(gasSheets['端末一覧'], G.CONFIG.DEVICE_COLUMNS);
  const kaInfo = { sync_interval_sec: 1.5, idle_drift_until: 0 };

  // 19:30 → 窓の内側
  const resIn = G.buildHeartbeatResponse(devRow, headerMap, 's1', true, kaInfo, '2026/11/10 19:30:00');
  check('契約: server_time_ms を数値で返す', typeof resIn.server_time_ms === 'number' && resIn.server_time_ms > 0, resIn.server_time_ms);
  check('契約: server_time_ms は server_time と同じ瞬間',
    resIn.server_time_ms === G.sheetTsToMs('2026/11/10 19:30:00'), resIn.server_time_ms);
  check('契約: schedules の3キーが揃う',
    !!(resIn.schedules && Array.isArray(resIn.schedules.active) &&
       Array.isArray(resIn.schedules.upcoming) && Array.isArray(resIn.schedules.overridden_ids)));
  check('契約: 時間内なら active に1件', resIn.schedules.active.length === 1, resIn.schedules.active.length);
  check('契約: active に start_ms/end_ms が入る',
    resIn.schedules.active[0].start_ms > 0 && resIn.schedules.active[0].end_ms > resIn.schedules.active[0].start_ms,
    resIn.schedules.active[0]);
  check('契約: 制限タイプと規制URLが伝わる',
    resIn.schedules.active[0].type === 'url_block' &&
    resIn.schedules.active[0].filter_mode === 'BLACKLIST' &&
    String(resIn.schedules.active[0].blacklist).indexOf('youtube.com') >= 0, resIn.schedules.active[0]);
  check('契約: 既存の応答項目が壊れていない',
    resIn.student_id === 's1' && resIn.class_name === '5年1組' && resIn.filter_mode === 'OFF' && resIn.ka_active === true);

  // 18:00 → 時間外（upcoming に 19:00）
  const resOut = G.buildHeartbeatResponse(devRow, headerMap, 's1', true, kaInfo, '2026/11/10 18:00:00');
  check('契約: 時間外なら active は空', resOut.schedules.active.length === 0, resOut.schedules.active.length);
  check('契約: 時間外なら upcoming に1件', resOut.schedules.upcoming.length === 1, resOut.schedules.upcoming.length);
  check('契約: upcoming の開始は 19:00 JST',
    resOut.schedules.upcoming[0].start_jst === '2026/11/10 19:00', resOut.schedules.upcoming[0].start_jst);

  // 終了後（21:30）→ active 空
  const resAfter = G.buildHeartbeatResponse(devRow, headerMap, 's1', true, kaInfo, '2026/11/10 21:30:00');
  check('契約: 終了後は active 空', resAfter.schedules.active.length === 0, resAfter.schedules.active.length);
  check('契約: 予約は消えず監査ログとして残る',
    G.readScheduleRows_().length === 1, G.readScheduleRows_().length);

  // ------------------------------------------------------------ G. 不変条件
  const manifest = JSON.parse(manifestRaw);
  check('不変条件: version は v1.6.4 のまま', manifest.version === '1.6.4', manifest.version);
  check('不変条件: default_popup を持たない', !manifest.action || !manifest.action.default_popup);
  check('不変条件: alarms 権限がある（追加不要）',
    Array.isArray(manifest.permissions) && manifest.permissions.indexOf('alarms') >= 0, manifest.permissions);

  // 予約判定は通信を伴わない（オフラインでも発動できる）
  const reEval = extractFn(bgSrc, 'reevaluateSchedules');
  check('不変条件: 再評価は fetch を行わない', !/fetch\s*\(/.test(reEval));
  const armFn = extractFn(bgSrc, 'armScheduleAlarms');
  check('不変条件: アラーム設定は fetch を行わない', !/fetch\s*\(/.test(armFn));

  // アラーム名が chrome.alarms.onAlarm で処理されている
  check('配線: scheduleEdge/scheduleTick がアラーム受信で処理される',
    /alarm\.name === 'scheduleEdge'/.test(bgSrc) && /alarm\.name === 'scheduleTick'/.test(bgSrc));
  // applyPolicies の出口で合成している
  check('配線: applyPolicies が applyScheduleFromHeartbeat を呼ぶ',
    /await applyScheduleFromHeartbeat\(newPolicy, updates\)/.test(bgSrc));
  // 起動時復元
  check('配線: 起動時にスケジュールを復元する', /await restoreSchedulesOnBoot\(\)/.test(bgSrc));

  console.log('');
  console.log('===== 結果: PASS=' + pass + ' FAIL=' + fail + ' =====');
  process.exit(fail > 0 ? 1 : 0);
})();
