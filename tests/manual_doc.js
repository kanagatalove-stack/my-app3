#!/usr/bin/env node
/**
 * docs/manual/README.md（操作説明書）の整合性チェック。
 *
 * この説明書は挿絵をインラインSVGで手書きしているため、
 * 閉じタグ漏れ・id重複・目次リンク切れが起きやすい。
 * 文章の校正ではなく「壊れていないか」だけを見る回帰テスト。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DOC = path.join(ROOT, 'docs', 'manual', 'README.md');

let pass = 0, fail = 0;
function ok(cond, label, detail) {
  if (cond) { pass++; console.log('PASS ' + label); }
  else { fail++; console.log('FAIL ' + label + (detail ? ' => ' + detail : '')); }
}

if (!fs.existsSync(DOC)) {
  console.log('FAIL manual not found: ' + DOC);
  console.log('===== 結果: PASS=0 FAIL=1 =====');
  process.exit(1);
}

const src = fs.readFileSync(DOC, 'utf8');
const lines = src.split('\n');

// ---------- 1. 基本構成 ----------
ok(lines.length > 500, '説明書は十分な分量がある', lines.length + ' lines');
ok(src.indexOf('\uFFFD') === -1, '文字化け(U+FFFD)が無い',
  src.indexOf('\uFFFD') >= 0 ? 'offset ' + src.indexOf('\uFFFD') : '');
ok(!/MANEOF|<< '/.test(src), 'シェル用ヒアドキュメントの残骸が無い');

const fences = (src.match(/^```/gm) || []).length;
ok(fences % 2 === 0, 'コードブロックの数が偶数（閉じ忘れ無し）', 'fences=' + fences);

// ---------- 2. SVG 挿絵 ----------
const svgOpen = (src.match(/<svg/g) || []).length;
const svgClose = (src.match(/<\/svg>/g) || []).length;
ok(svgOpen > 0, 'インラインSVGの挿絵がある', 'count=' + svgOpen);
ok(svgOpen === svgClose, 'SVGの開始/終了タグが同数',
  'open=' + svgOpen + ' close=' + svgClose);

// SVG を1枚ずつ切り出して検査
const blocks = [];
{
  let i = 0;
  for (;;) {
    const s = src.indexOf('<svg', i);
    if (s < 0) break;
    const e = src.indexOf('</svg>', s);
    if (e < 0) break;
    blocks.push({ off: s, body: src.slice(s, e + 6) });
    i = e + 6;
  }
}
ok(blocks.length === svgOpen, 'SVGブロックを全て切り出せた',
  'blocks=' + blocks.length + ' open=' + svgOpen);

blocks.forEach((b, n) => {
  const line = src.slice(0, b.off).split('\n').length;
  const vb = /viewBox="([^"]+)"/.exec(b.body);
  const label = 'SVG#' + (n + 1) + ' (line ' + line + ')';

  // viewBox は "min-x min-y width height"。min-x/min-y は 0 が正常なので、
  // 正値であることを要求するのは width / height だけ。
  const nums = vb ? vb[1].trim().split(/\s+/).map(Number) : [];
  ok(vb && nums.length === 4 && nums.every(isFinite) && nums[2] > 0 && nums[3] > 0,
    label + ' viewBox が数値4つ・幅高さが正', vb ? vb[1] : 'viewBox missing');

  ok(b.body.indexOf('<text') >= 0, label + ' 文字要素がある（挿絵として意味がある）');

  // 閉じタグの対応（主要な図形要素のみ）
  ['g', 'text', 'rect', 'circle', 'path', 'line', 'polygon', 'defs', 'marker'].forEach(tag => {
    const o = (b.body.match(new RegExp('<' + tag + '[\\s>]', 'g')) || []).length;
    const c = (b.body.match(new RegExp('</' + tag + '>', 'g')) || []).length;
    // <rect .../> のような自己終了は閉じタグを持たない
    const selfClose = (b.body.match(new RegExp('<' + tag + '[^>]*/>', 'g')) || []).length;
    if (o - selfClose !== c) {
      ok(false, label + ' <' + tag + '> の対応',
        'open=' + o + ' selfClose=' + selfClose + ' close=' + c);
    }
  });
});

// ---------- 3. id の重複（SVG を複数並べるとマーカー等が衝突する） ----------
const ids = (src.match(/\sid="([A-Za-z0-9_-]+)"/g) || [])
  .map(s => s.replace(/\sid="/, '').replace(/"$/, ''));
const dup = ids.filter((v, i) => ids.indexOf(v) !== i);
ok(dup.length === 0, 'SVG内の id が重複していない', dup.join(', '));

// ---------- 4. 目次アンカーが実在する見出しに解決する ----------
function slug(h) {
  // github-slugger 相当: 小文字化 → 句読点/記号を削除 → 空白をハイフンに
  let s = h.trim().toLowerCase();
  s = Array.from(s).filter(ch => {
    const cp = ch.codePointAt(0);
    // Unicode の P(句読点) / S(記号) を除去。'・'(U+30FB) や '：' もここに入る。
    return !/[\p{P}\p{S}]/u.test(ch) && cp !== 0xFEFF;
  }).join('');
  return s.replace(/\s/g, '-');
}

const anchors = Array.from(new Set((src.match(/\]\(#([^)]+)\)/g) || [])
  .map(s => s.replace(/\]\(#/, '').replace(/\)$/, ''))));
const headingSlugs = new Set();
(src.match(/^#{2,4}\s+.+$/gm) || []).forEach(h => {
  headingSlugs.add(slug(h.replace(/^#+\s+/, '')));
});

ok(anchors.length > 0, '目次にアンカーリンクがある', 'count=' + anchors.length);
anchors.forEach(a => {
  ok(headingSlugs.has(a), 'アンカー #' + a + ' が見出しに解決する');
});

// ---------- 5. 章構成（前半=先生の日常操作 / 後半=管理者の初期設定） ----------
const h2 = (src.match(/^##\s+.+$/gm) || []).map(s => s.replace(/^##\s+/, ''));
ok(h2.length >= 13, '章・付録がそろっている', 'count=' + h2.length);

const idxTeacher = src.indexOf('## 1. このシステムでできること');
// 章番号は機能追加のたびに繰り下がるため、番号ではなく見出し本文で探す。
// （「先生向けの章が管理者向けの章より前にある」という意図だけを固定する。）
const idxAdmin = (() => {
  const m = /^## \d+\. 初期設定の手順$/m.exec(src);
  return m ? m.index : -1;
})();
ok(idxTeacher > 0 && idxAdmin > idxTeacher,
  '先生向けの章(1〜)が管理者向けの章より前にある');

['このシステムでできること', 'ログインする', '画面の見方',
 '児童の画面をロックする', 'URLを配信する', '児童の画面を見る',
 '注意マーク', '予約スケジュール（時間制限タイマー）', '困ったときは',
 'システムの全体像', '初期設定の手順',
 'サイト監視の設定'].forEach(kw => {
  ok(src.indexOf(kw) >= 0, '「' + kw + '」の章がある');
});

// ---------- 6. 実装との食い違いが起きやすい箇所 ----------
ok(src.indexOf('東粟倉') >= 0 && /東粟倉小学校は廃校/.test(src),
  '廃校(東粟倉小学校)が「含めないでください」と明記されている');
// 廃校名が14校の一覧に混ざっていないこと。
// 一覧は折り返して2行にまたがるので、見出し行の後ろの空行区切りブロックを行単位で集める。
// （正規表現でまとめて抜くと "**対象は次の14校です。**" の閉じ ** を
//   本文の開始と誤認しやすいため、行単位で素直に走査する。）
const schoolBlock = (() => {
  const idx = lines.findIndex(l => /対象は次の\d+校です/.test(l));
  if (idx < 0) return '';
  const out = [];
  let started = false; // 見出し直後の空行は読み飛ばし、本文が始まってから区切りとする
  for (let i = idx + 1; i < lines.length && i < idx + 12; i++) {
    const l = lines[i].trim();
    if (!l) {
      if (started) break;
      continue;
    }
    if (l.startsWith('>') || l.startsWith('#')) break;
    started = true;
    out.push(l);
  }
  return out.join('\n');
})();
ok(schoolBlock.length > 0, '14校の一覧ブロックを取得できた', JSON.stringify(schoolBlock).slice(0, 80));
const schoolCount = (schoolBlock.match(/[^\s／、]+(?:小学校|中学校|学園)/g) || []).length;
ok(!/東粟倉/.test(schoolBlock), '14校の一覧に東粟倉小学校が入っていない');
ok(schoolCount === 14, '一覧が14校ちょうど', 'count=' + schoolCount);

// ポリシーのキー名（schema.json と一致している必要がある）
const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension', 'schema.json'), 'utf8'));
const schemaKeys = Object.keys(schema.properties || {});
ok(schemaKeys.length === 4, 'schema.json のポリシーキーは4個', schemaKeys.join(','));
schemaKeys.forEach(k => {
  ok(src.indexOf(k) >= 0, '説明書に正しいキー「' + k + '」が載っている');
});

// 誤ったキー例として「使わない」と明示されているか
ok(/gasApiUrl/.test(src) && /使わない|誤り|間違い/.test(src),
  '誤ったキー例(gasApiUrl)が「使わない」と説明されている');

// GAS 再デプロイの注意（既存デプロイの更新であること）
ok(/新しいデプロイ/.test(src) && /(変わり|無効)/.test(src),
  '「新しいデプロイ」を押すとURLが変わる注意が書かれている');
ok(/鉛筆|✏/.test(src), '既存デプロイを鉛筆アイコンで更新する手順がある');

// 児童端末でアイコンを押しても何も出ない仕様
ok(/default_popup/.test(src) || /アイコンを押しても/.test(src),
  '児童端末でアイコンを押しても何も出ないことが書かれている');

// URL規制リストの不具合修正（許可/規制が別々に出ること）が反映されている
ok(/許可URLリスト/.test(src) && /規制URLリスト/.test(src),
  '許可URLリストと規制URLリストを区別して説明している');
ok(/それぞれ別のURL/.test(src),
  '「それぞれ別のURLが表示される」旨の注記がある');

// サイト監視が既定OFF・管理者のみ
ok(/既定|初期値/.test(src), 'サイト監視の初期値について書かれている');
ok(/管理者/.test(src), 'サイト監視が管理者のみ操作できると書かれている');

// ---------- 7. 操作例（ボタンを押すと児童画面はこうなる） ----------
const exampleCount = (src.match(/押すと児童の?(画面|端末)は/g) || []).length;
ok(exampleCount >= 2, '「押すと児童の画面はこうなります」の操作例が複数ある',
  'count=' + exampleCount);
ok(src.indexOf('画面ロック中') >= 0, 'ロック画面の実表示文言を再現している');
ok(src.indexOf('アクセスが制限されています') >= 0, 'ブロック画面の実表示文言を再現している');

// ---------- 8. 予約スケジュール（時間制限タイマー）の記載 ----------
// 実装（gas/index.html の #scheduleView / #scheduleModal）と用語を一致させる。
ok(src.indexOf('スケジュール管理') >= 0, '「スケジュール管理」タブの説明がある');
ok(src.indexOf('新規予約作成') >= 0, '「新規予約作成」ボタンの記載がある');
ok(src.indexOf('時間制限タイマー') >= 0, '機能の正式名称（時間制限タイマー）がある');

// 繰り返し3種（NONE/DAILY/WEEKLY の日本語表示）
['単発', '毎日', '毎週'].forEach(kw => {
  ok(src.indexOf(kw) >= 0, '繰り返し「' + kw + '」の説明がある');
});

// 翌日またぎ（終了時刻 < 開始時刻）
ok(/翌日またぎ/.test(src), '深夜帯（翌日またぎ）の扱いが書かれている');

// 「解除」と「取消」の区別（取り違えると運用事故になるため必須）
ok(/手動解除/.test(src), '「手動解除」の説明がある');
ok(/取消/.test(src), '「取消」の説明がある');
ok(/今回の時間帯だけ/.test(src),
  '「解除＝今回だけ／取消＝予約ごと停止」の違いが明記されている');

// 4枚目のシート
ok(src.indexOf('スケジュール管理') >= 0 && /4シート|4つのシート/.test(src),
  'シートが4枚になったことが書かれている');
ok(src.indexOf('3シート') < 0 && src.indexOf('3つのシート') < 0,
  '古い「3シート」表記が残っていない');

// ---------- 9. Hub-Spoke（親GAS／子GAS）と v1.6.4 ----------
ok(/親GAS/.test(src) && /子GAS/.test(src), '親GAS・子GASの役割が書かれている');
ok(/Hub/.test(src) && /Spoke/.test(src), 'Hub-Spoke 構成であることが書かれている');
ok(/PropertiesService/.test(src),
  'データ伝播が PropertiesService 経由であることが書かれている');
ok(/1校 = 1つの独立したスプレッドシート/.test(src),
  'R41前提（1校=1独立環境）が明記されている');

const mf = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension', 'manifest.json'), 'utf8'));
ok(src.indexOf(mf.version) >= 0,
  '説明書が manifest.json の版数(' + mf.version + ')に追随している');
ok(!/1\.6\.3 を配布/.test(src), '古い「1.6.3 を配布」の指示が残っていない');


// ---------- 10. 追加章（予約スケジュール / Q&A / 権限 / マイ設定 / 年次更新 / 導入設定） ----------
// 章を差し替え・追記したので、その章が「実際に存在し、中身が入っているか」を固定する。
function section(startRe, endRe) {
  const m = startRe.exec(src);
  if (!m) return '';
  const rest = src.slice(m.index + m[0].length);
  const n = endRe.exec(rest);
  return n ? rest.slice(0, n.index) : rest;
}

// 章番号が 1..15 で連番（差し替え時に番号が飛んだり重複したりしていないか）
const chapNums = (src.match(/^##\s+(\d+)\.\s+/gm) || [])
  .map(s2 => parseInt(/^##\s+(\d+)\./.exec(s2)[1], 10));
ok(chapNums.length === 15, '本文の章は15章', 'count=' + chapNums.length);
ok(chapNums.every((n, i) => n === i + 1), '章番号が1から連番', chapNums.join(','));

// 目次に新章(13/14/15)のリンクが入っている
['13', '14', '15'].forEach(n => {
  ok(new RegExp('\\]\\(#' + n + '-').test(src), '目次に第' + n + '章のリンクがある');
});

// 挿絵が増えた（＝ SVG が各章に入っている）
ok(svgOpen >= 30, 'インラインSVGが十分な枚数ある', 'count=' + svgOpen);

[['第8章(予約スケジュール)', /^## 8\. 予約スケジュール/m, /^## 9\. /m],
 ['第11章(初期設定)', /^## 11\. /m, /^## 12\. /m],
 ['第13章(権限)', /^## 13\. /m, /^## 14\. /m],
 ['第14章(マイ設定)', /^## 14\. /m, /^## 15\. /m],
 ['第15章(年次更新)', /^## 15\. /m, /^## 付録A/m]].forEach(r => {
  const body = section(r[1], r[2]);
  const n = (body.match(/<svg/g) || []).length;
  ok(n >= 1, r[0] + 'にインラインSVGの挿絵がある', 'svg=' + n);
});

// ---------- 10-1. 第8章 予約スケジュール ----------
const sec8 = section(/^## 8\. 予約スケジュール/m, /^## 9\. /m);
ok(/対象の選び方/.test(sec8), '第8章に「対象の選び方」の節がある');
ok(/全校生徒/.test(sec8), '対象の選び方に「全校生徒」がある');
ok(/児童を個別に選ぶ/.test(sec8), '対象の選び方に「児童を個別に選ぶ」がある');
ok(/予約の編集/.test(sec8), '「予約の編集」の節がある');
ok(/実行中/.test(sec8), '実行中のバッジに触れている');
ok(/再読込/.test(sec8), '一覧に出ないときの対処(再読込)がある');
ok(/時間の窓/.test(sec8), '予約が「時間の窓」で動くことが書かれている');
ok(/手動解除/.test(sec8), '第8章に手動解除の説明がある');

// ---------- 10-2. 第9章 トラブルQ&A ----------
const sec9 = section(/^## 9\. 困ったときは/m, /^## 10\. /m);
['9-1. 症状から探す', '9-2. 予約スケジュールのQ&A',
 '9-3. エラーメッセージから探す', '9-4. それでも解決しないとき'].forEach(h => {
  ok(sec9.indexOf(h) >= 0, 'Q&Aの小見出し「' + h + '」がある');
});
['未対応のアクション', '権限がありません', '共有シークレットが一致しません',
 '子GASとして構成されていません'].forEach(msg => {
  ok(sec9.indexOf(msg) >= 0, 'エラー表に「' + msg + '」がある');
});
ok(/\[SHARD\]/.test(sec9) && /\[SCHEDULE\]/.test(sec9),
  'ログの見分け方([SHARD]/[SCHEDULE])が書かれている');
ok(/写真/.test(sec9), '解決しないときの伝達事項(画面の写真)がある');
ok(/間違えた/.test(sec9), '「解除と取消を間違えた」Q&Aがある');
ok(/何もしなくてよい/.test(sec9), '手動解除の戻し方が書かれている');

// ---------- 10-3. 第11章 導入時設定（スクリプトプロパティ） ----------
const sec11 = section(/^## 11\. 初期設定の手順/m, /^## 12\. /m);
ok(sec11.indexOf('ステップ 2-2') >= 0, 'ステップ2-2(スクリプトプロパティ)がある');
ok(sec11.indexOf('ステップ 2-3') >= 0, 'ステップ2-3(学校ごとに子GASを追加)がある');
['SHARD_MODE', 'SHARD_SECRET', 'SHARD_MAP_V1', 'SHARD_DEFAULT_URL',
 'SHARD_CHILD_MODE', 'SHARD_PARENT_URL', 'SPREADSHEET_ID',
 'setupSpreadsheet', 'getShardSettingsForAdmin'].forEach(k => {
  ok(sec11.indexOf(k) >= 0, '第11章に「' + k + '」の記載がある');
});
ok(/`SHARD_MODE`\s*\|\s*`true`/.test(sec11), '親GASは SHARD_MODE=true');
ok(/`SHARD_CHILD_MODE`\s*\|\s*`true`/.test(sec11), '子GASは SHARD_CHILD_MODE=true');
ok(/`SHARD_MODE`\s*\|\s*`false`/.test(sec11), '子GASは SHARD_MODE=false');
ok(/SHARD_MODE` と `SHARD_CHILD_MODE` を両方 `true` にしない/.test(sec11),
  '「両方 true にしない」注意がある');
ok(/secret_configured/.test(sec11), '設定確認(secret_configured)の見方がある');
ok(/"":\s*"https/.test(sec11), 'SHARD_MAP_V1 に空キー(既定)の例がある');
ok(/親GASのみで運用/.test(sec11), '担当子GASが無いクラスの扱いが書かれている');
ok(/スクリプト プロパティ|スクリプトプロパティ/.test(sec11),
  '設定場所（プロジェクトの設定→スクリプトプロパティ）が書かれている');

// ---------- 10-4. 第13章 ADMIN と TEACHER の違い ----------
const sec13 = section(/^## 13\. /m, /^## 14\. /m);
ok(/ADMIN/.test(sec13) && /TEACHER/.test(sec13), '第13章でADMINとTEACHERを比較している');
['13-1. できることの比較表', '13-2. 「担当クラス」という権限の境界',
 '13-3. アカウントの列（教員マスタ）'].forEach(h => {
  ok(sec13.indexOf(h) >= 0, '第13章の小見出し「' + h + '」がある');
});
ok(/○/.test(sec13) && /✕/.test(sec13), '比較表に○/✕が使われている');
ok(/空欄/.test(sec13) && /全クラス/.test(sec13), '担当クラス空欄=全クラスの説明がある');
ok(/ALL/.test(sec13) && /指定なし/.test(sec13), '全クラス扱いの別表記が書かれている');
ok(/カンマ/.test(sec13), '複数クラスのカンマ区切りが書かれている');
ok(/教員マスタ/.test(sec13), '教員マスタの列の説明がある');
ok(/Google SSO許可/.test(sec13), '「Google SSO許可」列がある');
ok(/未設定/.test(sec13), 'クラス未設定の児童の扱いが書かれている');

// ---------- 10-5. 第14章 マイ設定とアカウント管理 ----------
const sec14 = section(/^## 14\. /m, /^## 15\. /m);
['14-1. マイ設定', '14-2. アカウント管理',
 '14-3. 教員の一括インポート（CSV）'].forEach(h => {
  ok(sec14.indexOf(h) >= 0, '第14章の小見出し「' + h + '」がある');
});
ok(sec14.indexOf('マイ設定（個別URL・規制URL）') >= 0,
  'マイ設定の画面タイトルが載っている');
ok(sec14.indexOf('教員アカウント設定（対象クラス・個別URL・規制URL）') >= 0,
  'ADMINで変わる画面タイトルが載っている');
['教員アカウント', '児童アカウント', '年次更新・一括インポート'].forEach(t => {
  ok(sec14.indexOf(t) >= 0, 'アカウント管理のタブ「' + t + '」がある');
});
ok(/新規登録/.test(sec14) && /編集/.test(sec14) && /削除/.test(sec14),
  '新規登録・編集・削除の手順がある');
ok(/メールアドレス（教員ID）は変更できません/.test(sec14),
  'メールアドレス変更不可が明記されている');
ok(/ADMIN を2人以上/.test(sec14), 'ADMINを2人以上残す注意がある');
ok(/Google SSO/.test(sec14), 'パスワードとSSOの関係が書かれている');
['email', 'password', 'name', 'school', 'role', 'target_class'].forEach(c => {
  ok(sec14.indexOf(c) >= 0, 'CSV列「' + c + '」がある');
});
ok(/既にあれば更新/.test(sec14), 'CSVインポートの更新/追加の挙動が書かれている');
ok(/\*\*\+ 新規登録\*\*/.test(sec14) || /＋ 新規登録/.test(sec14),
  '「＋ 新規登録」ボタンの記載がある');

// ---------- 10-6. 第15章 年次更新設定 ----------
const sec15 = section(/^## 15\. /m, /^## 付録A/m);
['15-1. 2通りのやり方', '15-2. 今すぐ実行する手順', '15-3. 予約実行型 年次更新',
 '15-4. 年次更新で消えるもの・残るもの', '15-5. 年次更新のQ&A'].forEach(h => {
  ok(sec15.indexOf(h) >= 0, '第15章の小見出し「' + h + '」がある');
});
ok(/今すぐ実行/.test(sec15) && /予約実行型/.test(sec15), '2通りのやり方が書かれている');
ok(/前年度データ削除/.test(sec15), '前年度データ削除のON/OFFが書かれている');
ok(/予約をキャンセル/.test(sec15), '予約のキャンセル方法が書かれている');
ok(/年次更新を予約保存/.test(sec15), '予約保存のボタン名がある');
ok(/取り消せません/.test(sec15), '取り消せない注意がある');
ok(/プレビュー/.test(sec15), 'プレビューで人数確認する手順がある');
ok(/バージョン履歴/.test(sec15), '間違えたときの戻し方(バージョン履歴)がある');
ok(/卒業生/.test(sec15), '卒業生シートへの退避が書かれている');

// ---------- 10-7. 全章そろっている ----------
ok(h2.length >= 18, '章・付録が18以上ある', 'count=' + h2.length);
// src.length は UTF-16 の文字数（日本語は1文字=1）。バイト数ではない点に注意。
ok(src.length > 90000, 'マニュアルは十分な分量がある', 'chars=' + src.length + ' bytes=' + Buffer.byteLength(src, 'utf8'));

// ---------- 結果 ----------
console.log('===== 結果: PASS=' + pass + ' FAIL=' + fail + ' =====');
process.exit(fail ? 1 : 0);
