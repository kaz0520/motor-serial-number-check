'use strict';

const STORAGE_KEY = 'motor-stock-records-v2';

/* ---------- 状態 ---------- */
let codeReader = null;
let scanning = false;
let lastCode = null;
let lastCodeAt = 0;

/* ---------- DOM ---------- */
const video = document.getElementById('video');

const btnStart = document.getElementById('btn-start');
const btnStop = document.getElementById('btn-stop');
const scanStatus = document.getElementById('scan-status');

const form = document.getElementById('entry-form');
const fModel = document.getElementById('field-model');
const fSerial = document.getElementById('field-serial');
const fQty = document.getElementById('field-qty');
const fDate = document.getElementById('field-date');
const rawBox = document.getElementById('raw-box');
const rawValue = document.getElementById('raw-value');
const rawFormat = document.getElementById('raw-format');

const listEl = document.getElementById('records-list');
const emptyEl = document.getElementById('records-empty');
const searchInput = document.getElementById('search-input');
const countBadge = document.getElementById('count-badge');
const btnExport = document.getElementById('btn-export');
const toast = document.getElementById('toast');

/* ---------- 初期日付（本日） ---------- */
function todayStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
fDate.value = todayStr();

/* ---------- タブ切替 ---------- */
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    if (btn.dataset.tab === 'records') renderList();
  });
});

/* ---------- ZXing リーダー（QR＋バーコード） ---------- */
function buildReader() {
  const hints = new Map();
  const F = ZXing.BarcodeFormat;
  hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
    F.QR_CODE, F.DATA_MATRIX,
    F.CODE_128, F.CODE_39, F.CODE_93,
    F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E,
    F.ITF, F.CODABAR,
  ]);
  hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
  return new ZXing.BrowserMultiFormatReader(hints, 250);
}

btnStart.addEventListener('click', startCamera);
btnStop.addEventListener('click', stopCamera);

async function startCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showToast('このブラウザはカメラに対応していません', true);
    return;
  }
  try {
    setStatus('カメラを起動中…');
    if (!codeReader) codeReader = buildReader();
    const constraints = { video: { facingMode: { ideal: 'environment' } }, audio: false };
    await codeReader.decodeFromConstraints(constraints, video, (result, err) => {
      if (result) handleDecoded(result.getText(), result.getBarcodeFormat());
      // err はフレーム毎の「未検出」を含むため無視
    });
    scanning = true;
    btnStart.hidden = true;
    btnStop.hidden = false;
    setStatus('QR・バーコードを枠内に合わせてください');
  } catch (err) {
    console.error(err);
    setStatus('カメラを起動できませんでした');
    showToast('カメラへのアクセスが拒否されました', true);
  }
}

function stopCamera() {
  scanning = false;
  if (codeReader) {
    try { codeReader.reset(); } catch (_) {}
  }
  btnStart.hidden = false;
  btnStop.hidden = true;
  setStatus('カメラ停止中');
}

function formatName(fmt) {
  try {
    return ZXing.BarcodeFormat[fmt] || String(fmt);
  } catch (_) {
    return '';
  }
}

function handleDecoded(text, fmt) {
  const now = Date.now();
  if (text === lastCode && now - lastCodeAt < 2500) return;
  lastCode = text;
  lastCodeAt = now;

  if (navigator.vibrate) navigator.vibrate(60);

  const parsed = parseCode(text);
  if (parsed.model) fModel.value = parsed.model;
  if (parsed.serial) fSerial.value = parsed.serial;
  // 構造化されず単一値のみの場合は、空いている方へ補助的に入れる
  if (!parsed.model && !parsed.serial) {
    if (!fSerial.value) fSerial.value = text.trim();
  }

  rawValue.textContent = text;
  rawFormat.textContent = formatName(fmt);
  rawBox.hidden = false;
  setStatus('読み取り成功 — 内容を確認して保存');
  showToast('読み取りました');
  form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* ---------- 読取内容の解析 ---------- */
// JSON / key:value に対応。単一値は呼び出し側でシリアル候補として扱う。
function parseCode(text) {
  const raw = text.trim();
  let model = '';
  let serial = '';

  // 1) JSON
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object') {
      model = pick(obj, ['model', 'product', 'productname', 'type', '型番', '形名', '品番', '品名']);
      serial = pick(obj, ['serial', 'serialno', 'serialnumber', 'sn', '製造番号', 'シリアル']);
      if (model || serial) return { model, serial };
    }
  } catch (_) { /* not json */ }

  // 2) key:value / key=value（改行・; , 区切り）
  const pairs = {};
  raw.split(/[\n;,]+/).forEach((seg) => {
    const m = seg.match(/^\s*([A-Za-z0-9ぁ-んァ-ヶ一-龠\/_]+)\s*[:=]\s*(.+?)\s*$/);
    if (m) pairs[m[1].toLowerCase()] = m[2].trim();
  });
  if (Object.keys(pairs).length) {
    model = pick(pairs, ['model', 'product', 'type', 'm/c', 'mc', '型番', '形名', '品番']);
    serial = pick(pairs, ['serial', 'sn', 's/n', '製造番号', 'シリアル', 'l/n', 'ln']);
    if (model || serial) return { model, serial };
  }

  return { model, serial };
}

function pick(obj, keys) {
  const lower = {};
  Object.keys(obj).forEach((k) => (lower[k.toLowerCase()] = obj[k]));
  for (const key of keys) {
    const v = lower[key.toLowerCase()];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

/* ---------- 「← 読取」ボタン（読取値を任意項目へ流し込む） ---------- */
document.querySelectorAll('.mini-btn[data-fill]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const val = (rawValue.textContent || '').trim();
    if (!val) { showToast('先に読み取ってください', true); return; }
    if (btn.dataset.fill === 'model') fModel.value = val;
    else fSerial.value = val;
  });
});

/* ---------- 保存 ---------- */
form.addEventListener('submit', (e) => {
  e.preventDefault();
  const qty = parseInt(fQty.value, 10);
  const rec = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    date: fDate.value,
    model: fModel.value.trim(),
    serial: fSerial.value.trim(),
    qty: isNaN(qty) || qty < 1 ? 1 : qty,
    raw: rawValue.textContent || '',
    createdAt: new Date().toISOString(),
  };
  if (!rec.model || !rec.serial) {
    showToast('型番とシリアルを入力してください', true);
    return;
  }
  if (!rec.date) {
    showToast('入庫日付を入力してください', true);
    return;
  }
  const records = loadRecords();
  records.unshift(rec);
  saveRecords(records);

  // 次の入力へ（日付は保持、他はクリア）
  fModel.value = '';
  fSerial.value = '';
  fQty.value = '1';
  rawBox.hidden = true;
  lastCode = null;
  updateCount();
  showToast('記録を保存しました');
  setStatus(scanning ? '次のコードをスキャンできます' : '保存しました');
  fModel.focus();
});

/* ---------- ストレージ ---------- */
function loadRecords() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch (_) {
    return [];
  }
}
function saveRecords(records) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}
function deleteRecord(id) {
  saveRecords(loadRecords().filter((r) => r.id !== id));
  updateCount();
  renderList();
  showToast('削除しました');
}

/* ---------- 一覧描画 ---------- */
function renderList() {
  const q = searchInput.value.trim().toLowerCase();
  const records = loadRecords().filter((r) => {
    if (!q) return true;
    return (
      (r.model || '').toLowerCase().includes(q) ||
      (r.serial || '').toLowerCase().includes(q)
    );
  });

  listEl.innerHTML = '';
  emptyEl.hidden = records.length > 0;
  if (!records.length) {
    emptyEl.textContent = q ? '一致する記録がありません。' : 'まだ記録がありません。';
    return;
  }

  records.forEach((r) => {
    const card = document.createElement('div');
    card.className = 'record-card';
    card.innerHTML = `
      <div class="rc-product"></div>
      <div class="rc-serial"></div>
      <div class="rc-sub">
        <span class="rc-qty"></span>
        <span class="rc-date"></span>
      </div>
      <div class="rc-meta">
        <span class="rc-time"></span>
        <button class="rc-delete">削除</button>
      </div>`;
    card.querySelector('.rc-product').textContent = r.model;
    card.querySelector('.rc-serial').textContent = 'S/N: ' + r.serial;
    card.querySelector('.rc-qty').textContent = '入庫数 ' + (r.qty || 1);
    card.querySelector('.rc-date').textContent = '入庫日 ' + (r.date || '');
    card.querySelector('.rc-time').textContent = '登録: ' + formatDateTime(r.createdAt);
    card.querySelector('.rc-delete').addEventListener('click', () => {
      if (confirm('この記録を削除しますか？')) deleteRecord(r.id);
    });
    listEl.appendChild(card);
  });
}

searchInput.addEventListener('input', renderList);

function updateCount() {
  countBadge.textContent = loadRecords().length + ' 件';
}

/* ---------- CSV書出（台帳フォーマット: №/入庫日付/型番/シリアル/入庫数） ---------- */
btnExport.addEventListener('click', () => {
  const records = loadRecords();
  if (!records.length) {
    showToast('書き出す記録がありません', true);
    return;
  }
  // 古い順（登録が古いものを №1 に）
  const ordered = [...records].reverse();
  const header = ['№', '入庫日付', '型番', 'シリアル', '入庫数'];
  const rows = ordered.map((r, i) => [i + 1, r.date || '', r.model, r.serial, r.qty || 1]);
  const csv =
    '﻿' +
    [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = '入庫記録_' + todayStr() + '.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showToast('CSVを書き出しました');
});

function csvCell(v) {
  const s = String(v == null ? '' : v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/* ---------- ユーティリティ ---------- */
function setStatus(msg) {
  scanStatus.textContent = msg;
}
function formatDateTime(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return iso || '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

let toastTimer = null;
function showToast(msg, isError) {
  toast.textContent = msg;
  toast.classList.toggle('error', !!isError);
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
}

/* ---------- Service Worker ---------- */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

/* ---------- 初期化 ---------- */
updateCount();
window.addEventListener('beforeunload', stopCamera);
