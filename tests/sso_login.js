// =====================================================================
// Googleアカウント シングルサインオン（SSO）の回帰テスト 【Request K 改訂版】
//
//  Request K で確定した仕様:
//   SSOの可否は「教員マスタ（アカウント管理）」だけで完結する（二重管理しない）。
//     ① Session.getActiveUser().getEmail() でメールアドレスが取れる
//     ② そのメールが教員マスタに登録済み
//     ③ その行の「Google SSO許可」列が有効（空欄＝既定ON）
//   3点すべてで、手動ログインと同一の正規トークン（generateToken）を発行する。
//
//   旧仕様の独立SSO設定（SSO_SETTINGS_V1 / SSO_ALLOWED_EMAILS / SSO_ALLOWED_DOMAINS
//   による許可リスト・ドメイン一括許可）は全廃。既存プロパティは一切参照しない。
// =====================================================================
const fs = require('fs'), vm = require('vm');
const PREFIX = '/home/user/webapp/';
function rd(p) { return fs.readFileSync(PREFIX + p, 'utf8'); }

const src = rd('gas/Code.gs');
const html = rd('gas/index.html');
const manifest = JSON.parse(rd('extension/manifest.json'));
const docs = rd('docs/ADMIN_CONSOLE_SETUP.md');

// ---- 抽出ヘルパ ------------------------------------------------------
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
// CONFIG の配列プロパティ（TEACHER_COLUMNS 等）を取り出す
function extractConfigArray(name) {
  const re = new RegExp('^[ \\t]*' + name + '\\s*:\\s*\\[', 'm');
  const st = src.search(re);
  if (st < 0) throw new Error('config array not found: ' + name);
  const i = src.indexOf('[', st);
  let d = 0, end = -1;
  for (let k = i; k < src.length; k++) {
    if (src[k] === '[') d++;
    else if (src[k] === ']') { d--; if (d === 0) { end = k; break; } }
  }
  if (end < 0) throw new Error('unbalanced config array: ' + name);
  return src.slice(i, end + 1);
}
const countDefs = (s, n) =>
  (s.match(new RegExp('function\\s+' + n + '\\s*\\(', 'g')) || []).length;

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

const TEACHER_COLUMNS_SRC = extractConfigArray('TEACHER_COLUMNS');

// ---- 疑似シート（addTeacher / updateTeacherRecord / ensureTeacherHeaders 用） ----
function mkSheet(rows) {
  const data = rows.map(function (r) { return r.slice(); });
  function pad(r, n) { while (r.length < n) r.push(''); return r; }
  function width() { return data[0].length; }
  return {
    _data: data,
    getLastColumn: function () { return data[0].length; },
    getLastRow: function () { return data.length; },
    getDataRange: function () {
      return { getValues: function () {
        return data.map(function (r) { return pad(r.slice(), width()); });
      } };
    },
    appendRow: function (r) { data.push(pad(r.slice(), width())); },
    getRange: function (row, col, nr, nc) {
      const self = this;
      if (nr === undefined) {
        return {
          setValue: function (v) {
            while (data.length < row) data.push([]);
            const r = pad(data[row - 1], col);
            r[col - 1] = v;
            data[row - 1] = r;
            return this;
          },
          setBackground: function () { return this; },
          setFontColor: function () { return this; },
          setFontWeight: function () { return this; },
          getValues: function () {
            const r = data[row - 1] || [];
            return [[r[col - 1] === undefined ? '' : r[col - 1]]];
          }
        };
      }
      return {
        getValues: function () {
          const out = [];
          for (let i = 0; i < nr; i++) {
            const r = data[row - 1 + i] || [];
            const line = [];
            for (let j = 0; j < nc; j++) {
              const v = r[col - 1 + j];
              line.push(v === undefined ? '' : v);
            }
            out.push(line);
          }
          return out;
        },
        setValue: function () { return this; },
        setValues: function () { return this; },
        setBackground: function () { return this; },
        setFontColor: function () { return this; },
        setFontWeight: function () { return this; }
      };
    }
  };
}

// =====================================================================
// A. ログイン画面 — 手動入力の維持 ＋ SSOボタン
// =====================================================================
console.log('--- A. ログイン画面の静的構造 ---');

ok('A1 loginForm が存在する', html.indexOf('<form id="loginForm"') >= 0);
const formBlock = between(html, '<form id="loginForm"', '</form>');
ok('A2 form 内に loginEmail がある', formBlock.indexOf('id="loginEmail"') >= 0);
ok('A2 form 内に loginPassword がある', formBlock.indexOf('id="loginPassword"') >= 0);
ok('A2 form 内に loginSubmitBtn がある', formBlock.indexOf('id="loginSubmitBtn"') >= 0);
ok('A2 form の外に SSOボタンがある（手動入力の下部）', formBlock.indexOf('ssoLoginBtn') < 0);
ok('A2 handleLoginSubmit が 1 回だけ定義', countDefs(html, 'handleLoginSubmit') === 1);

const posForm = html.indexOf('id="loginForm"');
const posPassword = html.indexOf('id="loginPassword"');
const posSsoBtn = html.indexOf('id="ssoLoginBtn"');
ok('A3 SSOボタンは loginForm より後', posSsoBtn > posForm);
ok('A3 SSOボタンは loginPassword より後（＝下部）', posSsoBtn > posPassword);

ok('A4 区切り線ラベル「または」がある', html.indexOf('>または<') >= 0);
ok('A5 SSOボタン文言が正しい', html.indexOf('Googleアカウントでログイン（シングルサインオン）') >= 0);
ok('A5 SSOボタンは type="button"（form を submit しない）',
  /id="ssoLoginBtn"[^>]*type="button"/.test(html) || /type="button"[^>]*id="ssoLoginBtn"/.test(html));

const ssoBlock = blockAt(html, 'id="ssoLoginBtn"', 2600);
ok('A6 SSOボタン領域に <svg> がある', ssoBlock.indexOf('<svg') >= 0);
ok('A6 SSOボタン領域に <img> が無い', ssoBlock.indexOf('<img') < 0);
ok('A6 SSOボタン領域に外部URLが無い', ssoBlock.indexOf('http://') < 0 && ssoBlock.indexOf('https://') < 0);
ok('A7 Google 4色のインラインSVGパスが揃っている',
  ssoBlock.indexOf('#EA4335') >= 0 && ssoBlock.indexOf('#4285F4') >= 0 &&
  ssoBlock.indexOf('#FBBC05') >= 0 && ssoBlock.indexOf('#34A853') >= 0);

ok('A8 SSOエラー枠 id="ssoError" がある', html.indexOf('id="ssoError"') >= 0);
ok('A9 初期化で handleSsoLogin を自動実行していない',
  !/window\.onload[\s\S]{0,400}handleSsoLogin\s*\(/.test(html) &&
  !/DOMContentLoaded[\s\S]{0,400}handleSsoLogin\s*\(/.test(html));
ok('A9 SSOはボタンの onclick からのみ呼ばれる',
  html.indexOf('onclick="handleSsoLogin()"') >= 0 && countDefs(html, 'handleSsoLogin') === 1);

const hsBody = extract(html, 'handleSsoLogin');
ok('A10 google.script.run の存在チェックがある', hsBody.indexOf('google.script.run') >= 0);
ok('A10 非対応環境の案内文がある', hsBody.indexOf('この環境ではGoogleアカウントSSOを利用できません') >= 0);
ok('A10 api_ssoLogin を呼ぶ', hsBody.indexOf('.api_ssoLogin()') >= 0);
ok('A10 成功時に正規トークンを保存する', hsBody.indexOf("localStorage.setItem('edu_teacher_token'") >= 0);
ok('A10 失敗時にエラー枠へ表示する', hsBody.indexOf('ssoError') >= 0);

// =====================================================================
// B. サーバー側 — SSOは教員マスタのみで判定（旧許可リストは全廃）
// =====================================================================
console.log('--- B. サーバー側 SSO API の構造 ---');

ok('B1 parseSsoAllowedFlag が 1 回だけ定義', countDefs(src, 'parseSsoAllowedFlag') === 1);
ok('B1 api_ssoLogin が 1 回だけ定義', countDefs(src, 'api_ssoLogin') === 1);
ok('B1 ssoLoginWithEmail が 1 回だけ定義', countDefs(src, 'ssoLoginWithEmail') === 1);
ok('B2 Session.getActiveUser().getEmail() を使用',
  /Session\s*\.\s*getActiveUser\s*\(\s*\)\s*\.\s*getEmail\s*\(\s*\)/.test(src));

const apiSsoBody = extract(src, 'api_ssoLogin');
ok('B3 api_ssoLogin が Session からメール取得', apiSsoBody.indexOf('getActiveUser') >= 0);
ok('B3 api_ssoLogin が ssoLoginWithEmail に委譲', apiSsoBody.indexOf('ssoLoginWithEmail(') >= 0);

const ssoBody = extract(src, 'ssoLoginWithEmail');
ok('B4 空メールで no_email を返す', ssoBody.indexOf("'no_email'") >= 0);
ok('B4 教員マスタ未登録で not_registered を返す', ssoBody.indexOf("'not_registered'") >= 0);
ok('B4 SSO不許可で sso_disabled を返す', ssoBody.indexOf("'sso_disabled'") >= 0);
ok('B4 教員マスタ照合に getTeacherSettings を使う', ssoBody.indexOf('getTeacherSettings(') >= 0);
ok('B4 可否判定に parseSsoAllowedFlag を使う', ssoBody.indexOf('parseSsoAllowedFlag(') >= 0);
ok('B4 正規トークンは generateToken で発行（手動ログインと同一）', ssoBody.indexOf('generateToken(') >= 0);
ok('B4 旧・許可リスト判定 isSsoEmailAllowed を使っていない', ssoBody.indexOf('isSsoEmailAllowed(') < 0);

// --- 旧SSO設定APIが完全に消えていること ---
const GONE_FNS = ['getSsoSettings', 'saveSsoSettings', 'isSsoEmailAllowed',
  'sanitizeSsoEmailList', 'sanitizeSsoDomainList', 'normalizeSsoDomain',
  'api_getSsoSettings', 'api_saveSsoSettings'];
GONE_FNS.forEach(function (n) {
  ok('B5 旧関数 ' + n + ' が削除されている', countDefs(src, n) === 0);
});
const GONE_CONSTS = ['SSO_SETTINGS_PROP', 'SSO_ALLOWED_EMAILS_PROP',
  'SSO_ALLOWED_DOMAINS_PROP', 'SSO_MAX_ENTRIES', 'SSO_EMAIL_RE', 'SSO_DOMAIN_RE'];
GONE_CONSTS.forEach(function (n) {
  ok('B5 旧定数 ' + n + ' が削除されている', src.indexOf(n) < 0);
});
// 文字列リテラルとしての旧プロパティキーが一切無いこと（コメント内の言及は許容）
ok('B6 SSO_SETTINGS_V1 を文字列として参照していない', !/['"]SSO_SETTINGS_V1['"]/.test(src));
ok('B6 SSO_ALLOWED_EMAILS を文字列として参照していない', !/['"]SSO_ALLOWED_EMAILS['"]/.test(src));
ok('B6 SSO_ALLOWED_DOMAINS を文字列として参照していない', !/['"]SSO_ALLOWED_DOMAINS['"]/.test(src));
ok('B6 getScriptProperties で SSO 系キーを読んでいない',
  !/getScriptProperties\(\)\s*\.\s*getProperty\(\s*['"]SSO/.test(src));

ok('B7 拒否メッセージ定数 SSO_DENY_MESSAGE がある', src.indexOf('const SSO_DENY_MESSAGE') >= 0);
ok('B7 メール未取得メッセージ定数 SSO_NO_EMAIL_MESSAGE がある', src.indexOf('const SSO_NO_EMAIL_MESSAGE') >= 0);
ok('B7 拒否メッセージ本文が仕様どおり',
  src.indexOf('このGoogleアカウントには管理権限がありません') >= 0);
ok('B7 手動パスワード入力へ誘導する文言がある',
  src.indexOf('上の欄から管理者パスワードを入力してください') >= 0);

// --- 11列化 ---
ok('B8 TEACHER_COLUMNS は 11 列',
  (TEACHER_COLUMNS_SRC.match(/'/g) || []).length === 22 && (TEACHER_COLUMNS_SRC.match(/'/g) || []).length === 22);
ok('B8 11列目が「Google SSO許可」', /['"]Google SSO許可['"]\s*\]/.test(TEACHER_COLUMNS_SRC.replace(/\s+$/, '')));
ok('B8 既存1列目は教員ID(メールアドレス)',
  TEACHER_COLUMNS_SRC.indexOf("'教員ID(メールアドレス)'") >= 0);
ok('B8 既存10列目は最終ログイン日時', TEACHER_COLUMNS_SRC.indexOf("'最終ログイン日時'") >= 0);
ok('B8 Google SSO許可は最終ログイン日時より後',
  TEACHER_COLUMNS_SRC.indexOf("'Google SSO許可'") > TEACHER_COLUMNS_SRC.indexOf("'最終ログイン日時'"));

// --- 教員CRUDが10項目を受け付ける ---
const addBody = extract(src, 'addTeacher');
ok('B9 addTeacher が sso_allowed を受け取る', addBody.indexOf('sso_allowed') >= 0);
ok('B9 addTeacher が 登録URL情報 を書き込む', addBody.indexOf("headerMap['登録URL情報']") >= 0);
ok('B9 addTeacher が 個別ホワイトリスト を書き込む', addBody.indexOf("headerMap['個別ホワイトリスト']") >= 0);
ok('B9 addTeacher が 個別ブラックリスト を書き込む', addBody.indexOf("headerMap['個別ブラックリスト']") >= 0);
ok('B9 addTeacher が Google SSO許可 を書き込む', addBody.indexOf("headerMap['Google SSO許可']") >= 0);
ok('B9 SSO許可ONならパスワード空欄を許容する', /!\s*password\s*&&\s*!\s*ssoAllowed/.test(addBody));

const updBody = extract(src, 'updateTeacherRecord');
ok('B10 updateTeacherRecord が 登録URL情報 を更新する', updBody.indexOf("headerMap['登録URL情報']") >= 0);
ok('B10 updateTeacherRecord が 個別ホワイトリスト を更新する', updBody.indexOf("headerMap['個別ホワイトリスト']") >= 0);
ok('B10 updateTeacherRecord が 個別ブラックリスト を更新する', updBody.indexOf("headerMap['個別ブラックリスト']") >= 0);
ok('B10 updateTeacherRecord が Google SSO許可 を更新する', updBody.indexOf("headerMap['Google SSO許可']") >= 0);

const getAllBody = extract(src, 'getAllTeachers');
ok('B11 getAllTeachers が sso_allowed を返す', getAllBody.indexOf('sso_allowed:') >= 0);
ok('B11 getAllTeachers が urls を返す', getAllBody.indexOf('urls:') >= 0);
ok('B11 getAllTeachers が filter_whitelist を返す', getAllBody.indexOf('filter_whitelist:') >= 0);
ok('B11 getAllTeachers が filter_blacklist を返す', getAllBody.indexOf('filter_blacklist:') >= 0);
const gtsBody = extract(src, 'getTeacherSettings');
ok('B11 getTeacherSettings が sso_allowed を返す', gtsBody.indexOf('sso_allowed:') >= 0);
const htlBody = extract(src, 'handleTeacherLogin');
ok('B11 handleTeacherLogin が sso_allowed を返す', htlBody.indexOf('sso_allowed:') >= 0);

// =====================================================================
// C. 管理画面 — 独立SSO設定UIの全廃 ＆ 教員フォーム10項目
// =====================================================================
console.log('--- C. アカウント管理UIの静的構造 ---');

ok('C1 旧SSO設定モーダル id="ssoSettingsModal" が無い', html.indexOf('id="ssoSettingsModal"') < 0);
ok('C1 旧SSO設定ボタン id="ssoSettingsBtn" が無い', html.indexOf('id="ssoSettingsBtn"') < 0);
ok('C1 旧有効化トグル id="ssoEnabledToggle" が無い', html.indexOf('id="ssoEnabledToggle"') < 0);
ok('C1 旧許可メール欄 id="ssoAllowedEmails" が無い', html.indexOf('id="ssoAllowedEmails"') < 0);
ok('C1 旧許可ドメイン欄 id="ssoAllowedDomains" が無い', html.indexOf('id="ssoAllowedDomains"') < 0);
ok('C1 旧更新情報 id="ssoUpdatedInfo" が無い', html.indexOf('id="ssoUpdatedInfo"') < 0);
ok('C1 旧見出し「GoogleアカウントSSO設定（システム全体）」が無い',
  html.indexOf('GoogleアカウントSSO設定（システム全体）') < 0);

ok('C2 openSsoSettingsModal が削除されている', countDefs(html, 'openSsoSettingsModal') === 0);
ok('C2 saveSsoSettingsFromModal が削除されている', countDefs(html, 'saveSsoSettingsFromModal') === 0);
ok('C3 ルータに get_sso_settings が無い', html.indexOf("act === 'get_sso_settings'") < 0);
ok('C3 ルータに save_sso_settings が無い', html.indexOf("act === 'save_sso_settings'") < 0);
ok('C3 ルータが api_getSsoSettings を呼ばない', html.indexOf('api_getSsoSettings') < 0);
ok('C3 ルータが api_saveSsoSettings を呼ばない', html.indexOf('api_saveSsoSettings') < 0);

// --- 教員フォーム：10項目 ---
ok('C4 教員ID newTeacherEmail', html.indexOf('id="newTeacherEmail"') >= 0);
ok('C4 Google SSO許可 newTeacherSsoAllowed', html.indexOf('id="newTeacherSsoAllowed"') >= 0);
ok('C4 パスワード newTeacherPassword', html.indexOf('id="newTeacherPassword"') >= 0);
ok('C4 氏名 newTeacherName', html.indexOf('id="newTeacherName"') >= 0);
ok('C4 所属学校 newTeacherSchool', html.indexOf('id="newTeacherSchool"') >= 0);
ok('C4 権限 newTeacherRole', html.indexOf('id="newTeacherRole"') >= 0);
ok('C4 対象クラス newTeacherClass', html.indexOf('id="newTeacherClass"') >= 0);
ok('C4 登録URL情報 newTeacherUrls', html.indexOf('id="newTeacherUrls"') >= 0);
ok('C4 個別ホワイトリスト newTeacherWhitelist', html.indexOf('id="newTeacherWhitelist"') >= 0);
ok('C4 個別ブラックリスト newTeacherBlacklist', html.indexOf('id="newTeacherBlacklist"') >= 0);
ok('C5 SSO許可トグルは既定ON（checked）', /id="newTeacherSsoAllowed"[^>]*checked/.test(html));
ok('C5 パスワードは任意と明示', html.indexOf('パスワード（任意）') >= 0);
ok('C5 権限は ADMIN / TEACHER の2択',
  html.indexOf('<option value="TEACHER">') >= 0 && html.indexOf('<option value="ADMIN">') >= 0);
ok('C5 フォーム見出しにSSO許可ONなら空欄可の注記',
  html.indexOf('SSO許可ONなら空欄可') >= 0);

// --- 一覧：SSO列 ---
ok('C6 一覧ヘッダーに SSO 列がある', /<th[^>]*>SSO<\/th>/.test(html));
ok('C6 SSO可 バッジが実装されている', html.indexOf('SSO可') >= 0);
ok('C6 SSO不可 バッジが実装されている', html.indexOf('SSO不可') >= 0);
ok('C6 一覧は7列（colspan="7"）', html.indexOf('colspan="7"') >= 0);
ok('C6 旧6列（colspan="6"）が残っていない', html.indexOf('colspan="6"') < 0);

const renderBody = extract(html, 'renderTeacherList');
ok('C7 renderTeacherList が sso_allowed を参照', renderBody.indexOf('sso_allowed') >= 0);
ok('C7 renderTeacherList が SSO可 を出す', renderBody.indexOf('SSO可') >= 0);

const editBody = extract(html, 'startEditTeacher');
ok('C8 startEditTeacher が SSO許可を復元', editBody.indexOf('newTeacherSsoAllowed') >= 0);
ok('C8 startEditTeacher が 登録URL情報 を復元', editBody.indexOf('newTeacherUrls') >= 0);
ok('C8 startEditTeacher が 個別ホワイトリスト を復元', editBody.indexOf('newTeacherWhitelist') >= 0);
ok('C8 startEditTeacher が 個別ブラックリスト を復元', editBody.indexOf('newTeacherBlacklist') >= 0);

const resetBody = extract(html, 'resetTeacherForm');
ok('C9 resetTeacherForm が SSO許可を既定ONへ戻す', resetBody.indexOf('newTeacherSsoAllowed') >= 0);
ok('C9 resetTeacherForm が 登録URL情報 を初期化', resetBody.indexOf('newTeacherUrls') >= 0);
ok('C9 resetTeacherForm が 個別ホワイトリスト を初期化', resetBody.indexOf('newTeacherWhitelist') >= 0);
ok('C9 resetTeacherForm が 個別ブラックリスト を初期化', resetBody.indexOf('newTeacherBlacklist') >= 0);

const submitBody = extract(html, 'submitAddTeacher');
ok('C10 submitAddTeacher が sso_allowed を送る', submitBody.indexOf('sso_allowed: ssoAllowed') >= 0);
ok('C10 submitAddTeacher が urls を送る', submitBody.indexOf('urls: urls') >= 0);
ok('C10 submitAddTeacher が filter_whitelist を送る', submitBody.indexOf('filter_whitelist: whitelist') >= 0);
ok('C10 submitAddTeacher が filter_blacklist を送る', submitBody.indexOf('filter_blacklist: blacklist') >= 0);
ok('C10 add_teacher と update_teacher の両方に全項目を送る',
  (submitBody.match(/sso_allowed: ssoAllowed/g) || []).length === 2);
ok('C10 SSO許可ONならパスワード空欄で送信可', /!\s*editingTeacherEmail\s*&&\s*!\s*password\s*&&\s*!\s*ssoAllowed/.test(submitBody));

// =====================================================================
// D. 実行テスト — parseSsoAllowedFlag（空欄＝既定ON）
// =====================================================================
console.log('--- D. parseSsoAllowedFlag の判定（実行） ---');
let preludeD = extractConst('SSO_DENY_MESSAGE') + '\n' + extractConst('SSO_NO_EMAIL_MESSAGE') + '\n';
preludeD += extract(src, 'parseSsoAllowedFlag') + '\n';

function mkVmD() {
  const sandbox = { console: { log: function () {} }, String: String, Boolean: Boolean, Number: Number, Object: Object };
  vm.createContext(sandbox);
  vm.runInContext(preludeD, sandbox);
  return sandbox;
}
{
  const sb = mkVmD();
  const F = sb.parseSsoAllowedFlag;
  ok('D1 未設定(undefined) は既定ON', F(undefined) === true);
  ok('D1 空文字 は既定ON', F('') === true);
  ok('D1 null は既定ON', F(null) === true);
  ok('D1 空白のみ は既定ON', F('   ') === true);
  ok('D1 真偽値 true は許可', F(true) === true);
  ok('D1 数値 1 は許可', F(1) === true);
  ok('D1 文字列 TRUE は許可', F('TRUE') === true);
  ok('D1 文字列 on は許可', F('on') === true);
  ok('D1 日本語「有効」は許可', F('有効') === true);
  ok('D1 真偽値 false は拒否', F(false) === false);
  ok('D1 数値 0 は拒否', F(0) === false);
  ok('D1 文字列 FALSE は拒否', F('FALSE') === false);
  ok('D1 文字列 no は拒否', F('no') === false);
  ok('D1 文字列 off は拒否', F('off') === false);
  ok('D1 文字列 ng は拒否', F('ng') === false);
  ok('D1 日本語「無効」は拒否', F('無効') === false);
  ok('D1 日本語「不可」は拒否', F('不可') === false);
  ok('D1 日本語「拒否」は拒否', F('拒否') === false);
  ok('D1 想定外の文字列は安全側（許可）に倒す', F('abc') === true);
}

// =====================================================================
// E. 実行テスト — ssoLoginWithEmail / api_ssoLogin
// =====================================================================
console.log('--- E. SSO ログイン本体（実行） ---');

const PRELUDE_E = preludeD + extract(src, 'ssoLoginWithEmail') + '\n' + extract(src, 'api_ssoLogin') + '\n';

function mkVmE(opts) {
  opts = opts || {};
  const sandbox = {
    console: { log: function () {} },
    String: String, Boolean: Boolean, Number: Number, Object: Object, Array: Array, Date: Date,
    Utilities: { formatDate: function () { return '2026/11/15 10:00'; } },
    Session: {
      getActiveUser: function () { return { getEmail: function () { return opts.activeEmail || ''; } }; }
    },
    CONFIG: { SCHOOL_LIST: ['英田小学校', '勝田小学校'] },
    getTeacherSettings: function (em) {
      const key = String(em || '').toLowerCase();
      if (opts.teachers && opts.teachers[key]) return opts.teachers[key];
      const e = new Error('teacher not found');
      throw e;
    },
    generateToken: function (t) { return 'TOKEN_FOR_' + t.email; },
    getTargetSheet: function () { const e = new Error('no sheet in test'); throw e; },
    ensureTeacherHeaders: function () {},
    getHeaderMap: function () { return {}; }
  };
  vm.createContext(sandbox);
  vm.runInContext(PRELUDE_E, sandbox);
  return sandbox;
}

const T_OK = { email: 'teacher@mimasaka.ed.jp', name: '教員A', school: '英田小学校',
  role: 'ADMIN', target_class: '', sso_allowed: true };
const T_OFF = Object.assign({}, T_OK, { sso_allowed: false });
const T_UNDEF = Object.assign({}, T_OK, { sso_allowed: undefined });

{
  const sb = mkVmE({ teachers: { 'teacher@mimasaka.ed.jp': T_OK } });
  const res = sb.ssoLoginWithEmail('teacher@mimasaka.ed.jp');
  ok('E1 登録済み＋SSO許可ONで成功', res.success === true);
  ok('E1 sso フラグが立つ', res.sso === true);
  ok('E1 正規トークンが発行される', res.token === 'TOKEN_FOR_teacher@mimasaka.ed.jp');
  ok('E1 教員情報を返す', res.teacher && res.teacher.email === 'teacher@mimasaka.ed.jp');
  ok('E1 学校一覧を返す（手動ログインと同一形状）',
    Array.isArray(res.schools) && res.schools.length === 2);
}
{
  // 大文字・前後空白・@前の大文字小文字を吸収するか
  const sb = mkVmE({ teachers: { 'teacher@mimasaka.ed.jp': T_OK } });
  const res = sb.ssoLoginWithEmail('  TEACHER@Mimasaka.Ed.JP  ');
  ok('E2 メールの大文字小文字・前後空白を吸収して成功', res.success === true);
}
{
  // sso_allowed が未設定（＝列追加前の既存教員）→ 既定ONで許可
  const sb = mkVmE({ teachers: { 'teacher@mimasaka.ed.jp': T_UNDEF } });
  const res = sb.ssoLoginWithEmail('teacher@mimasaka.ed.jp');
  ok('E3 sso_allowed 未設定の既存教員は既定ONで成功', res.success === true && !!res.token);
}
{
  const sb = mkVmE({ teachers: { 'teacher@mimasaka.ed.jp': T_OFF } });
  const res = sb.ssoLoginWithEmail('teacher@mimasaka.ed.jp');
  ok('E4 SSO不許可の教員は拒否', res.success === false);
  ok('E4 reason は sso_disabled', res.reason === 'sso_disabled');
  ok('E4 トークンを発行しない', !res.token);
  ok('E4 拒否メッセージが仕様どおり',
    String(res.error).indexOf('このGoogleアカウントには管理権限がありません') >= 0);
}
{
  const sb = mkVmE({ teachers: { 'teacher@mimasaka.ed.jp': T_OK } });
  const r1 = sb.ssoLoginWithEmail('');
  ok('E5 空メールは拒否', r1.success === false && r1.reason === 'no_email');
  ok('E5 空メールはトークンを発行しない', !r1.token);
  ok('E5 空メールは手動入力へ誘導する', String(r1.error).indexOf('管理者パスワードを入力') >= 0);
  const r2 = sb.ssoLoginWithEmail(null);
  ok('E5 null メールも拒否', r2.success === false && r2.reason === 'no_email');
}
{
  // 児童アカウント（教員マスタに無い）
  const sb = mkVmE({ teachers: { 'teacher@mimasaka.ed.jp': T_OK } });
  const res = sb.ssoLoginWithEmail('s01-1@mimasaka.ed.jp');
  ok('E6 児童アカウントは拒否', res.success === false);
  ok('E6 reason は not_registered', res.reason === 'not_registered');
  ok('E6 トークンを発行しない', !res.token);
}
{
  // getTeacherSettings が email 無しのオブジェクトを返す異常系
  const sb = mkVmE({ teachers: { 'x@mimasaka.ed.jp': { name: 'no email' } } });
  const res = sb.ssoLoginWithEmail('x@mimasaka.ed.jp');
  ok('E7 email を持たない教員レコードは not_registered', res.success === false && res.reason === 'not_registered');
}
{
  const sb = mkVmE({ teachers: { 'teacher@mimasaka.ed.jp': T_OK }, activeEmail: 'teacher@mimasaka.ed.jp' });
  const res = sb.api_ssoLogin();
  ok('E8 api_ssoLogin は Session のメールで成功する', res.success === true && !!res.token);
}
{
  const sb = mkVmE({ teachers: { 'teacher@mimasaka.ed.jp': T_OK }, activeEmail: '' });
  const res = sb.api_ssoLogin();
  ok('E8 api_ssoLogin は空メール（全員デプロイ）で拒否する', res.success === false);
  ok('E8 api_ssoLogin の reason は no_email', res.reason === 'no_email');
}
{
  const sb = mkVmE({ teachers: { 'teacher@mimasaka.ed.jp': T_OK }, activeEmail: 's01-1@mimasaka.ed.jp' });
  const res = sb.api_ssoLogin();
  ok('E8 api_ssoLogin は児童アカウントを拒否する', res.success === false && !res.token);
}

// =====================================================================
// F. 実行テスト — addTeacher / updateTeacherRecord（10項目の往復）
// =====================================================================
console.log('--- F. 教員CRUD 10項目の往復（実行） ---');

const PRELUDE_F = [
  extract(src, 'parseSsoAllowedFlag'),
  extract(src, 'parseTeacherUrls'),
  extract(src, 'serializeTeacherUrls'),
  extract(src, 'isAdminTeacher'),
  extract(src, 'getHeaderMap'),
  extract(src, 'ensureTeacherHeaders'),
  extract(src, 'addTeacher'),
  extract(src, 'updateTeacherRecord')
].join('\n');

const HEADERS_11 = ['教員ID(メールアドレス)', 'パスワード', '氏名', '所属学校', '権限',
  '対象クラス', '登録URL情報', '個別ホワイトリスト', '個別ブラックリスト',
  '最終ログイン日時', 'Google SSO許可'];

function teacherFromSheet(sheet, em) {
  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(function (h) { return String(h).trim(); });
  const ix = function (n) { return headers.indexOf(n); };
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][ix('教員ID(メールアドレス)')] || '').trim().toLowerCase() === em) {
      const cell = function (n) { const k = ix(n); return k < 0 ? '' : data[i][k]; };
      let urls = [];
      try { urls = JSON.parse(String(cell('登録URL情報') || '[]')); } catch (e) { urls = []; }
      return {
        email: String(cell('教員ID(メールアドレス)')),
        name: String(cell('氏名') || ''),
        school: String(cell('所属学校') || ''),
        role: String(cell('権限') || ''),
        target_class: String(cell('対象クラス') || ''),
        urls: Array.isArray(urls) ? urls : [],
        filter_whitelist: String(cell('個別ホワイトリスト') || ''),
        filter_blacklist: String(cell('個別ブラックリスト') || ''),
        sso_allowed: IXKEEP(sheet, data, i, ix)
      };
    }
  }
  const e = new Error('teacher not found');
  throw e;
}
function IXKEEP(sheet, data, i, ix) {
  const k = ix('Google SSO許可');
  return k < 0 ? true : data[i][k];
}

function mkVmF(sheet) {
  const sandbox = {
    console: { log: function () {} },
    String: String, Boolean: Boolean, Number: Number, Object: Object, Array: Array, JSON: JSON,
    CONFIG: { TEACHER_SHEET_NAME: '教員マスタ' },
    withWriteLock: function (fn) { return fn(); },
    getTargetSheet: function () { return sheet; },
    initializeTeacherHeaders: function () {},
    invalidateTeacherCache: function () {},
    // 本番の getTeacherSettings と同じく parseSsoAllowedFlag で正規化する
    // （列追加前の空欄セルは既定ONとして扱われる）
    getTeacherSettings: function (em) {
      const t = teacherFromSheet(sheet, String(em || '').toLowerCase());
      t.sso_allowed = sandbox.parseSsoAllowedFlag(t.sso_allowed);
      return t;
    }
  };
  vm.createContext(sandbox);
  vm.runInContext('CONFIG.TEACHER_COLUMNS = ' + TEACHER_COLUMNS_SRC + ';', sandbox);
  vm.runInContext(PRELUDE_F, sandbox);
  return sandbox;
}

const ADMIN_T = { email: 'admin@mimasaka.ed.jp', role: 'ADMIN' };
const NORMAL_T = { email: 't1@mimasaka.ed.jp', role: 'TEACHER' };

{
  // 新規登録：パスワード空欄 ＋ SSO許可ON ＝ 成功
  const sheet = mkSheet([HEADERS_11.slice()]);
  const sb = mkVmF(sheet);
  let res = null, threw = false;
  try {
    res = sb.addTeacher(ADMIN_T, {
      email: 'new1@mimasaka.ed.jp', password: '', name: '新規 太郎',
      school: '英田小学校', role: 'TEACHER', target_class: '5年1組',
      sso_allowed: true,
      urls: ['https://www.mext.go.jp/'],
      filter_whitelist: 'mimasaka.ed.jp',
      filter_blacklist: 'example.com'
    });
  } catch (e) { threw = true; }
  ok('F1 パスワード空欄＋SSO許可ONで登録できる', threw === false);
  ok('F1 登録結果を返す', res && res.email === 'new1@mimasaka.ed.jp');
  const row = sheet._data[1];
  ok('F1 1列目に教員IDが入る', row[0] === 'new1@mimasaka.ed.jp');
  ok('F1 2列目パスワードは空欄', row[1] === '');
  ok('F1 3列目に氏名が入る', row[2] === '新規 太郎');
  ok('F1 4列目に所属学校が入る', row[3] === '英田小学校');
  ok('F1 5列目に権限が入る', row[4] === 'TEACHER');
  ok('F1 6列目に対象クラスが入る', row[5] === '5年1組');
  ok('F1 7列目に登録URL情報が入る', JSON.parse(String(row[6]))[0].url === 'https://www.mext.go.jp/');
  ok('F1 8列目に個別ホワイトリストが入る', row[7] === 'mimasaka.ed.jp');
  ok('F1 9列目に個別ブラックリストが入る', row[8] === 'example.com');
  ok('F1 11列目にSSO許可が入る（true）', row[10] === true);
  ok('F1 11列目が末尾（11列）', row.length === 11);
}
{
  // 新規登録：パスワード空欄 ＋ SSO許可OFF ＝ 拒否
  const sheet = mkSheet([HEADERS_11.slice()]);
  const sb = mkVmF(sheet);
  let threw = false;
  try {
    sb.addTeacher(ADMIN_T, { email: 'new2@mimasaka.ed.jp', password: '', sso_allowed: false });
  } catch (e) { threw = true; }
  ok('F2 パスワード空欄＋SSO許可OFFは拒否される', threw === true);
  ok('F2 拒否時は行が増えない', sheet._data.length === 1);
}
{
  // パスワードあり ＋ SSO許可OFF ＝ 成功
  const sheet = mkSheet([HEADERS_11.slice()]);
  const sb = mkVmF(sheet);
  let threw = false;
  try {
    sb.addTeacher(ADMIN_T, { email: 'new3@mimasaka.ed.jp', password: 'pw123', sso_allowed: false });
  } catch (e) { threw = true; }
  ok('F3 パスワードあり＋SSO許可OFFで登録できる', threw === false);
  ok('F3 11列目に false が入る', sheet._data[1][10] === false);
}
{
  // 非管理者は拒否
  const sheet = mkSheet([HEADERS_11.slice()]);
  const sb = mkVmF(sheet);
  let threw = false;
  try { sb.addTeacher(NORMAL_T, { email: 'new4@mimasaka.ed.jp', password: 'x' }); } catch (e) { threw = true; }
  ok('F4 非管理者の新規登録は拒否される', threw === true);
  ok('F4 拒否時は行が増えない', sheet._data.length === 1);
}
{
  // 重複メールは拒否
  const sheet = mkSheet([HEADERS_11.slice(), ['dup@mimasaka.ed.jp', 'x', '既存', '英田小学校', 'TEACHER', '', '', '', '', '', true]]);
  const sb = mkVmF(sheet);
  let threw = false;
  try { sb.addTeacher(ADMIN_T, { email: 'dup@mimasaka.ed.jp', sso_allowed: true }); } catch (e) { threw = true; }
  ok('F5 既存メールの重複登録は拒否される', threw === true);
}
{
  // 編集：全項目を更新
  const sheet = mkSheet([HEADERS_11.slice(),
    ['edit@mimasaka.ed.jp', 'old', '旧名', '英田小学校', 'TEACHER', '', '', '', '', '', true]]);
  const sb = mkVmF(sheet);
  let threw = false, res = null;
  try {
    res = sb.updateTeacherRecord(ADMIN_T, {
      email: 'edit@mimasaka.ed.jp',
      name: '新名', school: '勝田小学校', role: 'ADMIN', target_class: '6年2組',
      urls: ['https://www.city.mimasaka.lg.jp/'],
      filter_whitelist: 'edu.ac.jp', filter_blacklist: 'game-site.jp',
      sso_allowed: false
    });
  } catch (e) { threw = true; }
  ok('F6 管理者は編集できる', threw === false);
  const row = sheet._data[1];
  ok('F6 氏名が更新される', row[2] === '新名');
  ok('F6 所属学校が更新される', row[3] === '勝田小学校');
  ok('F6 権限が更新される', row[4] === 'ADMIN');
  ok('F6 対象クラスが更新される', row[5] === '6年2組');
  ok('F6 登録URL情報が更新される', JSON.parse(String(row[6]))[0].url === 'https://www.city.mimasaka.lg.jp/');
  ok('F6 個別ホワイトリストが更新される', row[7] === 'edu.ac.jp');
  ok('F6 個別ブラックリストが更新される', row[8] === 'game-site.jp');
  ok('F6 11列目 SSO許可が false に更新される', row[10] === false);
  ok('F6 パスワード未指定なら既存値を保持', row[1] === 'old');
  ok('F6 更新結果を返す', res && res.email === 'edit@mimasaka.ed.jp');
}
{
  // 編集：パスワードも指定すると更新される
  const sheet = mkSheet([HEADERS_11.slice(),
    ['pw@mimasaka.ed.jp', 'old', '', '', 'TEACHER', '', '', '', '', '', true]]);
  const sb = mkVmF(sheet);
  sb.updateTeacherRecord(ADMIN_T, { email: 'pw@mimasaka.ed.jp', password: 'newpw' });
  ok('F7 パスワードを指定すると更新される', sheet._data[1][1] === 'newpw');
}
{
  // 編集：非管理者は拒否
  const sheet = mkSheet([HEADERS_11.slice(),
    ['x@mimasaka.ed.jp', '', '', '', 'TEACHER', '', '', '', '', '', true]]);
  const sb = mkVmF(sheet);
  let threw = false;
  try { sb.updateTeacherRecord(NORMAL_T, { email: 'x@mimasaka.ed.jp', name: 'z' }); } catch (e) { threw = true; }
  ok('F8 非管理者の編集は拒否される', threw === true);
}
{
  // 編集：存在しない教員は拒否
  const sheet = mkSheet([HEADERS_11.slice()]);
  const sb = mkVmF(sheet);
  let threw = false;
  try { sb.updateTeacherRecord(ADMIN_T, { email: 'nobody@mimasaka.ed.jp', name: 'z' }); } catch (e) { threw = true; }
  ok('F9 存在しない教員の編集は拒否される', threw === true);
}

// =====================================================================
// G. 実行テスト — ensureTeacherHeaders が11列目を自動補完
// =====================================================================
console.log('--- G. ensureTeacherHeaders の11列目自動補完（実行） ---');

const PRELUDE_G = extract(src, 'ensureTeacherHeaders');

function mkVmG(sheet) {
  const sandbox = {
    console: { log: function () {} },
    String: String, Boolean: Boolean, Number: Number, Object: Object, Array: Array,
    CONFIG: {},
    initializeTeacherHeaders: function () {}
  };
  vm.createContext(sandbox);
  vm.runInContext('CONFIG.TEACHER_COLUMNS = ' + TEACHER_COLUMNS_SRC + ';', sandbox);
  vm.runInContext(PRELUDE_G, sandbox);
  return sandbox;
}
{
  // 旧10列のシート → 11列目が自動追加される
  const H10 = ['教員ID(メールアドレス)', 'パスワード', '氏名', '所属学校', '権限',
    '対象クラス', '登録URL情報', '個別ホワイトリスト', '個別ブラックリスト', '最終ログイン日時'];
  const sheet = mkSheet([H10.slice(), ['a@b.c', 'x', '名', '英田小学校', 'TEACHER', '', '', '', '', '']]);
  const sb = mkVmG(sheet);
  sb.ensureTeacherHeaders(sheet);
  const headers = sheet._data[0];
  ok('G1 既存10列シートが11列になる', headers.length === 11);
  ok('G1 11列目に「Google SSO許可」が追加される', headers[10] === 'Google SSO許可');
  ok('G1 既存1〜10列目の順序が変わらない',
    headers[0] === '教員ID(メールアドレス)' && headers[9] === '最終ログイン日時');
  ok('G1 Google SSO許可は1つだけ', headers.filter(function (h) { return h === 'Google SSO許可'; }).length === 1);
}
{
  // 既に11列のシート → 重複追加しない
  const sheet = mkSheet([HEADERS_11.slice(), ['a@b.c', 'x', '名', '英田小学校', 'TEACHER', '', '', '', '', '', '']]);
  const sb = mkVmG(sheet);
  sb.ensureTeacherHeaders(sheet);
  const headers = sheet._data[0];
  ok('G2 既に11列なら列は増えない', headers.length === 11);
  ok('G2 見出しは重複しない', headers.filter(function (h) { return h === 'Google SSO許可'; }).length === 1);
}
{
  // 10列シートで既存行が空欄のままでも、11列目が空（＝既定ON）になる
  const H10 = ['教員ID(メールアドレス)', 'パスワード', '氏名', '所属学校', '権限',
    '対象クラス', '登録URL情報', '個別ホワイトリスト', '個別ブラックリスト', '最終ログイン日時'];
  const sheet = mkSheet([H10.slice(), ['legacy@b.c', 'x', '既存', '英田小学校', 'TEACHER', '', '', '', '', '']]);
  const sb = mkVmG(sheet);
  sb.ensureTeacherHeaders(sheet);
  const sbF = mkVmF(sheet);
  const t = sbF.getTeacherSettings('legacy@b.c');
  ok('G3 列追加前の既存教員は sso_allowed が既定ON', t.sso_allowed === true);
}

// =====================================================================
// H. 固定仕様の不変条件
// =====================================================================
console.log('--- H. 固定仕様の不変条件 ---');

ok('H1 manifest の version は 1.6.8', manifest.version === '1.6.8');
ok('H1 manifest に default_popup が無い',
  !(manifest.action && manifest.action.default_popup) &&
  !(manifest.browser_action && manifest.browser_action.default_popup));
ok('H1 manifest に permissions がある', Array.isArray(manifest.permissions));

ok('H2 既存の MONITOR_SETTINGS_V1 キーが維持されている',
  src.indexOf("const MONITOR_PROP_KEY = 'MONITOR_SETTINGS_V1'") >= 0);
ok('H2 既存のサイト監視テレメトリ列が維持されている',
  src.indexOf('monitor_flag') >= 0 && src.indexOf('monitor_reason') >= 0);
ok('H2 DIAG 計装が維持されている', src.indexOf('[SHARD-DIAG]') >= 0);
ok('H2 bulkTrace 計装が維持されている', src.indexOf('bulkTrace') >= 0);

ok('H3 東粟倉小学校が学校リストに含まれていない', html.indexOf('東粟倉小学校') < 0);
const schoolsBlock = between(html, 'const SCHOOLS = [', '];');
ok('H3 学校リストは 14 校', (schoolsBlock.match(/'/g) || []).length === 28);
ok('H3 樸学園が含まれる（14校の最終要素）', schoolsBlock.indexOf('樸学園') >= 0);

ok('H4 通信経路は google.script.run（SSOも同経路）',
  hsBody.indexOf('google.script.run') >= 0 && apiSsoBody.length > 0);
ok('H4 api_ssoLogin は SpreadsheetApp でスプレッドシートへ書き戻さない',
  apiSsoBody.indexOf('SpreadsheetApp') < 0);
ok('H4 SSO判定は PropertiesService の許可リストに依存しない',
  ssoBody.indexOf('getScriptProperties') < 0);

ok('H5 手動ログインの API（api_login）が残っている', countDefs(src, 'api_login') === 1);
ok('H5 手動ログインのサーバー処理（handleTeacherLogin）が残っている',
  countDefs(src, 'handleTeacherLogin') === 1);
ok('H5 verifyToken が残っている（既存セッション検証）', countDefs(src, 'verifyToken') === 1);

// --- ドキュメント整合 ---
ok('H6 docs にアカウント管理一本化の方針が書かれている',
  docs.indexOf('アカウント管理だけで完結する') >= 0 &&
  docs.indexOf('二重管理しない') >= 0);
ok('H6 docs に11列目の説明がある', docs.indexOf('Google SSO許可」列') >= 0 || docs.indexOf('「Google SSO許可」列') >= 0);
ok('H6 docs に空欄＝既定ONの移行措置が書かれている', docs.indexOf('既定ON') >= 0);
ok('H6 docs に旧SSO設定の全廃が書かれている', docs.indexOf('この独立設定は全廃しました') >= 0);

// =====================================================================
console.log('');
console.log('===== 結果: PASS=' + pass + ' FAIL=' + fail + ' =====');
process.exit(fail === 0 ? 0 : 1);
