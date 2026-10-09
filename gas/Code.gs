/**
 * Chromebook 児童端末管理システム - バックエンド (Google Apps Script)
 * スプレッドシートID: 1_zSGoaoyUqMNHY0rxuITIk25yAHDT7qrZwIj_024fPs
 */

// 設定定数
const CONFIG = {
  SPREADSHEET_ID: '1_zSGoaoyUqMNHY0rxuITIk25yAHDT7qrZwIj_024fPs',
  DEVICE_SHEET_NAME: '端末一覧',
  TEACHER_SHEET_NAME: '教員マスタ',
  ARCHIVE_SHEET_NAME: '卒業生', // 年次更新で卒業した児童のアーカイブ用
  // 画面一覧（スクリーンショット）用シート。全児童の画像をこの1シートで管理する
  // （1児童=1行。児童IDで上書き更新するため行は増え続けない）。
  // ※ この定数が欠けると getTargetSheet(undefined) が毎回 insertSheet して
  //    空シートが増え続けるため、必ず定義しておくこと。
  SCREENSHOT_SHEET_NAME: '画面情報',
  
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
    '備考',
    // 画面一覧（押下時のみ取得）用の制御列。
    // 教員が「画面情報取得」を押すと要求日時が入り、児童端末がそれを検知して
    // スクリーンショットを撮影・アップロードする（結果は 画面情報 シートに保存）。
    '画面情報要求日時',
    '画面情報更新日時'
  ],

  // 画面情報 シート列定義（スクリーンショット本体を保持）
  SCREENSHOT_COLUMNS: [
    '児童ID',
    '更新日時',
    'MIMEタイプ',
    '画像データ(Base64)'
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

  // シート名が未定義だと getSheetByName(undefined)→insertSheet(undefined) となり
  // 空シートが増え続けてしまう。定義漏れをここで明確に検知して止める（安全弁）。
  if (!sheetName || typeof sheetName !== 'string') {
    throw new Error('シート名が未定義です。CONFIG の *_SHEET_NAME を確認してください。');
  }

  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    if (sheetName === CONFIG.DEVICE_SHEET_NAME) {
      initializeDeviceHeaders(sheet);
    } else if (sheetName === CONFIG.TEACHER_SHEET_NAME) {
      initializeTeacherHeaders(sheet);
    } else if (sheetName === CONFIG.ARCHIVE_SHEET_NAME) {
      initializeDeviceHeaders(sheet); // 卒業生アーカイブは端末一覧と同一の列構成
    } else if (sheetName === CONFIG.SCREENSHOT_SHEET_NAME) {
      initializeScreenshotHeaders(sheet);
    }
  } else if (sheetName === CONFIG.TEACHER_SHEET_NAME) {
    // 既存教員マスタシートの場合、不足列（対象クラス、登録URL情報等）があれば自動補完
    ensureTeacherHeaders(sheet);
  } else if (sheetName === CONFIG.DEVICE_SHEET_NAME) {
    // 既存端末一覧シートに画面一覧用の列が無ければ自動補完（既存運用の後方互換）
    ensureDeviceHeaders(sheet);
  } else if (sheetName === CONFIG.SCREENSHOT_SHEET_NAME) {
    ensureScreenshotHeaders(sheet);
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

/**
 * 既存の端末一覧シートに不足列（画面情報要求日時・画面情報更新日時）があれば末尾に自動補完。
 * これにより、既に運用中のスプレッドシートでもコード更新だけで画面一覧機能が使える。
 */
function ensureDeviceHeaders(sheet) {
  const lastCol = sheet.getLastColumn();
  if (lastCol === 0) {
    initializeDeviceHeaders(sheet);
    return;
  }
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim());
  CONFIG.DEVICE_COLUMNS.forEach(col => {
    if (!headers.includes(col)) {
      const newCol = sheet.getLastColumn() + 1;
      sheet.getRange(1, newCol).setValue(col)
        .setBackground('#4f46e5')
        .setFontColor('#ffffff')
        .setFontWeight('bold');
    }
  });
}

function initializeScreenshotHeaders(sheet) {
  const range = sheet.getRange(1, 1, 1, CONFIG.SCREENSHOT_COLUMNS.length);
  range.setValues([CONFIG.SCREENSHOT_COLUMNS]);
  range.setBackground('#0ea5e9'); // スカイブルー
  range.setFontColor('#ffffff');
  range.setFontWeight('bold');
  sheet.setFrozenRows(1);
}

function ensureScreenshotHeaders(sheet) {
  const lastCol = sheet.getLastColumn();
  if (lastCol === 0) {
    initializeScreenshotHeaders(sheet);
    return;
  }
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim());
  CONFIG.SCREENSHOT_COLUMNS.forEach(col => {
    if (!headers.includes(col)) {
      const newCol = sheet.getLastColumn() + 1;
      sheet.getRange(1, newCol).setValue(col)
        .setBackground('#0ea5e9')
        .setFontColor('#ffffff')
        .setFontWeight('bold');
    }
  });
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

    // A2. 児童拡張機能からの画面情報（スクリーンショット）アップロード
    //     ハートビートと同じく認証不要（児童端末にはトークンが無いため）。
    //     教員が「画面情報取得」を押した児童の端末だけが、要求を検知して送信する。
    if (action === 'screenshot' || action === 'upload_screenshot') {
      const studentId = payload.student_id;
      const imageData = payload.image_data || payload.data_url || '';
      const mimeType = payload.mime_type || payload.mime || '';
      const res = processScreenshotUpload(studentId, imageData, mimeType);
      return jsonResponse(res);
    }

    // A3. 教員コンソールの稼働通知（ログイン中は 30 秒ごとに touch、ログアウトで release）。
    //     児童端末はハートビート応答の ka_active を見て同期周期を切り替える。
    //     ※ 認証不要（トークンを持たない経路もあるため）。稼働時刻を記録するだけの軽量処理。
    if (action === 'console_touch') {
      return jsonResponse(touchTeacherConsole());
    }
    if (action === 'console_release') {
      return jsonResponse(releaseTeacherConsole());
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

    // トークン内の教員情報は発行時点のスナップショットのため、
    // 教員マスタの最新レコード（所属学校・権限）で解決し直す。
    // 管理者が所属学校/権限を後から変更しても、直ちに正しいスコープで判定する。
    const currentTeacher = resolveCurrentTeacher(auth.teacher);

    // D. 端末一覧取得
    if (action === 'get_all') {
      const data = getAllDevices(payload.school_name, currentTeacher, Boolean(payload.include_unassigned));
      return jsonResponse({ success: true, data: data });
    }

    // D2. 画面情報取得要求（押下時のみ）：対象児童に要求IDを書き込む
    if (action === 'request_screens') {
      const result = requestScreenCapture(payload.student_ids, currentTeacher);
      if (result.requested === 0) {
        return jsonResponse({ success: false, error: '画面情報を要求できる児童がいません（自校の児童のみ対象）' });
      }
      return jsonResponse({ success: true, message: `${result.requested} 台の画面情報取得を要求しました`, result: result });
    }

    // D3. 画面情報一覧取得（画像付き）：console の「画面一覧」タブ表示に使用
    if (action === 'get_screens') {
      const status = payload.status || 'all';
      const data = getScreenshots(payload.school_name, currentTeacher, Boolean(payload.include_unassigned), status, payload.student_ids);
      return jsonResponse({ success: true, data: data });
    }

    // E. 一括画面ロック（教員の所属学校スコープを適用）
    if (action === 'bulk_lock') {
      const scoped = scopeStudentIdsForTeacher(payload.student_ids, currentTeacher);
      if (Array.isArray(scoped.ids) && scoped.ids.length === 0) {
        return jsonResponse({ success: false, error: '操作対象の児童がありません（自校の児童のみ操作できます）' });
      }
      bulkUpdateScreenLock(scoped.ids, Boolean(payload.locked));
      return jsonResponse({ success: true, message: `画面ロックを ${payload.locked ? 'ON' : 'OFF'} に更新しました` });
    }

    // F. 一斉URL配信（教員の所属学校スコープを適用）
    if (action === 'bulk_broadcast') {
      const targetUrl = payload.url;
      if (!targetUrl) return jsonResponse({ success: false, error: '配信URLが空です' });
      const scoped = scopeStudentIdsForTeacher(payload.student_ids, currentTeacher);
      if (Array.isArray(scoped.ids) && scoped.ids.length === 0) {
        return jsonResponse({ success: false, error: '操作対象の児童がありません（自校の児童のみ操作できます）' });
      }
      const broadcastId = bulkUpdateBroadcastUrl(scoped.ids, targetUrl, '');
      return jsonResponse({ success: true, message: '一斉URLを配信しました', broadcast_id: broadcastId });
    }

    // G. URL規制一括変更（教員の所属学校スコープを適用）
    if (action === 'bulk_filter') {
      const scoped = scopeStudentIdsForTeacher(payload.student_ids, currentTeacher);
      if (Array.isArray(scoped.ids) && scoped.ids.length === 0) {
        return jsonResponse({ success: false, error: '操作対象の児童がありません（自校の児童のみ操作できます）' });
      }
      bulkUpdateFilterMode(scoped.ids, payload.filter_mode, payload.whitelist_urls, payload.blacklist_urls);
      // 教員アカウントの個別設定としても保持
      if (currentTeacher && currentTeacher.email) {
        try {
          saveTeacherSettings(currentTeacher.email, {
            filter_whitelist: payload.whitelist_urls,
            filter_blacklist: payload.blacklist_urls
          });
        } catch (saveErr) {
          Logger.log('教員規制設定保存スキップ: ' + saveErr);
        }
      }
      return jsonResponse({ success: true, message: `URL規制モードを ${payload.filter_mode} に更新しました` });
    }

    // H. 単一児童端末の更新（他校の児童は更新不可）
    if (action === 'update_single') {
      const targetStudent = getDeviceByStudentId(payload.student_id);
      if (!targetStudent) {
        return jsonResponse({ success: false, error: '児童IDが見つかりません: ' + payload.student_id });
      }
      if (!isDeviceInTeacherScope(targetStudent.school_name, currentTeacher, targetStudent.class_name)) {
        return jsonResponse({ success: false, error: '対象外の児童は操作できません（学校・対象クラスの範囲外）' });
      }
      updateSingleDevice(payload.student_id, payload.data || {});
      return jsonResponse({ success: true, message: '設定を更新しました' });
    }

    // I. 教員アカウント設定の保存（登録URL情報・個別規制URL・対象クラスの更新）
    //    ※ 一斉配信URL（マイURL）と個別規制URL（ホワイト/ブラックリスト）は
    //      TEACHER権限でもアカウント毎に登録・保存できる（要望対応）。
    //    ※ ただし「対象クラス」は権限の境界であるため、管理者(ADMIN)のみ変更可能。
    //      一般教員が自身の対象クラスを書き換えて権限を広げることを防ぐ。
    if (action === 'save_teacher_settings' || action === 'update_teacher_settings') {
      const safeSettings = sanitizeTeacherSettingsForSave(payload.settings || payload, currentTeacher);
      const updatedTeacher = saveTeacherSettings(currentTeacher.email, safeSettings);
      return jsonResponse({ success: true, message: '教員設定を保存しました', teacher: updatedTeacher });
    }

    // J. 教員アカウント設定の取得
    if (action === 'get_teacher_settings') {
      const teacher = getTeacherSettings(currentTeacher.email);
      return jsonResponse({ success: true, teacher: teacher });
    }

    // K. 教員アカウント一覧（管理者のみ）
    if (action === 'get_teachers') {
      return jsonResponse({ success: true, teachers: getAllTeachers(currentTeacher), schools: CONFIG.SCHOOL_LIST });
    }

    // L. 教員アカウントの新規登録（管理者のみ）
    if (action === 'add_teacher') {
      const t = addTeacher(currentTeacher, payload.data || payload);
      return jsonResponse({ success: true, message: '教員を登録しました', teacher: t });
    }

    // M. 教員アカウントの更新（管理者のみ）
    if (action === 'update_teacher') {
      const t = updateTeacherRecord(currentTeacher, payload.data || payload);
      return jsonResponse({ success: true, message: '教員情報を更新しました', teacher: t });
    }

    // N. 児童アカウントの新規登録（管理者のみ）
    if (action === 'add_student') {
      const s = addStudentRecord(currentTeacher, payload.data || payload);
      return jsonResponse({ success: true, message: '児童を登録しました', student: s });
    }

    // O. 児童データの一括インポート（管理者のみ・Excel/CSV対応）
    if (action === 'import_students') {
      const result = importStudents(currentTeacher, payload.data || payload);
      return jsonResponse({ success: true, message: '児童データをインポートしました', result: result });
    }

    // P. 教員データの一括インポート（管理者のみ・Excel/CSV対応）
    if (action === 'import_teachers') {
      const result = importTeachers(currentTeacher, payload.data || payload);
      return jsonResponse({ success: true, message: '教員データをインポートしました', result: result });
    }

    // Q. 年次更新（管理者のみ）：卒業生の退避・削除
    if (action === 'run_annual_rollover') {
      const result = runAnnualRollover(currentTeacher, payload.data || payload);
      return jsonResponse({ success: true, message: '年次更新を実行しました', result: result });
    }

    // R. 卒業生アーカイブの取得（管理者のみ）
    if (action === 'get_archived_students') {
      const archived = getArchivedStudents(currentTeacher);
      return jsonResponse({ success: true, data: archived });
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
 * 認証トークン内の教員情報（24時間有効・発行時点のスナップショット）を、
 * 教員マスタシートの「最新レコード」で解決し直す。
 *
 * 背景: トークンは発行時に school / role / target_class を埋め込むため、
 *      管理者が教員の所属学校や権限を後から変更しても、トークンが失効するまで
 *      古い情報でスコープ判定が行われてしまう。特に一般教員(TEACHER)で
 *      「自校の児童が表示されない」不具合の主因となる。
 *      → 各操作の都度シートから最新の所属学校・権限を読み直して判定する。
 *
 * トークンに email が無い / シートに該当が無い 等の場合は、
 * トークンの情報にフォールバックして致命的なエラーにしない。
 */
function resolveCurrentTeacher(authTeacher) {
  if (!authTeacher || !authTeacher.email) return authTeacher;
  try {
    const fresh = getTeacherSettings(authTeacher.email);
    // トークン側の情報よりシートの最新情報を優先（admin 判定に必要）
    return Object.assign({}, authTeacher, fresh);
  } catch (e) {
    Logger.log('教員情報の最新化に失敗（トークン情報を使用）: ' + e);
    return authTeacher;
  }
}

/**
 * 教員アカウントの設定（対象クラス・登録URL・個別規制URL・氏名）を保存
 */
function saveTeacherSettings(email, updateData) {
  if (!email) throw new Error('教員メールアドレスが指定されていません');
  return withWriteLock(function () {

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
  });
}

/**
 * 教員設定の保存内容を権限に応じてサニタイズする。
 * - マイURL（urls）と個別規制URL（filter_whitelist / filter_blacklist）は
 *   TEACHER権限でもアカウント毎に保存できる（要望対応）。
 * - 対象クラス（target_class）は権限の境界であるため、管理者(ADMIN)のみ反映する。
 *   一般教員からの target_class 指定は無視され、シート上の現在値が保持される。
 */
function sanitizeTeacherSettingsForSave(incoming, teacher) {
  const src = incoming || {};
  const safe = {
    filter_whitelist: src.filter_whitelist,
    filter_blacklist: src.filter_blacklist,
    urls: src.urls
  };
  if (isAdminTeacher(teacher) && src.target_class !== undefined) {
    safe.target_class = src.target_class;
  }
  return safe;
}

/**
 * ==================== 管理者(ADMIN)専用：アカウント管理 ====================
 */

// 教員マスタの全件取得（管理者専用）
function getAllTeachers(teacher) {
  if (!isAdminTeacher(teacher)) {
    throw new Error('教員アカウントの管理は管理者のみ可能です');
  }
  const sheet = getTargetSheet(CONFIG.TEACHER_SHEET_NAME);
  ensureTeacherHeaders(sheet);
  const headerMap = getHeaderMap(sheet, CONFIG.TEACHER_COLUMNS);
  const data = sheet.getDataRange().getValues();
  const results = [];
  for (let i = 1; i < data.length; i++) {
    const email = String(data[i][headerMap['教員ID(メールアドレス)'] - 1] || '').trim();
    if (!email) continue;
    results.push({
      email: email,
      name: String(data[i][headerMap['氏名'] - 1] || ''),
      school: String(data[i][headerMap['所属学校'] - 1] || ''),
      role: String(data[i][headerMap['権限'] - 1] || 'TEACHER'),
      target_class: String(data[i][headerMap['対象クラス'] - 1] || ''),
      last_login: headerMap['最終ログイン日時'] ? String(data[i][headerMap['最終ログイン日時'] - 1] || '') : ''
    });
  }
  return results;
}

// 教員アカウントの新規登録（管理者専用）
function addTeacher(teacher, payload) {
  if (!isAdminTeacher(teacher)) {
    throw new Error('教員アカウントの登録は管理者のみ可能です');
  }
  const email = String((payload && payload.email) || '').trim().toLowerCase();
  const password = String((payload && payload.password) || '').trim();
  const name = String((payload && payload.name) || '').trim();
  const school = String((payload && payload.school) || '').trim();
  const role = String((payload && payload.role) || 'TEACHER').trim().toUpperCase();
  const targetClass = String((payload && payload.target_class) || '').trim();
  if (!email) throw new Error('メールアドレスを入力してください');
  if (!password) throw new Error('パスワードを入力してください');
  return withWriteLock(function () {

  const sheet = getTargetSheet(CONFIG.TEACHER_SHEET_NAME);
  ensureTeacherHeaders(sheet);
  const headerMap = getHeaderMap(sheet, CONFIG.TEACHER_COLUMNS);
  const data = sheet.getDataRange().getValues();
  const emailColIdx = headerMap['教員ID(メールアドレス)'] - 1;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][emailColIdx] || '').trim().toLowerCase() === email) {
      throw new Error('このメールアドレスは既に登録されています: ' + email);
    }
  }
  const newRow = new Array(CONFIG.TEACHER_COLUMNS.length).fill('');
  newRow[headerMap['教員ID(メールアドレス)'] - 1] = email;
  newRow[headerMap['パスワード'] - 1] = password;
  newRow[headerMap['氏名'] - 1] = name || '教員';
  newRow[headerMap['所属学校'] - 1] = school || '全校管理';
  newRow[headerMap['権限'] - 1] = role || 'TEACHER';
  newRow[headerMap['対象クラス'] - 1] = targetClass;
  sheet.appendRow(newRow);
  return getTeacherSettings(email);
  });
}

// 教員アカウントの更新（管理者専用）
function updateTeacherRecord(teacher, payload) {
  if (!isAdminTeacher(teacher)) {
    throw new Error('教員アカウントの編集は管理者のみ可能です');
  }
  return withWriteLock(function () {
  const email = String((payload && payload.email) || '').trim().toLowerCase();
  if (!email) throw new Error('メールアドレスが必要です');
  const sheet = getTargetSheet(CONFIG.TEACHER_SHEET_NAME);
  ensureTeacherHeaders(sheet);
  const headerMap = getHeaderMap(sheet, CONFIG.TEACHER_COLUMNS);
  const data = sheet.getDataRange().getValues();
  const emailColIdx = headerMap['教員ID(メールアドレス)'] - 1;
  let targetRow = -1;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][emailColIdx] || '').trim().toLowerCase() === email) { targetRow = i + 1; break; }
  }
  if (targetRow === -1) throw new Error('教員が見つかりません: ' + email);
  if (payload.password !== undefined && payload.password !== null && String(payload.password).trim() !== '' && headerMap['パスワード']) {
    sheet.getRange(targetRow, headerMap['パスワード']).setValue(String(payload.password).trim());
  }
  if (payload.name !== undefined && headerMap['氏名']) sheet.getRange(targetRow, headerMap['氏名']).setValue(String(payload.name).trim());
  if (payload.school !== undefined && headerMap['所属学校']) sheet.getRange(targetRow, headerMap['所属学校']).setValue(String(payload.school).trim());
  if (payload.role !== undefined && headerMap['権限']) sheet.getRange(targetRow, headerMap['権限']).setValue(String(payload.role).trim().toUpperCase());
  if (payload.target_class !== undefined && headerMap['対象クラス']) sheet.getRange(targetRow, headerMap['対象クラス']).setValue(String(payload.target_class).trim());
  return getTeacherSettings(email);
  });
}

// 児童アカウントの新規登録（管理者専用：手動追加）
function addStudentRecord(teacher, payload) {
  if (!isAdminTeacher(teacher)) {
    throw new Error('児童アカウントの登録は管理者のみ可能です');
  }
  return withWriteLock(function () {
  const studentId = String((payload && payload.student_id) || '').trim();
  if (!studentId) throw new Error('児童ID（Googleアカウント）を入力してください');
  const sheet = getTargetSheet(CONFIG.DEVICE_SHEET_NAME);
  const headerMap = getHeaderMap(sheet, CONFIG.DEVICE_COLUMNS);
  const data = sheet.getDataRange().getValues();
  const idColIdx = headerMap['児童ID'] - 1;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idColIdx] || '').trim() === studentId) {
      throw new Error('この児童IDは既に登録されています: ' + studentId);
    }
  }
  const nowStr = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');
  const newRow = new Array(CONFIG.DEVICE_COLUMNS.length).fill('');
  newRow[headerMap['児童ID'] - 1] = studentId;
  newRow[headerMap['学校名'] - 1] = String((payload && payload.school_name) || '').trim() || '未設定';
  newRow[headerMap['氏名'] - 1] = String((payload && payload.student_name) || '').trim() || '未登録児童';
  newRow[headerMap['クラス'] - 1] = String((payload && payload.class_name) || '').trim() || '未設定';
  newRow[headerMap['画面ロック'] - 1] = false;
  newRow[headerMap['URL規制モード'] - 1] = 'OFF';
  newRow[headerMap['許可URLリスト'] - 1] = 'nhk.or.jp, scratch.mit.edu, google.com';
  newRow[headerMap['規制URLリスト'] - 1] = 'youtube.com, twitter.com, tiktok.com, instagram.com';
  newRow[headerMap['最終同期日時'] - 1] = nowStr;
  sheet.appendRow(newRow);
  return { student_id: studentId, school_name: newRow[headerMap['学校名'] - 1], student_name: newRow[headerMap['氏名'] - 1] };
  });
}

/**
 * ==================== 管理者(ADMIN)専用：一括インポート / 年次更新 ====================
 */

/**
 * 児童データの一括インポート（管理者のみ）。
 * Excel(.xlsx)/CSV からフロント側で JSON 配列に変換して渡される想定。
 * 各行は { student_id, student_name, school_name, class_name } を想定（列名は下表）。
 *
 * mode:
 *   'merge'  … 既存児童は更新、新規児童は追加（既定・upsert）
 *   'add'    … 新規のみ追加（既存IDはスキップ）
 *   'replace'… 端末一覧を全置換（画面ロック等の実行状態はリセット）
 *
 * 戻り値: { added, updated, skipped, errors:[...] }
 */
function importStudents(teacher, payload) {
  if (!isAdminTeacher(teacher)) {
    throw new Error('児童データのインポートは管理者のみ可能です');
  }
  const rows = (payload && Array.isArray(payload.rows)) ? payload.rows : [];
  const mode = String((payload && payload.mode) || 'merge').toLowerCase();
  if (!rows.length) throw new Error('インポートするデータがありません');

  return withWriteLock(function () {
    const sheet = getTargetSheet(CONFIG.DEVICE_SHEET_NAME);
    const headerMap = getHeaderMap(sheet, CONFIG.DEVICE_COLUMNS);
    let data = sheet.getDataRange().getValues();

    // replace モードはヘッダー行だけ残して全消去（実行状態もリセット）
    if (mode === 'replace') {
      if (sheet.getLastRow() > 1) {
        sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).clearContent();
      }
      data = sheet.getDataRange().getValues();
    }

    const idColIdx = headerMap['児童ID'] - 1;
    const indexById = {};
    for (let i = 1; i < data.length; i++) {
      const id = String(data[i][idColIdx] || '').trim();
      if (id) indexById[id] = i + 1; // 1-indexed row
    }

    const nowStr = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');
    const addedRows = [];   // 追記する行（一括 append）
    const errors = [];
    let added = 0, updated = 0, skipped = 0;

    rows.forEach(function (raw, idx) {
      const r = raw || {};
      const studentId = String(r.student_id || '').trim();
      if (!studentId) { errors.push('行' + (idx + 2) + ': 児童IDが空です'); skipped++; return; }
      const school = String(r.school_name || '').trim() || '未設定';
      const name = String(r.student_name || '').trim() || '未登録児童';
      const cls = String(r.class_name || '').trim() || '未設定';

      const existingRow = indexById[studentId];
      if (existingRow) {
        if (mode === 'add') { skipped++; return; } // 新規のみ追加モードは既存をスキップ
        sheet.getRange(existingRow, headerMap['学校名']).setValue(school);
        sheet.getRange(existingRow, headerMap['氏名']).setValue(name);
        sheet.getRange(existingRow, headerMap['クラス']).setValue(cls);
        updated++;
        return;
      }

      // 新規行を作成
      const newRow = new Array(CONFIG.DEVICE_COLUMNS.length).fill('');
      newRow[headerMap['児童ID'] - 1] = studentId;
      newRow[headerMap['学校名'] - 1] = school;
      newRow[headerMap['氏名'] - 1] = name;
      newRow[headerMap['クラス'] - 1] = cls;
      newRow[headerMap['画面ロック'] - 1] = false;
      newRow[headerMap['URL規制モード'] - 1] = 'OFF';
      newRow[headerMap['許可URLリスト'] - 1] = 'nhk.or.jp, scratch.mit.edu, google.com';
      newRow[headerMap['規制URLリスト'] - 1] = 'youtube.com, twitter.com, tiktok.com, instagram.com';
      newRow[headerMap['最終同期日時'] - 1] = nowStr;
      addedRows.push(newRow);
      indexById[studentId] = -1; // 同一インポート内の重複を防止
      added++;
    });

    // 新規行はまとめて1回で追記（往復削減）
    if (addedRows.length) {
      const startRow = sheet.getLastRow() + 1;
      sheet.getRange(startRow, 1, addedRows.length, CONFIG.DEVICE_COLUMNS.length).setValues(addedRows);
    }

    return { added: added, updated: updated, skipped: skipped, errors: errors };
  });
}

/**
 * 教員データの一括インポート（管理者のみ）。年次更新での教員入れ替えに使用。
 * 各行は { email, password, name, school, role, target_class } を想定。
 * mode: 'merge'(upsert・既定) / 'add'(新規のみ) / 'replace'(教員マスタを全置換)
 * 戻り値: { added, updated, skipped, errors:[...] }
 */
function importTeachers(teacher, payload) {
  if (!isAdminTeacher(teacher)) {
    throw new Error('教員データのインポートは管理者のみ可能です');
  }
  const rows = (payload && Array.isArray(payload.rows)) ? payload.rows : [];
  const mode = String((payload && payload.mode) || 'merge').toLowerCase();
  if (!rows.length) throw new Error('インポートするデータがありません');

  return withWriteLock(function () {
    const sheet = getTargetSheet(CONFIG.TEACHER_SHEET_NAME);
    const headerMap = getHeaderMap(sheet, CONFIG.TEACHER_COLUMNS);

    if (mode === 'replace' && sheet.getLastRow() > 1) {
      sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).clearContent();
    }

    const data = sheet.getDataRange().getValues();
    const emailColIdx = headerMap['教員ID(メールアドレス)'] - 1;
    const indexByEmail = {};
    for (let i = 1; i < data.length; i++) {
      const em = String(data[i][emailColIdx] || '').trim().toLowerCase();
      if (em) indexByEmail[em] = i + 1;
    }

    const nowStr = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');
    const newRows = [];
    const errors = [];
    let added = 0, updated = 0, skipped = 0;

    rows.forEach(function (raw, idx) {
      const r = raw || {};
      const email = String(r.email || '').trim().toLowerCase();
      if (!email) { errors.push('行' + (idx + 2) + ': メールアドレスが空です'); skipped++; return; }
      const password = String(r.password || '').trim();
      const name = String(r.name || '').trim();
      const school = String(r.school || '').trim() || '未設定';
      let role = String(r.role || 'TEACHER').trim().toUpperCase();
      if (role !== 'ADMIN' && role !== 'TEACHER') role = 'TEACHER';
      const targetClass = String(r.target_class || '').trim();

      const existingRow = indexByEmail[email];
      if (existingRow) {
        if (mode === 'add') { skipped++; return; }
        // 既存更新（パスワードは空欄なら変更しない）
        if (password) sheet.getRange(existingRow, headerMap['パスワード']).setValue(password);
        sheet.getRange(existingRow, headerMap['氏名']).setValue(name);
        sheet.getRange(existingRow, headerMap['所属学校']).setValue(school);
        sheet.getRange(existingRow, headerMap['権限']).setValue(role);
        if (headerMap['対象クラス']) sheet.getRange(existingRow, headerMap['対象クラス']).setValue(targetClass);
        updated++;
        return;
      }

      const newRow = new Array(CONFIG.TEACHER_COLUMNS.length).fill('');
      newRow[headerMap['教員ID(メールアドレス)'] - 1] = email;
      newRow[headerMap['パスワード'] - 1] = password;
      newRow[headerMap['氏名'] - 1] = name;
      newRow[headerMap['所属学校'] - 1] = school;
      newRow[headerMap['権限'] - 1] = role;
      if (headerMap['対象クラス']) newRow[headerMap['対象クラス'] - 1] = targetClass;
      newRow[headerMap['最終ログイン日時'] - 1] = '';
      newRows.push(newRow);
      indexByEmail[email] = -1;
      added++;
    });

    if (newRows.length) {
      const startRow = sheet.getLastRow() + 1;
      sheet.getRange(startRow, 1, newRows.length, CONFIG.TEACHER_COLUMNS.length).setValues(newRows);
    }

    return { added: added, updated: updated, skipped: skipped, errors: errors };
  });
}

/**
 * 年次更新（管理者のみ）。
 * 新年度に向けて、指定した児童を「卒業生」シートへ退避し、端末一覧から削除する。
 * ・teacher は ADMIN のみ実行可。
 * ・payload.graduate_ids … 退避・削除する児童IDの配列（空/未指定なら何もしない）
 * ・payload.graduate_filter … { school_name } 指定でその学校の「卒業学年」を自動判定する補助（任意）
 *   （クラス名に含まれる学年が payload.graduation_grade のとき対象。既定は小6・中3=6/3）
 * ・端末一覧のヘッダー行・教員マスタは保持する。
 * 戻り値: { graduated, remaining }
 */
function runAnnualRollover(teacher, payload) {
  if (!isAdminTeacher(teacher)) {
    throw new Error('年次更新は管理者のみ実行できます');
  }
  const p = payload || {};
  const graduateIds = Array.isArray(p.graduate_ids) ? p.graduate_ids.map(x => String(x).trim()).filter(Boolean) : [];
  const schoolFilter = String(p.school_name || '').trim();
  const graduationGrade = String(p.graduation_grade || '').trim(); // 例: '6','3'
  const doGraduate = Boolean(p.graduate !== false); // 既定 true（卒業処理を行う）

  return withWriteLock(function () {
    const deviceSheet = getTargetSheet(CONFIG.DEVICE_SHEET_NAME);
    const archiveSheet = getTargetSheet(CONFIG.ARCHIVE_SHEET_NAME);
    const headerMap = getHeaderMap(deviceSheet, CONFIG.DEVICE_COLUMNS);
    const data = deviceSheet.getDataRange().getValues();
    const idColIdx = headerMap['児童ID'] - 1;
    const schoolColIdx = headerMap['学校名'] - 1;
    const classColIdx = headerMap['クラス'] - 1;

    // 対象児童の判定：
    //  1. graduate_ids が明示されていればそれに一致する児童
    //  2. 未指定なら school_name（任意）× 卒業学年（クラス名に含まれる数字）で自動判定
    const idSet = new Set(graduateIds);
    const useAuto = idSet.size === 0 && (schoolFilter || graduationGrade);

    const targetRows = []; // 端末一覧上の行番号（1-indexed）
    const archiveRows = [];
    for (let i = 1; i < data.length; i++) {
      const id = String(data[i][idColIdx] || '').trim();
      if (!id) continue;
      const school = String(data[i][schoolColIdx] || '').trim();
      const cls = String(data[i][classColIdx] || '').trim();

      let isTarget = false;
      if (idSet.size > 0) {
        isTarget = idSet.has(id);
      } else if (useAuto) {
        if (schoolFilter && !schoolNamesMatch(school, schoolFilter)) continue;
        if (graduationGrade) {
          // クラス名に含まれる学年（最初の数字）が卒業学年と一致するか
          const m = cls.match(/[0-9０-９]+/);
          const grade = m ? normalizeDigits(m[0]) : '';
          isTarget = (grade === normalizeDigits(graduationGrade));
        } else {
          isTarget = true; // 学校のみ指定 → その学校の全児童を対象
        }
      }

      if (isTarget) {
        targetRows.push(i + 1);
        archiveRows.push(data[i].slice());
      }
    }

    if (!doGraduate || !targetRows.length) {
      return { graduated: 0, remaining: data.length - 1 };
    }

    // 1. 卒業生シートへ追記
    if (archiveRows.length) {
      const startRow = archiveSheet.getLastRow() + 1;
      archiveSheet.getRange(startRow, 1, archiveRows.length, CONFIG.DEVICE_COLUMNS.length).setValues(archiveRows);
    }

    // 2. 端末一覧から対象行を削除（下から消して行番号ズレを防ぐ）
    targetRows.sort(function (a, b) { return b - a; }).forEach(function (rowNum) {
      deviceSheet.deleteRow(rowNum);
    });

    return { graduated: targetRows.length, remaining: deviceSheet.getLastRow() - 1 };
  });
}

/**
 * 卒業生アーカイブの一覧取得（管理者のみ）。
 */
function getArchivedStudents(teacher) {
  if (!isAdminTeacher(teacher)) {
    throw new Error('卒業生一覧は管理者のみ閲覧できます');
  }
  const sheet = getTargetSheet(CONFIG.ARCHIVE_SHEET_NAME);
  const headerMap = getHeaderMap(sheet, CONFIG.DEVICE_COLUMNS);
  const data = sheet.getDataRange().getValues();
  const out = [];
  for (let i = 1; i < data.length; i++) {
    const id = String(data[i][headerMap['児童ID'] - 1] || '').trim();
    if (!id) continue;
    out.push({
      student_id: id,
      school_name: String(data[i][headerMap['学校名'] - 1] || ''),
      student_name: String(data[i][headerMap['氏名'] - 1] || ''),
      class_name: String(data[i][headerMap['クラス'] - 1] || '')
    });
  }
  return out;
}

/**
 * 全角数字を半角に正規化（卒業学年の比較用）。
 */
function normalizeDigits(s) {
  return String(s || '').replace(/[０-９]/g, function (c) {
    return String.fromCharCode(c.charCodeAt(0) - 0xFEE0);
  });
}

/**
 * 児童端末からのハートビート処理
 */
/**
 * 最終同期日時をシートへ書き込むべきかどうかを判定する（ハートビート高速化用）。
 * 児童端末が増えてもシート書き込みが増えないよう、約20秒間隔に間引く。
 * is_online の判定窓（60秒）より十分細かいため、オンライン表示は保たれる。
 * キャッシュが使えない環境では安全側（毎回書き込み）にフォールバックする。
 */
function shouldWriteSyncTime(studentId, nowMs) {
  const INTERVAL_MS = 20000;
  try {
    const cache = CacheService.getScriptCache();
    const key = 'hbt_' + studentId;
    const last = cache.get(key);
    if (last && (nowMs - Number(last)) < INTERVAL_MS) {
      return false; // 直近20秒以内に書き込み済み → スキップ
    }
    cache.put(key, String(nowMs), 300);
    return true;
  } catch (e) {
    return true; // CacheService が使えない場合は毎回書き込む（安全側）
  }
}

// ==================== 教員コンソールの稼働状態（GAS を共有の調整点にする） ====================
// 課題: 児童端末が常時 1.5 秒間隔でハートビート（doPost）し、管理アプリを開いていなくても
//       GAS 実行が数秒おきに走り続ける（通信負荷）。
// 対策: 「いま教員コンソールがログインして稼働しているか」を GAS 側で一元管理する。
//       ・教員コンソールはログイン中 30 秒ごとに touchTeacherConsole を呼ぶ。
//       ・児童端末はハートビート応答の ka_active を見て、同期周期を
//         稼働中=1.5 秒（速い）／非稼働=30 秒（省電力）に切り替える。
//       ※ 児童端末は GAS としか通信できないため、GAS を介するのが唯一確実な方法。
//       ・全アカウントがログアウト（touch が 90 秒途絶）すると自動で非稼働に戻る。
const KA_KEY = 'ka_console';
const KA_PROP_KEY = 'KA_LAST_TOUCH'; // PropertiesService（永続）側のキー
const KA_ACTIVE_WINDOW_MS = 120000;  // touch が 120 秒来なければ非稼働とみなす

/**
 * 教員コンソールの稼働を記録する（ログイン中に 15 秒ごとに呼ばれる）。
 * ※ CacheService は一時キャッシュで失効し得るため、PropertiesService（永続）にも
 *    時刻を保存して二重化する。これにより「コンソールが稼働中なのに ka_active=false」
 *    （＝児童端末が省電力周期のまま）という取りこぼしを防ぐ。
 */
function touchTeacherConsole() {
  const nowMs = String(new Date().getTime());
  try { CacheService.getScriptCache().put(KA_KEY, nowMs, 240); } catch (e) {}
  try { PropertiesService.getScriptProperties().setProperty(KA_PROP_KEY, nowMs); } catch (e) {}
  return { success: true, at: nowMs };
}

/** 教員コンソールの稼働を明示的に解除する（ログアウト時）。 */
function releaseTeacherConsole() {
  try { CacheService.getScriptCache().remove(KA_KEY); } catch (e) {}
  try { PropertiesService.getScriptProperties().deleteProperty(KA_PROP_KEY); } catch (e) {}
  return { success: true };
}

/**
 * 教員コンソールが稼働中かどうか（直近 KA_ACTIVE_WINDOW_MS 以内に touch があったか）。
 * CacheService → PropertiesService の順に確認する（どちらかに残っていれば稼働中）。
 */
function isTeacherConsoleActive() {
  const nowMs = new Date().getTime();
  try {
    const v = CacheService.getScriptCache().get(KA_KEY);
    if (v && (nowMs - Number(v)) < KA_ACTIVE_WINDOW_MS) return true;
  } catch (e) {}
  try {
    const p = PropertiesService.getScriptProperties().getProperty(KA_PROP_KEY);
    if (p && (nowMs - Number(p)) < KA_ACTIVE_WINDOW_MS) return true;
  } catch (e) {}
  return false;
}

function processHeartbeat(studentId, currentUrl) {
  const kaActive = (typeof isTeacherConsoleActive === 'function') ? isTeacherConsoleActive() : false;
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
    // 高速化のため、先頭で取得済みの行データを再利用する（getRange の往復を削減）。
    const row = data[targetRow - 1];
    const urlCol = headerMap['現在開いているURL'];
    const syncCol = headerMap['最終同期日時'];

    // 書き込みを最小化して GAS／シートの競合を減らす。
    // ・現在開いているURL … 「変化したときだけ」書き込む
    // ・最終同期日時       … 約20秒間隔で書き込む（is_online の判定窓60秒より十分細かい）
    //   → 児童端末が増えてもシート書き込みが増えず、反映遅延・ばらつきを防ぐ。
    const nowMs = new Date().getTime();
    const urlChanged = urlCol && String(row[urlCol - 1] || '') !== String(currentUrl || '');
    const syncDue = syncCol ? shouldWriteSyncTime(studentId, nowMs) : false;

    if (urlCol && syncCol && syncCol === urlCol + 1) {
      // 隣接2列（現在URL・最終同期）をまとめて1回で書き込む
      if (urlChanged || syncDue) {
        sheet.getRange(targetRow, urlCol, 1, 2).setValues([[
          urlChanged ? currentUrl : row[urlCol - 1],
          syncDue ? now : row[syncCol - 1]
        ]]);
      }
    } else {
      if (urlChanged) sheet.getRange(targetRow, urlCol).setValue(currentUrl);
      if (syncDue) sheet.getRange(targetRow, syncCol).setValue(now);
    }

    // 画面情報要求日時／更新日時（画面一覧機能）。列が無い既存シートでも安全に '' を返す。
    const reqCol = headerMap['画面情報要求日時'];
    const shotCol = headerMap['画面情報更新日時'];

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
      screen_request_at: reqCol ? String(row[reqCol - 1] || '').trim() : '',
      screenshot_at: shotCol ? String(row[shotCol - 1] || '').trim() : '',
      ka_active: kaActive, server_time: now
    };
  } else {
    // 新規自動登録（児童Googleアカウント対応）。
    // 同一アカウントが複数端末から同時に、または連続してアクセスした場合に
    // 重複行が作成されないよう、書き込みロック内で「再確認 → 登録」を行う。
    // （ロック取得後に再度存在確認し、他リクエストが先に登録していればそれを返す）
    return withWriteLock(function () {
      const reData = sheet.getDataRange().getValues();
      let reRow = -1;
      for (let i = 1; i < reData.length; i++) {
        if (String(reData[i][idColIdx]).trim() === String(studentId).trim()) { reRow = i + 1; break; }
      }
      if (reRow !== -1) {
        const row = sheet.getRange(reRow, 1, 1, sheet.getLastColumn()).getValues()[0];
        const reqCol2 = headerMap['画面情報要求日時'];
        const shotCol2 = headerMap['画面情報更新日時'];
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
          screen_request_at: reqCol2 ? String(row[reqCol2 - 1] || '').trim() : '',
          screenshot_at: shotCol2 ? String(row[shotCol2 - 1] || '').trim() : '',
          ka_active: kaActive, server_time: now
        };
      }

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
        screen_request_at: '',
        screenshot_at: '',
        ka_active: kaActive, server_time: now
      };
    });
  }
}

/**
 * 教員が管理者(ADMIN)かどうかを判定
 * 管理者は全校の児童を閲覧・操作できる。それ以外の教員は所属学校のみに限定される。
 */
function isAdminTeacher(teacher) {
  if (!teacher) return false;
  const role = String(teacher.role || '').trim().toUpperCase();
  return role === 'ADMIN' || role === 'SUPERADMIN' || role === 'SYSTEM_ADMIN';
}

/**
 * 学校名の表記ゆれ（前後空白・全角スペース・全角/半角カッコ・全角英数字・
 * 市立/市名等の接頭辞）を吸収して比較するための正規化
 */
function normalizeSchoolName(name) {
  let s = String(name || '')
    .replace(/[\u3000\s]+/g, '')          // 半角/全角スペース・タブ・改行を除去
    .replace(/[（）()]/g, '')              // 括弧を除去
    .replace(/[０-９]/g, function (c) {     // 全角数字 → 半角
      return String.fromCharCode(c.charCodeAt(0) - 0xFEE0);
    })
    .replace(/[Ａ-Ｚａ-ｚ]/g, function (c) { // 全角英字 → 半角
      return String.fromCharCode(c.charCodeAt(0) - 0xFEE0);
    })
    .toUpperCase()
    .trim();
  // 「美作市立第一小学校」「美作市 第一小学校」「市立第一小学校」等を「第一小学校」に寄せる
  s = s.replace(/^美作市立/, '').replace(/^美作市/, '').replace(/^市立/, '').replace(/^公立/, '');
  return s;
}

/**
 * 学校名が同一校を指すかどうかの比較（正規化＋部分一致フォールバック）
 * 例: 「第一小学校」「美作市立第一小学校」「第一小」を同一視する。
 * 一般教員が自校の児童を取りこぼさないための頑健化。
 */
function schoolNamesMatch(a, b) {
  const na = normalizeSchoolName(a);
  const nb = normalizeSchoolName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // 短い方の長さが3以上の場合のみ部分一致を許容（「小」等の1文字での誤一致を防止）
  const shorter = na.length <= nb.length ? na : nb;
  const longer = na.length <= nb.length ? nb : na;
  if (shorter.length >= 3 && longer.indexOf(shorter) !== -1) return true;
  return false;
}

// 学校名の略称エイリアス（「第一小」→「第一小学校」等）。
// 教員マスタや児童データに略称が入力されている場合でも同一校として扱えるようにする。
const SCHOOL_ALIASES = {
  '第一小': '第一小学校',
  '英田小': '英田小学校',
  '大原小': '大原小学校',
  '江見小': '江見小学校',
  '勝田小': '勝田小学校',
  '勝田東小': '勝田東小学校',
  '北小': '北小学校',
  '土居小': '土居小学校',
  '英田中': '英田中学校',
  '大原中': '大原中学校',
  '作東中': '作東中学校',
  '勝田中': '勝田中学校',
  '美作中': '美作中学校'
};

/**
 * 学校名を「14校のいずれか」に正規化して解決する。
 * 完全一致 → 略称エイリアス → 部分一致（双方向）の順に判定し、
 * 一致した場合は canonical（SCHOOL_LIST の表記）を返す。
 * 一致しない場合は '' を返す（未設定・未知の学校名）。
 */
function resolveCanonicalSchool(name) {
  const raw = String(name || '').trim();
  if (!raw) return '';
  const n = normalizeSchoolName(raw);
  if (!n) return '';

  // 1. 完全一致
  for (let i = 0; i < CONFIG.SCHOOL_LIST.length; i++) {
    if (normalizeSchoolName(CONFIG.SCHOOL_LIST[i]) === n) return CONFIG.SCHOOL_LIST[i];
  }
  // 2. 略称エイリアス
  for (const alias in SCHOOL_ALIASES) {
    if (normalizeSchoolName(alias) === n) {
      const canon = SCHOOL_ALIASES[alias];
      if (CONFIG.SCHOOL_LIST.indexOf(canon) !== -1) return canon;
    }
  }
  // 3. 部分一致（双方向）
  for (let i = 0; i < CONFIG.SCHOOL_LIST.length; i++) {
    const cn = normalizeSchoolName(CONFIG.SCHOOL_LIST[i]);
    if (cn && (n.indexOf(cn) !== -1 || cn.indexOf(n) !== -1)) return CONFIG.SCHOOL_LIST[i];
  }
  return '';
}

/**
 * 教員が指定した学校名を「スコープ対象の canonical 校名」に解決する。
 * canonical に解決できればその校名のみを対象とし（＝自校判定を確実にする）、
 * 解決できない場合は「未設定でも全校でもない未知の学校名」として
 * 生の値を返す（呼び出し側で schoolNamesMatch による比較にフォールバック）。
 */
function resolveTeacherScopeSchoolName(schoolName) {
  const resolved = resolveCanonicalSchool(schoolName);
  if (resolved) return resolved;
  const raw = String(schoolName || '').trim();
  return raw;
}

/**
 * 教員の所属校スコープを表すオブジェクトを返す。
 * - admin: 管理者（全校）
 * - all:   所属が「全校管理」等（全校）
 * - none:  所属が空（全校扱い）
 * - school: 特定校のみ
 */
function getTeacherScopeInfo(teacher) {
  if (isAdminTeacher(teacher)) return { type: 'admin' };
  const raw = String((teacher && teacher.school) || '').trim();
  if (!raw) return { type: 'none' };
  if (isAllSchoolsName(raw)) return { type: 'all' };
  const canonical = resolveCanonicalSchool(raw);
  if (canonical) return { type: 'school', school: canonical };
  return { type: 'unknown', school: raw };
}

/**
 * 「全校」を意味する学校名かどうか（未設定・全校管理・全学校・ALL）
 */
function isAllSchoolsName(name) {
  const n = normalizeSchoolName(name);
  return !n || n === '全校管理' || n === '全学校' || n.toUpperCase() === 'ALL';
}

/**
 * クラス名の表記ゆれ（前後空白・全角スペース・全角英数字）を吸収して比較するための正規化
 */
function normalizeClassName(name) {
  return String(name || '')
    .replace(/[\u3000\s]+/g, '')
    .replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
    .replace(/[Ａ-Ｚａ-ｚ]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
    .toUpperCase();
}

/**
 * 教員アカウントの「対象クラス」を配列で返す。空配列＝クラス制限なし（＝全クラス）。
 * 管理者(ADMIN)は常に制限なし。「全クラス」「ALL」等が設定されている場合も制限なしとして扱う。
 * カンマ・読点・スラッシュ・全角中黒などの区切りで複数クラス指定を許容する。
 */
function getTeacherTargetClasses(teacher) {
  if (isAdminTeacher(teacher)) return [];
  const raw = String((teacher && teacher.target_class) || '').trim();
  if (!raw) return [];
  const n = normalizeClassName(raw);
  if (n === '全クラス' || n === 'ALL' || n === '全' || n === 'すべて' || n === '指定なし') return [];
  return raw.split(/[,、\/／・]+/).map(function (s) { return s.trim(); }).filter(Boolean);
}

/**
 * 指定クラスが教員の「対象クラス（権限の境界）」内かどうか。
 *  - 管理者 / 対象クラス未設定 → 制限なし（true）
 *  - クラス未設定（空・未設定）→ 新規端末の割り当て前に表示が必要なため true
 *    （学校未設定の児童を表示している既存挙動と揃える）
 *  ※「対象クラス」は権限の境界であり、一覧表示だけでなく一括操作の対象判定にも用いる。
 */
function isClassInTeacherScope(className, teacher) {
  if (isAdminTeacher(teacher)) return true;
  const targets = getTeacherTargetClasses(teacher);
  if (targets.length === 0) return true;
  const cn = String(className || '').trim();
  if (!cn || cn === '未設定') return true;
  const nc = normalizeClassName(cn);
  return targets.some(function (t) { return normalizeClassName(t) === nc; });
}

/**
 * 端末レコードが教員のアクセス権限範囲内かどうかを判定
 * - 管理者: すべての学校にアクセス可能
 * - 一般教員: 所属学校の児童 + 学校未設定（新規登録直後の児童）にアクセス可能
 *   ※ 児童は初回ログイン時に「学校未設定」で自動登録されるため、所属校へ紐付ける前に
 *      まず一覧へ表示されなければならない。未設定児童は全教員が閲覧・紐付け可能とする。
 * - 「全校管理」等の管理用所属は全校扱い
 * - さらに「対象クラス」が設定されている教員は、そのクラスのみ（＋未設定クラス）に限定される。
 *   ※ 対象クラスは権限の境界であり、一覧表示だけでなく一括操作の対象判定にも用いる。
 */
function isDeviceInTeacherScope(schoolName, teacher, className) {
  if (isAdminTeacher(teacher)) return true;

  const scope = getTeacherScopeInfo(teacher);
  // 所属が未設定 / 全校管理系の場合は制限しない（管理者相当の運用を許可）
  // ただし「対象クラス」による制限は、所属が全校扱いであっても適用する。
  const schoolUnrestricted = (scope.type === 'admin' || scope.type === 'all' || scope.type === 'none');

  if (!schoolUnrestricted) {
    const sName = String(schoolName || '').trim();
    // 学校未設定（新規登録直後の児童）は自校への紐付け前のため許可
    if (sName && sName !== '未設定') {
      // 所属校が canonical に解決できた場合は、児童の学校名も canonical に解決して比較する。
      // 「第一小」「美作市立第一小学校」「第一小学校」等の表記ゆれ・略称を同一視する。
      const devCanonical = resolveCanonicalSchool(sName);
      const isOwn = devCanonical ? (devCanonical === scope.school) : schoolNamesMatch(sName, scope.school);
      if (!isOwn) return false;
    }
  }

  // 対象クラス境界（学校境界を通過したうえで、さらにクラスで限定する）
  if (!isClassInTeacherScope(className, teacher)) return false;

  return true;
}

/**
 * 教員のアクセス範囲（所属学校）を一括操作の対象IDリストに反映する。
 * 一般教員が他校の児童IDを指定しても操作できないよう、IDリストを自校のみに絞り込む。
 * 'ALL' 指定時は自校のみを意味する配列に変換する（管理者は 'ALL' のまま＝全校）。
 * 戻り値: { ids: 'ALL' | string[], denied: number } / ids が空配列の場合は対象なし
 */
function scopeStudentIdsForTeacher(studentIds, teacher) {
  if (isAdminTeacher(teacher)) {
    return { ids: studentIds, denied: 0 };
  }

  const scope = getTeacherScopeInfo(teacher);
  const restrictToOwnSchool = (scope.type === 'school' || scope.type === 'unknown');
  const teacherSchool = scope.school || '';
  // 「対象クラス」は権限の境界。学校が全校扱い（all/none）でもクラス制限は適用する。
  const classRestricted = getTeacherTargetClasses(teacher).length > 0;

  // 学校・クラスのどちらの制限も無い場合は元のIDリストをそのまま返す（'ALL' を保持）
  if (!restrictToOwnSchool && !classRestricted) {
    return { ids: studentIds, denied: 0 };
  }

  const sheet = getTargetSheet(CONFIG.DEVICE_SHEET_NAME);
  const headerMap = getHeaderMap(sheet, CONFIG.DEVICE_COLUMNS);
  const data = sheet.getDataRange().getValues();
  const idColIdx = headerMap['児童ID'] - 1;
  const schoolColIdx = headerMap['学校名'] - 1;
  const classColIdx = headerMap['クラス'] - 1;

  // 教員のスコープ内（学校境界＋クラス境界）に所属する児童IDのセット
  const scopedIds = {};
  for (let i = 1; i < data.length; i++) {
    const id = String(data[i][idColIdx] || '').trim();
    if (!id) continue;
    const sName = String(data[i][schoolColIdx] || '').trim();
    const cName = String(data[i][classColIdx] || '').trim();

    // 学校境界: 自校の児童、および学校未設定（新規登録直後）の児童を対象に含める
    // ※ canonical 解決 → 表記ゆれ比較の順で判定し、略称・接頭辞付き表記も同一視する
    if (restrictToOwnSchool) {
      const devCanonical = resolveCanonicalSchool(sName);
      const isOwn = !sName || sName === '未設定' ||
        (devCanonical ? devCanonical === teacherSchool : schoolNamesMatch(sName, teacherSchool));
      if (!isOwn) continue;
    }

    // クラス境界（権限の境界）
    if (!isClassInTeacherScope(cName, teacher)) continue;

    scopedIds[id] = true;
  }

  if (studentIds === 'ALL' || !Array.isArray(studentIds)) {
    return { ids: Object.keys(scopedIds), denied: 0 };
  }

  const allowed = [];
  let denied = 0;
  studentIds.forEach(id => {
    const key = String(id).trim();
    if (scopedIds[key]) allowed.push(key);
    else denied++;
  });

  return { ids: allowed, denied: denied };
}

/**
 * 児童IDから端末レコード（学校名など）を取得
 */
function getDeviceByStudentId(studentId) {
  if (!studentId) return null;
  const sheet = getTargetSheet(CONFIG.DEVICE_SHEET_NAME);
  const headerMap = getHeaderMap(sheet, CONFIG.DEVICE_COLUMNS);
  const data = sheet.getDataRange().getValues();
  const idColIdx = headerMap['児童ID'] - 1;

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idColIdx] || '').trim() === String(studentId).trim()) {
      return {
        student_id: String(data[i][idColIdx] || '').trim(),
        school_name: String(data[i][headerMap['学校名'] - 1] || '').trim(),
        student_name: String(data[i][headerMap['氏名'] - 1] || ''),
        class_name: String(data[i][headerMap['クラス'] - 1] || '')
      };
    }
  }
  return null;
}

/**
 * 全端末一覧取得（学校フィルター対応 & 教員の所属学校スコープ適用）
 * 同時接続対策: 短時間（5秒）の読み取りキャッシュで、複数教員の同時再読み込みによる
 * シート読み取り回数を抑える。書き込み系は 'dev_v' を進めてキャッシュを無効化するため、
 * 教員の操作結果は次の読み取りで必ず最新が返る（誤情報を残さない）。
 * ※ CacheService が無い環境（GAS以外のテスト等）では従来どおり毎回シートを読む。
 */
function getAllDevices(filterSchool, teacher, includeUnassigned) {
  const cacheEnabled = (typeof CacheService !== 'undefined');
  let devCache = null;
  let devCacheKey = '';
  if (cacheEnabled) {
    try {
      devCache = CacheService.getScriptCache();
      const t = teacher || {};
      const version = String(devCache.get('dev_v') || '0');
      const scopeKey = [
        filterSchool || 'ALL',
        includeUnassigned ? '1' : '0',
        t.email || '', t.school || '', t.role || '', t.target_class || ''
      ].join('|');
      devCacheKey = 'dev2_' + version + '_' + scopeKey;
      const hit = devCache.get(devCacheKey);
      if (hit) return JSON.parse(hit);
    } catch (e) {
      devCache = null;
    }
  }

  const sheet = getTargetSheet(CONFIG.DEVICE_SHEET_NAME);
  const headerMap = getHeaderMap(sheet, CONFIG.DEVICE_COLUMNS);
  const data = sheet.getDataRange().getValues();

  if (data.length <= 1) return [];

  const results = [];
  const now = new Date().getTime();

  // 教員の所属学校スコープ（管理者は全校）
  const scopeInfo = getTeacherScopeInfo(teacher);
  const restrictToOwnSchool = scopeInfo.type === 'school' || scopeInfo.type === 'unknown';
  const teacherSchool = scopeInfo.school || '';
  // 「対象クラス」は権限の境界。学校が全校扱い（all/none）でもクラス制限は適用する。
  const classRestricted = getTeacherTargetClasses(teacher).length > 0;

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const studentId = String(row[headerMap['児童ID'] - 1] || '').trim();
    if (!studentId) continue;

    const schoolName = String(row[headerMap['学校名'] - 1] || '').trim();
    const className = String(row[headerMap['クラス'] - 1] || '').trim();

    // 0. 所属学校スコープ: 一般教員は自校の児童 + 学校未設定（新規登録児童）のみ
    //    他の学校に所属する児童は一切返さない。
    //    ※ 児童は初回ログイン時に「学校未設定」で登録されるため、所属校へ紐付ける前に
    //      まず一覧へ表示する必要がある。
    //    ※ canonical 解決（「第一小」「美作市立第一小学校」等）→ 表記ゆれ比較の順で判定
    if (restrictToOwnSchool && schoolName && schoolName !== '未設定') {
      const devCanonical = resolveCanonicalSchool(schoolName);
      const isOwn = devCanonical ? (devCanonical === teacherSchool) : schoolNamesMatch(schoolName, teacherSchool);
      if (!isOwn) continue;
    }

    // 0.5 対象クラススコープ（権限の境界）: 対象クラス設定がある教員はそのクラスのみ
    //     （＋クラス未設定の児童）に限定する。他クラスの児童は一切返さない。
    if (classRestricted && !isClassInTeacherScope(className, teacher)) continue;

    // 学校絞り込み
    if (filterSchool && filterSchool !== 'ALL') {
      if (filterSchool === 'UNASSIGNED') {
        if (schoolName && schoolName !== '未設定') continue;
      } else if (includeUnassigned) {
        if (schoolName !== '未設定' && schoolName !== '' && !schoolNamesMatch(schoolName, filterSchool)) continue;
      } else {
        if (!schoolNamesMatch(schoolName, filterSchool)) continue;
      }
    }

    const lastSeenStr = row[headerMap['最終同期日時'] - 1];
    let isOnline = false;
    if (lastSeenStr) {
      const dt = new Date(lastSeenStr);
      if (!isNaN(dt.getTime())) isOnline = (now - dt.getTime()) < 60000;
    }

    // 画面一覧用の制御列（列が無い既存シートでも安全に '' を返す）
    const reqColIdx = headerMap['画面情報要求日時'];
    const shotColIdx = headerMap['画面情報更新日時'];

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
      notes: String(row[headerMap['備考'] - 1] || ''),
      screen_request_at: reqColIdx ? String(row[reqColIdx - 1] || '').trim() : '',
      screenshot_at: shotColIdx ? String(row[shotColIdx - 1] || '').trim() : ''
    });
  }

  // 読み取りキャッシュへ保存（5秒）。書き込み時は invalidateDevicesCache() で無効化する。
  if (devCache && devCacheKey) {
    try { devCache.put(devCacheKey, JSON.stringify(results), 5); } catch (e) {}
  }

  return results;
}

/**
 * 端末一覧の読み取りキャッシュを無効化する。
 * 教員による書き込み（ロック/配信/規制/単一更新/年次更新/取込/画面要求）の直後に呼び、
 * 次の get_all が必ず最新のシート内容を返すようにする（古い一覧を配らない）。
 * ※ CacheService が無い環境でも安全（例外は握りつぶす）。
 */
function invalidateDevicesCache() {
  if (typeof CacheService === 'undefined') return;
  try {
    const cache = CacheService.getScriptCache();
    const cur = Number(cache.get('dev_v') || '0');
    cache.put('dev_v', String((cur + 1) % 1000000000), 21600); // 6時間保持
  } catch (e) {}
}

// ==================== 画面一覧（スクリーンショット） ====================
// 設計方針（通信負担の最小化）:
//  ・教員が「画面情報取得」を押した児童だけを対象にする（全端末の常時収集はしない）。
//  ・要求は 端末一覧 シートの『画面情報要求日時』に要求IDを書き込むだけで、
//    児童端末は次のハートビート応答でそれを検知してスクリーンショットを撮影・送信する。
//  ・画像本体は『画面情報』シートに分離保存し、端末一覧の読み取り（get_all）を重くしない。
//  ・取得した画像はデータURL(data:image/...;base64,...)として console が直接表示する。

/**
 * 端末一覧シートが画面一覧用の列を持つことを保証し、ヘッダーマップを返す。
 * 既存運用のシートでも、初回利用時に自動で列を補完する（ensureDeviceHeaders）。
 */
function ensureDeviceHeaderMap() {
  const sheet = getTargetSheet(CONFIG.DEVICE_SHEET_NAME);
  return { sheet: sheet, headerMap: getHeaderMap(sheet, CONFIG.DEVICE_COLUMNS) };
}

/**
 * 教員が「画面情報取得」を押した児童に、画面情報要求IDを書き込む（押下時のみ）。
 * studentIds は教員スコープで絞り込まれた ID を想定。
 */
function requestScreenCapture(studentIds, teacher) {
  const scoped = scopeStudentIdsForTeacher(studentIds, teacher);
  const scopedIds = Array.isArray(scoped.ids) ? scoped.ids : [];
  if (scopedIds.length === 0) {
    return { requested: 0, ids: [] };
  }
  return withWriteLock(function () {
    const sheet = getTargetSheet(CONFIG.DEVICE_SHEET_NAME);
    const headerMap = getHeaderMap(sheet, CONFIG.DEVICE_COLUMNS);
    const reqCol = headerMap['画面情報要求日時'];
    if (!reqCol) throw new Error('画面一覧用の列がありません。setupSpreadsheet を実行してください。');

    const data = sheet.getDataRange().getValues();
    const idColIdx = headerMap['児童ID'] - 1;
    const target = {};
    scopedIds.forEach(id => { target[String(id).trim()] = true; });

    const now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');
    const reqId = 'sr_' + new Date().getTime() + '_' + Math.random().toString(36).slice(2, 7);

    let count = 0;
    const requestedIds = [];
    // 行ごとに個別書き込み（対象は教員が選んだ児童のみ＝上書きコストは限定的）
    for (let i = 1; i < data.length; i++) {
      const sid = String(data[i][idColIdx] || '').trim();
      if (!target[sid]) continue;
      // 「日時 + 要求ID」を書き込む。要求IDは児童端末側で二重撮影を防ぐ識別子。
      sheet.getRange(i + 1, reqCol).setValue(now + '|' + reqId);
      count++;
      requestedIds.push(sid);
    }
    return { requested: count, ids: requestedIds, request_id: reqId, at: now };
  });
}

// 1枚あたりの上限（Base64 の文字数）。
// ※ Google スプレッドシートの 1 セルは 50,000 文字が上限のため、それを超える画像は
//    セルへ書き込めず（＝保存に失敗し画面が表示されない）、必ずこの範囲に収める。
//    児童端末側は送信前に OffscreenCanvas で縮小し、この上限未満にしてから送る。
const SCREENSHOT_MAX_BYTES = 45000;

/**
 * 児童端末から届いたスクリーンショットを『画面情報』シートへ保存し、
 * 端末一覧の『画面情報更新日時』を更新する。
 * ※ 認証不要（ハートビートと同じ経路）。データURLは画像として検証する。
 */
function processScreenshotUpload(studentId, imageData, mimeType) {
  if (!studentId) return { success: false, error: 'student_id is required' };
  const data = String(imageData || '');
  if (!/^data:image\/(png|jpeg|jpg|webp);base64,/i.test(data) && !/^[A-Za-z0-9+/=\s]+$/.test(data)) {
    return { success: false, error: 'invalid image data' };
  }
  const mime = (mimeType || 'image/jpeg').toString();
  const base64 = data.replace(/^data:image\/[a-z]+;base64,/i, '');
  if (base64.length > SCREENSHOT_MAX_BYTES) {
    return { success: false, error: 'image too large' };
  }

  const sheet = getTargetSheet(CONFIG.SCREENSHOT_SHEET_NAME);
  const headerMap = getHeaderMap(sheet, CONFIG.SCREENSHOT_COLUMNS);
  const rows = sheet.getDataRange().getValues();
  const idColIdx = headerMap['児童ID'] - 1;
  const now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');

  let targetRow = -1;
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][idColIdx] || '').trim() === String(studentId).trim()) { targetRow = i + 1; break; }
  }
  const rowValues = [[studentId, now, mime, base64]];
  if (targetRow !== -1) {
    sheet.getRange(targetRow, 1, 1, CONFIG.SCREENSHOT_COLUMNS.length).setValues(rowValues);
  } else {
    sheet.appendRow(rowValues[0]);
  }

  // 端末一覧の『画面情報更新日時』を更新（取得完了の可視化）
  try {
    const dSheet = getTargetSheet(CONFIG.DEVICE_SHEET_NAME);
    const dMap = getHeaderMap(dSheet, CONFIG.DEVICE_COLUMNS);
    const shotCol = dMap['画面情報更新日時'];
    if (shotCol) {
      const dRows = dSheet.getDataRange().getValues();
      const dIdCol = dMap['児童ID'] - 1;
      for (let i = 1; i < dRows.length; i++) {
        if (String(dRows[i][dIdCol] || '').trim() === String(studentId).trim()) {
          dSheet.getRange(i + 1, shotCol).setValue(now);
          break;
        }
      }
    }
  } catch (e) {
    Logger.log('画面情報更新日時の更新に失敗: ' + e);
  }

  return { success: true, student_id: studentId, at: now };
}

/**
 * 要求済み児童のスクリーンショット一覧を取得（console の「画面情報取得」で使用）。
 * status: 'all' | 'ready' | 'pending'
 *  - 各児童について、端末一覧側の要求／更新日時と、画面情報シートの画像有無を突き合わせる。
 *  - 画像は base64 データURLに組み立てて返す（console が <img src> へ直接渡せる）。
 */
function getScreenshots(filterSchool, teacher, includeUnassigned, status, studentIds) {
  const scoped = scopeStudentIdsForTeacher(studentIds, teacher);
  const only = (Array.isArray(studentIds) && studentIds.length) ? scoped.ids : null;

  const devSheet = getTargetSheet(CONFIG.DEVICE_SHEET_NAME);
  const dMap = getHeaderMap(devSheet, CONFIG.DEVICE_COLUMNS);
  const devRows = devSheet.getDataRange().getValues();

  const shotSheet = getTargetSheet(CONFIG.SCREENSHOT_SHEET_NAME);
  const sMap = getHeaderMap(shotSheet, CONFIG.SCREENSHOT_COLUMNS);
  const shotRows = shotSheet.getDataRange().getValues();
  const shotIndex = {};
  for (let i = 1; i < shotRows.length; i++) {
    const sid = String(shotRows[i][sMap['児童ID'] - 1] || '').trim();
    if (!sid) continue;
    shotIndex[sid] = {
      at: String(shotRows[i][sMap['更新日時'] - 1] || ''),
      mime: String(shotRows[i][sMap['MIMEタイプ'] - 1] || 'image/jpeg'),
      b64: String(shotRows[i][sMap['画像データ(Base64)'] - 1] || '')
    };
  }

  const scopeInfo = getTeacherScopeInfo(teacher);
  const restrictToOwnSchool = scopeInfo.type === 'school' || scopeInfo.type === 'unknown';
  const teacherSchool = scopeInfo.school || '';
  const classRestricted = getTeacherTargetClasses(teacher).length > 0;
  const want = (status || 'all').toLowerCase();

  const out = [];
  for (let i = 1; i < devRows.length; i++) {
    const row = devRows[i];
    const studentId = String(row[dMap['児童ID'] - 1] || '').trim();
    if (!studentId) continue;
    if (only && only.indexOf(studentId) === -1) continue;

    const schoolName = String(row[dMap['学校名'] - 1] || '').trim();
    const className = String(row[dMap['クラス'] - 1] || '').trim();

    if (restrictToOwnSchool && schoolName && schoolName !== '未設定') {
      const devCanonical = resolveCanonicalSchool(schoolName);
      const isOwn = devCanonical ? (devCanonical === teacherSchool) : schoolNamesMatch(schoolName, teacherSchool);
      if (!isOwn) continue;
    }
    if (classRestricted && !isClassInTeacherScope(className, teacher)) continue;
    if (filterSchool && filterSchool !== 'ALL') {
      if (filterSchool === 'UNASSIGNED') {
        if (schoolName && schoolName !== '未設定') continue;
      } else if (includeUnassigned) {
        if (schoolName !== '未設定' && schoolName !== '' && !schoolNamesMatch(schoolName, filterSchool)) continue;
      } else {
        if (!schoolNamesMatch(schoolName, filterSchool)) continue;
      }
    }

    const shot = shotIndex[studentId];
    const requestAt = dMap['画面情報要求日時'] ? String(row[dMap['画面情報要求日時'] - 1] || '').trim() : '';
    const shotAt = dMap['画面情報更新日時'] ? String(row[dMap['画面情報更新日時'] - 1] || '').trim() : '';

    // ready = 画像が保存されている、pending = 要求済みだが未取得
    const ready = !!(shot && shot.b64);
    if (want === 'ready' && !ready) continue;
    if (want === 'pending' && ready) continue;

    out.push({
      student_id: studentId,
      school_name: schoolName,
      student_name: String(row[dMap['氏名'] - 1] || ''),
      class_name: className,
      current_url: String(row[dMap['現在開いているURL'] - 1] || ''),
      is_online: (function () {
        const ls = row[dMap['最終同期日時'] - 1];
        if (!ls) return false;
        const dt = new Date(ls);
        return !isNaN(dt.getTime()) && (new Date().getTime() - dt.getTime()) < 60000;
      })(),
      screen_request_at: requestAt,
      screenshot_at: shotAt,
      has_image: ready,
      image_data_url: ready ? ('data:' + shot.mime + ';base64,' + shot.b64) : ''
    });
  }

  return out;
}

/**
 * 画面一覧の取得状況サマリー（未要求／要求中／取得済 の件数）。
 * console 側でボタンの状態表示・進捗表示に使う。
 */
function getScreenStatus(filterSchool, teacher, includeUnassigned, studentIds) {
  const list = getScreenshots(filterSchool, teacher, includeUnassigned, 'all', studentIds);
  let ready = 0, pending = 0, none = 0;
  list.forEach(function (d) {
    if (d.has_image) ready++;
    else if (d.screen_request_at) pending++;
    else none++;
  });
  return { total: list.length, ready: ready, pending: pending, none: none };
}

// ==================== 同時操作の直列化（競合対策） ====================
// 同じ学校に複数の教員が同時ログインし、各クラスで一括操作を行う運用を想定する。
// 端末一覧シートに対する「読み取り → 書き込み」が同時に走ると、
// 後から来た書き込みが先行の書き込みを上書き（更新の取りこぼし）する恐れがあるため、
// スクリプトロックで書き込み処理を直列化する。
// ※ ハートビート（各児童端末からの高頻度アクセス）はロック対象外とし、
//    教員による操作（一括ロック/配信/規制/単一更新）のみを保護して影響を最小化する。
function withWriteLock(fn) {
  const lock = LockService.getScriptLock();
  let acquired = false;
  try {
    lock.waitLock(15000);
    acquired = true;
  } catch (e) {
    throw new Error('他の操作と競合しました。少し待って再試行してください。');
  }
  try {
    const result = fn();
    // 書き込みが成功したので端末一覧の読み取りキャッシュを無効化する。
    // （次回の get_all が必ず最新のシート内容を返すようにする）
    // ※ テスト等で invalidateDevicesCache が未定義でも安全（typeof ガード）
    try { if (typeof invalidateDevicesCache === 'function') invalidateDevicesCache(); } catch (e) {}
    return result;
  } finally {
    if (acquired) {
      try { lock.releaseLock(); } catch (e) {}
    }
  }
}

// 一斉表示の実行IDを生成する。同時配信でも衝突しないよう、時刻＋乱数で生成する。
// （旧実装はミリ秒のみで、同時実行時に同一IDとなり2回目の配信が児童端末で無視される恐れがあった）
function generateBroadcastId() {
  return 'bc_' + new Date().getTime() + '_' + Math.random().toString(36).slice(2, 7);
}

function bulkUpdateScreenLock(studentIds, lockState) {
  return withWriteLock(function () {
    const sheet = getTargetSheet(CONFIG.DEVICE_SHEET_NAME);
    const headerMap = getHeaderMap(sheet, CONFIG.DEVICE_COLUMNS);
    const data = sheet.getDataRange().getValues();
    const lockCol = headerMap['画面ロック'];
    const idColIdx = headerMap['児童ID'] - 1;

    const isAll = (studentIds === 'ALL' || !Array.isArray(studentIds));
    const idSet = Array.isArray(studentIds) ? new Set(studentIds) : null;

    // 行ごとの setValue をやめ、対象列をまとめて1回で書き込む（GAS/シートの往復を削減）。
    // 対象行が飛び飛びでも、対象範囲を1回だけ読み書きすれば往復は1回で済む。
    let firstRow = -1, lastRow = -1;
    for (let i = 1; i < data.length; i++) {
      const id = String(data[i][idColIdx]).trim();
      if (isAll || (idSet && idSet.has(id))) {
        if (firstRow === -1) firstRow = i + 1;
        lastRow = i + 1;
      }
    }
    if (firstRow !== -1) {
      const range = sheet.getRange(firstRow, lockCol, lastRow - firstRow + 1, 1);
      const cur = range.getValues(); // 既存値を取得し、対象行だけ書き換えて一括反映
      for (let r = 0; r < cur.length; r++) {
        const id = String(data[firstRow - 1 + r][idColIdx]).trim();
        if (isAll || (idSet && idSet.has(id))) cur[r][0] = lockState;
      }
      range.setValues(cur);
    }
  });
}

// 一斉表示URLを配信し、実行IDを生成して返す。
// ※ 実行IDの生成は必ずロック内で行い、同時配信でも別IDとなることを保証する。
function bulkUpdateBroadcastUrl(studentIds, targetUrl, broadcastId) {
  return withWriteLock(function () {
    const bcId = broadcastId || generateBroadcastId();
    const sheet = getTargetSheet(CONFIG.DEVICE_SHEET_NAME);
    const headerMap = getHeaderMap(sheet, CONFIG.DEVICE_COLUMNS);
    const data = sheet.getDataRange().getValues();
    const urlCol = headerMap['一斉表示URL'];
    const bcIdCol = headerMap['一斉表示実行ID'];
    const idColIdx = headerMap['児童ID'] - 1;

    const isAll = (studentIds === 'ALL' || !Array.isArray(studentIds));
    const idSet = Array.isArray(studentIds) ? new Set(studentIds) : null;

    // 対象行の範囲を求め、URL列・実行ID列をまとめて1回で書き込む（往復削減）。
    let firstRow = -1, lastRow = -1;
    for (let i = 1; i < data.length; i++) {
      const id = String(data[i][idColIdx]).trim();
      if (isAll || (idSet && idSet.has(id))) {
        if (firstRow === -1) firstRow = i + 1;
        lastRow = i + 1;
      }
    }
    if (firstRow !== -1) {
      const n = lastRow - firstRow + 1;
      const range = sheet.getRange(firstRow, urlCol, n, 2); // URL列と実行ID列（隣接）
      const cur = range.getValues();
      for (let r = 0; r < n; r++) {
        const id = String(data[firstRow - 1 + r][idColIdx]).trim();
        if (isAll || (idSet && idSet.has(id))) {
          cur[r][0] = targetUrl;
          cur[r][1] = bcId;
        }
      }
      range.setValues(cur);
    }
    return bcId;
  });
}

function bulkUpdateFilterMode(studentIds, filterMode, whitelistUrls, blacklistUrls) {
  return withWriteLock(function () {
    const sheet = getTargetSheet(CONFIG.DEVICE_SHEET_NAME);
    const headerMap = getHeaderMap(sheet, CONFIG.DEVICE_COLUMNS);
    const data = sheet.getDataRange().getValues();
    const modeCol = headerMap['URL規制モード'];
    const whiteCol = headerMap['許可URLリスト'];
    const blackCol = headerMap['規制URLリスト'];
    const idColIdx = headerMap['児童ID'] - 1;

    const isAll = (studentIds === 'ALL' || !Array.isArray(studentIds));
    const idSet = Array.isArray(studentIds) ? new Set(studentIds) : null;

    // 対象行の範囲を求め、モード列・許可/規制リスト列をまとめて1回で書き込む（往復削減）。
    let firstRow = -1, lastRow = -1;
    for (let i = 1; i < data.length; i++) {
      const id = String(data[i][idColIdx]).trim();
      if (isAll || (idSet && idSet.has(id))) {
        if (firstRow === -1) firstRow = i + 1;
        lastRow = i + 1;
      }
    }
    if (firstRow !== -1) {
      const n = lastRow - firstRow + 1;
      const range = sheet.getRange(firstRow, modeCol, n, 3); // モード・許可・規制（隣接3列）
      const cur = range.getValues();
      for (let r = 0; r < n; r++) {
        const id = String(data[firstRow - 1 + r][idColIdx]).trim();
        if (isAll || (idSet && idSet.has(id))) {
          cur[r][0] = filterMode;
          if (whitelistUrls !== undefined && whitelistUrls !== null) cur[r][1] = whitelistUrls;
          if (blacklistUrls !== undefined && blacklistUrls !== null) cur[r][2] = blacklistUrls;
        }
      }
      range.setValues(cur);
    }
  });
}

function updateSingleDevice(studentId, updateData) {
  return withWriteLock(function () {
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
      sheet.getRange(targetRow, headerMap['一斉表示実行ID']).setValue(generateBroadcastId());
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
  });
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

// ---- 教員コンソールの稼働通知 API (google.script.run 用) ----
// GAS ネイティブ画面（script.google.com）からは content script へ postMessage が
// 届かない場合があるため、確実に届く google.script.run 経由の経路を用意する。
function api_consoleTouch() {
  try { return touchTeacherConsole(); } catch (err) { return { success: false, error: err.toString() }; }
}

function api_consoleRelease() {
  try { return releaseTeacherConsole(); } catch (err) { return { success: false, error: err.toString() }; }
}

function api_login(email, password) {
  try {
    const res = handleTeacherLogin(email, password);
    return JSON.parse(res.getContent());
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

/**
 * セッション検証 & 最新の教員情報の取得（google.script.run 用）。
 * ローカルに保存された教員情報（所属学校・権限）が古い場合でも、
 * 教員マスタの最新レコードを返すことでフロントのスコープ判定を正しく保つ。
 */
function api_verifySession(token) {
  try {
    const auth = verifyToken(token);
    if (!auth.valid) return { success: false, need_auth: true, error: '認証セッションが無効です' };
    const currentTeacher = resolveCurrentTeacher(auth.teacher);
    return { success: true, teacher: currentTeacher };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

function api_getAllDevices(token, schoolName, includeUnassigned) {
  try {
    const auth = verifyToken(token);
    if (!auth.valid) return { success: false, need_auth: true, error: '認証セッションが無効です' };
    const currentTeacher = resolveCurrentTeacher(auth.teacher);
    const data = getAllDevices(schoolName, currentTeacher, Boolean(includeUnassigned));
    return { success: true, data: data };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

// ---- 画面一覧（スクリーンショット）API (google.script.run 用) ----

function api_requestScreens(token, studentIds) {
  try {
    const auth = verifyToken(token);
    if (!auth.valid) return { success: false, need_auth: true, error: '認証セッションが無効です' };
    const currentTeacher = resolveCurrentTeacher(auth.teacher);
    const result = requestScreenCapture(studentIds, currentTeacher);
    if (result.requested === 0) {
      return { success: false, error: '画面情報を要求できる児童がいません（自校の児童のみ対象）' };
    }
    return { success: true, message: `${result.requested} 台の画面情報取得を要求しました`, result: result };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

function api_getScreens(token, schoolName, includeUnassigned, status, studentIds) {
  try {
    const auth = verifyToken(token);
    if (!auth.valid) return { success: false, need_auth: true, error: '認証セッションが無効です' };
    const currentTeacher = resolveCurrentTeacher(auth.teacher);
    const data = getScreenshots(schoolName, currentTeacher, Boolean(includeUnassigned), status || 'all', studentIds);
    return { success: true, data: data };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

function api_bulkLock(token, studentIds, locked) {
  try {
    const auth = verifyToken(token);
    if (!auth.valid) return { success: false, need_auth: true, error: '認証セッションが無効です' };
    const currentTeacher = resolveCurrentTeacher(auth.teacher);
    const scoped = scopeStudentIdsForTeacher(studentIds, currentTeacher);
    if (Array.isArray(scoped.ids) && scoped.ids.length === 0) {
      return { success: false, error: '操作対象の児童がありません（自校の児童のみ操作できます）' };
    }
    bulkUpdateScreenLock(scoped.ids, Boolean(locked));
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
    const currentTeacher = resolveCurrentTeacher(auth.teacher);
    const scoped = scopeStudentIdsForTeacher(studentIds, currentTeacher);
    if (Array.isArray(scoped.ids) && scoped.ids.length === 0) {
      return { success: false, error: '操作対象の児童がありません（自校の児童のみ操作できます）' };
    }
    const bcId = bulkUpdateBroadcastUrl(scoped.ids, url, '');
    return { success: true, broadcast_id: bcId };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

function api_bulkFilter(token, studentIds, mode, whitelist, blacklist) {
  try {
    const auth = verifyToken(token);
    if (!auth.valid) return { success: false, need_auth: true, error: '認証セッションが無効です' };
    const currentTeacher = resolveCurrentTeacher(auth.teacher);
    const scoped = scopeStudentIdsForTeacher(studentIds, currentTeacher);
    if (Array.isArray(scoped.ids) && scoped.ids.length === 0) {
      return { success: false, error: '操作対象の児童がありません（自校の児童のみ操作できます）' };
    }
    bulkUpdateFilterMode(scoped.ids, mode, whitelist, blacklist);
    try {
      saveTeacherSettings(currentTeacher.email, {
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
    const currentTeacher = resolveCurrentTeacher(auth.teacher);
    const targetStudent = getDeviceByStudentId(studentId);
    if (!targetStudent) return { success: false, error: '児童IDが見つかりません: ' + studentId };
    if (!isDeviceInTeacherScope(targetStudent.school_name, currentTeacher, targetStudent.class_name)) {
      return { success: false, error: '対象外の児童は操作できません（学校・対象クラスの範囲外）' };
    }
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
    const currentTeacher = resolveCurrentTeacher(auth.teacher);
    // マイURL・個別規制URLは TEACHER 権限でも保存可。対象クラスは管理者のみ反映。
    const safeSettings = sanitizeTeacherSettingsForSave(settings || {}, currentTeacher);
    const updatedTeacher = saveTeacherSettings(currentTeacher.email, safeSettings);
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

// ---- 管理者(ADMIN)専用：アカウント管理 API ----
function api_getTeachers(token) {
  try {
    const auth = verifyToken(token);
    if (!auth.valid) return { success: false, need_auth: true, error: '認証セッションが無効です' };
    return { success: true, teachers: getAllTeachers(auth.teacher), schools: CONFIG.SCHOOL_LIST };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

function api_addTeacher(token, data) {
  try {
    const auth = verifyToken(token);
    if (!auth.valid) return { success: false, need_auth: true, error: '認証セッションが無効です' };
    return { success: true, message: '教員を登録しました', teacher: addTeacher(auth.teacher, data || {}) };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

function api_updateTeacher(token, data) {
  try {
    const auth = verifyToken(token);
    if (!auth.valid) return { success: false, need_auth: true, error: '認証セッションが無効です' };
    return { success: true, message: '教員情報を更新しました', teacher: updateTeacherRecord(auth.teacher, data || {}) };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

function api_addStudent(token, data) {
  try {
    const auth = verifyToken(token);
    if (!auth.valid) return { success: false, need_auth: true, error: '認証セッションが無効です' };
    return { success: true, message: '児童を登録しました', student: addStudentRecord(auth.teacher, data || {}) };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

// ---- 管理者(ADMIN)専用：インポート / 年次更新 API (google.script.run 用) ----
function api_importStudents(token, data) {
  try {
    const auth = verifyToken(token);
    if (!auth.valid) return { success: false, need_auth: true, error: '認証セッションが無効です' };
    const result = importStudents(auth.teacher, data || {});
    return { success: true, message: '児童データをインポートしました', result: result };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

function api_importTeachers(token, data) {
  try {
    const auth = verifyToken(token);
    if (!auth.valid) return { success: false, need_auth: true, error: '認証セッションが無効です' };
    const result = importTeachers(auth.teacher, data || {});
    return { success: true, message: '教員データをインポートしました', result: result };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

function api_runAnnualRollover(token, data) {
  try {
    const auth = verifyToken(token);
    if (!auth.valid) return { success: false, need_auth: true, error: '認証セッションが無効です' };
    const result = runAnnualRollover(auth.teacher, data || {});
    return { success: true, message: '年次更新を実行しました', result: result };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

function api_getArchivedStudents(token) {
  try {
    const auth = verifyToken(token);
    if (!auth.valid) return { success: false, need_auth: true, error: '認証セッションが無効です' };
    return { success: true, data: getArchivedStudents(auth.teacher) };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}


