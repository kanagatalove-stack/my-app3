/**
 * Chromebook 児童端末管理システム - バックエンド (Google Apps Script)
 * スプレッドシートID: 1_zSGoaoyUqMNHY0rxuITIk25yAHDT7qrZwIj_024fPs
 */

// 設定定数
const CONFIG = {
  SPREADSHEET_ID: '1_zSGoaoyUqMNHY0rxuITIk25yAHDT7qrZwIj_024fPs',
  DEVICE_SHEET_NAME: '端末一覧',
  TEACHER_SHEET_NAME: '教員マスタ',
  
  // 美作市 14校
  SCHOOL_LIST: [
    '英田小学校',
    '大原小学校',
    '江見小学校',
    '勝田小学校',
    '勝田東小学校',
    '第一小学校',
    '北小学校',
    '土居小学校',
    '英田中学校',
    '大原中学校',
    '作東中学校',
    '勝田中学校',
    '美作中学校',
    '樸学園'
  ],

  // 端末一覧 列定義
  DEVICE_COLUMNS: [
    '児童ID',
    '学校名',
    '氏名',
    'クラス',
    '画面ロック',
    'URL規制モード',
    '許可URLリスト',
    '規制URLリスト',
    '一斉表示URL',
    '一斉表示実行ID',
    '現在開いているURL',
    '最終同期日時',
    '備考'
  ],

  // 教員マスタ 列定義
  TEACHER_COLUMNS: [
    '教員ID(メールアドレス)',
    'パスワード',
    '氏名',
    '所属学校',
    '権限',
    '対象クラス',
    '登録URL情報',
    '個別ホワイトリスト',
    '個別ブラックリスト',
    '最終ログイン日時'
  ]
};

/**
 * シートオブジェクトを取得
 */
function getTargetSheet(sheetName) {
  let ss;
  try {
    ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  } catch (err) {
    ss = SpreadsheetApp.getActiveSpreadsheet();
  }
  if (!ss) {
    throw new Error('スプレッドシートを開けませんでした。ID: ' + CONFIG.SPREADSHEET_ID);
  }

  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    if (sheetName === CONFIG.DEVICE_SHEET_NAME) {
      initializeDeviceHeaders(sheet);
    } else if (sheetName === CONFIG.TEACHER_SHEET_NAME) {
      initializeTeacherHeaders(sheet);
    }
  } else if (sheetName === CONFIG.TEACHER_SHEET_NAME) {
    // 既存教員マスタシートの場合、不足列（対象クラス、登録URL情報等）があれば自動補完
    ensureTeacherHeaders(sheet);
  }
  return sheet;
}

function initializeDeviceHeaders(sheet) {
  const range = sheet.getRange(1, 1, 1, CONFIG.DEVICE_COLUMNS.length);
  range.setValues([CONFIG.DEVICE_COLUMNS]);
  range.setBackground('#4f46e5');
  range.setFontColor('#ffffff');
  range.setFontWeight('bold');
  sheet.setFrozenRows(1);
}

function initializeTeacherHeaders(sheet) {
  const range = sheet.getRange(1, 1, 1, CONFIG.TEACHER_COLUMNS.length);
  range.setValues([CONFIG.TEACHER_COLUMNS]);
  range.setBackground('#059669'); // エメラルドグリーン
  range.setFontColor('#ffffff');
  range.setFontWeight('bold');
  sheet.setFrozenRows(1);
}

/**
 * 既存の教員マスタシートに新しい列（対象クラス、登録URL情報など）がなければ末尾に自動補完
 */
function ensureTeacherHeaders(sheet) {
  const lastCol = sheet.getLastColumn();
  if (lastCol === 0) {
    initializeTeacherHeaders(sheet);
    return;
  }
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim());
  CONFIG.TEACHER_COLUMNS.forEach(col => {
    if (!headers.includes(col)) {
      const newCol = sheet.getLastColumn() + 1;
      sheet.getRange(1, newCol).setValue(col)
        .setBackground('#059669')
        .setFontColor('#ffffff')
        .setFontWeight('bold');
    }
  });
}

function getHeaderMap(sheet, defaultColumns) {
  const lastCol = sheet.getLastColumn() || defaultColumns.length;
  const headerRow = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const map = {};
  headerRow.forEach((name, index) => {
    map[String(name).trim()] = index + 1; // 1-indexed
  });
  return map;
}

/**
 * 初期化関数: GASエディタから手動実行して全14校のサンプル児童データおよび教員マスタを自動生成
 */
function setupSpreadsheet() {
  // 1. 端末一覧シート
  const deviceSheet = getTargetSheet(CONFIG.DEVICE_SHEET_NAME);
  initializeDeviceHeaders(deviceSheet);

  if (deviceSheet.getLastRow() <= 1) {
    const sampleDevices = [
      ['aida-es-001', '英田小学校', '英田 太郎', '5年1組', false, 'OFF', 'nhk.or.jp, scratch.mit.edu', 'youtube.com', '', '', '', new Date(), ''],
      ['ohara-es-001', '大原小学校', '大原 一郎', '5年1組', false, 'OFF', 'nhk.or.jp, scratch.mit.edu', 'youtube.com', '', '', '', new Date(), ''],
      ['emi-es-001', '江見小学校', '江見 二郎', '5年1組', false, 'OFF', 'nhk.or.jp, scratch.mit.edu', 'youtube.com', '', '', '', new Date(), ''],
      ['katsuta-es-001', '勝田小学校', '勝田 三郎', '6年1組', false, 'OFF', 'nhk.or.jp, scratch.mit.edu', 'youtube.com', '', '', '', new Date(), ''],
      ['katsuta-e-001', '勝田東小学校', '東 四郎', '6年1組', false, 'OFF', 'nhk.or.jp, scratch.mit.edu', 'youtube.com', '', '', '', new Date(), ''],
      ['daiichi-es-001', '第一小学校', '第一 健太', '5年1組', false, 'OFF', 'nhk.or.jp, scratch.mit.edu', 'youtube.com', '', '', '', new Date(), ''],
      ['kita-es-001', '北小学校', '北 花子', '5年1組', false, 'OFF', 'nhk.or.jp, scratch.mit.edu', 'youtube.com', '', '', '', new Date(), ''],
      ['doi-es-001', '土居小学校', '土居 優子', '5年1組', false, 'OFF', 'nhk.or.jp, scratch.mit.edu', 'youtube.com', '', '', '', new Date(), ''],
      ['aida-jhs-001', '英田中学校', '英田 翔太', '1年A組', false, 'OFF', 'nhk.or.jp, scratch.mit.edu', 'youtube.com', '', '', '', new Date(), ''],
      ['ohara-jhs-001', '大原中学校', '大原 陸', '1年A組', false, 'OFF', 'nhk.or.jp, scratch.mit.edu', 'youtube.com', '', '', '', new Date(), ''],
      ['sakuto-jhs-001', '作東中学校', '作東 陽菜', '2年A組', false, 'OFF', 'nhk.or.jp, scratch.mit.edu', 'youtube.com', '', '', '', new Date(), ''],
      ['katsuta-jhs-001', '勝田中学校', '勝田 蓮', '2年A組', false, 'OFF', 'nhk.or.jp, scratch.mit.edu', 'youtube.com', '', '', '', new Date(), ''],
      ['mimasaka-jhs-001', '美作中学校', '美作 葵', '3年A組', false, 'OFF', 'nhk.or.jp, scratch.mit.edu', 'youtube.com', '', '', '', new Date(), ''],
      ['araki-001', '樸学園', '木村 さくら', '前期5年', false, 'OFF', 'nhk.or.jp, scratch.mit.edu', 'youtube.com', '', '', '', new Date(), '']
    ];
    deviceSheet.getRange(2, 1, sampleDevices.length, sampleDevices[0].length).setValues(sampleDevices);
  }

  // 2. 教員マスタシート
  const teacherSheet = getTargetSheet(CONFIG.TEACHER_SHEET_NAME);
  initializeTeacherHeaders(teacherSheet);

  if (teacherSheet.getLastRow() <= 1) {
    const defaultUrlsAdmin = JSON.stringify([
      { title: 'Scratch', url: 'https://scratch.mit.edu' },
      { title: 'NHK for School', url: 'https://www.nhk.or.jp/school/' },
      { title: 'Google Classroom', url: 'https://classroom.google.com' }
    ]);
    const defaultUrlsDaiichi = JSON.stringify([
      { title: 'Scratch プログラミング', url: 'https://scratch.mit.edu' },
      { title: 'NHK for School 理科', url: 'https://www.nhk.or.jp/school/' }
    ]);
    const defaultUrlsAida = JSON.stringify([
      { title: 'NHK for School', url: 'https://www.nhk.or.jp/school/' },
      { title: 'Google Classroom', url: 'https://classroom.google.com' }
    ]);

    const defaultWhitelist = 'nhk.or.jp, scratch.mit.edu, google.com';
    const defaultBlacklist = 'youtube.com, twitter.com, tiktok.com, instagram.com';

    const sampleTeachers = [
      ['admin@school.ed.jp', 'Admin1234!', '教育委員会 管理者', '全校管理', 'ADMIN', '全クラス', defaultUrlsAdmin, defaultWhitelist, defaultBlacklist, ''],
      ['teacher.daiichi@school.ed.jp', 'Teacher1234!', '第一小 担任教員', '第一小学校', 'TEACHER', '5年1組', defaultUrlsDaiichi, defaultWhitelist, defaultBlacklist, ''],
      ['teacher.aida@school.ed.jp', 'Teacher1234!', '英田小 担任教員', '英田小学校', 'TEACHER', '5年1組', defaultUrlsAida, defaultWhitelist, defaultBlacklist, '']
    ];
    teacherSheet.getRange(2, 1, sampleTeachers.length, sampleTeachers[0].length).setValues(sampleTeachers);
  }

  Logger.log('14校対応スプレッドシートのセットアップが完了しました。');
}

/**
 * Web App GETハンドラー
 */
function doGet(e) {
  try {
    const params = (e && e.parameter) || {};
    const api = params.api || '';

    // 1. 児童拡張機能からのハートビート (GET対応)
    if (api === 'heartbeat' || api === 'get_settings') {
      const studentId = params.student_id;
      const currentUrl = params.current_url || '';
      if (!studentId) return jsonResponse({ success: false, error: 'student_id is required' });
      return jsonResponse({ success: true, ...processHeartbeat(studentId, currentUrl) });
    }

    // 2. 教員ダッシュボード向けリスト取得 (要認証トークン)
    if (api === 'list') {
      const auth = verifyToken(params.token);
      if (!auth.valid) {
        return jsonResponse({ success: false, error: '認証が必要です。ログインし直してください。', need_auth: true });
      }
      const data = getAllDevices(params.school_name, auth.teacher, parseBoolean(params.include_unassigned));
      return jsonResponse({ success: true, data: data, teacher: auth.teacher });
    }

    // 3. 学校リスト取得 (ログイン画面等向け)
    if (api === 'schools') {
      return jsonResponse({ success: true, schools: CONFIG.SCHOOL_LIST });
    }

    // 4. HTML画面配信
    const template = HtmlService.createTemplateFromFile('index');
    let webAppUrl = '';
    try {
      webAppUrl = ScriptApp.getService().getUrl();
    } catch (urlErr) {
      webAppUrl = '';
    }
    template.webAppUrl = webAppUrl;

    return template.evaluate()
      .setTitle('Chromebook 児童端末管理システム (美作市14校)')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);

  } catch (err) {
    return jsonResponse({ success: false, error: err.toString() });
  }
}

/**
 * Web App POSTハンドラー
 */
function doPost(e) {
  try {
    let payload = {};
    if (e && e.postData && e.postData.contents) {
      try { payload = JSON.parse(e.postData.contents); } catch (err) { payload = e.parameter || {}; }
    } else if (e && e.parameter) {
      payload = e.parameter;
    }

    const action = payload.action || payload.api;

    // A. 児童拡張機能からのハートビート (認証不要・student_id必須)
    if (action === 'heartbeat') {
      const studentId = payload.student_id;
      const currentUrl = payload.current_url || '';
      if (!studentId) return jsonResponse({ success: false, error: 'student_id is required' });
      return jsonResponse({ success: true, ...processHeartbeat(studentId, currentUrl) });
    }

    // B. 教員ログイン認証
    if (action === 'login') {
      const email = (payload.email || '').trim().toLowerCase();
      const password = (payload.password || '').trim();
      return handleTeacherLogin(email, password);
    }

    // C. セッション検証
    if (action === 'verify_session') {
      const auth = verifyToken(payload.token);
      if (!auth.valid) return jsonResponse({ success: false });
      try {
        const latestTeacher = getTeacherSettings(auth.teacher.email);
        return jsonResponse({ success: true, teacher: latestTeacher });
      } catch (e) {
        return jsonResponse({ success: true, teacher: auth.teacher });
      }
    }

    // これ以降の教員操作アクションは認証トークン必須
    const auth = verifyToken(payload.token);
    if (!auth.valid) {
      return jsonResponse({ success: false, error: '認証セッションが無効です。再ログインしてください。', need_auth: true });
    }

    // D. 端末一覧取得
    if (action === 'get_all') {
      const data = getAllDevices(payload.school_name, auth.teacher, Boolean(payload.include_unassigned));
      return jsonResponse({ success: true, data: data });
    }

    // E. 一括画面ロック
    if (action === 'bulk_lock') {
      bulkUpdateScreenLock(payload.student_ids, Boolean(payload.locked));
      return jsonResponse({ success: true, message: `画面ロックを ${payload.locked ? 'ON' : 'OFF'} に更新しました` });
    }

    // F. 一斉URL配信
    if (action === 'bulk_broadcast') {
      const targetUrl = payload.url;
      if (!targetUrl) return jsonResponse({ success: false, error: '配信URLが空です' });
      const broadcastId = 'bc_' + new Date().getTime();
      bulkUpdateBroadcastUrl(payload.student_ids, targetUrl, broadcastId);
      return jsonResponse({ success: true, message: '一斉URLを配信しました', broadcast_id: broadcastId });
    }

    // G. URL規制一括変更
    if (action === 'bulk_filter') {
      bulkUpdateFilterMode(payload.student_ids, payload.filter_mode, payload.whitelist_urls, payload.blacklist_urls);
      // 教員アカウントの個別設定としても保持
      if (auth && auth.teacher && auth.teacher.email) {
        try {
          saveTeacherSettings(auth.teacher.email, {
            filter_whitelist: payload.whitelist_urls,
            filter_blacklist: payload.blacklist_urls
          });
        } catch (saveErr) {
          Logger.log('教員規制設定保存スキップ: ' + saveErr);
        }
      }
      return jsonResponse({ success: true, message: `URL規制モードを ${payload.filter_mode} に更新しました` });
    }

    // H. 単一児童端末の更新
    if (action === 'update_single') {
      updateSingleDevice(payload.student_id, payload.data || {});
      return jsonResponse({ success: true, message: '設定を更新しました' });
    }

    // I. 教員アカウント設定の保存（対象クラス・登録URL情報・個別規制URLの更新）
    if (action === 'save_teacher_settings' || action === 'update_teacher_settings') {
      const updatedTeacher = saveTeacherSettings(auth.teacher.email, payload.settings || payload);
      return jsonResponse({ success: true, message: '教員設定を保存しました', teacher: updatedTeacher });
    }

    // J. 教員アカウント設定の取得
    if (action === 'get_teacher_settings') {
      const teacher = getTeacherSettings(auth.teacher.email);
      return jsonResponse({ success: true, teacher: teacher });
    }

    return jsonResponse({ success: false, error: 'Unknown action: ' + action });

  } catch (err) {
    return jsonResponse({ success: false, error: err.toString() });
  }
}

/**
 * 教員ログイン認証処理
 */
function handleTeacherLogin(email, password) {
  if (!email || !password) {
    return jsonResponse({ success: false, error: 'メールアドレスとパスワードを入力してください' });
  }

  const sheet = getTargetSheet(CONFIG.TEACHER_SHEET_NAME);
  ensureTeacherHeaders(sheet);
  const headerMap = getHeaderMap(sheet, CONFIG.TEACHER_COLUMNS);
  const data = sheet.getDataRange().getValues();

  const emailColIdx = headerMap['教員ID(メールアドレス)'] - 1;
  const pwColIdx = headerMap['パスワード'] - 1;

  for (let i = 1; i < data.length; i++) {
    const rowEmail = String(data[i][emailColIdx] || '').trim().toLowerCase();
    const rowPw = String(data[i][pwColIdx] || '').trim();

    if (rowEmail === email && rowPw === password) {
      // ログイン成功: 最終ログイン日時を記録
      const nowStr = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');
      if (headerMap['最終ログイン日時']) {
        sheet.getRange(i + 1, headerMap['最終ログイン日時']).setValue(nowStr);
      }

      const defaultWhitelist = 'nhk.or.jp, scratch.mit.edu, google.com';
      const defaultBlacklist = 'youtube.com, twitter.com, tiktok.com, instagram.com';

      const teacher = {
        email: rowEmail,
        name: String(data[i][headerMap['氏名'] - 1] || '教員'),
        school: String(data[i][headerMap['所属学校'] - 1] || '全校管理'),
        role: String(data[i][headerMap['権限'] - 1] || 'TEACHER'),
        target_class: String(data[i][headerMap['対象クラス'] - 1] || ''),
        urls: parseTeacherUrls(data[i][headerMap['登録URL情報'] - 1]),
        filter_whitelist: String(data[i][headerMap['個別ホワイトリスト'] - 1] || defaultWhitelist),
        filter_blacklist: String(data[i][headerMap['個別ブラックリスト'] - 1] || defaultBlacklist)
      };

      const token = generateToken(teacher);
      return jsonResponse({
        success: true,
        token: token,
        teacher: teacher,
        schools: CONFIG.SCHOOL_LIST
      });
    }
  }

  return jsonResponse({ success: false, error: 'メールアドレスまたはパスワードが正しくありません' });
}

/**
 * 簡易署名トークンの生成（24時間有効）
 */
function generateToken(teacher) {
  const payload = {
    email: teacher.email,
    name: teacher.name,
    school: teacher.school,
    role: teacher.role,
    target_class: teacher.target_class || '',
    exp: new Date().getTime() + (24 * 60 * 60 * 1000) // 24h
  };
  const jsonStr = JSON.stringify(payload);
  const base64 = Utilities.base64EncodeWebSafe(jsonStr);
  const signature = Utilities.computeHmacSha256Signature(base64, CONFIG.SPREADSHEET_ID);
  const sigBase64 = Utilities.base64EncodeWebSafe(signature);
  return `${base64}.${sigBase64}`;
}

/**
 * トークンの検証
 */
function verifyToken(token) {
  if (!token) return { valid: false };
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return { valid: false };

    const base64 = parts[0];
    const signature = parts[1];

    const expectedSig = Utilities.computeHmacSha256Signature(base64, CONFIG.SPREADSHEET_ID);
    const expectedSigBase64 = Utilities.base64EncodeWebSafe(expectedSig);

    if (signature !== expectedSigBase64) return { valid: false };

    const decoded = Utilities.newBlob(Utilities.base64DecodeWebSafe(base64)).getDataAsString();
    const payload = JSON.parse(decoded);

    if (new Date().getTime() > payload.exp) return { valid: false }; // 期限切れ

    return {
      valid: true,
      teacher: {
        email: payload.email,
        name: payload.name,
        school: payload.school,
        role: payload.role,
        target_class: payload.target_class || ''
      }
    };
  } catch (e) {
    return { valid: false };
  }
}

/**
 * 教員アカウントの登録URL情報のパース
 */
function parseTeacherUrls(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  const str = String(val).trim();
  if (!str) return [];
  try {
    const parsed = JSON.parse(str);
    if (Array.isArray(parsed)) {
      return parsed.map(item => {
        if (typeof item === 'string') return { title: item, url: item };
        return {
          title: String(item.title || item.name || item.url || 'URL'),
          url: String(item.url || '')
        };
      }).filter(item => item.url.length > 0);
    }
  } catch (e) {
    const lines = str.split(/[\r\n,]+/).map(s => s.trim()).filter(Boolean);
    return lines.map(line => {
      const parts = line.split('|');
      if (parts.length >= 2) {
        return { title: parts[0].trim(), url: parts[1].trim() };
      }
      return { title: line, url: line };
    });
  }
  return [];
}

/**
 * 教員アカウントの登録URL情報のシリアライズ
 */
function serializeTeacherUrls(urls) {
  if (!urls) return '[]';
  if (typeof urls === 'string') {
    try {
      const p = JSON.parse(urls);
      if (Array.isArray(p)) return JSON.stringify(p);
    } catch (e) {
      return JSON.stringify(parseTeacherUrls(urls));
    }
    return urls;
  }
  if (Array.isArray(urls)) {
    const cleanList = urls.map(item => {
      if (typeof item === 'string') return { title: item, url: item };
      return {
        title: String(item.title || item.url || 'URL').trim(),
        url: String(item.url || '').trim()
      };
    }).filter(item => item.url.length > 0);
    return JSON.stringify(cleanList);
  }
  return '[]';
}

/**
 * 教員アカウントの設定（対象クラス・登録URL・氏名）を取得
 */
function getTeacherSettings(email) {
  if (!email) throw new Error('教員メールアドレスが指定されていません');

  const sheet = getTargetSheet(CONFIG.TEACHER_SHEET_NAME);
  ensureTeacherHeaders(sheet);
  const headerMap = getHeaderMap(sheet, CONFIG.TEACHER_COLUMNS);
  const data = sheet.getDataRange().getValues();
  const emailColIdx = headerMap['教員ID(メールアドレス)'] - 1;

  for (let i = 1; i < data.length; i++) {
    const rowEmail = String(data[i][emailColIdx] || '').trim().toLowerCase();
    if (rowEmail === email.toLowerCase()) {
      const defaultWhitelist = 'nhk.or.jp, scratch.mit.edu, google.com';
      const defaultBlacklist = 'youtube.com, twitter.com, tiktok.com, instagram.com';
      return {
        email: rowEmail,
        name: String(data[i][headerMap['氏名'] - 1] || '教員'),
        school: String(data[i][headerMap['所属学校'] - 1] || '全校管理'),
        role: String(data[i][headerMap['権限'] - 1] || 'TEACHER'),
        target_class: String(data[i][headerMap['対象クラス'] - 1] || ''),
        urls: parseTeacherUrls(data[i][headerMap['登録URL情報'] - 1]),
        filter_whitelist: String(data[i][headerMap['個別ホワイトリスト'] - 1] || defaultWhitelist),
        filter_blacklist: String(data[i][headerMap['個別ブラックリスト'] - 1] || defaultBlacklist)
      };
    }
  }
  throw new Error('教員アカウントが見つかりません: ' + email);
}

/**
 * 教員アカウントの設定（対象クラス・登録URL・個別規制URL・氏名）を保存
 */
function saveTeacherSettings(email, updateData) {
  if (!email) throw new Error('教員メールアドレスが指定されていません');

  const sheet = getTargetSheet(CONFIG.TEACHER_SHEET_NAME);
  ensureTeacherHeaders(sheet);
  const headerMap = getHeaderMap(sheet, CONFIG.TEACHER_COLUMNS);
  const data = sheet.getDataRange().getValues();
  const emailColIdx = headerMap['教員ID(メールアドレス)'] - 1;

  let targetRow = -1;
  for (let i = 1; i < data.length; i++) {
    const rowEmail = String(data[i][emailColIdx] || '').trim().toLowerCase();
    if (rowEmail === email.toLowerCase()) {
      targetRow = i + 1;
      break;
    }
  }

  if (targetRow === -1) {
    throw new Error('教員アカウントが見つかりません: ' + email);
  }

  if (updateData.target_class !== undefined && headerMap['対象クラス']) {
    sheet.getRange(targetRow, headerMap['対象クラス']).setValue(String(updateData.target_class).trim());
  }

  if (updateData.urls !== undefined && headerMap['登録URL情報']) {
    sheet.getRange(targetRow, headerMap['登録URL情報']).setValue(serializeTeacherUrls(updateData.urls));
  }

  if (updateData.filter_whitelist !== undefined && headerMap['個別ホワイトリスト']) {
    sheet.getRange(targetRow, headerMap['個別ホワイトリスト']).setValue(String(updateData.filter_whitelist).trim());
  }

  if (updateData.filter_blacklist !== undefined && headerMap['個別ブラックリスト']) {
    sheet.getRange(targetRow, headerMap['個別ブラックリスト']).setValue(String(updateData.filter_blacklist).trim());
  }

  if (updateData.name !== undefined && headerMap['氏名']) {
    sheet.getRange(targetRow, headerMap['氏名']).setValue(String(updateData.name).trim());
  }

  return getTeacherSettings(email);
}

/**
 * 児童端末からのハートビート処理
 */
function processHeartbeat(studentId, currentUrl) {
  const sheet = getTargetSheet(CONFIG.DEVICE_SHEET_NAME);
  const headerMap = getHeaderMap(sheet, CONFIG.DEVICE_COLUMNS);
  const data = sheet.getDataRange().getValues();

  let targetRow = -1;
  const idColIdx = headerMap['児童ID'] - 1;

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idColIdx]).trim() === String(studentId).trim()) {
      targetRow = i + 1;
      break;
    }
  }

  const now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');

  if (targetRow !== -1) {
    if (headerMap['現在開いているURL']) {
      sheet.getRange(targetRow, headerMap['現在開いているURL']).setValue(currentUrl);
    }
    if (headerMap['最終同期日時']) {
      sheet.getRange(targetRow, headerMap['最終同期日時']).setValue(now);
    }

    const row = sheet.getRange(targetRow, 1, 1, sheet.getLastColumn()).getValues()[0];
    return {
      student_id: studentId,
      school_name: row[headerMap['学校名'] - 1] || '',
      student_name: row[headerMap['氏名'] - 1] || '',
      class_name: row[headerMap['クラス'] - 1] || '',
      screen_lock: parseBoolean(row[headerMap['画面ロック'] - 1]),
      filter_mode: String(row[headerMap['URL規制モード'] - 1] || 'OFF').toUpperCase(),
      whitelist_urls: parseUrlList(row[headerMap['許可URLリスト'] - 1]),
      blacklist_urls: parseUrlList(row[headerMap['規制URLリスト'] - 1]),
      broadcast_url: String(row[headerMap['一斉表示URL'] - 1] || '').trim(),
      broadcast_id: String(row[headerMap['一斉表示実行ID'] - 1] || '').trim(),
      server_time: now
    };
  } else {
    // 新規自動登録（児童Googleアカウント対応）
    let initialName = '未登録児童 (' + studentId + ')';
    if (studentId.includes('@')) {
      const userPart = studentId.split('@')[0];
      initialName = userPart + ' (Googleアカウント)';
    }

    const newRow = new Array(CONFIG.DEVICE_COLUMNS.length).fill('');
    newRow[headerMap['児童ID'] - 1] = studentId;
    newRow[headerMap['学校名'] - 1] = '未設定';
    newRow[headerMap['氏名'] - 1] = initialName;
    newRow[headerMap['クラス'] - 1] = '未設定';
    newRow[headerMap['画面ロック'] - 1] = false;
    newRow[headerMap['URL規制モード'] - 1] = 'OFF';
    newRow[headerMap['許可URLリスト'] - 1] = 'nhk.or.jp, scratch.mit.edu, google.com';
    newRow[headerMap['規制URLリスト'] - 1] = 'youtube.com, twitter.com, tiktok.com, instagram.com';
    newRow[headerMap['現在開いているURL'] - 1] = currentUrl;
    newRow[headerMap['最終同期日時'] - 1] = now;

    sheet.appendRow(newRow);

    return {
      student_id: studentId,
      school_name: '未設定',
      student_name: initialName,
      class_name: '未設定',
      screen_lock: false,
      filter_mode: 'OFF',
      whitelist_urls: ['nhk.or.jp', 'scratch.mit.edu', 'google.com'],
      blacklist_urls: ['youtube.com', 'twitter.com', 'tiktok.com', 'instagram.com'],
      broadcast_url: '',
      broadcast_id: '',
      server_time: now
    };
  }
}

/**
 * 全端末一覧取得（学校フィルター対応）
 */
function getAllDevices(filterSchool, teacher, includeUnassigned) {
  const sheet = getTargetSheet(CONFIG.DEVICE_SHEET_NAME);
  const headerMap = getHeaderMap(sheet, CONFIG.DEVICE_COLUMNS);
  const data = sheet.getDataRange().getValues();

  if (data.length <= 1) return [];

  const results = [];
  const now = new Date().getTime();

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const studentId = String(row[headerMap['児童ID'] - 1] || '').trim();
    if (!studentId) continue;

    const schoolName = String(row[headerMap['学校名'] - 1] || '').trim();

    // 学校絞り込み
    if (filterSchool && filterSchool !== 'ALL') {
      if (filterSchool === 'UNASSIGNED') {
        if (schoolName && schoolName !== '未設定') continue;
      } else if (includeUnassigned) {
        if (schoolName !== filterSchool && schoolName !== '未設定' && schoolName !== '') continue;
      } else {
        if (schoolName !== filterSchool) continue;
      }
    }

    const lastSeenStr = row[headerMap['最終同期日時'] - 1];
    let isOnline = false;
    if (lastSeenStr) {
      const dt = new Date(lastSeenStr);
      if (!isNaN(dt.getTime())) isOnline = (now - dt.getTime()) < 60000;
    }

    results.push({
      student_id: studentId,
      school_name: schoolName,
      student_name: String(row[headerMap['氏名'] - 1] || ''),
      class_name: String(row[headerMap['クラス'] - 1] || ''),
      screen_lock: parseBoolean(row[headerMap['画面ロック'] - 1]),
      filter_mode: String(row[headerMap['URL規制モード'] - 1] || 'OFF').toUpperCase(),
      whitelist_urls: String(row[headerMap['許可URLリスト'] - 1] || ''),
      blacklist_urls: String(row[headerMap['規制URLリスト'] - 1] || ''),
      broadcast_url: String(row[headerMap['一斉表示URL'] - 1] || ''),
      broadcast_id: String(row[headerMap['一斉表示実行ID'] - 1] || ''),
      current_url: String(row[headerMap['現在開いているURL'] - 1] || ''),
      last_seen: lastSeenStr ? String(lastSeenStr) : '',
      is_online: isOnline,
      notes: String(row[headerMap['備考'] - 1] || '')
    });
  }

  return results;
}

function bulkUpdateScreenLock(studentIds, lockState) {
  const sheet = getTargetSheet(CONFIG.DEVICE_SHEET_NAME);
  const headerMap = getHeaderMap(sheet, CONFIG.DEVICE_COLUMNS);
  const data = sheet.getDataRange().getValues();
  const lockCol = headerMap['画面ロック'];
  const idColIdx = headerMap['児童ID'] - 1;

  const isAll = (studentIds === 'ALL' || !Array.isArray(studentIds));
  const idSet = Array.isArray(studentIds) ? new Set(studentIds) : null;

  for (let i = 1; i < data.length; i++) {
    const id = String(data[i][idColIdx]).trim();
    if (isAll || (idSet && idSet.has(id))) {
      sheet.getRange(i + 1, lockCol).setValue(lockState);
    }
  }
}

function bulkUpdateBroadcastUrl(studentIds, targetUrl, broadcastId) {
  const sheet = getTargetSheet(CONFIG.DEVICE_SHEET_NAME);
  const headerMap = getHeaderMap(sheet, CONFIG.DEVICE_COLUMNS);
  const data = sheet.getDataRange().getValues();
  const urlCol = headerMap['一斉表示URL'];
  const bcIdCol = headerMap['一斉表示実行ID'];
  const idColIdx = headerMap['児童ID'] - 1;

  const isAll = (studentIds === 'ALL' || !Array.isArray(studentIds));
  const idSet = Array.isArray(studentIds) ? new Set(studentIds) : null;

  for (let i = 1; i < data.length; i++) {
    const id = String(data[i][idColIdx]).trim();
    if (isAll || (idSet && idSet.has(id))) {
      sheet.getRange(i + 1, urlCol).setValue(targetUrl);
      sheet.getRange(i + 1, bcIdCol).setValue(broadcastId);
    }
  }
}

function bulkUpdateFilterMode(studentIds, filterMode, whitelistUrls, blacklistUrls) {
  const sheet = getTargetSheet(CONFIG.DEVICE_SHEET_NAME);
  const headerMap = getHeaderMap(sheet, CONFIG.DEVICE_COLUMNS);
  const data = sheet.getDataRange().getValues();
  const modeCol = headerMap['URL規制モード'];
  const whiteCol = headerMap['許可URLリスト'];
  const blackCol = headerMap['規制URLリスト'];
  const idColIdx = headerMap['児童ID'] - 1;

  const isAll = (studentIds === 'ALL' || !Array.isArray(studentIds));
  const idSet = Array.isArray(studentIds) ? new Set(studentIds) : null;

  for (let i = 1; i < data.length; i++) {
    const id = String(data[i][idColIdx]).trim();
    if (isAll || (idSet && idSet.has(id))) {
      sheet.getRange(i + 1, modeCol).setValue(filterMode);
      if (whitelistUrls !== undefined && whitelistUrls !== null) {
        sheet.getRange(i + 1, whiteCol).setValue(whitelistUrls);
      }
      if (blacklistUrls !== undefined && blacklistUrls !== null) {
        sheet.getRange(i + 1, blackCol).setValue(blacklistUrls);
      }
    }
  }
}

function updateSingleDevice(studentId, updateData) {
  const sheet = getTargetSheet(CONFIG.DEVICE_SHEET_NAME);
  const headerMap = getHeaderMap(sheet, CONFIG.DEVICE_COLUMNS);
  const data = sheet.getDataRange().getValues();
  const idColIdx = headerMap['児童ID'] - 1;

  let targetRow = -1;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idColIdx]).trim() === String(studentId).trim()) {
      targetRow = i + 1;
      break;
    }
  }

  if (targetRow === -1) throw new Error('児童IDが見つかりません: ' + studentId);

  if (updateData.screen_lock !== undefined && headerMap['画面ロック']) {
    sheet.getRange(targetRow, headerMap['画面ロック']).setValue(Boolean(updateData.screen_lock));
  }
  if (updateData.filter_mode !== undefined && headerMap['URL規制モード']) {
    sheet.getRange(targetRow, headerMap['URL規制モード']).setValue(updateData.filter_mode);
  }
  if (updateData.whitelist_urls !== undefined && headerMap['許可URLリスト']) {
    sheet.getRange(targetRow, headerMap['許可URLリスト']).setValue(updateData.whitelist_urls);
  }
  if (updateData.blacklist_urls !== undefined && headerMap['規制URLリスト']) {
    sheet.getRange(targetRow, headerMap['規制URLリスト']).setValue(updateData.blacklist_urls);
  }
  if (updateData.broadcast_url !== undefined && headerMap['一斉表示URL']) {
    sheet.getRange(targetRow, headerMap['一斉表示URL']).setValue(updateData.broadcast_url);
    const bcId = 'bc_' + new Date().getTime();
    sheet.getRange(targetRow, headerMap['一斉表示実行ID']).setValue(bcId);
  }
  if (updateData.student_name !== undefined && headerMap['氏名']) {
    sheet.getRange(targetRow, headerMap['氏名']).setValue(String(updateData.student_name).trim());
  }
  if (updateData.class_name !== undefined && headerMap['クラス']) {
    sheet.getRange(targetRow, headerMap['クラス']).setValue(String(updateData.class_name).trim());
  }
  if (updateData.school_name !== undefined && headerMap['学校名']) {
    sheet.getRange(targetRow, headerMap['学校名']).setValue(String(updateData.school_name).trim());
  }
  if (updateData.notes !== undefined && headerMap['備考']) {
    sheet.getRange(targetRow, headerMap['備考']).setValue(String(updateData.notes).trim());
  }
}

function parseBoolean(val) {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'string') {
    const s = val.trim().toUpperCase();
    return s === 'TRUE' || s === '1' || s === 'ON';
  }
  if (typeof val === 'number') return val === 1;
  return false;
}

function parseUrlList(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  return String(val).split(/[\r\n,]+/).map(s => s.trim().toLowerCase()).filter(s => s.length > 0);
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ==================== google.script.run 用エクスポート関数 ====================

function api_login(email, password) {
  try {
    const res = handleTeacherLogin(email, password);
    return JSON.parse(res.getContent());
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

function api_getAllDevices(token, schoolName, includeUnassigned) {
  try {
    const auth = verifyToken(token);
    if (!auth.valid) return { success: false, need_auth: true, error: '認証セッションが無効です' };
    const data = getAllDevices(schoolName, auth.teacher, Boolean(includeUnassigned));
    return { success: true, data: data };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

function api_bulkLock(token, studentIds, locked) {
  try {
    const auth = verifyToken(token);
    if (!auth.valid) return { success: false, need_auth: true, error: '認証セッションが無効です' };
    bulkUpdateScreenLock(studentIds, Boolean(locked));
    return { success: true, message: `画面ロックを ${locked ? 'ON' : 'OFF'} に更新しました` };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

function api_bulkBroadcast(token, studentIds, url) {
  try {
    const auth = verifyToken(token);
    if (!auth.valid) return { success: false, need_auth: true, error: '認証セッションが無効です' };
    if (!url) return { success: false, error: 'URLが空です' };
    const bcId = 'bc_' + new Date().getTime();
    bulkUpdateBroadcastUrl(studentIds, url, bcId);
    return { success: true, broadcast_id: bcId };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

function api_bulkFilter(token, studentIds, mode, whitelist, blacklist) {
  try {
    const auth = verifyToken(token);
    if (!auth.valid) return { success: false, need_auth: true, error: '認証セッションが無効です' };
    bulkUpdateFilterMode(studentIds, mode, whitelist, blacklist);
    try {
      saveTeacherSettings(auth.teacher.email, {
        filter_whitelist: whitelist,
        filter_blacklist: blacklist
      });
    } catch (e) {
      Logger.log('教員規制設定保存エラー: ' + e);
    }
    return { success: true, message: `URL規制モードを ${mode} に更新しました` };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

function api_updateSingle(token, studentId, data) {
  try {
    const auth = verifyToken(token);
    if (!auth.valid) return { success: false, need_auth: true, error: '認証セッションが無効です' };
    updateSingleDevice(studentId, data || {});
    return { success: true, message: '設定を更新しました' };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

function api_saveTeacherSettings(token, settings) {
  try {
    const auth = verifyToken(token);
    if (!auth.valid) return { success: false, need_auth: true, error: '認証セッションが無効です' };
    const updatedTeacher = saveTeacherSettings(auth.teacher.email, settings || {});
    return { success: true, message: '教員設定を保存しました', teacher: updatedTeacher };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

function api_getTeacherSettings(token) {
  try {
    const auth = verifyToken(token);
    if (!auth.valid) return { success: false, need_auth: true, error: '認証セッションが無効です' };
    const teacher = getTeacherSettings(auth.teacher.email);
    return { success: true, teacher: teacher };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}


