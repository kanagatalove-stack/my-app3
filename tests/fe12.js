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
// ===== Round 12 frontend sim: URL規制モーダルのスクロール + 設定モーダルの分割 =====
const fs = require('fs');
const html = fs.readFileSync('/home/user/webapp/gas/index.html', 'utf8');
let pass = 0, fail = 0;
function check(n, c, e){ if(c){console.log('PASS', n, e!==undefined?'=> '+JSON.stringify(e):'');pass++;} else {console.log('FAIL', n, e!==undefined?'=> '+JSON.stringify(e):'');fail++;} }

console.log('===== URL規制モーダル（縦長でも「適用する」が常に見える） =====');
const s = html.indexOf('id="filterModal"');
const e = html.indexOf('id="teacherSettingsModal"');
const block = html.slice(s, e);
check('filterModal ブロックを抽出できた', block.length > 500, { len: block.length });
check('外枠は縦中央寄せ', /items-center justify-center/.test(block));
check('パネルは max-h で高さを制限（92vh）', /max-h-\[92vh\]/.test(block));
check('パネルは flex-col レイアウト', /flex flex-col/.test(block));
check('パネルは overflow-hidden', /overflow-hidden/.test(block));
check('ヘッダーは shrink-0（縮まない）', /p-5 border-b[\s\S]*?shrink-0/.test(block));
check('本文は overflow-y-auto（スクロール）', /overflow-y-auto/.test(block));
check('本文は flex-1（残り高さを占有）', /flex-1/.test(block));
check('フッターは shrink-0（縮まない）', /p-4 border-t bg-slate-50 shrink-0/.test(block));
// 「適用する」ボタンがフッター（shrink-0）内にあり、本文スクロール領域の外にあること
const bodyStart = block.indexOf('overflow-y-auto flex-1');
const footerStart = block.indexOf('border-t bg-slate-50 shrink-0');
const applyIdx = block.indexOf('適用する');
check('本文スクロール領域 → フッター → 適用する の順で配置', bodyStart > -1 && footerStart > bodyStart && applyIdx > footerStart, { bodyStart, footerStart, applyIdx });
check('「適用する」は executeFilterSubmit を呼ぶ', /onclick="executeFilterSubmit\(\)"[\s\S]{0,200}?適用する/.test(block));
check('フッターにキャンセル（closeModal）もある', /onclick="closeModal\('filterModal'\)"[\s\S]*?適用する/.test(block));

console.log('===== 教員設定モーダルの分割（対象クラス=ADMINのみ） =====');
check('タイトル要素 id=teacherSettingsTitle がある', /id="teacherSettingsTitle"/.test(html));
check('サブタイトル要素 id=teacherSettingsSubtitle がある', /id="teacherSettingsSubtitle"/.test(html));
check('対象クラスセクション id=settingTargetClassSection がある', /id="settingTargetClassSection"/.test(html));
check('設定ボタンラベル id=teacherSettingsBtnLabel がある', /id="teacherSettingsBtnLabel"/.test(html));
// 対象クラス欄は id を持つ div（非表示トグル可能）
check('対象クラスセクションは hidden を toggle できる構造（class に space-y-3）', /id="settingTargetClassSection" class="space-y-3/.test(html));

console.log('===== ヘッダー設定ボタンは全教員に表示（hidden 固定でない） =====');
// ボタンの初期 class は hidden のままだが、updateHeaderTeacherInfo で remove される実装になっている
check('updateHeaderTeacherInfo は remove(\'hidden\') で全教員に表示', /forEach[\s\S]{0,200}?classList\.remove\('hidden'\)/.test(html));
check('ラベルは権限で切替（URL・規制 / クラス・URL）', /isAdminUser\(\) \? '設定 \(クラス・URL\)' : '設定 \(URL・規制\)'/.test(html));

console.log(`\n===== 結果: PASS=${pass} FAIL=${fail} =====`);
process.exit(fail?1:0);
