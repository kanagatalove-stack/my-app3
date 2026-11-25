// ============================================================================
// r53_ext_fast_poll.js — 拡張機能の稼働中高精度ポーリング（r53 で追加 / v1.6.14 時点の版数で検証）
//
//  実機症状（GAS 側の高速化 8e11e53 / 5af5e0e 完了後）
//    GAS は最速 2〜4 秒で反映するようになったが、拡張機能 (MV3) の
//    Service Worker スリープと chrome.alarms の間引き（最短 30 秒＋遅延）により、
//    アイドルから復帰する回だけ 10〜14 秒まで遅延がばらつく。
//
//  v1.6.6 の設計（確定方針: 既存構造の精密化。独立ループは追加しない）
//    ① 稼働中(ka_active=true) … setTimeout チェーンを主軸に
//       GAS 応答の sync_interval_sec（通常 1.5 秒／過負荷バックオフ 4 秒）へ厳密追従
//    ② フェイルセーフ … chrome.alarms(30 秒) を並行維持し、SW 強制停止から即復旧
//    ③ 起床パルス … アクティブタブの content script が稼働中のみ KEEPALIVE_PING
//    ④ 重複排除 … setTimeout / alarms / 起床パルスの同時トリガーでも
//       sync_interval_sec × 0.8 秒未満の再送と in-flight の二重送信は必ず捨てる
//    ⑤ 非稼働(ka_active=false) を受けた瞬間にチェーン停止＋長周期スリープへ復帰
//    ⑥ 動的バックオフ追従 … sync_interval_sec=4 が来たら即座に 4 秒へ張り替え
//
//  検証は gas ではなく extension/background.js の実関数を vm へ切り出して行う。
//  （明示リスト方式: 必要な関数だけを列挙する）
// ============================================================================
'use strict';

const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const bgSrc = fs.readFileSync(path.join(ROOT, 'extension/background.js'), 'utf8');
const contentSrc = fs.readFileSync(path.join(ROOT, 'extension/content.js'), 'utf8');
const manifestRaw = fs.readFileSync(path.join(ROOT, 'extension/manifest.json'), 'utf8');
const manifest = JSON.parse(manifestRaw);

let pass = 0, fail = 0;
function check(n, c, e) {
  if (c) { console.log('PASS ' + n + (e !== undefined ? ' => ' + JSON.stringify(e) : '')); pass++; }
  else { console.log('FAIL ' + n + (e !== undefined ? ' => ' + JSON.stringify(e) : '')); fail++; }
}

// ---- 関数を波括弧の対応を数えて切り出す（明示リスト方式の共通部品） ----
function extract(name) {
  const re = new RegExp('^function ' + name + '\\s*\\(', 'm');
  const start = bgSrc.search(re);
  if (start < 0) throw new Error('not found fn: ' + name);
  let i = bgSrc.indexOf('{', start), depth = 0, end = -1;
  for (; i < bgSrc.length; i++) {
    if (bgSrc[i] === '{') depth++;
    else if (bgSrc[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  return bgSrc.slice(start, end + 1);
}
function decl(name) {
  const m = bgSrc.match(new RegExp('^(?:let|const|var) ' + name + '\\s*=[^;\\n]*;', 'm'));
  if (!m) throw new Error('not found decl: ' + name);
  return m[0];
}

// ============================================================================
// 1. 仮想タイマー／仮想時計つきの実行環境を作る
// ============================================================================
function makeHarness() {
  let clock = 1000000;         // Date.now() の代わり
  let seq = 1;
  const timers = new Map();    // id -> { at, fn }
  const alarms = {};           // name -> options
  const syncCalls = [];        // syncWithGas の呼び出し時刻
  const storageWrites = [];

  const h = {
    clock: () => clock,
    advance: (ms) => {
      const target = clock + ms;
      // 時刻順に発火（同刻は id 昇順）
      for (;;) {
        let pick = null;
        timers.forEach((t, id) => {
          if (t.at <= target && (!pick || t.at < pick.t.at || (t.at === pick.t.at && id < pick.id))) {
            pick = { id: id, t: t };
          }
        });
        if (!pick) break;
        clock = pick.t.at;
        timers.delete(pick.id);
        pick.t.fn();
      }
      clock = target;
    },
    pendingCount: () => timers.size,
    pendingDelays: () => Array.from(timers.values()).map(t => t.at - clock).sort((a, b) => a - b),
    alarms: alarms,
    syncCalls: syncCalls,
    storageWrites: storageWrites,
    ctx: null
  };

  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    JSON, Math, String, Number, Array, Object, Boolean, Set, Map, RegExp, Error,
    isNaN, isFinite, parseInt, parseFloat,
    Date: { now: () => clock },
    setTimeout: (fn, ms) => { const id = seq++; timers.set(id, { at: clock + (ms || 0), fn: fn }); return id; },
    clearTimeout: (id) => { timers.delete(id); },
    setInterval: () => { throw new Error('setInterval は使わない（チェーンで置き換える）'); },
    chrome: {
      alarms: {
        create: (name, opts) => { alarms[name] = opts || {}; },
        clear: (name) => { delete alarms[name]; }
      },
      storage: {
        local: {
          set: (obj) => { storageWrites.push(obj); }
        }
      }
    },
    // 稼働判定の入力（テストから差し替える）
    //   ※ 実物の syncWithGas は送信直前に lastHeartbeatStartMs を更新する。
    //     これを再現しないと「0.8×interval 未満は捨てる」判定を検証できない。
    syncWithGas: function () {
      syncCalls.push(clock);
      try {
        vm.runInContext('lastHeartbeatStartMs = ' + clock + '; lastHeartbeatSentMs = ' + clock + ';', ctx);
      } catch (e) {}
    },
    // applyRemoteKeepalive が呼ぶ周辺関数（本テストの対象外なのでスタブ）
    scheduleIdleDrift: function () {},
    clearIdleDriftAlarm: function () {},
    ensureWakeProbe: function () {},
    clearWakeProbe: function () {},
    ensureSlowPoll: function () { ctx.__slowPoll = true; },
    clearSlowPoll: function () { ctx.__slowPoll = false; },
    scheduleInterestActive: function () { return false; }
  };
  vm.createContext(ctx);

  // 明示リスト: 状態宣言 → 定数 → 実関数
  let code = '';
  ['keepaliveActive', 'activeIntervalMs', 'idleDriftUntil', 'fastChainTimer',
   'lastHeartbeatStartMs', 'lastSyncMs', 'hasSyncedOnce', 'syncInFlight']
    .forEach(function (n) { code += decl(n) + '\n'; });
  ['ACTIVE_SYNC_MS', 'IDLE_SYNC_MS', 'IDLE_DRIFT_MS', 'SLOW_POLL_MS', 'FAST_MIN_GAP_RATIO']
    .forEach(function (n) { code += decl(n) + '\n'; });
  code += 'hasSyncedOnce = true;\n';   // 初回ブートストラップ分岐は本テストの対象外
  ['clearFastChain', 'scheduleFastChain', 'ensureSyncLoop', 'stopSyncLoop',
   'applyRemoteKeepalive', 'maybeSync']
    .forEach(function (n) { code += extract(n) + '\n'; });
  vm.runInContext(code, ctx);

  h.ctx = ctx;
  return h;
}

// ============================================================================
// 2. 稼働中の setTimeout チェーンが sync_interval_sec(1.5 秒) に追従する
// ============================================================================
console.log('\n===== A. 稼働中(ka_active=true)の高精度チェーン（1.5 秒） =====');

let H = makeHarness();
H.ctx.applyRemoteKeepalive({ ka_active: true, sync_interval_sec: 1.5 });

check('A1 ka_active=true でフェイルセーフの alarms(30秒) が張られる',
  !!H.alarms['syncAlarm'] && H.alarms['syncAlarm'].periodInMinutes === 0.5, H.alarms['syncAlarm']);
check('A2 ka_active=true で setTimeout チェーンが 1 本だけ予約される',
  H.pendingCount() === 1, { pending: H.pendingCount() });
check('A3 チェーンの初回遅延が sync_interval_sec(1500ms)',
  H.pendingDelays()[0] === 1500, H.pendingDelays());
check('A4 予約直後はまだハートビートを送らない',
  H.syncCalls.length === 0, H.syncCalls.length);

H.advance(1500);
check('A5 1500ms 後にハートビートが 1 回送られる', H.syncCalls.length === 1,
  { calls: H.syncCalls.length });
check('A6 送信後すぐ次の 1500ms が再予約される（チェーン継続）',
  H.pendingCount() === 1 && H.pendingDelays()[0] === 1500, H.pendingDelays());

H.advance(1500);
H.advance(1500);
check('A7 連続 3 周期で 1.5 秒間隔のまま送信される',
  H.syncCalls.length === 3,
  { calls: H.syncCalls.length, gaps: H.syncCalls.map((t, i) => i ? t - H.syncCalls[i - 1] : 0) });

// ============================================================================
// 3. 二重送信の防止（sync_interval_sec × 0.8 と in-flight）
// ============================================================================
console.log('\n===== B. 重複トリガーの排除（×0.8 と in-flight） =====');

H = makeHarness();
H.ctx.applyRemoteKeepalive({ ka_active: true, sync_interval_sec: 1.5 });
H.advance(1500);                       // 1 回目（t=1500）
const beforeDup = H.syncCalls.length;

H.advance(500);                        // t=2000（0.8×1500=1200 未満の経過 500ms）
H.ctx.maybeSync();                     // 起床パルスからの同時トリガー相当
check('B1 前回送信から 0.8×interval(1200ms) 未満の再トリガーは捨てる',
  H.syncCalls.length === beforeDup, { before: beforeDup, after: H.syncCalls.length });

H.advance(1000);                       // t=3000（経過 1500ms ≧ 1200ms）
H.ctx.maybeSync();
check('B2 0.8×interval 以上経過していれば送信する',
  H.syncCalls.length === beforeDup + 1, { calls: H.syncCalls.length });

// in-flight（通信中）の同時リクエスト
H = makeHarness();
H.ctx.applyRemoteKeepalive({ ka_active: true, sync_interval_sec: 1.5 });
H.advance(1500);
const beforeFlight = H.syncCalls.length;
vm.runInContext('syncInFlight = true;', H.ctx);
H.advance(5000);
H.ctx.maybeSync();
H.ctx.maybeSync();
check('B3 in-flight（通信中）の間は同時リクエストを一切送らない',
  H.syncCalls.length === beforeFlight, { before: beforeFlight, after: H.syncCalls.length });
vm.runInContext('syncInFlight = false;', H.ctx);
H.ctx.maybeSync();
check('B4 in-flight が解けたら再開する', H.syncCalls.length === beforeFlight + 1,
  H.syncCalls.length);

// 3 経路（チェーン / alarms / 起床パルス）が同刻に叩いても 1 回だけ
H = makeHarness();
H.ctx.applyRemoteKeepalive({ ka_active: true, sync_interval_sec: 1.5 });
H.advance(1500);
const beforeStorm = H.syncCalls.length;
H.ctx.maybeSync();   // alarm 相当
H.ctx.maybeSync();   // ping 相当
H.ctx.maybeSync();   // もう一度 ping
check('B5 チェーン直後に alarms/ping が同時に叩いても二重送信しない',
  H.syncCalls.length === beforeStorm, { before: beforeStorm, after: H.syncCalls.length });

// ============================================================================
// 4. 動的バックオフ（sync_interval_sec = 4）への即時追従
// ============================================================================
console.log('\n===== C. 過負荷バックオフ(sync_interval_sec=4)への追従 =====');

H = makeHarness();
H.ctx.applyRemoteKeepalive({ ka_active: true, sync_interval_sec: 1.5 });
check('C1 通常時は 1500ms 周期', H.pendingDelays()[0] === 1500, H.pendingDelays());

H.ctx.applyRemoteKeepalive({ ka_active: true, sync_interval_sec: 4 });
check('C2 sync_interval_sec=4 が来たら即座に 4000ms へ張り替える',
  H.pendingCount() === 1 && H.pendingDelays()[0] === 4000, H.pendingDelays());

H.advance(3999);
check('C3 4000ms 未満では送信しない（GAS の負荷保護を損なわない）',
  H.syncCalls.length === 0, H.syncCalls.length);
H.advance(1);
check('C4 4000ms 経過で送信し、次の 4000ms を再予約する',
  H.syncCalls.length === 1 && H.pendingDelays()[0] === 4000,
  { calls: H.syncCalls.length, delays: H.pendingDelays() });

// バックオフ中の重複しきい値も 0.8×4000=3200ms に広がる
H.advance(1000);                       // 経過 1000ms
H.ctx.maybeSync();
check('C5 バックオフ中は 0.8×4000(3200ms) 未満の再トリガーを捨てる',
  H.syncCalls.length === 1, H.syncCalls.length);
H.advance(2500);                       // 経過 3500ms
H.ctx.maybeSync();
check('C6 3200ms を超えればバックオフ中でも送信する',
  H.syncCalls.length === 2, H.syncCalls.length);

H.ctx.applyRemoteKeepalive({ ka_active: true, sync_interval_sec: 1.5 });
check('C7 負荷が下がれば 1500ms へ即座に戻る',
  H.pendingDelays()[0] === 1500, H.pendingDelays());

// ============================================================================
// 5. 非稼働(ka_active=false)で即時停止し、従来の長周期スリープへ戻る
// ============================================================================
console.log('\n===== D. 非稼働(ka_active=false)の即時停止 =====');

H = makeHarness();
H.ctx.applyRemoteKeepalive({ ka_active: true, sync_interval_sec: 1.5 });
H.advance(1500);
check('D1 稼働中はチェーンが動いている', H.syncCalls.length === 1 && H.pendingCount() === 1,
  { calls: H.syncCalls.length, pending: H.pendingCount() });

H.ctx.applyRemoteKeepalive({ ka_active: false, sync_interval_sec: 0 });
check('D2 ka_active=false を受けた瞬間にチェーンが消える（即時停止）',
  H.pendingCount() === 0, { pending: H.pendingCount() });
check('D3 フェイルセーフ alarms も解除され長周期スリープへ戻る',
  !H.alarms['syncAlarm'], H.alarms);
const stoppedAt = H.syncCalls.length;
H.advance(60000);
H.ctx.maybeSync();   // 起床パルスが残っていた場合でも
check('D4 停止後は 60 秒経過してもハートビートを送らない（無駄な通信ゼロ）',
  H.syncCalls.length === stoppedAt, { before: stoppedAt, after: H.syncCalls.length });
check('D5 停止後にチェーンが再武装されない', H.pendingCount() === 0, H.pendingCount());

check('D6 非稼働の再確認（猶予）仕様は残っている（idleDrift 分岐が健在）',
  /idleDriftUntil && now < idleDriftUntil/.test(extract('maybeSync')));
check('D7 低速ポーリング（予約保持端末の 5 分起床）も健在',
  /scheduleInterestActive\(\)/.test(extract('maybeSync')) &&
  /SLOW_POLL_MS/.test(extract('maybeSync')));

// 稼働 → 停止 → 再稼働 で復帰できる
H.ctx.applyRemoteKeepalive({ ka_active: true, sync_interval_sec: 1.5 });
check('D8 再稼働でチェーンが張り直される', H.pendingCount() === 1 && H.pendingDelays()[0] === 1500,
  H.pendingDelays());
H.advance(1500);
check('D9 再稼働後も 1.5 秒で送信される', H.syncCalls.length === stoppedAt + 1,
  H.syncCalls.length);

// ============================================================================
// 6. 実装の構造（独立ループを作っていない・単一チェーンである）
// ============================================================================
console.log('\n===== E. 構造（既存構造の精密化・単一チェーン） =====');

const fnChain = extract('scheduleFastChain');
const fnClear = extract('clearFastChain');
check('E1 setTimeout チェーンは 1 か所だけ（独立ループを増やしていない）',
  (bgSrc.match(/fastChainTimer = setTimeout\(/g) || []).length === 1);
check('E2 チェーンは自分自身を再予約する（1本の鎖）',
  /fastChainTimer = setTimeout\([\s\S]*?scheduleFastChain\(\);[\s\S]*?\n\}/.test(fnChain));
check('E3 再予約の前に必ず前のタイマーを破棄する（多重武装しない）',
  /^function scheduleFastChain\(\) \{\s*\n\s*clearFastChain\(\);/.test(fnChain));
check('E4 非稼働ならチェーンを張らない',
  /if \(!keepaliveActive\) return;/.test(fnChain));
check('E5 稼働が終わっていたらコールバック内で再武装しない',
  /if \(!keepaliveActive\) return; \/\/ 稼働が終わっていたら再武装しない/.test(fnChain));
check('E6 clearFastChain は clearTimeout してから null に戻す',
  /clearTimeout\(fastChainTimer\)/.test(fnClear) && /fastChainTimer = null;/.test(fnClear));
check('E7 ensureSyncLoop は alarms(30秒) とチェーンの両方を用意する',
  /periodInMinutes: 0\.5/.test(extract('ensureSyncLoop')) &&
  /scheduleFastChain\(\)/.test(extract('ensureSyncLoop')));
check('E8 stopSyncLoop は alarms とチェーンの両方を止める',
  /alarms\.clear\('syncAlarm'\)/.test(extract('stopSyncLoop')) &&
  /clearFastChain\(\)/.test(extract('stopSyncLoop')));
check('E9 maybeSync の入口で in-flight を弾く',
  /^  if \(syncInFlight\) return;/m.test(extract('maybeSync')));
check('E10 重複しきい値は sync_interval_sec × 0.8',
  /FAST_MIN_GAP_RATIO = 0\.8/.test(bgSrc) &&
  /fastInterval \* FAST_MIN_GAP_RATIO/.test(extract('maybeSync')));
check('E11 送信開始時刻を控えて重複判定に使う',
  /lastHeartbeatStartMs = lastHeartbeatSentMs;/.test(bgSrc) &&
  /lastHeartbeatStartMs/.test(extract('maybeSync')));
check('E12 稼働中はチェーン主軸の分岐が maybeSync にある（alarms 待ちに頼らない）',
  /if \(keepaliveActive\) \{[\s\S]{0,900}?syncWithGas\(\);\s*\n\s*return;/.test(extract('maybeSync')));
check('E13 SW 復帰時に稼働状態を storage から復元してチェーンを張り直す',
  /keepalive_interval_sec/.test(bgSrc) &&
  /if \(d && d\.keepalive_active\)[\s\S]{0,600}?ensureSyncLoop\(\)/.test(bgSrc));

// ============================================================================
// 7. content.js の起床パルス（稼働中のみ・周期追従・非稼働で停止）
// ============================================================================
console.log('\n===== F. content.js の起床パルス =====');

check('F1 固定 1500ms の setInterval を廃止した（周期追従へ）',
  !/setInterval\([\s\S]{0,200}?KEEPALIVE_PING/.test(contentSrc));
check('F2 稼働中のみ setTimeout チェーンでパルスを送る',
  /function schedulePing\(\)/.test(contentSrc) &&
  /if \(!kaActiveCache\) return;/.test(contentSrc));
check('F3 周期は keepalive_interval_sec に追従する',
  /keepalive_interval_sec/.test(contentSrc) && /kaIntervalMs/.test(contentSrc));
check('F4 稼働開始/停止・周期変更を storage.onChanged で即時反映する',
  /'keepalive_active' in changes/.test(contentSrc) &&
  /'keepalive_interval_sec' in changes/.test(contentSrc) &&
  /schedulePing\(\); \/\/ 稼働開始\/停止・周期変更へ即時追従/.test(contentSrc));
check('F5 非稼働ではパルスを送らない（SW を起こさない）',
  /if \(kaActiveCache\) \{[\s\S]{0,200}?KEEPALIVE_PING/.test(contentSrc));
check('F6 教員コンソール以外からの稼働通知は拒否したまま（なりすまし防止）',
  /isTeacherConsoleOrigin/.test(contentSrc) &&
  /script\\\.google\\\.com/.test(contentSrc));

// ============================================================================
// 8. 版数と固定仕様（v1.6.14 / default_popup なし / DEFAULT_GAS_URL ''）
// ============================================================================
console.log('\n===== G. 版数と固定仕様 =====');

check('G1 manifest.version は 1.6.14', manifest.version === '1.6.14', manifest.version);
check('G2 default_popup を設けていない（児童のアイコン操作は無反応）',
  !((manifest.action || {}).default_popup));
check('G3 DEFAULT_GAS_URL は空文字のまま',
  /const DEFAULT_GAS_URL = '';/.test(bgSrc));
check('G4 manifest_version は 3 のまま', manifest.manifest_version === 3);

// 出荷物（dist）が 1.6.14 であること
function zipManifest(file) {
  try {
    const out = execSync('unzip -p ' + JSON.stringify(path.join(ROOT, 'dist', file)) + ' manifest.json',
      { encoding: 'utf8' });
    return JSON.parse(out);
  } catch (e) { return null; }
}
const sm = zipManifest('store.zip');
const dm = zipManifest('direct.zip');
let xml = '';
try { xml = fs.readFileSync(path.join(ROOT, 'dist/update.xml'), 'utf8'); } catch (e) { xml = ''; }
check('G5 dist/store.zip の manifest.version は 1.6.14', !!sm && sm.version === '1.6.14',
  sm && sm.version);
check('G6 dist/store.zip に default_popup が無い',
  !!sm && !((sm.action || {}).default_popup));
check('G7 dist/direct.zip の manifest.version も 1.6.14', !!dm && dm.version === '1.6.14',
  dm && dm.version);
check('G8 dist/update.xml の version は 1.6.14', /version='1\.6\.14'/.test(xml));
check('G9 ストア版 background.js は extension/background.js と一致（旧版混入なし）',
  (function () {
    try {
      const out = execSync('unzip -p ' + JSON.stringify(path.join(ROOT, 'dist', 'store.zip')) +
        ' background.js', { encoding: 'utf8' });
      return out === bgSrc;
    } catch (e) { return false; }
  })());

// 固定仕様（GAS 側の不変条件も壊していない）
const gasSrc = fs.readFileSync(path.join(ROOT, 'gas/Code.gs'), 'utf8');
check('G10 ACTIVE_SYNC_INTERVAL_SEC = 1.5 を維持（GAS 側）',
  /^const ACTIVE_SYNC_INTERVAL_SEC = 1\.5;/m.test(gasSrc));
check('G11 14校（東粟倉小は廃校のため含めない）', !/東粟倉/.test(gasSrc));
check('G12 MONITOR_SETTINGS_V1 を維持', /MONITOR_SETTINGS_V1/.test(gasSrc));
check('G13 DIAG 計装を維持（[SHARD-DIAG] / [BULK-TRACE]）',
  /\[SHARD-DIAG\]/.test(gasSrc) && /\[BULK-TRACE\]/.test(gasSrc));
check('G14 拡張側の稼働中周期の既定は 1500ms（ACTIVE_SYNC_MS）',
  /const ACTIVE_SYNC_MS = 1500;/.test(bgSrc));
check('G15 IDLE_SYNC_MS は 0（非稼働時に速いポーリングをしない）',
  /const IDLE_SYNC_MS = 0;/.test(bgSrc));

console.log('\n===== 結果: PASS=' + pass + ' FAIL=' + fail + ' =====');
process.exit(fail ? 1 : 0);
