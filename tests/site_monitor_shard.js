// =====================================================================
// サイト監視機能（旧AI監視）の R41 シャード伝播・判定・表示の回帰テスト
//
//  検証する仕様:
//   1. 親GASで監視設定を保存すると、既存の shard_apply 同梱経路
//      （即時並列プッシュ＋保留キュー）で全子GASへ伝播する。
//   2. 子GASは受信した設定を PropertiesService（親と同一キー
//      MONITOR_SETTINGS_V1）へ保存する。R41 では親子で独立しているため競合しない。
//   3. 子GASのハートビートは urlChanged に限定せず、監視有効時は毎回判定する
//      （設定ON直後・同一タブ閲覧継続中の児童を検知できる）。
//   4. 要注意4列が無い端末一覧シートには ensureDeviceHeaders が自動追加する。
//   5. 親GASの集約表示でも applyMonitorVisibility による伏せ処理が効く。
//   6. UI・ドキュメント・テストの表示文言が「サイト監視」に統一されている
//      （内部識別子・PropertiesService キーは後方互換のため維持）。
// =====================================================================
const fs = require('fs'), vm = require('vm');
const PREFIX = '/home/user/webapp/';
function rd(p) { return fs.readFileSync(PREFIX + p, 'utf8'); }
const src = rd('gas/Code.gs');
const html = rd('gas/index.html');
const manual = rd('docs/manual/README.md');
const adminDoc = rd('docs/ADMIN_CONSOLE_SETUP.md');
const manifest = JSON.parse(rd('extension/manifest.json'));

// Code.gs の関数は column 0、index.html は 4 スペース字下げ。
function extract(s, name) {
  const re = new RegExp('^[ \\t]*(?:async\\s+)?function ' + name + '\\s*\\(', 'm');
  const st = s.search(re);
  if (st < 0) throw new Error('not found: ' + name);
  let i = s.indexOf('{', st), d = 0, end = -1;
  for (; i < s.length; i++) { if (s[i] === '{') d++; else if (s[i] === '}') { d--; if (d === 0) { end = i; break; } } }
  if (end < 0) throw new Error('unbalanced: ' + name);
  return s.slice(st, end + 1);
}
function extractConst(name) {
  const re = new RegExp('^const ' + name + '\\s*=', 'm');
  const st = src.search(re);
  if (st < 0) throw new Error('const not found: ' + name);
  let d = 0, end = -1;
  for (let i = src.indexOf('=', st); i < src.length; i++) {
    const ch = src[i];
    if (ch === '[' || ch === '{' || ch === '(') d++;
    else if (ch === ']' || ch === '}' || ch === ')') d--;
    else if (ch === ';' && d === 0) { end = i; break; }
  }
  return src.slice(st, end + 1);
}
// CONFIG オブジェクト内の配列（DEVICE_COLUMNS 等）を抜き出す。
//   DEVICE_COLUMNS はトップレベル const ではなく CONFIG のプロパティなので extractConst では取れない。
function extractConfigArray(name) {
  const re = new RegExp('^\\s*' + name + '\\s*:\\s*\\[', 'm');
  const m = re.exec(src);
  if (!m) throw new Error('config array not found: ' + name);
  const st = m.index;
  let d = 0, end = -1;
  for (let i = src.indexOf('[', st); i < src.length; i++) {
    if (src[i] === '[') d++;
    else if (src[i] === ']') { d--; if (d === 0) { end = i; break; } }
  }
  return src.slice(st, end + 1);
}
const countDefs = (s, n) => (s.match(new RegExp('function\\s+' + n + '\\s*\\(', 'g')) || []).length;

let pass = 0, fail = 0;
function check(n, c, e) {
  if (c) { console.log('PASS', n, e !== undefined ? '=> ' + JSON.stringify(e) : ''); pass++; }
  else { console.log('FAIL', n, e !== undefined ? '=> ' + JSON.stringify(e) : ''); fail++; }
}

// 監視系の関数・定数を1つの VM に読み込むための前処理（monitor.js と同じ方針）。
const MON_FNS = ['normalizeMonitorHost', 'hostMatchesAnyDomain', 'getMonitoringSettings',
  'sanitizeMonitorDomainList', 'isWebUrlForMonitoring', 'evaluateUrlForMonitoring',
  'applyMonitorVisibility',
  // 【v1.6.8】shardChildApplyMonitorSettings が参照するライブ視聴設定の正規化
  'normalizeLiveWatchPerTeacherLimit', 'normalizeLiveWatchTimeoutSec'];
const MON_CONSTS = ['MONITOR_PROP_KEY', 'MONITOR_MAX_DOMAINS',
  'MONITOR_DEFAULT_LEARNING_DOMAINS', 'MONITOR_DEFAULT_BLOCKED_DOMAINS',
  // 【v1.6.8】ライブ視聴設定の既定値・上限
  'LIVE_WATCH_DEFAULT_PER_TEACHER_LIMIT', 'LIVE_WATCH_DEFAULT_TIMEOUT_SEC',
  'LIVE_WATCH_MAX_PER_TEACHER_LIMIT', 'LIVE_WATCH_UNLIMITED',
  'LIVE_WATCH_MIN_TIMEOUT_SEC', 'LIVE_WATCH_MAX_TIMEOUT_SEC'];

function mkMonitorPrelude() {
  let code = '';
  MON_CONSTS.forEach(n => { code += extractConst(n) + '\n'; });
  MON_FNS.forEach(n => { code += extract(src, n) + '\n'; });
  // parseUrlList / parseBoolean は Code.gs の実装をそのまま使う
  code += extract(src, 'parseUrlList') + '\n';
  code += extract(src, 'parseBoolean') + '\n';
  return code;
}

function mkCtx(extraCode, extraGlobals) {
  const props = {};
  const ctx = {
    console, JSON, Date, Math, String, Number, Array, Object, Boolean, isNaN,
    parseInt, parseFloat, Set, Map, RegExp, Symbol, Promise, Error,
    Utilities: { formatDate: () => '2026/11/15 10:00:00' },
    PropertiesService: {
      getScriptProperties() {
        return {
          getProperty(k) { return (k in props) ? props[k] : null; },
          setProperty(k, v) { props[k] = String(v); },
          deleteProperty(k) { delete props[k]; }
        };
      }
    },
    Logger: { log() {} },
    __props: props
  };
  Object.keys(extraGlobals || {}).forEach(k => { ctx[k] = extraGlobals[k]; });
  vm.createContext(ctx);
  vm.runInContext(mkMonitorPrelude() + (extraCode || ''), ctx);
  return ctx;
}

// =====================================================================
// A) 静的検証: 伝播・毎回判定・集約・列自動追加
// =====================================================================
console.log('===== [A] 静的検証: 実装の存在と配線 =====');

check('shardPropagateMonitorSettings が1つだけ定義されている',
  countDefs(src, 'shardPropagateMonitorSettings') === 1);
check('shardChildApplyMonitorSettings が1つだけ定義されている',
  countDefs(src, 'shardChildApplyMonitorSettings') === 1);

const fnSave = extract(src, 'saveMonitoringSettings');
check('設定保存時に子GASへ伝播する（shardPropagateMonitorSettings を呼ぶ）',
  fnSave.indexOf('shardPropagateMonitorSettings(next)') >= 0);
check('伝播の失敗で親の保存を壊さない（try で包む）',
  /try\s*\{[\s\S]{0,200}?shardPropagateMonitorSettings\(next\)[\s\S]{0,200}?catch/.test(fnSave));
check('保存キーは従来どおり MONITOR_PROP_KEY（後方互換）',
  fnSave.indexOf('MONITOR_PROP_KEY') >= 0);

const fnProp = extract(src, 'shardPropagateMonitorSettings');
check('親以外では何もしない（子からの多重伝播を防ぐ）',
  /if\s*\(!isShardParent\(\)\)\s*return/.test(fnProp));
check('既存の shard_apply 同梱経路を使う（新規アクションを作らない）',
  /action:\s*'shard_apply'/.test(fnProp) && fnProp.indexOf('shard_apply') === fnProp.lastIndexOf('shard_apply'));
check('監視設定だけを送る（student_ids は空＝ポリシー変更をしない）',
  /student_ids:\s*\[\]/.test(fnProp));
check('ペイロードに monitor_settings を同封する',
  /monitor_settings:\s*s/.test(fnProp));
check('保留キュー（shardQueuePending）を再利用する',
  fnProp.indexOf('shardQueuePending(requests)') >= 0);
check('保留が使えない環境では同期送信へフォールバックする',
  fnProp.indexOf('shardFetchMany(requests)') >= 0);
check('宛先は shardAllChildUrls（全子GAS）',
  fnProp.indexOf('shardAllChildUrls(cfg)') >= 0);
check('子GAS未登録なら何も送らない', /if\s*\(!urls\.length\)\s*return/.test(fnProp));

const fnChild = extract(src, 'shardChildApplyMonitorSettings');
check('子は親と同一キー（MONITOR_PROP_KEY）へ保存する',
  fnChild.indexOf('setProperty(MONITOR_PROP_KEY') >= 0);
check('子は受信辞書を sanitize する（不正ドメインを弾く）',
  fnChild.indexOf('sanitizeMonitorDomainList') >= 0);
check('辞書が空で届いたら既定辞書で補う（全サイト注意の事故を防ぐ）',
  /if\s*\(!next\.learning_domains\.length\)/.test(fnChild) &&
  /if\s*\(!next\.blocked_domains\.length\)/.test(fnChild));
check('保存後に読み取りキャッシュを無効化する（即時反映）',
  fnChild.indexOf('invalidateDevicesCache') >= 0);

const fnApply = extract(src, 'shardApplyFromParent');
check('子の shard_apply が monitor_settings を受け取る',
  /payload\.monitor_settings/.test(fnApply) && fnApply.indexOf('shardChildApplyMonitorSettings') >= 0);
check('児童IDが空の早期return経路でも監視保存結果を返す',
  /applied:\s*0[\s\S]{0,160}?monitor_settings:\s*monitorSaved/.test(fnApply));
check('通常経路の応答にも監視保存結果を含める',
  /schedules:\s*scheduleSaved,\s*\/\/[\s\S]{0,160}?monitor_settings:\s*monitorSaved/.test(fnApply));

// ハートビート: urlChanged 限定をやめ、監視有効時は毎回判定
const fnHb = extract(src, 'processHeartbeat');
check('ハートビートで監視設定の有効/無効を取得する',
  /getMonitoringSettings\(\)\.enabled\s*===\s*true/.test(fnHb));
check('監視OFFなら従来どおり書き込みをスキップする（無駄なI/Oを増やさない）',
  /!urlChanged\s*&&\s*!syncDue\s*&&\s*!schoolFill\s*&&\s*!monEnabled/.test(fnHb));
check('監視ONなら毎回判定する（urlChanged に依存しない）',
  /if\s*\(monEnabled\)\s*hbApplyMonitor\(/.test(fnHb));
check('urlChanged 限定の判定が残っていない',
  !/if\s*\(urlChanged\)\s*hbApplyMonitor\(/.test(fnHb));

// 集約（シャードモード）でも伏せ処理が効く
const fnMerge = extract(src, 'getShardMergedDevices');
check('集約結果に applyMonitorVisibility を適用する',
  fnMerge.indexOf('applyMonitorVisibility(mergedData)') >= 0);
check('伏せ処理の結果をキャッシュへ保存する（毎回作り直さない）',
  /const data = \(typeof applyMonitorVisibility[\s\S]{0,200}?cache\.put\(cacheKey, JSON\.stringify\(data\)/.test(fnMerge));

// 要注意4列の自動追加
const cols = extractConfigArray('DEVICE_COLUMNS');
['要注意', '注意理由', '要注意URL', '注意検知日時'].forEach(c => {
  check('端末一覧の列に「' + c + '」がある', cols.indexOf("'" + c + "'") >= 0);
});
check('要注意4列が隣接している（1回の getRange で書ける）',
  /'要注意',\s*\n\s*'注意理由',\s*\n\s*'要注意URL',\s*\n\s*'注意検知日時'/.test(cols));
const fnEnsure = extract(src, 'ensureDeviceHeaders');
check('不足列を末尾へ自動追加する（子シートの後方互換）',
  fnEnsure.indexOf('CONFIG.DEVICE_COLUMNS.forEach') >= 0 &&
  fnEnsure.indexOf('getLastColumn() + 1') >= 0);
const fnTarget = extract(src, 'getTargetSheet');
check('端末一覧シートを開くとき ensureDeviceHeaders を呼ぶ',
  /sheetName === CONFIG\.DEVICE_SHEET_NAME[\s\S]{0,220}?ensureDeviceHeaders\(sheet\)/.test(fnTarget));

// =====================================================================
// B) 実行時: 子GASが設定を受信・保存する
// =====================================================================
console.log('\n===== [B] 実行時: 子GASの設定受信と保存 =====');

(function () {
  const ctx = mkCtx(extract(src, 'shardChildApplyMonitorSettings') + '\n');
  const r = ctx.shardChildApplyMonitorSettings({
    enabled: true, learning_domains: ['scratch.mit.edu'],
    blocked_domains: ['youtube.com'], updated_at: '2026/11/15 09:00:00',
    updated_by: 'admin@mimasaka.ed.jp'
  });
  check('保存に成功する', r && r.saved === true && r.enabled === true, r);
  check('親と同一キー MONITOR_SETTINGS_V1 に書く',
    typeof ctx.__props['MONITOR_SETTINGS_V1'] === 'string');
  const got = ctx.getMonitoringSettings();
  check('子の getMonitoringSettings が enabled:true を返す（従来はfalse固定）',
    got.enabled === true, got.enabled);
  check('受け取った非学習辞書が保持される',
    got.blocked_domains.indexOf('youtube.com') >= 0, got.blocked_domains);
})();

(function () {
  const ctx = mkCtx(extract(src, 'shardChildApplyMonitorSettings') + '\n');
  ctx.shardChildApplyMonitorSettings({ enabled: true, learning_domains: [], blocked_domains: [] });
  const got = ctx.getMonitoringSettings();
  check('辞書が空で届いても既定辞書で補う（学習）',
    got.learning_domains.length > 10, got.learning_domains.length);
  check('辞書が空で届いても既定辞書で補う（非学習）',
    got.blocked_domains.length > 10, got.blocked_domains.length);
})();

(function () {
  const ctx = mkCtx(extract(src, 'shardChildApplyMonitorSettings') + '\n');
  const r = ctx.shardChildApplyMonitorSettings({ enabled: false });
  const got = ctx.getMonitoringSettings();
  check('OFF の伝播も反映される（親で無効化したら子も止まる）',
    got.enabled === false && r.saved === true, got.enabled);
})();

(function () {
  const ctx = mkCtx(extract(src, 'shardChildApplyMonitorSettings') + '\n');
  check('壊れた入力（null）でも落ちない',
    ctx.shardChildApplyMonitorSettings(null) === null);
  check('壊れた入力（文字列）でも落ちない',
    ctx.shardChildApplyMonitorSettings('x') === null);
})();

// =====================================================================
// C) 実行時: 親GASが全子GASへ伝播する
// =====================================================================
console.log('\n===== [C] 実行時: 親から全子GASへの伝播 =====');

function mkPropCtx(over) {
  const cap = { queued: null, fetched: null, bodies: [] };
  const cfg = {
    map: { '5年1組': 'https://child-a/exec', '6年1組': 'https://child-b/exec' },
    def: '', sec: 'SECRET-X'
  };
  const g = {
    isShardParent: () => true,
    shardConfigCached: () => cfg,
    shardAllChildUrls: (c) => {
      const out = [];
      Object.keys((c && c.map) || {}).forEach(k => {
        const u = String(c.map[k] || '').trim();
        if (u && out.indexOf(u) < 0) out.push(u);
      });
      return out;
    },
    shardQueuePending: (reqs) => { cap.queued = reqs; return true; },
    shardFetchMany: (reqs) => { cap.fetched = reqs; return reqs.map(() => null); },
    SHARD_ASYNC_ENABLED: true
  };
  Object.keys(over || {}).forEach(k => { g[k] = over[k]; });
  const ctx = mkCtx(extract(src, 'shardPropagateMonitorSettings') + '\n', g);
  return { ctx, cap };
}

(function () {
  const { ctx, cap } = mkPropCtx();
  const r = ctx.shardPropagateMonitorSettings({
    enabled: true, learning_domains: ['scratch.mit.edu'],
    blocked_domains: ['youtube.com'], updated_at: '2026/11/15 09:00:00'
  });
  check('2台の子GASへ送る', r && r.sent === 2, r);
  check('応答を待たず保留キューへ積む（R41の速度を落とさない）',
    r && r.deferred === true, r && r.deferred);
  check('キューには2件積まれる', cap.queued && cap.queued.length === 2,
    cap.queued && cap.queued.length);
  const body = JSON.parse(cap.queued[0].payload);
  check('action は shard_apply（既存経路の再利用）', body.action === 'shard_apply', body.action);
  check('shard_secret を添える', body.shard_secret === 'SECRET-X');
  check('student_ids は空（ポリシーを変えない）',
    Array.isArray(body.student_ids) && body.student_ids.length === 0, body.student_ids);
  check('monitor_settings を同封する',
    body.monitor_settings && body.monitor_settings.enabled === true, body.monitor_settings && body.monitor_settings.enabled);
  check('enabled:false も伝播できる（無効化の取りこぼし防止）', (function () {
    const { ctx: c2, cap: k2 } = mkPropCtx();
    c2.shardPropagateMonitorSettings({ enabled: false, learning_domains: ['a.com'], blocked_domains: ['b.com'] });
    return JSON.parse(k2.queued[0].payload).monitor_settings.enabled === false;
  })());
})();

(function () {
  const { ctx, cap } = mkPropCtx({ shardQueuePending: () => false });
  const r = ctx.shardPropagateMonitorSettings({ enabled: true, learning_domains: [], blocked_domains: [] });
  check('保留が使えなければ同期送信する', r && r.deferred === false && !!cap.fetched, r);
  check('同期送信でも2件送る', cap.fetched && cap.fetched.length === 2);
})();

(function () {
  const { ctx } = mkPropCtx({ isShardParent: () => false });
  const r = ctx.shardPropagateMonitorSettings({ enabled: true });
  check('子GAS（親でない）では伝播しない', r && r.skipped === true && r.reason === 'not_parent', r);
})();

(function () {
  const { ctx, cap } = mkPropCtx({ shardConfigCached: () => ({ map: {}, def: '', sec: 'S' }) });
  const r = ctx.shardPropagateMonitorSettings({ enabled: true });
  check('子GAS未登録なら送らない', r && r.skipped === true && r.reason === 'no_child', r);
  check('宛先が無いときキューへ積まない', cap.queued === null);
})();

// =====================================================================
// D) 実行時: 子GASの shard_apply が設定を受けて保存する（早期return経路）
// =====================================================================
console.log('\n===== [D] 実行時: 子GAS shard_apply 受信 =====');

function mkChildCtx() {
  const cap = { bulk: [], lock: [], filter: [] };
  const g = {
    isShardChild: () => true,
    isShardParent: () => false,
    shardSecretMatches: () => true,
    touchTeacherConsole: () => {},
    releaseTeacherConsole: () => {},
    propBool: () => false,
    PROP_SHARD_MODE: 'SHARD_MODE',
    Logger: { log() {} },
    parseBoolean: (v) => v === true || String(v).toLowerCase() === 'true',
    shardEnsureDeviceRows: () => 0,
    shardSaveScheduleCache_: () => ({ saved: 0 }),
    bulkUpdateScreenLock: (ids, v) => { cap.lock.push({ ids: ids, v: v }); },
    bulkUpdateFilterMode: (ids, m) => { cap.filter.push({ ids: ids, m: m }); },
    bulkUpdateBroadcastUrl: (ids, u, bid) => { cap.bulk.push({ ids: ids, u: u, bid: bid }); }
  };
  let code = '';
  ['shardChildApplyMonitorSettings'].forEach(n => { code += extract(src, n) + '\n'; });
  code += extract(src, 'shardApplyFromParent') + '\n';
  const ctx = mkCtx(code, g);
  return { ctx, cap };
}

(function () {
  const { ctx } = mkChildCtx();
  const r = ctx.shardApplyFromParent({
    shard_secret: 'S', student_ids: [],
    monitor_settings: { enabled: true, learning_domains: ['scratch.mit.edu'],
                        blocked_domains: ['youtube.com'], updated_at: '2026/11/15 09:00:00' }
  });
  check('児童IDが空でも成功を返す（設定だけの呼び出し）',
    r.success === true && r.applied === 0, [r.success, r.applied]);
  check('監視設定の保存結果を応答に含める',
    r.monitor_settings && r.monitor_settings.saved === true, r.monitor_settings);
  check('子の PropertiesService に保存されている（伝播の最終地点）',
    ctx.getMonitoringSettings().enabled === true);
})();

(function () {
  const { ctx } = mkChildCtx();
  const r = ctx.shardApplyFromParent({ shard_secret: 'S', student_ids: [], ka_active: true });
  check('monitor_settings が無い従来の呼び出しでも壊れない',
    r.success === true && r.monitor_settings === null, r.monitor_settings);
})();

(function () {
  const { ctx, cap } = mkChildCtx();
  const r = ctx.shardApplyFromParent({
    shard_secret: 'S', student_ids: ['s1@x.ed.jp'],
    patch: { screen_lock: true },
    monitor_settings: { enabled: true, learning_domains: [], blocked_domains: [] }
  });
  check('ポリシー適用と設定保存を同時に行える', r.success === true && r.applied === 1, r.applied);
  check('ロックも従来どおり適用される', cap.lock.length === 1 && cap.lock[0].v === true, cap.lock);
  check('同時でも監視設定は保存される', ctx.getMonitoringSettings().enabled === true);
})();

// =====================================================================
// E) 実行時: 伝播した設定で「注意」判定が立つ
// =====================================================================
console.log('\n===== [E] 実行時: 伝播後の判定（要注意フラグ・理由・URL） =====');

(function () {
  // 親で保存 → 子が受信 → 子の判定、という本番の流れを1つのVMで再現する
  const ctx = mkCtx(extract(src, 'shardChildApplyMonitorSettings') + '\n');
  ctx.shardChildApplyMonitorSettings({
    enabled: true, learning_domains: ['scratch.mit.edu', 'google.com'],
    blocked_domains: ['youtube.com']
  });
  const bad = ctx.evaluateUrlForMonitoring('https://www.youtube.com/watch?v=1', '', '');
  check('非学習サイトは要注意になる', bad.flagged === true, bad);
  check('理由に「学習に関係のないサイト」が入る',
    /学習に関係のない/.test(bad.reason), bad.reason);
  check('要注意URL（ホスト名）が入る', bad.host === 'youtube.com', bad.host);
  const good = ctx.evaluateUrlForMonitoring('https://scratch.mit.edu/projects', '', '');
  check('学習サイトは注意しない', good.flagged === false, good.flagged);
  const internal = ctx.evaluateUrlForMonitoring('chrome://settings', '', '');
  check('内部ページは対象外', internal.flagged === false, internal.flagged);
})();

(function () {
  const ctx = mkCtx(extract(src, 'shardChildApplyMonitorSettings') + '\n');
  ctx.shardChildApplyMonitorSettings({ enabled: false, learning_domains: [], blocked_domains: ['youtube.com'] });
  const r = ctx.evaluateUrlForMonitoring('https://youtube.com/', '', '');
  check('監視OFFなら非学習サイトでも注意しない', r.flagged === false, r.flagged);
})();

(function () {
  const ctx = mkCtx(extract(src, 'shardChildApplyMonitorSettings') + '\n');
  ctx.shardChildApplyMonitorSettings({ enabled: true, learning_domains: [], blocked_domains: ['youtube.com'] });
  const r = ctx.evaluateUrlForMonitoring('https://youtube.com/', 'youtube.com', '');
  check('先生の許可URLリストが辞書より優先される（誤検知の打ち消し）',
    r.flagged === false, r.flagged);
})();

// =====================================================================
// F) 実行時: 集約表示の伏せ処理（シャードモード）
// =====================================================================
console.log('\n===== [F] 実行時: 集約結果の表示・伏せ処理 =====');

(function () {
  const ctx = mkCtx(extract(src, 'shardChildApplyMonitorSettings') + '\n');
  ctx.shardChildApplyMonitorSettings({ enabled: false, learning_domains: [], blocked_domains: ['youtube.com'] });
  const list = [{ student_id: 's1', monitor_flag: true, monitor_reason: 'r', monitor_url: 'u', monitor_at: 't' }];
  const out = ctx.applyMonitorVisibility(list);
  check('監視OFFなら集約結果の注意フラグを伏せる', out[0].monitor_flag === false, out[0].monitor_flag);
  check('理由も伏せる', out[0].monitor_reason === '', out[0].monitor_reason);
  check('URLも伏せる', out[0].monitor_url === '', out[0].monitor_url);
  check('日時も伏せる', out[0].monitor_at === '', out[0].monitor_at);
})();

(function () {
  const ctx = mkCtx(extract(src, 'shardChildApplyMonitorSettings') + '\n');
  ctx.shardChildApplyMonitorSettings({ enabled: true, learning_domains: [], blocked_domains: ['youtube.com'] });
  const list = [{ student_id: 's1', monitor_flag: true, monitor_reason: 'r', monitor_url: 'youtube.com', monitor_at: 't' }];
  const out = ctx.applyMonitorVisibility(list);
  check('監視ONなら集約結果の注意フラグを保持する', out[0].monitor_flag === true, out[0].monitor_flag);
  check('理由も保持する', out[0].monitor_reason === 'r', out[0].monitor_reason);
})();

// =====================================================================
// G) 名称統一: 「サイト監視」への置換（内部識別子は維持）
// =====================================================================
console.log('\n===== [G] 名称: サイト監視への統一 =====');

check('index.html に「AI監視」が残っていない', html.indexOf('AI監視') < 0,
  (html.match(/AI監視/g) || []).length);
check('index.html に「サイト監視」がある', html.indexOf('サイト監視') >= 0);
check('管理画面のモーダル見出しが「サイト監視設定」',
  /サイト監視設定（システム全体）/.test(html));
check('有効化チェックのラベルが「サイト監視を有効にする」',
  /サイト監視を有効にする（システム全体）/.test(html));
check('保存時のトースト文言が「サイト監視」',
  /サイト監視を有効にしました/.test(html) && /サイト監視を無効にしました/.test(html));
check('辞書未登録時の警告文言が「サイト監視」',
  /サイト監視を有効にするには/.test(html));
check('Code.gs に「AI監視」が残っていない', src.indexOf('AI監視') < 0,
  (src.match(/AI監視/g) || []).length);
check('マニュアルに「AI監視」が残っていない', manual.indexOf('AI監視') < 0,
  (manual.match(/AI監視/g) || []).length);
check('管理者向けドキュメントに「AI監視」が残っていない', adminDoc.indexOf('AI監視') < 0,
  (adminDoc.match(/AI監視/g) || []).length);
check('マニュアルに「サイト監視の設定」の章がある', manual.indexOf('サイト監視の設定') >= 0);
check('目次アンカーが「サイト監視」に揃っている',
  manual.indexOf('#12-サイト監視の設定') >= 0 && manual.indexOf('ai監視') < 0);

// 内部識別子・設定キーは後方互換のため据え置き
check('PropertiesService キー MONITOR_SETTINGS_V1 は維持',
  src.indexOf("MONITOR_PROP_KEY = 'MONITOR_SETTINGS_V1'") >= 0);
check('内部の monitor_flag 系キーも維持（端末・拡張機能との互換）',
  src.indexOf('monitor_flag') >= 0 && src.indexOf('monitor_reason') >= 0 &&
  src.indexOf('monitor_url') >= 0 && src.indexOf('monitor_at') >= 0);
check('API アクション名（get_monitor_settings）も維持',
  src.indexOf("action === 'get_monitor_settings'") >= 0);
check('API アクション名（save_monitor_settings）も維持',
  src.indexOf("action === 'save_monitor_settings'") >= 0);

// =====================================================================
// H) 不変条件: 拡張機能・伝播経路の前提を壊していない
// =====================================================================
console.log('\n===== [H] 不変条件 =====');

check('拡張機能の版数は 1.6.13', manifest.version === '1.6.13', manifest.version);
check('manifest に default_popup を追加していない',
  !JSON.stringify(manifest).includes('default_popup'));
check('子スプレッドシートへのテレメトリ書き戻しをしていない（親シートへの転記なし）',
  !/setValue\([\s\S]{0,40}monitor_flag/.test(src));
check('伝播は PropertiesService 経由（MONITOR_PROP_KEY）のみ',
  extract(src, 'shardPropagateMonitorSettings').indexOf('SpreadsheetApp') < 0 &&
  extract(src, 'shardChildApplyMonitorSettings').indexOf('SpreadsheetApp') < 0);
check('通信経路は google.script.run のまま（index.html に fetch 直叩きを増やしていない）',
  /google\.script\.run/.test(html));

console.log('\n===== 結果: PASS=' + pass + ' FAIL=' + fail + ' =====');
if (fail > 0) process.exit(1);
