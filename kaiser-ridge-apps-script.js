// ════════════════════════════════════════════════════════
//  Kaiser Ridge Task Tracker — Google Apps Script
//
//  Setup:
//  1. Open your Google Sheet → Extensions → Apps Script
//  2. Paste this entire file, replacing any existing code
//  3. Save (Ctrl+S / Cmd+S)
//  4. Click Deploy → Manage deployments → Edit → New version → Deploy
//  5. Copy the Web App URL → paste into the app's Settings tab
// ════════════════════════════════════════════════════════

const SHEET_NAME      = 'KR Task Tracker';
const DIRECTORY_NAME  = 'App Directory';

// ── Serve directory data to the app ──
function doGet(e) {
  try {
    const ss    = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(DIRECTORY_NAME);
    if (!sheet) return jsonResponse({ success: false, error: 'App Directory tab not found' });

    const rows = sheet.getDataRange().getValues();
    const headers = rows[0]; // Frequency, Group, Task, Equipment
    const data = rows.slice(1).map(r => ({
      frequency: r[0],
      group:     r[1],
      task:      r[2],
      equipment: r[3],
    }));

    return jsonResponse({ success: true, directory: data });
  } catch (err) {
    return jsonResponse({ success: false, error: err.toString() });
  }
}

// ── Receive a new timesheet entry ──
function doPost(e) {
  try {
    const data  = JSON.parse(e.postData.contents);
    const ss    = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAME);

    if (!sheet) {
      return jsonResponse({ success: false, error: 'Sheet "' + SHEET_NAME + '" not found' });
    }

    const lastRow = sheet.getLastRow();
    let nextNum = 1;
    if (lastRow >= 2) {
      const idCol = sheet.getRange('A2:A' + lastRow).getValues().flat();
      const nums  = idCol
        .filter(v => String(v).startsWith('#'))
        .map(v => parseInt(String(v).replace('#', ''), 10))
        .filter(n => !isNaN(n));
      if (nums.length > 0) nextNum = Math.max(...nums) + 1;
    }

    const taskId = '#' + String(nextNum).padStart(4, '0');

    const row = [
      taskId,
      data.date        || '',
      data.personnel   || 'Lincoln',
      data.location    || '',
      data.frequency   || '',
      data.group       || '',
      data.task        || '',
      data.notes       || '',
      data.durationHours || 0,
      data.clockIn     || '',
      data.clockOut    || '',
      data.hyperlink   || '',
      data.equipment   || '',
    ];

    sheet.appendRow(row);
    return jsonResponse({ success: true, taskId });

  } catch (err) {
    return jsonResponse({ success: false, error: err.toString() });
  }
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
