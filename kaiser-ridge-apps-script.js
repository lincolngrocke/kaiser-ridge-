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
    // Current sheet rows (date/time/task only), so the app's "Re-push Missing
    // Entries" recovery can tell which local entries are already in the sheet.
    // Matching is purely by content — there is no Task ID column any more.
    if (p.ids === '1') {
      const idsSs = SpreadsheetApp.getActiveSpreadsheet();
      const idsSheet = idsSs.getSheetByName(SHEET_NAME);
      if (!idsSheet) return jsonResponse({ success: false, error: 'Sheet "' + SHEET_NAME + '" not found' });
      const idsLr = idsSheet.getLastRow();
      const ids = [];
      if (idsLr >= 2) {
        // Use the cells' DISPLAYED text, not raw values — avoids date/time type
        // coercion (e.g. the 1899-epoch timezone offset that mangles read-back times).
        // Columns (no Task ID): date(0) … task(5) … clockIn(8) clockOut(9).
        idsSheet.getRange(2, 1, idsLr - 1, 13).getDisplayValues().forEach(r => {
          ids.push({
            date:     r[0],
            clockIn:  r[8],
            clockOut: r[9],
            task:     r[5],
          });
        });
      }
      return jsonResponse({ success: true, ids: ids });
    }

    // Full timesheet export (read-only), so the app can pull down rows it's
    // missing ("Import from Sheet" recovery). All 13 columns, displayed text.
    if (p.export === '1') {
      const exSs = SpreadsheetApp.getActiveSpreadsheet();
      const exSheet = exSs.getSheetByName(SHEET_NAME);
      if (!exSheet) return jsonResponse({ success: false, error: 'Sheet "' + SHEET_NAME + '" not found' });
      const exLr = exSheet.getLastRow();
      const rows = [];
      if (exLr >= 2) {
        exSheet.getRange(2, 1, exLr - 1, 13).getDisplayValues().forEach(r => {
          rows.push({
            date:          r[0],
            personnel:     r[1],
            location:      r[2],
            frequency:     r[3],
            group:         r[4],
            task:          r[5],
            notes:         r[6],
            durationHours: r[7],
            clockIn:       r[8],
            clockOut:      r[9],
            break:         r[10],
            hyperlink:     r[11],
            equipment:     r[12],
          });
        });
      }
      return jsonResponse({ success: true, rows: rows });
    }

    // Planner assignments — a worker pulls the blocks the manager planned for them.
    if (p.assignments === '1') {
      const who = String(p.who || '').trim();
      const raw = props.getProperty('kr_assign_' + who) || '';
      let assignment = { version: '', plans: [] };
      if (raw) { try { assignment = JSON.parse(raw); } catch (e) {} }
      return jsonResponse({ success: true, assignment: assignment });
    }

    // Pinned notes the manager sent to a person, pulled onto their device.
    if (p.pins === '1') {
      const who = String(p.who || '').trim();
      let pins = [];
      try { pins = JSON.parse(props.getProperty('kr_pins_' + who) || '[]'); } catch (e) {}
      return jsonResponse({ success: true, pins: pins });
    }

    // Return a previously uploaded photo (by Drive file id) as a data URL.
    if (p.photo) {
      try {
        const file = DriveApp.getFileById(String(p.photo));
        const blob = file.getBlob();
        return jsonResponse({ success: true, dataUrl: 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes()) });
      } catch (err) {
        return jsonResponse({ success: false, error: 'Photo not found' });
      }
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
    // Save a captured photo to Drive ("KR App Photos" folder); return its file id.
    if (data.action === 'uploadPhoto') {
      const m = String(data.dataUrl || '').match(/^data:(.+?);base64,(.*)$/);
      if (!m) return jsonResponse({ success: false, error: 'Bad image data' });
      const blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], (data.name || ('kr-photo-' + Date.now() + '.jpg')));
      const file = getKrPhotosFolder().createFile(blob);
      return jsonResponse({ success: true, id: file.getId() });
    }
    // Remove a photo from Drive (when a note/image is deleted)
    if (data.action === 'deletePhoto') {
      try { DriveApp.getFileById(String(data.id)).setTrashed(true); } catch (e) { /* already gone */ }
      return jsonResponse({ success: true });
    }
    // Manager assigns a planned day to a worker — stored per person, pulled by them
    if (data.action === 'assignPlanner') {
      const props = PropertiesService.getScriptProperties();
      const who = String(data.assignee || '').trim();
      const payload = { version: String(data.version || Date.now()), plans: data.plans || [] };
      props.setProperty('kr_assign_' + who, JSON.stringify(payload));
      return jsonResponse({ success: true, version: payload.version, count: payload.plans.length });
    }
    // Manager pins note(s) to a task for a person — appended to their pin list.
    if (data.action === 'pinNote') {
      const props = PropertiesService.getScriptProperties();
      const who = String(data.assignee || '').trim();
      const key = 'kr_pins_' + who;
      let arr = [];
      try { arr = JSON.parse(props.getProperty(key) || '[]'); } catch (e) {}
      (data.pins || []).forEach(pin => arr.push(pin));
      if (arr.length > 200) arr = arr.slice(arr.length - 200);  // keep it bounded
      props.setProperty(key, JSON.stringify(arr));
      return jsonResponse({ success: true, count: (data.pins || []).length });
    }

    const ss    = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAME);

    if (!sheet) {
      return jsonResponse({ success: false, error: 'Sheet "' + SHEET_NAME + '" not found' });
    }

    const row = [
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

    // Pure append-only: no Task ID, no read-modify-write. Each entry is added as
    // a single atomic row at the bottom. The app pushes unsynced entries oldest
    // first, so new rows arrive in chronological order and the sheet stays
    // date/time-sorted without any per-sync sorting or renumbering.
    sheet.appendRow(row);
    return jsonResponse({ success: true });

  } catch (err) {
    return jsonResponse({ success: false, error: err.toString() });
  }
}

// ════════════════════════════════════════════════════════
//  ONE-TIME MIGRATION — run manually, once, from the editor
// ════════════════════════════════════════════════════════
// Removes the old Task ID column (A) and sorts all timesheet rows by date + time
// (oldest at the top, newest at the bottom). Run this ONCE, by hand, while no
// syncing is happening — select oneTimeRemoveIdsAndSort in the editor and press
// Run. It is safe to run again (it won't re-delete a column or duplicate rows),
// but it is NOT wired into doPost: ongoing syncs stay pure append-only. Back up
// the sheet (File → Make a copy) before the first run.
function oneTimeRemoveIdsAndSort() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error('Sheet "' + SHEET_NAME + '" not found');

  // ── 1. Drop the Task ID column (A), if it's still there ──
  // Detect it so a second run is harmless: header mentions "id"/"#", or the
  // first data cell looks like "#0001".
  const headerA    = String(sheet.getRange(1, 1).getDisplayValue()).trim().toLowerCase();
  const firstDataA = sheet.getLastRow() >= 2 ? String(sheet.getRange(2, 1).getDisplayValue()).trim() : '';
  const looksLikeIdCol = /(^|\b)id\b/.test(headerA) || headerA.indexOf('#') >= 0 || /^#?\d+$/.test(firstDataA);
  if (looksLikeIdCol) sheet.deleteColumn(1);

  // ── 2. Sort data rows by date + clock-in, oldest first ──
  // Columns now: date(0) … task(5) … clockIn(8). Sort by DISPLAY text (tolerant
  // of DD/MM/YYYY and am/pm) but write back RAW values to preserve cell types.
  const lastRow = sheet.getLastRow();
  const numCols = sheet.getLastColumn();
  if (lastRow < 3) return; // 0 or 1 data rows — nothing to sort
  const range = sheet.getRange(2, 1, lastRow - 1, numCols);
  const raw   = range.getValues();
  const disp  = range.getDisplayValues();
  const order = raw.map((_, i) => i);
  order.sort((i, j) => migSortKey_(disp[i][0], disp[i][8]) - migSortKey_(disp[j][0], disp[j][8]));
  range.setValues(order.map(i => raw[i]));
}

// Comparable timestamp from a tolerant date + time string; undated rows sink to
// the bottom. (Mirrors the app's _sheetToYMD/_sheetToMin parsing.)
function migSortKey_(dateStr, timeStr) {
  const s = String(dateStr == null ? '' : dateStr).trim();
  let y, mo, d;
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) { d = +m[1]; mo = +m[2]; y = +m[3]; if (y < 100) y += 2000; }
  else {
    m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  }
  if (!y) return Number.MAX_SAFE_INTEGER;
  const tm = String(timeStr == null ? '' : timeStr).trim().toLowerCase()
    .match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?/);
  let min = 0;
  if (tm) {
    let h = +tm[1]; const mi = +tm[2];
    if (tm[3] === 'pm' && h < 12) h += 12;
    if (tm[3] === 'am' && h === 12) h = 0;
    min = h * 60 + mi;
  }
  return new Date(y, mo - 1, d, 0, min, 0).getTime();
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

// Find (or create) the Drive folder where captured note photos are stored.
function getKrPhotosFolder() {
  const NAME = 'KR App Photos';
  const it = DriveApp.getFoldersByName(NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(NAME);
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
