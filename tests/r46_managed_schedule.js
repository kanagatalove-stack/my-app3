// ============================================================================
// r46_managed_schedule.js — 管理コンソール配布（chrome.storage.managed）経由で
//                           「予約実行型」スケジュールが実際に反映されることの回帰
//
//   Request O の根本原因（2026-11-08 に公開されたストア版 v1.6.4 の ZIP が、
//   スケジュールエンジン実装より前のビルドのまま出荷されていた）を二度と
//   見逃さないため、「ソース」ではなく「出荷物そのもの」を検証する。
//
//     A. 出荷物   … dist/*.zip の中の background.js にエンジンが入っているか
//                    （手動導入=現行ソース=動く / ストア導入=旧ZIP=動かない の再発防止）
//     B. 配布経路 … schema.json / getManagedPolicy / initializeClient の児童ID決定
//                    ・学校名の表記ゆれ吸収 ・起動順序（managed→認証→予約復元）
//     C. 判定     … 開始=含む/終了=含まない・重複排除・締める方向のみ
//     D. アラーム … 境界1回＋1分ティック・解除・起動時復元・通信なし
//     E. 取り込み … ハートビート応答→時計補正→予約保存→合成（GAS 契約含む）
//     F. 不変条件 … version/permissions/default_popup/DEFAULT_GAS_URL/DIAG
// ============================================================================
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const bgSrc = fs.readFileSync(path.join(ROOT, 'extension/background.js'), 'utf8');
const gasSrc = fs.readFileSync(path.join(ROOT, 'gas/Code.gs'), 'utf8');
const manifestRaw = fs.readFileSync(path.join(ROOT, 'extension/manifest.json'), 'utf8');
const schemaRaw = fs.readFileSync(path.join(ROOT, 'extension/schema.json'), 'utf8');
const pkgSh = fs.readFileSync(path.join(ROOT, 'scripts/package_extension.sh'), 'utf8');

let pass = 0, fail = 0;
/** 出力に literal な "Error:" を残さない（run_all.sh の失敗判定に誤爆させない）。 */
function sanitize(v) {
  return String(v)
    .replace(/Error:/g, 'Error-')
    .replace(/\n/g, ' ');
}
function ok(n, c, e) {
  if (c) { pass++; console.log('PASS ' + n + (e !== undefined ? ' => ' + sanitize(e) : '')); }
  else { fail++; console.log('FAIL ' + n + (e !== undefined ? ' => ' + sanitize(e) : '')); }
}
const check = ok;

// ---------------------------------------------------------------- 抽出ヘルパ
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
function extractScalar(src, name) {
  const re = new RegExp('^const ' + name + ' = (.+?);', 'm');
  const m = src.match(re);
  if (!m) throw new Error('scalar not found: ' + name);
  return 'const ' + name + ' = ' + m[1] + ';';
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

const manifest = JSON.parse(manifestRaw);
const schema = JSON.parse(schemaRaw);

// ============================================================================
// A. 出荷物そのものの検証（Request O の再発防止の本丸）
//   ・dist/store.zip は Web Store / 管理コンソール強制インストールで実際に配られる。
//   ・ここにエンジンが無いと「予約時刻になっても制限されない」が再発する。
// ============================================================================
const ENGINE_FNS = [
  'isScheduleActiveAt',
  'computeEffectiveScheduleRestriction',
  'composeFilterRestriction',
  'buildScheduleList',
  'persistScheduleCache',
  'loadScheduleCache',
  'armScheduleAlarms',
  'restoreSchedulesOnBoot',
  'reevaluateSchedules',
  'applyScheduleFromHeartbeat'
];
const ENGINE_CONSTS = [
  'SCHEDULE_EDGE_ALARM', 'SCHEDULE_TICK_ALARM',
  'SCHEDULE_CACHE_KEY', 'SCHEDULE_OFFSET_SMOOTH'
];

const ZIP_TMP = path.join('/tmp', 'r46_zip');
function unzipTo(zipPath, tag) {
  const out = path.join(ZIP_TMP, tag);
  try {
    fs.rmSync(out, { recursive: true, force: true });
    fs.mkdirSync(out, { recursive: true });
    execSync('unzip -o -q ' + JSON.stringify(zipPath) + ' -d ' + JSON.stringify(out),
      { stdio: 'pipe' });
    return out;
  } catch (e) {
    return null;
  }
}
function readIf(p) { try { return fs.readFileSync(p, 'utf8'); } catch (e) { return null; } }

const distStore = path.join(ROOT, 'dist/store.zip');
const distExt = path.join(ROOT, 'dist/extension.zip');
const distDirect = path.join(ROOT, 'dist/direct.zip');
const distXml = path.join(ROOT, 'dist/update.xml');
const distPolicy = path.join(ROOT, 'dist/managed_policy.json');

(function sectionA() {
  console.log('--- A. 出荷物（dist ZIP）にスケジュールエンジンが入っているか ---');

  ok('A-1 dist/store.zip が存在する', fs.existsSync(distStore));
  ok('A-2 dist/extension.zip が存在する', fs.existsSync(distExt));
  ok('A-3 dist/direct.zip が存在する', fs.existsSync(distDirect));
  ok('A-4 dist/update.xml が存在する', fs.existsSync(distXml));
  ok('A-5 dist/managed_policy.json が存在する', fs.existsSync(distPolicy));

  const dStore = unzipTo(distStore, 'store');
  const dDirect = unzipTo(distDirect, 'direct');
  ok('A-6 store.zip を展開できた', !!dStore);
  ok('A-7 direct.zip を展開できた', !!dDirect);

  // store.zip と extension.zip は同一内容（後方互換のための複製）
  let same = false;
  try { same = Buffer.compare(fs.readFileSync(distStore), fs.readFileSync(distExt)) === 0; }
  catch (e) { same = false; }
  ok('A-8 store.zip と extension.zip は完全同一（後方互換の複製）', same);

  const storeBg = dStore ? readIf(path.join(dStore, 'background.js')) : null;
  const directBg = dDirect ? readIf(path.join(dDirect, 'background.js')) : null;
  ok('A-9 store.zip に background.js が入っている', !!storeBg);

  // ★本丸★: 出荷物の background.js にエンジン関数がすべて存在するか
  const missingStore = ENGINE_FNS.filter(function (n) {
    return !storeBg || !new RegExp('function ' + n + '\\s*\\(').test(storeBg);
  });
  ok('A-10 store.zip の background.js にエンジン関数10個が全て実在する',
    !!storeBg && missingStore.length === 0, missingStore);

  const missingConstStore = ENGINE_CONSTS.filter(function (n) {
    return !storeBg || storeBg.indexOf(n) < 0;
  });
  ok('A-11 store.zip の background.js にエンジン定数が全て実在する',
    !!storeBg && missingConstStore.length === 0, missingConstStore);

  // 「ソースと出荷物がズレていない」ことの直接証明（旧版ZIP混入の再発防止）
  ok('A-12 store.zip の background.js は extension/background.js と完全一致（旧版混入なし）',
    !!storeBg && storeBg === bgSrc);

  const hits = storeBg ? (storeBg.match(/schedule|alarm/gi) || []).length : 0;
  ok('A-13 store.zip のエンジン記述量が十分（schedule/alarm 出現 > 60）', hits > 60, hits);

  const missDirect = ENGINE_FNS.filter(function (n) {
    return !directBg || !new RegExp('function ' + n + '\\s*\\(').test(directBg);
  });
  ok('A-14 direct.zip にもエンジン関数10個が全て実在する',
    !!directBg && missDirect.length === 0, missDirect);

  // 版数（出荷物の manifest が 1.6.12 であること）
  const storeManifest = dStore ? readIf(path.join(dStore, 'manifest.json')) : null;
  let sm = null;
  try { sm = JSON.parse(storeManifest); } catch (e) { sm = null; }
  ok('A-15 store.zip の manifest.version は 1.6.12', !!sm && sm.version === '1.6.12',
    sm && sm.version);
  ok('A-16 store.zip の manifest に default_popup が無い',
    !!sm && !((sm.action || {}).default_popup));

  // 直接読み込み版は検証用（overrides が効いている）
  const directManifest = dDirect ? readIf(path.join(dDirect, 'manifest.json')) : null;
  let dm = null;
  try { dm = JSON.parse(directManifest); } catch (e) { dm = null; }
  ok('A-17 direct.zip は検証用ビルド（default_popup: popup.html）',
    !!dm && (dm.action || {}).default_popup === 'popup.html');
  ok('A-18 direct.zip の manifest.version も 1.6.12', !!dm && dm.version === '1.6.12',
    dm && dm.version);

  // update.xml の版数が manifest と一致（自動反映の確認）
  const xml = readIf(distXml) || '';
  ok('A-19 update.xml の version は 1.6.12', /version='1\.6\.12'/.test(xml));

  // 管理ポリシー配布 JSON（14校・廃校を含まない・student_id は ${USER_EMAIL}）
  let pol = null;
  try { pol = JSON.parse(fs.readFileSync(distPolicy, 'utf8')); } catch (e) { pol = null; }
  const schools = (pol && pol.gas_url_map && pol.gas_url_map.Value) || {};
  const schoolNames = Object.keys(schools);
  ok('A-20 managed_policy.json の gas_url_map は 14 校', schoolNames.length === 14,
    schoolNames.length);
  ok('A-21 managed_policy.json に廃校（東粟倉小学校）を含まない',
    schoolNames.indexOf('東粟倉小学校') < 0);
  const sidVal = String((pol && pol.student_id && pol.student_id.Value) || '');
  ok('A-22 managed_policy.json の student_id は ${USER_EMAIL} マクロ（未設定ビルドでは空）',
    !!pol && (sidVal === '${USER_EMAIL}' || sidVal === ''), sidVal);
  ok('A-23 managed_policy.json は school_name / student_id の両キーを持つ',
    !!pol && !!pol.school_name && !!pol.student_id);
})();

// ============================================================================
// B. 配布経路（chrome.storage.managed）
// ============================================================================
(function sectionB() {
  console.log('--- B. storage.managed 配布経路（schema / 児童ID / 学校名の正規化） ---');

  // --- schema.json ---
  const props = schema.properties || {};
  ok('B-1 schema.json は student_id を宣言する', !!props.student_id);
  ok('B-2 schema.json は gas_url を宣言する', !!props.gas_url);
  ok('B-3 schema.json は gas_url_map を宣言する', !!props.gas_url_map);
  ok('B-4 schema.json は school_name を宣言する', !!props.school_name);
  ok('B-5 schema.json の type は object', schema.type === 'object');
  ok('B-6 schema.json の gas_url_map は object 型',
    (props.gas_url_map || {}).type === 'object');

  // --- getManagedPolicy: lastError / 未対応環境で落ちない ---
  const getManagedSrc = extractFn(bgSrc, 'getManagedPolicy');
  ok('B-7 getManagedPolicy は chrome.runtime.lastError を握りつぶして {} を返す',
    /lastError/.test(getManagedSrc) && /\{\s*\}/.test(getManagedSrc));
  ok('B-8 getManagedPolicy は storage.managed 不在でも {} を返す',
    /if\s*\(\s*chrome\.storage\s*&&\s*chrome\.storage\.managed\s*\)/.test(getManagedSrc));

  // --- normalizeSchoolKey（表記ゆれ吸収）---
  const nkFn = extractFn(bgSrc, 'normalizeSchoolKey');
  const nkCtx = vm.createContext({});
  vm.runInContext(nkFn + '\nglobalThis.__NK = normalizeSchoolKey;', nkCtx);
  const NK = nkCtx.__NK;
  ok('B-9 normalizeSchoolKey は全角スペースを除去する', NK('北　小学校') === '北小学校',
    NK('北　小学校'));
  ok('B-10 normalizeSchoolKey は半角スペースを除去する', NK(' 北 小学校 ') === '北小学校',
    NK(' 北 小学校 '));
  ok('B-11 normalizeSchoolKey は「美作市立」接頭辞を除去する',
    NK('美作市立北小学校') === '北小学校', NK('美作市立北小学校'));
  ok('B-12 normalizeSchoolKey は全角数字を半角化する',
    NK('第一小学校') === NK('第一小学校') && NK('第１小学校') === '第1小学校',
    NK('第１小学校'));
  ok('B-13 normalizeSchoolKey は全角英字を半角大文字化する',
    NK('ＡＢＣ小') === 'ABC小', NK('ＡＢＣ小'));

  // --- initializeClient（managed → 認証 → 予約復元 の起動順序）---
  const initSrc = extractFn(bgSrc, 'initializeClient');
  ok('B-14 initializeClient は getManagedPolicy を先に読む',
    /const managed = await getManagedPolicy\(\)/.test(initSrc));
  ok('B-15 initializeClient は ${USER_EMAIL} リテラルを児童IDとして採用しない',
    /!==\s*'\$\{USER_EMAIL\}'/.test(initSrc));
  const iManagedSid = initSrc.indexOf('studentId = managed.student_id.trim()');
  const iGoogleSid = initSrc.indexOf('studentId = googleAccount');
  ok('B-16 initializeClient は managed の児童IDを google アカウントより優先する',
    iManagedSid >= 0 && iGoogleSid >= 0 && iManagedSid < iGoogleSid,
    { managed: iManagedSid, google: iGoogleSid });
  ok('B-17 initializeClient は起動時に restoreSchedulesOnBoot を呼ぶ（予約の復元）',
    /await restoreSchedulesOnBoot\(\)/.test(initSrc));
  ok('B-18 予約復元は同期(syncWithGas)の後に行われる（新予約を取り込んだ直後に張り直す）',
    initSrc.indexOf('await syncWithGas()') >= 0 &&
    initSrc.indexOf('await syncWithGas()') < initSrc.indexOf('await restoreSchedulesOnBoot()'));
  ok('B-19 initializeClient は managed の school_name を最優先で採用する',
    /managedSchool/.test(initSrc) && initSrc.indexOf('managed.school_name') >= 0);
  ok('B-20 initializeClient は managed の gas_url_map を保存値より優先する',
    /managed\.gas_url_map/.test(initSrc));

  // --- managed の動的更新（onChanged）で再初期化される ---
  ok('B-21 storage.onChanged は areaName === "managed" で initializeClient を呼ぶ',
    /areaName === 'managed'/.test(bgSrc) &&
    /areaName === 'managed'[\s\S]{0,400}initializeClient\(\)/.test(bgSrc));

  // --- 実挙動: initializeClient を VM で走らせて児童IDの決定を確かめる ---
  //   ここが「管理コンソール強制インストール端末」の児童ID確定経路そのもの。
  function runInit(managed, identityEmail, stored, opts) {
    opts = opts || {};
    const pieces = [
      extractScalar(bgSrc, 'DEFAULT_GAS_URL'),
      extractConst(bgSrc, 'DEFAULT_CONFIG'),
      'let hasSyncedOnce = false;',
      'var __SYNCED = 0; var __DIAG = []; var __RESTORED = 0;',
      'async function syncWithGas() { __SYNCED++; }',
      'async function recordSyncDiag(a, b, c) { __DIAG.push([a, b]); }',
      'async function restoreSchedulesOnBoot() { __RESTORED++; }',
      extractFn(bgSrc, 'getStudentIdentity'),
      extractFn(bgSrc, 'getManagedPolicy'),
      extractFn(bgSrc, 'normalizeSchoolKey'),
      extractFn(bgSrc, 'pickMeaningfulSchoolName'),
      extractFn(bgSrc, 'resolveGasUrl'),
      extractFn(bgSrc, 'initializeClient'),
      'globalThis.__R = { run: initializeClient, ' +
        'get STORE(){ return __STORE; }, get SYNCED(){ return __SYNCED; }, ' +
        'get RESTORED(){ return __RESTORED; } };'
    ];
    const sandbox = {
      console: { log() {}, warn() {}, error() {} },
      Date: Date, Math: Math, Object: Object, Array: Array, String: String,
      Number: Number, Boolean: Boolean, JSON: JSON, Promise: Promise, isFinite: isFinite,
      __STORE: Object.assign({}, stored || {})
    };
    sandbox.chrome = {
      runtime: { lastError: opts.lastError ? { message: 'managed unavailable' } : undefined },
      storage: {
        local: {
          async get() { return Object.assign({}, sandbox.__STORE); },
          async set(o) { Object.assign(sandbox.__STORE, o); }
        },
        managed: opts.noManaged ? undefined : {
          get(keys, cb) {
            if (opts.lastError) { cb(undefined); return; }
            cb(Object.assign({}, managed || {}));
          }
        }
      },
      identity: {
        getProfileUserInfo(o, cb) { cb({ email: identityEmail || '' }); }
      }
    };
    const ctx = vm.createContext(sandbox);
    vm.runInContext(pieces.join('\n\n'), ctx, { filename: 'r46_init_vm.js' });
    return ctx.__R;
  }

  // B-22: ${USER_EMAIL} マクロ → chrome.identity のメール（小文字化）へフォールバック
  let R = runInit({ student_id: '${USER_EMAIL}' }, 'Taro.Yamada@Mimasaka.Ed.Jp', {});
  return R.run().then(function () {
    ok('B-22 ${USER_EMAIL} のままなら chrome.identity のメール（小文字）を児童IDにする',
      R.STORE.student_id === 'taro.yamada@mimasaka.ed.jp', R.STORE.student_id);

    // B-23: 具体的な児童IDが配布されていれば、それをそのまま使う
    R = runInit({ student_id: 'mimasaka-000123' }, 'x@y.z', {});
    return R.run().then(function () {
      ok('B-23 具体的な児童IDが配布されていればそのまま採用',
        R.STORE.student_id === 'mimasaka-000123', R.STORE.student_id);

      // B-24: ポリシー無し・アカウント不明 → ランダム生成（送信が止まらない）
      R = runInit({}, '', {}, { noManaged: true });
      return R.run().then(function () {
        ok('B-24 ポリシーもアカウントも無い場合は student_ で始まるIDを生成',
          /^student_[a-z0-9]+$/.test(String(R.STORE.student_id)), R.STORE.student_id);

        // B-25: 学校名は managed が「未設定」より優先される
        R = runInit({ school_name: '北小学校' }, 'a@b.c', { school_name: '未設定' });
        return R.run().then(function () {
          ok('B-25 managed の school_name が保存値「未設定」に勝つ',
            R.STORE.school_name === '北小学校', R.STORE.school_name);

          // B-26: gas_url_map が storage に反映される（学校→GAS の振り分け）
          const map = { '北小学校': 'https://script.google.com/macros/s/AAA/exec' };
          R = runInit({ gas_url_map: map, school_name: '北小学校' }, 'a@b.c', {});
          return R.run().then(function () {
            ok('B-26 managed の gas_url_map が端末へ保存される',
              !!R.STORE.gas_url_map && !!R.STORE.gas_url_map['北小学校']);

            // B-27: 予約復元（restoreSchedulesOnBoot）が起動経路で必ず1回走る
            ok('B-27 managed 起動経路でも restoreSchedulesOnBoot が1回走る',
              R.RESTORED === 1, R.RESTORED);

            // B-28: GAS URL が解決できれば初回同期が走る
            ok('B-28 GAS URL が解決できれば初回同期が走る', R.SYNCED >= 1, R.SYNCED);

            // B-29: managed が読めない（lastError）でも落ちない。
            //   アカウントも取れない端末では保存済みIDへフォールバックする。
            R = runInit({}, '', { student_id: 'stored-1' }, { lastError: true });
            return R.run().then(function () {
              ok('B-29 managed 読取失敗(lastError)でも落ちずに保存IDを維持',
                R.STORE.student_id === 'stored-1', R.STORE.student_id);
              return runRest();
            });
          });
        });
      });
    });
  }).catch(function (e) {
    ok('B-30 initializeClient の VM 実行が例外なく完了する', false, e && e.message);
    return runRest();
  });
})();

// ============================================================================
// C〜F は A/B の Promise 完了後に順に実行する（D/E は async なので直列に繋ぐ）
// ============================================================================
function runRest() {
  try { sectionC(); } catch (e) { ok('C-0 判定エンジンの検証が例外なく完了する', false, e && e.message); }
  return Promise.resolve()
    .then(function () { try { return sectionD(); } catch (e) { ok('D-0 アラーム検証が例外なく完了する', false, e && e.message); } })
    .then(function () { try { return sectionE(); } catch (e) { ok('E-0 取り込み検証が例外なく完了する', false, e && e.message); } })
    .then(function () {
      try { sectionF(); } catch (e) { ok('F-0 不変条件の検証が例外なく完了する', false, e && e.message); }
      finish();
    });
}

function buildEngine() {
  const FNS = [
    'updateClockOffset', 'correctedNowMs', 'isScheduleActiveAt',
    'buildScheduleList', 'normalizeHostList', 'composeFilterRestriction',
    'computeEffectiveScheduleRestriction', 'composeEffectivePolicy',
    'persistScheduleCache', 'loadScheduleCache', 'loadBasePolicy',
    'armScheduleAlarms', 'restoreSchedulesOnBoot', 'reevaluateSchedules',
    'applyScheduleFromHeartbeat'
  ];
  const pieces = [
    extractScalar(bgSrc, 'SCHEDULE_OFFSET_SMOOTH'),
    extractScalar(bgSrc, 'SCHEDULE_OFFSET_MAX_ABS'),
    extractScalar(bgSrc, 'SCHEDULE_CACHE_KEY'),
    extractScalar(bgSrc, 'SCHEDULE_EDGE_ALARM'),
    extractScalar(bgSrc, 'SCHEDULE_TICK_ALARM'),
    'let clockOffsetMs = 0;',
    'let scheduleCache = null;',
    'let lastHeartbeatSentMs = 0;',
    'var __STORE = {};',
    'var __ALARMS_CREATED = []; var __ALARMS_CLEARED = [];',
    'var __NOTIFY = []; var __FILTER = []; var __LOCKCHK = 0; var __RELEASE = 0;',
    'function notifyAllTabsLockState(v) { __NOTIFY.push(v); }',
    'function checkAllTabsFiltering(m, w, b) { __FILTER.push({ mode: m, white: w, black: b }); }',
    'function checkSpecialTabsForLock() { __LOCKCHK++; }',
    'function releaseLockedTabs() { __RELEASE++; }'
  ];
  FNS.forEach(function (n) { pieces.push(extractFn(bgSrc, n)); });
  pieces.push('globalThis.__T = { ' + FNS.join(', ') + ' };');

  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    Date: Date, Math: Math, Object: Object, Array: Array, String: String,
    Number: Number, Boolean: Boolean, JSON: JSON, isFinite: isFinite
  };
  sandbox.chrome = {
    storage: {
      local: {
        async get(keys) {
          if (keys === null || keys === undefined) return Object.assign({}, sandbox.__STORE);
          if (Array.isArray(keys)) {
            const o = {}; keys.forEach(function (k) { if (k in sandbox.__STORE) o[k] = sandbox.__STORE[k]; });
            return o;
          }
          const o = {}; if (keys in sandbox.__STORE) o[keys] = sandbox.__STORE[keys]; return o;
        },
        async set(obj) { Object.assign(sandbox.__STORE, obj); }
      }
    },
    alarms: {
      async create(name, info) { sandbox.__ALARMS_CREATED.push({ name: name, info: info }); },
      async clear(name) { sandbox.__ALARMS_CLEARED.push(name); return true; }
    }
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(pieces.join('\n\n'), ctx, { filename: 'r46_engine_vm.js' });
  return { ctx: ctx, T: ctx.__T, SB: sandbox };
}
const ENG = buildEngine();
const T = ENG.T, SB = ENG.SB;

function resetEng() {
  vm.runInContext('clockOffsetMs = 0; scheduleCache = null; lastHeartbeatSentMs = 0;' +
    ' __ALARMS_CREATED = []; __ALARMS_CLEARED = []; __NOTIFY = []; __FILTER = [];' +
    ' __LOCKCHK = 0; __RELEASE = 0;', ENG.ctx);
  Object.keys(SB.__STORE).forEach(function (k) { delete SB.__STORE[k]; });
}

// ---------------------------------------------------------------- C. 判定
function sectionC() {
  console.log('--- C. 判定エンジン（開始=含む / 終了=含まない / 締める方向のみ） ---');
  resetEng();

  const T0 = 1700000000000;
  const s1 = { id: 's1', type: 'screen_lock', start_ms: T0, end_ms: T0 + 3600000 };

  ok('C-1 開始時刻ちょうどは有効（開始=含む）', T.isScheduleActiveAt(s1, T0) === true);
  ok('C-2 終了時刻ちょうどは無効（終了=含まない）',
    T.isScheduleActiveAt(s1, T0 + 3600000) === false);
  ok('C-3 開始1ms前は無効', T.isScheduleActiveAt(s1, T0 - 1) === false);
  ok('C-4 期間中は有効', T.isScheduleActiveAt(s1, T0 + 1800000) === true);
  ok('C-5 start_ms 欠落は無効',
    T.isScheduleActiveAt({ id: 'x', end_ms: T0 + 1 }, T0) === false);
  ok('C-6 end_ms 欠落は無効',
    T.isScheduleActiveAt({ id: 'x', start_ms: T0 }, T0) === false);
  ok('C-7 null は無効', T.isScheduleActiveAt(null, T0) === false);

  const list = T.buildScheduleList({
    active: [{ id: 'a' }, { id: 'b' }],
    upcoming: [{ id: 'b' }, { id: 'c' }]
  });
  ok('C-8 buildScheduleList は active+upcoming を1本化する', list.length === 3,
    list.map(function (x) { return x.id; }));
  ok('C-9 buildScheduleList は重複IDを排除する（b は1回）',
    list.filter(function (x) { return x.id === 'b'; }).length === 1);
  ok('C-10 buildScheduleList は id 無し要素を捨てる',
    T.buildScheduleList({ active: [{}, { id: 'z' }] }).length === 1);

  const hosts = T.normalizeHostList([' YouTube.com ', 'youtube.com', '', null, 'A.B']);
  ok('C-11 normalizeHostList は小文字化・空白除去・重複排除する',
    JSON.stringify(hosts) === JSON.stringify(['youtube.com', 'a.b']), hosts);

  // screen_lock が効く
  const eff1 = T.computeEffectiveScheduleRestriction(
    { active: [s1], upcoming: [], overridden_ids: [] }, T0 + 1000);
  ok('C-12 期間内なら screen_lock が立つ', eff1.screen_lock === true);
  ok('C-13 期間内なら active_ids に s1 が入る',
    eff1.active_ids.indexOf('s1') >= 0, eff1.active_ids);
  const eff2 = T.computeEffectiveScheduleRestriction(
    { active: [s1], upcoming: [], overridden_ids: [] }, T0 + 3600000);
  ok('C-14 期間外なら screen_lock は立たない', eff2.screen_lock === false);

  // overridden_ids（今回だけ解除）
  const eff3 = T.computeEffectiveScheduleRestriction(
    { active: [s1], upcoming: [], overridden_ids: ['s1'] }, T0 + 1000);
  ok('C-15 overridden_ids に入っていれば解除される', eff3.screen_lock === false);
  ok('C-16 overridden_ids の解除時は active_ids にも入らない',
    eff3.active_ids.length === 0, eff3.active_ids);

  // url_block（ブラックリスト）
  const s2 = {
    id: 's2', type: 'url_block', filter_mode: 'BLACKLIST',
    blacklist: ['youtube.com', 'tiktok.com'], start_ms: T0, end_ms: T0 + 3600000
  };
  const eff4 = T.computeEffectiveScheduleRestriction(
    { active: [s2], upcoming: [], overridden_ids: [] }, T0 + 1000);
  ok('C-17 url_block は filter_mode=BLACKLIST になる', eff4.filter_mode === 'BLACKLIST',
    eff4.filter_mode);
  ok('C-18 url_block のブラックリストが反映される',
    eff4.blacklist_urls.indexOf('youtube.com') >= 0, eff4.blacklist_urls);

  // 締める方向のみ: WHITELIST ∩ WHITELIST = 積集合
  const m1 = T.composeFilterRestriction(
    { filter_mode: 'WHITELIST', whitelist_urls: ['a.com', 'b.com'] },
    { type: 'url_block', filter_mode: 'WHITELIST', whitelist: ['b.com', 'c.com'] });
  ok('C-19 WHITELIST × WHITELIST は積集合（緩めない）',
    JSON.stringify(m1.whitelist_urls) === JSON.stringify(['b.com']), m1.whitelist_urls);

  // WHITELIST × BLACKLIST → 許可から規制分を差し引く
  const m2 = T.composeFilterRestriction(
    { filter_mode: 'WHITELIST', whitelist_urls: ['a.com', 'b.com'] },
    { type: 'url_block', filter_mode: 'BLACKLIST', blacklist: ['b.com'] });
  ok('C-20 WHITELIST × BLACKLIST は許可から規制分を差し引く',
    m2.filter_mode === 'WHITELIST' && JSON.stringify(m2.whitelist_urls) === JSON.stringify(['a.com']),
    m2);

  // BLACKLIST × BLACKLIST → 和集合
  const m3 = T.composeFilterRestriction(
    { filter_mode: 'BLACKLIST', blacklist_urls: ['a.com'] },
    { type: 'url_block', filter_mode: 'BLACKLIST', blacklist: ['b.com'] });
  ok('C-21 BLACKLIST × BLACKLIST は和集合（規制が増える）',
    m3.blacklist_urls.length === 2 &&
    m3.blacklist_urls.indexOf('a.com') >= 0 && m3.blacklist_urls.indexOf('b.com') >= 0,
    m3.blacklist_urls);

  // ベースOFF + スケジュール BLACKLIST → BLACKLIST に引き上げ
  const m4 = T.composeFilterRestriction(
    { filter_mode: 'OFF' },
    { type: 'url_block', filter_mode: 'BLACKLIST', blacklist: ['x.com'] });
  ok('C-22 ベースOFFでもスケジュールBLACKLISTで締める', m4.filter_mode === 'BLACKLIST',
    m4.filter_mode);

  // 合成後のポリシー: ベースの常時ロックは維持される
  const ce = T.composeEffectivePolicy(
    { screen_lock: true, filter_mode: 'OFF' },
    { active: [], upcoming: [], overridden_ids: [] }, T0);
  ok('C-23 予約が無くてもベースの常時 screen_lock は維持される', ce.screen_lock === true);

  // 予約が時間外ならベースは緩まない／締まらない
  const ce2 = T.composeEffectivePolicy(
    { screen_lock: false, filter_mode: 'BLACKLIST', blacklist_urls: ['seed.com'] },
    { active: [s1], upcoming: [], overridden_ids: [] }, T0 + 3600000);
  ok('C-24 予約時間外ならベースのポリシーがそのまま残る',
    ce2.screen_lock === false && ce2.filter_mode === 'BLACKLIST', ce2);
}

// ---------------------------------------------------------------- D. アラーム
function sectionD() {
  console.log('--- D. アラーム（境界1回＋1分ティック／解除／起動時復元／通信なし） ---');
  resetEng();

  const armSrc = extractFn(bgSrc, 'armScheduleAlarms');
  ok('D-1 armScheduleAlarms は通信しない', !/fetch\s*\(/.test(armSrc));
  ok('D-2 armScheduleAlarms は境界アラームを毎回 clear してから張る',
    armSrc.indexOf('clear(SCHEDULE_EDGE_ALARM)') >= 0 &&
    armSrc.indexOf('clear(SCHEDULE_EDGE_ALARM)') < armSrc.indexOf('create(SCHEDULE_EDGE_ALARM'));
  ok('D-3 境界アラームは when 指定（遅延ではなく絶対時刻）',
    /create\(SCHEDULE_EDGE_ALARM,\s*\{\s*when:/.test(armSrc));
  ok('D-4 時計誤差の吸収に +1000ms の余裕がある', /\+\s*1000/.test(armSrc));
  ok('D-5 1分ティックは periodInMinutes: 1', /periodInMinutes:\s*1\b/.test(armSrc));
  ok('D-6 予約ゼロならティックを解除する',
    armSrc.indexOf('clear(SCHEDULE_TICK_ALARM)') >= 0);
  ok('D-7 解除済み(overridden_ids)の境界は張らない',
    /overridden\.indexOf\(s\.id\)\s*>=\s*0/.test(armSrc));

  // 実挙動: 60秒後に開始する予約 → 境界は約 61 秒後に張られ、ティックは 1 分
  return Promise.resolve(T.armScheduleAlarms(
    { active: [], upcoming: [{ id: 'u1', start_ms: Date.now() + 60000, end_ms: Date.now() + 3660000 }], overridden_ids: [] },
    0
  )).then(function () {
    const edge = SB.__ALARMS_CREATED.filter(function (a) { return a.name === 'scheduleEdge'; });
    const tick = SB.__ALARMS_CREATED.filter(function (a) { return a.name === 'scheduleTick'; });
    ok('D-8 境界アラームが1本張られる', edge.length === 1, edge.length);
    const delta = edge.length ? (edge[0].info.when - Date.now()) : -1;
    ok('D-9 境界アラームは開始時刻+1秒後に張られる（約61000ms）',
      delta > 59000 && delta < 63000, delta);
    ok('D-10 取りこぼし保険の1分ティックも張られる',
      tick.length === 1 && tick[0].info.periodInMinutes === 1, tick);
    ok('D-11 張り直しの前に必ず clear している',
      SB.__ALARMS_CLEARED.indexOf('scheduleEdge') >= 0, SB.__ALARMS_CLEARED);

    resetEng();
    return T.armScheduleAlarms({ active: [], upcoming: [], overridden_ids: [] }, 0);
  }).then(function () {
    const tick2 = SB.__ALARMS_CREATED.filter(function (a) { return a.name === 'scheduleTick'; });
    ok('D-12 予約ゼロならティックを張らずに解除する',
      tick2.length === 0 && SB.__ALARMS_CLEARED.indexOf('scheduleTick') >= 0,
      { created: tick2.length, cleared: SB.__ALARMS_CLEARED });

    // 起動時復元: 予約ゼロなら何もしない（無駄なタブ走査をしない）
    resetEng();
    return T.restoreSchedulesOnBoot();
  }).then(function () {
    ok('D-13 予約ゼロの起動時復元は通知もアラームもしない',
      SB.__NOTIFY.length === 0 && SB.__ALARMS_CREATED.length === 0,
      { notify: SB.__NOTIFY.length, alarms: SB.__ALARMS_CREATED.length });

    // 起動時復元: 予約ありなら再評価され、アラームが張り直される
    resetEng();
    const now = Date.now();
    SB.__STORE.schedule_cache = {
      schedules: { active: [], upcoming: [{ id: 'b1', start_ms: now + 120000, end_ms: now + 3700000 }], overridden_ids: [] },
      saved_at: now
    };
    return T.restoreSchedulesOnBoot().then(function () {
      const edge = SB.__ALARMS_CREATED.filter(function (a) { return a.name === 'scheduleEdge'; });
      ok('D-14 予約ありの起動時復元は境界アラームを張り直す（早朝の取りこぼし防止）',
        edge.length === 1, edge.length);
      ok('D-15 再評価は通知を出す', SB.__NOTIFY.length >= 1, SB.__NOTIFY.length);
    });
  }).then(function () {
    // reevaluateSchedules: 通信しない・合成結果で storage を更新・アラーム再設定
    const reSrc = extractFn(bgSrc, 'reevaluateSchedules');
    ok('D-16 reevaluateSchedules は通信しない（オフラインでも判定できる）',
      !/fetch\s*\(/.test(reSrc));
    ok('D-17 reevaluateSchedules は合成結果を storage へ書く',
      /schedule_active_ids:\s*eff\.schedule_active_ids/.test(reSrc));
    ok('D-18 reevaluateSchedules はアラームを張り直す',
      /await armScheduleAlarms\(/.test(reSrc));

    resetEng();
    const n2 = Date.now();
    SB.__STORE.schedule_cache = {
      schedules: { active: [{ id: 'l1', type: 'screen_lock', start_ms: n2 - 1000, end_ms: n2 + 3600000 }], upcoming: [], overridden_ids: [] },
      saved_at: n2
    };
    SB.__STORE.base_filter_mode = 'OFF';
    return T.reevaluateSchedules().then(function (eff) {
      ok('D-19 期間中の予約は再評価で screen_lock=true になる', eff.screen_lock === true, eff);
      ok('D-20 画面ロックの通知がタブへ送られる', SB.__NOTIFY.indexOf(true) >= 0, SB.__NOTIFY);
      ok('D-21 storage に schedule_active_ids が保存される',
        Array.isArray(SB.__STORE.schedule_active_ids) &&
        SB.__STORE.schedule_active_ids.indexOf('l1') >= 0, SB.__STORE.schedule_active_ids);

      // 期間外なら解除される
      //   ※ 直前の再評価が storage.screen_lock=true を書いている。loadBasePolicy は
      //     base_screen_lock が無いとき screen_lock を「ベースの常時設定」として
      //     拾うため、そのままだと解除を検証できない。ベースを明示的に false に戻す。
      SB.__STORE.base_screen_lock = false;
      delete SB.__STORE.screen_lock;
      SB.__STORE.base_filter_mode = 'OFF';
      SB.__STORE.schedule_cache = {
        schedules: { active: [{ id: 'l1', type: 'screen_lock', start_ms: n2 - 7200000, end_ms: n2 - 3600000 }], upcoming: [], overridden_ids: [] },
        saved_at: n2
      };
      vm.runInContext('scheduleCache = null;', ENG.ctx);
      return T.reevaluateSchedules().then(function (eff2) {
        ok('D-22 期間を過ぎた予約は解除される（終了時刻でロックが解ける）',
          eff2.screen_lock === false, eff2);
        ok('D-23 解除時はロック中タブが解放される', SB.__RELEASE >= 1, SB.__RELEASE);
      });
    });
  });
}

// ---------------------------------------------------------------- E. 取り込み
function sectionE() {
  console.log('--- E. ハートビート取り込み（時計補正→予約保存→合成）と GAS 契約 ---');
  resetEng();

  const applySrc = extractFn(bgSrc, 'applyScheduleFromHeartbeat');
  ok('E-1 applyScheduleFromHeartbeat は server_time_ms で時計を補正する',
    /server_time_ms/.test(applySrc) && /updateClockOffset/.test(applySrc));
  ok('E-2 応答に予約が無いときはキャッシュで補う（オフライン保護）',
    /loadScheduleCache\(\)/.test(applySrc) && /persistScheduleCache\(/.test(applySrc));
  ok('E-3 ベース値を base_* に退避してから合成する',
    /updates\.base_screen_lock/.test(applySrc) && /updates\.base_filter_mode/.test(applySrc));
  ok('E-4 合成後に境界アラームを張り直す', /await armScheduleAlarms\(schedules/.test(applySrc));

  const now = Date.now();
  const updates = { whitelist_urls: [], blacklist_urls: [] };
  const policy = {
    server_time_ms: now,
    screen_lock: false,
    filter_mode: 'OFF',
    schedules: {
      active: [{ id: 'h1', type: 'screen_lock', start_ms: now - 1000, end_ms: now + 3600000 }],
      upcoming: [], overridden_ids: []
    }
  };
  return Promise.resolve(T.applyScheduleFromHeartbeat(policy, updates)).then(function (eff) {
    ok('E-5 ハートビート応答の予約が即座に合成される（screen_lock=true）',
      eff.screen_lock === true, eff);
    ok('E-6 updates.screen_lock が合成後の値に差し替わる', updates.screen_lock === true);
    ok('E-7 予約キャッシュが storage に保存される（再起動しても効く）',
      !!(SB.__STORE.schedule_cache && SB.__STORE.schedule_cache.schedules),
      !!SB.__STORE.schedule_cache);
    ok('E-8 保存されたキャッシュに予約1件が入っている',
      (SB.__STORE.schedule_cache.schedules.active || []).length === 1,
      (SB.__STORE.schedule_cache.schedules.active || []).length);
    ok('E-9 ベース値が base_* に保存される（次回の再評価で使う）',
      SB.__STORE.base_filter_mode === 'OFF' || updates.base_filter_mode === 'OFF');

    // 応答に予約が無い場合: 既存キャッシュを使う
    resetEng();
    const n2 = Date.now();
    SB.__STORE.schedule_cache = {
      schedules: { active: [{ id: 'c1', type: 'screen_lock', start_ms: n2 - 1000, end_ms: n2 + 3600000 }], upcoming: [], overridden_ids: [] },
      saved_at: n2
    };
    const u2 = { whitelist_urls: [], blacklist_urls: [] };
    return T.applyScheduleFromHeartbeat({ screen_lock: false, filter_mode: 'OFF' }, u2)
      .then(function (eff2) {
        ok('E-10 応答に予約が無くてもキャッシュから制限が復元される',
          eff2.screen_lock === true, eff2);
        return T.persistScheduleCache(null);
      });
  }).then(function (c) {
    ok('E-11 persistScheduleCache(null) は空の正しい形で保存する（壊れない）',
      c && Array.isArray(c.schedules.active) && Array.isArray(c.schedules.upcoming) &&
      Array.isArray(c.schedules.overridden_ids), c && c.schedules);
    return T.loadScheduleCache();
  }).then(function (c2) {
    ok('E-12 loadScheduleCache は形の揃ったキャッシュを返す',
      !!c2 && !!c2.schedules && Array.isArray(c2.schedules.active));

    // --- GAS 契約 ---
    ok('E-13 GAS は server_time_ms を応答に含める（端末の時計補正の起点）',
      /server_time_ms:\s*serverTimeMs/.test(gasSrc));
    ok('E-14 GAS は schedules を応答に含める',
      /schedules:\s*schedulesPayload/.test(gasSrc));
    ok('E-15 GAS の予約窓は start_ms / end_ms で確定して配られる',
      /out\.push\(\{\s*start_ms:\s*start,\s*end_ms:\s*end\s*\}\)/.test(gasSrc));
    ok('E-16 GAS 側にも「開始=含む/終了=含まない」の判定がある',
      /start_ms\s*<=\s*now\s*&&\s*now\s*<\s*\w+\.end_ms/.test(gasSrc));
  });
}

// ---------------------------------------------------------------- F. 不変条件
function sectionF() {
  console.log('--- F. 不変条件（版数・権限・配布物の作られ方） ---');
  ok('F-1 manifest.version は 1.6.12（ストア再提出用の版上げ）',
    manifest.version === '1.6.12', manifest.version);
  ok('F-2 default_popup を持たない（児童がアイコンを押しても無反応）',
    !manifest.action || !manifest.action.default_popup);
  ok('F-3 permissions は storage/alarms/idle/tabs/identity/identity.email の6つ',
    JSON.stringify(manifest.permissions) ===
    JSON.stringify(['storage', 'alarms', 'idle', 'tabs', 'identity', 'identity.email']),
    manifest.permissions);
  ok('F-4 alarms 権限がある（予約実行に必須・追加不要）',
    manifest.permissions.indexOf('alarms') >= 0);
  ok('F-5 DEFAULT_GAS_URL は空のまま（管理ポリシーで配る）',
    /^const DEFAULT_GAS_URL = '';$/m.test(bgSrc));
  ok('F-6 拡張のソースにエンジン関数10個が全て存在する',
    ENGINE_FNS.every(function (n) { return new RegExp('function ' + n + '\\s*\\(').test(bgSrc); }));
  ok('F-7 版数は manifest.json を唯一の正とする（package_extension.sh）',
    /VERSION="\$\(python3 -c .*manifest\.json/.test(pkgSh));
  ok('F-8 store.zip は extension/ をそのまま固める（正本）',
    /STORE_DIR="\$BUILD_DIR\/store"/.test(pkgSh) && /cp -a "\$EXT_DIR" "\$STORE_DIR"/.test(pkgSh));
  ok('F-9 store.zip は default_popup 無しを検証してから固める',
    /default_popup/.test(pkgSh));
  ok('F-10 extension.zip は store.zip の複製（後方互換）',
    /cp -f "\$DIST_DIR\/store\.zip" "\$DIST_DIR\/extension\.zip"/.test(pkgSh));
  ok('F-11 direct.zip は extension/ + overrides（検証用）',
    /cp -a "\$OVERRIDE_DIR\/\." "\$DIRECT_DIR\/"/.test(pkgSh));
  ok('F-12 update.xml の版数は manifest から自動反映',
    /version='\$VERSION'/.test(pkgSh));
  ok('F-13 配布ポリシーは14校のみ（東粟倉小学校=廃校は含めない）',
    pkgSh.indexOf('東粟倉小学校') >= 0 &&
    /assert '東粟倉小学校' not in/.test(pkgSh) || pkgSh.indexOf('東粟倉小学校') < 0,
    'school list guard');
  ok('F-14 データ伝播は PropertiesService のみ（MONITOR_SETTINGS_V1 を維持）',
    gasSrc.indexOf('MONITOR_SETTINGS_V1') >= 0);
  ok('F-15 子GAS認証は shard_secret（Access Rules ではない）',
    /SHARD_SECRET/.test(gasSrc) && /shard_secret/.test(gasSrc));
  ok('F-16 DIAG 計測は残っている（SHARD_DIAG_MODE / [SHARD-DIAG] / bulkTrace）',
    /SHARD_DIAG_MODE/.test(gasSrc) && /\[SHARD-DIAG\]/.test(gasSrc) &&
    /bulkTrace/.test(gasSrc));
  ok('F-17 通信経路は google.script.run のまま（教員コンソール）',
    fs.readFileSync(path.join(ROOT, 'gas/index.html'), 'utf8').indexOf('google.script.run') >= 0);
  ok('F-18 予約実行は通信なしで判定できる（オフラインでも時刻どおり発動）',
    !/fetch\s*\(/.test(extractFn(bgSrc, 'reevaluateSchedules')) &&
    !/fetch\s*\(/.test(extractFn(bgSrc, 'isScheduleActiveAt')));
}

function finish() {
  console.log('');
  console.log('===== 結果: PASS=' + pass + ' FAIL=' + fail + ' =====');
  process.exit(fail > 0 ? 1 : 0);
}
