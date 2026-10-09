// --- portable path prelude ---
(function(){
  const fs0=require('fs'),path0=require('path');const PREFIX='/home/user/webapp/';
  const _rf=fs0.readFileSync;fs0.readFileSync=function(p,...a){if(typeof p==='string'&&p.startsWith(PREFIX)){p=path0.join(__dirname,'..',p.slice(PREFIX.length));}return _rf.call(this,p,...a);};
})();
// ===== Round 15: 2課題の修正検証 =====
//  課題A: 指示後の児童画面反映が遅い → 3秒以内に反映（コンソール稼働通知の確実な配送＋レート制御）
//  課題B: 画面情報取得しても表示されない → 画像をセル上限(50,000文字)内に縮小して保存
const fs=require('fs'),vm=require('vm');
const codeGs=fs.readFileSync('/home/user/webapp/gas/Code.gs','utf8');
const html=fs.readFileSync('/home/user/webapp/gas/index.html','utf8');
const bgJs=fs.readFileSync('/home/user/webapp/extension/background.js','utf8');
const contentJs=fs.readFileSync('/home/user/webapp/extension/content.js','utf8');
const lockJs=fs.readFileSync('/home/user/webapp/extension/lock.js','utf8');
const blockedJs=fs.readFileSync('/home/user/webapp/extension/blocked.js','utf8');

function extract(src,name){
  const re=new RegExp('^function '+name+'\\s*\\(','m');
  const start=src.search(re); if(start<0) throw new Error('not found: '+name);
  let i=src.indexOf('{',start),depth=0,end=-1;
  for(;i<src.length;i++){ if(src[i]==='{')depth++; else if(src[i]==='}'){depth--; if(depth===0){end=i;break;}} }
  return src.slice(start,end+1);
}
let pass=0,fail=0;
function check(n,c,e){if(c){console.log('PASS',n,e!==undefined?'=> '+JSON.stringify(e):'');pass++;}else{console.log('FAIL',n,e!==undefined?'=> '+JSON.stringify(e):'');fail++;}}

// ============ 課題A: GAS の稼働記録（Cache + Properties の二重化） ============
console.log('===== 課題A: GAS がコンソール稼働を確実に記録する =====');
const cacheStore={}, propStore={};
// 実時刻で判定する（テストは保存値側を過去/未来へ書き換えて時間経過を模擬する）
const gctx={ console, JSON, String, Number, Object, Array, RegExp, Error, Boolean, Date,
  CacheService:{ getScriptCache(){ return {
    get(k){ return k in cacheStore ? cacheStore[k] : null; },
    put(k,v){ cacheStore[k]=String(v); },
    remove(k){ delete cacheStore[k]; } }; } },
  PropertiesService:{ getScriptProperties(){ return {
    getProperty(k){ return k in propStore ? propStore[k] : null; },
    setProperty(k,v){ propStore[k]=String(v); },
    deleteProperty(k){ delete propStore[k]; } }; } }
};
vm.createContext(gctx);
vm.runInContext(
  'const KA_KEY="ka_console";const KA_PROP_KEY="KA_LAST_TOUCH";const KA_ACTIVE_WINDOW_MS=120000;\n'+
  extract(codeGs,'touchTeacherConsole')+'\n'+extract(codeGs,'releaseTeacherConsole')+'\n'+extract(codeGs,'isTeacherConsoleActive')+
  '\n__touch=touchTeacherConsole;__release=releaseTeacherConsole;__active=isTeacherConsoleActive;', gctx);

check('初期状態は非稼働', gctx.__active()===false);
gctx.__touch();
check('touch で CacheService に記録される', !!cacheStore['ka_console'], cacheStore['ka_console']);
check('touch で PropertiesService にも記録される（失効対策の二重化）', !!propStore['KA_LAST_TOUCH'], propStore['KA_LAST_TOUCH']);
check('touch 後は稼働中と判定される', gctx.__active()===true);
// CacheService が失効しても Properties に残っていれば稼働中（＝取りこぼし防止）
delete cacheStore['ka_console'];
check('キャッシュ失効後も Properties で稼働中を維持（重要）', gctx.__active()===true);
// 保存値を 121 秒前へ書き換えて時間経過を模擬 → 非稼働
const stale = String(Date.now() - 121000);
cacheStore['ka_console'] = stale; propStore['KA_LAST_TOUCH'] = stale;
check('120 秒経過で非稼働に戻る', gctx.__active()===false);
// 再度 touch → release で停止
gctx.__touch();
check('再 touch で稼働中', gctx.__active()===true);
gctx.__release();
check('release でキャッシュが消える', !('ka_console' in cacheStore));
check('release で Properties も消える', !('KA_LAST_TOUCH' in propStore));
check('release 後は非稼働', gctx.__active()===false);

console.log('===== 課題A: GAS の配線 =====');
check('doPost に console_touch 経路がある（認証不要）', /action === 'console_touch'/.test(codeGs));
check('doPost に console_release 経路がある', /action === 'console_release'/.test(codeGs));
check('api_consoleTouch / api_consoleRelease がある（google.script.run 用）', /function api_consoleTouch/.test(codeGs) && /function api_consoleRelease/.test(codeGs));
check('ハートビート応答に ka_active が含まれる', /ka_active:\s*kaActive/.test(codeGs));
check('processHeartbeat が isTeacherConsoleActive を参照', /kaActive\s*=\s*\(typeof isTeacherConsoleActive/.test(codeGs));

// ============ 課題A: コンソールが稼働を確実に配送 ============
console.log('===== 課題A: コンソール→GAS の稼働配送（GASネイティブでも届く） =====');
check('consoleTouch() が google.script.run.api_consoleTouch を呼ぶ',
  /function consoleTouch\(\)[\s\S]*?google\.script\.run\.api_consoleTouch\(\)/.test(html));
check('consoleTouch() に fetch フォールバックがある', /function consoleTouch\(\)[\s\S]*?fetch\(url/.test(html));
check('consoleRelease() が api_consoleRelease を呼ぶ', /function consoleRelease\(\)[\s\S]*?google\.script\.run\.api_consoleRelease\(\)/.test(html));
check('startExtensionKeepalive が consoleTouch を呼ぶ', /function startExtensionKeepalive\(\)[\s\S]*?consoleTouch\(\)/.test(html));
check('稼働を 15 秒ごとに再送する（GAS の失効窓 120 秒より十分細かい）',
  /setInterval\(\(\)\s*=>\s*\{[\s\S]{0,160}?consoleTouch\(\)[\s\S]{0,160}?\},\s*15000\)/.test(html));
check('stopExtensionKeepalive が consoleRelease を呼ぶ', /function stopExtensionKeepalive[\s\S]*?consoleRelease\(\)/.test(html));
check('showDashboard（ログイン）で稼働開始', /function showDashboard[\s\S]*?startExtensionKeepalive\(\)/.test(html));
check('showLoginView（ログアウト）で稼働停止', /function showLoginView[\s\S]*?stopExtensionKeepalive\(\)/.test(html));

console.log('===== 課題A: 拡張側のレート制御（稼働中=1.5秒） =====');
check('ACTIVE_SYNC_MS=1500（3秒以内反映の要）', /const ACTIVE_SYNC_MS = 1500;/.test(bgJs));
check('IDLE_SYNC_MS=15000（非稼働時の負荷削減）', /const IDLE_SYNC_MS = 15000;/.test(bgJs));
check('maybeSync が keepaliveActive で間隔を切替', /function maybeSync\(\)[\s\S]*?keepaliveActive \? ACTIVE_SYNC_MS : IDLE_SYNC_MS/.test(bgJs));
check('稼働へ切替時に即同期（lastSyncMs=0）', /if \(v\) lastSyncMs = 0;/.test(bgJs));
check('KEEPALIVE_PING が maybeSync を呼ぶ（非稼働時は doPost しない）', /message\.type === 'KEEPALIVE_PING'[\s\S]{0,200}?maybeSync\(\)/.test(bgJs));
check('ping を常時送る（教員ログインを約1.5秒で検知）',
  /window\.top === window[\s\S]{0,400}?setInterval\(\(\)\s*=>\s*\{[\s\S]{0,200}?KEEPALIVE_PING/.test(contentJs));
check('content.js に kaActive ガードが残っていない（常時ping）', !/if \(!kaActive\) return;/.test(contentJs));
check('lock.js も常時 ping（kaActive ガード無し）', !/if \(!kaActive\) return;/.test(lockJs) && /KEEPALIVE_PING/.test(lockJs));
check('blocked.js も常時 ping（kaActive ガード無し）', !/if \(!kaActive\) return;/.test(blockedJs) && /KEEPALIVE_PING/.test(blockedJs));

// ============ 課題B: 画像をセル上限内に縮小して保存 ============
console.log('===== 課題B: スプレッドシートのセル上限(50,000文字)対策 =====');
const mMax = codeGs.match(/const SCREENSHOT_MAX_BYTES = (\d+);/);
check('GAS の上限 SCREENSHOT_MAX_BYTES が定義されている', !!mMax, mMax && mMax[1]);
check('GAS の上限がセル上限 50,000 未満（これが超えると保存に失敗していた）', mMax && Number(mMax[1]) < 50000, mMax && mMax[1]);
check('拡張側の上限 SCREENSHOT_MAX_B64 が定義されている', /const SCREENSHOT_MAX_B64 = \d+;/.test(bgJs));
const mB64 = bgJs.match(/const SCREENSHOT_MAX_B64 = (\d+);/);
check('拡張側の上限も 50,000 未満', mB64 && Number(mB64[1]) < 50000, mB64 && mB64[1]);
check('GAS の上限が拡張側以上（受け入れ可能な整合）', mMax && mB64 && Number(mMax[1]) >= Number(mB64[1]), {gas:mMax&&mMax[1], ext:mB64&&mB64[1]});
check('縮小関数 downscaleForSheet がある', /function downscaleForSheet/.test(bgJs));
check('OffscreenCanvas + createImageBitmap で縮小する', /new OffscreenCanvas\(/.test(bgJs) && /createImageBitmap\(/.test(bgJs));
check('上限に収まるまで段階的に縮小（幅候補を順に試す）', /SCREENSHOT_WIDTHS/.test(bgJs) && /SCREENSHOT_QUALITIES/.test(bgJs));
check('縮小結果が上限以下かを判定して返す', /b64\.length <= SCREENSHOT_MAX_B64/.test(bgJs));
check('captureAndUploadScreenshot が縮小を経由する', /function captureAndUploadScreenshot[\s\S]*?downscaleForSheet\(raw\)/.test(bgJs));
check('縮小できなければ送信しない（壊れたデータを残さない）', /if \(!dataUrl\) \{[\s\S]{0,200}?return;/.test(bgJs));
check('GAS は保存後 has_image=true を返す（画面が表示される）', /has_image: ready/.test(codeGs));
check('GAS は画像データを1シートで upsert（1児童=1行）', /function processScreenshotUpload[\s\S]*?SCREENSHOT_SHEET_NAME/.test(codeGs));

// ============ 体感速度（ポーリング） ============
console.log('===== 表示の体感速度 =====');
check('画面情報のポーリングは 1 秒間隔（送信後すぐ表示）', /updateScreenFetchButton\(true, remaining\);\s*\n\s*\},\s*1000\);/.test(html));
check('ポーリング上限は約30秒（SCREEN_POLL_MAX=30）', /const SCREEN_POLL_MAX = 30;/.test(html));

console.log(`\n===== 結果: PASS=${pass} FAIL=${fail} =====`);
process.exit(fail?1:0);
