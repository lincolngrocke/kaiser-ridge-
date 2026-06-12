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

// ── Serve directory/subtasks, OR the shared task-library blob/version ──
function doGet(e) {
  try {
    const p = (e && e.parameter) || {};
    const props = PropertiesService.getScriptProperties();

    // Lightweight version check — Ethan's app polls this on launch
    if (p.libcheck === '1') {
      return jsonResponse({ success: true, libraryVersion: props.getProperty('kr_lib_version') || '' });
    }
    // Full library blob (reassembled from chunks)
    if (p.library === '1') {
      const count = parseInt(props.getProperty('kr_lib_count') || '0', 10);
      let lib = '';
      for (let i = 0; i < count; i++) lib += (props.getProperty('kr_lib_' + i) || '');
      return jsonResponse({ success: true, version: props.getProperty('kr_lib_version') || '', library: lib });
    }
    // Current sheet IDs, so the app can re-match its entries after a renumber
    if (p.ids === '1') {
      const idsSs = SpreadsheetApp.getActiveSpreadsheet();
      const idsSheet = idsSs.getSheetByName(SHEET_NAME);
      if (!idsSheet) return jsonResponse({ success: false, error: 'Sheet "' + SHEET_NAME + '" not found' });
      const idsLr = idsSheet.getLastRow();
      const ids = [];
      if (idsLr >= 2) {
        // Use the cells' DISPLAYED text, not raw values — avoids date/time type
        // coercion (e.g. the 1899-epoch timezone offset that mangles read-back times).
        idsSheet.getRange(2, 1, idsLr - 1, 14).getDisplayValues().forEach(r => {
          ids.push({
            taskId:   r[0],
            date:     r[1],
            clockIn:  r[9],
            clockOut: r[10],
            task:     r[6],
          });
        });
      }
      return jsonResponse({ success: true, ids: ids });
    }

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
    // Manager publishes the shared task library for other devices to pull
    if (data.action === 'publishLibrary') {
      return handlePublishLibrary(data);
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

    // Keep the sheet ordered by date, then clock-in time (oldest first), so
    // entries always read chronologically. IDs are assigned once and never
    // change — only the row order is rearranged here.
    const lr = sheet.getLastRow();
    if (lr >= 3) {
      const data = sheet.getRange(2, 1, lr - 1, 14).getValues();
      data.sort((a, b) => timesheetSortKey(a) - timesheetSortKey(b));
      sheet.getRange(2, 1, data.length, 14).setValues(data);
    }

    return jsonResponse({ success: true, taskId });

  } catch (err) {
    return jsonResponse({ success: false, error: err.toString() });
  }
}

// Sort key for a timesheet row: date (col B) then clock-in (col J), oldest
// first. Handles both string cells ("DD/MM/YYYY", "HH:MM") and native Date
// values, so it works regardless of how the cells are formatted.
function timesheetSortKey(row) {
  let yyyy = 0, mm = 0, dd = 0, hh = 0, mi = 0;
  const dv = row[1];
  if (Object.prototype.toString.call(dv) === '[object Date]') {
    yyyy = dv.getFullYear(); mm = dv.getMonth() + 1; dd = dv.getDate();
  } else {
    const p = String(dv || '').split('/');
    if (p.length === 3) { dd = parseInt(p[0], 10) || 0; mm = parseInt(p[1], 10) || 0; yyyy = parseInt(p[2], 10) || 0; }
  }
  const tv = row[9];
  if (Object.prototype.toString.call(tv) === '[object Date]') {
    hh = tv.getHours(); mi = tv.getMinutes();
  } else {
    const t = String(tv || '').split(':');
    if (t.length >= 2) { hh = parseInt(t[0], 10) || 0; mi = parseInt(t[1], 10) || 0; }
  }
  return ((yyyy * 100 + mm) * 100 + dd) * 10000 + hh * 100 + mi;
}

// ── ONE-TIME CLEANUP ──────────────────────────────────────────────────────
// Run this ONCE from the Apps Script editor to fix an existing backlog where
// older entries were given higher IDs. It sorts the timesheet by date/time and
// renumbers the ID column #0001…#000N oldest→newest, so the newest entry holds
// the highest ID. New entries continue from the top number afterwards.
// How to run: in the editor, pick "renumberTimesheetByDateTime" from the
// function dropdown, click Run, approve permissions if asked. Safe to re-run.
function renumberTimesheetByDateTime() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error('Sheet "' + SHEET_NAME + '" not found');
  const lr = sheet.getLastRow();
  if (lr < 2) return;
  const data = sheet.getRange(2, 1, lr - 1, 14).getValues();
  data.sort((a, b) => timesheetSortKey(a) - timesheetSortKey(b));
  data.forEach((r, i) => { r[0] = '#' + String(i + 1).padStart(4, '0'); });
  sheet.getRange(2, 1, data.length, 14).setValues(data);
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

  // Index this app's existing events for the day, grouped by planId tag
  // (arrays, so any accidental duplicates can be cleaned up too)
  const existing = {};
  cal.getEvents(dayStart, dayEnd).forEach(ev => {
    if (ev.getTag('krApp') === '1') {
      const pid = ev.getTag('krPlanId');
      if (pid) (existing[pid] = existing[pid] || []).push(ev);
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

    const matches = existing[p.id] || [];
    let ev = matches.shift(); // reuse the first; delete any extra duplicates
    matches.forEach(dup => dup.deleteEvent());
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

  // Remove app events (all of them) whose blocks were deleted in the app
  Object.keys(existing).forEach(pid => {
    if (!incoming[pid]) existing[pid].forEach(ev => ev.deleteEvent());
  });

  return jsonResponse({ success: true, count: plans.length, events: result });
}

// ── Delete one planner block's calendar event ──
// Payload: { action:'calendarDelete', date:'DD/MM/YYYY', planId:'...', eventId:'...' }
// Deletes by exact event ID first (immediate, avoids Calendar's search-index
// lag), then sweeps by tag as a fallback for older/untracked events.
function handleCalendarDelete(data) {
  const cal = CalendarApp.getDefaultCalendar();
  let deleted = 0;

  // 1. Direct delete by event ID — reliable and not subject to search lag
  if (data.eventId) {
    try {
      const ev = cal.getEventById(data.eventId);
      if (ev) { ev.deleteEvent(); deleted++; }
    } catch (e) { /* event already gone */ }
  }

  // 2. Fallback: sweep the day for any app event still tagged with this planId
  const parts = String(data.date).split('/'); // DD/MM/YYYY
  const dd = parseInt(parts[0], 10);
  const mm = parseInt(parts[1], 10);
  const yyyy = parseInt(parts[2], 10);
  if (dd && mm && yyyy) {
    const dayStart = new Date(yyyy, mm - 1, dd, 0, 0, 0);
    const dayEnd   = new Date(yyyy, mm - 1, dd, 23, 59, 59);
    cal.getEvents(dayStart, dayEnd).forEach(ev => {
      if (ev.getTag('krApp') === '1' && ev.getTag('krPlanId') === String(data.planId)) {
        ev.deleteEvent();
        deleted++;
      }
    });
  }

  return jsonResponse({ success: true, deleted });
}

// ── Store the shared task library (chunked into Script Properties) ──
// Payload: { action:'publishLibrary', version:'...', library:'<json string>' }
// Property values cap at ~9KB each, so the blob is split into 8000-char chunks.
function handlePublishLibrary(data) {
  const props = PropertiesService.getScriptProperties();
  const lib = String(data.library || '');
  const version = String(data.version || new Date().toISOString());
  const CHUNK = 8000;

  // Clear any previous chunks first
  const oldCount = parseInt(props.getProperty('kr_lib_count') || '0', 10);
  for (let i = 0; i < oldCount; i++) props.deleteProperty('kr_lib_' + i);

  const count = Math.ceil(lib.length / CHUNK);
  for (let i = 0; i < count; i++) {
    props.setProperty('kr_lib_' + i, lib.substring(i * CHUNK, (i + 1) * CHUNK));
  }
  props.setProperty('kr_lib_count', String(count));
  props.setProperty('kr_lib_version', version);

  // Also write a human-readable mirror tab so the manager can SEE the list.
  // This is one-way (app → sheet) and never read back — the app stays master.
  try { writeLibraryViewTab(lib, version); } catch (e) { /* view tab is best-effort */ }

  return jsonResponse({ success: true, version: version, chunks: count, bytes: lib.length });
}

// ── Render the published library to a readable "Task Library" tab ──
function writeLibraryViewTab(libStr, version) {
  const payload = JSON.parse(libStr);
  const d = (payload && payload.data) || {};
  const directory = d.kr_directory ? JSON.parse(d.kr_directory) : [];
  const subtasks  = d.kr_subtasks  ? JSON.parse(d.kr_subtasks)  : {};
  const projects  = d.kr_projects  ? JSON.parse(d.kr_projects)  : [];

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const TAB = 'Task Library';
  let sheet = ss.getSheetByName(TAB);
  if (!sheet) sheet = ss.insertSheet(TAB);
  sheet.clear();

  const rows = [];
  rows.push(['Kaiser Ridge — Task Library', 'Published: ' + formatVersion(version)]);
  rows.push(['Read-only mirror — create or edit tasks in the app, not here.']);
  rows.push([]);
  rows.push(['Frequency', 'Group', 'Task', 'Equipment', 'Location', 'Checklist']);

  // Consolidate directory rows (one row per equipment) into one row per task
  const byKey = {}; const order = [];
  directory.forEach(r => {
    const key = (r.frequency || '') + '||' + (r.group || '') + '||' + (r.task || '');
    if (!byKey[key]) { byKey[key] = { frequency: r.frequency || '', group: r.group || '', task: r.task || '', location: r.location || '', equip: [] }; order.push(key); }
    if (r.equipment) byKey[key].equip.push(r.equipment);
    if (r.location && !byKey[key].location) byKey[key].location = r.location;
  });
  order.forEach(key => {
    const t = byKey[key];
    const checklist = (subtasks[t.task] || []).join('  •  ');
    rows.push([t.frequency, t.group, t.task, t.equip.join(', '), t.location, checklist]);
  });

  if (projects.length) {
    rows.push([]);
    rows.push(['PROJECTS']);
    rows.push(['Project', 'Steps']);
    projects.forEach(p => {
      const steps = (p.steps || []).map(s => (s.done ? '✓ ' : '') + (s.text || '')).join('  •  ');
      rows.push([p.name || 'Untitled project', steps]);
    });
  }

  // Pad every row to 6 columns so setValues gets a rectangular range
  const padded = rows.map(r => { const row = r.slice(); while (row.length < 6) row.push(''); return row; });
  sheet.getRange(1, 1, padded.length, 6).setValues(padded);
  sheet.getRange(1, 1, 1, 6).setFontWeight('bold');
  sheet.getRange(4, 1, 1, 6).setFontWeight('bold');
  sheet.setFrozenRows(4);
}

function formatVersion(v) {
  const n = parseInt(v, 10);
  if (!isNaN(n) && String(n) === String(v)) return new Date(n).toLocaleString();
  return v;
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
