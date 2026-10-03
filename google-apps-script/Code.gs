/**
 * WorthyOps Sheet API (Google Apps Script, bound to the tracker sheet)
 *
 * Lets the WorthyOps dashboard read the Leads / Content / Daily Activity /
 * Team tabs and write changes back. Deploy as:
 *   Deploy → New deployment → Web app → Execute as: Me → Who has access: Anyone
 * The web app URL is long and unguessable - treat it like a password.
 * Optional extra lock: set API_KEY below to any random string and enter the
 * same key in the dashboard (Admin → Settings → Google Sheet sync).
 */

const API_KEY = ''; // optional

// The tracker spreadsheet (the long ID in its URL). Lets this run as a
// standalone script as well as one bound to the sheet.
const SPREADSHEET_ID = '1MIDNPRM4P_XCEsvkSWIEoAXwT-9GQOjW2ZZ9qHj4AGU';

let ssCache_ = null;
let tzCache_ = null;
function ss_() {
  if (!ssCache_) ssCache_ = SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : SpreadsheetApp.getActive();
  return ssCache_;
}

const SHEETS = { leads: 'Leads', content: 'Content', daily: 'Daily Activity', team: 'Team' };

// Columns the API may write. Formula columns (teal headers) are never touched.
const WRITABLE = {
  leads: ['Lead ID', 'Date Added', 'Name', 'Business', 'Handle / Link', 'Email', 'Phone', 'Lead Type',
    'Content / Ad', 'Platform', 'Niche', 'Owner', 'Stage', 'Outreach Message', 'Follow-ups',
    'Last Contact', 'Next Follow-up', 'Deal Value', 'Amount Paid', 'Notes'],
  content: ['Content ID', 'Title / Hook', 'Channel', 'Platform', 'Format', 'Published', 'Link',
    'Views / Reach', 'Ad Spend'],
  daily: ['Date', 'Team Member', 'Outreach Sent', 'Follow-ups Sent', 'Replies Received', 'Calls Booked',
    'Calls Attended', 'Deals Converted', 'Clients Paid', 'Revenue Closed', 'Cash Collected', 'Notes']
};
const ID_COL = { leads: 'Lead ID', content: 'Content ID' };
// A row "exists" when this column has a value
const KEY_COL = { leads: 'Name', content: 'Title / Hook', daily: 'Date', team: 'Name' };
const DATE_COLS = ['Date Added', 'Last Contact', 'Next Follow-up', 'Published', 'Date'];

// ---------------------------------------------------------------------------
function doGet(e) {
  if (!authorized_(e.parameter.key)) return json_({ ok: false, error: 'unauthorized' });
  try {
    return json_({ ok: true, data: readAll_(), serverTime: new Date().toISOString() });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'bad json' }); }
  if (!authorized_(body.key)) return json_({ ok: false, error: 'unauthorized' });
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const results = (body.ops || []).map(function (op) {
      try {
        if (op.action === 'upsert') return upsert_(op.kind, op.record);
        if (op.action === 'delete') return remove_(op.kind, op.record);
        return { ok: false, error: 'unknown action' };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    });
    return json_({ ok: true, results: results });
  } finally {
    lock.releaseLock();
  }
}

// Run this once from the editor to grant access (Run → testRead).
function testRead() {
  const data = readAll_();
  Logger.log('Leads: %s, Content: %s, Daily: %s, Team: %s', data.leads.length, data.content.length, data.daily.length, data.team.length);
}

// ---------------------------------------------------------------------------
function authorized_(key) {
  return !API_KEY || key === API_KEY;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function sheet_(kind) {
  const sh = ss_().getSheetByName(SHEETS[kind]);
  if (!sh) throw new Error('Missing tab: ' + SHEETS[kind]);
  return sh;
}

function tz_() {
  if (!tzCache_) tzCache_ = String(ss_().getSpreadsheetTimeZone() || Session.getScriptTimeZone() || 'Asia/Kolkata');
  return tzCache_;
}

// Sheet values can be Date objects from another realm, so instanceof Date is unreliable
function isDate_(v) {
  return Object.prototype.toString.call(v) === '[object Date]';
}

function cellOut_(header, v) {
  if (isDate_(v)) return Utilities.formatDate(v, tz_(), 'yyyy-MM-dd');
  return v;
}

function cellIn_(header, v) {
  if (v === null || v === undefined) return '';
  if (DATE_COLS.indexOf(header) >= 0 && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) {
    const p = v.slice(0, 10).split('-');
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }
  return v;
}

/** Read one tab as an array of {header: value}. Assigns IDs to rows missing one. */
function readKind_(kind) {
  const sh = sheet_(kind);
  const values = sh.getDataRange().getValues();
  if (!values.length) return [];
  const headers = values[0].map(String);
  const keyIdx = headers.indexOf(KEY_COL[kind]);
  const idHeader = ID_COL[kind];
  const idIdx = idHeader ? headers.indexOf(idHeader) : -1;
  const out = [];
  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    if (keyIdx < 0 || row[keyIdx] === '' || row[keyIdx] === null) continue;
    if (idIdx >= 0 && !row[idIdx]) {
      row[idIdx] = (kind === 'leads' ? 'L-' : 'C-') + Utilities.getUuid().slice(0, 8);
      sh.getRange(r + 1, idIdx + 1).setValue(row[idIdx]);
    }
    const obj = { _row: r + 1 };
    headers.forEach(function (h, i) { if (h) obj[h] = cellOut_(h, row[i]); });
    out.push(obj);
  }
  return out;
}

function readAll_() {
  return {
    leads: readKind_('leads'),
    content: readKind_('content'),
    daily: readKind_('daily'),
    team: readKind_('team')
  };
}

/** Find the sheet row (1-based) for a record, or -1. */
function findRow_(kind, sh, headers, values, record) {
  if (ID_COL[kind]) {
    const idIdx = headers.indexOf(ID_COL[kind]);
    const id = record[ID_COL[kind]];
    if (!id) return -1;
    for (let r = 1; r < values.length; r++) if (String(values[r][idIdx]) === String(id)) return r + 1;
    return -1;
  }
  // Daily Activity: one row per Date + Team Member
  const dIdx = headers.indexOf('Date');
  const mIdx = headers.indexOf('Team Member');
  for (let r = 1; r < values.length; r++) {
    const d = isDate_(values[r][dIdx]) ? Utilities.formatDate(values[r][dIdx], tz_(), 'yyyy-MM-dd') : String(values[r][dIdx]);
    if (d === String(record['Date']).slice(0, 10) && String(values[r][mIdx]) === String(record['Team Member'])) return r + 1;
  }
  return -1;
}

/** First row whose key column is empty (rows are pre-formatted, so getLastRow is unreliable). */
function firstEmptyRow_(headers, values, kind) {
  const keyIdx = headers.indexOf(KEY_COL[kind]);
  for (let r = 1; r < values.length; r++) {
    if (values[r][keyIdx] === '' || values[r][keyIdx] === null) return r + 1;
  }
  return values.length + 1;
}

function upsert_(kind, record) {
  if (!WRITABLE[kind]) throw new Error('Kind not writable: ' + kind);
  const sh = sheet_(kind);
  const values = sh.getDataRange().getValues();
  const headers = values[0].map(String);
  let row = findRow_(kind, sh, headers, values, record);
  const created = row < 0;
  if (created) row = firstEmptyRow_(headers, values, kind);
  WRITABLE[kind].forEach(function (h) {
    if (!(h in record)) return;
    const c = headers.indexOf(h);
    if (c < 0) return;
    sh.getRange(row, c + 1).setValue(cellIn_(h, record[h]));
  });
  return { ok: true, row: row, created: created };
}

function remove_(kind, record) {
  const sh = sheet_(kind);
  const values = sh.getDataRange().getValues();
  const headers = values[0].map(String);
  const row = findRow_(kind, sh, headers, values, record);
  if (row < 0) return { ok: true, missing: true };
  sh.deleteRow(row);
  return { ok: true, row: row };
}
