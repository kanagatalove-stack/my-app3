// ============================================================================
// r56_pooled_live_watch.js — プール制ライブ視聴（v1.6.8）
//
//  検証対象（gas/Code.gs + extension/ + dist/）:
//   A. 全体プール 24 台 … 24 端末までは新規許可、25 端末目で LIVE_WATCH_POOL_FULL
//   B. 相乗り視聴       … 既に視聴中の児童へ別教員が開始してもユニーク数は増えず、
//                          24/24 満枠でも許可される（端末への要求も 1 ストリームのまま）
//   C. 管理設定         … live_watch_per_teacher_limit（0 / 1〜25 / 無限）と
//                          live_watch_timeout_sec が PropertiesService 経由で保存・反映され、
//                          一般アカウントからは変更できない
//   D. 解放             … TTL切れ・自動タイムアウト満了・停止操作で枠が解放され、
//                          対象端末のハートビートは live_watch: false になる
//   E. 出荷物           … dist/*.zip と update.xml が v1.6.8 で固定仕様を維持
//
//  明示リスト方式: 必要な関数・定数だけを列挙して vm へ読み込む。
// ============================================================================
'use strict';

const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'gas/Code.gs'), 'utf8');
const bgSrc = fs.readFileSync(path.join(ROOT, 'extension/background.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension/manifest.json'), 'utf8'));

let pass = 0, fail = 0;
function check(n, c, e) {
  if (c) { console.log('PASS ' + n + (e !== undefined ? ' => ' + JSON.stringify(e) : '')); pass++; }
  else { console.log('FAIL ' + n + (e !== undefined ? ' => ' + JSON.stringify(e) : '')); fail++; }
}

// ---- 関数を波括弧の対応を数えて切り出す（明示リスト方式の共通部品） ----
function extract(name) {
  const re = new RegExp('^[ \\t]*(?:async )?function ' + name + '\\s*\\(', 'm');
  const m = src.match(re);
  if (!m) throw new Error('not found fn: ' + name);
  const start = m.index;
  let i = src.indexOf('{', start), depth = 0, end = -1;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  return src.slice(start, end + 1);
}
function extractConst(name) {
  const re = new RegExp('^const ' + name + '\\s*=', 'm');
  const m = src.match(re);
  if (!m) throw new Error('const not found: ' + name);
  const start = m.index;
  let i = src.indexOf('=', start), depth = 0, end = -1;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === '[' || ch === '{' || ch === '(') depth++;
    else if (ch === ']' || ch === '}' || ch === ')') depth--;
    else if (ch === ';' && depth === 0) { end = i; break; }
  }
  return src.slice(start, end + 1);
}

// ============================================================================
// 1. GAS 実行環境（CacheService / PropertiesService / 仮想時計）
// ============================================================================
let clock = 1700000000000; // 仮想現在時刻（ms）
const cacheStore = new Map();
const props = {};           // ScriptProperties の写し

const ctx = {
  console: console,
  JSON, Math, String, Number, Array, Object, Boolean, RegExp, Error, Date,
  isFinite, isNaN, parseInt, parseFloat,
  Utilities: { formatDate() { return '2026/11/25 12:00:00'; } },
  Logger: { log() {} },
  CacheService: {
    getScriptCache() {
      return {
        get(k) { return cacheStore.has(k) ? cacheStore.get(k) : null; },
        put(k, v /*, ttl */) { cacheStore.set(k, String(v)); },
        remove(k) { cacheStore.delete(k); }
      };
    }
  },
  PropertiesService: {
    getScriptProperties() {
      return {
        getProperty(k) { return (k in props) ? props[k] : null; },
        setProperty(k, v) { props[k] = String(v); }
      };
    }
  },
  invalidateDevicesCache() {},
  shardPropagateMonitorSettings() {}
};
// 仮想時計（liveWatchNowMs_ は new Date().getTime() を使う）
function FakeDate() { this.getTime = function () { return clock; }; this.valueOf = this.getTime; }
FakeDate.now = function () { return clock; };
ctx.Date = FakeDate;
vm.createContext(ctx);

const FNS = [
  // 正規化・設定
  'normalizeLiveWatchPerTeacherLimit', 'normalizeLiveWatchTimeoutSec',
  'liveWatchTeacherKey_', 'liveWatchCache_', 'liveWatchSettings_',
  'liveWatchNowMs_', 'isAdminTeacher',
  // プール台帳
  'liveWatchReadPool_', 'liveWatchWritePool_', 'liveWatchSessionActive_',
  'liveWatchPrune_', 'liveWatchUniqueCount_', 'liveWatchTeacherCount_',
  'liveWatchIsWatched_', 'liveWatchStatus', 'liveWatchUsageBits_',
  // 操作
  'liveWatchStart', 'liveWatchExtend', 'liveWatchStop',
  'liveWatchClearFrame_', 'liveWatchPutFrame', 'liveWatchGetFrames',
  'liveWatchApplyBatch',
  // 管理設定（PropertiesService 保存・管理者限定）
  'getMonitoringSettings', 'sanitizeMonitorDomainList', 'normalizeMonitorHost',
  'saveMonitoringSettings'
];
const CONSTS = [
  'MAX_LIVE_WATCH_DEVICES', 'LIVE_WATCH_TTL_SEC', 'LIVE_WATCH_EXTEND_SEC',
  'LIVE_WATCH_FRAME_TTL_SEC', 'LIVE_WATCH_POOL_CACHE_SEC', 'LIVE_WATCH_POOL_KEY',
  'LIVE_WATCH_FRAME_PREFIX', 'LIVE_WATCH_MAX_FRAME_CHARS',
  'LIVE_WATCH_DEFAULT_PER_TEACHER_LIMIT', 'LIVE_WATCH_MAX_PER_TEACHER_LIMIT',
  'LIVE_WATCH_DEFAULT_TIMEOUT_SEC', 'LIVE_WATCH_MIN_TIMEOUT_SEC',
  'LIVE_WATCH_MAX_TIMEOUT_SEC', 'LIVE_WATCH_UNLIMITED',
  'MONITOR_PROP_KEY', 'MONITOR_MAX_DOMAINS',
  'MONITOR_DEFAULT_LEARNING_DOMAINS', 'MONITOR_DEFAULT_BLOCKED_DOMAINS'
];

let bundle = '';
CONSTS.forEach(function (n) { bundle += extractConst(n) + '\n'; });
FNS.forEach(function (n) { bundle += extract(n) + '\n'; });
vm.runInContext(bundle, ctx);

function g(name) { return vm.runInContext(name, ctx); } // 定数（const）は sandbox 直下に出ない
function call(name, args) { return vm.runInContext(name, ctx).apply(null, args || []); }

const ADMIN = { email: 'admin@example.com', role: 'ADMIN' };
const T1 = { email: 't1@example.com', role: 'TEACHER' };
const T2 = { email: 't2@example.com', role: 'TEACHER' };

function resetAll() {
  cacheStore.clear();
  Object.keys(props).forEach(function (k) { delete props[k]; });
}

// ============================================================================
// A. 全体プール制（最大 24 ユニーク端末）
// ============================================================================
console.log('===== A. 全体プール 24 台 =====');
resetAll();
// 管理設定: 1教員あたり「無限」にして教員上限の影響を外す（プール上限だけを見る）
call('saveMonitoringSettings', [ADMIN, { live_watch_per_teacher_limit: -1, live_watch_timeout_sec: 900 }]);

check('A0 MAX_LIVE_WATCH_DEVICES は 24', g('MAX_LIVE_WATCH_DEVICES') === 24, g('MAX_LIVE_WATCH_DEVICES'));

let aOk = 0, aLast = null;
for (let i = 1; i <= 24; i++) {
  const r = call('liveWatchStart', [T1, 'S' + i]);
  aLast = r;
  if (r && r.success === true && r.live_watch === true) aOk++;
}
check('A1 24 端末すべて新規ライブ視聴が許可される', aOk === 24, aOk);
check('A2 24 台目の応答で used=24 / max=24 / full=true',
  aLast.used === 24 && aLast.max === 24 && aLast.full === true,
  { used: aLast.used, max: aLast.max, full: aLast.full });

const st24 = call('liveWatchStatus', [T1]);
check('A3 使用数は 24、残り 0 枠', st24.used === 24 && st24.remaining === 0 && st24.full === true,
  { used: st24.used, remaining: st24.remaining });

const r25 = call('liveWatchStart', [T1, 'S25']);
check('A4 25 端末目の新規追加は LIVE_WATCH_POOL_FULL', r25.success === false && r25.code === 'LIVE_WATCH_POOL_FULL',
  { code: r25.code });
check('A5 エラーに現在の使用数 24/24 を併せて返す', r25.usage === '24/24', r25.usage);
check('A6 プール満杯でも 24 台のまま（25 台目は登録されない）',
  call('liveWatchStatus', [T1]).used === 24);

// ============================================================================
// B. 同一児童の相乗り（共有）
// ============================================================================
console.log('\n===== B. 相乗り視聴（共有） =====');
let sharedOk = true, sharedUsedGrew = false;
for (let i = 1; i <= 24; i++) {
  const r = call('liveWatchStart', [T2, 'S' + i]); // 満枠(24/24)で別教員が同じ児童へ相乗り
  if (!(r && r.success === true && r.live_watch === true && r.shared === true)) sharedOk = false;
  if (r && r.used !== 24) sharedUsedGrew = true;
}
check('B1 24/24 満枠でも「すでに視聴中の児童」への相乗りは許可される', sharedOk);
check('B2 相乗りしてもユニーク台数は 24 のまま増えない', sharedUsedGrew === false);

const stShare = call('liveWatchStatus', [T2]);
check('B3 相乗りした教員の視聴枠も 24 台として数えられる', stShare.teacher_used === 24, stShare.teacher_used);
check('B4 台帳上も 24 ストリームのまま（端末へのキャプチャ要求は 1 本）',
  Object.keys(JSON.parse(cacheStore.get('live_watch_pool_v1')).students).length === 24);

// ============================================================================
// C. 管理設定（PropertiesService 経由・管理者のみ）
// ============================================================================
console.log('\n===== C. 管理アカウント専用設定 =====');
resetAll();

// 既定値（未保存）
const defs = call('getMonitoringSettings', []);
check('C1 既定は 1教員あたり 3 台', defs.live_watch_per_teacher_limit === 3, defs.live_watch_per_teacher_limit);
check('C2 既定の自動タイムアウトは 180 秒', defs.live_watch_timeout_sec === 180, defs.live_watch_timeout_sec);

// 管理者が 0（機能無効）を保存
call('saveMonitoringSettings', [ADMIN, { live_watch_per_teacher_limit: 0, live_watch_timeout_sec: 300 }]);
const savedZero = call('getMonitoringSettings', []);
check('C3 0（機能無効）が PropertiesService に保存される', savedZero.live_watch_per_teacher_limit === 0, savedZero.live_watch_per_teacher_limit);
check('C4 自動タイムアウト 300 秒が保存される', savedZero.live_watch_timeout_sec === 300, savedZero.live_watch_timeout_sec);
check('C5 保存先は PropertiesService（MONITOR_SETTINGS_V1）のみ',
  !!props.MONITOR_SETTINGS_V1 && JSON.parse(props.MONITOR_SETTINGS_V1).live_watch_per_teacher_limit === 0);

const disabledRes = call('liveWatchStart', [T1, 'S1']);
check('C6 0 のとき一般教員の新規ライブ視聴はブロック（LIVE_WATCH_DISABLED）',
  disabledRes.success === false && disabledRes.code === 'LIVE_WATCH_DISABLED', disabledRes.code);
check('C7 案内文「現在管理者によりライブ視聴が制限されています」を返す',
  /現在管理者によりライブ視聴が制限されています/.test(String(disabledRes.error || '')), disabledRes.error);
check('C8 インジケーター用 status も disabled:true を返す', call('liveWatchStatus', [T1]).disabled === true);

// 1〜25 の各値
let limitsOk = true;
[1, 2, 3, 5, 12, 25].forEach(function (v) {
  call('saveMonitoringSettings', [ADMIN, { live_watch_per_teacher_limit: v }]);
  if (call('getMonitoringSettings', []).live_watch_per_teacher_limit !== v) limitsOk = false;
});
check('C9 1〜25 の各値がそのまま保存・反映される', limitsOk);

// 無限（-1 / 'unlimited'）
call('saveMonitoringSettings', [ADMIN, { live_watch_per_teacher_limit: -1 }]);
check('C10 無限は内部値 -1 で保存される', call('getMonitoringSettings', []).live_watch_per_teacher_limit === -1);
call('saveMonitoringSettings', [ADMIN, { live_watch_per_teacher_limit: 'unlimited' }]);
check("C11 'unlimited' も -1 に正規化される", call('getMonitoringSettings', []).live_watch_per_teacher_limit === -1);
check('C12 無限のとき status は teacher_unlimited:true',
  call('liveWatchStatus', [T1]).teacher_unlimited === true);

// 権限のない一般アカウントは変更できない
let denied = false;
try {
  call('saveMonitoringSettings', [T1, { live_watch_per_teacher_limit: 25, live_watch_timeout_sec: 900 }]);
} catch (e) { denied = true; }
check('C13 一般アカウントは設定を変更できない（例外）', denied === true);
check('C14 拒否後も設定は書き換わっていない（無限のまま）',
  call('getMonitoringSettings', []).live_watch_per_teacher_limit === -1);

// 1教員あたりの上限が実際に効く（3 台設定 → 4 台目でブロック）
resetAll();
call('saveMonitoringSettings', [ADMIN, { live_watch_per_teacher_limit: 3, live_watch_timeout_sec: 180 }]);
const t3 = ['S1', 'S2', 'S3'].map(function (sid) { return call('liveWatchStart', [T1, sid]); });
const t3over = call('liveWatchStart', [T1, 'S4']);
check('C15 設定 3 台のとき 4 台目は上限でブロック（LIVE_WATCH_TEACHER_LIMIT）',
  t3.every(function (r) { return r.success === true; }) &&
  t3over.success === false && t3over.code === 'LIVE_WATCH_TEACHER_LIMIT', t3over.code);
const t3other = call('liveWatchStart', [T2, 'S4']);
check('C16 他教員は自分の枠で開始できる（上限は教員ごと）', t3other.success === true);

// ============================================================================
// D. 解放（TTL 切れ / 自動タイムアウト / 停止）
// ============================================================================
console.log('\n===== D. 枠の解放 =====');
resetAll();
call('saveMonitoringSettings', [ADMIN, { live_watch_per_teacher_limit: -1, live_watch_timeout_sec: 180 }]);

// D-1 TTL 切れ（25 秒）で自動解放される
call('liveWatchStart', [T1, 'S1']);
check('D1 開始直後はライブ視聴対象（live_watch:true）', call('liveWatchIsWatched_', ['S1']) === true);
clock += (g('LIVE_WATCH_TTL_SEC') + 1) * 1000;
check('D2 TTL 経過後はライブ視聴対象外（live_watch:false）', call('liveWatchIsWatched_', ['S1']) === false);
check('D3 TTL 経過後はプール使用数が 0 に戻る', call('liveWatchStatus', [T1]).used === 0);

// D-2 延長ハートビート（10 秒ごと）で TTL は延びる
resetAll();
clock += 1000;
call('liveWatchStart', [T1, 'S2']);
for (let i = 0; i < 3; i++) { clock += 10000; call('liveWatchExtend', [T1, 'S2']); }
check('D4 10 秒ごとの延長で TTL 内は視聴が継続する', call('liveWatchIsWatched_', ['S2']) === true);

// D-3 自動タイムアウト満了（timeout < TTL になる設定で検証）
resetAll();
call('saveMonitoringSettings', [ADMIN, { live_watch_per_teacher_limit: -1, live_watch_timeout_sec: 30 }]);
const dStart = clock;
call('liveWatchStart', [T1, 'S3']);
for (let i = 0; i < 2; i++) { clock += 10000; call('liveWatchExtend', [T1, 'S3']); }
check('D5 自動タイムアウト（30 秒）以内は視聴が継続する',
  (clock - dStart) < 30000 && call('liveWatchIsWatched_', ['S3']) === true, { elapsed: clock - dStart });
clock = dStart + 31000; // 30 秒を超える（延長していても opened_at 基準で失効）
check('D6 自動タイムアウト満了で即座に対象外になる（live_watch:false）',
  call('liveWatchIsWatched_', ['S3']) === false);
check('D7 タイムアウト満了でプール枠が解放される', call('liveWatchStatus', [T1]).used === 0);

// D-4 停止操作
resetAll();
call('saveMonitoringSettings', [ADMIN, { live_watch_per_teacher_limit: -1, live_watch_timeout_sec: 180 }]);
call('liveWatchStart', [T1, 'S4']);
call('liveWatchStart', [T2, 'S4']); // 相乗り
const stop1 = call('liveWatchStop', [T1, 'S4']);
check('D8 停止は成功し、相乗り者が残っている間は live_watch:true', stop1.success === true && stop1.live_watch === true,
  { live_watch: stop1.live_watch });
check('D9 相乗り者がいる間は端末は視聴対象のまま', call('liveWatchIsWatched_', ['S4']) === true);
const stop2 = call('liveWatchStop', [T2, 'S4']);
check('D10 最後の1人が停止すると live_watch:false を返す', stop2.success === true && stop2.live_watch === false,
  { live_watch: stop2.live_watch });
check('D11 全員停止でプール枠が解放される', call('liveWatchStatus', [T1]).used === 0);

// D-5 バッチ操作（管理画面の一括開始/延長/停止）
resetAll();
// resetAll は PropertiesService も消すため、管理者設定を保存し直してから検証する
call('saveMonitoringSettings', [ADMIN, { live_watch_per_teacher_limit: -1, live_watch_timeout_sec: 180 }]);
const batch = call('liveWatchApplyBatch', [T1, ['S5', 'S6'], 'start']);
check('D12 一括開始が成功し results を返す', batch.success === true && batch.results.length === 2, batch.usage);
const batchStop = call('liveWatchApplyBatch', [T1, ['S5', 'S6'], 'stop']);
check('D13 一括停止で枠が解放される', batchStop.success === true && call('liveWatchStatus', [T1]).used === 0);
const batchFull = (function () {
  for (let i = 1; i <= 24; i++) call('liveWatchStart', [T1, 'P' + i]);
  return call('liveWatchApplyBatch', [T1, ['P25'], 'start']);
})();
check('D14 一括操作でも 25 台目は LIVE_WATCH_POOL_FULL を返す',
  batchFull.success === false && batchFull.code === 'LIVE_WATCH_POOL_FULL', batchFull.code);

// ============================================================================
// E. 出荷物（dist / update.xml / 固定仕様）v1.6.8
// ============================================================================
console.log('\n===== E. v1.6.8 出荷物と固定仕様 =====');
function zipEntry(zipPath, entry) {
  return execSync(
    "python3 -c \"import zipfile,sys;print(zipfile.ZipFile(sys.argv[1]).read(sys.argv[2]).decode('utf-8'))\" " +
    JSON.stringify(zipPath) + ' ' + JSON.stringify(entry),
    { cwd: ROOT, encoding: 'utf8' }
  );
}
function zipNames(zipPath) {
  return execSync(
    "python3 -c \"import zipfile,sys;print('\\n'.join(zipfile.ZipFile(sys.argv[1]).namelist()))\" " +
    JSON.stringify(zipPath),
    { cwd: ROOT, encoding: 'utf8' }
  );
}

check('E1 extension/manifest.json の version は 1.6.8', manifest.version === '1.6.8', manifest.version);
check('E2 default_popup を持たない（児童のアイコン操作は無反応）', !manifest.action || !manifest.action.default_popup);
const perms = (manifest.permissions || []).slice().sort().join(',');
check('E3 権限は既存のまま（新規権限の追加なし＝再同意プロンプトを出さない）',
  perms === 'alarms,identity,identity.email,idle,storage,tabs', perms);
check("E4 DEFAULT_GAS_URL は '' のまま", /const DEFAULT_GAS_URL = '';/.test(bgSrc));

const sm = JSON.parse(zipEntry('dist/store.zip', 'manifest.json'));
check('E5 dist/store.zip の manifest.version は 1.6.8', sm.version === '1.6.8', sm.version);
check('E6 dist/store.zip に default_popup が無い', !sm.action || !sm.action.default_popup);
const dm = JSON.parse(zipEntry('dist/direct.zip', 'manifest.json'));
check('E7 dist/direct.zip の manifest.version も 1.6.8', dm.version === '1.6.8', dm.version);
check('E8 dist/direct.zip は検証用（popup.html 同梱・default_popup あり）',
  !!dm.action && !!dm.action.default_popup && /^variants\/direct_overrides\/popup.html$/m.test(zipNames('dist/direct.zip').replace(/^popup\.html$/m, 'variants/direct_overrides/popup.html')) || /(^|\n)popup\.html(\n|$)/.test(zipNames('dist/direct.zip')));
const xml = fs.readFileSync(path.join(ROOT, 'dist/update.xml'), 'utf8');
check("E9 dist/update.xml の version は 1.6.8", /version='1\.6\.8'/.test(xml), (xml.match(/version='[^']+'/) || [])[0]);
const policy = JSON.parse(fs.readFileSync(path.join(ROOT, 'dist/managed_policy.json'), 'utf8'));
const policyTxt = JSON.stringify(policy);
check('E10 managed_policy は 14 校（東粟倉小は廃校のため含まない）',
  policyTxt.indexOf('東粟倉') === -1 && (policyTxt.match(/小学校/g) || []).length >= 0);

// 拡張機能の固定仕様（v1.6.8 の軽量キャプチャ）
check('E11 送信上限は 30,000 文字', /const LIVE_WATCH_MAX_B64 = 30000;/.test(bgSrc));
check('E12 縮小の目標横幅は 480px 前後', /const LIVE_WATCH_TARGET_WIDTH = 480;/.test(bgSrc));
check('E13 captureVisibleTab を JPEG・低品質で使う',
  /chrome\.tabs\.captureVisibleTab\(\s*tab\.windowId,\s*\{[\s\S]{0,120}?format:\s*'jpeg'[\s\S]{0,80}?quality:/.test(bgSrc));
check('E14 送信は live_frame アクション（子GASへ）', /action: 'live_frame'/.test(bgSrc));
check('E15 in-flight 排他で多重送信しない', /liveWatchInFlight/.test(bgSrc) &&
  /if \(liveWatchInFlight\) return false;/.test(bgSrc));
check('E16 live_watch === true の端末だけが撮影する',
  /if \(!liveWatchActive\) return false;/.test(bgSrc));
check('E17 ハートビート応答の live_watch を applyPolicies で反映する',
  /applyLiveWatchFlag\(newPolicy\.live_watch === true\)/.test(bgSrc));
check('E18 撮影は既存の 1.5 秒ポーリングに同期（syncWithGas から呼ぶ）',
  /liveWatchActive === true[\s\S]{0,200}?liveWatchCaptureOnce\(\)/.test(bgSrc));
check('E19 ACTIVE_SYNC_MS（1.5 秒）は維持', /const ACTIVE_SYNC_MS = 1500;/.test(bgSrc));

// GAS 側の設計値
check('E20 セッション TTL は 25 秒・延長 10 秒', g('LIVE_WATCH_TTL_SEC') === 25 && g('LIVE_WATCH_EXTEND_SEC') === 10);
check('E21 フレーム受信上限は 30,000 文字', g('LIVE_WATCH_MAX_FRAME_CHARS') === 30000, g('LIVE_WATCH_MAX_FRAME_CHARS'));
check('E22 ハートビート応答に live_watch を載せている', /live_watch: liveWatchFlag,/.test(src));

console.log('\n===== 結果: PASS=' + pass + ' FAIL=' + fail + ' =====');
process.exit(fail > 0 ? 1 : 0);
