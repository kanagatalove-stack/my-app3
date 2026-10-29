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

  // ==========================================================
  // 子GAS分散（SHARD_MODE / ハブ＆スポーク）
  //   1校240台 × 1.5秒周期 ≒ 160 req/秒 を 1 実行で受けると、GAS の
  //   「同時実行 30/ユーザー」に達する。クラス単位で子GASへ分散して回避する。
  //
  //   SHARD_MODE       … このスクリプトが「親（ハブ）」として振る舞う
  //   SHARD_CHILD_MODE … このスクリプトが「子（スポーク）」として振る舞う
  //   両方 false（既定）… 従来の 1校1GAS と完全に同一動作（後方互換）
  //
  //   ※ 子GAS側のコードもこのファイル1つ。SHARD_CHILD_MODE=true にするだけ。
  //   ※ 子GASはハートビートのみ担当し、ロック/規制/配信の正は親に置く。
  //     親コンソールは親の端末一覧だけを見るため、教員は常に1画面のまま。
  // ==========================================================
  SHARD_MODE: false,
  SHARD_CHILD_MODE: false,
  // 子へポリシーを伝達したときの通信タイムアウト（ミリ秒）
  SHARD_FETCH_TIMEOUT_MS: 8000,
  // スクリプトプロパティが未設定・不正なときに使う既定値（フォールバック）。
  // ※ 通常運用ではスクリプトプロパティ側で設定する。ここは「最後の砦」。
  //   SHARD_MAP の空キー "" は「クラスが特定できない端末の既定ルーティング先」。
  SHARD_MAP: {},
  SHARD_DEFAULT_URL: '',

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
    '画面情報更新日時',
    // AI監視（学習に関係のないサイトの検知）用の列。
    // システム全体のON/OFF が管理者により切り替えられる。OFF のときは
    // getAllDevices 側で「要注意=false」に伏せて返すため、管理画面の注意マークは消える。
    // ※ 既存シートには ensureDeviceHeaders が末尾へ自動追加する（後方互換）。
    '要注意',
    '注意理由',
    '要注意URL',
    '注意検知日時'
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
  // 書き込み先スプレッドシートIDはスクリプトプロパティ優先（子GASはここで子シートを指定）。
  const spreadsheetId = getSpreadsheetId();
  let ss;
  try {
    ss = SpreadsheetApp.openById(spreadsheetId);
  } catch (err) {
    ss = SpreadsheetApp.getActiveSpreadsheet();
  }
  if (!ss) {
    throw new Error('スプレッドシートを開けませんでした。ID: ' + spreadsheetId);
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
      const hbGet = processHeartbeat(studentId, currentUrl, params.school_name);
      return jsonResponse({ success: true, ...hbGet, ...resolveShardForHeartbeat(studentId, hbGet.class_name) });
    }

    // 1-b. 端末の起こし確認（GET・シート非接触の軽量応答）
    if (api === 'wake_check') {
      return jsonResponse(getWakeInfo());
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
      const hb = processHeartbeat(studentId, currentUrl, payload.school_name);
      // 子GAS分散（SHARD_MODE）: 親は端末のクラスから「子GAS URL」を解決して返す。
      // 親でない場合 resolveShardForHeartbeat は {} を返すため、応答は従来と完全に同一。
      return jsonResponse({ success: true, ...hb, ...resolveShardForHeartbeat(studentId, hb.class_name) });
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

    // A3. 教員コンソールの稼働通知（ログイン中は 15 秒ごとに touch、ログアウト/タブ閉じで release）。
    //     児童端末はハートビート応答の ka_active を見て同期周期を切り替える。
    //     session_id を付けることで、複数アカウントのうち 1 つが終了しても他が稼働中なら維持される。
    //     ※ 認証不要（トークンを持たない経路もあるため）。稼働時刻を記録するだけの軽量処理。
    if (action === 'console_touch') {
      const touchRes = touchTeacherConsole(payload.session_id);
      // 子GAS分散: 子は親のコンソール稼働を知る手段が無いため、ここで配る。
      // （配らないと子担当の端末が ka_active=false を受け取り同期を止める）
      shardPropagateKaState(true);
      return jsonResponse(touchRes);
    }
    if (action === 'console_release') {
      const releaseRes = releaseTeacherConsole(payload.session_id);
      // 全セッションが消えた（＝非稼働）ときだけ子へ停止を伝える
      try { if (!isTeacherConsoleActive()) shardPropagateKaState(false); } catch (e) {}
      return jsonResponse(releaseRes);
    }

    // A4. 端末の「起こし確認」。シートに触らない軽量応答（通信負荷を増やさない）。
    //     端末は wake_epoch の変化、または ka_active=true を見たら通常同期へ復帰する。
    if (action === 'wake_check') {
      return jsonResponse(getWakeInfo());
    }
    // A5. 管理アプリからの明示的な一斉叩き起こし（ログイン直後に呼ばれる）。
    if (action === 'console_wake') {
      bumpWakeEpoch();
      return jsonResponse(getWakeInfo());
    }

    // A6. 子GAS分散（SHARD_MODE）: 親⇔子の通信。
    //     教員トークンではなく共有シークレット（SHARD_SECRET）で認証する。
    //     ・shard_apply … 子GASが親からポリシーを受け取る
    //     ・shard_push  … 親GASが子GASからテレメトリを受け取る
    if (action === 'shard_apply') {
      return jsonResponse(shardApplyFromParent(payload));
    }
    if (action === 'shard_push') {
      return jsonResponse(shardUpsertTelemetryFromChild(payload));
    }
    // 親が子の端末一覧を取りに来る（コンソールの1画面集約用）
    if (action === 'shard_list') {
      return jsonResponse(shardListForParent(payload));
    }
    // 子GASが「この児童は誰か（氏名・学校・クラス）」を親の名簿へ問い合わせる。
    // 子は名簿を持たないため、これが無いとクラス未取得の端末が永久に直らない。
    if (action === 'shard_lookup') {
      if (!shardSecretMatches(payload && payload.shard_secret)) {
        return jsonResponse({ success: false, found: false, error: 'unauthorized' });
      }
      return jsonResponse(shardLookupStudent(payload.student_id));
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
      // 子GAS分散: 子の端末も同じ画面に並べる（教員は1画面のまま）。
      // 子GASへは並列（fetchAll）で問い合わせ、集約結果を数秒キャッシュする。
      const data = getShardMergedDevices(
        payload.school_name, currentTeacher, Boolean(payload.include_unassigned));
      return jsonResponse({ success: true, data: data });
    }

    // D1. AI監視設定の取得（読み取りは全教員可。変更可否の判断材料として is_admin を返す）
    if (action === 'get_monitor_settings') {
      return jsonResponse({
        success: true,
        settings: getMonitoringSettings(),
        is_admin: isAdminTeacher(currentTeacher)
      });
    }

    // D1-2. AI監視設定の保存（システム全体・管理者のみ）
    if (action === 'save_monitor_settings') {
      const saved = saveMonitoringSettings(currentTeacher, payload.settings || {});
      return jsonResponse({ success: true, message: '監視設定を保存しました', settings: saved });
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
      // 子GAS分散: 該当クラスの子GASへも同じロック状態を伝達する（SHARD_MODE=false なら何もしない）
      const shardLock = shardPropagatePolicy(scoped.ids, { screen_lock: Boolean(payload.locked) });
      return jsonResponse({ success: true, message: `画面ロックを ${payload.locked ? 'ON' : 'OFF'} に更新しました`, shard: shardLock });
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
      const shardBc = shardPropagatePolicy(scoped.ids, { broadcast_url: targetUrl });
      return jsonResponse({ success: true, message: '一斉URLを配信しました', broadcast_id: broadcastId, shard: shardBc });
    }

    // G. URL規制一括変更（教員の所属学校スコープを適用）
    if (action === 'bulk_filter') {
      const scoped = scopeStudentIdsForTeacher(payload.student_ids, currentTeacher);
      if (Array.isArray(scoped.ids) && scoped.ids.length === 0) {
        return jsonResponse({ success: false, error: '操作対象の児童がありません（自校の児童のみ操作できます）' });
      }
      bulkUpdateFilterMode(scoped.ids, payload.filter_mode, payload.whitelist_urls, payload.blacklist_urls);
      const shardFilter = shardPropagatePolicy(scoped.ids, {
        filter_mode: payload.filter_mode,
        whitelist_urls: payload.whitelist_urls,
        blacklist_urls: payload.blacklist_urls
      });
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
      return jsonResponse({ success: true, message: `URL規制モードを ${payload.filter_mode} に更新しました`, shard: shardFilter });
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
      const single = payload.data || {};
      const shardPatch = {};
      if (single.screen_lock !== undefined) shardPatch.screen_lock = Boolean(single.screen_lock);
      if (single.filter_mode !== undefined) shardPatch.filter_mode = single.filter_mode;
      if (single.whitelist_urls !== undefined) shardPatch.whitelist_urls = single.whitelist_urls;
      if (single.blacklist_urls !== undefined) shardPatch.blacklist_urls = single.blacklist_urls;
      if (single.broadcast_url) shardPatch.broadcast_url = single.broadcast_url;
      const shardSingle = Object.keys(shardPatch).length
        ? shardPropagatePolicy([payload.student_id], shardPatch) : { skipped: true };
      return jsonResponse({ success: true, message: '設定を更新しました', shard: shardSingle });
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

    // S. 子GAS分散の設定（管理者のみ）
    //    教員コンソールは「1画面」のまま。ここで子GASの割り当てを管理する。
    if (action === 'get_shard_settings') {
      return jsonResponse({ success: true, settings: getShardSettingsForAdmin(),
        is_admin: isAdminTeacher(currentTeacher) });
    }
    if (action === 'save_shard_settings') {
      try {
        const saved = saveShardSettingsForAdmin(currentTeacher, payload.settings || payload);
        return jsonResponse({ success: true, message: '子GASの割り当てを保存しました', settings: saved });
      } catch (e) {
        return jsonResponse({ success: false, error: String(e) });
      }
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
  const signature = Utilities.computeHmacSha256Signature(base64, getTokenSecret());
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

    const expectedSig = Utilities.computeHmacSha256Signature(base64, getTokenSecret());
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
//       ・児童端末はハートビート応答の ka_active を見て、同期周期を切り替える。
//           稼働中（＝管理アプリを誰かが開いている）: 1.5 秒（速い）
//           非稼働（＝管理アプリを誰も開いていない）: 同期しない（doPost = 0）
//       ※ 児童端末は GAS としか通信できないため、GAS を介するのが唯一確実な方法。
//
// 【v1.6.0 変更点】「管理アプリ未起動時の無駄な通信（doPost の数秒おき実行）」を完全に止める。
//   ・旧: 稼働/非稼働いずれでも syncWithGas が動き続けた（非稼働時も 15 秒ごとに doPost）。
//   ・新: 非稼働（ka_active=false）を確認したら児童端末側の同期を完全停止し、doPost を 0 にする。
//   ・ただし「停止」したまま管理アプリが再度開かれても気付けなくなるため、児童端末は
//     稼働→非稼働へ切り替わった直後だけ、ごく短い間（アイドル猶予）に限って低頻度で
//     再確認する。この猶予が尽きたら完全停止し、以後は一切通信しない（管理アプリの再起動は
//     端末側イベント＝タブ作成/URL更新/コンテンツPINGで即再開できる）。
//
// 【複数アカウント対応】
//   ・教員コンソール（管理アプリ）は、ログイン中にセッションID付きで console_touch を送る。
//   ・GAS は「現在生きているセッションID → 最終touch時刻」のマップで稼働を管理する。
//   ・1人のログアウト/タブ閉じ/ブラウザ終了では console_release(そのID) で当該セッションだけを
//     消し、**全セッションが消えたときだけ**非稼働（ka_active=false）になる。
const KA_KEY = 'ka_console';
const KA_PROP_KEY = 'KA_LAST_TOUCH'; // PropertiesService（永続）側のキー（後方互換の残置）
const KA_SESS_KEY = 'ka_sessions';   // 稼働セッションマップ（{sessionId: 最終touchエポックms}）のキャッシュキー
const KA_SESS_PROP_KEY = 'KA_SESSIONS'; // 同マップの PropertiesService 側キー（永続）
const KA_ACTIVE_WINDOW_MS = 120000;  // touch が 120 秒来なければそのセッションは失効とみなす
const KA_MAX_SESSIONS = 200;         // セッションマップの安全上限（際限ない増加を防止）
const KA_IDLE_DRIFT_SEC = 20;        // 稼働→非稼働に切替後、再開を確認するために低頻度(1秒)で再確認する猶予（秒）
const ACTIVE_SYNC_INTERVAL_SEC = 1.5; // 稼働中（管理アプリを誰かが開いている）の児童端末の同期周期（秒）

/**
 * 稼働セッションマップ（{sessionId: 最終touchエポックms}）を CacheService→PropertiesService の
 * 順で読み込む。片方しか無ければ他方で補完し、双方に反映する（キャッシュ失効による取りこぼし防止）。
 */
function readKaSessions() {
  let map = {};
  try {
    const v = CacheService.getScriptCache().get(KA_SESS_KEY);
    if (v) map = JSON.parse(v) || {};
  } catch (e) { map = {}; }
  if (!map || typeof map !== 'object' || Object.keys(map).length === 0) {
    try {
      const p = PropertiesService.getScriptProperties().getProperty(KA_SESS_PROP_KEY);
      if (p) map = JSON.parse(p) || {};
    } catch (e) {}
  }
  if (!map || typeof map !== 'object') map = {};
  return map;
}

/** 稼働セッションマップを CacheService（一時）と PropertiesService（永続）の両方へ保存する。 */
function writeKaSessions(map) {
  const json = JSON.stringify(map || {});
  try { CacheService.getScriptCache().put(KA_SESS_KEY, json, 240); } catch (e) {}
  try { PropertiesService.getScriptProperties().setProperty(KA_SESS_PROP_KEY, json); } catch (e) {}
}

function pruneKaSessions(map, nowMs) {
  const out = {};
  let count = 0;
  Object.keys(map || {}).forEach(function (id) {
    const t = Number(map[id]) || 0;
    if ((nowMs - t) < KA_ACTIVE_WINDOW_MS && count < KA_MAX_SESSIONS) {
      out[id] = t;
      count++;
    }
  });
  return out;
}

/**
 * 教員コンソールの稼働を記録する（ログイン中に 15 秒ごとに呼ばれる）。
 * sessionId をキーにしたマップで管理し、**複数アカウントが同時にログインしていても**
 * 1つのセッションの終了では他の稼働を止めない（全セッションが消えたときだけ非稼働）。
 * sessionId 未指定（後方互換）の場合は単一キーで記録する。
 */
function touchTeacherConsole(sessionId) {
  const nowMs = new Date().getTime();
  const id = String(sessionId || '').trim();

  // 「誰も管理アプリを開いていない」状態からの最初のログインを検出する。
  // この瞬間だけ緊急呼び出しフラグを更新し、眠っている端末を一斉に起こす。
  // 稼働中の 15 秒ごとの touch ではフラグを更新しない（無駄な検知・保存を避ける）。
  let wasActive = true;
  try { wasActive = isTeacherConsoleActive(); } catch (e) { wasActive = true; }

  try {
    const map = pruneKaSessions(readKaSessions(), nowMs);
    map[id || '__default__'] = nowMs;
    writeKaSessions(map);
  } catch (e) {}

  let wakeEpoch = 0;
  if (!wasActive) {
    try { wakeEpoch = bumpWakeEpoch(); } catch (e) { wakeEpoch = 0; }
  }
  // 後方互換（旧バージョンの判定・記録用）。sessionId 無しのときのみ更新する。
  if (!id) {
    try { CacheService.getScriptCache().put(KA_KEY, String(nowMs), 240); } catch (e) {}
    try { PropertiesService.getScriptProperties().setProperty(KA_PROP_KEY, String(nowMs)); } catch (e) {}
  }
  return { success: true, at: nowMs, wake_epoch: (wakeEpoch || readWakeEpoch()) };
}

/**
 * 教員コンソールの稼働を解除する（ログアウト・タブ閉じ・ブラウザ終了時）。
 * ・sessionId 指定時 … そのセッションだけをマップから削除（他アカウントの稼働は維持）
 * ・未指定時         … 全セッションを解除（従来動作）
 */
function releaseTeacherConsole(sessionId) {
  const nowMs = new Date().getTime();
  const id = String(sessionId || '').trim();
  try {
    if (id) {
      const map = pruneKaSessions(readKaSessions(), nowMs);
      delete map[id];
      writeKaSessions(map);
    } else {
      writeKaSessions({});
    }
  } catch (e) {}
  try { CacheService.getScriptCache().remove(KA_KEY); } catch (e) {}
  try { PropertiesService.getScriptProperties().deleteProperty(KA_PROP_KEY); } catch (e) {}
  return { success: true };
}

/**
 * 教員コンソールが稼働中かどうか。
 * 稼働セッションマップに「直近 KA_ACTIVE_WINDOW_MS 以内に touch されたセッション」が残っていれば稼働中。
 * 旧形式（単一キー）が残っている場合も後方互換で考慮する。
 */
function isTeacherConsoleActive() {
  const nowMs = new Date().getTime();
  try {
    const map = pruneKaSessions(readKaSessions(), nowMs);
    if (Object.keys(map).length > 0) return true;
  } catch (e) {}
  // 後方互換: 旧単一キー運用の残置値も見る
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

// ==================== 緊急呼び出し（一斉叩き起こし） ====================
// 課題: 非稼働になると児童端末は同期を完全停止する（通信負荷ゼロのため）。
//       その状態で先生が再ログインしても、端末は眠ったままで復帰できない。
//       「蓋を閉じて開いただけ」では onStartup もタブ生成も発生しないため、
//       端末側に復帰のきっかけが存在しなかった。
// 対策: 誰も稼働していない状態から教員がログインした瞬間に「緊急呼び出しフラグ」
//       （wake_epoch）を更新する。端末は軽量な wake_check でこの値の変化を見て、
//       変化があれば即座に通常のハートビート（詳細なオンライン通知）を送る。
//       wake_check は CacheService / PropertiesService だけを読み、シートに触らない
//       ＝1回あたりの GAS 実行が非常に軽い（通信負荷を増やさないための要）。
const WAKE_CACHE_KEY = 'wake_epoch';
const WAKE_PROP_KEY = 'WAKE_EPOCH_V1';

/** 緊急呼び出しフラグの現在値を読む（0 = まだ一度も発行されていない）。 */
function readWakeEpoch() {
  try {
    const v = CacheService.getScriptCache().get(WAKE_CACHE_KEY);
    if (v) return Number(v) || 0;
  } catch (e) {}
  try {
    const p = PropertiesService.getScriptProperties().getProperty(WAKE_PROP_KEY);
    return Number(p) || 0;
  } catch (e) { return 0; }
}

/** 緊急呼び出しフラグを更新する（この値の変化を端末が検知して起きる）。 */
function bumpWakeEpoch() {
  const nowMs = new Date().getTime();
  try { CacheService.getScriptCache().put(WAKE_CACHE_KEY, String(nowMs), 21600); } catch (e) {}
  try { PropertiesService.getScriptProperties().setProperty(WAKE_PROP_KEY, String(nowMs)); } catch (e) {}
  return nowMs;
}

/**
 * 端末の「起こし確認」用の軽量応答。シートを一切読まない。
 * 端末はこの応答だけで「今すぐ詳細同期すべきか」を判断できる。
 */
function getWakeInfo() {
  const nowMs = new Date().getTime();
  const kaActive = isTeacherConsoleActive();
  return {
    success: true,
    ka_active: kaActive,
    wake_epoch: readWakeEpoch(),
    sync_interval_sec: kaActive ? ACTIVE_SYNC_INTERVAL_SEC : 0,
    idle_drift_until: kaActive ? 0 : (nowMs + (KA_IDLE_DRIFT_SEC * 1000)),
    server_time: nowMs
  };
}

/**
 * 児童端末の同期周期（秒）を GAS から一元配布する。
 *   ・稼働中（管理アプリを誰かが開いている）            : 1.5 秒（速い反映）
 *   ・非稼働（誰も開いていない）                        : 0（同期しない＝doPost を発生させない）
 *   ・稼働→非稼働へ切り替わってから KA_IDLE_DRIFT_SEC 秒以内: 1 秒（低頻度で再開を確認する猶予）
 * これにより「管理アプリを起動していないときは通信しない」を GAS 主導で制御できる
 * （GAS を更新すれば児童端末の拡張機能を再配布しなくても挙動を切り替えられる）。
 */
function computeKaInterval(res, nowMs) {
  const sec = typeof res === 'number' ? res : Number(res);
  const idleDriftUntil = nowMs + (KA_IDLE_DRIFT_SEC * 1000);
  if (!isFinite(sec) || sec <= 0) {
    return { ka_active: false, sync_interval_sec: 0, idle_drift_until: idleDriftUntil };
  }
  return { ka_active: true, sync_interval_sec: sec, idle_drift_until: 0 };
}

/**
 * 端末から届いた学校名を、端末一覧に書いてよい正式名称へ解決する。
 *
 * heartbeat は認証不要のため、任意の文字列をそのままシートへ書き込むと
 * 学校スコープ（教員が自校の児童だけを見る境界）を欺けてしまう。
 * そこで CONFIG.SCHOOL_LIST に解決できた正式名称だけを受け付け、
 * 解決できない値は「情報なし」として扱う（シートは従来どおり未設定のまま）。
 */
function canonicalizeIncomingSchool(raw) {
  const s = String(raw || '').trim();
  if (!s || s === '未設定') return '';
  if (typeof normalizeSchoolName !== 'function') return '';
  if (!CONFIG || !Array.isArray(CONFIG.SCHOOL_LIST)) return '';

  const n = normalizeSchoolName(s);
  if (!n) return '';

  // 1. 正式名称との完全一致（「美作市立〜」等の接頭辞は normalizeSchoolName が吸収する）
  for (let i = 0; i < CONFIG.SCHOOL_LIST.length; i++) {
    if (normalizeSchoolName(CONFIG.SCHOOL_LIST[i]) === n) return CONFIG.SCHOOL_LIST[i];
  }

  // 2. 明示的に定義した略称のみ許可（「英田小」「大原小」等）
  if (typeof SCHOOL_ALIASES === 'object' && SCHOOL_ALIASES) {
    for (const alias in SCHOOL_ALIASES) {
      if (normalizeSchoolName(alias) === n) {
        const canon = SCHOOL_ALIASES[alias];
        if (CONFIG.SCHOOL_LIST.indexOf(canon) !== -1) return canon;
      }
    }
  }

  // 3. 部分一致は使わない。
  //    resolveCanonicalSchool は「学校」「小」のような曖昧な入力でも先頭の学校に
  //    一致させてしまうため、認証不要の heartbeat から受け取る値の検証には使わない。
  return '';
}

// ==================== AI監視（学習に関係のないサイトの検知） ====================
// 判定方式はハイブリッド:
//   (a) あらかじめ用意したドメイン辞書（学習ドメイン / 非学習ドメイン）
//   (b) 先生が登録するリスト（端末の「許可URLリスト」「規制URLリスト」）
// 判定の優先順位（誤検知を避けるため「許可」を最優先にする）:
//   1. 端末の許可URLリストに一致            -> 注意しない
//   2. 学習ドメイン辞書に一致              -> 注意しない
//   3. 端末の規制URLリストに一致            -> 要注意（明示的に規制されたサイト）
//   4. 非学習ドメイン辞書に一致            -> 要注意（学習に関係のないサイト）
//   5. どれにも一致しない                  -> 注意しない（未知サイトは黙認）
// これにより、先生が許可URLリストへ追加すれば辞書より優先して誤検知を打ち消せる。
//
// システム全体のON/OFF は PropertiesService に保存し、管理者のみ変更できる。

/** 監視設定の保存キー（PropertiesService のスクリプトプロパティ） */
const MONITOR_PROP_KEY = 'MONITOR_SETTINGS_V1';

/** 辞書に登録できるドメイン数の上限（異常に大きな設定でGASが重くならないように） */
const MONITOR_MAX_DOMAINS = 500;

/** 既定の学習ドメイン（= 注意マークを出さないサイト） */
const MONITOR_DEFAULT_LEARNING_DOMAINS = [
  'google.com', 'google.co.jp', 'gstatic.com', 'googleusercontent.com',
  'classroom.google.com', 'docs.google.com', 'drive.google.com', 'sites.google.com',
  'meet.google.com', 'forms.google.com', 'jamboard.google.com',
  'microsoft.com', 'office.com', 'microsoftonline.com', 'live.com',
  'apple.com', 'icloud.com',
  'nhk.or.jp', 'nhk.jp',
  'scratch.mit.edu', 'code.org', 'codehs.com', 'eboard.ch',
  'tokyoshoseki.co.jp', 'gakken.co.jp', 'benesse.co.jp', 'z-kai.co.jp',
  'monoxer.com', 'qwerty.jp', 'atama-plus.jp', 'loilo.tv',
  'wikipedia.org', 'kotobank.jp', 'weblio.jp', 'jisho.org', 'britannica.com',
  'geogebra.org', 'desmos.com', 'wolframalpha.com', 'phet.colorado.edu',
  'typing.com', 'typingclub.com',
  'canva.com', 'figma.com', 'miro.com', 'padlet.com', 'edpuzzle.com',
  'kahoot.com', 'nearpod.com', 'seesaw.me', 'classdojo.com'
];

/** 既定の非学習ドメイン（= 開いていると注意マークを出すサイト） */
const MONITOR_DEFAULT_BLOCKED_DOMAINS = [
  // 動画・配信
  'youtube.com', 'youtu.be', 'niconico.jp', 'nicovideo.jp', 'dailymotion.com',
  'abema.tv', 'hulu.com', 'netflix.com', 'disneyplus.com', 'primevideo.com',
  // SNS・掲示板
  'tiktok.com', 'twitter.com', 'x.com', 'instagram.com', 'facebook.com',
  'threads.net', 'snapchat.com', 'reddit.com', 'pinterest.com', 'tumblr.com',
  'line.me', 'discord.com', 'twitch.tv',
  // ゲーム
  'roblox.com', 'minecraft.net', 'fortnite.com', 'epicgames.com',
  'steampowered.com', 'riotgames.com', 'poki.com', 'coolmathgames.com',
  'crazygames.com', 'kongregate.com', 'miniclip.com', 'y8.com', 'friv.com',
  'addictinggames.com', 'silvergames.com',
  // 音楽・通販
  'spotify.com', 'soundcloud.com',
  'amazon.co.jp', 'rakuten.co.jp', 'mercari.com'
];

/**
 * URL からホスト名だけを取り出して正規化する。
 * 例: https://www.YouTube.com/watch?v=x -> youtube.com
 * GAS(V8) には WHATWG URL が無いため正規表現で処理する。
 */
function normalizeMonitorHost(rawUrl) {
  let s = String(rawUrl || '').trim().toLowerCase();
  if (!s) return '';
  s = s.replace(/^[a-z][a-z0-9+.\-]*:\/\//, ''); // スキーム除去
  s = s.replace(/^\/\//, '');                     // プロトコル相対
  s = s.split(/[\/?#]/)[0];                       // パス・クエリ・ハッシュ除去
  s = s.split('@').pop();                         // userinfo 除去
  s = s.replace(/:\d+$/, '');                     // ポート除去
  s = s.replace(/^www\./, '');                    // www. 除去
  s = s.replace(/\.$/, '');                       // 末尾ドット除去
  return s;
}

/**
 * ホスト名がドメイン一覧のいずれかに一致するか。
 * 完全一致に加え、サブドメイン一致（host が ".<domain>" で終わる）も許可する。
 * 例: docs.google.com は google.com に一致する。
 */
function hostMatchesAnyDomain(host, domains) {
  const h = String(host || '').trim().toLowerCase();
  if (!h) return false;
  if (!Array.isArray(domains)) return false;
  for (let i = 0; i < domains.length; i++) {
    const d = normalizeMonitorHost(domains[i]);
    if (!d) continue;
    if (h === d) return true;
    if (h.length > d.length && h.slice(-(d.length + 1)) === '.' + d) return true;
  }
  return false;
}

/**
 * 監視設定を取得する。未保存なら既定値（enabled=false）を返す。
 * enabled の既定は false（明示的にONにしない限り注意マークは出さない）。
 */
function getMonitoringSettings() {
  const defaults = {
    enabled: false,
    learning_domains: MONITOR_DEFAULT_LEARNING_DOMAINS.slice(),
    blocked_domains: MONITOR_DEFAULT_BLOCKED_DOMAINS.slice(),
    updated_at: '',
    updated_by: ''
  };
  try {
    if (typeof PropertiesService === 'undefined') return defaults;
    const raw = PropertiesService.getScriptProperties().getProperty(MONITOR_PROP_KEY);
    if (!raw) return defaults;
    const o = JSON.parse(raw);
    if (!o || typeof o !== 'object') return defaults;
    return {
      enabled: o.enabled === true,
      learning_domains: Array.isArray(o.learning_domains)
        ? o.learning_domains.map(function (v) { return String(v); })
        : defaults.learning_domains,
      blocked_domains: Array.isArray(o.blocked_domains)
        ? o.blocked_domains.map(function (v) { return String(v); })
        : defaults.blocked_domains,
      updated_at: String(o.updated_at || ''),
      updated_by: String(o.updated_by || '')
    };
  } catch (e) {
    return defaults;
  }
}

/**
 * 管理者が送ってきたドメイン一覧を正規化・重複除去して安全な配列にする。
 */
function sanitizeMonitorDomainList(list) {
  const out = [];
  const seen = {};
  if (!Array.isArray(list)) return out;
  for (let i = 0; i < list.length && out.length < MONITOR_MAX_DOMAINS; i++) {
    const d = normalizeMonitorHost(list[i]);
    if (!d) continue;
    // ホスト名として妥当な文字だけ許可（空白・山括弧等を弾く）
    if (!/^[a-z0-9.\-]+$/.test(d)) continue;
    if (seen[d]) continue;
    seen[d] = true;
    out.push(d);
  }
  return out;
}

/**
 * 監視設定を保存する（管理者のみ）。システム全体に効く。
 */
function saveMonitoringSettings(teacher, incoming) {
  if (!isAdminTeacher(teacher)) {
    throw new Error('監視設定を変更できるのは管理者のみです');
  }
  const cur = getMonitoringSettings();
  const src = incoming || {};

  const next = {
    enabled: (src.enabled !== undefined) ? (src.enabled === true) : cur.enabled,
    learning_domains: Array.isArray(src.learning_domains)
      ? sanitizeMonitorDomainList(src.learning_domains)
      : cur.learning_domains,
    blocked_domains: Array.isArray(src.blocked_domains)
      ? sanitizeMonitorDomainList(src.blocked_domains)
      : cur.blocked_domains,
    updated_at: Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss'),
    updated_by: String((teacher && teacher.email) || '')
  };

  PropertiesService.getScriptProperties().setProperty(MONITOR_PROP_KEY, JSON.stringify(next));
  // 一覧の読み取りキャッシュを捨てて、次の取得で新しい設定を反映させる
  if (typeof invalidateDevicesCache === 'function') invalidateDevicesCache();
  return next;
}

/**
 * 監視判定の対象になるURLか（http/https のみ対象）。
 * chrome:// / chrome-extension:// / about: / file: / view-source: / devtools: 等は
 * 学習に関係のないサイト判定の対象外とする（誤検知防止）。
 * スキームが無い「裸のホスト名」（設定画面の手入力など）は http 相当として許可する。
 */
function isWebUrlForMonitoring(rawUrl) {
  const s = String(rawUrl || '').trim().toLowerCase();
  if (!s) return false;
  // スキーム無し（例: youtube.com/watch）は許可
  if (!/^[a-z][a-z0-9+.\-]*:/.test(s)) return true;
  // http / https のみ許可
  return /^https?:/.test(s);
}

/**
 * URL を監視ルールで評価する。
 * 戻り値: { flagged: boolean, reason: string, host: string }
 */
function evaluateUrlForMonitoring(rawUrl, whitelistUrls, blacklistUrls) {
  const settings = getMonitoringSettings();
  if (!settings.enabled) return { flagged: false, reason: '', host: '' };

  // 内部ページ・拡張機能ページ・ローカルファイルは判定対象外。
  // ※ ホスト名ではなく「元のURLのスキーム」で判定する。
  //   chrome://settings/ はホスト名抽出後に 'settings' となり、
  //   ホスト名だけを見る判定では内部ページを確実に弾けないため。
  if (!isWebUrlForMonitoring(rawUrl)) {
    return { flagged: false, reason: '', host: '' };
  }

  const host = normalizeMonitorHost(rawUrl);
  if (!host) return { flagged: false, reason: '', host: '' };

  // 1. 端末の許可URLリスト（先生が明示的に許可したサイト）が最優先
  if (hostMatchesAnyDomain(host, parseUrlList(whitelistUrls))) {
    return { flagged: false, reason: '', host: host };
  }

  // 2. 学習ドメイン辞書
  if (hostMatchesAnyDomain(host, settings.learning_domains)) {
    return { flagged: false, reason: '', host: host };
  }

  // 3. 端末の規制URLリスト（先生が明示的に規制したサイト）
  if (hostMatchesAnyDomain(host, parseUrlList(blacklistUrls))) {
    return { flagged: true, reason: '規制URLリストのサイト（' + host + '）', host: host };
  }

  // 4. 非学習ドメイン辞書（学習に関係のないサイト）
  if (hostMatchesAnyDomain(host, settings.blocked_domains)) {
    return { flagged: true, reason: '学習に関係のないサイト（' + host + '）', host: host };
  }

  // 5. 未知のサイトは注意しない（誤検知を避ける）
  return { flagged: false, reason: '', host: host };
}

/**
 * 監視がOFFのときは、シートに残っている注意フラグを伏せて返す。
 * これにより管理画面の注意マークが即座に消える（データは保持したまま非表示）。
 */
function applyMonitorVisibility(devices) {
  if (!Array.isArray(devices)) return devices;
  let enabled = false;
  try {
    enabled = getMonitoringSettings().enabled === true;
  } catch (e) {
    enabled = false;
  }
  if (enabled) return devices;
  for (let i = 0; i < devices.length; i++) {
    if (devices[i] && typeof devices[i] === 'object') {
      devices[i].monitor_flag = false;
      devices[i].monitor_reason = '';
      devices[i].monitor_url = '';
      devices[i].monitor_at = '';
    }
  }
  return devices;
}


// ==================== ハートビート用 行解決（キャッシュ廃止・毎回シートから引き直す） ====================
// 【v1.6.5 変更点：行番号キャッシュの廃止】
//   以前は児童ごとに「行番号」を CacheService へ最大6時間保持していた（旧 hbGetCachedRow）。
//   しかし書き込み版 dev_v は「教員が管理画面から書き込んだとき」しか進まないため、
//   スプレッドシート上で直接 行の削除・挿入・並べ替え を行うと、版は変わらないまま
//   行番号だけがズレる。実機では 2 行目の児童が 3 行目（空行）に書かれ、
//   A〜D列が空欄のまま K列/L列 だけが更新される事故になった（getLastRow() が 3 に）。
//
//   再発防止のため、行番号は一切キャッシュせず、毎回シートから児童IDで引き直す。
//   ヘッダー位置も同様に毎回読む（列の挿入・削除でも壊れないようにする）。
//   追加コストは 1 リクエストあたり getDataRange 1 回＋ヘッダー1行のみ。
//   行検索は文字列比較の線形走査なので、数百行規模では体感差はない。
//
// 【実測用ログ】
//   HB_DEBUG_LOG を true にすると、経路・探索結果・書き込み先の行番号を
//   実行ログへ出す。原因調査が済んだら false に戻す（既定 false）。
const HB_DEBUG_LOG = true; // ← 実測が終わったら false に戻してください
const HB_LOG_PREFIX = '[HB]';

/** 実測用ログ。HB_DEBUG_LOG=false のときは何もしない（本番の負荷を増やさない）。 */
function hbLog(msg) {
  if (!HB_DEBUG_LOG) return;
  try { Logger.log(HB_LOG_PREFIX + ' ' + msg); } catch (e) {}
}

/**
 * 児童IDから「いま何行目か」を引き直す（キャッシュしない）。
 *
 * 【返り値】
 *   { rowNum, row, total, orphanRowNum }
 *     rowNum      … 見つかった行番号（1-indexed）。見つからなければ -1
 *     row         … その行の値配列（見つかったときのみ）
 *     total       … シートの総行数（ヘッダー含む）
 *     orphanRowNum… 児童IDが空の行のうち最初のもの（過去の行ズレ事故の残骸）。
 *                   新規登録時に再利用して、空行を増やさず掃除するために使う。
 *
 * 【なぜキャッシュしないのか】
 *   行番号は他の行の増減で簡単に変わる。CacheService に保持すると
 *   「シート上で行を消した／挿入した」だけで恒久的にズレたままになる。
 *   数百行の線形走査はミリ秒未満なので、毎回引き直す方が安全で十分に速い。
 */
function hbResolveRowByStudentId(sheet, headerMap, studentId) {
  const idColIdx = headerMap['児童ID'] - 1;
  const data = sheet.getDataRange().getValues();
  const total = data.length;
  if (idColIdx < 0) {
    hbLog('resolve: 児童ID列が見つかりません（ヘッダー異常）');
    return { rowNum: -1, row: null, total: total, orphanRowNum: -1 };
  }

  const wantId = normalizeIdKey(studentId);
  if (!wantId) {
    hbLog('resolve: 児童IDが空のため照合しません');
    return { rowNum: -1, row: null, total: total, orphanRowNum: -1 };
  }

  // 一致行と「児童IDが空の残骸行」を 1 回の走査で確定させる。
  // 途中で return すると、一致行より後ろにある残骸行を見落とすため、
  // 最後まで走査する（data はメモリ上の配列なので追加の API 呼び出しは無い）。
  let orphanRowNum = -1;
  let foundRowNum = -1;
  let foundRow = null;
  let foundRawId = '';
  for (let i = 1; i < total; i++) {
    const rawId = data[i] ? data[i][idColIdx] : '';
    const key = normalizeIdKey(rawId);
    if (!key) {
      if (orphanRowNum < 0) orphanRowNum = i + 1;
      continue;
    }
    if (foundRowNum < 0 && key === wantId) {
      foundRowNum = i + 1;
      foundRow = data[i];
      foundRawId = rawId;
    }
  }

  if (foundRowNum >= 0) {
    hbLog('resolve: 一致 row=' + foundRowNum + ' id=' + String(foundRawId) +
      ' (総行数=' + total + ', 空ID行の先頭=' + orphanRowNum + ')');
    return { rowNum: foundRowNum, row: foundRow, total: total, orphanRowNum: orphanRowNum };
  }

  hbLog('resolve: 不一致 id=' + studentId + ' (総行数=' + total +
    ', 空ID行の先頭=' + orphanRowNum + ')');
  return { rowNum: -1, row: null, total: total, orphanRowNum: orphanRowNum };
}

/**
 * ハートビート応答を1か所で組み立てる（3経路の重複を排除し、項目の欠けを防ぐ）。
 */
function buildHeartbeatResponse(row, headerMap, studentId, kaActive, kaInfo, now) {
  const reqCol = headerMap['画面情報要求日時'];
  const shotCol = headerMap['画面情報更新日時'];
  const monFlagCol = headerMap['要注意'];
  const monReasonCol = headerMap['注意理由'];
  return {
    student_id: studentId,
    school_name: String(row[headerMap['学校名'] - 1] || ''),
    student_name: String(row[headerMap['氏名'] - 1] || ''),
    class_name: String(row[headerMap['クラス'] - 1] || ''),
    screen_lock: parseBoolean(row[headerMap['画面ロック'] - 1]),
    filter_mode: String(row[headerMap['URL規制モード'] - 1] || 'OFF').toUpperCase(),
    whitelist_urls: parseUrlList(row[headerMap['許可URLリスト'] - 1]),
    blacklist_urls: parseUrlList(row[headerMap['規制URLリスト'] - 1]),
    broadcast_url: String(row[headerMap['一斉表示URL'] - 1] || '').trim(),
    broadcast_id: String(row[headerMap['一斉表示実行ID'] - 1] || '').trim(),
    current_url: String(row[headerMap['現在開いているURL'] - 1] || ''),
    screen_request_at: reqCol ? String(row[reqCol - 1] || '').trim() : '',
    screenshot_at: shotCol ? String(row[shotCol - 1] || '').trim() : '',
    monitor_flag: monFlagCol ? parseBoolean(row[monFlagCol - 1]) : false,
    monitor_reason: monReasonCol ? String(row[monReasonCol - 1] || '') : '',
    ka_active: kaActive,
    sync_interval_sec: kaInfo.sync_interval_sec,
    idle_drift_until: kaInfo.idle_drift_until,
    server_time: now
  };
}

/**
 * AI監視（学習に関係のないサイトの検知）。
 * URL が変わったときだけ呼ばれ、4列が連続している場合のみ 1 回の getRange でまとめて書く。
 * 監視が OFF のときは列に一切触らない（履歴を保持したまま、表示側で伏せる）。
 */
function hbApplyMonitor(sheet, rowNum, row, headerMap, currentUrl, now) {
  const monFlagCol = headerMap['要注意'];
  const monReasonCol = headerMap['注意理由'];
  const monUrlCol = headerMap['要注意URL'];
  const monAtCol = headerMap['注意検知日時'];
  const contiguous = monFlagCol && monReasonCol && monUrlCol && monAtCol &&
    monReasonCol === monFlagCol + 1 && monUrlCol === monFlagCol + 2 && monAtCol === monFlagCol + 3;
  if (!contiguous) return;

  let monSettings = null;
  try { monSettings = getMonitoringSettings(); } catch (e) { monSettings = null; }
  if (!monSettings || !monSettings.enabled) return;

  const mon = evaluateUrlForMonitoring(
    currentUrl,
    row[headerMap['許可URLリスト'] - 1],
    row[headerMap['規制URLリスト'] - 1]
  );
  const prevFlag = parseBoolean(row[monFlagCol - 1]);
  if (mon.flagged === prevFlag) return; // 状態が変わったときだけ書く

  sheet.getRange(rowNum, monFlagCol, 1, 4).setValues([[
    mon.flagged,
    mon.flagged ? mon.reason : '',
    mon.flagged ? (mon.host || '') : '',
    mon.flagged ? now : ''
  ]]);
  row[monFlagCol - 1] = mon.flagged;
  row[monReasonCol - 1] = mon.flagged ? mon.reason : '';
  row[monUrlCol - 1] = mon.flagged ? (mon.host || '') : '';
  row[monAtCol - 1] = mon.flagged ? now : '';
}

/**
 * 新規自動登録（児童Googleアカウント対応）。
 * 同一アカウントが複数端末から同時に、または連続してアクセスした場合に
 * 重複行が作成されないよう、書き込みロック内で「再確認 → 登録」を行う。
 */
function hbRegisterDevice(studentId, currentUrl, incomingSchool, kaInfo, kaActive, now) {
  hbLog('register: 開始 id=' + studentId + ' url=' + currentUrl);
  return withWriteLock(function () {
    const sheet = getTargetSheet(CONFIG.DEVICE_SHEET_NAME);
    const headerMap = getHeaderMap(sheet, CONFIG.DEVICE_COLUMNS);
    const data = sheet.getDataRange().getValues();
    const idColIdx = headerMap['児童ID'] - 1;

    // 再確認（同時アクセス対策）。あわせて「児童IDが空の残骸行」も探す。
    // 残骸行＝過去の行ズレ事故で K列/L列 だけが書かれた行。新規行を増やさず再利用する。
    const wantId = normalizeIdKey(studentId);
    let reRow = -1;
    let orphanRowNum = -1;
    for (let i = 1; i < data.length; i++) {
      const key = normalizeIdKey(data[i][idColIdx]);
      if (!key) {
        if (orphanRowNum < 0) orphanRowNum = i + 1;
        continue;
      }
      if (key === wantId) { reRow = i + 1; break; }
    }
    hbLog('register: 再確認 reRow=' + reRow + ' 残骸行=' + orphanRowNum +
      ' 総行数=' + data.length);

    if (reRow !== -1) {
      // 先に登録されていた（同時アクセス）。学校名が未設定なら補完して返す。
      const row = data[reRow - 1];
      const reSchoolCol = headerMap['学校名'];
      if (incomingSchool && reSchoolCol) {
        const reSchool = String(row[reSchoolCol - 1] || '').trim();
        if (!reSchool || reSchool === '未設定') {
          sheet.getRange(reRow, reSchoolCol).setValue(incomingSchool);
          row[reSchoolCol - 1] = incomingSchool;
        }
      }
      hbLog('register: 既に登録済み（同時アクセス）row=' + reRow + ' → 新規行は作らない');
      return buildHeartbeatResponse(row, headerMap, studentId, kaActive, kaInfo, now);
    }

    let initialName = '未登録児童 (' + studentId + ')';
    if (studentId.indexOf('@') !== -1) {
      const userPart = studentId.split('@')[0];
      initialName = userPart + ' (Googleアカウント)';
    }
    let initialClass = '未設定';
    let initialSchool = incomingSchool || '未設定';

    // 子GASの初回登録時: 親の名簿に載っていれば、最初から正しい氏名・クラスで作る。
    // （後から補完するより、A〜D列が空の行を一瞬も作らない方が運用上きれい）
    if (typeof hbChildIdentityLookup === 'function') {
      try {
        const info = hbChildIdentityLookup(studentId);
        if (info && info.found) {
          const n = String(info.student_name || '').trim();
          const c = String(info.class_name || '').trim();
          const s = String(info.school_name || '').trim();
          if (n && n !== '未設定') initialName = n;
          if (c && c !== '未設定') initialClass = c;
          if (s && s !== '未設定') initialSchool = s;
        }
      } catch (e) { /* 名簿照会に失敗しても登録自体は続ける */ }
    }

    const newRow = new Array(CONFIG.DEVICE_COLUMNS.length).fill('');
    newRow[headerMap['児童ID'] - 1] = studentId;
    newRow[headerMap['学校名'] - 1] = initialSchool;
    newRow[headerMap['氏名'] - 1] = initialName;
    newRow[headerMap['クラス'] - 1] = initialClass;
    newRow[headerMap['画面ロック'] - 1] = false;
    newRow[headerMap['URL規制モード'] - 1] = 'OFF';
    newRow[headerMap['許可URLリスト'] - 1] = 'nhk.or.jp, scratch.mit.edu, google.com';
    newRow[headerMap['規制URLリスト'] - 1] = 'youtube.com, twitter.com, tiktok.com, instagram.com';
    newRow[headerMap['現在開いているURL'] - 1] = currentUrl;
    newRow[headerMap['最終同期日時'] - 1] = now;

    // AI監視: 初回登録時点のURLも判定する（監視OFFなら何もしない＝既定は空欄）。
    let newMon = { flagged: false, reason: '', host: '' };
    try {
      newMon = evaluateUrlForMonitoring(
        currentUrl,
        newRow[headerMap['許可URLリスト'] - 1],
        newRow[headerMap['規制URLリスト'] - 1]
      );
    } catch (e) {
      newMon = { flagged: false, reason: '', host: '' };
    }
    if (headerMap['要注意']) newRow[headerMap['要注意'] - 1] = newMon.flagged;
    if (headerMap['注意理由']) newRow[headerMap['注意理由'] - 1] = newMon.flagged ? newMon.reason : '';
    if (headerMap['要注意URL']) newRow[headerMap['要注意URL'] - 1] = newMon.flagged ? (newMon.host || '') : '';
    if (headerMap['注意検知日時']) newRow[headerMap['注意検知日時'] - 1] = newMon.flagged ? now : '';

    // 児童IDが空の残骸行（過去の行ズレ事故の跡）があれば、新規行を増やさずに
    // その行へ全体を書き直して掃除する。getLastRow() が水増しされたままにならない。
    if (orphanRowNum >= 2) {
      hbLog('register: 残骸行を再利用 row=' + orphanRowNum +
        '（新規行は追加しない） id=' + studentId);
      sheet.getRange(orphanRowNum, 1, 1, CONFIG.DEVICE_COLUMNS.length).setValues([newRow]);
      return buildHeartbeatResponse(newRow, headerMap, studentId, kaActive, kaInfo, now);
    }

    const beforeLast = sheet.getLastRow();
    sheet.appendRow(newRow);
    hbLog('register: 新規行を追加 row=' + (beforeLast + 1) + ' id=' + studentId +
      '（追加前の最終行=' + beforeLast + '）');

    return buildHeartbeatResponse(newRow, headerMap, studentId, kaActive, kaInfo, now);
  });
}

function processHeartbeat(studentId, currentUrl, schoolNameRaw) {
  // 端末から届いた学校名（管理ポリシーの school_name）。正式名称に解決できた場合のみ使う。
  const incomingSchool = canonicalizeIncomingSchool(schoolNameRaw);

  // 教員コンソールの稼働有無に応じた児童端末の同期周期を配布する（非稼働=0＝同期しない）。
  const kaInfo = (typeof computeKaInterval === 'function')
    ? computeKaInterval(isTeacherConsoleActive() ? ACTIVE_SYNC_INTERVAL_SEC : 0, new Date().getTime())
    : { ka_active: false, sync_interval_sec: 0, idle_drift_until: 0 };
  const kaActive = kaInfo.ka_active;

  const now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');
  const nowMs = new Date().getTime();

  const t0 = new Date().getTime();

  // ---- 1) 行番号はキャッシュしない。毎回シートから児童IDで引き直す ----
  //   旧実装は hbGetCachedRow が最大6時間「行番号」を保持していた。dev_v は教員の
  //   書き込みでしか進まないため、シート上で行を削除・挿入されると版は変わらないまま
  //   行番号だけがズレ、2行目の児童が3行目の空行に書かれる事故になった。
  //   ヘッダー位置も毎回読む（列の挿入・削除でも壊れない）。
  const sheet = getTargetSheet(CONFIG.DEVICE_SHEET_NAME);
  const headerMap = getHeaderMap(sheet, CONFIG.DEVICE_COLUMNS);
  const resolved = hbResolveRowByStudentId(sheet, headerMap, studentId);

  if (resolved.rowNum < 0) {
    // 未登録 → 新規自動登録へ（重複防止のため書き込みロック内で再確認する）
    hbLog('heartbeat: 未登録のため新規登録へ id=' + studentId);
    return hbRegisterDevice(studentId, currentUrl, incomingSchool, kaInfo, kaActive, now);
  }

  const row = resolved.row;
  const rowNum = resolved.rowNum;
  hbLog('heartbeat: id=' + studentId + ' -> row=' + rowNum +
    ' (総行数=' + resolved.total + ')');

  // ---- 2.5) 子GAS: 氏名・学校名・クラスが未取得なら親の名簿で補完する ----
  // 空キー既定のフォールバックで子へ直行した端末は、子に名簿が無いため
  // クラス='未設定' のままになる。放置すると assigned_gas_url が永久に返らない。
  if (typeof hbApplyChildIdentity === 'function') {
    try {
      if (hbApplyChildIdentity(sheet, rowNum, row, headerMap, studentId)) {
        hbLog('heartbeat: 子GASの名簿補完を反映 row=' + rowNum);
      }
    } catch (e) { /* 補完失敗でも通常のハートビートは続ける */ }
  }

  // ---- 3) 書き込みが必要かの判定（従来と同じ基準） ----
  const urlCol = headerMap['現在開いているURL'];
  const syncCol = headerMap['最終同期日時'];
  const schoolCol = headerMap['学校名'];

  const urlChanged = !!urlCol && String(row[urlCol - 1] || '') !== String(currentUrl || '');
  const syncDue = !!syncCol && shouldWriteSyncTime(studentId, nowMs);

  let schoolFill = false;
  if (incomingSchool && schoolCol) {
    const cur = String(row[schoolCol - 1] || '').trim();
    if (!cur || cur === '未設定') schoolFill = true;
  }

  if (!urlChanged && !syncDue && !schoolFill) {
    // 何も書かない → シートへは書かない（読み取りのみで応答）
    hbLog('heartbeat: 書き込み不要 row=' + rowNum +
      ' elapsed=' + (new Date().getTime() - t0) + 'ms');
    return buildHeartbeatResponse(row, headerMap, studentId, kaActive, kaInfo, now);
  }

  // ここから先は書き込みが必要（sheet は手順1で開済み）

  // 学校名の補完（未設定の行だけ。教員が設定済みの値は上書きしない）
  if (schoolFill) {
    sheet.getRange(rowNum, schoolCol).setValue(incomingSchool);
    row[schoolCol - 1] = incomingSchool;
  }

  if (urlChanged && syncDue && urlCol && syncCol && syncCol === urlCol + 1) {
    // 隣接2列ならまとめて1回で書く（GAS/シートの往復を削減）
    hbLog('heartbeat: 2列まとめ書き row=' + rowNum + ' cols=' + urlCol + '..' + syncCol +
      ' url=' + currentUrl + ' sync=' + now);
    sheet.getRange(rowNum, urlCol, 1, 2).setValues([[currentUrl, now]]);
    row[urlCol - 1] = currentUrl;
    row[syncCol - 1] = now;
  } else {
    // 片方だけのときは、その列だけを書く（触っていない値の書式を変えない）
    if (urlChanged) {
      hbLog('heartbeat: K列書き row=' + rowNum + ' col=' + urlCol + ' url=' + currentUrl);
      sheet.getRange(rowNum, urlCol).setValue(currentUrl);
      row[urlCol - 1] = currentUrl;
    }
    if (syncDue) {
      hbLog('heartbeat: L列書き row=' + rowNum + ' col=' + syncCol + ' sync=' + now);
      sheet.getRange(rowNum, syncCol).setValue(now);
      row[syncCol - 1] = now;
    }
  }

  // ---- AI監視（URLが変わったときだけ判定。毎回の同期で辞書照合しない＝GASを軽く保つ） ----
  if (urlChanged) hbApplyMonitor(sheet, rowNum, row, headerMap, currentUrl, now);

  hbLog('heartbeat: 書き込み完了 row=' + rowNum + ' urlChanged=' + urlChanged +
    ' syncDue=' + syncDue + ' schoolFill=' + schoolFill +
    ' elapsed=' + (new Date().getTime() - t0) + 'ms');

  return buildHeartbeatResponse(row, headerMap, studentId, kaActive, kaInfo, now);
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
    // AI監視の列（既存シートでも ensureDeviceHeaders により末尾へ自動追加される）
    const monFlagIdx = headerMap['要注意'];
    const monReasonIdx = headerMap['注意理由'];
    const monUrlIdx = headerMap['要注意URL'];
    const monAtIdx = headerMap['注意検知日時'];

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
      screenshot_at: shotColIdx ? String(row[shotColIdx - 1] || '').trim() : '',
      monitor_flag: monFlagIdx ? parseBoolean(row[monFlagIdx - 1]) : false,
      monitor_reason: monReasonIdx ? String(row[monReasonIdx - 1] || '') : '',
      monitor_url: monUrlIdx ? String(row[monUrlIdx - 1] || '') : '',
      monitor_at: monAtIdx ? String(row[monAtIdx - 1] || '') : ''
    });
  }

  // 読み取りキャッシュへ保存（5秒）。書き込み時は invalidateDevicesCache() で無効化する。
  // ※ 監視設定の変更時にも invalidateDevicesCache() を呼ぶため、OFFにした直後に
  //    注意マークが残ることはない。
  if (devCache && devCacheKey) {
    try { devCache.put(devCacheKey, JSON.stringify(results), 5); } catch (e) {}
  }

  // 監視がOFFのときは注意フラグを伏せて返す（シートのデータは保持したまま非表示）。
  return applyMonitorVisibility(results);
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

// ==================== 子GAS分散（SHARD_MODE / ハブ＆スポーク） ====================
// 役割分担:
//   親（ハブ）  … 教員コンソール。全校・全クラスの端末一覧を集約し、操作の「正」を持つ。
//   子（スポーク）… 1クラス分のハートビートだけを受ける。ポリシーは親から受け取る。
//
// 端末の流れ:
//   ① 端末 → 親（初回）: 児童ID と クラス から子GAS URL を解決し assigned_gas_url を返す
//   ② 端末 → 子（以降）: 以後は子GASへ直接ハートビートする（1.5秒周期を維持）
//   ③ 教員操作 → 親: 親のシートを更新し、該当する子へ shard_apply で伝達
//
// 認証:
//   親⇔子の通信は教員トークンではなく「共有シークレット（SHARD_SECRET）」で認証する。
//   シークレット未設定の子は shard_apply を一切受け付けない（安全側）。

const SHARD_MAP_PROP = 'SHARD_MAP_V1';       // { "5年1組": "https://…/exec" }
const SHARD_DEFAULT_PROP = 'SHARD_DEFAULT_URL'; // クラス不明時の既定の子GAS
const SHARD_SECRET_PROP = 'SHARD_SECRET';    // 親⇔子の共有シークレット
// 子GASが「親の名簿に問い合わせる先」＝親GASのデプロイURL（子にだけ設定する）
const SHARD_PARENT_PROP = 'SHARD_PARENT_URL';
const SHARD_LOOKUP_CACHE_PREFIX = 'shlk_';   // 名簿照会のキャッシュ
const SHARD_CFG_CACHE = 'shard_cfg3';        // 設定のキャッシュキー（5分）

// ==================== 設定値の動的解決（スクリプトプロパティ優先） ====================
//
// 【設計】
//   コード内の CONFIG は「既定値」であり、実運用の値はスクリプトプロパティに置く。
//   読み取り順は スクリプトプロパティ → CONFIG の順（プロパティ優先）。
//   プロパティが未設定・空・型変換不能な場合は、警告を出したうえで CONFIG に戻す。
//   これにより「クラス追加・子GAS追加のたびにコードを書き換えて再デプロイする」
//   必要がなくなる（プロパティを変えるだけでよい）。
//
// 【性能】
//   isShardParent() はハートビートのホットパスから呼ばれる。毎回 PropertiesService を
//   読むと 3〜5ms の応答が崩れるため、真偽値は CacheService に 60 秒キャッシュする
//   （管理画面で保存したときは invalidateShardConfig() が即時破棄する）。

const PROP_SHARD_MODE = 'SHARD_MODE';
const PROP_SHARD_CHILD_MODE = 'SHARD_CHILD_MODE';
const PROP_SPREADSHEET_ID = 'SPREADSHEET_ID';
const SHARD_MODE_CACHE = 'shard_mode1';   // 真偽値キャッシュ（60秒）
const SHARD_SSID_CACHE = 'shard_ssid1';   // スプレッドシートIDキャッシュ（300秒）

/** 設定の警告を実行ログへ出す（Logger が無い環境でも落ちない）。 */
function cfgWarn(msg) {
  try { Logger.log('[CONFIG] ' + msg); } catch (e) { /* ログ不可は無視 */ }
}

/** プロパティの生値を返す。未設定は null（空文字と区別する）。 */
function propRaw(name) {
  try {
    const v = PropertiesService.getScriptProperties().getProperty(name);
    if (v === null || v === undefined) return null;
    return String(v);
  } catch (e) {
    return null;
  }
}

/** プロパティを真偽値として読む。不正値・空は fallback へ戻す。 */
function propBool(name, fallback) {
  const fb = !!fallback;
  const raw = propRaw(name);
  if (raw === null) return fb;
  const s = raw.trim().toLowerCase();
  if (!s) {
    cfgWarn(name + ' が空です。CONFIG の既定値（' + fb + '）を使用します。');
    return fb;
  }
  if (s === 'true' || s === '1' || s === 'yes' || s === 'on') return true;
  if (s === 'false' || s === '0' || s === 'no' || s === 'off') return false;
  cfgWarn(name + ' の値「' + raw + '」は真偽値として解釈できません。CONFIG の既定値（' + fb + '）を使用します。');
  return fb;
}

/** プロパティを文字列として読む。空は fallback へ戻す。 */
function propStr(name, fallback) {
  const fb = String(fallback === undefined || fallback === null ? '' : fallback);
  const raw = propRaw(name);
  if (raw === null) return fb;
  const s = raw.trim();
  if (!s) {
    if (fb) cfgWarn(name + ' が空です。CONFIG の既定値を使用します。');
    return fb;
  }
  return s;
}

/** SHARD_MODE / SHARD_CHILD_MODE をプロパティ優先で解決する（60秒キャッシュ）。 */
function shardModeFlags() {
  try {
    const c = CacheService.getScriptCache();
    const hit = c.get(SHARD_MODE_CACHE);
    if (hit) {
      const o = JSON.parse(hit);
      if (o && typeof o === 'object' && typeof o.parent === 'boolean' && typeof o.child === 'boolean') return o;
    }
  } catch (e) { /* キャッシュ不可時は都度評価 */ }

  const flags = {
    parent: propBool(PROP_SHARD_MODE, !!(CONFIG && CONFIG.SHARD_MODE === true)),
    child: propBool(PROP_SHARD_CHILD_MODE, !!(CONFIG && CONFIG.SHARD_CHILD_MODE === true))
  };
  try { CacheService.getScriptCache().put(SHARD_MODE_CACHE, JSON.stringify(flags), 60); } catch (e) {}
  return flags;
}

/**
 * 書き込み先スプレッドシートIDを解決する（プロパティ優先）。
 * 親は親シート、子は子シートを指す。プロパティを変えるだけで切り替えられる。
 */
function getSpreadsheetId() {
  const fallback = String((CONFIG && CONFIG.SPREADSHEET_ID) || '').trim();
  try {
    const c = CacheService.getScriptCache();
    const hit = c.get(SHARD_SSID_CACHE);
    if (hit) return hit;
  } catch (e) { /* 無視 */ }

  const id = propStr(PROP_SPREADSHEET_ID, fallback);
  if (!id) {
    cfgWarn('SPREADSHEET_ID を解決できませんでした（プロパティも CONFIG も空）。');
  }
  try { CacheService.getScriptCache().put(SHARD_SSID_CACHE, id, 300); } catch (e) {}
  return id;
}

/**
 * トークン署名鍵。SPREADSHEET_ID に依存させず、共有シークレットを最優先する。
 *   SHARD_SECRET（プロパティ）→ CONFIG.SHARD_SECRET → SHARD_SECRET 自動生成 → SPREADSHEET_ID
 * これにより子が自分のシートIDへ切り替えても、教員ログイン／トークン検証は壊れない。
 */
function getTokenSecret() {
  const fromProp = propStr(SHARD_SECRET_PROP, '');
  if (fromProp) return fromProp;
  const fromCfg = String((CONFIG && CONFIG.SHARD_SECRET) || '').trim();
  if (fromCfg) return fromCfg;
  const generated = getOrCreateShardSecret();
  if (generated) return generated;
  return getSpreadsheetId();
}

/** どの設定がプロパティで上書きされているかを返す（管理画面・診断用）。 */
function shardConfigSources() {
  const out = {};
  out.SHARD_MODE = (propRaw(PROP_SHARD_MODE) === null) ? 'CONFIG' : 'PROPERTY';
  out.SHARD_CHILD_MODE = (propRaw(PROP_SHARD_CHILD_MODE) === null) ? 'CONFIG' : 'PROPERTY';
  const ss = propRaw(PROP_SPREADSHEET_ID);
  out.SPREADSHEET_ID = (ss === null || !String(ss).trim()) ? 'CONFIG' : 'PROPERTY';
  const mp = propRaw(SHARD_MAP_PROP);
  out.SHARD_MAP_V1 = (mp === null || !String(mp).trim()) ? 'CONFIG' : 'PROPERTY';
  out.SHARD_DEFAULT_URL = (propRaw(SHARD_DEFAULT_PROP) === null) ? 'CONFIG' : 'PROPERTY';
  const sk = propRaw(SHARD_SECRET_PROP);
  out.SHARD_SECRET = (sk === null || !String(sk).trim()) ? 'CONFIG' : 'PROPERTY';
  return out;
}

/**
 * 同じ警告を300秒に1回だけ出す（ハートビート毎のログ氾濫を防ぐ）。
 * キャッシュが使えない環境では都度出力する（取りこぼしより冗長を選ぶ）。
 */
function shardWarnOnce(key, msg) {
  try {
    const c = CacheService.getScriptCache();
    const k = 'sw_' + shardHash(key);
    if (c.get(k)) return;
    c.put(k, '1', 300);
  } catch (e) { /* キャッシュ不可時は都度出力 */ }
  try { Logger.log('[SHARD] ' + msg); } catch (e) {}
}

// ==================== 児童IDの照合と名簿検索（表記ゆれ対策） ====================
//
// 児童IDは端末（Googleアカウントのメール）とシート（手入力・CSV取込）で
// 表記が揺れる。大文字小文字・全角半角・前後/途中の空白を吸収して比較する。
// 例: 「 1607002@City-Mimasaka.ED.jp 」と「１６０７００２＠city-mimasaka.ed.jp」は同一。

function normalizeIdKey(value) {
  let s = String(value === null || value === undefined ? '' : value);
  s = s.trim();
  if (!s) return '';
  // 全角英数字 → 半角
  s = s.replace(/[Ａ-Ｚａ-ｚ０-９]/g, function (c) {
    return String.fromCharCode(c.charCodeAt(0) - 0xFEE0);
  });
  // 全角記号 → 半角（メールアドレスで使われ得るもの）
  s = s.replace(/＠/g, '@').replace(/．/g, '.').replace(/＿/g, '_').replace(/[－ー]/g, '-');
  // 空白（全角含む）は除去する
  s = s.replace(/[\s\u3000]+/g, '');
  return s.toLowerCase();
}

/**
 * 児童IDから端末一覧の行を探す（親・子のどちらでも使える）。
 * 見つかれば { row_number, student_id, school_name, student_name, class_name } を返す。
 *
 * 列位置は getHeaderMap で動的に解決する（列順が変わっても壊れない）。
 * 返す値はシートの表示どおり（整形前）とし、比較だけを正規化して行う。
 */
function findStudentById(studentId) {
  const want = normalizeIdKey(studentId);
  if (!want) return null;

  let sheet = null;
  try { sheet = getTargetSheet(CONFIG.DEVICE_SHEET_NAME); } catch (e) { return null; }
  if (!sheet) return null;

  let headerMap = null;
  try { headerMap = getHeaderMap(sheet, CONFIG.DEVICE_COLUMNS); } catch (e) { return null; }
  const idCol = headerMap && headerMap['児童ID'];
  if (!idCol) return null;

  let data = null;
  try { data = sheet.getDataRange().getValues(); } catch (e) { return null; }
  if (!data || !data.length) return null;

  const cell = function (row, colName) {
    const c = headerMap[colName];
    if (!c) return '';
    return String(row[c - 1] === null || row[c - 1] === undefined ? '' : row[c - 1]).trim();
  };

  for (let i = 1; i < data.length; i++) {
    if (normalizeIdKey(data[i][idCol - 1]) !== want) continue;
    return {
      row_number: i + 1,
      student_id: cell(data[i], '児童ID'),
      school_name: cell(data[i], '学校名'),
      student_name: cell(data[i], '氏名'),
      class_name: cell(data[i], 'クラス')
    };
  }
  return null;
}

/**
 * 親GAS側: 子GASからの名簿照会に答える。
 * 氏名・学校名・クラスに加え、その場で割り当て先（assigned_gas_url）も解決して返す。
 * これにより子は「クラスが分からない端末」を正しい子GASへ送り直せる。
 */
function shardLookupStudent(studentId) {
  const sid = String(studentId || '').trim();
  if (!sid) return { success: true, found: false, student_id: '' };
  const hit = findStudentById(sid);
  if (!hit) {
    return { success: true, found: false, student_id: sid };
  }
  const route = resolveShardForHeartbeat(hit.student_id, hit.class_name);
  const out = {
    success: true, found: true,
    student_id: hit.student_id,
    student_name: hit.student_name,
    school_name: hit.school_name,
    class_name: hit.class_name
  };
  const keys = Object.keys(route || {});
  for (let i = 0; i < keys.length; i++) out[keys[i]] = route[keys[i]];
  return out;
}

/** 子GASが問い合わせる親GASのURL（子にだけ設定する）。 */
function readShardParentUrl() {
  try {
    return String(PropertiesService.getScriptProperties().getProperty(SHARD_PARENT_PROP) || '').trim();
  } catch (e) {
    return '';
  }
}

/**
 * 子GAS側: 親へ名簿を問い合わせる（10分キャッシュ・失敗は1分キャッシュ）。
 * 親URLが未設定、または通信できない場合は null を返す（呼び出し側は従来動作を続ける）。
 */
function shardLookupFromParent(studentId) {
  const sid = String(studentId || '').trim();
  if (!sid) return null;
  const parent = readShardParentUrl();
  if (!parent) return null;

  const key = SHARD_LOOKUP_CACHE_PREFIX + shardHash(normalizeIdKey(sid) + '|' + parent);
  try {
    const c = CacheService.getScriptCache();
    const cached = c.get(key);
    if (cached) {
      const o = JSON.parse(cached);
      return (o && o.found) ? o : null;
    }
  } catch (e) { /* キャッシュ不可時は通信へ */ }

  let result = null;
  try {
    if (typeof UrlFetchApp === 'undefined') return null;
    const body = JSON.stringify({
      action: 'shard_lookup',
      shard_secret: getOrCreateShardSecret(),
      student_id: sid
    });
    const res = UrlFetchApp.fetch(parent, {
      method: 'post',
      contentType: 'application/json',
      payload: body,
      muteHttpExceptions: true
    });
    const code = res.getResponseCode();
    if (code >= 200 && code < 300) {
      const j = JSON.parse(res.getContentText());
      if (j && j.found) result = j;
    }
  } catch (e) {
    result = null;
  }

  try {
    const c = CacheService.getScriptCache();
    // 見つかった場合は長め（10分）、見つからない場合は短め（1分）に保持する
    c.put(key, JSON.stringify(result || { found: false }), result ? 600 : 60);
  } catch (e) {}

  return result;
}

/** 子モードのときだけ親へ問い合わせる薄いラッパ（他テスト環境でも安全に null）。 */
function hbChildIdentityLookup(studentId) {
  try {
    if (typeof isShardChild !== 'function' || !isShardChild()) return null;
    if (typeof shardLookupFromParent !== 'function') return null;
    return shardLookupFromParent(studentId);
  } catch (e) {
    return null;
  }
}

/**
 * 子GAS側: 子シートの「氏名・学校名・クラス」が未取得なら、親の名簿で補完する。
 * 補完した場合は row 配列を書き換え、シートにも書く（A〜D列が空のまま残らない）。
 * 戻り値: 補完したら true。
 */
function hbApplyChildIdentity(sheet, rowNum, row, headerMap, studentId) {
  try {
    if (!headerMap || !row || !(rowNum >= 2)) return false;
    const clsCol = headerMap['クラス'];
    if (!clsCol) return false;

    const curClass = String(row[clsCol - 1] === undefined ? '' : row[clsCol - 1]).trim();
    const classMissing = (!curClass || curClass === '未設定');

    const nameCol = headerMap['氏名'];
    const curName = nameCol ? String(row[nameCol - 1] === undefined ? '' : row[nameCol - 1]).trim() : '';
    const nameMissing = !curName || /^未登録児童/.test(curName) || /\(Googleアカウント\)/.test(curName);

    const schoolCol = headerMap['学校名'];
    const curSchool = schoolCol ? String(row[schoolCol - 1] === undefined ? '' : row[schoolCol - 1]).trim() : '';
    const schoolMissing = !curSchool || curSchool === '未設定';

    if (!classMissing && !nameMissing && !schoolMissing) return false;

    const info = hbChildIdentityLookup(studentId);
    if (!info || !info.found) return false;

    const patch = {};
    const newClass = String(info.class_name || '').trim();
    if (classMissing && newClass && newClass !== '未設定') patch[clsCol] = newClass;
    if (nameCol && nameMissing) {
      const newName = String(info.student_name || '').trim();
      if (newName && newName !== '未設定') patch[nameCol] = newName;
    }
    if (schoolCol && schoolMissing) {
      const newSchool = String(info.school_name || '').trim();
      if (newSchool && newSchool !== '未設定') patch[schoolCol] = newSchool;
    }
    const cols = Object.keys(patch);
    if (!cols.length) return false;

    let target = sheet;
    if (!target) target = getTargetSheet(CONFIG.DEVICE_SHEET_NAME);
    if (!target) return false;

    for (let i = 0; i < cols.length; i++) {
      const c = Number(cols[i]);
      const v = patch[cols[i]];
      target.getRange(rowNum, c).setValue(v);
      row[c - 1] = v;
    }
    return true;
  } catch (e) {
    return false;
  }
}

function isShardParent() {
  try { return shardModeFlags().parent === true; } catch (e) { return false; }
}

function isShardChild() {
  try { return shardModeFlags().child === true; } catch (e) { return false; }
}

/**
 * クラス名を比較用の正規化キーへ寄せる。
 *   「5年1組」「５年１組」「5-1」「5/1」「5組」→「5-1」
 *   学年の数字と組の数字を「学年-組」に統一する（全角数字も吸収）。
 */
function normalizeShardClass(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  // 全角数字・全角英字を半角へ
  s = s.replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); });
  s = s.replace(/[Ａ-Ｚａ-ｚ]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); });
  // 空白（全角含む）を除去
  s = s.replace(/[\s\u3000]+/g, '');
  if (!s || s === '未設定') return '';
  // 「5年1組」「5-1」「5/1」「5年1組」など
  let m = s.match(/^(\d{1,2})\s*[年\-ー/／]\s*(\d{1,2})/);
  if (m) return Number(m[1]) + '-' + Number(m[2]);
  // 「5組」だけ → 5-1 とみなす
  m = s.match(/^(\d{1,2})組?$/);
  if (m) return Number(m[1]) + '-1';
  return s;
}

/**
 * マッピング（{ クラス名: 子GASのURL }）を読む。プロパティ優先・CONFIG フォールバック。
 *
 * プロパティの JSON が壊れていても親の実行は止めない。
 *   ・パース失敗／配列／非オブジェクト → 警告を出して CONFIG.SHARD_MAP を使う
 *   ・空キー ""（または正規化して空になるキー）は「既定のルーティング先」として残す
 */
function readShardMapRaw() {
  const cfgFallback = (CONFIG && CONFIG.SHARD_MAP && typeof CONFIG.SHARD_MAP === 'object' && !Array.isArray(CONFIG.SHARD_MAP))
    ? CONFIG.SHARD_MAP : {};
  const copyFallback = function () {
    const out = {};
    const ks = Object.keys(cfgFallback);
    for (let i = 0; i < ks.length; i++) out[ks[i]] = cfgFallback[ks[i]];
    return out;
  };

  let raw = null;
  try {
    raw = PropertiesService.getScriptProperties().getProperty(SHARD_MAP_PROP);
  } catch (e) {
    cfgWarn('SHARD_MAP_V1 を読み取れませんでした（' + String((e && e.message) || e) + '）。CONFIG の既定マップを使用します。');
    return copyFallback();
  }
  if (raw === null || raw === undefined || String(raw).trim() === '') {
    return copyFallback();
  }

  let o = null;
  try {
    o = JSON.parse(String(raw));
  } catch (e) {
    cfgWarn('SHARD_MAP_V1 の JSON パースに失敗しました（' + String((e && e.message) || e) + '）。CONFIG の既定マップを使用します。');
    return copyFallback();
  }
  if (!o || typeof o !== 'object' || Array.isArray(o)) {
    cfgWarn('SHARD_MAP_V1 がオブジェクトではありません。CONFIG の既定マップを使用します。');
    return copyFallback();
  }
  return o;
}

function readShardDefaultUrl() {
  const fallback = String((CONFIG && CONFIG.SHARD_DEFAULT_URL) || '').trim();
  try {
    const raw = PropertiesService.getScriptProperties().getProperty(SHARD_DEFAULT_PROP);
    if (raw === null || raw === undefined) return fallback;
    const s = String(raw).trim();
    return s || fallback;
  } catch (e) {
    return fallback;
  }
}

/**
 * 空キー（"" / 空白のみ / 「未設定」など正規化して空になるキー）で指定された
 * 既定のルーティング先を返す。無ければ ''。
 * SHARD_MAP_V1 の {"": "https://…/exec"} を「フォールバック指定」として扱う。
 */
function shardMapDefaultFromEmptyKey(map) {
  const src = (map && typeof map === 'object') ? map : {};
  const keys = Object.keys(src);
  for (let i = 0; i < keys.length; i++) {
    if (normalizeShardClass(keys[i]) !== '') continue;
    const v = String(src[keys[i]] || '').trim();
    if (v && /^https?:\/\//i.test(v)) return v;
    if (v) {
      shardWarnOnce('emptydflt-bad:' + i, 'SHARD_MAP_V1 の空キー既定URLが http(s):// で始まりません（' + v + '）。無視します。');
    }
  }
  return '';
}

/** 親⇔子の共有シークレット。未生成なら生成して保存する（親のみ）。 */
function getOrCreateShardSecret() {
  try {
    const props = PropertiesService.getScriptProperties();
    let s = String(props.getProperty(SHARD_SECRET_PROP) || '').trim();
    if (!s) {
      s = 'sk_' + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
      props.setProperty(SHARD_SECRET_PROP, s);
    }
    return s;
  } catch (e) {
    return '';
  }
}

/**
 * 【初期設定用】親GASの共有シークレットを生成して実行ログに出す。
 * エディタ上部の関数選択から実行する（手順書 §4-1）。
 * 生成は冪等。既に値があればそれを返す（変更しない）。
 */
function generateShardSecretForSetup() {
  const s = getOrCreateShardSecret();
  if (!s) {
    Logger.log('SHARD_SECRET の生成に失敗しました。スクリプトプロパティへの書き込み権限を確認してください。');
    return '';
  }
  Logger.log('SHARD_SECRET = ' + s);
  Logger.log('この値を全子GASのスクリプトプロパティ SHARD_SECRET に同じ内容で設定してください。');
  return s;
}

/**
 * 【初期設定用】共有シークレットを再発行する（漏洩時のみ）。
 * 実行後は全子GASに新しい値を設定し直すこと（手順書 §4-3）。
 */
function rotateShardSecretForSetup() {
  try {
    PropertiesService.getScriptProperties().deleteProperty(SHARD_SECRET_PROP);
  } catch (e) {
    Logger.log('既存 SHARD_SECRET の削除に失敗しました: ' + e);
  }
  const s = getOrCreateShardSecret();
  invalidateShardConfig();
  if (!s) {
    Logger.log('SHARD_SECRET の再発行に失敗しました。');
    return '';
  }
  Logger.log('新しい SHARD_SECRET = ' + s);
  Logger.log('全子GASのスクリプトプロパティ SHARD_SECRET をこの値に更新してください。');
  return s;
}

/** 受け取ったシークレットが正しいか。未設定なら常に false（安全側）。 */
function shardSecretMatches(given) {
  let expect = '';
  try {
    expect = String(PropertiesService.getScriptProperties().getProperty(SHARD_SECRET_PROP) || '').trim();
  } catch (e) {
    return false;
  }
  if (!expect) return false;
  const g = String(given || '').trim();
  if (!g) return false;
  // 長さが違えば早期に false（比較は全文字走査）
  if (g.length !== expect.length) return false;
  let diff = 0;
  for (let i = 0; i < g.length; i++) diff |= (g.charCodeAt(i) ^ expect.charCodeAt(i));
  return diff === 0;
}

/**
 * 分散設定（マップ・既定URL・シークレット）をキャッシュ経由で取得する。
 * ハートビート毎の PropertiesService 読み取りを避ける（SHARD_MODE 有効時のみ使われる）。
 */
function shardConfigCached() {
  try {
    const cache = CacheService.getScriptCache();
    const hit = cache.get(SHARD_CFG_CACHE);
    if (hit) {
      const o = JSON.parse(hit);
      if (o && typeof o === 'object') return o;
    }
  } catch (e) { /* キャッシュ不可時は下へ */ }

  const cfg = { map: readShardMapRaw(), def: readShardDefaultUrl(), sec: getOrCreateShardSecret() };
  try {
    CacheService.getScriptCache().put(SHARD_CFG_CACHE, JSON.stringify(cfg), 300);
  } catch (e) {}
  return cfg;
}

function invalidateShardConfig() {
  try {
    const c = CacheService.getScriptCache();
    c.remove(SHARD_CFG_CACHE);
    // プロパティを変えた直後に反映されるよう、動的解決のキャッシュも破棄する
    c.remove(SHARD_MODE_CACHE);
    c.remove(SHARD_SSID_CACHE);
  } catch (e) {}
}

/** { 生のクラス名: URL } → { 正規化キー: URL } の索引を作る。 */
function shardMapIndexFromMap(map) {
  const idx = {};
  const src = (map && typeof map === 'object') ? map : {};
  const keys = Object.keys(src);
  for (let i = 0; i < keys.length; i++) {
    const rawKey = String(keys[i]);
    const v = String(src[keys[i]] || '').trim();

    // 値が無い項目は索引に入れない（設定ミスで端末がどこにも繋がらないのを防ぐ）
    if (!v) {
      shardWarnOnce('map-noval:' + rawKey, 'SHARD_MAP_V1 の「' + rawKey + '」に URL がありません。この項目は無視します。');
      continue;
    }
    // URL として不正な値は捨てる（誤ったURLへ端末を飛ばさない）
    if (!/^https?:\/\//i.test(v)) {
      shardWarnOnce('map-badurl:' + rawKey, 'SHARD_MAP_V1 の「' + rawKey + '」の URL が http(s):// で始まりません（' + v + '）。この項目は無視します。');
      continue;
    }

    const k = normalizeShardClass(rawKey);
    if (!k) continue; // 空キーは既定URLとして shardMapDefaultFromEmptyKey が扱う

    if (idx[k] && idx[k] !== v) {
      shardWarnOnce('map-dup:' + k, 'SHARD_MAP_V1 でクラス「' + k + '」が重複しています。先に見つかった URL を使用します。');
      continue;
    }
    idx[k] = v;
  }
  return idx;
}

/**
 * 端末に返す割り当て先を解決する（親のみ）。
 * 親でない／子GASが未設定なら {} を返す＝応答に何も足さない（従来動作と同一）。
 */
function resolveShardForHeartbeat(studentId, classHint) {
  if (!isShardParent()) return {};
  try {
    const cfg = shardConfigCached();
    const idx = shardMapIndexFromMap(cfg.map);
    const key = normalizeShardClass(classHint);

    // ① クラスが一致 → そのクラスの子GAS
    if (key && idx[key]) {
      return { assigned_gas_url: idx[key], assigned_class: key, shard_mode: true };
    }

    // ② クラスが未取得・不一致 → SHARD_MAP_V1 の空キー（既定）→ SHARD_DEFAULT_URL の順
    const emptyDefault = shardMapDefaultFromEmptyKey(cfg.map);
    if (emptyDefault) {
      shardWarnOnce('route-empty:' + String(classHint || '(none)'),
        'クラス「' + String(classHint || '(未取得)') + '」はマップに無いため、SHARD_MAP_V1 の空キー既定URLへ割り当てました。');
      return { assigned_gas_url: emptyDefault, assigned_class: '', shard_mode: true };
    }
    const def = String(cfg.def || '').trim();
    if (def) {
      shardWarnOnce('route-def:' + String(classHint || '(none)'),
        'クラス「' + String(classHint || '(未取得)') + '」はマップに無いため、SHARD_DEFAULT_URL へ割り当てました。');
      return { assigned_gas_url: def, assigned_class: '', shard_mode: true };
    }

    // ③ どこにも繋げない → 親のまま動かす（端末を止めない）。原因究明用に警告を残す。
    shardWarnOnce('route-none:' + String(classHint || '(none)'),
      'クラス「' + String(classHint || '(未取得)') + '」に一致する子GASがありません。端末は親に接続したままです。'
      + ' SHARD_MAP_V1 のキー（例: "5年1組"）と端末側のクラス名を確認してください。');
  } catch (e) {
    // 解決に失敗しても端末の通信は止めない（親に繋がったまま＝従来動作）
    cfgWarn('resolveShardForHeartbeat で例外: ' + String((e && e.message) || e));
  }
  return {};
}

/**
 * 子GAS側: 親から受け取ったポリシーを自分のシートへ適用する。
 * ポリシーの「正」は親にあるため、子は受け取った内容をそのまま反映するだけ。
 */
/**
 * 子GAS側: 親から指示された児童の行が無ければ作る。
 *
 * 子のシートには「その子へハートビートした端末」しか行が無い。
 * bulkUpdateScreenLock 等は対象行が無いと無言で何もしないため、
 * 指示より先に行を用意しておかないと一括操作が永久に効かなくなる。
 *
 * classMap（{ 児童ID: クラス名 }）は親が付ける。子の行が最初から
 * 正しいクラスを持つようにして、子のシートが「未設定」で埋まるのを防ぐ。
 */
function shardEnsureDeviceRows(idList, classMap) {
  if (!Array.isArray(idList) || !idList.length) return 0;
  return withWriteLock(function () {
    const sheet = getTargetSheet(CONFIG.DEVICE_SHEET_NAME);
    const headerMap = getHeaderMap(sheet, CONFIG.DEVICE_COLUMNS);
    const data = sheet.getDataRange().getValues();
    const idCol = headerMap['児童ID'] - 1;

    const existing = {};
    for (let i = 1; i < data.length; i++) {
      const id = String(data[i][idCol] || '').trim();
      if (id) existing[id] = true;
    }

    let created = 0;
    for (let k = 0; k < idList.length; k++) {
      const id = String(idList[k] || '').trim();
      if (!id || existing[id]) continue;
      const newRow = new Array(CONFIG.DEVICE_COLUMNS.length).fill('');
      newRow[headerMap['児童ID'] - 1] = id;
      newRow[headerMap['学校名'] - 1] = '未設定';
      newRow[headerMap['氏名'] - 1] = '未登録児童 (' + id + ')';
      newRow[headerMap['クラス'] - 1] = String((classMap && classMap[id]) || '未設定');
      newRow[headerMap['画面ロック'] - 1] = false;
      newRow[headerMap['URL規制モード'] - 1] = 'OFF';
      sheet.appendRow(newRow);
      existing[id] = true;
      created++;
    }
    return created;
  });
}

function shardApplyFromParent(payload) {
  if (!isShardChild() && !isShardParent()) {
    // 役割未設定のスクリプトが外部から操作されないようにする
    return { success: false, error: '子GASとして構成されていません' };
  }
  if (!shardSecretMatches(payload && payload.shard_secret)) {
    return { success: false, error: 'unauthorized（共有シークレットが一致しません）' };
  }
  // ① 教員稼働状態の同期（親コンソールにしかログインしないため、子は親から受け取る）。
  //    子の既存の ka 機構（touchTeacherConsole / releaseTeacherConsole）をそのまま使う。
  //    これにより子の isTeacherConsoleActive() が正しく true になり、端末が同期を続けられる。
  let kaApplied = null;
  if (payload && payload.ka_active !== undefined) {
    try {
      if (payload.ka_active) {
        touchTeacherConsole('__shard_parent__');
        kaApplied = true;
      } else {
        releaseTeacherConsole('__shard_parent__');
        kaApplied = false;
      }
    } catch (e) {
      kaApplied = null;
    }
  }

  const ids = (payload && payload.student_ids) || [];
  const patch = (payload && payload.patch) || {};
  const idList = Array.isArray(ids) ? ids : [];
  if (!idList.length) {
    // ka 伝達だけの呼び出しは正常（ポリシー変更なし）
    return { success: true, applied: 0, ka_active: kaApplied };
  }

  // 行の用意結果。try の外で宣言する（return が try の外にあるため、
  // try 内で let 宣言すると参照できず ReferenceError になる）。
  let ensureResult = { created: 0, error: '' };

  try {
    // 先に行を用意する。これが無いと、まだ子と通信していない児童への
    // 一括操作が「成功」を返しながら実際には何も適用されない。
    // ※ ここで失敗を握りつぶさない。行が作れない＝一括操作が効かない状態なので、
    //   応答に残して親（＝コンソールの操作結果）から見えるようにする。
    const classMap = (payload && payload.class_map) || null;
    try {
      ensureResult.created = shardEnsureDeviceRows(idList, classMap) || 0;
    } catch (e) {
      ensureResult.error = String((e && e.message) ? e.message : e);
    }

    if (patch.screen_lock !== undefined) {
      bulkUpdateScreenLock(idList, Boolean(patch.screen_lock));
    }
    if (patch.broadcast_url) {
      bulkUpdateBroadcastUrl(idList, String(patch.broadcast_url), '');
    }
    if (patch.filter_mode !== undefined) {
      bulkUpdateFilterMode(idList, String(patch.filter_mode),
        patch.whitelist_urls, patch.blacklist_urls);
    }
  } catch (e) {
    return { success: false, error: String(e) };
  }
  return { success: true, applied: idList.length, ka_active: kaApplied, ensure: ensureResult };
}

/** 設定から子GASのURL一覧を取り出す（重複除去・既定URL含む）。 */
const SHARD_LIST_CACHE_TTL = 4;   // 秒。集約結果のキャッシュ（3〜5秒の範囲）
const SHARD_LIST_CACHE_PREFIX = 'shard_ls_';

/** キャッシュキー用の短いハッシュ（CacheService のキー長・可読性のため）。 */
function shardHash(str) {
  const s = String(str || '');
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) & 0x7fffffff;
  }
  return h.toString(36);
}

/** 端末一覧の版数（親が書き込むと進む）。キャッシュキーに混ぜて古い一覧を配らない。 */
function shardDevVersion() {
  try {
    if (typeof CacheService === 'undefined') return '0';
    return String(CacheService.getScriptCache().get('dev_v') || '0');
  } catch (e) {
    return '0';
  }
}

/**
 * 複数リクエストを並列で送る。
 * fetchAll が使える環境では 1 回分の待ち時間で全件を取得する（今回の主目的）。
 * 使えない環境（テスト・古いランタイム）では直列 fetch へフォールバックし、挙動を変えない。
 */
function shardFetchMany(requests) {
  const reqs = Array.isArray(requests) ? requests : [];
  if (!reqs.length) return [];
  try {
    if (UrlFetchApp && typeof UrlFetchApp.fetchAll === 'function') {
      const out = UrlFetchApp.fetchAll(reqs);
      if (out && out.length === reqs.length) return out;
    }
  } catch (e) {
    // 並列化に失敗しても取得自体は諦めない（直列へ）
  }
  const out = [];
  for (let i = 0; i < reqs.length; i++) {
    const params = {};
    const keys = Object.keys(reqs[i] || {});
    for (let k = 0; k < keys.length; k++) {
      if (keys[k] !== 'url') params[keys[k]] = reqs[i][keys[k]];
    }
    try {
      out.push(UrlFetchApp.fetch(reqs[i].url, params));
    } catch (e2) {
      out.push(null);
    }
  }
  return out;
}

/**
 * この教員のために問い合わせる必要がある子GASのURLを選ぶ。
 *
 * ・管理者 / 対象クラス未設定 … 全子GAS（全校・全学年の表示に対応）
 * ・対象クラスあり（専科等） … そのクラスを担当する子GASのみ
 *   ＝ 1 クラス分の通信で済む（並列化と合わせて最も効く経路）
 * ・該当が無い場合は安全側で全件へフォールバック（設定不備で児童が消えないように）
 */
function shardUrlsForTeacher(cfg, teacher) {
  const all = shardAllChildUrls(cfg);
  if (!all.length) return all;

  let targets = [];
  try {
    targets = (typeof getTeacherTargetClasses === 'function') ? getTeacherTargetClasses(teacher) : [];
  } catch (e) {
    targets = [];
  }
  if (!targets.length) return all;

  const idx = shardMapIndexFromMap(cfg && cfg.map);
  const want = {};
  let wantCount = 0;
  for (let i = 0; i < targets.length; i++) {
    const k = normalizeShardClass(targets[i]);
    if (k) { want[k] = true; wantCount++; }
  }
  if (!wantCount) return all;

  const hit = {};
  const keys = Object.keys(idx);
  for (let i = 0; i < keys.length; i++) {
    if (want[keys[i]]) hit[idx[keys[i]]] = true;
  }

  const out = [];
  for (let i = 0; i < all.length; i++) {
    if (hit[all[i]]) out.push(all[i]);
  }
  // 既定URL（クラス不明の児童の受け皿）は取りこぼさないよう常に含める。
  const def = String((cfg && cfg.def) || '').trim();
  if (def && all.indexOf(def) >= 0 && out.indexOf(def) < 0) out.push(def);

  return out.length ? out : all;
}

function shardAllChildUrls(cfg) {
  const out = [];
  const seen = {};
  const push = function (u) {
    const s = String(u || '').trim();
    if (!s || seen[s]) return;
    seen[s] = true;
    out.push(s);
  };
  const idx = shardMapIndexFromMap(cfg && cfg.map);
  const keys = Object.keys(idx);
  for (let i = 0; i < keys.length; i++) push(idx[keys[i]]);
  // 空キー既定（SHARD_MAP_V1 の ""）も子GASの1台として数える
  push(shardMapDefaultFromEmptyKey(cfg && cfg.map));
  push(cfg && cfg.def);
  return out;
}

/**
 * 親GAS側: 教員コンソールの稼働状態を子GASへ伝達する。
 *
 * 【なぜ必要か】
 *   教員は親コンソールにしかログインしない。子GASの isTeacherConsoleActive() は
 *   自分への touch が無いため永久に false になり、子が担当する端末は
 *   ka_active=false を受け取って同期を停止してしまう（分散化した瞬間に全端末停止）。
 *   そこで親が touch/release のたびに子へ稼働状態を配る。
 *
 * 【負荷】
 *   active=true は 30 秒に 1 回へ間引く（子側の判定窓は 120 秒なので十分）。
 *   release は即時。子は 6 クラス程度なので、追加通信は毎分 12 回程度に収まる。
 */
function shardPropagateKaState(active) {
  if (!isShardParent()) return { skipped: true };
  try {
    const cfg = shardConfigCached();
    const urls = shardAllChildUrls(cfg);
    if (!urls.length) return { skipped: true, reason: 'no_child' };

    if (active) {
      // 30 秒に 1 回へ間引く（子の KA_ACTIVE_WINDOW_MS=120秒 に対して十分細かい）
      try {
        const cache = CacheService.getScriptCache();
        const k = 'shard_ka_ts';
        const last = Number(cache.get(k) || '0');
        const nowMs = new Date().getTime();
        if (last && (nowMs - last) < 30000) return { throttled: true };
        cache.put(k, String(nowMs), 180);
      } catch (e) { /* キャッシュ不可時は毎回送る */ }
    }

    const body = JSON.stringify({
      action: 'shard_apply',
      shard_secret: cfg.sec,
      student_ids: [],
      ka_active: !!active
    });
    // 全校分あっても 1 回分の待ち時間で配信する（並列）。
    const requests = [];
    for (let i = 0; i < urls.length; i++) {
      requests.push({
        url: urls[i], method: 'post', contentType: 'application/json',
        payload: body, muteHttpExceptions: true
      });
    }
    const responses = shardFetchMany(requests);
    const results = [];
    for (let i = 0; i < responses.length; i++) {
      const res = responses[i];
      if (res) results.push({ ok: true, status: res.getResponseCode() });
      else results.push({ ok: false, error: 'no_response' });
    }
    return { sent: results.length, active: !!active };
  } catch (e) {
    return { error: String(e) };
  }
}

/**
 * 親GAS側: 子GASの端末一覧を取得してマージするための材料を集める。
 * 子側は shard_list で「その子が持つ全端末（スコープ適用前）」を返す。
 * スコープ（学校・対象クラス）の適用は親が行う＝教員マスタの正は親にあるため。
 */
/**
 * 教員コンソールの get_all 用: 親のシート + 子GASの端末を集約して返す。
 *
 * 分散が無効（SHARD_MODE=false）のときは getAllDevices をそのまま返す＝従来と完全同一。
 * 有効なときは「集約後の全件レスポンス」を 3〜5 秒キャッシュする。
 * キーに dev_v を混ぜているため、ロック/配信/規制などの書き込みで自動的に失効する
 * （＝操作直後は必ず最新、自動更新や連続操作ではキャッシュに当たる）。
 */
function getShardMergedDevices(filterSchool, teacher, includeUnassigned) {
  if (!isShardParent()) {
    return getAllDevices(filterSchool, teacher, includeUnassigned);
  }

  const t = teacher || {};
  const scopeKey = [
    filterSchool || 'ALL',
    includeUnassigned ? '1' : '0',
    t.email || '', t.school || '', t.role || '', t.target_class || ''
  ].join('|');
  const cacheKey = 'shard_ga_' + shardHash(scopeKey) + '_' + shardDevVersion();

  let cache = null;
  try {
    if (typeof CacheService !== 'undefined') {
      cache = CacheService.getScriptCache();
      const hit = cache.get(cacheKey);
      if (hit) {
        const arr = JSON.parse(hit);
        if (Array.isArray(arr)) return arr;
      }
    }
  } catch (e) {
    cache = null;
  }

  const baseData = getAllDevices(filterSchool, teacher, includeUnassigned);
  const data = shardMergeDevices(baseData, filterSchool, teacher, includeUnassigned);

  if (cache) {
    try { cache.put(cacheKey, JSON.stringify(data), SHARD_LIST_CACHE_TTL); } catch (e) {}
  }
  return data;
}

function shardFetchChildDevices(urlsOverride) {
  if (!isShardParent()) return [];
  try {
    const cfg = shardConfigCached();
    const urls = Array.isArray(urlsOverride) ? urlsOverride : shardAllChildUrls(cfg);
    if (!urls.length) return [];

    // 集約結果の短時間キャッシュ（3〜5秒）。
    // キーに dev_v を混ぜるため、教員がロック/配信/規制を行うと自動的に無効化される。
    // ＝ 操作直後は必ず最新、自動更新や連続操作ではキャッシュに当たる。
    const cacheKey = SHARD_LIST_CACHE_PREFIX + shardHash(urls.join(',') + '|' + shardDevVersion());
    let cache = null;
    try {
      if (typeof CacheService !== 'undefined') {
        cache = CacheService.getScriptCache();
        const hit = cache.get(cacheKey);
        if (hit) {
          const arr = JSON.parse(hit);
          if (Array.isArray(arr)) return arr;
        }
      }
    } catch (e) {
      cache = null;
    }

    const body = JSON.stringify({ action: 'shard_list', shard_secret: cfg.sec });
    const requests = [];
    for (let i = 0; i < urls.length; i++) {
      requests.push({
        url: urls[i], method: 'post', contentType: 'application/json',
        payload: body, muteHttpExceptions: true
      });
    }

    // 並列（一括）取得。12 クラスあっても 1 回分の待ち時間で揃う。
    const responses = shardFetchMany(requests);

    const out = [];
    for (let i = 0; i < responses.length; i++) {
      const res = responses[i];
      if (!res) continue;
      try {
        if (res.getResponseCode() !== 200) continue;
        const parsed = JSON.parse(res.getContentText() || '{}');
        const list = (parsed && parsed.data) || [];
        if (!Array.isArray(list)) continue;
        for (let k = 0; k < list.length; k++) {
          list[k]._shard_source = urls[i];
          out.push(list[k]);
        }
      } catch (e) { /* 1台の子が落ちても他の子の結果は返す */ }
    }

    if (cache) {
      try { cache.put(cacheKey, JSON.stringify(out), SHARD_LIST_CACHE_TTL); } catch (e) {}
    }
    return out;
  } catch (e) {
    return []; // 分散が未設定・失敗なら空配列＝親の一覧だけを返す（従来動作）
  }
}


/**
 * 子GAS側: 親へ返す端末一覧（スコープ適用前の生データ）。
 * 共有シークレットで認証するため、外部からは取得できない。
 */
function shardListForParent(payload) {
  if (!isShardChild() && !isShardParent()) {
    return { success: false, error: '子GASとして構成されていません' };
  }
  if (!shardSecretMatches(payload && payload.shard_secret)) {
    return { success: false, error: 'unauthorized' };
  }
  // 教員情報を渡さずに呼ぶ＝スコープ無効（全件）。親が改めてスコープを掛ける。
  const list = getAllDevices('ALL', { role: 'ADMIN' }, true);
  return { success: true, data: list };
}

/**
 * 親GAS側: マージ後の端末一覧に教員スコープを適用する。
 * 学校スコープ・対象クラス・学校絞り込みの 3 条件を、getAllDevices と同じ規則で適用する。
 * 解決済みの既存ヘルパー（getTeacherScopeInfo / isClassInTeacherScope /
 * resolveCanonicalSchool / schoolNamesMatch）を再利用し、判定の二重実装を避ける。
 */
function shardFilterMergedDevices(list, filterSchool, teacher, includeUnassigned) {
  const src = Array.isArray(list) ? list : [];
  const scopeInfo = getTeacherScopeInfo(teacher);
  const restrictToOwnSchool = scopeInfo.type === 'school' || scopeInfo.type === 'unknown';
  const teacherSchool = scopeInfo.school || '';
  const classRestricted = getTeacherTargetClasses(teacher).length > 0;

  const out = [];
  for (let i = 0; i < src.length; i++) {
    const d = src[i] || {};
    const schoolName = String(d.school_name || '').trim();
    const className = String(d.class_name || '').trim();

    // 0. 所属学校スコープ（一般教員は自校＋学校未設定のみ）
    if (restrictToOwnSchool && schoolName && schoolName !== '未設定') {
      const devCanonical = resolveCanonicalSchool(schoolName);
      const isOwn = devCanonical ? (devCanonical === teacherSchool)
                                 : schoolNamesMatch(schoolName, teacherSchool);
      if (!isOwn) continue;
    }

    // 0.5 対象クラススコープ（権限の境界）
    if (classRestricted && !isClassInTeacherScope(className, teacher)) continue;

    // 1. 学校絞り込み（画面のフィルタ）
    if (filterSchool && filterSchool !== 'ALL') {
      if (filterSchool === 'UNASSIGNED') {
        if (schoolName && schoolName !== '未設定') continue;
      } else if (includeUnassigned) {
        if (schoolName !== '未設定' && schoolName !== '' &&
            !schoolNamesMatch(schoolName, filterSchool)) continue;
      } else {
        if (!schoolNamesMatch(schoolName, filterSchool)) continue;
      }
    }

    out.push(d);
  }
  return applyMonitorVisibility(out);
}

/**
 * 親GAS側: 親の端末一覧に子GASの端末を足して返す（教員は1画面のまま）。
 * SHARD_MODE=false なら base をそのまま返す（従来動作と完全に同一）。
 */
/**
 * 親の行と子の行を1台分だけ突き合わせて統合する。
 *
 * 【なぜ必要か（split-brain）】
 *   端末は割り当て後「子GAS」にしかハートビートしないため、子のシートだけが更新される。
 *   親のシートの最終同期日時は切り替え時点で止まる。以前は「親が持っていれば子を捨てる」
 *   だったので、親の古い日時だけを見て is_online=false（オフライン）になっていた。
 *
 * 【統合の規則】
 *   ・名簿（氏名・学校・クラス）… 親が正。親が「未設定」「未登録児童…」なら子で補う
 *   ・テレメトリ（最終同期・現在URL・監視・画面更新）… 最終同期が新しい方を採用
 *   ・コマンド（ロック・規制・一斉表示・画面要求・備考）… 親が正。
 *     親が空で子に入っていれば子を残す（伝達済みの値を消さない）
 *   ・is_online … 統合後の最終同期から再計算する（親だけ見ると誤判定する）
 */
function shardMergeDeviceRow(parentDev, childDev) {
  const p = parentDev || {};
  const c = childDev || {};

  const toMs = function (v) {
    const s = String(v === null || v === undefined ? '' : v).trim();
    if (!s) return 0;
    const t = new Date(s).getTime();
    return isNaN(t) ? 0 : t;
  };
  const pSeen = toMs(p.last_seen);
  const cSeen = toMs(c.last_seen);
  const childFresher = cSeen > pSeen;

  // 親を土台にし、親に無いキーだけ子から足す
  const out = {};
  const pk = Object.keys(p);
  for (let i = 0; i < pk.length; i++) out[pk[i]] = p[pk[i]];
  const ck = Object.keys(c);
  for (let i = 0; i < ck.length; i++) { if (!(ck[i] in out)) out[ck[i]] = c[ck[i]]; }

  // ---- 名簿: 親が正。親が無効値なら子で補う ----
  const roster = ['student_name', 'school_name', 'class_name'];
  for (let i = 0; i < roster.length; i++) {
    const k = roster[i];
    const pv = String(p[k] === undefined || p[k] === null ? '' : p[k]).trim();
    const cv = String(c[k] === undefined || c[k] === null ? '' : c[k]).trim();
    const parentBad = !pv || pv === '未設定' ||
      /^未登録児童/.test(pv) || /\(Googleアカウント\)/.test(pv);
    if (parentBad && cv && cv !== '未設定') out[k] = c[k];
  }

  // ---- テレメトリ: 子の方が新しいときだけ子を採用 ----
  if (childFresher) {
    const telemetry = ['last_seen', 'current_url', 'screenshot_at',
      'monitor_flag', 'monitor_reason', 'monitor_url', 'monitor_at'];
    for (let i = 0; i < telemetry.length; i++) {
      const k = telemetry[i];
      if (k in c) out[k] = c[k];
    }
  }

  // ---- 最終同期とオンライン判定（ここが症状の本体）----
  const bestSeen = Math.max(pSeen, cSeen);
  const bestStr = childFresher
    ? String(c.last_seen || p.last_seen || '')
    : String(p.last_seen || c.last_seen || '');
  out.last_seen = bestStr;
  out.is_online = bestSeen ? ((new Date().getTime() - bestSeen) < 60000) : false;

  // ---- コマンド: 親が正。親が空なら子を残す ----
  const commands = ['screen_lock', 'filter_mode', 'whitelist_urls', 'blacklist_urls',
    'broadcast_url', 'broadcast_id', 'screen_request_at', 'notes'];
  for (let i = 0; i < commands.length; i++) {
    const k = commands[i];
    const pv = p[k];
    const parentEmpty = (pv === undefined || pv === null || pv === '' ||
      (Array.isArray(pv) && pv.length === 0));
    if (parentEmpty && (k in c)) out[k] = c[k];
  }

  return out;
}

function shardMergeDevices(base, filterSchool, teacher, includeUnassigned) {
  if (!isShardParent()) return base;
  try {
    const cfg = shardConfigCached();
    // 専科教員（対象クラスあり）は該当する子GASだけへ問い合わせる。
    // 管理者・全クラス担当は全校分（並列取得なので待ち時間は1回分）。
    const urls = shardUrlsForTeacher(cfg, teacher);
    if (!urls.length) return base;

    const childList = shardFetchChildDevices(urls);
    if (!childList.length) return base;

    const merged = (Array.isArray(base) ? base.slice() : []);
    const rowOf = {};
    for (let i = 0; i < merged.length; i++) {
      const id = String(merged[i] && merged[i].student_id || '').trim();
      if (id) rowOf[id] = i;
    }

    // 子の端末を1台ずつ処理する。
    //   ・親にも居る → 突き合わせて統合（テレメトリは新しい方＝通常は子）
    //   ・親に居ない → 新規として追加（スコープ適用の対象）
    // 以前は「親に居れば子を捨てる」だったため、切り替え直後から親の古い日時で
    // オフライン表示になっていた。ここが split-brain の修正点。
    const extra = [];
    const newIds = {};
    for (let i = 0; i < childList.length; i++) {
      const child = childList[i] || {};
      const id = String(child.student_id || '').trim();
      if (!id) continue;

      if (rowOf[id] !== undefined) {
        merged[rowOf[id]] = shardMergeDeviceRow(merged[rowOf[id]], child);
        continue;
      }
      if (newIds[id]) continue; // 複数の子GASが同じ児童を返した場合は先着を採る
      newIds[id] = true;
      extra.push(child);
    }
    if (!extra.length) return merged;

    // 子から来た分だけスコープを適用してから連結する
    const filtered = shardFilterMergedDevices(extra, filterSchool, teacher, includeUnassigned);
    return merged.concat(filtered);
  } catch (e) {
    return base; // マージに失敗しても親の一覧は必ず返す
  }
}


/**
 * 親GAS側: 子GASから届いたテレメトリ（在席状況・現在URL）を集約シートへ反映する。
 * ロック/規制/配信などのポリシー列には一切触らない（正は親が持つ）。
 */
function shardUpsertTelemetryFromChild(payload) {
  if (!isShardParent()) {
    return { success: false, error: '親GASとして構成されていません' };
  }
  if (!shardSecretMatches(payload && payload.shard_secret)) {
    return { success: false, error: 'unauthorized（共有シークレットが一致しません）' };
  }
  const rows = (payload && payload.rows) || [];
  if (!Array.isArray(rows) || !rows.length) {
    return { success: true, updated: 0 };
  }

  return withWriteLock(function () {
    const sheet = getTargetSheet(CONFIG.DEVICE_SHEET_NAME);
    const headerMap = getHeaderMap(sheet, CONFIG.DEVICE_COLUMNS);
    const data = sheet.getDataRange().getValues();
    const idCol = headerMap['児童ID'] - 1;

    // 既存行を索引化（毎回の全走査を1回に限定）
    const rowIndex = {};
    for (let i = 1; i < data.length; i++) {
      const id = String(data[i][idCol] || '').trim();
      if (id) rowIndex[id] = i + 1;
    }

    let updated = 0;
    let appended = 0;

    for (let k = 0; k < rows.length; k++) {
      const r = rows[k] || {};
      const id = String(r.student_id || '').trim();
      if (!id) continue;

      let rowNum = rowIndex[id];
      if (!rowNum) {
        // 親がまだ知らない端末（子から先に登録された場合）→ 行を作る
        const newRow = new Array(CONFIG.DEVICE_COLUMNS.length).fill('');
        newRow[headerMap['児童ID'] - 1] = id;
        newRow[headerMap['学校名'] - 1] = String(r.school_name || '未設定');
        newRow[headerMap['氏名'] - 1] = String(r.student_name || ('未登録児童 (' + id + ')'));
        newRow[headerMap['クラス'] - 1] = String(r.class_name || '未設定');
        newRow[headerMap['画面ロック'] - 1] = false;
        newRow[headerMap['URL規制モード'] - 1] = 'OFF';
        newRow[headerMap['現在開いているURL'] - 1] = String(r.current_url || '');
        newRow[headerMap['最終同期日時'] - 1] = String(r.last_seen || '');
        sheet.appendRow(newRow);
        rowIndex[id] = data.length + appended + 1;
        appended++;
        continue;
      }

      // テレメトリ列のみ更新（ポリシー列は触らない）
      const cells = [];
      const put = function (colName, value) {
        const c = headerMap[colName];
        if (c) cells.push({ c: c, v: value });
      };
      if (r.current_url !== undefined) put('現在開いているURL', String(r.current_url || ''));
      if (r.last_seen !== undefined) put('最終同期日時', String(r.last_seen || ''));
      if (r.student_name !== undefined) put('氏名', String(r.student_name || ''));
      if (r.class_name !== undefined) put('クラス', String(r.class_name || ''));
      // 学校名は「未設定」のときだけ補完する（教員の手動設定を上書きしない）
      if (r.school_name) {
        const sc = headerMap['学校名'];
        if (sc) {
          const cur = String(data[rowNum - 1][sc - 1] || '').trim();
          if (!cur || cur === '未設定') put('学校名', String(r.school_name));
        }
      }

      for (let c = 0; c < cells.length; c++) {
        sheet.getRange(rowNum, cells[c].c).setValue(cells[c].v);
      }
      updated++;
    }

    invalidateDevicesCache();
    return { success: true, updated: updated, appended: appended };
  });
}

/**
 * 親GAS側: 教員操作を該当する子GASへ伝達する。
 * 対象児童をクラスで束ね、子GASごとに 1 リクエストへまとめる（通信回数を最小化）。
 * SHARD_MODE が false なら即 return（従来動作に一切影響しない）。
 */
function shardPropagatePolicy(studentIds, patch) {
  if (!isShardParent()) return { skipped: true };
  try {
    const cfg = shardConfigCached();
    const idx = shardMapIndexFromMap(cfg.map);
    const defUrl = String(cfg.def || '').trim();
    // SHARD_MAP_V1 の空キー（""）で指定された既定の子GAS。
    // これを見落とすと、クラス未設定の児童にコマンドが一切届かない。
    const emptyDef = shardMapDefaultFromEmptyKey(cfg.map);
    if (!Object.keys(idx).length && !defUrl && !emptyDef) return { skipped: true, reason: 'no_child' };

    const sheet = getTargetSheet(CONFIG.DEVICE_SHEET_NAME);
    const headerMap = getHeaderMap(sheet, CONFIG.DEVICE_COLUMNS);
    const data = sheet.getDataRange().getValues();
    const idCol = headerMap['児童ID'] - 1;
    const clsCol = headerMap['クラス'] - 1;

    const isAll = (studentIds === 'ALL' || !Array.isArray(studentIds));
    const idSet = Array.isArray(studentIds) ? new Set(studentIds) : null;

    const groups = {}; // url -> [studentId]
    const groupClasses = {}; // url -> { studentId: 元のクラス名 }
    for (let i = 1; i < data.length; i++) {
      const id = String(data[i][idCol] || '').trim();
      if (!id) continue;
      if (!isAll && !(idSet && idSet.has(id))) continue;
      const rawClass = String(data[i][clsCol] || '').trim();
      const cls = normalizeShardClass(rawClass);
      // クラス一致 → 空キー既定 → SHARD_DEFAULT_URL の順で解決する
      const url = idx[cls] || emptyDef || defUrl;
      if (!url) continue;
      if (!groups[url]) groups[url] = [];
      groups[url].push(id);
      // 子のシートで行を作るときにクラスを埋めるため、元の表記のまま渡す。
      if (!groupClasses[url]) groupClasses[url] = {};
      groupClasses[url][id] = rawClass;
    }

    const urls = Object.keys(groups);
    // 全校一括ロック／一括URL配信でも、全子GASへ 1 回分の待ち時間で一斉に伝達する（並列）。
    const requests = [];
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      requests.push({
        url: url,
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify({
          action: 'shard_apply',
          shard_secret: cfg.sec,
          student_ids: groups[url],
            // 子が行を作るときにクラスを埋められるよう、児童ID→クラス名を添える。
            class_map: groupClasses[url] || {},
            patch: patch
          }),
        muteHttpExceptions: true
      });
    }

    const responses = shardFetchMany(requests);
    const results = [];
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      const res = responses[i];
      if (!res) {
        results.push({ url: url, count: groups[url].length, error: 'no_response' });
        continue;
      }
      try {
        const code = res.getResponseCode();
        // 子が「行を用意できなかった」場合は一括操作が効いていない。握りつぶさず伝える。
        let childEnsure = null;
        try {
          const parsed = JSON.parse(res.getContentText() || '{}');
          childEnsure = (parsed && parsed.ensure) || null;
          if (childEnsure && childEnsure.error) {
            results.push({ url: url, count: groups[url].length, status: code, ensure_error: childEnsure.error });
            continue;
          }
        } catch (e2) { /* 本文が読めなくてもステータスは残す */ }
        results.push({ url: url, count: groups[url].length, status: code, ensure: childEnsure });
      } catch (e) {
        results.push({ url: url, count: groups[url].length, error: String(e) });
      }
    }
    return { sent: results };
  } catch (e) {
    // 子への伝達に失敗しても、親のシート更新（＝コンソール表示）は成立させる
    return { error: String(e) };
  }
}

/** 管理画面向け: 子GAS分散の現在の設定を返す（シークレットは伏せる）。 */
function getShardSettingsForAdmin() {
  const map = readShardMapRaw();
  const idx = shardMapIndexFromMap(map);
  const classes = Object.keys(map).map(function (k) {
    return { class_name: k, normalized: normalizeShardClass(k), url: String(map[k] || '').trim() };
  });
  return {
    shard_mode: isShardParent(),
    child_mode: isShardChild(),
    classes: classes,
    normalized_count: Object.keys(idx).length,
    default_url: readShardDefaultUrl(),
    secret_configured: !!String((function () {
      try { return PropertiesService.getScriptProperties().getProperty(SHARD_SECRET_PROP) || ''; }
      catch (e) { return ''; }
    })()),
    // どの設定がプロパティで上書きされているか（CONFIG / PROPERTY）
    sources: shardConfigSources(),
    // 空キー（""）で指定された既定ルーティング先
    empty_key_default: shardMapDefaultFromEmptyKey(map),
    max_per_class: 40
  };
}

/** 管理画面向け: 子GAS分散の設定を保存する（管理者のみ）。 */
function saveShardSettingsForAdmin(teacher, incoming) {
  if (!isAdminTeacher(teacher)) throw new Error('管理者のみ設定できます');
  const data = incoming || {};
  const props = PropertiesService.getScriptProperties();

  if (data.classes !== undefined) {
    const src = Array.isArray(data.classes) ? data.classes : [];
    const map = {};
    for (let i = 0; i < src.length; i++) {
      const cls = String((src[i] && src[i].class_name) || '').trim();
      const url = String((src[i] && src[i].url) || '').trim();
      if (!cls) continue;
      if (!url) continue;
      if (!/^https?:\/\//.test(url)) {
        throw new Error('子GASのURLは http(s):// で始めてください: ' + cls);
      }
      map[cls] = url;
    }
    props.setProperty(SHARD_MAP_PROP, JSON.stringify(map));
  }

  if (data.default_url !== undefined) {
    const d = String(data.default_url || '').trim();
    if (d && !/^https?:\/\//.test(d)) throw new Error('既定URLは http(s):// で始めてください');
    if (d) props.setProperty(SHARD_DEFAULT_PROP, d);
    else props.deleteProperty(SHARD_DEFAULT_PROP);
  }

  // シークレットは「再発行」指定時のみ作り直す（子GASへ配り直しが必要になるため）
  if (data.rotate_secret === true) {
    props.deleteProperty(SHARD_SECRET_PROP);
    getOrCreateShardSecret();
  }

  invalidateShardConfig();
  return getShardSettingsForAdmin();
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ==================== google.script.run 用エクスポート関数 ====================

// ---- 教員コンソールの稼働通知 API (google.script.run 用) ----
// GAS ネイティブ画面（script.google.com）からは content script へ postMessage が
// 届かない場合があるため、確実に届く google.script.run 経由の経路を用意する。
function api_consoleTouch(sessionId) {
  // 子GAS分散: 教員は親コンソールにしかログインしないため、子GASは自分の
  // isTeacherConsoleActive() が永久に false になる。ここで稼働を配らないと、
  // 子担当の端末が ka_active=false を受け取り「同期周期：停止」のまま止まる。
  // （doPost の console_touch だけが配っていたため、google.script.run 経由では届かなかった）
  let res = null;
  try { res = touchTeacherConsole(sessionId); }
  catch (err) { return { success: false, error: err.toString() }; }
  try { shardPropagateKaState(true); } catch (e) { /* 配信失敗でも稼働記録は成立させる */ }
  return res;
}

function api_consoleRelease(sessionId) {
  let res = null;
  try { res = releaseTeacherConsole(sessionId); }
  catch (err) { return { success: false, error: err.toString() }; }
  // 全セッションが消えた（＝非稼働）ときだけ子へ停止を伝える（従来の doPost と同じ規則）
  try { if (!isTeacherConsoleActive()) shardPropagateKaState(false); } catch (e) {}
  return res;
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
    // 子GAS分散: 教員コンソールの経路は google.script.run（この関数）と
    // doPost の get_all の2つがある。以前はここが getAllDevices を直接呼んでいたため、
    // google.script.run 経由のときだけ子GASの端末が見えなかった（経路による差）。
    // 集約（親＋子の統合）を通る getShardMergedDevices に統一する。
    // SHARD_MODE=false のときは内部で getAllDevices をそのまま返す＝従来と完全同一。
    const data = getShardMergedDevices(schoolName, currentTeacher, Boolean(includeUnassigned));
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
    // 子GAS分散: 教員コンソールは google.script.run（この関数）を使うため、
    // ここで伝達しないと子担当の端末にロック指示が届かない。
    // doPost の bulk_lock と同じ内容を渡す（SHARD_MODE=false なら何もしない）。
    const shardLock = shardPropagatePolicy(scoped.ids, { screen_lock: Boolean(locked) });
    return { success: true, message: `画面ロックを ${locked ? 'ON' : 'OFF'} に更新しました`, shard: shardLock };
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
    // 子GAS分散: 一斉URL配信も子へ伝達する（届かないと端末側で配信されない）
    const shardBc = shardPropagatePolicy(scoped.ids, { broadcast_url: url });
    return { success: true, broadcast_id: bcId, shard: shardBc };
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
    // 子GAS分散: URL規制も子へ伝達する
    const shardFilter = shardPropagatePolicy(scoped.ids, {
      filter_mode: mode,
      whitelist_urls: whitelist,
      blacklist_urls: blacklist
    });
    try {
      saveTeacherSettings(currentTeacher.email, {
        filter_whitelist: whitelist,
        filter_blacklist: blacklist
      });
    } catch (e) {
      Logger.log('教員規制設定保存エラー: ' + e);
    }
    return { success: true, message: `URL規制モードを ${mode} に更新しました`, shard: shardFilter };
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
    // 子GAS分散: 個別更新も子へ伝達する（doPost の update_single と同じ組み立て）
    const single = data || {};
    const shardPatch = {};
    if (single.screen_lock !== undefined) shardPatch.screen_lock = Boolean(single.screen_lock);
    if (single.filter_mode !== undefined) shardPatch.filter_mode = single.filter_mode;
    if (single.whitelist_urls !== undefined) shardPatch.whitelist_urls = single.whitelist_urls;
    if (single.blacklist_urls !== undefined) shardPatch.blacklist_urls = single.blacklist_urls;
    if (single.broadcast_url) shardPatch.broadcast_url = single.broadcast_url;
    const shardSingle = Object.keys(shardPatch).length
      ? shardPropagatePolicy([studentId], shardPatch) : { skipped: true };
    return { success: true, message: '設定を更新しました', shard: shardSingle };
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

// ---- AI監視設定 API (google.script.run 用) ----

function api_getMonitorSettings(token) {
  try {
    const auth = verifyToken(token);
    if (!auth.valid) return { success: false, need_auth: true, error: '認証セッションが無効です' };
    const currentTeacher = resolveCurrentTeacher(auth.teacher);
    return {
      success: true,
      settings: getMonitoringSettings(),
      is_admin: isAdminTeacher(currentTeacher)
    };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

function api_saveMonitorSettings(token, settings) {
  try {
    const auth = verifyToken(token);
    if (!auth.valid) return { success: false, need_auth: true, error: '認証セッションが無効です' };
    const currentTeacher = resolveCurrentTeacher(auth.teacher);
    const saved = saveMonitoringSettings(currentTeacher, settings || {});
    return { success: true, message: '監視設定を保存しました', settings: saved };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}


