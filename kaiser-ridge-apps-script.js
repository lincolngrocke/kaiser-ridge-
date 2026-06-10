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
const SUBTASKS_NAME   = 'Subtasks';

// ── Serve directory and subtask data to the app ──
function doGet(e) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    // App Directory
    const dirSheet = ss.getSheetByName(DIRECTORY_NAME);
    if (!dirSheet) return jsonResponse({ success: false, error: 'App Directory tab not found' });
    const dirRows = dirSheet.getDataRange().getValues();
    const directory = dirRows.slice(1).map(r => ({
      frequency: r[0],
      group:     r[1],
      task:      r[2],
      equipment: r[3],
    }));

    // Subtasks (optional tab)
    let subtasks = {};
    const stSheet = ss.getSheetByName(SUBTASKS_NAME);
    if (stSheet) {
      const stRows = stSheet.getDataRange().getValues();
      stRows.slice(1).forEach(r => {
        const task    = String(r[0]).trim();
        const subtask = String(r[1]).trim();
        if (!task || !subtask) return;
        if (!subtasks[task]) subtasks[task] = [];
        subtasks[task].push(subtask);
      });
    }

    return jsonResponse({ success: true, directory, subtasks });
  } catch (err) {
    return jsonResponse({ success: false, error: err.toString() });
  }
}

// ── Receive a new timesheet entry, OR a planner→calendar sync ──
function doPost(e) {
  try {
    const data  = JSON.parse(e.postData.contents);

    // Planner → Google Calendar sync
    if (data.action === 'calendar') {
      return handleCalendarSync(data);
    }
    // Remove a single planner block's calendar event
    if (data.action === 'calendarDelete') {
      return handleCalendarDelete(data);
    }

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
      data.break       || 0,
      data.hyperlink   || '',
      data.equipment   || '',
    ];

    sheet.appendRow(row);
    return jsonResponse({ success: true, taskId });

  } catch (err) {
    return jsonResponse({ success: false, error: err.toString() });
  }
}

// ── Sync one day's planner blocks into the default Google Calendar ──
// Events created by the app are tagged so re-pushing the same day UPDATES
// existing events and DELETES ones whose blocks were removed in the app —
// no duplicates. Payload: { action:'calendar', date:'DD/MM/YYYY', plans:[...] }
function handleCalendarSync(data) {
  const cal = CalendarApp.getDefaultCalendar();
  const plans = data.plans || [];

  const parts = String(data.date).split('/'); // DD/MM/YYYY
  const dd = parseInt(parts[0], 10);
  const mm = parseInt(parts[1], 10);
  const yyyy = parseInt(parts[2], 10);
  if (!dd || !mm || !yyyy) return jsonResponse({ success: false, error: 'Bad date: ' + data.date });

  const dayStart = new Date(yyyy, mm - 1, dd, 0, 0, 0);
  const dayEnd   = new Date(yyyy, mm - 1, dd, 23, 59, 59);

  // Index this app's existing events for the day by their planId tag
  const existing = {};
  cal.getEvents(dayStart, dayEnd).forEach(ev => {
    if (ev.getTag('krApp') === '1') {
      const pid = ev.getTag('krPlanId');
      if (pid) existing[pid] = ev;
    }
  });

  const result = {};
  const incoming = {};
  plans.forEach(p => {
    incoming[p.id] = true;
    const tp = String(p.startTime).split(':');
    const sh = parseInt(tp[0], 10) || 0;
    const sm = parseInt(tp[1], 10) || 0;
    const start = new Date(yyyy, mm - 1, dd, sh, sm, 0);
    const end   = new Date(start.getTime() + (Number(p.durationHours) || 1) * 3600000);

    const descLines = [];
    if (p.group) descLines.push('Group: ' + p.group);
    if (p.frequency) descLines.push('Frequency: ' + p.frequency);
    if (p.tool) descLines.push('Equipment: ' + p.tool);
    descLines.push('— Kaiser Ridge Task Tracker');
    const desc = descLines.join('\n');

    let ev = existing[p.id];
    if (ev) {
      ev.setTitle(p.task);
      ev.setTime(start, end);
      ev.setDescription(desc);
      ev.setLocation(p.location || '');
    } else {
      ev = cal.createEvent(p.task, start, end, { description: desc, location: p.location || '' });
      ev.setTag('krApp', '1');
      ev.setTag('krPlanId', p.id);
    }
    result[p.id] = ev.getId();
  });

  // Remove app events whose blocks were deleted in the app
  Object.keys(existing).forEach(pid => {
    if (!incoming[pid]) existing[pid].deleteEvent();
  });

  return jsonResponse({ success: true, count: plans.length, events: result });
}

// ── Delete one planner block's calendar event (by its planId tag) ──
// Payload: { action:'calendarDelete', date:'DD/MM/YYYY', planId:'...' }
function handleCalendarDelete(data) {
  const cal = CalendarApp.getDefaultCalendar();

  const parts = String(data.date).split('/'); // DD/MM/YYYY
  const dd = parseInt(parts[0], 10);
  const mm = parseInt(parts[1], 10);
  const yyyy = parseInt(parts[2], 10);
  if (!dd || !mm || !yyyy) return jsonResponse({ success: false, error: 'Bad date: ' + data.date });

  const dayStart = new Date(yyyy, mm - 1, dd, 0, 0, 0);
  const dayEnd   = new Date(yyyy, mm - 1, dd, 23, 59, 59);

  let deleted = 0;
  cal.getEvents(dayStart, dayEnd).forEach(ev => {
    if (ev.getTag('krApp') === '1' && ev.getTag('krPlanId') === String(data.planId)) {
      ev.deleteEvent();
      deleted++;
    }
  });

  return jsonResponse({ success: true, deleted });
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
