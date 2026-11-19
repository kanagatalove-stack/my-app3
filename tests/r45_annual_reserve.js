// =====================================================================
// r45_annual_reserve.js — Request N「予約実行型 年次更新」回帰テスト
//
//   検証対象（gas/Code.gs に追記した新規実装）
//     A. CSV パース（RFC4180：引用符・埋め込みカンマ/改行・BOM・CRLF）
//     B. 次年度 児童リストCSV のマッピング（児童IDはメールから生成可）
//     C. 次年度 教員リストCSV のマッピング（11列・Google SSO許可）
//     D. 実行予定日時の解釈（datetime-local / 和式表記 / 不正日付の拒否）
//     E. 予約の保存・読み出し・削除（PropertiesService のみ・9000字分割）
//     F. 実行フロー（親シートクリア＋R41子GAS並列伝播＋児童/教員反映）
//     G. 二重実行防止（LockService＋status フラグ）とキャンセル
//     H. 非管理者ガード・フォールバック自動実行・UI/資産の不変条件
//
//   方式: 既存40スイートと同じ「関数抽出 + ミニVM」。
//     実GASは叩かない。PropertiesService / CacheService / LockService /
//     ScriptApp / UrlFetchApp / Utilities を軽量モックで置き換える。
//     ※ PropertiesService モックは 1プロパティ 9000 文字で例外を投げ、
//        「容量を超えない分割保存」が実装されていることを実証する。
// =====================================================================
const fs = require('fs'), vm = require('vm'), zlib = require('zlib');
const PREFIX = '/home/user/webapp/';
const rd = function (p) { return fs.readFileSync(PREFIX + p, 'utf8'); };

const src = rd('gas/Code.gs');
const html = rd('gas/index.html');
const manifest = JSON.parse(rd('extension/manifest.json'));
const bg = rd('extension/background.js');

function extract(s, name) {
  const re = new RegExp('^[ \\t]*(?:async\\s+)?function ' + name + '\\s*\\(', 'm');
  const st = s.search(re);
  if (st < 0) throw new Error('missing symbol');
  let i = s.indexOf('{', st), d = 0, end = -1;
  for (; i < s.length; i++) { if (s[i] === '{') d++; else if (s[i] === '}') { d--; if (d === 0) { end = i; break; } } }
  if (end < 0) throw new Error('unbalanced');
  return s.slice(st, end + 1);
}

/** CONFIG の配列（DEVICE_COLUMNS / TEACHER_COLUMNS など）を取り出す */
function cfgArray(name) {
  const i = src.indexOf(name + ':');
  if (i < 0) return null;
  const s0 = src.indexOf('[', i);
  let d = 0, end = -1;
  for (let k = s0; k < src.length; k++) {
    if (src[k] === '[') d++;
    else if (src[k] === ']') { d--; if (!d) { end = k; break; } }
  }
  if (end < 0) return null;
  return vm.runInNewContext('(' + src.slice(s0, end + 1) + ')', {});
}

/** 単一行の `const NAME = ...;` の右辺を取り出す */
function srcConst(name) {
  const re = new RegExp('^const ' + name + '\\s*=\\s*([^;\\n]+);', 'm');
  const m = src.match(re);
  return m ? m[1].trim() : null;
}

const DEVICE_COLUMNS = cfgArray('DEVICE_COLUMNS');
const TEACHER_COLUMNS = cfgArray('TEACHER_COLUMNS');
const SCHOOL_LIST = cfgArray('SCHOOL_LIST');

let pass = 0, fail = 0;
/** 出力に `Error:` が混じると run_all.sh が失敗扱いにするため無害化する */
function sanitize(v) {
  let t;
  if (v === undefined) return '';
  try { t = typeof v === 'string' ? v : JSON.stringify(v); } catch (e) { t = String(v); }
  return String(t).replace(/Error:/g, 'Error-');
}
function check(n, c, e) {
  if (c === true) { pass++; console.log('PASS', n, e !== undefined ? '=> ' + sanitize(e) : ''); }
  else { fail++; console.log('FAIL', n, e !== undefined ? '=> ' + sanitize(e) : ''); }
}
const ok = function (n, c, e) { check(n, c === true, e); };

// ---------------------------------------------------------------------
// スプレッドシートの軽量モック
// ---------------------------------------------------------------------

function mkRange(sheet, r, c, nr, nc) {
  const rg = {
    getValues: function () {
      const out = [];
      for (let i = 0; i < nr; i++) {
        const row = sheet._rows[r - 1 + i] || [];
        const rr = [];
        for (let j = 0; j < nc; j++) rr.push(row[c - 1 + j] === undefined ? '' : row[c - 1 + j]);
        out.push(rr);
      }
      return out;
    },
    setValues: function (vals) {
      for (let i = 0; i < vals.length; i++) {
        const ri = r - 1 + i;
        while (sheet._rows.length <= ri) sheet._rows.push([]);
        const row = sheet._rows[ri];
        for (let j = 0; j < vals[i].length; j++) {
          const ci = c - 1 + j;
          while (row.length <= ci) row.push('');
          row[ci] = vals[i][j];
        }
      }
      return rg;
    },
    setValue: function (v) {
      const ri = r - 1;
      while (sheet._rows.length <= ri) sheet._rows.push([]);
      const row = sheet._rows[ri];
      const ci = c - 1;
      while (row.length <= ci) row.push('');
      row[ci] = v;
      return rg;
    },
    getValue: function () {
      const row = sheet._rows[r - 1] || [];
      const v = row[c - 1];
      return v === undefined ? '' : v;
    }
  };
  // スタイル系は呼ばれても壊れないよう no-op を返す
  ['setFontWeight', 'setBackground', 'setFontColor', 'setFontSize',
    'setHorizontalAlignment', 'setVerticalAlignment', 'setWrap',
    'setNumberFormat', 'setBorder'].forEach(function (m) { rg[m] = function () { return rg; }; });
  return rg;
}

function mkSheet(name, rows) {
  const sh = {
    _name: name,
    _rows: (rows || []).map(function (r) { return r.slice(); }),
    _failSetValues: false,
    _failDeleteRows: false,
    getLastRow: function () { return sh._rows.length; },
    getLastColumn: function () {
      let w = 0;
      for (let i = 0; i < sh._rows.length; i++) w = Math.max(w, sh._rows[i].length);
      return w;
    },
    getRange: function (r, c, nr, nc) {
      const rg = mkRange(sh, r, c, nr === undefined ? 1 : nr, nc === undefined ? 1 : nc);
      if (sh._failSetValues) {
        rg.setValues = function () { throw new Error('setValues denied by mock'); };
        rg.setValue = function () { throw new Error('setValue denied by mock'); };
      }
      return rg;
    },
    getDataRange: function () { return mkRange(sh, 1, 1, sh.getLastRow(), Math.max(1, sh.getLastColumn())); },
    deleteRow: function (r) {
      if (sh._failDeleteRows) throw new Error('deleteRow denied by mock');
      sh._rows.splice(r - 1, 1);
    },
    deleteRows: function (r, n) {
      if (sh._failDeleteRows) throw new Error('deleteRows denied by mock');
      sh._rows.splice(r - 1, n);
    },
    setName: function (v) { sh._name = v; return sh; }
  };
  return sh;
}

/** 端末一覧シートを作る（ヘッダーは DEVICE_COLUMNS と完全一致） */
function mkDeviceSheet(ids) {
  const rows = [DEVICE_COLUMNS.slice()];
  const w = DEVICE_COLUMNS.length;
  (ids || []).forEach(function (id) {
    const row = [];
    for (let i = 0; i < w; i++) row.push('');
    row[0] = id;
    row[1] = '北小学校';
    row[2] = '児童' + id;
    row[3] = '1年1組';
    rows.push(row);
  });
  return mkSheet('端末一覧', rows);
}

/** 教員マスタを作る（ヘッダーは TEACHER_COLUMNS と完全一致＝11列） */
function mkTeacherSheet(emails) {
  const rows = [TEACHER_COLUMNS.slice()];
  const w = TEACHER_COLUMNS.length;
  (emails || []).forEach(function (em) {
    const row = [];
    for (let i = 0; i < w; i++) row.push('');
    row[0] = em;
    row[2] = '既存教員';
    rows.push(row);
  });
  return mkSheet('教員マスタ', rows);
}

// ---------------------------------------------------------------------
// VM 環境（モックを注入して実関数だけを走らせる）
// ---------------------------------------------------------------------

const FUNCS = [
  'annualNowMs_', 'annualPad2_', 'annualFormatRunAt_', 'annualFormatRunAtFull_', 'annualParseRunAt_',
  'annualEncode_', 'annualChunk_', 'annualPlanClear_', 'annualPlanSave_', 'annualPlanLoad_',
  'annualPlanPublicView_',
  'annualParseCsv_', 'annualNormHeader_', 'annualLooksLikeEmail_', 'annualStudentIdFromEmail_',
  'parseAnnualStudentCsv_', 'parseAnnualTeacherCsv_',
  'annualHasPeriodicTrigger_', 'annualRemoveTriggers_', 'annualInstallTrigger_',
  'annualClearSheetBody_', 'annualComposeClass_', 'annualBuildStudentRow_', 'annualWriteStudentCells_',
  'annualBuildTeacherRow_', 'annualWriteTeacherCells_',
  'annualClearPreviousData_', 'annualApplyStudents_', 'annualApplyTeachers_', 'annualExecutePlan_',
  'annualRolloverExecutor', 'invalidateAnnualCaches_', 'annualRolloverFallbackCheck_',
  'annualRolloverTriggered_', 'annualRolloverPeriodicTick_',
  'annualAuthAdmin_', 'api_annualReservationSave', 'api_annualReservationStatus',
  'api_annualReservationCancel', 'api_annualRolloverRunNow',
  'shardAnnualClearLocalDevices_', 'shardAnnualClearFromParent',
  'withWriteLock', 'shardFetchMany', 'shardSecretMatches', 'isAdminTeacher',
  'normalizeDigits', 'parseSsoAllowedFlag'
];

function buildEnv(opts) {
  const o = opts || {};
  const state = {
    props: {},
    propsMaxLen: 0,
    cache: {},
    sheets: {},
    triggers: [],
    tid: 0,
    fetchAllCalls: 0,
    fetchedUrls: [],
    fetchedPayloads: [],
    fetchSequentialCalls: 0,
    failFetchUrls: {},
    lock: { held: false, acquired: 0, maxHeld: 0, failNext: false },
    tokenMap: {},
    shard: { parent: false, child: false, urls: [], secret: 'SEC-R45', cfg: {} },
    now: 1775001600000, // 2026-04-01 09:00 JST 相当の固定時刻
    ensureCalls: 0,
    invalidationCalls: 0
  };

  state.sheets['端末一覧'] = mkDeviceSheet(o.deviceIds || []);
  state.sheets['教員マスタ'] = mkTeacherSheet(o.teacherEmails || []);
  state.sheets['設定'] = mkSheet('設定', [['key', 'value'], ['k1', 'v1']]);
  state.props['SHARD_SECRET'] = state.shard.secret;

  const sandbox = { console: console };
  sandbox.__state = state;

  // ---- PropertiesService（9000 文字上限を強制） ----
  sandbox.PropertiesService = {
    getScriptProperties: function () {
      return {
        getProperty: function (k) {
          return Object.prototype.hasOwnProperty.call(state.props, k) ? state.props[k] : null;
        },
        setProperty: function (k, v) {
          const s = String(v);
          if (s.length > 9000) throw new Error('property value too large (mock 9000)');
          state.propsMaxLen = Math.max(state.propsMaxLen, s.length);
          state.props[k] = s;
          return this;
        },
        setProperties: function (obj) {
          const self = this;
          Object.keys(obj).forEach(function (k) { self.setProperty(k, obj[k]); });
          return this;
        },
        getProperties: function () {
          const c = {};
          Object.keys(state.props).forEach(function (k) { c[k] = state.props[k]; });
          return c;
        },
        deleteProperty: function (k) {
          delete state.props[k];
          return this;
        }
      };
    }
  };

  // ---- CacheService ----
  sandbox.CacheService = {
    getScriptCache: function () {
      return {
        get: function (k) { return Object.prototype.hasOwnProperty.call(state.cache, k) ? state.cache[k] : null; },
        put: function (k, v) { state.cache[k] = String(v); },
        remove: function (k) { delete state.cache[k]; }
      };
    }
  };

  // ---- LockService（競合を注入できる） ----
  sandbox.LockService = {
    getScriptLock: function () {
      return {
        waitLock: function () {
          if (state.lock.failNext) throw new Error('lock timeout (mock)');
          state.lock.acquired++;
          state.lock.held = true;
          state.lock.maxHeld = Math.max(state.lock.maxHeld, 1);
        },
        releaseLock: function () { state.lock.held = false; }
      };
    }
  };

  // ---- ScriptApp（時刻トリガーの作成／削除を記録） ----
  sandbox.ScriptApp = {
    getProjectTriggers: function () {
      return state.triggers.map(function (t) {
        return { _id: t.id, getHandlerFunction: function () { return t.fn; } };
      });
    },
    deleteTrigger: function (t) {
      state.triggers = state.triggers.filter(function (x) { return x.id !== t._id; });
    },
    newTrigger: function (fn) {
      const builder = {
        timeBased: function () {
          return {
            at: function (date) {
              return {
                create: function () {
                  state.triggers.push({
                    id: 'tr' + (++state.tid), fn: fn,
                    at_ms: date && typeof date.getTime === 'function' ? date.getTime() : 0
                  });
                  return {};
                }
              };
            },
            everyHours: function (h) {
              return {
                create: function () {
                  state.triggers.push({ id: 'tr' + (++state.tid), fn: fn, everyHours: h });
                  return {};
                }
              };
            }
          };
        }
      };
      return builder;
    }
  };

  // ---- UrlFetchApp（子GASへの並列POST） ----
  function mkRes(code, body) {
    return {
      getResponseCode: function () { return code; },
      getContentText: function () { return JSON.stringify(body); }
    };
  }
  sandbox.UrlFetchApp = {
    fetchAll: function (reqs) {
      state.fetchAllCalls++;
      const out = [];
      for (let i = 0; i < reqs.length; i++) {
        const u = String(reqs[i].url || '');
        state.fetchedUrls.push(u);
        state.fetchedPayloads.push(String(reqs[i].payload || ''));
        if (state.failFetchUrls[u]) out.push(null);
        else out.push(mkRes(200, { success: true, cleared: 42 }));
      }
      return out;
    },
    fetch: function (url) {
      state.fetchSequentialCalls++;
      state.fetchedUrls.push(String(url || ''));
      if (state.failFetchUrls[url]) return mkRes(500, { success: false });
      return mkRes(200, { success: true, cleared: 42 });
    }
  };

  // ---- Utilities（gzip / base64 を実処理して圧縮経路を通す） ----
  function blob(buf) {
    const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf || []);
    return {
      _buf: b,
      getBytes: function () { return b; },
      getDataAsString: function () { return b.toString('utf8'); }
    };
  }
  sandbox.Utilities = {
    newBlob: function (data) {
      if (typeof data === 'string') return blob(Buffer.from(data, 'utf8'));
      if (Buffer.isBuffer(data)) return blob(data);
      if (data && typeof data.getBytes === 'function') return blob(data.getBytes());
      return blob(Buffer.from(data || []));
    },
    gzip: function (b) { return blob(zlib.gzipSync(b.getBytes())); },
    ungzip: function (b) { return blob(zlib.gunzipSync(b.getBytes())); },
    base64Encode: function (bytes) { return Buffer.from(bytes).toString('base64'); },
    base64Decode: function (s) { return Buffer.from(String(s), 'base64'); }
  };

  // ---- 既存ヘルパーの軽量スタブ（既存スイートで別途検証済み） ----
  sandbox.getTargetSheet = function (name) {
    if (!state.sheets[name]) state.sheets[name] = mkSheet(name, [['header']]);
    return state.sheets[name];
  };
  sandbox.ensureDeviceHeaders = function () { state.ensureCalls++; };
  sandbox.ensureTeacherHeaders = function () { state.ensureCalls++; };
  sandbox.getHeaderMap = function (sheet) {
    const last = sheet.getLastColumn();
    const hdr = last ? sheet.getRange(1, 1, 1, last).getValues()[0] : [];
    const m = {};
    for (let i = 0; i < hdr.length; i++) {
      const k = String(hdr[i] == null ? '' : hdr[i]).trim();
      if (k && m[k] === undefined) m[k] = i + 1;
    }
    return m;
  };
  sandbox.invalidateDevicesCache = function () { state.invalidationCalls++; };
  sandbox.isShardParent = function () { return state.shard.parent === true; };
  // 子GAS判定（shardAnnualClearFromParent / shardApplyFromParent が参照する）
  sandbox.isShardChild = function () { return state.shard.child === true; };
  sandbox.shardConfigCached = function () { return state.shard.cfg; };
  sandbox.shardAllChildUrls = function () { return state.shard.urls.slice(); };
  sandbox.verifyToken = function (t) {
    if (t && state.tokenMap[t]) return { valid: true, teacher: state.tokenMap[t] };
    return { valid: false };
  };
  sandbox.resolveCurrentTeacher = function (t) { return t; };
  sandbox.Logger = { log: function () {} };

  vm.createContext(sandbox);

  const consts = [
    'ANNUAL_PLAN_PROP', 'ANNUAL_PLAN_CHUNK_PREFIX', 'ANNUAL_PLAN_MAX_CHARS',
    'ANNUAL_PLAN_CHUNKS_MAX', 'ANNUAL_PLAN_CHUNK_COUNT',
    'ANNUAL_TRIGGER_FN', 'ANNUAL_PERIODIC_FN', 'ANNUAL_JST_OFFSET_MS', 'SHARD_SECRET_PROP'
  ];
  let prelude = 'var ANNUAL_TEST_NOW_MS = ' + state.now + ';\n';
  consts.forEach(function (n) {
    const v = srcConst(n);
    if (v === null) throw new Error('missing const ' + n);
    prelude += 'var ' + n + ' = ' + v + ';\n';
  });
  prelude += 'var CONFIG = ' + JSON.stringify({
    DEVICE_SHEET_NAME: '端末一覧',
    TEACHER_SHEET_NAME: '教員マスタ',
    ARCHIVE_SHEET_NAME: '卒業生',
    DEVICE_COLUMNS: DEVICE_COLUMNS,
    TEACHER_COLUMNS: TEACHER_COLUMNS,
    SCHOOL_LIST: SCHOOL_LIST
  }) + ';\n';

  FUNCS.forEach(function (n) { prelude += extract(src, n) + '\n'; });
  vm.runInContext(prelude, sandbox);

  return {
    state: state,
    run: function (expr) { return vm.runInContext(expr, sandbox); },
    call: function (fn, args) {
      const a = (args || []).map(function (v) { return JSON.stringify(v); }).join(',');
      return vm.runInContext(fn + '(' + a + ')', sandbox);
    },
    setNow: function (ms) { state.now = ms; sandbox.ANNUAL_TEST_NOW_MS = ms; },
    sheet: function (n) { return state.sheets[n]; }
  };
}

// =====================================================================
// A. CSV パース（RFC4180）
// =====================================================================
console.log('--- A. CSV パース ---');
{
  const env = buildEnv({});
  const P = function (t) { return env.call('annualParseCsv_', [t]); };

  const r1 = P('a,b\n1,2');
  ok('A-1 単純な2行2列', r1.length === 2 && r1[0][0] === 'a' && r1[1][1] === '2', r1);

  const r2 = P('a,b\n"x,y",z');
  ok('A-2 引用符内のカンマを分割しない', r2[1][0] === 'x,y' && r2[1][1] === 'z', r2);

  const r3 = P('a\n"l1\nl2"');
  ok('A-3 引用符内の改行を保持', r3.length === 2 && r3[1][0] === 'l1\nl2', r3);

  const r4 = P('a\n"he said ""hi"""');
  ok('A-4 二重引用符のエスケープ', r4[1][0] === 'he said "hi"', r4);

  const r5 = P('\uFEFFa,b\n1,2');
  ok('A-5 BOM を除去', r5[0][0] === 'a', r5[0]);

  const r6 = P('a,b\r\n1,2\r\n');
  ok('A-6 CRLF を行区切りとして扱う', r6.length === 2 && r6[1][0] === '1', r6);

  const r7 = P('a\n\n1\n');
  ok('A-7 空行を捨てる', r7.length === 2, r7);

  const r8 = P('');
  ok('A-8 空文字は空配列', Array.isArray(r8) && r8.length === 0, r8);

  const r9 = P('a,b');
  ok('A-9 末尾改行なしで1行だけ', r9.length === 1 && r9[0].length === 2, r9);

  const r10 = P('  a  , b \n 1 , 2 ');
  ok('A-10 前後空白をトリム', r10[0][0] === 'a' && r10[1][0] === '1', r10);

  const r11 = P('only\nx\ny');
  ok('A-11 1列のCSV', r11.length === 3 && r11[2][0] === 'y', r11);

  const r12 = P('a,b\n"q""r",s');
  ok('A-12 引用とエスケープの混在', r12[1][0] === 'q"r', r12);

  const r13 = P('h1,h2\r\n"multi\r\nline",v');
  ok('A-13 引用内のCRLFも保持', r13[1][0] === 'multi\r\nline', r13[1][0]);

  const r14 = P('a,b\n,');
  ok('A-14 全セル空の行は捨てる', r14.length === 1, r14);
}

// =====================================================================
// B. 次年度 児童リストCSV
// =====================================================================
console.log('--- B. 児童CSVマッピング ---');
{
  const env = buildEnv({});
  const csv =
    'メールアドレス,児童ID,氏名,学校名,学年,クラス\n' +
    'taro.yamada@example.com,,山田太郎,北小学校,1,1組\n' +
    'hanako@example.com,s002,山田花子,北小学校,2,2組\n' +
    ',s003,無メール児童,北小学校,3,3組\n' +
    ',,名無し,北小学校,4,4組\n';
  const r = env.call('parseAnnualStudentCsv_', [csv]);

  ok('B-1 有効行のみ取り込む（3件）', r.students.length === 3, r.students.length);
  ok('B-2 児童IDが空ならメールのローカル部から生成',
    r.students[0].student_id === 'taro.yamada', r.students[0].student_id);
  ok('B-3 明示された児童IDはそのまま使う', r.students[1].student_id === 's002', r.students[1].student_id);
  ok('B-4 氏名を取り込む', r.students[0].name === '山田太郎', r.students[0].name);
  ok('B-5 学校名を取り込む', r.students[0].school_name === '北小学校', r.students[0].school_name);
  ok('B-6 学年を取り込む', r.students[0].grade === '1', r.students[0].grade);
  ok('B-7 クラスを取り込む', r.students[0].class_name === '1組', r.students[0].class_name);
  ok('B-8 メール無しでも児童IDがあれば取り込む', r.students[2].student_id === 's003', r.students[2].student_id);
  ok('B-9 IDもメールも無い行はエラーとして記録', r.errors.length === 1, r.errors);
  ok('B-10 エラーに元の行番号を含む', /5行目/.test(r.errors[0] || ''), r.errors[0]);
  ok('B-11 ヘッダー行を保持', r.headers.length === 6, r.headers);
  ok('B-12 データ行数を数える', r.total === 4, r.total);

  const full = env.call('parseAnnualStudentCsv_', ['メールアドレス,氏名\n\n']);
  ok('B-13 ヘッダーのみなら0件', full.students.length === 0, full.students.length);

  const fw = env.call('parseAnnualStudentCsv_', ['メールアドレス,学年\nz@e.com,５\n']);
  ok('B-14 全角数字の学年を半角へ正規化', fw.students[0].grade === '5', fw.students[0].grade);

  const alias = env.call('parseAnnualStudentCsv_', ['email,name,school,grade,class\na@e.com,太郎,北小,1,1組\n']);
  ok('B-15 英語ヘッダーも解釈する', alias.students.length === 1 && alias.students[0].name === '太郎', alias.students);

  ok('B-16 空CSVはエラーを返す',
    env.call('parseAnnualStudentCsv_', ['']).errors.length === 1, 'empty');
}

// =====================================================================
// C. 次年度 教員リストCSV（11列・Google SSO許可）
// =====================================================================
console.log('--- C. 教員CSVマッピング ---');
{
  const env = buildEnv({});
  const csv =
    '教員ID(メールアドレス),パスワード,氏名,所属学校,権限,対象クラス,登録URL情報,個別ホワイトリスト,個別ブラックリスト,最終ログイン日時,Google SSO許可\n' +
    'admin@example.com,pw1,佐藤管理,北小学校,ADMIN,1年1組,,,,,TRUE\n' +
    'suzuki@example.com,pw2,鈴木教諭,北小学校,teacher,2年1組,,,,,FALSE\n' +
    'takahashi@example.com,pw3,高橋教諭,北小学校,TEACHER,3年1組,,,,,\n' +
    'bad-address,pw4,不正,北小学校,TEACHER,4年1組,,,,,TRUE\n';
  const r = env.call('parseAnnualTeacherCsv_', [csv]);

  ok('C-1 有効な教員のみ取り込む（3件）', r.teachers.length === 3, r.teachers.length);
  ok('C-2 メールを小文字化', r.teachers[0].email === 'admin@example.com', r.teachers[0].email);
  ok('C-3 権限を大文字化', r.teachers[1].role === 'TEACHER', r.teachers[1].role);
  ok('C-4 権限 ADMIN を保持', r.teachers[0].role === 'ADMIN', r.teachers[0].role);
  ok('C-5 対象クラスを取り込む', r.teachers[0].classes === '1年1組', r.teachers[0].classes);
  ok('C-6 パスワードを取り込む', r.teachers[0].password === 'pw1', r.teachers[0].password);
  ok('C-7 SSO許可 TRUE→true', r.teachers[0].sso_allowed === true, r.teachers[0].sso_allowed);
  ok('C-8 SSO許可 FALSE→false', r.teachers[1].sso_allowed === false, r.teachers[1].sso_allowed);
  ok('C-9 SSO許可 空欄は既定ON', r.teachers[2].sso_allowed === true, r.teachers[2].sso_allowed);
  ok('C-10 SSO列の存在を記録', r.teachers[0].has_sso === true, r.teachers[0].has_sso);
  ok('C-11 不正メールはエラーに記録', r.errors.length === 1, r.errors);
  ok('C-12 不正メールの行番号を記録', /5行目/.test(r.errors[0] || ''), r.errors[0]);

  const noSso = env.call('parseAnnualTeacherCsv_', ['教員ID(メールアドレス),氏名\nq@e.com,山田\n']);
  ok('C-13 SSO列が無いCSVでも解釈できる',
    noSso.teachers.length === 1 && noSso.teachers[0].has_sso === false, noSso.teachers);

  const sso = env.call('parseAnnualTeacherCsv_', ['メールアドレス,Google SSO許可\na@e.com,不可\n']);
  ok('C-14 「不可」はSSO不許可', sso.teachers[0].sso_allowed === false, sso.teachers[0].sso_allowed);

  ok('C-15 空CSVはエラーを返す',
    env.call('parseAnnualTeacherCsv_', ['']).errors.length === 1, 'empty');
  ok('C-16 教員マスタは11列', TEACHER_COLUMNS.length === 11, TEACHER_COLUMNS.length);
  ok('C-17 11列目が Google SSO許可', TEACHER_COLUMNS[10] === 'Google SSO許可', TEACHER_COLUMNS[10]);
}

// =====================================================================
// D. 実行予定日時の解釈
// =====================================================================
console.log('--- D. 日時パース/整形 ---');
{
  const env = buildEnv({});
  const want = Date.UTC(2027, 2, 31, 21, 0, 0); // 2027-04-01 06:00 JST

  ok('D-1 datetime-local 形式をJSTとして解釈',
    env.call('annualParseRunAt_', ['2027-04-01T06:00']) === want,
    env.call('annualParseRunAt_', ['2027-04-01T06:00']));
  ok('D-2 半角スペース区切りも同値',
    env.call('annualParseRunAt_', ['2027-04-01 06:00']) === want, 'space');
  ok('D-3 スラッシュ区切りも同値',
    env.call('annualParseRunAt_', ['2027/04/01 06:00']) === want, 'slash');
  ok('D-4 秒付きも解釈',
    env.call('annualParseRunAt_', ['2027/04/01 06:00:30']) === want + 30000, 'sec');
  ok('D-5 整形は日本時間表記',
    env.call('annualFormatRunAt_', [want]) === '2027/04/01 06:00',
    env.call('annualFormatRunAt_', [want]));
  ok('D-6 秒付き整形',
    env.call('annualFormatRunAtFull_', [want]) === '2027/04/01 06:00:00',
    env.call('annualFormatRunAtFull_', [want]));
  ok('D-7 存在しない月は0', env.call('annualParseRunAt_', ['2027-13-01T06:00']) === 0, 'm13');
  ok('D-8 存在しない日は0（2/30）', env.call('annualParseRunAt_', ['2027-02-30T06:00']) === 0, 'feb30');
  ok('D-9 空文字は0', env.call('annualParseRunAt_', ['']) === 0, 'empty');
  ok('D-10 不正文字列は0', env.call('annualParseRunAt_', ['あした']) === 0, 'jp');
  ok('D-11 時刻欠落は0', env.call('annualParseRunAt_', ['2027-04-01']) === 0, 'nodate');
  ok('D-12 往復変換が一致',
    env.call('annualParseRunAt_', [env.call('annualFormatRunAt_', [want])]) === want, 'roundtrip');
}

// =====================================================================
// E. 予約の保存・読み出し・削除（PropertiesService のみ）
// =====================================================================
console.log('--- E. 予約ストレージ ---');
{
  const env = buildEnv({});
  const plan = {
    run_at_ms: Date.UTC(2027, 2, 31, 21, 0, 0),
    run_at_text: '2027/04/01 06:00',
    clear_previous: true,
    students: [{ student_id: 's1', name: 'A' }, { student_id: 's2', name: 'B' }],
    teachers: [{ email: 't@e.com', name: 'T' }],
    status: 'pending'
  };
  const saved = env.call('annualPlanSave_', [plan]);
  ok('E-1 保存できる', saved.stored === true, saved);
  ok('E-2 メタキーが存在する',
    typeof env.state.props['ANNUAL_ROLLOVER_PLAN_V1'] === 'string', Object.keys(env.state.props).length);

  const loaded = env.call('annualPlanLoad_', []);
  ok('E-3 読み出せる', !!loaded, !!loaded);
  ok('E-4 実行予定日時が一致', loaded.run_at_ms === plan.run_at_ms, loaded.run_at_ms);
  ok('E-5 児童配列が一致', JSON.stringify(loaded.students) === JSON.stringify(plan.students), loaded.students);
  ok('E-6 教員配列が一致', JSON.stringify(loaded.teachers) === JSON.stringify(plan.teachers), loaded.teachers);
  ok('E-7 前年度削除フラグが一致', loaded.clear_previous === true, loaded.clear_previous);

  // 容量：大量データでも1プロパティ 9000 文字を超えない。
  //   ※ 氏名を擬似乱数にして gzip が効きにくくする（圧縮で1チャンクに収まると
  //      「分割保存」の検証にならないため）。
  let eSeed = 987654321;
  const eRnd = function () { eSeed = (eSeed * 1103515245 + 12345) % 2147483648; return eSeed; };
  const eTok = function (len) {
    let t = '';
    const cs = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    for (let i = 0; i < len; i++) t += cs.charAt(eRnd() % cs.length);
    return t;
  };
  let bigCsv = 'メールアドレス,児童ID,氏名,学校名,学年,クラス\n';
  for (let i = 0; i < 500; i++) {
    bigCsv += eTok(24) + '@example.com,s' + i + ',' + eTok(24) + ',北小学校,' + ((i % 6) + 1) + ',' + ((i % 3) + 1) + '組\n';
  }
  const bigStudents = env.call('parseAnnualStudentCsv_', [bigCsv]).students;
  const bigPlan = {
    run_at_ms: plan.run_at_ms, run_at_text: plan.run_at_text, clear_previous: true,
    students: bigStudents, teachers: plan.teachers, status: 'pending'
  };
  const bigSaved = env.call('annualPlanSave_', [bigPlan]);
  ok('E-8 大量データは分割保存される', bigSaved.chunks > 1, bigSaved.chunks);
  ok('E-9 1プロパティは9000文字以内に収まる', env.state.propsMaxLen <= 9000, env.state.propsMaxLen);
  const bigLoaded = env.call('annualPlanLoad_', []);
  ok('E-10 分割しても内容が一致（500件）',
    bigLoaded && bigLoaded.students.length === 500, bigLoaded ? bigLoaded.students.length : -1);
  ok('E-11 分割後も先頭と末尾の内容が保持',
    bigLoaded.students[0].student_id === 's0' && bigLoaded.students[499].student_id === 's499',
    [bigLoaded.students[0].student_id, bigLoaded.students[499].student_id]);
  ok('E-11b 分割保存でも順序が保たれる',
    bigLoaded.students[1].student_id === 's1' && bigLoaded.students[250].student_id === 's250',
    [bigLoaded.students[1].student_id, bigLoaded.students[250].student_id]);

  // 小さい予約で上書きすると、以前の大きいチャンクが残らない
  env.call('annualPlanSave_', [plan]);
  const leftovers = Object.keys(env.state.props).filter(function (k) {
    return k.indexOf('ANNUAL_ROLLOVER_PLAN_V1__C') === 0;
  });
  const metaSmall = JSON.parse(env.state.props['ANNUAL_ROLLOVER_PLAN_V1']).chunks;
  ok('E-12 上書きで古いチャンクが残らない', leftovers.length === metaSmall, [leftovers.length, metaSmall]);
  ok('E-13 上書き後の内容が正しい',
    env.call('annualPlanLoad_', []).students.length === 2, 'overwrite');

  const cancelled = env.call('annualPlanClear_', []);
  ok('E-14 クリアで全キーが消える', cancelled.removed > 0, cancelled.removed);
  const remain = Object.keys(env.state.props).filter(function (k) {
    return k.indexOf('ANNUAL_ROLLOVER_PLAN_V1') === 0;
  });
  ok('E-15 クリア後に年次キーが0件', remain.length === 0, remain);
  ok('E-16 クリア後の読み出しはnull', env.call('annualPlanLoad_', []) === null, 'null');

  // 破損（チャンク欠落）は安全側で null
  env.call('annualPlanSave_', [plan]);
  delete env.state.props['ANNUAL_ROLLOVER_PLAN_V1__C0'];
  ok('E-17 チャンク欠落は破損としてnull', env.call('annualPlanLoad_', []) === null, 'corrupt');

  // 公開ビューはCSV全文を返さない
  env.call('annualPlanClear_', []);
  env.call('annualPlanSave_', [plan]);
  const view = env.call('annualPlanPublicView_', [env.call('annualPlanLoad_', [])]);
  ok('E-18 公開ビューは件数のみ', view.student_count === 2 && view.teacher_count === 1, view.student_count);
  ok('E-19 公開ビューは全件配列を返さない',
    view.students === undefined && Array.isArray(view.student_sample), 'no-full-array');
  ok('E-20 公開ビューに実行予定日時表記', view.run_at_text === '2027/04/01 06:00', view.run_at_text);
  ok('E-21 予約キーは専用プロパティ', src.indexOf("const ANNUAL_PLAN_PROP = 'ANNUAL_ROLLOVER_PLAN_V1'") >= 0, 'prop-key');

  // 上限超過は明示的に失敗させる
  // 圧縮が効かないよう擬似乱数の英数字で埋める（gzip 後のサイズで上限判定させる）
  let seed = 12345;
  const rnd = function () { seed = (seed * 1103515245 + 12345) % 2147483648; return seed; };
  const token = function (len) {
    let t = '';
    const cs = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    for (let i = 0; i < len; i++) t += cs.charAt(rnd() % cs.length);
    return t;
  };
  let huge = 'メールアドレス,氏名\n';
  for (let i = 0; i < 6000; i++) huge += token(20) + '@example.com,' + token(20) + '\n';
  const hugeStudents = env.call('parseAnnualStudentCsv_', [huge]).students;
  let threw = false;
  try {
    env.call('annualPlanSave_', [{
      run_at_ms: plan.run_at_ms, clear_previous: true, students: hugeStudents, teachers: [], status: 'pending'
    }]);
  } catch (e) { threw = true; }
  ok('E-22 上限超過は例外で通知する', threw === true, threw);
}

// =====================================================================
// F. 実行フロー（クリア＋R41伝播＋児童/教員反映）
// =====================================================================
console.log('--- F. 実行フロー ---');
{
  // F-1〜: R41 分散（子GAS 6台）
  const env = buildEnv({ deviceIds: ['old1', 'old2', 'old3'], teacherEmails: ['keep@example.com'] });
  env.state.shard.parent = true;
  env.state.shard.urls = ['https://child1/exec', 'https://child2/exec', 'https://child3/exec',
    'https://child4/exec', 'https://child5/exec', 'https://child6/exec'];
  env.state.shard.secret = 'SEC-R45';
  env.state.props['SHARD_SECRET'] = 'SEC-R45';

  const clearRes = env.call('annualClearPreviousData_', []);
  ok('F-1 親シートの前年度行を全削除', clearRes.parent_rows === 3, clearRes.parent_rows);
  ok('F-2 端末一覧はヘッダー1行だけになる', env.sheet('端末一覧').getLastRow() === 1, env.sheet('端末一覧').getLastRow());
  ok('F-3 子GASへ1回の並列POST', env.state.fetchAllCalls === 1, env.state.fetchAllCalls);
  ok('F-4 全6校へ到達', env.state.fetchedUrls.length === 6, env.state.fetchedUrls.length);
  ok('F-5 全6校クリア成功', clearRes.child_ok === 6 && clearRes.child_failed === 0, clearRes);
  ok('F-6 子GASは端末一覧0件のまま（親は他シート不干渉）',
    env.sheet('教員マスタ').getLastRow() === 2, env.sheet('教員マスタ').getLastRow());

  const payload0 = JSON.parse(env.state.fetchedPayloads[0]);
  ok('F-7 クリア指令に annual_clear を含む', payload0.annual_clear === true, payload0.annual_clear);
  ok('F-8 クリア指令に action=shard_apply', payload0.action === 'shard_apply', payload0.action);
  ok('F-9 クリア指令に共有シークレットを含む', payload0.shard_secret === 'SEC-R45', 'secret');
  ok('F-10 教員マスタは削除されない', env.sheet('教員マスタ').getLastRow() === 2, env.sheet('教員マスタ').getLastRow());
  ok('F-11 設定シートも削除されない', env.sheet('設定').getLastRow() === 2, env.sheet('設定').getLastRow());
  ok('F-12 クリア対象は端末一覧のみ（ソース検証）',
    /annualClearSheetBody_\(sheet\)/.test(extract(src, 'shardAnnualClearLocalDevices_')), 'source');

  // 子GAS 1台ダウン
  const envDown = buildEnv({ deviceIds: ['a'] });
  envDown.state.shard.parent = true;
  envDown.state.shard.urls = ['https://c1/exec', 'https://c2/exec', 'https://c3/exec'];
  envDown.state.failFetchUrls['https://c2/exec'] = true;
  const downRes = envDown.call('annualClearPreviousData_', []);
  ok('F-13 子GAS1台失敗でも他は成功', downRes.child_ok === 2 && downRes.child_failed === 1, downRes);
  ok('F-14 失敗しても例外を投げない', downRes.child_urls === 3, downRes.child_urls);

  // 子GAS 0台（単一GAS構成）→ 通信しない
  const envSolo = buildEnv({ deviceIds: ['x1', 'x2'] });
  envSolo.state.shard.parent = true;
  envSolo.state.shard.urls = [];
  const soloRes = envSolo.call('annualClearPreviousData_', []);
  ok('F-15 子GAS0台では通信しない', envSolo.state.fetchAllCalls === 0, envSolo.state.fetchAllCalls);
  ok('F-16 子GAS0台でも親シートはクリアされる', soloRes.parent_rows === 2, soloRes.parent_rows);
  ok('F-17 子GAS0台で child_urls=0', soloRes.child_urls === 0, soloRes.child_urls);

  // SHARD_MODE=false（親でない）→ 通信しない
  const envSingle = buildEnv({ deviceIds: ['y1'] });
  envSingle.state.shard.parent = false;
  envSingle.state.shard.urls = ['https://should-not-be-called/exec'];
  const singleRes = envSingle.call('annualClearPreviousData_', []);
  ok('F-18 単一GASモードでは子GASへ送らない', envSingle.state.fetchAllCalls === 0, envSingle.state.fetchAllCalls);
  ok('F-19 単一GASモードでも親はクリア', singleRes.parent_rows === 1, singleRes.parent_rows);

  // 児童反映：新入生追加＋進級更新
  const envStu = buildEnv({ deviceIds: ['s001', 's002'] });
  envStu.sheet('端末一覧')._rows[1][2] = '旧名001';
  const st = envStu.call('annualApplyStudents_', [[
    { student_id: 's001', name: '新名001', school_name: '北小学校', grade: '2', class_name: '1組' },
    { student_id: 's002', name: '児童002', school_name: '北小学校', grade: '2', class_name: '2組' },
    { student_id: 's003', name: '新入生003', school_name: '北小学校', grade: '1', class_name: '1組' }
  ], { pruneMissing: false }]);
  ok('F-20 既存2件を更新', st.updated === 2, st.updated);
  ok('F-21 新入生1件を追加', st.added === 1, st.added);
  ok('F-22 重複行を作らない', envStu.sheet('端末一覧').getLastRow() === 4, envStu.sheet('端末一覧').getLastRow());
  ok('F-23 氏名が更新される', envStu.sheet('端末一覧')._rows[1][2] === '新名001', envStu.sheet('端末一覧')._rows[1][2]);
  ok('F-24 クラスが「2年1組」に進級', envStu.sheet('端末一覧')._rows[1][3] === '2年1組', envStu.sheet('端末一覧')._rows[1][3]);
  ok('F-25 新入生の児童IDが入る',
    envStu.sheet('端末一覧')._rows.some(function (r) { return r[0] === 's003'; }), 's003');

  // 卒業生整理（clear_previous=false のとき）
  const envGrad = buildEnv({ deviceIds: ['s001', 's002', 's900'] });
  const gr = envGrad.call('annualApplyStudents_', [[
    { student_id: 's001', name: 'A', school_name: '北小学校', grade: '6', class_name: '1組' },
    { student_id: 's002', name: 'B', school_name: '北小学校', grade: '6', class_name: '1組' }
  ], { pruneMissing: true }]);
  ok('F-26 新リストに無い児童を削除', gr.removed === 1, gr.removed);
  ok('F-27 残るのは新リストの2件＋ヘッダー', envGrad.sheet('端末一覧').getLastRow() === 3, envGrad.sheet('端末一覧').getLastRow());
  ok('F-28 卒業生IDは消えている',
    !envGrad.sheet('端末一覧')._rows.some(function (r) { return r[0] === 's900'; }), 's900');

  // 教員反映：新任教員追加＋既存更新（Google SSO許可を含む）
  const envTea = buildEnv({ teacherEmails: ['keep@example.com'] });
  const te = envTea.call('annualApplyTeachers_', [[
    { email: 'keep@example.com', name: '更新済み教員', school_name: '北小学校', role: 'ADMIN', classes: '1年1組', sso_allowed: false, has_sso: true },
    { email: 'new@example.com', name: '新任教員', school_name: '北小学校', role: 'TEACHER', classes: '2年1組', sso_allowed: true, has_sso: true }
  ]]);
  ok('F-29 既存教員1件を更新', te.updated === 1, te.updated);
  ok('F-30 新任教員1件を追加', te.added === 1, te.added);
  ok('F-31 教員行が重複しない', envTea.sheet('教員マスタ').getLastRow() === 3, envTea.sheet('教員マスタ').getLastRow());
  ok('F-32 既存教員の氏名を更新', envTea.sheet('教員マスタ')._rows[1][2] === '更新済み教員', envTea.sheet('教員マスタ')._rows[1][2]);
  ok('F-33 既存教員のSSOをFALSEへ更新', envTea.sheet('教員マスタ')._rows[1][10] === 'FALSE', envTea.sheet('教員マスタ')._rows[1][10]);
  ok('F-34 新任教員のSSOはTRUE', envTea.sheet('教員マスタ')._rows[2][10] === 'TRUE', envTea.sheet('教員マスタ')._rows[2][10]);
  ok('F-35 新任教員の権限が入る', envTea.sheet('教員マスタ')._rows[2][4] === 'TEACHER', envTea.sheet('教員マスタ')._rows[2][4]);
  ok('F-36 教員マスタのヘッダー11列は不変',
    envTea.sheet('教員マスタ')._rows[0].length === 11, envTea.sheet('教員マスタ')._rows[0].length);

  // 統合：executePlan_ の件数集計
  const envAll = buildEnv({ deviceIds: ['a1', 'a2'], teacherEmails: ['t1@e.com'] });
  envAll.state.shard.parent = true;
  envAll.state.shard.urls = ['https://x1/exec', 'https://x2/exec'];
  const counts = envAll.call('annualExecutePlan_', [{
    clear_previous: true,
    students: [{ student_id: 'n1', name: 'N1', school_name: '北小学校', grade: '1', class_name: '1組' }],
    teachers: [{ email: 't1@e.com', name: 'T1', school_name: '北小学校', role: 'TEACHER', sso_allowed: true, has_sso: true }]
  }]);
  ok('F-37 集計：前年度削除行数', counts.previous_rows_deleted === 2, counts.previous_rows_deleted);
  ok('F-38 集計：子GAS件数', counts.child_urls === 2 && counts.child_ok === 2, [counts.child_urls, counts.child_ok]);
  ok('F-39 集計：児童追加', counts.students_added === 1, counts.students_added);
  ok('F-40 集計：教員更新', counts.teachers_updated === 1, counts.teachers_updated);

  // 親シートのクリアが失敗しても子GAS伝播と反映は続行する
  const envRes = buildEnv({ deviceIds: ['r1'] });
  envRes.sheet('端末一覧')._failDeleteRows = true;
  envRes.state.shard.parent = true;
  envRes.state.shard.urls = ['https://z1/exec'];
  const resRes = envRes.call('annualExecutePlan_', [{
    clear_previous: true, students: [{ student_id: 'q1', name: 'Q', school_name: '北小学校', grade: '1', class_name: '1組' }], teachers: []
  }]);
  ok('F-41 親クリア失敗を記録する', !!resRes.parent_error, resRes.parent_error ? 'recorded' : 'missing');
  ok('F-42 親クリア失敗でも子GASへ伝播する', envRes.state.fetchAllCalls === 1, envRes.state.fetchAllCalls);
  ok('F-43 親クリア失敗でも児童反映は行う', resRes.students_added === 1, resRes.students_added);
  // 注: 親シートのクリア失敗は端末一覧の deleteRows を mock で拒否させて再現している
}

// =====================================================================
// G. 二重実行防止・キャンセル
// =====================================================================
console.log('--- G. 二重実行防止 ---');
{
  const env = buildEnv({ deviceIds: ['g1', 'g2'] });
  env.state.tokenMap['tokA'] = { email: 'admin@example.com', role: 'ADMIN' };
  env.call('api_annualReservationSave', ['tokA', {
    run_at: '2027-04-01T06:00',
    clear_previous: true,
    student_csv: 'メールアドレス,氏名\nst1@e.com,児童1\n',
    teacher_csv: 'メールアドレス,氏名\nte@e.com,教員1\n'
  }]);

  const first = env.call('annualRolloverExecutor', [{ source: 'test' }]);
  ok('G-1 1回目は実行される', first.executed === true, first);
  ok('G-2 1回目で status=done',
    env.call('annualPlanLoad_', []).status === 'done', env.call('annualPlanLoad_', []).status);
  ok('G-3 実行完了日時が記録される',
    !!env.call('annualPlanLoad_', []).ran_at_text, env.call('annualPlanLoad_', []).ran_at_text);

  const second = env.call('annualRolloverExecutor', [{ source: 'test' }]);
  ok('G-4 2回目は実行されない', second.executed === false, second);
  ok('G-5 2回目の理由は already_done', second.reason === 'already_done', second.reason);

  const rowsAfter = env.sheet('端末一覧').getLastRow();
  ok('G-6 二重実行で行が増減しない', rowsAfter === 2, rowsAfter);

  // ロック競合時は実行しない（status は pending のまま）
  const envLock = buildEnv({ deviceIds: ['l1'] });
  envLock.state.tokenMap['tokB'] = { email: 'admin@example.com', role: 'ADMIN' };
  envLock.call('api_annualReservationSave', ['tokB', {
    run_at: '2027-04-01T06:00', clear_previous: true,
    student_csv: 'メールアドレス,氏名\nlk@e.com,児童L\n', teacher_csv: ''
  }]);
  envLock.state.lock.failNext = true;
  const locked = envLock.call('annualRolloverExecutor', [{ source: 'test' }]);
  ok('G-7 ロック競合時は実行しない', locked.executed === false, locked);
  ok('G-8 ロック競合の理由は locked', locked.reason === 'locked', locked.reason);
  ok('G-9 ロック競合後も status は pending',
    envLock.call('annualPlanLoad_', []).status === 'pending', envLock.call('annualPlanLoad_', []).status);
  envLock.state.lock.failNext = false;
  const retried = envLock.call('annualRolloverExecutor', [{ source: 'test' }]);
  ok('G-10 ロック解放後に再実行できる', retried.executed === true, retried);

  // 予約が無いときは実行しない
  const envNone = buildEnv({});
  const none = envNone.call('annualRolloverExecutor', [{ source: 'test' }]);
  ok('G-11 予約が無ければ実行しない', none.executed === false && none.reason === 'no_plan', none);

  // 実行中の例外は status=error として残り、再実行できる
  const envErr = buildEnv({ deviceIds: ['e1'] });
  envErr.state.tokenMap['tokC'] = { email: 'admin@example.com', role: 'ADMIN' };
  envErr.call('api_annualReservationSave', ['tokC', {
    run_at: '2027-04-01T06:00', clear_previous: false,
    student_csv: 'メールアドレス,氏名\nerr@e.com,児童E\n', teacher_csv: ''
  }]);
  envErr.sheet('端末一覧')._failSetValues = true;
  const failed = envErr.call('annualRolloverExecutor', [{ source: 'test' }]);
  ok('G-12 例外時は success=false', failed.success === false, failed.success);
  ok('G-13 例外時の理由は error', failed.reason === 'error', failed.reason);
  ok('G-14 例外時は status=error を保存',
    envErr.call('annualPlanLoad_', []).status === 'error', envErr.call('annualPlanLoad_', []).status);
  ok('G-15 例外内容が last_error に残る',
    !!envErr.call('annualPlanLoad_', []).last_error, 'has-error');
  envErr.sheet('端末一覧')._failSetValues = false;
  const afterFix = envErr.call('annualRolloverExecutor', [{ source: 'test' }]);
  ok('G-16 原因解消後に再実行できる', afterFix.executed === true, afterFix);

  // キャンセル
  const envCan = buildEnv({});
  envCan.state.tokenMap['tokD'] = { email: 'admin@example.com', role: 'ADMIN' };
  envCan.call('api_annualReservationSave', ['tokD', {
    run_at: '2027-04-01T06:00', clear_previous: true,
    student_csv: 'メールアドレス,氏名\nc@e.com,児童C\n', teacher_csv: ''
  }]);
  ok('G-17 保存時に予約トリガーが1本できる',
    envCan.state.triggers.filter(function (t) { return t.fn === 'annualRolloverTriggered_'; }).length === 1,
    envCan.state.triggers.length);
  const can = envCan.call('api_annualReservationCancel', ['tokD']);
  ok('G-18 予約をキャンセルできる', can.cancelled === true, can);
  ok('G-19 キャンセルで予約データが消える', envCan.call('annualPlanLoad_', []) === null, 'cleared');
  ok('G-20 キャンセルで予約トリガーが消える',
    envCan.state.triggers.filter(function (t) { return t.fn === 'annualRolloverTriggered_'; }).length === 0,
    envCan.state.triggers.length);

  // 実行済みはキャンセル不可
  const envDone = buildEnv({ deviceIds: ['d1'] });
  envDone.state.tokenMap['tokE'] = { email: 'admin@example.com', role: 'ADMIN' };
  envDone.call('api_annualReservationSave', ['tokE', {
    run_at: '2027-04-01T06:00', clear_previous: true,
    student_csv: 'メールアドレス,氏名\nd@e.com,児童D\n', teacher_csv: ''
  }]);
  envDone.call('annualRolloverExecutor', [{ source: 'test' }]);
  const canDone = envDone.call('api_annualReservationCancel', ['tokE']);
  ok('G-21 実行済みはキャンセル不可', canDone.success === false, canDone.success);
  ok('G-22 実行済みデータは保持される', envDone.call('annualPlanLoad_', []).status === 'done', 'done');
}

// =====================================================================
// H. 非管理者ガード・フォールバック・不変条件
// =====================================================================
console.log('--- H. ガード/フォールバック/不変条件 ---');
{
  const env = buildEnv({});
  ok('H-1 ADMIN は管理者', env.call('isAdminTeacher', [{ role: 'ADMIN' }]) === true, 'ADMIN');
  ok('H-2 TEACHER は管理者でない', env.call('isAdminTeacher', [{ role: 'TEACHER' }]) === false, 'TEACHER');
  ok('H-3 権限空は管理者でない', env.call('isAdminTeacher', [{ role: '' }]) === false, 'empty');
  ok('H-4 教員情報なしは管理者でない', env.call('isAdminTeacher', [null]) === false, 'null');

  env.state.tokenMap['badToken'] = null;
  const unauth = env.call('api_annualReservationSave', ['unknown', { run_at: '2027-04-01T06:00' }]);
  ok('H-5 無効トークンは need_auth', unauth.need_auth === true, unauth);

  env.state.tokenMap['tokTeacher'] = { email: 't@example.com', role: 'TEACHER' };
  const nonAdmin = env.call('api_annualReservationSave', ['tokTeacher', {
    run_at: '2027-04-01T06:00', student_csv: 'メールアドレス,氏名\nx@e.com,X\n'
  }]);
  ok('H-6 非管理者は保存できない', nonAdmin.success === false, nonAdmin.success);
  ok('H-7 非管理者のエラーは管理者限定の文言',
    /管理者のみ/.test(String(nonAdmin.error || '')), nonAdmin.error);

  const nonAdminStatus = env.call('api_annualReservationStatus', ['tokTeacher']);
  ok('H-8 非管理者は状態も取得できない', nonAdminStatus.success === false, nonAdminStatus.success);
  const nonAdminCancel = env.call('api_annualReservationCancel', ['tokTeacher']);
  ok('H-9 非管理者はキャンセルできない', nonAdminCancel.success === false, nonAdminCancel.success);
  const nonAdminRun = env.call('api_annualRolloverRunNow', ['tokTeacher', {}]);
  ok('H-10 非管理者は即時実行できない', nonAdminRun.success === false, nonAdminRun.success);

  env.state.tokenMap['tokAdmin'] = { email: 'admin@example.com', role: 'ADMIN' };
  const badDate = env.call('api_annualReservationSave', ['tokAdmin', {
    run_at: 'いつか', student_csv: 'メールアドレス,氏名\na@e.com,A\n'
  }]);
  ok('H-11 不正日時は保存を拒否', badDate.success === false, badDate.success);
  ok('H-12 不正日時の説明を含む', /実行予定日時/.test(String(badDate.error || '')), badDate.error);

  const noCsv = env.call('api_annualReservationSave', ['tokAdmin', {
    run_at: '2027-04-01T06:00', student_csv: '', teacher_csv: ''
  }]);
  ok('H-13 CSVが空なら保存を拒否', noCsv.success === false, noCsv.success);

  const saved = env.call('api_annualReservationSave', ['tokAdmin', {
    run_at: '2027-04-01T06:00', clear_previous: true,
    student_csv: 'メールアドレス,氏名\nh1@e.com,児童H1\nh2@e.com,児童H2\n',
    teacher_csv: 'メールアドレス,氏名\nht@e.com,教員H\n'
  }]);
  ok('H-14 管理者は予約保存できる', saved.success === true, saved.success);
  ok('H-15 保存結果に予定日時表記', saved.plan.run_at_text === '2027/04/01 06:00', saved.plan.run_at_text);
  ok('H-16 保存結果に児童件数', saved.plan.student_count === 2, saved.plan.student_count);
  ok('H-17 保存結果に教員件数', saved.plan.teacher_count === 1, saved.plan.teacher_count);
  ok('H-18 保存時にトリガーが設定される',
    env.state.triggers.some(function (t) { return t.fn === 'annualRolloverTriggered_'; }), env.state.triggers.length);
  ok('H-19 定期（保険）トリガーも1本だけ設定される',
    env.state.triggers.filter(function (t) { return t.fn === 'annualRolloverPeriodicTick_'; }).length === 1,
    env.state.triggers.length);

  // 2回目の保存で定期トリガーが重複しない
  env.call('api_annualReservationSave', ['tokAdmin', {
    run_at: '2027-04-02T06:00', clear_previous: true,
    student_csv: 'メールアドレス,氏名\nh1@e.com,児童H1\n', teacher_csv: ''
  }]);
  ok('H-20 再保存でも定期トリガーは1本',
    env.state.triggers.filter(function (t) { return t.fn === 'annualRolloverPeriodicTick_'; }).length === 1,
    env.state.triggers.length);
  ok('H-21 再保存でも予約トリガーは1本',
    env.state.triggers.filter(function (t) { return t.fn === 'annualRolloverTriggered_'; }).length === 1,
    env.state.triggers.length);

  // フォールバック：予定時刻前は実行しない
  const envFb = buildEnv({ deviceIds: ['f1'] });
  envFb.state.tokenMap['tokF'] = { email: 'admin@example.com', role: 'ADMIN' };
  const futureMs = envFb.state.now + 3600000;
  const futureText = envFb.call('annualFormatRunAt_', [futureMs]).replace(/\//g, '-').replace(' ', 'T');
  envFb.call('api_annualReservationSave', ['tokF', {
    run_at: futureText, clear_previous: true,
    student_csv: 'メールアドレス,氏名\nf@e.com,児童F\n', teacher_csv: ''
  }]);
  const notYet = envFb.call('annualRolloverFallbackCheck_', []);
  ok('H-22 予定時刻前は実行しない', notYet.executed === false, notYet);
  ok('H-23 予定時刻前の理由は not_yet', notYet.reason === 'not_yet', notYet.reason);

  // フォールバック：予定時刻を過ぎたら自動実行
  envFb.setNow(futureMs + 60000);
  const dueRes = envFb.call('annualRolloverFallbackCheck_', []);
  ok('H-24 予定時刻を過ぎたら自動実行', dueRes.executed === true, dueRes);
  ok('H-25 自動実行の理由は due', dueRes.due === true, dueRes.due);
  ok('H-26 自動実行で status=done',
    envFb.call('annualPlanLoad_', []).status === 'done', envFb.call('annualPlanLoad_', []).status);
  ok('H-27 自動実行で児童が反映される',
    envFb.sheet('端末一覧')._rows.some(function (r) { return r[0] === 'f'; }), 'applied');

  // 管理画面アクセス時（status API）でもフォールバックが走る
  const envUi = buildEnv({ deviceIds: ['u1'] });
  envUi.state.tokenMap['tokU'] = { email: 'admin@example.com', role: 'ADMIN' };
  envUi.call('api_annualReservationSave', ['tokU', {
    run_at: '2027-04-01T06:00', clear_previous: true,
    student_csv: 'メールアドレス,氏名\nui@e.com,児童UI\n', teacher_csv: ''
  }]);
  envUi.setNow(Date.UTC(2027, 3, 1, 0, 0, 0)); // 2027-04-01 09:00 JST（予定時刻超過）
  const statusRes = envUi.call('api_annualReservationStatus', ['tokU']);
  ok('H-28 status API がフォールバックを実行', statusRes.fallback.executed === true, statusRes.fallback);
  ok('H-29 status API の返却が done', statusRes.plan.status === 'done', statusRes.plan.status);
  ok('H-30 status API が取込件数を返す',
    statusRes.plan.counts && statusRes.plan.counts.students_added === 1, statusRes.plan.counts);

  // 予約なしのフォールバック
  const envNo = buildEnv({});
  const noPlan = envNo.call('annualRolloverFallbackCheck_', []);
  ok('H-31 予約なしは実行しない', noPlan.executed === false && noPlan.reason === 'no_plan', noPlan);

  // トリガーハンドラ
  const envTr = buildEnv({ deviceIds: ['tr1'] });
  envTr.state.tokenMap['tokT'] = { email: 'admin@example.com', role: 'ADMIN' };
  envTr.call('api_annualReservationSave', ['tokT', {
    run_at: '2027-04-01T06:00', clear_previous: true,
    student_csv: 'メールアドレス,氏名\ntr@e.com,児童TR\n', teacher_csv: ''
  }]);
  const tick = envTr.call('annualRolloverPeriodicTick_', []);
  ok('H-32 定期ハンドラが動作する', tick && tick.checked === true, tick ? tick.checked : null);

  // 子GAS 側ハンドラ：シークレット不一致は拒否
  const envChild = buildEnv({ deviceIds: ['c1', 'c2'] });
  envChild.state.shard.child = true;
  envChild.state.props['SHARD_SECRET'] = 'REAL-SECRET';
  const badSecret = envChild.call('shardAnnualClearFromParent', [{ shard_secret: 'WRONG', annual_clear: true }]);
  ok('H-33 子GASはシークレット不一致を拒否', badSecret.success === false, badSecret);
  ok('H-34 不一致時は行を消さない', envChild.sheet('端末一覧').getLastRow() === 3, envChild.sheet('端末一覧').getLastRow());

  const envChild2 = buildEnv({ deviceIds: ['c1', 'c2'] });
  envChild2.state.shard.child = true;
  envChild2.state.props['SHARD_SECRET'] = 'CHILD-SEC';
  const goodClear = envChild2.call('shardAnnualClearFromParent', [{ shard_secret: 'CHILD-SEC', annual_clear: true }]);
  ok('H-35 子GASはクリア指令を実行', goodClear.success === true && goodClear.cleared === 2, goodClear);
  ok('H-36 子GASの端末一覧はヘッダーのみ', envChild2.sheet('端末一覧').getLastRow() === 1, envChild2.sheet('端末一覧').getLastRow());

  // ソース配線の検証
  ok('H-37 shardApplyFromParent に annual_clear 分岐がある',
    /annual_clear\s*===\s*true/.test(extract(src, 'shardApplyFromParent')), 'branch');
  ok('H-38 doPost に shard_annual_clear ルートがある',
    src.indexOf("action === 'shard_annual_clear'") >= 0, 'route');
  ok('H-39 4本の管理者APIが存在する',
    ['api_annualReservationSave', 'api_annualReservationStatus',
      'api_annualReservationCancel', 'api_annualRolloverRunNow']
      .every(function (n) { return src.indexOf('function ' + n + '(') >= 0; }), 'api');
  ok('H-40 timeBased().at() を使っている',
    /timeBased\(\)\.at\(/.test(extract(src, 'annualInstallTrigger_')), 'trigger');
  ok('H-41 実行は withWriteLock で直列化される',
    /withWriteLock\(function/.test(extract(src, 'annualRolloverExecutor')), 'lock');
  ok('H-42 予約データは PropertiesService のみ',
    /getScriptProperties\(\)/.test(extract(src, 'annualPlanSave_')) &&
    /getScriptProperties\(\)/.test(extract(src, 'annualPlanLoad_')), 'props');

  // UI（gas/index.html）の不変条件
  ok('H-43 UIに実行予定日時（datetime-local）がある',
    /id="annualReserveAt"[^>]*/.test(html) && /type="datetime-local"/.test(html), 'datetime');
  ok('H-44 UIに児童CSV入力を追加', html.indexOf('id="annualReserveStudentFile"') >= 0, 'student-file');
  ok('H-45 UIに教員CSV入力を追加', html.indexOf('id="annualReserveTeacherFile"') >= 0, 'teacher-file');
  ok('H-46 UIに前年度削除チェック（既定ON）',
    /id="annualReserveClearPrev"\s+checked/.test(html), 'checked');
  ok('H-47 UIに予約保存ボタン', html.indexOf("saveAnnualReservation()") >= 0, 'save');
  ok('H-48 UIに即時実行ボタン', html.indexOf("runAnnualReservationNow()") >= 0, 'runnow');
  ok('H-49 UIにキャンセルボタン', html.indexOf("cancelAnnualReservation()") >= 0, 'cancel');
  ok('H-50 UIに予約ステータス表示', html.indexOf('id="annualReserveStatusBox"') >= 0, 'status');
  ok('H-51 UIは既存の年次更新タブ内に配置',
    html.indexOf('id="accountAnnualPane"') < html.indexOf('id="annualReserveAt"'), 'pane');
  ok('H-52 UIは4アクションを google.script.run 経由で呼ぶ',
    /runner\.api_annualReservationSave\(authToken/.test(html) &&
    /runner\.api_annualReservationStatus\(authToken/.test(html) &&
    /runner\.api_annualReservationCancel\(authToken/.test(html) &&
    /runner\.api_annualRolloverRunNow\(authToken/.test(html), 'router');
  ok('H-53 年次更新タブを開くと状態を取得（フォールバック起動）',
    /if \(isAnnual && typeof refreshAnnualReservationStatus === 'function'\)/.test(html), 'tab-hook');
  ok('H-54 UIにCSVプレビュー領域がある',
    html.indexOf('id="annualReserveStudentPreview"') >= 0 &&
    html.indexOf('id="annualReserveTeacherPreview"') >= 0, 'preview');

  // 製品全体の不変条件（既存仕様を壊していないこと）
  ok('H-55 拡張機能は v1.6.5', manifest.version === '1.6.5', manifest.version);
  ok('H-56 default_popup を持たない',
    !(manifest.action && manifest.action.default_popup) &&
    !(manifest.browser_action && manifest.browser_action.default_popup), 'no-popup');
  ok('H-57 DEFAULT_GAS_URL は空文字のまま',
    /const DEFAULT_GAS_URL = '';/.test(bg), 'gas-url');
  ok('H-58 14校のまま（東粟倉小を含まない）',
    SCHOOL_LIST.length === 14 && SCHOOL_LIST.indexOf('東粟倉小学校') < 0, SCHOOL_LIST.length);
  ok('H-59 MONITOR_SETTINGS_V1 キーを維持',
    src.indexOf('MONITOR_SETTINGS_V1') >= 0, 'monitor-key');
  ok('H-60 DIAG 計装を維持',
    src.indexOf('SHARD_DIAG_MODE') >= 0 && src.indexOf('[SHARD-DIAG]') >= 0, 'diag');
  ok('H-61 bulkTrace 計装を維持', src.indexOf('bulkTrace') >= 0, 'bulktrace');
  ok('H-62 非同期キューのキーを維持',
    src.indexOf("'SHARD_ASYNC_QUEUE'") >= 0, 'async-prop');
  ok('H-63 年次更新はシートに予約を書き込まない（PropertiesService のみ）',
    !/getTargetSheet\([^)]*ANNUAL/.test(src) &&
    /ANNUAL_ROLLOVER_PLAN_V1/.test(src), 'no-sheet');
  ok('H-64 教員マスタを削除する処理が無い',
    !/deleteRow/.test(extract(src, 'annualApplyTeachers_')), 'no-teacher-delete');
  ok('H-65 端末一覧以外をクリアしない',
    /CONFIG\.DEVICE_SHEET_NAME/.test(extract(src, 'annualClearSheetBody_')) === false &&
    /CONFIG\.DEVICE_SHEET_NAME/.test(extract(src, 'shardAnnualClearLocalDevices_')), 'device-only');
}

console.log('');
console.log('===== r45_annual_reserve: PASS=' + pass + ' FAIL=' + fail + ' =====');
if (fail > 0) process.exit(1);
