/**
 * タクト・リハさかもと｜空き状況シート → GitHub 自動反映スクリプト
 *
 * Googleスプレッドシートの空き枠を書き換えると、このスクリプトが
 * assets/availability.json を GitHub に書き戻し、サイトの表示が自動で切り替わります。
 *
 * セットアップ手順は tools/availability-sync.md を参照してください。
 */

var CONFIG = {
  owner: 'sakamoto-hospital',
  repo: 'sakamoto-rehab-guide',
  branch: 'main',                    // GitHub Pages が公開しているブランチ
  path: 'assets/availability.json',
  sheetName: '空き状況',        // この名前のシートが無ければ、先頭のシートを使います
  capacityCell: 'B1'                 // 1クールの定員
};

var DEFAULT_DAYS = ['月', '火', '水', '木', '金', '土'];
var DEFAULT_COURSES = [
  ['①', '9:00〜10:30'],
  ['②', '10:40〜12:10'],
  ['③', '13:30〜15:00'],
  ['④', '15:10〜16:40']
];
var DIRTY_KEY = 'AVAILABILITY_DIRTY';

/* ---------------- メニュー ---------------- */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('空き状況')
    .addItem('今すぐサイトに反映', 'syncNow')
    .addItem('自動反映をオンにする', 'setupTriggers')
    .addSeparator()
    .addItem('シートのひな形をつくる', 'createSheetTemplate')
    .addItem('接続テスト', 'testConnection')
    .addToUi();
}

/* ---------------- 反映 ---------------- */

/** 手動実行：いまのシートの内容をそのまま GitHub へ反映します。 */
function syncNow() {
  var result = pushToGitHub_(buildJson_());
  var message = result.changed ? 'サイトに反映しました。（1〜2分で表示が切り替わります）' : '変更がなかったため、そのままにしました。';
  notify_(message);
  return result;
}

/** 1分ごとに動き、編集があったときだけ反映します。 */
function syncIfDirty() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty(DIRTY_KEY) !== 'yes') return;
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return;
  try {
    props.deleteProperty(DIRTY_KEY);
    pushToGitHub_(buildJson_());
  } catch (err) {
    props.setProperty(DIRTY_KEY, 'yes'); // 失敗したら次の1分でもう一度試します
    throw err;
  } finally {
    lock.releaseLock();
  }
}

/** 編集トリガー（インストール型）。編集があったことだけ記録します。 */
function onSheetEdit(e) {
  var target = getSheet_();
  if (e && e.range && target && e.range.getSheet().getSheetId() !== target.getSheetId()) return;
  PropertiesService.getScriptProperties().setProperty(DIRTY_KEY, 'yes');
}

/* ---------------- シート読み取り ---------------- */

/** 「空き状況」シート。無ければ先頭のシートを使います。 */
function getSheet_() {
  var ss = SpreadsheetApp.getActive();
  return ss.getSheetByName(CONFIG.sheetName) || ss.getSheets()[0];
}

function buildJson_() {
  var sheet = getSheet_();
  if (!sheet) throw new Error('シートが見つかりません。');

  var capacity = Math.max(1, Math.round(Number(sheet.getRange(CONFIG.capacityCell).getValue()) || 8));
  var values = sheet.getDataRange().getValues();

  var headerRow = -1;
  for (var r = 0; r < values.length; r++) {
    if (courseKeysIn_(values[r]).length) { headerRow = r; break; }
  }
  if (headerRow < 0) throw new Error('①〜④のクール見出しが見つかりません。「シートのひな形をつくる」を実行してください。');

  var courseKeys = courseKeysIn_(values[headerRow]);   // [{key:'①', col:1}, ...]
  var days = [];
  var availability = {};

  for (var i = headerRow + 1; i < values.length; i++) {
    var day = String(values[i][0] || '').trim().replace(/曜日?$/, '');
    if (!day) continue;
    days.push(day);
    var row = {};
    for (var c = 0; c < courseKeys.length; c++) {
      row[courseKeys[c].key] = parseRemaining_(values[i][courseKeys[c].col], capacity);
    }
    availability[day] = row;
  }
  if (!days.length) throw new Error('曜日の行が見つかりません。A列に月〜土を入れてください。');

  return JSON.stringify({
    updatedAt: Utilities.formatDate(new Date(), 'Asia/Tokyo', "yyyy-MM-dd'T'HH:mm:ssXXX"),
    capacityPerCourse: capacity,
    days: days,
    availability: availability
  }, null, 2) + '\n';
}

function courseKeysIn_(row) {
  var found = [];
  for (var c = 1; c < row.length; c++) {
    var match = String(row[c] || '').match(/[①②③④⑤⑥]/);
    if (match) found.push({ key: match[0], col: c });
  }
  return found;
}

/**
 * 残りの空き枠の読み取り。
 * 数字 → そのまま／空欄 → 定員いっぱい空き／「満」「×」「-」→ 0（受付調整中）
 */
function parseRemaining_(value, capacity) {
  if (value === '' || value === null || value === undefined) return capacity;
  if (Object.prototype.toString.call(value) === '[object Date]') return capacity;
  var text = String(value).trim();
  if (/^(満|満員|×|x|X|✕|✖|-|ー|なし|不可)$/.test(text)) return 0;
  var n = Number(text.replace(/[^0-9.\-]/g, ''));
  if (isNaN(n)) return capacity;
  return Math.max(0, Math.min(capacity, Math.round(n)));
}

/* ---------------- GitHub ---------------- */

function pushToGitHub_(json) {
  var token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!token) throw new Error('GITHUB_TOKEN が未設定です。スクリプト プロパティに登録してください。');

  var api = 'https://api.github.com/repos/' + CONFIG.owner + '/' + CONFIG.repo + '/contents/' + CONFIG.path;
  var headers = { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' };

  var current = UrlFetchApp.fetch(api + '?ref=' + encodeURIComponent(CONFIG.branch), {
    headers: headers, muteHttpExceptions: true
  });
  var code = current.getResponseCode();
  var sha = null;
  if (code === 200) {
    var info = JSON.parse(current.getContentText());
    sha = info.sha;
    var existing = Utilities.newBlob(Utilities.base64Decode(info.content, Utilities.Charset.UTF_8)).getDataAsString('UTF-8');
    if (normalize_(existing) === normalize_(json)) return { changed: false };
  } else if (code !== 404) {
    throw new Error('GitHub の読み取りに失敗しました（' + code + '）：' + current.getContentText().slice(0, 300));
  }

  var payload = {
    message: '空き状況を更新（スプレッドシートから自動反映）',
    content: Utilities.base64Encode(json, Utilities.Charset.UTF_8),
    branch: CONFIG.branch
  };
  if (sha) payload.sha = sha;

  var put = UrlFetchApp.fetch(api, {
    method: 'put', contentType: 'application/json', headers: headers,
    payload: JSON.stringify(payload), muteHttpExceptions: true
  });
  if (put.getResponseCode() >= 300) {
    throw new Error('GitHub への書き込みに失敗しました（' + put.getResponseCode() + '）：' + put.getContentText().slice(0, 300));
  }
  return { changed: true };
}

function normalize_(text) {
  // updatedAt（更新時刻）だけの違いでは commit しないように比較します。
  return String(text).replace(/"updatedAt"\s*:\s*"[^"]*"/, '').replace(/\s+/g, '');
}

/* ---------------- セットアップ補助 ---------------- */

/** 自動反映のトリガー（編集時＋1分ごと）を作り直します。 */
function setupTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) ScriptApp.deleteTrigger(triggers[i]);

  var ss = SpreadsheetApp.getActive();
  ScriptApp.newTrigger('onSheetEdit').forSpreadsheet(ss).onEdit().create();
  ScriptApp.newTrigger('syncIfDirty').timeBased().everyMinutes(1).create();
  notify_('自動反映をオンにしました。シートを編集すると1〜2分でサイトに反映されます。');
}

/** 接続確認（書き込みはしません）。 */
function testConnection() {
  var token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!token) { notify_('GITHUB_TOKEN が未設定です。'); return; }
  var api = 'https://api.github.com/repos/' + CONFIG.owner + '/' + CONFIG.repo + '/contents/' + CONFIG.path;
  var res = UrlFetchApp.fetch(api + '?ref=' + encodeURIComponent(CONFIG.branch), {
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' },
    muteHttpExceptions: true
  });
  notify_(res.getResponseCode() === 200 ? 'GitHub に接続できました。シートを読めるかも確認します…' : 'GitHub に接続できませんでした（' + res.getResponseCode() + '）。');
  if (res.getResponseCode() === 200) {
    buildJson_(); // シート側の形式もここで検査されます
    notify_('シートの形式も問題ありません。');
  }
}

/** 空き状況シートのひな形を作ります（既にある場合は作りません）。 */
function createSheetTemplate() {
  var ss = SpreadsheetApp.getActive();
  if (ss.getSheetByName(CONFIG.sheetName)) { notify_('「' + CONFIG.sheetName + '」シートは既にあります。'); return; }
  if (ss.getSheets().length === 1 && ss.getSheets()[0].getLastRow() > 2) {
    notify_('すでに表が入っているようです。ひな形は作らず、そのままのシートを使います。');
    return;
  }
  var sheet = ss.insertSheet(CONFIG.sheetName);

  sheet.getRange('A1').setValue('1クールの定員').setFontWeight('bold');
  sheet.getRange(CONFIG.capacityCell).setValue(8);
  sheet.getRange('A2').setValue('数字＝残りの空き枠／「満」または「×」＝受付調整中／空欄＝定員いっぱい空き')
    .setFontColor('#666666');

  var header = ['曜日'];
  for (var c = 0; c < DEFAULT_COURSES.length; c++) {
    header.push(DEFAULT_COURSES[c][0] + 'クール　' + DEFAULT_COURSES[c][1]);
  }
  sheet.getRange(3, 1, 1, header.length).setValues([header]).setFontWeight('bold').setBackground('#e8f4ed');

  var rows = DEFAULT_DAYS.map(function (day) {
    return [day].concat(DEFAULT_COURSES.map(function () { return 8; }));
  });
  sheet.getRange(4, 1, rows.length, header.length).setValues(rows);
  sheet.setColumnWidth(1, 90);
  for (var i = 2; i <= header.length; i++) sheet.setColumnWidth(i, 150);
  sheet.setFrozenRows(3);
  notify_('ひな形を作りました。数字を書き換えると空き状況が変わります。');
}

function notify_(message) {
  try {
    SpreadsheetApp.getActive().toast(message, '空き状況', 8);
  } catch (err) {
    Logger.log(message);
  }
}
