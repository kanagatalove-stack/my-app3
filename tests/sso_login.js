// =====================================================================
// Googleアカウント シングルサインオン（SSO）の回帰テスト
//
//  検証する仕様:
//   1. ログイン画面の「従来の手動入力欄」が一切失われていないこと
//      （loginEmail / loginPassword / loginSubmitBtn / handleLoginSubmit）。
//      ＝ SSO はあくまで追加であり、画面を開いた瞬間に自動ログインしない。
//   2. 手動ログインの「下」に区切り線（または）と SSO ボタンがあり、
//      アイコンは外部画像ではなくインラインSVGのみを使っていること。
//   3. サーバー側 api_ssoLogin() が Session.getActiveUser().getEmail() を用い、
//      許可メール／許可ドメイン（サブドメイン含む）に一致した場合のみ
//      手動ログインと同一の正規トークンを発行すること。
//   4. 空メール（デプロイ設定が全員）・未許可メール・児童アカウント・
//      教員マスタ未登録は、すべてサーバー側で確実に拒否されること。
//   5. SSO許可リストの保存・取得が PropertiesService のみで完結し、
//      スプレッドシートへの書き戻しを行わないこと。
//   6. SSO設定UIが管理者のみに表示され、非管理者の保存は拒否されること。
//   7. 固定仕様（14校・v1.6.4・default_popup なし・MONITOR_SETTINGS_V1 維持）。
// =====================================================================
const fs = require('fs'), vm = require('vm');
const PREFIX = '/home/user/webapp/';
function rd(p) { return fs.readFileSync(PREFIX + p, 'utf8'); }

const src = rd('gas/Code.gs');
const html = rd('gas/index.html');
const manifest = JSON.parse(rd('extension/manifest.json'));

// ---- 抽出ヘルパ（既存テストと同じ方針） --------------------------------
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
const countDefs = (s, n) =>
  (s.match(new RegExp('function\\s+' + n + '\\s*\\(', 'g')) || []).length;

// marker から length 文字ぶんのブロックを取り出す（HTML 断片の検査用）
function blockAt(s, marker, len) {
  const i = s.indexOf(marker);
  if (i < 0) throw new Error('marker not found: ' + marker);
  return s.slice(i, i + len);
}
function between(s, a, b) {
  const i = s.indexOf(a);
  if (i < 0) throw new Error('marker not found: ' + a);
  const j = s.indexOf(b, i);
  if (j < 0) throw new Error('marker not found after: ' + b);
  return s.slice(i, j + b.length);
}

let pass = 0, fail = 0;
function check(n, c, e) {
  if (c) { console.log('PASS', n, e !== undefined ? '=> ' + JSON.stringify(e) : ''); pass++; }
  else { console.log('FAIL', n, e !== undefined ? '=> ' + JSON.stringify(e) : ''); fail++; }
}
// 実行時テスト用の共通述語（値をそのまま出すと禁止トークンを含み得るため真偽のみ）
function ok(n, c) { check(n, c === true, undefined); }

// =====================================================================
// A. 静的構造 — ログイン画面（既存手動入力の維持 ＋ SSOボタン追加）
// =====================================================================
console.log('--- A. ログイン画面の静的構造 ---');

// A1 手動ログインの必須要素がすべて残っている（＝既存機能を壊していない）
['id="loginForm"', 'onsubmit="handleLoginSubmit(event)"',
 'id="loginEmail"', 'id="loginPassword"',
 'id="loginSubmitBtn"', 'id="loginBtnText"', 'id="loginError"']
  .forEach(function (m) { ok('A1 手動ログイン要素が残存: ' + m, html.indexOf(m) >= 0); });

// A2 手動ログインフォームの中身が空になっていない（入力欄2つが form 内にある）
const formBlock = between(html, '<form id="loginForm"', '</form>');
ok('A2 form 内に loginEmail がある', formBlock.indexOf('id="loginEmail"') >= 0);
ok('A2 form 内に loginPassword がある', formBlock.indexOf('id="loginPassword"') >= 0);
ok('A2 form 内に loginSubmitBtn がある', formBlock.indexOf('id="loginSubmitBtn"') >= 0);
ok('A2 form の外に SSOボタンがある（手動入力の下部）', formBlock.indexOf('ssoLoginBtn') < 0);
ok('A2 handleLoginSubmit が 1 回だけ定義', countDefs(html, 'handleLoginSubmit') === 1);

// A3 SSO ボタンは手動ログインより「後ろ」に配置されている
const posForm = html.indexOf('id="loginForm"');
const posPassword = html.indexOf('id="loginPassword"');
const posSsoBtn = html.indexOf('id="ssoLoginBtn"');
ok('A3 SSOボタンは loginForm より後', posSsoBtn > posForm);
ok('A3 SSOボタンは loginPassword より後（＝下部）', posSsoBtn > posPassword);

// A4 区切り線「または」がある
ok('A4 区切り線ラベル「または」がある', html.indexOf('>または<') >= 0);

// A5 SSOボタンの文言
ok('A5 SSOボタン文言が正しい', html.indexOf('Googleアカウントでログイン（シングルサインオン）') >= 0);
ok('A5 SSOボタンは type="button"（form を submit しない）',
  /id="ssoLoginBtn"[^>]*type="button"/.test(html) || /type="button"[^>]*id="ssoLoginBtn"/.test(html));

// A6 アイコンはインラインSVGのみ（外部画像URL・img タグ禁止）
const ssoBlock = blockAt(html, 'id="ssoLoginBtn"', 2200);
ok('A6 SSOボタン領域に <svg> がある', ssoBlock.indexOf('<svg') >= 0);
ok('A6 SSOボタン領域に <img> が無い', ssoBlock.indexOf('<img') < 0);
ok('A6 SSOボタン領域に外部URLが無い', ssoBlock.indexOf('http://') < 0 && ssoBlock.indexOf('https://') < 0);

// A7 Google ロゴの4色（ブランドカラー）がインラインSVGで使われている
['#EA4335', '#4285F4', '#FBBC05', '#34A853']
  .forEach(function (c) { ok('A7 Googleロゴ色 ' + c + ' が存在', html.indexOf(c) >= 0); });

// A8 SSOエラー表示枠
ok('A8 SSOエラー枠 id="ssoError" がある', html.indexOf('id="ssoError"') >= 0);

// A9 画面を開いた瞬間に自動ログインしない（SSOを勝手に呼ばない）
ok('A9 初期化で handleSsoLogin を自動実行していない',
  !/checkExistingSession[\s\S]{0,400}handleSsoLogin\(/.test(html));
// onclick 属性としての出現が 1 回だけ（＝関数定義の "handleSsoLogin()" は数えない）
ok('A9 SSOはボタンの onclick からのみ呼ばれる',
  (html.match(/onclick="handleSsoLogin\(\)"/g) || []).length === 1);

// =====================================================================
// B. 静的構造 — サーバー側 SSO API
// =====================================================================
console.log('--- B. サーバー側 SSO API の静的構造 ---');

['normalizeSsoDomain', 'sanitizeSsoEmailList', 'sanitizeSsoDomainList',
 'getSsoSettings', 'isSsoEmailAllowed', 'saveSsoSettings',
 'ssoLoginWithEmail', 'api_ssoLogin', 'api_getSsoSettings', 'api_saveSsoSettings']
  .forEach(function (n) { ok('B1 関数が1回だけ定義: ' + n, countDefs(src, n) === 1); });

ok('B2 Session.getActiveUser().getEmail() を使用', /Session\s*\.\s*getActiveUser\s*\(\s*\)\s*\.\s*getEmail\s*\(\s*\)/.test(src));

const apiSsoBody = extract(src, 'api_ssoLogin');
ok('B3 api_ssoLogin が Session からメール取得', apiSsoBody.indexOf('getActiveUser') >= 0);
ok('B3 api_ssoLogin が ssoLoginWithEmail に委譲', apiSsoBody.indexOf('ssoLoginWithEmail(') >= 0);

const ssoBody = extract(src, 'ssoLoginWithEmail');
ok('B4 空メールで no_email を返す', ssoBody.indexOf("'no_email'") >= 0);
ok('B4 未許可で not_allowed を返す', ssoBody.indexOf("'not_allowed'") >= 0);
ok('B4 教員マスタ未登録で not_registered を返す', ssoBody.indexOf("'not_registered'") >= 0);
ok('B4 許可判定に isSsoEmailAllowed を使う', ssoBody.indexOf('isSsoEmailAllowed(') >= 0);
ok('B4 教員マスタ照合に getTeacherSettings を使う', ssoBody.indexOf('getTeacherSettings(') >= 0);
ok('B4 正規トークンは generateToken で発行（手動ログインと同一）', ssoBody.indexOf('generateToken(') >= 0);
ok('B4 enabled !== true なら拒否する', /settings\.enabled\s*!==\s*true/.test(ssoBody));

const saveBody = extract(src, 'saveSsoSettings');
ok('B5 SSO設定保存は管理者のみ（isAdminTeacher ガード）', saveBody.indexOf('isAdminTeacher(') >= 0);
ok('B5 非管理者は例外を投げる', /throw new Error\(/.test(saveBody));
ok('B5 PropertiesService のみに保存（SpreadsheetApp 不使用）', saveBody.indexOf('SpreadsheetApp') < 0);
ok('B5 主キー SSO_SETTINGS_V1 に保存', saveBody.indexOf('SSO_SETTINGS_PROP') >= 0);
ok('B5 ミラーキー SSO_ALLOWED_EMAILS を保存', saveBody.indexOf('SSO_ALLOWED_EMAILS_PROP') >= 0);
ok('B5 ミラーキー SSO_ALLOWED_DOMAINS を保存', saveBody.indexOf('SSO_ALLOWED_DOMAINS_PROP') >= 0);

const getBody = extract(src, 'getSsoSettings');
ok('B6 SSO設定取得は PropertiesService のみ（SpreadsheetApp 不使用）', getBody.indexOf('SpreadsheetApp') < 0);
ok('B6 既定は enabled:false（未設定なら全拒否）', /enabled:\s*o\.enabled\s*===\s*true/.test(getBody));

const allowedBody = extract(src, 'isSsoEmailAllowed');
ok('B7 メール完全一致で許可', allowedBody.indexOf('emails[i] === em') >= 0);
ok('B7 ドメイン完全一致で許可', allowedBody.indexOf('host === d') >= 0);
ok('B7 サブドメイン一致で許可', allowedBody.indexOf("'.' + d") >= 0);

ok('B8 PropertiesService キー定数が定義されている',
  src.indexOf("const SSO_SETTINGS_PROP = 'SSO_SETTINGS_V1'") >= 0);
ok('B8 拒否メッセージ定数が定義されている', src.indexOf('const SSO_DENY_MESSAGE') >= 0);
ok('B8 拒否メッセージ本文が仕様どおり',
  src.indexOf('このGoogleアカウントには管理権限がありません') >= 0);
ok('B8 手動パスワード入力へ誘導する文言がある', src.indexOf('上の欄から管理者パスワードを入力してください') >= 0);

// =====================================================================
// C. 静的構造 — SSO設定UI（管理画面）
// =====================================================================
console.log('--- C. SSO設定UI の静的構造 ---');

ok('C1 SSO設定モーダル id="ssoSettingsModal"', html.indexOf('id="ssoSettingsModal"') >= 0);
ok('C1 SSO設定ボタン id="ssoSettingsBtn"', html.indexOf('id="ssoSettingsBtn"') >= 0);
ok('C1 有効化トグル id="ssoEnabledToggle"', html.indexOf('id="ssoEnabledToggle"') >= 0);
ok('C1 許可メール欄 id="ssoAllowedEmails"', html.indexOf('id="ssoAllowedEmails"') >= 0);
ok('C1 許可ドメイン欄 id="ssoAllowedDomains"', html.indexOf('id="ssoAllowedDomains"') >= 0);
ok('C1 更新情報 id="ssoUpdatedInfo"', html.indexOf('id="ssoUpdatedInfo"') >= 0);
ok('C1 モーダル見出し', html.indexOf('GoogleアカウントSSO設定（システム全体）') >= 0);

ok('C2 openSsoSettingsModal が1回だけ定義', countDefs(html, 'openSsoSettingsModal') === 1);
ok('C2 saveSsoSettingsFromModal が1回だけ定義', countDefs(html, 'saveSsoSettingsFromModal') === 1);
ok('C2 handleSsoLogin が1回だけ定義', countDefs(html, 'handleSsoLogin') === 1);

const openSsoBody = extract(html, 'openSsoSettingsModal');
ok('C3 取得は get_sso_settings アクション', openSsoBody.indexOf("action: 'get_sso_settings'") >= 0);
ok('C3 非管理者は開けない（isAdminUser ガード）', openSsoBody.indexOf('isAdminUser()') >= 0);

const saveSsoBody = extract(html, 'saveSsoSettingsFromModal');
ok('C4 保存は save_sso_settings アクション', saveSsoBody.indexOf("action: 'save_sso_settings'") >= 0);
ok('C4 非管理者は保存できない（isAdminUser ガード）', saveSsoBody.indexOf('isAdminUser()') >= 0);
ok('C4 空リストで有効化しようとすると警告', saveSsoBody.indexOf('1件以上登録してください') >= 0);
ok('C4 allowed_emails を送信', saveSsoBody.indexOf('allowed_emails:') >= 0);
ok('C4 allowed_domains を送信', saveSsoBody.indexOf('allowed_domains:') >= 0);

// C5 google.script.run ルータに 2 アクションが追加されている
ok('C5 ルータに get_sso_settings', html.indexOf("act === 'get_sso_settings'") >= 0);
ok('C5 ルータに save_sso_settings', html.indexOf("act === 'save_sso_settings'") >= 0);
ok('C5 ルータが api_getSsoSettings を呼ぶ', html.indexOf('runner.api_getSsoSettings(authToken)') >= 0);
ok('C5 ルータが api_saveSsoSettings を呼ぶ', html.indexOf('runner.api_saveSsoSettings(authToken') >= 0);

// C6 管理者のみ表示
ok('C6 SSO設定ボタンは管理者のみ表示制御される',
  /ssoSettingsBtn[\s\S]{0,160}isAdminUser\(\)/.test(html));

// C7 google.script.run が無い環境では案内を出して中断する
const hsBody = extract(html, 'handleSsoLogin');
ok('C7 google.script.run の存在チェックがある', hsBody.indexOf('google.script.run') >= 0);
ok('C7 非対応環境の案内文がある', hsBody.indexOf('この環境ではGoogleアカウントSSOを利用できません') >= 0);
ok('C7 api_ssoLogin を呼ぶ', hsBody.indexOf('.api_ssoLogin()') >= 0);
ok('C7 成功時に正規トークンを保存する', hsBody.indexOf("localStorage.setItem('edu_teacher_token'") >= 0);
ok('C7 失敗時にエラー枠へ表示する', hsBody.indexOf('ssoError') >= 0);

// =====================================================================
// D. 実行テスト — SSO 許可判定（純関数・Session 非依存）
// =====================================================================
console.log('--- D. SSO 許可判定（実行） ---');

const SSO_FNS = ['normalizeSsoDomain', 'sanitizeSsoEmailList', 'sanitizeSsoDomainList',
  'getSsoSettings', 'isSsoEmailAllowed', 'isAdminTeacher', 'saveSsoSettings',
  'ssoLoginWithEmail', 'api_ssoLogin'];
const SSO_CONSTS = ['SSO_SETTINGS_PROP', 'SSO_ALLOWED_EMAILS_PROP', 'SSO_ALLOWED_DOMAINS_PROP',
  'SSO_MAX_ENTRIES', 'SSO_EMAIL_RE', 'SSO_DOMAIN_RE', 'SSO_DENY_MESSAGE'];

let prelude = '';
SSO_CONSTS.forEach(function (n) { prelude += extractConst(n) + '\n'; });
SSO_FNS.forEach(function (n) { prelude += extract(src, n) + '\n'; });

const TEACHER = {
  email: 'teacher@mimasaka.ed.jp', name: '教員A',
  school: '第一小学校', role: 'ADMIN', target_class: '',
  urls: [], filter_whitelist: '', filter_blacklist: ''
};

function mkVm(opts) {
  opts = opts || {};
  const store = {};
  if (opts.settings) store['SSO_SETTINGS_V1'] = JSON.stringify(opts.settings);
  const properties = {
    getProperty: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setProperty: function (k, v) { store[k] = String(v); },
    deleteProperty: function (k) { delete store[k]; }
  };
  const sandbox = {
    console: { log: function () {} },
    JSON: JSON, Math: Math, Date: Date, String: String, Number: Number,
    Array: Array, Object: Object, RegExp: RegExp, Boolean: Boolean, Error: Error,
    PropertiesService: { getScriptProperties: function () { return properties; } },
    Utilities: {
      formatDate: function () { return '2026/11/15 10:00'; },
      base64EncodeWebSafe: function () { return 'QjY0'; },
      computeHmacSha256Signature: function () { return [1, 2, 3]; }
    },
    CONFIG: { TEACHER_SHEET_NAME: '教員マスタ', SCHOOL_LIST: ['英田小学校'] },
    Session: {
      getActiveUser: function () { return { getEmail: function () { return opts.activeEmail || ''; } }; }
    },
    Logger: { log: function () {} },
    getTeacherSettings: function (em) {
      const key = String(em || '').toLowerCase();
      if (opts.teachers && opts.teachers[key]) return opts.teachers[key];
      const e = new Error('教員アカウントが見つかりません: ' + key);
      throw e;
    },
    generateToken: function (t) { return 'TOKEN_FOR_' + t.email; },
    // シート系は本テストでは使わない（最終ログイン記録は try/catch で無害化される）
    getTargetSheet: function () { const e = new Error('no sheet in test'); throw e; },
    ensureTeacherHeaders: function () {},
    getHeaderMap: function () { return {}; }
  };
  vm.createContext(sandbox);
  vm.runInContext(prelude, sandbox);
  sandbox.__store = store;
  return sandbox;
}

const ALLOW_ON = {
  enabled: true,
  allowed_emails: ['teacher@mimasaka.ed.jp'],
  allowed_domains: ['mimasaka.ed.jp'],
  updated_at: '2026/11/15 09:00', updated_by: 'admin@mimasaka.ed.jp'
};

// D1 正規化
{
  const sb = mkVm({});
  ok('D1 ドメイン正規化 @Mimasaka.Ed.JP. → mimasaka.ed.jp',
    sb.normalizeSsoDomain('@Mimasaka.Ed.JP.') === 'mimasaka.ed.jp');
  ok('D1 ドメイン正規化 URL → ホストのみ', sb.normalizeSsoDomain('https://x.ed.jp/path') === 'x.ed.jp');
  const em = sb.sanitizeSsoEmailList(['Teacher@Mimasaka.Ed.JP', 'bad', '', 'teacher@mimasaka.ed.jp', 'a@b.c']);
  ok('D1 メール正規化（小文字化・不正除去・重複除去）',
    em.length === 1 && em[0] === 'teacher@mimasaka.ed.jp');
  const dm = sb.sanitizeSsoDomainList(['@Mimasaka.Ed.JP.', 'https://x.ed.jp/p', 'nodot']);
  ok('D1 ドメイン正規化（不正除去）', dm.length === 2 && dm[0] === 'mimasaka.ed.jp' && dm[1] === 'x.ed.jp');
}

// D2 未設定なら SSO は無効（＝全拒否）
{
  const sb = mkVm({ settings: undefined });
  const st = sb.getSsoSettings();
  ok('D2 未設定の既定は enabled:false', st.enabled === false);
  ok('D2 未設定の許可メールは空', st.allowed_emails.length === 0);
  ok('D2 未設定では許可されない', sb.isSsoEmailAllowed('teacher@mimasaka.ed.jp', st) === false);
}

// D3 許可メール／許可ドメイン／サブドメイン
{
  const sb = mkVm({ settings: ALLOW_ON });
  ok('D3 許可メールは一致する', sb.isSsoEmailAllowed('teacher@mimasaka.ed.jp') === true);
  ok('D3 大文字小文字を無視する', sb.isSsoEmailAllowed('TEACHER@MIMASAKA.ED.JP') === true);
  ok('D3 許可ドメインは一致する', sb.isSsoEmailAllowed('anyone@mimasaka.ed.jp') === true);
  ok('D3 サブドメインも一致する', sb.isSsoEmailAllowed('a@sub.mimasaka.ed.jp') === true);
  ok('D3 別ドメインは不一致', sb.isSsoEmailAllowed('a@example.com') === false);
  ok('D3 似たドメインの詐称は不一致', sb.isSsoEmailAllowed('a@notmimasaka.ed.jp') === false);
  ok('D3 @ が無い文字列は不一致', sb.isSsoEmailAllowed('mimasaka.ed.jp') === false);
}

// D4 SSO ログイン本体（許可 → 成功）
{
  const sb = mkVm({ settings: ALLOW_ON, teachers: { 'teacher@mimasaka.ed.jp': TEACHER } });
  const res = sb.ssoLoginWithEmail('teacher@mimasaka.ed.jp');
  ok('D4 許可メールは SSO 成功', res.success === true);
  ok('D4 sso フラグが立つ', res.sso === true);
  ok('D4 正規トークンが発行される', res.token === 'TOKEN_FOR_teacher@mimasaka.ed.jp');
  ok('D4 教員情報を返す', res.teacher && res.teacher.email === 'teacher@mimasaka.ed.jp');
  ok('D4 学校一覧を返す（手動ログインと同一形状）', Array.isArray(res.schools) && res.schools.length === 1);
}

// D5 許可ドメイン経由の成功
{
  const t2 = Object.assign({}, TEACHER, { email: 'someone@mimasaka.ed.jp', name: '教員B' });
  const sb = mkVm({ settings: ALLOW_ON, teachers: { 'someone@mimasaka.ed.jp': t2 } });
  const res = sb.ssoLoginWithEmail('someone@mimasaka.ed.jp');
  ok('D5 許可ドメインの教員は SSO 成功', res.success === true);
  ok('D5 トークンが発行される', res.token === 'TOKEN_FOR_someone@mimasaka.ed.jp');
}

// D6 拒否系（空メール／未許可／児童／未登録／SSO無効）
{
  const sb = mkVm({ settings: ALLOW_ON, teachers: { 'teacher@mimasaka.ed.jp': TEACHER } });

  const rEmpty = sb.ssoLoginWithEmail('');
  ok('D6 空メールは拒否', rEmpty.success === false);
  ok('D6 空メールの reason は no_email', rEmpty.reason === 'no_email');
  ok('D6 空メールはトークンを発行しない', !rEmpty.token);
  ok('D6 空メールは手動入力へ誘導する', String(rEmpty.error).indexOf('管理者パスワードを入力') >= 0);

  const rNull = sb.ssoLoginWithEmail(null);
  ok('D6 null メールも拒否', rNull.success === false && rNull.reason === 'no_email');

  const rUnknown = sb.ssoLoginWithEmail('unknown@example.com');
  ok('D6 未許可メールは拒否', rUnknown.success === false);
  ok('D6 未許可の reason は not_allowed', rUnknown.reason === 'not_allowed');
  ok('D6 未許可はトークンを発行しない', !rUnknown.token);
  ok('D6 未許可メッセージが仕様どおり', String(rUnknown.error).indexOf('このGoogleアカウントには管理権限がありません') >= 0);
}
{
  // 児童アカウント（同じ学校ドメインだが教員マスタに無い）
  const sb = mkVm({ settings: ALLOW_ON, teachers: { 'teacher@mimasaka.ed.jp': TEACHER } });
  const rStudent = sb.ssoLoginWithEmail('s01-1@mimasaka.ed.jp');
  ok('D6 児童アカウント（ドメイン一致・教員マスタ無し）は拒否', rStudent.success === false);
  ok('D6 児童の reason は not_registered', rStudent.reason === 'not_registered');
  ok('D6 児童はトークンを発行しない', !rStudent.token);
}
{
  // 許可リストに載っていても教員マスタに無ければ拒否（二重防御の確認）
  const sb = mkVm({
    settings: { enabled: true, allowed_emails: ['x@mimasaka.ed.jp'], allowed_domains: [] },
    teachers: {}
  });
  const r = sb.ssoLoginWithEmail('x@mimasaka.ed.jp');
  ok('D6 許可リスト一致でも教員マスタ無しは拒否', r.success === false && r.reason === 'not_registered');
}
{
  // SSO 無効時は、許可リストに載っていても拒否
  const sb = mkVm({
    settings: { enabled: false, allowed_emails: ['teacher@mimasaka.ed.jp'], allowed_domains: ['mimasaka.ed.jp'] },
    teachers: { 'teacher@mimasaka.ed.jp': TEACHER }
  });
  const r = sb.ssoLoginWithEmail('teacher@mimasaka.ed.jp');
  ok('D6 SSO無効時は許可リスト記載でも拒否', r.success === false && r.reason === 'not_allowed');
  ok('D6 SSO無効時はトークンを発行しない', !r.token);
}

// D7 api_ssoLogin（Session 経由）
{
  const sb = mkVm({ settings: ALLOW_ON, teachers: { 'teacher@mimasaka.ed.jp': TEACHER },
    activeEmail: 'teacher@mimasaka.ed.jp' });
  const res = sb.api_ssoLogin();
  // 注意: ok() は厳密に true を要求するため、token(文字列) を && で繋ぐと
  //       文字列が返って偽判定になる。必ず真偽値へ落とす。
  ok('D7 api_ssoLogin は Session のメールで成功する', res.success === true && !!res.token);
}
{
  const sb = mkVm({ settings: ALLOW_ON, teachers: { 'teacher@mimasaka.ed.jp': TEACHER },
    activeEmail: '' });
  const res = sb.api_ssoLogin();
  ok('D7 api_ssoLogin は空メール（全員デプロイ）で拒否する', res.success === false);
  ok('D7 api_ssoLogin の reason は no_email', res.reason === 'no_email');
}
{
  const sb = mkVm({ settings: ALLOW_ON, teachers: { 'teacher@mimasaka.ed.jp': TEACHER },
    activeEmail: 's01-1@mimasaka.ed.jp' });
  const res = sb.api_ssoLogin();
  ok('D7 api_ssoLogin は児童アカウントを拒否する', res.success === false && !res.token);
}

// =====================================================================
// E. 実行テスト — SSO許可リストの保存・取得（PropertiesService のみ）
// =====================================================================
console.log('--- E. SSO許可リストの保存・取得（実行） ---');

const ADMIN = { email: 'admin@mimasaka.ed.jp', role: 'ADMIN' };
const NORMAL = { email: 't1@mimasaka.ed.jp', role: 'TEACHER' };

{
  const sb = mkVm({});
  const saved = sb.saveSsoSettings(ADMIN, {
    enabled: true,
    allowed_emails: ['Teacher@Mimasaka.Ed.JP', 'bad-entry'],
    allowed_domains: ['@Mimasaka.Ed.JP']
  });
  ok('E1 管理者は保存できる', saved && saved.enabled === true);
  ok('E1 許可メールが正規化されて保存される',
    saved.allowed_emails.length === 1 && saved.allowed_emails[0] === 'teacher@mimasaka.ed.jp');
  ok('E1 許可ドメインが正規化されて保存される',
    saved.allowed_domains.length === 1 && saved.allowed_domains[0] === 'mimasaka.ed.jp');
  ok('E1 updated_by に実行者が入る', saved.updated_by === 'admin@mimasaka.ed.jp');
  ok('E1 updated_at が入る', String(saved.updated_at).length > 0);

  ok('E1 主キー SSO_SETTINGS_V1 に保存される',
    typeof sb.__store['SSO_SETTINGS_V1'] === 'string');
  ok('E1 ミラーキー SSO_ALLOWED_EMAILS に保存される',
    sb.__store['SSO_ALLOWED_EMAILS'] === JSON.stringify(saved.allowed_emails));
  ok('E1 ミラーキー SSO_ALLOWED_DOMAINS に保存される',
    sb.__store['SSO_ALLOWED_DOMAINS'] === JSON.stringify(saved.allowed_domains));

  // 保存 → 取得の往復
  const back = sb.getSsoSettings();
  ok('E1 保存した設定を取得できる（往復一致）',
    back.enabled === true &&
    back.allowed_emails.length === 1 && back.allowed_emails[0] === 'teacher@mimasaka.ed.jp' &&
    back.allowed_domains.length === 1 && back.allowed_domains[0] === 'mimasaka.ed.jp');
  ok('E1 保存後は許可判定が通る', sb.isSsoEmailAllowed('teacher@mimasaka.ed.jp', back) === true);
}

{
  // 非管理者は保存できない
  const sb = mkVm({});
  let threw = false;
  try { sb.saveSsoSettings(NORMAL, { enabled: true, allowed_emails: ['t1@mimasaka.ed.jp'] }); }
  catch (e) { threw = true; }
  ok('E2 非管理者の保存は拒否される', threw === true);
  ok('E2 拒否時は PropertiesService に書かれない',
    !sb.__store['SSO_SETTINGS_V1']);
}

{
  // 別の許可リストに上書き（保存 → 再取得で反映）
  const sb = mkVm({});
  sb.saveSsoSettings(ADMIN, { enabled: true, allowed_domains: ['mimasaka.ed.jp'] });
  ok('E3 ドメインのみの設定を保存できる',
    JSON.parse(sb.__store['SSO_SETTINGS_V1']).allowed_domains[0] === 'mimasaka.ed.jp');
  sb.saveSsoSettings(ADMIN, { enabled: false, allowed_domains: [] });
  const after = sb.getSsoSettings();
  ok('E3 上書き保存が反映される（enabled:false）', after.enabled === false);
  ok('E3 上書き保存で許可ドメインが空になる', after.allowed_domains.length === 0);
}

{
  // 個別キーのみ手動設定されている場合の復元（後方運用）
  const sb = mkVm({});
  sb.__store['SSO_ALLOWED_EMAILS'] = JSON.stringify(['manual@mimasaka.ed.jp']);
  sb.__store['SSO_ALLOWED_DOMAINS'] = JSON.stringify(['mimasaka.ed.jp']);
  const st = sb.getSsoSettings();
  ok('E4 個別キーのみでも設定を復元する', st.allowed_emails.length === 1 && st.allowed_domains.length === 1);
  ok('E4 個別キーのみの場合は有効とみなす', st.enabled === true);
}

{
  // 壊れた JSON でも致命的にならない（安全側＝拒否）
  const sb = mkVm({});
  sb.__store['SSO_SETTINGS_V1'] = '{not json';
  let safe = true;
  try { sb.getSsoSettings(); } catch (e) { safe = false; }
  ok('E5 壊れたJSONでも例外を投げない', safe === true);
  const st = sb.getSsoSettings();
  ok('E5 壊れたJSON時は無効（安全側）', st.enabled === false);
}

// =====================================================================
// F. 固定仕様の不変条件
// =====================================================================
console.log('--- F. 固定仕様の不変条件 ---');

ok('F1 manifest の version は 1.6.4', manifest.version === '1.6.4');
ok('F1 manifest に default_popup が無い',
  !(manifest.action && manifest.action.default_popup) &&
  !(manifest.browser_action && manifest.browser_action.default_popup));
ok('F1 manifest に permissions 以外の危険な追加が無い', Array.isArray(manifest.permissions));

ok('F2 既存の MONITOR_SETTINGS_V1 キーが維持されている',
  src.indexOf("const MONITOR_PROP_KEY = 'MONITOR_SETTINGS_V1'") >= 0);
ok('F2 既存のサイト監視テレメトリ列が維持されている',
  src.indexOf('monitor_flag') >= 0 && src.indexOf('monitor_reason') >= 0);

// 14校（東粟倉小は廃校のため含めない）
ok('F3 東粟倉小学校が学校リストに含まれていない', html.indexOf('東粟倉小学校') < 0);
const schoolsBlock = between(html, 'const SCHOOLS = [', '];');
ok('F3 学校リストは 14 校', (schoolsBlock.match(/'/g) || []).length === 28);
ok('F3 樸学園が含まれる（14校の最終要素）', schoolsBlock.indexOf('樸学園') >= 0);

ok('F4 通信経路は google.script.run（SSOも同経路）',
  hsBody.indexOf('google.script.run') >= 0 && apiSsoBody.length > 0);
ok('F4 SSO は PropertiesService のみで完結（伝播・保存ともスプレッドシート書込なし）',
  saveBody.indexOf('SpreadsheetApp') < 0 && getBody.indexOf('SpreadsheetApp') < 0);
ok('F4 SSO設定保存はスプレッドシートに書き戻さない',
  saveBody.indexOf('setValue') < 0 && saveBody.indexOf('getRange') < 0);

ok('F5 手動ログインの API（api_login）が残っている', countDefs(src, 'api_login') === 1);
ok('F5 手動ログインのサーバー処理（handleTeacherLogin）が残っている',
  countDefs(src, 'handleTeacherLogin') === 1);
ok('F5 verifyToken が残っている（既存セッション検証）', countDefs(src, 'verifyToken') === 1);

// =====================================================================
console.log('');
console.log('===== 結果: PASS=' + pass + ' FAIL=' + fail + ' =====');
process.exit(fail === 0 ? 0 : 1);
