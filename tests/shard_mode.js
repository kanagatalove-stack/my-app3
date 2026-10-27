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
    SHARD_CHILD_MODE: false
  };

  const touchLog = [];
  const fetchLog = [];
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
        fetchLog.push({ url: url, payload: String((opt && opt.payload) || '') });
        return { getResponseCode() { return 200; }, getContentText() { return '{"success":true}'; } };
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
    getHeaderMap() { return gstate.headerMap || {}; }
  };

  let gasBundle = '';
  gasBundle += lineConst(gasSrc, 'SHARD_MAP_PROP') + '\n';
  gasBundle += lineConst(gasSrc, 'SHARD_DEFAULT_PROP') + '\n';
  gasBundle += lineConst(gasSrc, 'SHARD_SECRET_PROP') + '\n';
  gasBundle += lineConst(gasSrc, 'SHARD_CFG_CACHE') + '\n';
  [
    // shardEnsureDeviceRows / shardUpsert 系が使う排他制御（実物をそのまま使う）
    'withWriteLock',
    'isShardParent','isShardChild','normalizeShardClass',
    'readShardMapRaw','readShardDefaultUrl','getOrCreateShardSecret','shardSecretMatches',
    'shardConfigCached','invalidateShardConfig','shardMapIndexFromMap',
    'resolveShardForHeartbeat','shardApplyFromParent','shardEnsureDeviceRows',
    'shardAllChildUrls','shardPropagateKaState'
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

  console.log('');
  console.log('===== 結果: PASS=' + pass + ' FAIL=' + fail + ' =====');
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(function (e) {
  console.error('ERROR', e && e.stack ? e.stack : e);
  process.exit(1);
});
