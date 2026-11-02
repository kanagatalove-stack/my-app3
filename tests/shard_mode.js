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
// ===== SHARD_MODE（子GAS動的分散ルーティング）の回帰テスト =====
//  検証対象:
//   [GAS]  SHARD_MODE=false のとき、応答に assigned_gas_url を一切足さない（従来動作と同一）
//   [GAS]  SHARD_MODE=true  のとき、クラス→子GAS URL を返す（表記ゆれ吸収・既定URL・未一致）
//   [GAS]  共有シークレット不一致は拒否（安全側）
//   [GAS]  親コンソールの稼働状態（ka_active）を子へ伝達する／30秒に間引く
//   [EXT]  resolveGasUrl は assigned_gas_url を最優先する
//   [EXT]  6時間再確認で同じ子が返っても assigned_at が更新される（無限ループ防止）
//   [EXT]  子GASへ3回連続失敗したら親へ切り戻す（端末の孤立防止）
//   [EXT]  切り戻し直後は再割り当てを受けない（失敗の無限往復防止）
//   [EXT]  未割り当て時はストレージを読まない（既定運用のI/O増加ゼロ）
const fs = require('fs'), vm = require('vm');

const gasSrc = fs.readFileSync('/home/user/webapp/gas/Code.gs', 'utf8');
const bgSrc  = fs.readFileSync('/home/user/webapp/extension/background.js', 'utf8');

function extract(src, name) {
  // async function も拾えるようにする（applyShardAssignment / noteShardOutcome が該当）
  const re = new RegExp('^(?:async\\s+)?function ' + name + '\\s*\\(', 'm');
  const start = src.search(re);
  if (start < 0) throw new Error('not found: ' + name);
  let i = src.indexOf('{', start), depth = 0, end = -1;
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break; } } }
  return src.slice(start, end + 1);
}
// 数値・真偽値・文字列の const（1行で完結するもの）を取り出す
function lineConst(src, name) {
  const re = new RegExp('^const ' + name + '\\s*=[^;]*;', 'm');
  const m = src.match(re);
  if (!m) throw new Error('not found const: ' + name);
  return m[0];
}

async function main() {
  let pass = 0, fail = 0;
  function check(n, c, e) { if (c) { console.log('PASS', n, e !== undefined ? '=> ' + JSON.stringify(e) : ''); pass++; } else { console.log('FAIL', n, e !== undefined ? '=> ' + JSON.stringify(e) : ''); fail++; } }

  // =========================================================================
  // §1  GAS側
  // =========================================================================
  console.log('===== [GAS] 子GAS分散: クラス解決・シークレット・ka伝達 =====');

  function makeProps(init) {
    const store = Object.assign({}, init || {});
    return {
      getScriptProperties() {
        return {
          getProperty(k) { return (k in store) ? store[k] : null; },
          setProperty(k, v) { store[k] = String(v); }
        };
      }
    };
  }
  function makeCache() {
    const store = {};
    return {
      getScriptCache() {
        return {
          get(k) { return (k in store) ? store[k] : null; },
          put(k, v) { store[k] = String(v); },
          remove(k) { delete store[k]; }
        };
      }
    };
  }

  const CONFIG = {
    DEVICE_COLUMNS: ['児童ID','学校名','氏名','クラス','画面ロック','URL規制モード','許可URLリスト','規制URLリスト','一斉表示URL','一斉表示実行ID','現在開いているURL','最終同期日時','備考'],
    DEVICE_SHEET_NAME: '端末一覧',
    SHARD_MODE: false,
    SHARD_CHILD_MODE: false,
    // プロパティ未設定時に使う既定値（本番 CONFIG と同じ役割）
    SHARD_MAP: {},
    SHARD_DEFAULT_URL: '',
    SHARD_SECRET: '',
    SPREADSHEET_ID: 'SS_TEST'
  };

  const touchLog = [];
  const fetchLog = [];
  const fetchAllLog = []; // 並列（fetchAll）が使われたかを検証する
  // モックは差し替えるため、状態は1段外側のオブジェクトに置く（コンテキストのプロパティ再代入に依存しない）
  const gstate = { props: makeProps({}), cache: makeCache(), sheet: null };

  // 子GASのシートを模したモック（行の有無で一括操作の成否が変わることを検証する）
  function makeSheet(cols, rows) {
    return {
      _cols: cols.slice(), _rows: rows.map(r => r.slice()),
      getLastColumn() { return this._cols.length; },
      getLastRow() { return this._rows.length; },
      getDataRange() { const self = this; return { getValues() { return self._rows.map(r => r.slice()); } }; },
      getRange(r, c, nr, nc) { const self = this; return {
        getValues() { const out = []; for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) row.push((self._rows[r - 1 + i] || [])[c - 1 + j]); out.push(row); } return out; },
        setValues(vals) { vals.forEach((rr, i) => rr.forEach((v, j) => { if (!self._rows[r - 1 + i]) self._rows[r - 1 + i] = []; self._rows[r - 1 + i][c - 1 + j] = v; })); return this; },
        setValue(v) { if (!self._rows[r - 1]) self._rows[r - 1] = []; self._rows[r - 1][c - 1] = v; return this; }
      }; },
      appendRow(row) { this._rows.push(row.slice()); }
    };
  }

  const ctx = {
    console, JSON, Date, Math, String, Number, Array, Object, Boolean, isNaN, parseInt, parseFloat, Set, Map, RegExp, Error, Promise,
    CONFIG,
    PropertiesService: { getScriptProperties() { return gstate.props.getScriptProperties(); } },
    CacheService: { getScriptCache() { return gstate.cache.getScriptCache(); } },
    UrlFetchApp: {
      fetch(url, opt) {
        fetchLog.push({ url: url, payload: String((opt && opt.payload) || ''), mode: 'single' });
        return { getResponseCode() { return 200; }, getContentText() { return '{"success":true}'; } };
      },
      // 実機の UrlFetchApp.fetchAll と同じく「リクエスト配列 → 応答配列」を返す。
      fetchAll(reqs) {
        const arr = Array.isArray(reqs) ? reqs : [];
        fetchAllLog.push({
          count: arr.length,
          urls: arr.map(function (r) { return r.url; }),
          payloads: arr.map(function (r) { return String((r && r.payload) || ''); })
        });
        return arr.map(function (r) {
          fetchLog.push({ url: r.url, payload: String((r && r.payload) || ''), mode: 'parallel' });
          return { getResponseCode() { return 200; }, getContentText() { return '{"success":true}'; } };
        });
      }
    },
    LockService: { getScriptLock() { return { waitLock() {}, releaseLock() {} }; } },
    Utilities: { formatDate() { return '2026/01/01 00:00:00'; } },
    Logger: { log() {} },
    // shardApplyFromParent が呼ぶ既存API（子側の ka 機構・一括更新）
    touchTeacherConsole(id) { touchLog.push({ type: 'touch', id: id }); return { success: true }; },
    releaseTeacherConsole(id) { touchLog.push({ type: 'release', id: id }); return { success: true }; },
    bulkUpdateScreenLock(ids, v) { touchLog.push({ type: 'lock', ids: ids, v: v, rowsAtCall: gstate.sheet ? gstate.sheet._rows.length : -1 }); },
    bulkUpdateBroadcastUrl(ids, u) { touchLog.push({ type: 'bc', ids: ids, u: u, rowsAtCall: gstate.sheet ? gstate.sheet._rows.length : -1 }); },
    bulkUpdateFilterMode(ids, m, w, b) { touchLog.push({ type: 'filter', ids: ids, m: m, rowsAtCall: gstate.sheet ? gstate.sheet._rows.length : -1 }); },
    getTargetSheet() { return gstate.sheet; },
    getHeaderMap() { return gstate.headerMap || {}; },
    // shardUrlsForTeacher が参照する「対象クラス」。テストから差し替えられるよう外から与える。
    getTeacherTargetClasses(teacher) { return (teacher && teacher.__targets) || []; },
    // getShardMergedDevices のテスト用スタブ（親シート集計とマージを差し替え）
    getAllDevices(filterSchool, teacher, includeUnassigned) {
      gstate.getAllCalls = (gstate.getAllCalls || 0) + 1;
      return [{ student_id: 'parent-1', class_name: '5年1組' }];
    },
    shardMergeDevices(base, filterSchool, teacher, includeUnassigned) {
      gstate.mergeCalls = (gstate.mergeCalls || 0) + 1;
      return (Array.isArray(base) ? base.slice() : []).concat([{ student_id: 'child-1', class_name: '5年1組' }]);
    }
  };

  let gasBundle = '';
  gasBundle += lineConst(gasSrc, 'SHARD_MAP_PROP') + '\n';
  gasBundle += lineConst(gasSrc, 'SHARD_DEFAULT_PROP') + '\n';
  gasBundle += lineConst(gasSrc, 'SHARD_SECRET_PROP') + '\n';
  gasBundle += lineConst(gasSrc, 'SHARD_CFG_CACHE') + '\n';
  gasBundle += lineConst(gasSrc, 'SHARD_LIST_CACHE_TTL') + '\n';
  gasBundle += lineConst(gasSrc, 'SHARD_LIST_CACHE_PREFIX') + '\n';
  // シート日時の解釈（実行タイムゾーン非依存）。R29 で追加。
  gasBundle += lineConst(gasSrc, 'SHEET_TZ_OFFSET_MS') + '\n';
  gasBundle += extract(gasSrc, 'sheetTsToMs') + '\n';
  // 動的解決（スクリプトプロパティ優先）用の定数
  gasBundle += lineConst(gasSrc, 'PROP_SHARD_MODE') + '\n';
  gasBundle += lineConst(gasSrc, 'PROP_SHARD_CHILD_MODE') + '\n';
  gasBundle += lineConst(gasSrc, 'PROP_SPREADSHEET_ID') + '\n';
  gasBundle += lineConst(gasSrc, 'SHARD_MODE_CACHE') + '\n';
  gasBundle += lineConst(gasSrc, 'SHARD_SSID_CACHE') + '\n';
  gasBundle += lineConst(gasSrc, 'SHARD_PARENT_PROP') + '\n';
  gasBundle += lineConst(gasSrc, 'SHARD_LOOKUP_CACHE_PREFIX') + '\n';
  [
    // shardEnsureDeviceRows / shardUpsert 系が使う排他制御（実物をそのまま使う）
    'withWriteLock',
    // 動的解決（スクリプトプロパティ優先・CONFIG フォールバック）
    'cfgWarn','propRaw','propBool','propStr','shardModeFlags','shardWarnOnce',
    'shardMapDefaultFromEmptyKey',
    'isShardParent','isShardChild','normalizeShardClass',
    'readShardMapRaw','readShardDefaultUrl','getOrCreateShardSecret','shardSecretMatches',
    'shardConfigCached','invalidateShardConfig','shardMapIndexFromMap',
    'resolveShardForHeartbeat','shardApplyFromParent','shardEnsureDeviceRows',
    'shardAllChildUrls','shardPropagateKaState',
    // fetchAll 並列化・キャッシュ・教員スコープ絞り込み（今回の最適化）
    'shardHash','shardDevVersion','shardFetchMany','shardUrlsForTeacher',
    'shardFetchChildDevices','getShardMergedDevices','shardPropagatePolicy',
    // 親子の突き合わせ統合（split-brain 解消の本体）
    'shardMergeDeviceRow',
    // 児童ID照合と親名簿照会（クラス未取得の端末を救う経路）
    'normalizeIdKey','findStudentById','shardLookupStudent','readShardParentUrl',
    'shardLookupFromParent','hbChildIdentityLookup','hbApplyChildIdentity'
  ].forEach(n => { gasBundle += extract(gasSrc, n) + '\n'; });

  vm.createContext(ctx);
  vm.runInContext(gasBundle, ctx);

  // --- §1-1 クラス名の正規化（表記ゆれの吸収） ---
  const nz = ctx.normalizeShardClass;
  check('「5年1組」→ 5-1', nz('5年1組') === '5-1', nz('5年1組'));
  check('「５年１組」（全角）→ 5-1', nz('５年１組') === '5-1', nz('５年１組'));
  check('「5-1」→ 5-1', nz('5-1') === '5-1', nz('5-1'));
  check('「5/1」→ 5-1', nz('5/1') === '5-1', nz('5/1'));
  check('「5年 1組」（空白入り）→ 5-1', nz('5年 1組') === '5-1', nz('5年 1組'));
  check('「5年1組」と「５年１組」が同一キーになる', nz('5年1組') === nz('５年１組'));
  check('「6組」だけ → 6-1', nz('6組') === '6-1', nz('6組'));
  check('空文字は空のまま', nz('') === '', nz(''));
  check('「未設定」は空（割り当て対象外）', nz('未設定') === '', nz('未設定'));

  // --- §1-2 SHARD_MODE=false: 何も足さない（従来動作と完全同一） ---
  console.log('===== [GAS] SHARD_MODE=false は従来動作と同一 =====');
  CONFIG.SHARD_MODE = false;
  gstate.props = makeProps({ SHARD_MAP_V1: JSON.stringify({ '5年1組': 'https://child-a/exec' }) });
  gstate.cache = makeCache();
  ctx.invalidateShardConfig();
  const off = ctx.resolveShardForHeartbeat('s1@x.ed.jp', '5年1組');
  check('SHARD_MODE=false → 応答に assigned_gas_url を含めない', !('assigned_gas_url' in off), off);
  check('SHARD_MODE=false → isShardParent() が false', ctx.isShardParent() === false);

  // --- §1-3 SHARD_MODE=true: クラスに応じた子GASを返す ---
  console.log('===== [GAS] SHARD_MODE=true: クラス→子GAS割り当て =====');
  CONFIG.SHARD_MODE = true;
  gstate.props = makeProps({ SHARD_MAP_V1: JSON.stringify({ '5年1組': 'https://child-a/exec', '6年1組': 'https://child-b/exec' }) });
  gstate.cache = makeCache();
  ctx.invalidateShardConfig();

  const hit1 = ctx.resolveShardForHeartbeat('s1@x.ed.jp', '5年1組');
  check('5年1組 → child-a', hit1.assigned_gas_url === 'https://child-a/exec', hit1);
  check('割り当ての根拠クラスを返す', hit1.assigned_class === '5-1', hit1.assigned_class);
  check('shard_mode フラグを立てる', hit1.shard_mode === true);
  const hit2 = ctx.resolveShardForHeartbeat('s2@x.ed.jp', '６年１組');
  check('６年１組（全角）→ child-b', hit2.assigned_gas_url === 'https://child-b/exec', hit2);
  const miss = ctx.resolveShardForHeartbeat('s3@x.ed.jp', '3年2組');
  check('マップに無いクラス＋既定URLなし → 何も足さない', !('assigned_gas_url' in miss), miss);

  // 既定URLがある場合はそちらへ
  gstate.props = makeProps({ SHARD_MAP_V1: JSON.stringify({ '5年1組': 'https://child-a/exec' }), SHARD_DEFAULT_URL: 'https://child-z/exec' });
  gstate.cache = makeCache();
  ctx.invalidateShardConfig();
  const def = ctx.resolveShardForHeartbeat('s4@x.ed.jp', '3年2組');
  check('マップに無いクラス → 既定URLへ', def.assigned_gas_url === 'https://child-z/exec', def);

  // --- §1-4 共有シークレット ---
  console.log('===== [GAS] 共有シークレットの検証 =====');
  gstate.props = makeProps({});
  ctx.invalidateShardConfig();
  const sec = ctx.getOrCreateShardSecret();
  check('シークレットが自動生成される', typeof sec === 'string' && sec.length > 8, sec);
  check('生成は冪等（2回目も同じ値）', ctx.getOrCreateShardSecret() === sec);
  check('正しいシークレットは一致', ctx.shardSecretMatches(sec) === true);
  check('誤ったシークレットは不一致', ctx.shardSecretMatches('wrong-value-here') === false);
  check('空のシークレットは不一致（安全側）', ctx.shardSecretMatches('') === false);
  check('undefined は不一致', ctx.shardSecretMatches(undefined) === false);
  gstate.props = makeProps({});  // 未設定のまま
  check('未設定のスクリプトは誰も通さない', ctx.shardSecretMatches('') === false);

  // --- §1-5 子側: 親からの指示適用（ka_active の伝達が要） ---
  console.log('===== [GAS] 子側: 親からの指示適用（ka_active 伝達） =====');
  gstate.props = makeProps({ SHARD_SECRET: 'sk_test12345678' });
  gstate.cache = makeCache();
  CONFIG.SHARD_MODE = false;
  CONFIG.SHARD_CHILD_MODE = false;
  ctx.invalidateShardConfig();
  const notChild = ctx.shardApplyFromParent({ shard_secret: 'sk_test12345678', ka_active: true });
  check('役割未設定のスクリプトは shard_apply を拒否', notChild.success === false, notChild);

  CONFIG.SHARD_CHILD_MODE = true;
  ctx.invalidateShardConfig();
  touchLog.length = 0;
  const bad = ctx.shardApplyFromParent({ shard_secret: 'WRONG', ka_active: true });
  check('シークレット不一致は拒否', bad.success === false && /unauthorized/.test(String(bad.error)), bad);
  check('拒否時は ka を触らない', touchLog.length === 0, touchLog);

  touchLog.length = 0;
  const kaOn = ctx.shardApplyFromParent({ shard_secret: 'sk_test12345678', student_ids: [], ka_active: true });
  check('ka_active=true で子のコンソール稼働を立てる', kaOn.success === true && kaOn.ka_active === true, kaOn);
  check('子は touchTeacherConsole を呼ぶ（＝永久 false の回避）',
    touchLog.length === 1 && touchLog[0].type === 'touch' && touchLog[0].id === '__shard_parent__', touchLog);

  touchLog.length = 0;
  const kaOff = ctx.shardApplyFromParent({ shard_secret: 'sk_test12345678', student_ids: [], ka_active: false });
  check('ka_active=false で解放する', kaOff.ka_active === false && touchLog[0].type === 'release', touchLog);

  touchLog.length = 0;
  const lockApply = ctx.shardApplyFromParent({
    shard_secret: 'sk_test12345678', student_ids: ['s1@x.ed.jp', 's2@x.ed.jp'], patch: { screen_lock: true }
  });
  check('ポリシー指示（ロック）を子のシートへ適用する', lockApply.success === true && lockApply.applied === 2, lockApply);
  check('子は bulkUpdateScreenLock を呼ぶ', touchLog.some(t => t.type === 'lock' && t.v === true), touchLog);

  touchLog.length = 0;
  ctx.shardApplyFromParent({
    shard_secret: 'sk_test12345678', student_ids: ['s1@x.ed.jp'],
    patch: { filter_mode: 'WHITELIST', whitelist_urls: 'a.jp', blacklist_urls: '' }
  });
  check('ポリシー指示（URL規制）を子へ適用する', touchLog.some(t => t.type === 'filter' && t.m === 'WHITELIST'), touchLog);

  // --- §1-5b 【バグ修正3】子に行が無い児童への一括操作が無言で失敗しない ---
  //   子のシートには「その子へハートビートした端末」しか行が無い。
  //   bulkUpdateScreenLock 等は対象行が無いと何もせず正常終了するため、
  //   指示より先に行を用意しないと一括ロックが永久に効かない。
  console.log('===== [GAS] 子に行が無い児童への一括操作（行の自動用意） =====');
  const COLS = CONFIG.DEVICE_COLUMNS;
  function headerMapOf(cols) {
    const m = {}; cols.forEach((c, i) => { m[c] = i + 1; }); return m;
  }
  gstate.headerMap = headerMapOf(COLS);

  // 子のシートは空（ヘッダーのみ）
  gstate.sheet = makeSheet(COLS, [COLS.slice()]);
  touchLog.length = 0;
  const emptyApply = ctx.shardApplyFromParent({
    shard_secret: 'sk_test12345678',
    student_ids: ['n1@x.ed.jp', 'n2@x.ed.jp'],
    class_map: { 'n1@x.ed.jp': '5年1組', 'n2@x.ed.jp': '6年2組' },
    patch: { screen_lock: true }
  });
  check('行が無くても指示は成功する', emptyApply.success === true && emptyApply.applied === 2, emptyApply);
  check('指示された児童の行が子のシートに作られる', gstate.sheet._rows.length === 3, { rows: gstate.sheet._rows.length - 1 });
  const lockCall = touchLog.find(t => t.type === 'lock');
  check('一括更新は「行を作った後」に呼ばれる', !!lockCall && lockCall.rowsAtCall === 3, lockCall);
  const idIdx = COLS.indexOf('児童ID');
  const clsIdx = COLS.indexOf('クラス');
  check('作られた行に児童IDが入る',
    gstate.sheet._rows[1][idIdx] === 'n1@x.ed.jp' && gstate.sheet._rows[2][idIdx] === 'n2@x.ed.jp',
    gstate.sheet._rows.slice(1).map(r => r[idIdx]));
  check('class_map のクラス名が行に入る（子のシートが「未設定」で埋まらない）',
    gstate.sheet._rows[1][clsIdx] === '5年1組' && gstate.sheet._rows[2][clsIdx] === '6年2組',
    gstate.sheet._rows.slice(1).map(r => r[clsIdx]));

  // 既に行がある児童は重複作成しない
  touchLog.length = 0;
  ctx.shardApplyFromParent({
    shard_secret: 'sk_test12345678',
    student_ids: ['n1@x.ed.jp', 'n3@x.ed.jp'],
    class_map: { 'n1@x.ed.jp': '5年1組', 'n3@x.ed.jp': '4年1組' },
    patch: { screen_lock: false }
  });
  check('既存児童の行は重複作成しない', gstate.sheet._rows.length === 4, { rows: gstate.sheet._rows.length - 1 });
  check('新規児童の行だけ増える', gstate.sheet._rows[3][idIdx] === 'n3@x.ed.jp', gstate.sheet._rows[3][idIdx]);

  // 一斉表示・URL規制でも同じく行が用意される
  gstate.sheet = makeSheet(COLS, [COLS.slice()]);
  touchLog.length = 0;
  ctx.shardApplyFromParent({
    shard_secret: 'sk_test12345678', student_ids: ['b1@x.ed.jp'],
    class_map: { 'b1@x.ed.jp': '3年1組' }, patch: { broadcast_url: 'https://example.com/live' }
  });
  check('一斉表示でも先に行を作る', gstate.sheet._rows.length === 2 && touchLog.some(t => t.type === 'bc' && t.rowsAtCall === 2), touchLog);

  gstate.sheet = makeSheet(COLS, [COLS.slice()]);
  touchLog.length = 0;
  ctx.shardApplyFromParent({
    shard_secret: 'sk_test12345678', student_ids: ['f1@x.ed.jp'],
    class_map: { 'f1@x.ed.jp': '2年1組' },
    patch: { filter_mode: 'BLACKLIST', whitelist_urls: '', blacklist_urls: 'x.jp' }
  });
  check('URL規制でも先に行を作る', gstate.sheet._rows.length === 2 && touchLog.some(t => t.type === 'filter' && t.rowsAtCall === 2), touchLog);

  // 行が既に揃っていれば、余計な append はしない（I/O を増やさない）
  gstate.sheet = makeSheet(COLS, [COLS.slice(), (function () { const r = new Array(COLS.length).fill(''); r[idIdx] = 'e1@x.ed.jp'; return r; })()]);
  const rowsBefore = gstate.sheet._rows.length;
  ctx.shardEnsureDeviceRows(['e1@x.ed.jp'], {});
  check('既存児童だけなら行を追加しない', gstate.sheet._rows.length === rowsBefore, { rows: gstate.sheet._rows.length });
  check('空の対象リストでは何もしない', ctx.shardEnsureDeviceRows([], {}) === 0);
  gstate.sheet = null;
  gstate.headerMap = null;

  // --- §1-6 親側: ka 状態を子へ配る（30秒間引き） ---
  console.log('===== [GAS] 親側: ka_active を子GASへ伝達 =====');
  CONFIG.SHARD_MODE = true;
  CONFIG.SHARD_CHILD_MODE = false;
  gstate.props = makeProps({
    SHARD_SECRET: 'sk_test12345678',
    SHARD_MAP_V1: JSON.stringify({ '5年1組': 'https://child-a/exec', '6年1組': 'https://child-b/exec' })
  });
  gstate.cache = makeCache();
  ctx.invalidateShardConfig();
  fetchLog.length = 0;

  const prop1 = ctx.shardPropagateKaState(true);
  check('子GASの台数だけ送信する（重複除去）', prop1.sent === 2, prop1);
  check('shard_apply を ka_active=true で送る',
    fetchLog.length === 2 && /"ka_active":true/.test(fetchLog[0].payload), fetchLog.length);

  fetchLog.length = 0;
  const prop2 = ctx.shardPropagateKaState(true);
  check('30秒以内の再送は間引く（子への負荷を増やさない）', prop2.throttled === true && fetchLog.length === 0, prop2);

  fetchLog.length = 0;
  const prop3 = ctx.shardPropagateKaState(false);
  check('解放（false）は間引かず即時送信', prop3.sent === 2 && fetchLog.length === 2, prop3);
  check('ka_active=false を送る', /"ka_active":false/.test(fetchLog[0].payload));

  // 子が1つも設定されていなければ送らない
  gstate.props = makeProps({ SHARD_SECRET: 'sk_test12345678' });
  gstate.cache = makeCache();
  ctx.invalidateShardConfig();
  fetchLog.length = 0;
  const propNone = ctx.shardPropagateKaState(true);
  check('子GAS未設定なら通信しない', propNone.skipped === true && fetchLog.length === 0, propNone);

  // =========================================================================
  // §2  拡張機能側（background.js）
  // =========================================================================
  console.log('===== [EXT] 動的ルーティング: assigned_gas_url の保存・切替・切戻し =====');

  function makeBgCtx() {
    const store = {};
    const calls = { get: 0, set: 0, sets: [] };
    const c = {
      console, JSON, Date, Math, String, Number, Array, Object, Boolean, isNaN, parseInt, parseFloat, Set, Map, RegExp, Error, Promise,
      chrome: {
        storage: {
          local: {
            get(keys) {
              calls.get++;
              return Promise.resolve(Object.assign({}, store));
            },
            set(obj) {
              calls.set++;
              calls.sets.push(JSON.parse(JSON.stringify(obj)));
              Object.assign(store, obj);
              return Promise.resolve();
            }
          }
        }
      },
      __store: store,
      __calls: calls
    };
    vm.createContext(c);
    let bundle = '';
    bundle += lineConst(bgSrc, 'SHARD_RECHECK_MS') + '\n';
    bundle += lineConst(bgSrc, 'SHARD_FAIL_LIMIT') + '\n';
    bundle += lineConst(bgSrc, 'SHARD_COOLDOWN_MS') + '\n';
    // let 宣言は関数抽出の対象外なので、元コードと同じ宣言を用意する
    bundle += "let shardAssignedCache = '';\nlet shardFailCount = 0;\n";
    // const/let は語彙宣言のためコンテキストのプロパティにならない。var で明示的に公開する。
    bundle += 'var __recheckMs = SHARD_RECHECK_MS, __failLimit = SHARD_FAIL_LIMIT, __cooldownMs = SHARD_COOLDOWN_MS;\n';
    ['shardAssignedUrl','shardSyncMemory','applyShardAssignment','noteShardOutcome','normalizeSchoolKey','resolveGasUrl']
      .forEach(n => { bundle += extract(bgSrc, n) + '\n'; });
    vm.runInContext(bundle, c);
    return c;
  }

  // --- §2-1 resolveGasUrl の優先順位 ---
  console.log('===== [EXT] resolveGasUrl: 割り当て > 学校マップ > 直接URL =====');
  let bg = makeBgCtx();
  check('assigned_gas_url があれば最優先',
    bg.resolveGasUrl({
      assigned_gas_url: 'https://child-a/exec',
      gas_url_map: { '英田小学校': 'https://school-a/exec' },
      school_name: '英田小学校', gas_url: 'https://direct/exec'
    }) === 'https://child-a/exec');
  check('assigned_gas_url が空なら学校マップを使う（従来動作）',
    bg.resolveGasUrl({
      assigned_gas_url: '',
      gas_url_map: { '英田小学校': 'https://school-a/exec' },
      school_name: '英田小学校', gas_url: 'https://direct/exec'
    }) === 'https://school-a/exec');
  check('学校名なしなら直接URLへ',
    bg.resolveGasUrl({ gas_url: 'https://direct/exec' }) === 'https://direct/exec');
  check('assigned_gas_url が空白のみなら無視する',
    bg.resolveGasUrl({ assigned_gas_url: '   ', gas_url: 'https://direct/exec' }) === 'https://direct/exec');

  // --- §2-2 親からの割り当てを保存する ---
  console.log('===== [EXT] 初回通信: 親が返した子GAS URLを保存して切替 =====');
  bg = makeBgCtx();
  await bg.applyShardAssignment(
    { assigned_gas_url: 'https://child-a/exec', assigned_class: '5-1' },
    {}, 'https://parent/exec', true
  );
  check('割り当てURLを保存する', bg.__store.assigned_gas_url === 'https://child-a/exec', bg.__store.assigned_gas_url);
  check('割り当ての根拠クラスを保存する', bg.__store.assigned_class === '5-1', bg.__store.assigned_class);
  check('親URLを切り戻し先として保存する', bg.__store.assigned_from === 'https://parent/exec', bg.__store.assigned_from);
  check('失敗カウントは0に初期化', bg.__store.assigned_fail_count === 0);

  // --- §2-3 子と通信中は割り当てを維持（子は assigned_gas_url を返さない） ---
  bg = makeBgCtx();
  bg.__store.assigned_gas_url = 'https://child-a/exec';
  bg.__store.assigned_from = 'https://parent/exec';
  bg.__store.assigned_at = Date.now();
  const setBefore3 = bg.__calls.set;
  await bg.applyShardAssignment({ success: true }, { assigned_gas_url: 'https://child-a/exec' }, 'https://child-a/exec', false);
  check('子の応答に割り当てが無くても維持する', bg.__store.assigned_gas_url === 'https://child-a/exec', bg.__store.assigned_gas_url);
  check('子と通信中は書き込みもしない（I/O削減）', bg.__calls.set === setBefore3, { set: bg.__calls.set - setBefore3 });

  // --- §2-4 【バグ修正1】6時間再確認後に assigned_at が更新される ---
  console.log('===== [EXT] 6時間再確認の無限ループ防止（assigned_at の更新） =====');
  bg = makeBgCtx();
  const oldAt = Date.now() - (7 * 60 * 60 * 1000); // 7時間前
  bg.__store.assigned_gas_url = 'https://child-a/exec';
  bg.__store.assigned_from = 'https://parent/exec';
  bg.__store.assigned_at = oldAt;
  const dataOld = {
    assigned_gas_url: 'https://child-a/exec',
    assigned_from: 'https://parent/exec',
    assigned_at: oldAt
  };
  // 親へ再確認 → 同じ子GASが返るケース
  await bg.applyShardAssignment(
    { assigned_gas_url: 'https://child-a/exec', assigned_class: '5-1' },
    dataOld, 'https://parent/exec', true
  );
  check('同じ子GASが返っても assigned_at を更新する', bg.__store.assigned_at > oldAt, { old: oldAt, now: bg.__store.assigned_at });
  check('更新後は再確認条件を満たさない（＝毎回親へ送り続けない）',
    (Date.now() - bg.__store.assigned_at) < bg.__recheckMs);
  check('割り当て先は変わらない', bg.__store.assigned_gas_url === 'https://child-a/exec');

  // --- §2-5 親が割り当てを返さない＝分散解除。親へ戻す ---
  bg = makeBgCtx();
  bg.__store.assigned_gas_url = 'https://child-a/exec';
  bg.__store.assigned_from = 'https://parent/exec';
  bg.__store.assigned_at = Date.now();
  await bg.applyShardAssignment({ success: true }, { assigned_gas_url: 'https://child-a/exec' }, 'https://parent/exec', true);
  check('親が割り当てを返さない → 割り当てを捨てる（SHARD_MODE無効化に追従）',
    bg.__store.assigned_gas_url === '', bg.__store.assigned_gas_url);
  check('切り戻し先もクリアする', bg.__store.assigned_from === '');

  // --- §2-6 【バグ修正2】未割り当て時はストレージを読まない ---
  console.log('===== [EXT] 未割り当て時はI/Oゼロ（既定運用の負荷を増やさない） =====');
  bg = makeBgCtx();
  bg.shardSyncMemory({});  // 割り当てなし
  const beforeGet = bg.__calls.get, beforeSet = bg.__calls.set;
  await bg.noteShardOutcome(false);
  await bg.noteShardOutcome(false);
  await bg.noteShardOutcome(false);
  await bg.noteShardOutcome(true);
  check('未割り当て（SHARD_MODE=false運用）では storage.get を呼ばない', bg.__calls.get === beforeGet, { get: bg.__calls.get - beforeGet });
  check('未割り当てでは storage.set も呼ばない', bg.__calls.set === beforeSet, { set: bg.__calls.set - beforeSet });

  // --- §2-7 子GASへ3回連続失敗 → 親へ切り戻す ---
  console.log('===== [EXT] 子GAS連続失敗で親へ切り戻す（端末の孤立防止） =====');
  bg = makeBgCtx();
  bg.__store.assigned_gas_url = 'https://child-a/exec';
  bg.shardSyncMemory(bg.__store);
  await bg.noteShardOutcome(false);
  check('1回目の失敗はカウントだけ', bg.__store.assigned_fail_count === 1 && bg.__store.assigned_gas_url === 'https://child-a/exec', bg.__store.assigned_fail_count);
  await bg.noteShardOutcome(false);
  check('2回目もまだ切り戻さない', bg.__store.assigned_fail_count === 2 && bg.__store.assigned_gas_url === 'https://child-a/exec', bg.__store.assigned_fail_count);
  await bg.noteShardOutcome(false);
  check('3回連続で親へ切り戻す', bg.__store.assigned_gas_url === '', bg.__store.assigned_gas_url);
  check('切り戻しフラグを立てる', bg.__store.shard_fallback === true);
  check('切り戻し時刻を記録する（クールダウン用）', Number(bg.__store.shard_fallback_at) > 0);

  // 成功したらカウントは戻る
  bg = makeBgCtx();
  bg.__store.assigned_gas_url = 'https://child-a/exec';
  bg.__store.assigned_fail_count = 2;
  bg.shardSyncMemory(bg.__store);
  await bg.noteShardOutcome(true);
  check('成功したら失敗カウントを0に戻す', bg.__store.assigned_fail_count === 0);

  // --- §2-8 切り戻し直後のクールダウン（失敗の無限往復防止） ---
  console.log('===== [EXT] 切り戻し直後の再割り当てを保留する =====');
  bg = makeBgCtx();
  const fbAt = Date.now();
  bg.__store.shard_fallback_at = fbAt;
  bg.shardSyncMemory(bg.__store);
  const setBefore8 = bg.__calls.set;
  await bg.applyShardAssignment(
    { assigned_gas_url: 'https://child-a/exec', assigned_class: '5-1' },
    { assigned_gas_url: '', shard_fallback_at: fbAt }, 'https://parent/exec', true
  );
  check('クールダウン中は再割り当てを保存しない（親に留まる）',
    !bg.__store.assigned_gas_url, bg.__store.assigned_gas_url);
  check('保存自体を行わない', bg.__calls.set === setBefore8, { set: bg.__calls.set - setBefore8 });

  // クールダウン明けは受け入れる
  bg = makeBgCtx();
  const longAgo = Date.now() - (60 * 60 * 1000); // 1時間前
  bg.__store.shard_fallback_at = longAgo;
  bg.shardSyncMemory(bg.__store);
  await bg.applyShardAssignment(
    { assigned_gas_url: 'https://child-a/exec', assigned_class: '5-1' },
    { assigned_gas_url: '', shard_fallback_at: longAgo }, 'https://parent/exec', true
  );
  check('クールダウン明けは再割り当てを受け入れる',
    bg.__store.assigned_gas_url === 'https://child-a/exec', bg.__store.assigned_gas_url);
  check('再割り当て時にクールダウンを解除する', bg.__store.shard_fallback_at === 0);

  // =========================================================================
  // §3  get_all 最適化（fetchAll 並列化・短時間キャッシュ・教員スコープ絞り込み）
  // =========================================================================
  console.log('===== [GAS] 子GAS取得の並列化（fetchAll） =====');

  const SHARD_CACHE_KEY_CFG = 'shard_cfg3';
  function resetShard(propsInit) {
    gstate.props = makeProps(propsInit || {
      SHARD_SECRET: 'sk_test12345678',
      SHARD_MAP_V1: JSON.stringify({ '5年1組': 'https://child-a/exec', '6年1組': 'https://child-b/exec' })
    });
    gstate.cache = makeCache();
    gstate.sheet = null;
    gstate.headerMap = null;
    gstate.getAllCalls = 0;
    gstate.mergeCalls = 0;
    fetchLog.length = 0;
    fetchAllLog.length = 0;
    ctx.invalidateShardConfig();
  }

  // --- §3-1 fetchAll が使える環境では並列1回で送る ---
  resetShard();
  const threeReqs = [
    { url: 'https://c1/exec', method: 'post', payload: '{}', muteHttpExceptions: true },
    { url: 'https://c2/exec', method: 'post', payload: '{}', muteHttpExceptions: true },
    { url: 'https://c3/exec', method: 'post', payload: '{}', muteHttpExceptions: true }
  ];
  const many = ctx.shardFetchMany(threeReqs);
  check('fetchAll を 1 回だけ呼ぶ（直列ループにしない）', fetchAllLog.length === 1, { fetchAllCalls: fetchAllLog.length });
  check('全リクエストをまとめて渡す', fetchAllLog[0].count === 3, fetchAllLog[0]);
  check('応答数はリクエスト数と一致する', many.length === 3, many.length);
  check('直列 fetch は使わない（多重呼び出しなし）',
    fetchLog.filter(f => f.mode === 'single').length === 0,
    { single: fetchLog.filter(f => f.mode === 'single').length });

  // --- §3-2 fetchAll が無い環境では直列へフォールバック（挙動を壊さない） ---
  resetShard();
  const savedFetchAll = ctx.UrlFetchApp.fetchAll;
  delete ctx.UrlFetchApp.fetchAll;
  const fallback = ctx.shardFetchMany(threeReqs);
  check('fetchAll が無くても全件取得できる', fallback.length === 3, fallback.length);
  check('フォールバック時は直列 fetch を使う',
    fetchLog.filter(f => f.mode === 'single').length === 3,
    { single: fetchLog.filter(f => f.mode === 'single').length });
  ctx.UrlFetchApp.fetchAll = savedFetchAll;

  // --- §3-3 空配列・未定義でも落ちない ---
  check('空配列なら通信しない', ctx.shardFetchMany([]).length === 0);
  check('undefined でも落ちない', ctx.shardFetchMany(undefined).length === 0);

  // =========================================================================
  console.log('===== [GAS] 教員スコープに応じた子GASの絞り込み =====');
  resetShard();
  const cfg0 = ctx.shardConfigCached();

  // 管理者（対象クラスなし）→ 全子GAS
  const adminUrls = ctx.shardUrlsForTeacher(cfg0, { role: 'ADMIN', __targets: [] });
  check('管理者は全子GASを対象にする', adminUrls.length === 2, adminUrls);

  // 専科教員（対象クラス1つ）→ 該当する子GASのみ
  const specUrls = ctx.shardUrlsForTeacher(cfg0, { role: 'TEACHER', __targets: ['5年1組'] });
  check('専科教員は該当クラスの子GASだけを対象にする（1クラス分の通信で済む）',
    specUrls.length === 1 && specUrls[0] === 'https://child-a/exec', specUrls);

  // 表記ゆれ（全角・記号違い）でも一致する
  const specUrls2 = ctx.shardUrlsForTeacher(cfg0, { role: 'TEACHER', __targets: ['６年１組'] });
  check('全角表記でも子GASを特定できる',
    specUrls2.length === 1 && specUrls2[0] === 'https://child-b/exec', specUrls2);

  // 複数クラス担当 → 該当する複数の子GAS
  const multiUrls = ctx.shardUrlsForTeacher(cfg0, { role: 'TEACHER', __targets: ['5年1組', '6年1組'] });
  check('複数クラス担当なら該当する子GASをすべて対象にする', multiUrls.length === 2, multiUrls);

  // 一致なし → 安全側で全件へフォールバック（設定不備で児童が消えない）
  const noMatch = ctx.shardUrlsForTeacher(cfg0, { role: 'TEACHER', __targets: ['3年2組'] });
  check('該当が無ければ全件へフォールバックする（児童が消えない）', noMatch.length === 2, noMatch);

  // 既定URLは常に含める（クラス不明の児童の受け皿）
  resetShard({
    SHARD_SECRET: 'sk_test12345678',
    SHARD_MAP_V1: JSON.stringify({ '5年1組': 'https://child-a/exec' }),
    SHARD_DEFAULT_URL: 'https://child-z/exec'
  });
  const cfgDef = ctx.shardConfigCached();
  const withDef = ctx.shardUrlsForTeacher(cfgDef, { role: 'TEACHER', __targets: ['5年1組'] });
  check('既定URLは絞り込み後も必ず含める（取りこぼし防止）',
    withDef.indexOf('https://child-a/exec') >= 0 && withDef.indexOf('https://child-z/exec') >= 0, withDef);

  // =========================================================================
  console.log('===== [GAS] 子GAS取得の短時間キャッシュ（3〜5秒） =====');
  resetShard();
  ctx.shardFetchChildDevices();
  const fetchAfterFirst = fetchAllLog.length;
  ctx.shardFetchChildDevices();
  check('2回目はキャッシュに当たり子GASへ再通信しない',
    fetchAllLog.length === fetchAfterFirst, { first: fetchAfterFirst, after: fetchAllLog.length });

  // dev_v が進む（＝教員がロック/配信/規制をした）と自動的に失効する
  resetShard();
  ctx.shardFetchChildDevices();
  const beforeBump = fetchAllLog.length;
  ctx.CacheService.getScriptCache().put('dev_v', '99');
  ctx.shardFetchChildDevices();
  check('dev_v が進むと再取得する（操作直後は必ず最新）',
    fetchAllLog.length > beforeBump, { before: beforeBump, after: fetchAllLog.length });

  // =========================================================================
  console.log('===== [GAS] get_all 集約結果のキャッシュ =====');
  // 分散が無効なら getAllDevices をそのまま返す（キャッシュ層を挟まない＝従来と同一）
  resetShard();
  CONFIG.SHARD_MODE = false;
  ctx.invalidateShardConfig();
  const legacy1 = ctx.getShardMergedDevices('ALL', { role: 'ADMIN' }, false);
  const legacy2 = ctx.getShardMergedDevices('ALL', { role: 'ADMIN' }, false);
  check('SHARD_MODE=false は従来どおり毎回 getAllDevices を呼ぶ',
    gstate.getAllCalls === 2, { getAllCalls: gstate.getAllCalls });
  check('SHARD_MODE=false は子GASへ問い合わせない', gstate.mergeCalls === 0, { mergeCalls: gstate.mergeCalls });
  check('SHARD_MODE=false の戻り値は親のデータのみ', legacy1.length === 1 && legacy2.length === 1, legacy1.length);

  // 分散が有効なら集約結果をキャッシュする
  CONFIG.SHARD_MODE = true;
  resetShard();
  const m1 = ctx.getShardMergedDevices('ALL', { role: 'ADMIN' }, false);
  const m2 = ctx.getShardMergedDevices('ALL', { role: 'ADMIN' }, false);
  check('初回は親＋子を集約する', m1.length === 2 && gstate.mergeCalls === 1, { len: m1.length, mergeCalls: gstate.mergeCalls });
  check('2回目はキャッシュに当たり集約処理を繰り返さない（連続操作・自動更新が速い）',
    gstate.mergeCalls === 1, { mergeCalls: gstate.mergeCalls });
  check('キャッシュからも同じ内容を返す', m2.length === 2, m2.length);

  // スコープが違えば別キー（他校の教員に別スコープの結果を配らない）
  ctx.getShardMergedDevices('英田小学校', { role: 'TEACHER', school: '英田小学校' }, false);
  check('スコープが違えばキャッシュを共有しない', gstate.mergeCalls === 2, { mergeCalls: gstate.mergeCalls });

  // dev_v が進めば失効する（一括操作の直後に古い一覧を配らない）
  resetShard();
  ctx.getShardMergedDevices('ALL', { role: 'ADMIN' }, false);
  const beforeMergeBump = gstate.mergeCalls;
  ctx.CacheService.getScriptCache().put('dev_v', '123');
  ctx.getShardMergedDevices('ALL', { role: 'ADMIN' }, false);
  check('dev_v が進むと集約キャッシュも失効する',
    gstate.mergeCalls > beforeMergeBump, { before: beforeMergeBump, after: gstate.mergeCalls });

  CONFIG.SHARD_MODE = true;

  // =========================================================================
  // §1-7 児童IDの照合（表記ゆれ吸収）— クラス未取得の根本原因に対処
  // =========================================================================
  console.log('===== [GAS] 児童IDの照合（表記ゆれ吸収） =====');
  const nid = ctx.normalizeIdKey;
  check('前後の空白を無視する',
    nid('  a@b.ed.jp  ') === nid('a@b.ed.jp'), nid('  a@b.ed.jp  '));
  check('大文字小文字を無視する',
    nid('A@B.ED.JP') === nid('a@b.ed.jp'), nid('A@B.ED.JP'));
  check('全角英数字を半角に寄せる',
    nid('１６０７００２＠ＣＩＴＹ.ed.jp') === nid('1607002@city.ed.jp'),
    nid('１６０７００２＠ＣＩＴＹ.ed.jp'));
  check('途中の空白を除去する',
    nid('1607002 @ city.ed.jp') === nid('1607002@city.ed.jp'), nid('1607002 @ city.ed.jp'));
  check('空文字は空のまま', nid('') === '' , nid(''));
  check('null / undefined でも落ちない', nid(null) === '' && nid(undefined) === '');

  // =========================================================================
  // §1-8 親の名簿（端末一覧）から氏名・クラスを引く／子が親へ照会する
  // =========================================================================
  console.log('===== [GAS] 名簿照会: 親が答える / 子が補完する =====');
  const COLS2 = CONFIG.DEVICE_COLUMNS;
  function headerMapOf(cols) {
    const m = {};
    cols.forEach(function (c, i) { m[c] = i + 1; });
    return m;
  }
  const hmap = headerMapOf(COLS2);
  function rowWith(id, school, name, cls) {
    const r = new Array(COLS2.length).fill('');
    r[hmap['児童ID'] - 1] = id;
    r[hmap['学校名'] - 1] = school;
    r[hmap['氏名'] - 1] = name;
    r[hmap['クラス'] - 1] = cls;
    return r;
  }

  gstate.props = makeProps({
    SHARD_SECRET: 'sk_test12345678',
    SHARD_MAP_V1: JSON.stringify({ '5年1組': 'https://child-a/exec' })
  });
  gstate.cache = makeCache();
  gstate.headerMap = hmap;
  gstate.sheet = makeSheet(COLS2, [
    COLS2.slice(),
    rowWith('1607002@city-mimasaka.ed.jp', '第一小学校', 'テスト太郎', '5年1組')
  ]);
  ctx.invalidateShardConfig();
  CONFIG.SHARD_MODE = true;
  CONFIG.SHARD_CHILD_MODE = false;

  const found = ctx.findStudentById('1607002@city-mimasaka.ed.jp');
  check('名簿から氏名を取得できる', !!found && found.student_name === 'テスト太郎', found);
  check('名簿からクラスを取得できる', !!found && found.class_name === '5年1組', found);
  check('行番号も返す（書き込み先の特定に使う）', !!found && found.row_number === 2, found);

  const foundLoose = ctx.findStudentById(' 1607002@CITY-MIMASAKA.ed.jp ');
  check('表記ゆれ（空白・大文字）でも同じ児童を引ける',
    !!foundLoose && foundLoose.student_name === 'テスト太郎', foundLoose);

  const foundFull = ctx.findStudentById('１６０７００２＠city-mimasaka.ed.jp');
  check('全角の児童IDでも引ける', !!foundFull && foundFull.class_name === '5年1組', foundFull);

  check('存在しない児童は null', ctx.findStudentById('nobody@x.ed.jp') === null);
  check('空の児童IDは null', ctx.findStudentById('') === null);

  // 親が子へ「誰か」を答える（クラス＋割り当て先を同時に返す）
  const look = ctx.shardLookupStudent('1607002@city-mimasaka.ed.jp');
  check('親の照会応答に found=true を立てる', look.found === true, look);
  check('親の照会応答に氏名を含める', look.student_name === 'テスト太郎', look.student_name);
  check('親の照会応答にクラスを含める', look.class_name === '5年1組', look.class_name);
  check('親の照会応答に割り当て先GASを含める（これが無いと子へ切替できない）',
    look.assigned_gas_url === 'https://child-a/exec', look.assigned_gas_url);
  check('未知の児童は found=false を返す（例外にしない）',
    ctx.shardLookupStudent('nobody@x.ed.jp').found === false);

  // 子GAS: 子シートの A〜D 列が空なら親の名簿で補完する
  CONFIG.SHARD_CHILD_MODE = true;
  CONFIG.SHARD_MODE = false;
  gstate.headerMap = hmap;
  // 子のシート: 氏名が「〜(Googleアカウント)」・クラスが「未設定」＝実機で起きていた状態
  gstate.sheet = makeSheet(COLS2, [
    COLS2.slice(),
    rowWith('1607002@city-mimasaka.ed.jp', '未設定', '1607002 (Googleアカウント)', '未設定')
  ]);
  gstate.props = makeProps({
    SHARD_SECRET: 'sk_test12345678',
    SHARD_PARENT_URL: 'https://parent/exec'
  });
  gstate.cache = makeCache();
  ctx.invalidateShardConfig();
  fetchLog.length = 0;
  // 親への照会応答を差し替える（実機の shard_lookup 応答と同じ形）
  const origFetch = ctx.UrlFetchApp.fetch;
  ctx.UrlFetchApp.fetch = function (url, opt) {
    fetchLog.push({ url: url, payload: String((opt && opt.payload) || '') });
    return {
      getResponseCode() { return 200; },
      getContentText() {
        return JSON.stringify({
          success: true, found: true,
          student_id: '1607002@city-mimasaka.ed.jp',
          student_name: 'テスト太郎', school_name: '第一小学校', class_name: '5年1組',
          assigned_gas_url: 'https://child-a/exec', assigned_class: '5-1'
        });
      }
    };
  };

  const childRow = gstate.sheet._rows[1];
  const filled = ctx.hbApplyChildIdentity(
    gstate.sheet, 2, childRow, hmap, '1607002@city-mimasaka.ed.jp');
  check('子シートのクラスが親の名簿で補完される',
    gstate.sheet._rows[1][hmap['クラス'] - 1] === '5年1組',
    gstate.sheet._rows[1][hmap['クラス'] - 1]);
  check('子シートの氏名も本名へ補完される',
    gstate.sheet._rows[1][hmap['氏名'] - 1] === 'テスト太郎',
    gstate.sheet._rows[1][hmap['氏名'] - 1]);
  check('子シートの学校名も補完される',
    gstate.sheet._rows[1][hmap['学校名'] - 1] === '第一小学校',
    gstate.sheet._rows[1][hmap['学校名'] - 1]);
  check('補完したことを true で返す', filled === true, filled);
  check('親へ shard_lookup を送っている（子が名簿を持たないため必須）',
    fetchLog.length === 1 && /"action":"shard_lookup"/.test(fetchLog[0].payload), fetchLog);

  // 既に正しい値が入っていれば親へ問い合わせない（無駄な通信をしない）
  fetchLog.length = 0;
  const noNeed = ctx.hbApplyChildIdentity(
    gstate.sheet, 2, gstate.sheet._rows[1], hmap, '1607002@city-mimasaka.ed.jp');
  check('補完済みなら子は親へ問い合わせない', noNeed === false && fetchLog.length === 0,
    { ret: noNeed, fetches: fetchLog.length });

  // 親URLが未設定なら照会しない（従来動作のまま安全に動く）
  gstate.props = makeProps({ SHARD_SECRET: 'sk_test12345678' });
  gstate.cache = makeCache();
  ctx.invalidateShardConfig();
  check('SHARD_PARENT_URL 未設定なら null（例外にしない）',
    ctx.shardLookupFromParent('1607002@city-mimasaka.ed.jp') === null);
  check('親URL未設定でも normalizeIdKey は動く', ctx.normalizeIdKey(' A@B ') === 'a@b');

  ctx.UrlFetchApp.fetch = origFetch;

  // =========================================================================
  // §1-9 split-brain 解消: 親子の突き合わせ統合と、コンソール経路の一本化
  //   実機症状:
  //     ・「画面ロック」を押した瞬間にオフライン表示になる
  //       → 親シートの止まった最終同期だけを見て is_online=false にしていた
  //     ・「同期周期：停止 (猶予 20 秒)」のまま高頻度同期へ移行しない
  //       → google.script.run 経路の api_consoleTouch が子へ ka_active を配っていなかった
  //   既存の検証に影響を与えないよう、実物の関数だけを載せた独立コンテキストで確かめる。
  // =========================================================================
  console.log('===== [GAS] split-brain 解消: 突き合わせ統合・コンソール経路 =====');

  const NOWMS = new Date().getTime();
  const isoAt = (ms) => new Date(ms).toISOString();
  const STALE = isoAt(NOWMS - 30 * 60 * 1000); // 30分前（＝親は切り替え時点で止まっている）
  const FRESH = isoAt(NOWMS - 5 * 1000);        // 5秒前（＝子が受けている）

  function mkCtx2(base) {
    const g = {
      mergeCalls: 0, getAllCalls: 0, kaCalls: [], touches: [],
      teacherActive: false,
      urls: ['https://child-a/exec'],
      childList: []
    };
    const c2 = {
      console, JSON, Date, Math, String, Number, Array, Object, Boolean,
      isNaN, parseInt, parseFloat, Set, Map, RegExp, Error,
      CONFIG: { SHARD_MODE: true, DEVICE_SHEET_NAME: '端末一覧' },
      PropertiesService: { getScriptProperties() { return { getProperty() { return null; } }; } },
      CacheService: { getScriptCache() { return { get() { return null; }, put() {} }; } },
      UrlFetchApp: {
        fetch() { return { getResponseCode() { return 200; }, getContentText() { return '{}'; } }; },
        fetchAll(reqs) {
          return (reqs || []).map(() => ({
            getResponseCode() { return 200; }, getContentText() { return '{}'; }
          }));
        }
      },
      Logger: { log() {} },
      g,
      isShardParent() { return true; },
      shardConfigCached() { return { map: {}, def: '', sec: 'sk_test' }; },
      shardUrlsForTeacher() { return g.urls; },
      shardFetchChildDevices() { return g.childList; },
      shardFilterMergedDevices(list) { return list; },
      getAllDevices() { g.getAllCalls++; return (base || []); },
      // コンソール経路（google.script.run）用のスタブ
      verifyToken() { return { valid: true, teacher: { role: 'ADMIN' } }; },
      resolveCurrentTeacher(t) { return t; },
      getShardMergedDevices() { g.mergeCalls++; return [{ student_id: 'agg-by-merged' }]; },
      touchTeacherConsole(id) { g.touches.push({ type: 'touch', id: id }); return { success: true, touched: id }; },
      releaseTeacherConsole(id) { g.touches.push({ type: 'release', id: id }); return { success: true, released: id }; },
      isTeacherConsoleActive() { return g.teacherActive; },
      shardPropagateKaState(v) { g.kaCalls.push(v); return { sent: [] }; }
    };
    vm.createContext(c2);
    let b = 'const SHEET_TZ_OFFSET_MS = 9 * 60 * 60 * 1000;\n';
    ['sheetTsToMs', 'shardMergeDeviceRow', 'shardMergeDevices',
      'api_getAllDevices', 'api_consoleTouch', 'api_consoleRelease']
      .forEach(function (n) { b += extract(gasSrc, n) + '\n'; });
    vm.runInContext(b, c2);
    return c2;
  }

  const ctx2 = mkCtx2();

  const pRow = {
    student_id: 'child-1', school_name: '第一小学校', class_name: '5年1組',
    student_name: 'テスト太郎', last_seen: STALE, is_online: false,
    current_url: 'https://old.example/', screen_lock: true, filter_mode: 'none',
    whitelist_urls: [], blacklist_urls: [], broadcast_url: '', broadcast_id: '', notes: ''
  };
  const cRow = {
    student_id: 'child-1', school_name: '第一小学校', class_name: '5年1組',
    student_name: 'テスト太郎', last_seen: FRESH, is_online: true,
    current_url: 'https://new.example/', screen_lock: false, filter_mode: 'none',
    whitelist_urls: [], blacklist_urls: [], broadcast_url: '', broadcast_id: '', notes: ''
  };

  // --- テレメトリは「新しい方」を採る（誤オフラインの本体） ---
  const mFreshChild = ctx2.shardMergeDeviceRow(pRow, cRow);
  check('子の最終同期が新しければオンラインになる（ロック直後の誤オフラインを解消）',
    mFreshChild.is_online === true,
    { is_online: mFreshChild.is_online, last_seen: mFreshChild.last_seen });
  check('最終同期日時は新しい方（子）を採る', mFreshChild.last_seen === FRESH, mFreshChild.last_seen);
  check('現在URLも新しい方（子）を採る',
    mFreshChild.current_url === 'https://new.example/', mFreshChild.current_url);
  check('コマンドは親を正とする（子の screen_lock=false に引きずられない）',
    mFreshChild.screen_lock === true, mFreshChild.screen_lock);

  // --- 親の方が新しいときは巻き戻さない ---
  const mFreshParent = ctx2.shardMergeDeviceRow(
    Object.assign({}, pRow, { last_seen: FRESH, current_url: 'https://p-new/', is_online: true }),
    Object.assign({}, cRow, { last_seen: STALE, current_url: 'https://c-old/', is_online: false }));
  check('親の方が新しければ子の古いテレメトリを採らない（巻き戻さない）',
    mFreshParent.current_url === 'https://p-new/', mFreshParent.current_url);
  check('親が新しくてもオンライン判定は統合後の日時から行う',
    mFreshParent.is_online === true, mFreshParent.is_online);

  // --- 両方古ければオフライン（誤ってオンラインにしない） ---
  const mBothStale = ctx2.shardMergeDeviceRow(
    Object.assign({}, pRow, { last_seen: STALE }),
    Object.assign({}, cRow, { last_seen: STALE }));
  check('両方とも古ければオフライン（誤ってオンラインにしない）',
    mBothStale.is_online === false, mBothStale.is_online);

  // --- 欠損値でも落ちない ---
  const mEmpty = ctx2.shardMergeDeviceRow({}, {});
  check('日時が空でも落ちずオフライン扱い', mEmpty.is_online === false, mEmpty.is_online);
  const mUndef = ctx2.shardMergeDeviceRow(null, undefined);
  check('引数が null / undefined でも落ちない',
    !!mUndef && mUndef.is_online === false, mUndef && mUndef.is_online);

  // --- 名簿: 親が正。親が無効値なら子で補う ---
  const mRoster = ctx2.shardMergeDeviceRow(
    Object.assign({}, pRow, { student_name: '1607002 (Googleアカウント)', class_name: '未設定' }),
    Object.assign({}, cRow, { student_name: '本名 花子', class_name: '5年2組' }));
  check('親の氏名が「(Googleアカウント)」なら子の本名で補う',
    mRoster.student_name === '本名 花子', mRoster.student_name);
  check('親のクラスが「未設定」なら子のクラスで補う',
    mRoster.class_name === '5年2組', mRoster.class_name);
  const mRosterParentWins = ctx2.shardMergeDeviceRow(
    pRow, Object.assign({}, cRow, { class_name: '6年1組' }));
  check('親の名簿が正常なら子で上書きしない（親が正）',
    mRosterParentWins.class_name === '5年1組', mRosterParentWins.class_name);
  const mRosterWarn = ctx2.shardMergeDeviceRow(
    Object.assign({}, pRow, { student_name: '未登録児童 (x)' }),
    Object.assign({}, cRow, { student_name: '本名 花子' }));
  check('親の氏名が「未登録児童…」でも子の本名で補う',
    mRosterWarn.student_name === '本名 花子', mRosterWarn.student_name);

  // --- コマンド: 親が空なら子の値を消さない ---
  const mCmd = ctx2.shardMergeDeviceRow(
    Object.assign({}, pRow, { broadcast_url: '', broadcast_id: '' }),
    Object.assign({}, cRow, { broadcast_url: 'https://bc.example/', broadcast_id: 'bc-1' }));
  check('親のコマンドが空なら子に残っている値を消さない',
    mCmd.broadcast_url === 'https://bc.example/', mCmd.broadcast_url);
  const mCmdParent = ctx2.shardMergeDeviceRow(
    Object.assign({}, pRow, { broadcast_url: 'https://parent-bc/' }),
    Object.assign({}, cRow, { broadcast_url: 'https://child-bc/' }));
  check('親にコマンドがあれば子で上書きさせない（親が正）',
    mCmdParent.broadcast_url === 'https://parent-bc/', mCmdParent.broadcast_url);

  // --- 突き合わせループ: 親にも居る端末を「捨てない」 ---
  const loop = mkCtx2([pRow]);
  loop.g.childList = [
    cRow,
    { student_id: 'child-only', class_name: '5年1組', last_seen: FRESH, is_online: true }
  ];
  const loopMerged = loop.shardMergeDevices([pRow], 'ALL', { role: 'ADMIN' }, false);
  check('親にも居る端末は子の行と統合される（以前は捨てていた）',
    loopMerged.length === 2, loopMerged.map(function (d) { return d.student_id; }));
  const loopRow = loopMerged.filter(function (d) { return d.student_id === 'child-1'; })[0];
  check('統合された行は子の最新テレメトリを持つ（＝オンライン表示）',
    !!loopRow && loopRow.is_online === true && loopRow.last_seen === FRESH,
    loopRow && { is_online: loopRow.is_online, last_seen: loopRow.last_seen });
  check('統合された行のロック状態は親の値を保つ',
    !!loopRow && loopRow.screen_lock === true, loopRow && loopRow.screen_lock);
  check('親に無い端末は新規に追加される',
    !!loopMerged.filter(function (d) { return d.student_id === 'child-only'; }).length);

  // --- コンソール経路: api_getAllDevices が集約を通る ---
  const api = mkCtx2();
  const apiRes = api.api_getAllDevices('tok', 'ALL', false);
  check('api_getAllDevices は集約（getShardMergedDevices）を通る',
    api.g.mergeCalls === 1 && apiRes.success === true && api.g.getAllCalls === 0,
    { mergeCalls: api.g.mergeCalls, getAllCalls: api.g.getAllCalls });
  check('api_getAllDevices は集約結果をそのまま返す',
    !!apiRes.data && apiRes.data[0].student_id === 'agg-by-merged', apiRes.data);

  // --- コンソール経路: ka_active の伝達 ---
  const apiT = api.api_consoleTouch('sess-1');
  check('api_consoleTouch は稼働を子GASへ伝える（停止したままにならない）',
    api.g.kaCalls.length === 1 && api.g.kaCalls[0] === true, api.g.kaCalls);
  check('api_consoleTouch は元の戻り値をそのまま返す',
    apiT.success === true && apiT.touched === 'sess-1', apiT);

  api.g.teacherActive = false;
  const apiR1 = api.api_consoleRelease('sess-1');
  check('最後のセッションが消えたら子GASへ停止を伝える',
    api.g.kaCalls.length === 2 && api.g.kaCalls[1] === false, api.g.kaCalls);
  check('api_consoleRelease は元の戻り値をそのまま返す',
    apiR1.success === true && apiR1.released === 'sess-1', apiR1);

  api.g.teacherActive = true;
  api.api_consoleRelease('sess-2');
  check('他セッションが稼働中なら停止を配らない',
    api.g.kaCalls.length === 2, api.g.kaCalls);

  // =========================================================================
  // §1-10 google.script.run 経由の操作も子GASへ届くか（症状2の残り半分）
  //   api_bulkLock / api_bulkBroadcast / api_bulkFilter / api_updateSingle は
  //   doPost の同名アクションと違い shardPropagatePolicy を呼んでいなかった。
  //   index.html は google.script.run を優先するため、ロックが子へ届かなかった。
  // =========================================================================
  console.log('===== [GAS] google.script.run 経由の操作も子GASへ伝達する =====');

  function mkCtx3(teacherActive) {
    const g = { patches: [], bulk: [] };
    const c3 = {
      console, JSON, Date, Math, String, Number, Array, Object, Boolean,
      isNaN, parseInt, parseFloat, Set, Map, RegExp, Error,
      g,
      CONFIG: { SHARD_MODE: true },
      verifyToken() { return { valid: true, teacher: { email: 't@x.ed.jp', role: 'TEACHER' } }; },
      resolveCurrentTeacher(t) { return t; },
      scopeStudentIdsForTeacher(ids) { return { ids: Array.isArray(ids) ? ids : ['s1@x.ed.jp'] }; },
      bulkUpdateScreenLock(ids, v) { g.bulk.push({ op: 'lock', ids: ids, v: v }); },
      bulkUpdateBroadcastUrl(ids, u) { g.bulk.push({ op: 'bc', ids: ids, u: u }); return 'bc-id-1'; },
      bulkUpdateFilterMode(ids, m, w, b) { g.bulk.push({ op: 'filter', ids: ids, m: m }); },
      getDeviceByStudentId(id) { return { student_id: id, school_name: '第一小学校', class_name: '5年1組' }; },
      isDeviceInTeacherScope() { return true; },
      updateSingleDevice(id, d) { g.bulk.push({ op: 'single', id: id, d: d }); },
      saveTeacherSettings() { return {}; },
      Logger: { log() {} },
      // 子GASへ何を渡したかを記録する
      shardPropagatePolicy(ids, patch) { g.patches.push({ ids: ids, patch: patch }); return { sent: [] }; }
    };
    vm.createContext(c3);
    let b = '';
    ['api_bulkLock', 'api_bulkBroadcast', 'api_bulkFilter', 'api_updateSingle']
      .forEach(function (n) { b += extract(gasSrc, n) + '\n'; });
    vm.runInContext(b, c3);
    return c3;
  }

  const cA = mkCtx3();
  const lk = cA.api_bulkLock('tok', ['s1@x.ed.jp'], true);
  check('api_bulkLock が子GASへロック指示を伝える（押しても届かない不具合の修正）',
    cA.g.patches.length === 1 && cA.g.patches[0].patch.screen_lock === true,
    cA.g.patches);
  check('api_bulkLock は対象児童IDをそのまま渡す',
    !!cA.g.patches[0] && cA.g.patches[0].ids[0] === 's1@x.ed.jp', cA.g.patches[0]);
  check('api_bulkLock の戻り値は従来どおり success=true',
    lk.success === true, lk);
  check('api_bulkLock の戻り値に shard を添える（伝達結果を画面に出せる）',
    'shard' in lk, Object.keys(lk));

  const lkOff = cA.api_bulkLock('tok', ['s1@x.ed.jp'], false);
  check('ロック解除も子GASへ伝える（false を送る）',
    cA.g.patches.length === 2 && cA.g.patches[1].patch.screen_lock === false,
    cA.g.patches[1]);
  check('ロック解除の戻り値も success=true', lkOff.success === true, lkOff);

  const cB = mkCtx3();
  const bc = cB.api_bulkBroadcast('tok', ['s1@x.ed.jp'], 'https://bc.example/');
  check('api_bulkBroadcast が子GASへ配信URLを伝える',
    cB.g.patches.length === 1 && cB.g.patches[0].patch.broadcast_url === 'https://bc.example/',
    cB.g.patches);
  check('api_bulkBroadcast は従来どおり broadcast_id を返す',
    bc.broadcast_id === 'bc-id-1', bc.broadcast_id);

  const cC = mkCtx3();
  const fl = cC.api_bulkFilter('tok', ['s1@x.ed.jp'], 'whitelist', ['https://ok/'], ['https://ng/']);
  check('api_bulkFilter が子GASへ規制モードを伝える',
    cC.g.patches.length === 1 && cC.g.patches[0].patch.filter_mode === 'whitelist',
    cC.g.patches);
  check('api_bulkFilter がホワイトリストも伝える',
    !!cC.g.patches[0] && Array.isArray(cC.g.patches[0].patch.whitelist_urls) &&
    cC.g.patches[0].patch.whitelist_urls[0] === 'https://ok/', cC.g.patches[0]);
  check('api_bulkFilter がブラックリストも伝える',
    !!cC.g.patches[0] && cC.g.patches[0].patch.blacklist_urls[0] === 'https://ng/', cC.g.patches[0]);
  check('api_bulkFilter の戻り値も success=true', fl.success === true, fl);

  const cD = mkCtx3();
  const sg = cD.api_updateSingle('tok', 's1@x.ed.jp', { screen_lock: true, notes: 'メモ' });
  check('api_updateSingle が子GASへ個別変更を伝える',
    cD.g.patches.length === 1 && cD.g.patches[0].patch.screen_lock === true, cD.g.patches);
  check('api_updateSingle は関係ないキー（備考）を子へ送らない',
    !!cD.g.patches[0] && !('notes' in cD.g.patches[0].patch), cD.g.patches[0].patch);
  check('api_updateSingle の戻り値も success=true', sg.success === true, sg);

  const cE = mkCtx3();
  cE.api_updateSingle('tok', 's1@x.ed.jp', { notes: 'メモだけ' });
  check('伝える項目が無ければ子GASへ空リクエストを送らない',
    cE.g.patches.length === 0, cE.g.patches);

  // =========================================================================
  // §1-11 R29: 親の「読み取り時集計」が子の最新 last_seen を正しく評価するか
  //   実機症状: 子シートの L列は 11:19:32 で更新中なのに、親シートの L列は
  //             11:12:41 で停止。親コンソールは親シートの値だけを見て
  //             時間経過で「オフライン」になっていた。
  //   設計: 親シートへの書き戻しは行わない（読み取り時のメモリ上集約のみが正）。
  //         よって「集約が子の値を採れているか」と「日時解釈が実行環境に
  //         依存しないか」を固定する。
  // =========================================================================
  console.log('===== [GAS] R29: 集約が子の最新 last_seen を評価するか =====');

  // --- §1-11a 日時解釈が実行タイムゾーンに依存しない ---
  //   シートへは常に日本時間で書くため、UTC+9 決め打ちで解釈する。
  //   （以前は new Date(str) 任せで、スクリプトTZが変わると is_online が反転した）
  const tzJst = ctx2.sheetTsToMs('2026/11/02 11:19:32');
  const tzExpect = Date.UTC(2026, 10, 2, 11, 19, 32) - 9 * 60 * 60 * 1000;
  check('シート日時を日本時間として解釈する（実行TZ非依存）',
    tzJst === tzExpect, { got: tzJst, expect: tzExpect });
  check('ハイフン区切り・T区切りも同じ結果になる',
    ctx2.sheetTsToMs('2026-11-02 11:19:32') === tzExpect &&
    ctx2.sheetTsToMs('2026-11-02T11:19:32') === tzExpect);
  check('日付のみでも解釈できる（00:00:00 扱い）',
    ctx2.sheetTsToMs('2026/11/02') === (Date.UTC(2026, 10, 2) - 9 * 60 * 60 * 1000));
  check('空値は 0（落ちない）',
    ctx2.sheetTsToMs('') === 0 && ctx2.sheetTsToMs(null) === 0 && ctx2.sheetTsToMs(undefined) === 0);
  check('壊れた文字列でも例外を投げない', typeof ctx2.sheetTsToMs('こわれた') === 'number');

  // --- §1-11b 統合時に「どちらを採ったか」が分かる ---
  const wbChild = ctx2.shardMergeDeviceRow(pRow, cRow);
  check('子の方が新しければ last_seen_source=child',
    wbChild.last_seen_source === 'child', wbChild.last_seen_source);
  const wbParent = ctx2.shardMergeDeviceRow(
    Object.assign({}, pRow, { last_seen: FRESH }), Object.assign({}, cRow, { last_seen: STALE }));
  check('親の方が新しければ last_seen_source=parent',
    wbParent.last_seen_source === 'parent', wbParent.last_seen_source);
  check('両方空なら last_seen_source=none',
    ctx2.shardMergeDeviceRow({}, {}).last_seen_source === 'none');

  // --- §1-11c 子が最新を返す実機ケース: 集約結果がオンラインになる ---
  const ago = (ms) => isoAt(new Date().getTime() - ms);
  const realP = Object.assign({}, pRow, { last_seen: ago(30 * 60 * 1000) });
  const realC = Object.assign({}, cRow, { last_seen: ago(5 * 1000) });
  const realLoop = mkCtx2([realP]);
  realLoop.g.childList = [realC];
  const realMerged = realLoop.shardMergeDevices([realP], 'ALL', { role: 'ADMIN' }, false);
  const realRow = realMerged.filter(function (d) { return d.student_id === 'child-1'; })[0];
  check('子が最新なら統合結果はオンライン（ロック直後の誤オフラインを解消）',
    !!realRow && realRow.is_online === true, realRow && realRow.is_online);
  check('統合結果の last_seen は子の値（親の古い値で上書きしない）',
    !!realRow && realRow.last_seen === realC.last_seen, realRow && realRow.last_seen);

  // --- §1-11d 子の取得失敗は「親の古い値のまま」になる（症状の再現と可視化） ---
  //   ここが silent に失敗すると、画面上は原因不明のオフラインに見える。
  //   R29 で _diag に失敗理由を残すようにした。
  const failLoop = mkCtx2([realP]);
  failLoop.g.childList = [];
  const failMerged = failLoop.shardMergeDevices([realP], 'ALL', { role: 'ADMIN' }, false);
  const failRow = failMerged[0];
  check('子が0件を返すと親の古い値のまま（誤ってオンラインにしない）',
    !!failRow && failRow.is_online === false, failRow && failRow.is_online);

  // --- §1-11e 診断情報: 子取得の失敗理由が _diag に残る ---
  //   shardFetchChildDevices の実物を実測プローブ（tests/probe_r29.js）で検証済み。
  //   ここでは「失敗を記録するコードが存在すること」を静的に固定する。
  check('子GASの非200を黙って捨てず diag に残す',
    /diag\.failed\.push\(\{ url: urls\[i\], status: code \}\)/.test(gasSrc));
  check('JSONでない応答も diag に残す',
    /diag\.failed\.push\(\{ url: urls\[i\], status: -1, error: 'not_json' \}\)/.test(gasSrc));
  check('取得0件のときはログに残す（原因を追えるようにする）',
    /shard: 子GASから取得できません/.test(gasSrc));
  check('親シートへの書き戻しは行わない（設計どおり読み取り時集約のみ）',
    !/shardWriteBackTelemetry/.test(gasSrc));

  console.log('');
  console.log('===== 結果: PASS=' + pass + ' FAIL=' + fail + ' =====');
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(function (e) {
  console.error('ERROR', e && e.stack ? e.stack : e);
  process.exit(1);
});
