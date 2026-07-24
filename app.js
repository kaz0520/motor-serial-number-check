'use strict';

const STORAGE_KEY = 'motor-qr-records-v1';

/* ---------- 状態 ---------- */
let stream = null;
let scanning = false;
let rafId = null;
let lastCode = null;
let lastCodeAt = 0;

/* ---------- DOM ---------- */
const video = document.getElementById('video');
const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });

const btnStart = document.getElementById('btn-start');
const btnStop = document.getElementById('btn-stop');
const btnManual = document.getElementById('btn-manual');
const scanStatus = document.getElementById('scan-status');

const form = document.getElementById('entry-form');
const fProduct = document.getElementById('field-product');
const fSerial = document.getElementById('field-serial');
const fNote = document.getElementById('field-note');
const rawBox = document.getElementById('raw-box');
const rawValue = document.getElementById('raw-value');

const listEl = document.getElementById('records-list');
const emptyEl = document.getElementById('records-empty');
const searchInput = document.getElementById('search-input');
const countBadge = document.getElementById('count-badge');
const btnExport = document.getElementById('btn-export');
const toast = document.getElementById('toast');

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

/* ---------- カメラ / スキャン ---------- */
btnStart.addEventListener('click', startCamera);
btnStop.addEventListener('click', stopCamera);
btnManual.addEventListener('click', () => {
  stopCamera();
  rawBox.hidden = true;
  form.reset();
  fProduct.focus();
  setStatus('手入力モード');
});

async function startCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showToast('このブラウザはカメラに対応していません', true);
    return;
  }
  try {
    setStatus('カメラを起動中…');
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
    scanning = true;
    btnStart.hidden = true;
    btnStop.hidden = false;
    setStatus('QRコードを枠内に合わせてください');
    tick();
  } catch (err) {
    console.error(err);
    setStatus('カメラを起動できませんでした');
    showToast('カメラへのアクセスが拒否されました', true);
  }
}

function stopCamera() {
  scanning = false;
  if (rafId) cancelAnimationFrame(rafId);
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
  video.srcObject = null;
  btnStart.hidden = false;
  btnStop.hidden = true;
  setStatus('カメラ停止中');
}

function tick() {
  if (!scanning) return;
  if (video.readyState === video.HAVE_ENOUGH_DATA) {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
    if (code && code.data) handleDecoded(code.data);
  }
  rafId = requestAnimationFrame(tick);
}

function handleDecoded(text) {
  const now = Date.now();
  // 同一コードの連続検出を抑制
  if (text === lastCode && now - lastCodeAt < 2500) return;
  lastCode = text;
  lastCodeAt = now;

  if (navigator.vibrate) navigator.vibrate(60);
  const parsed = parseQR(text);
  fProduct.value = parsed.product;
  fSerial.value = parsed.serial;
  rawValue.textContent = text;
  rawBox.hidden = false;
  setStatus('読み取り成功 — 内容を確認して保存');
  showToast('QRを読み取りました');
  // 続けてスキャンできるよう、フォームまでスクロール
  form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* ---------- QR内容の解析 ---------- */
// 様々な書式に対応: JSON / key:value / 区切り行 / 単一シリアル
function parseQR(text) {
  const raw = text.trim();
  let product = '';
  let serial = '';

  // 1) JSON
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object') {
      product = pick(obj, ['product', 'productName', 'model', 'name', '製品名', '型番', '品名']);
      serial = pick(obj, ['serial', 'serialNo', 'serialNumber', 'sn', 'serial_number', 'シリアル', '製造番号']);
      if (product || serial) return { product, serial };
    }
  } catch (_) { /* JSONでなければ次へ */ }

  // 2) key=value / key:value の行やセミコロン区切り
  const pairs = {};
  raw.split(/[\n;,]+/).forEach((seg) => {
    const m = seg.match(/^\s*([\wぁ-んァ-ヶ一-龠型番製造品名シリアル]+)\s*[:=]\s*(.+?)\s*$/);
    if (m) pairs[m[1].toLowerCase()] = m[2].trim();
  });
  if (Object.keys(pairs).length) {
    product = pick(pairs, ['product', 'productname', 'model', 'name', '製品名', '型番', '品名']);
    serial = pick(pairs, ['serial', 'serialno', 'serialnumber', 'sn', 'serial_number', 'シリアル', '製造番号']);
    if (product || serial) return { product, serial };
  }

  // 3) 複数行 -> 1行目=製品名, 2行目=シリアル
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length >= 2) {
    return { product: lines[0], serial: lines[1] };
  }

  // 4) 単一値 -> シリアルとして扱う
  return { product: '', serial: raw };
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

/* ---------- 保存 ---------- */
form.addEventListener('submit', (e) => {
  e.preventDefault();
  const rec = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    product: fProduct.value.trim(),
    serial: fSerial.value.trim(),
    note: fNote.value.trim(),
    raw: rawValue.textContent || '',
    createdAt: new Date().toISOString(),
  };
  if (!rec.product || !rec.serial) {
    showToast('製品名とシリアルを入力してください', true);
    return;
  }
  const records = loadRecords();
  records.unshift(rec);
  saveRecords(records);
  form.reset();
  rawBox.hidden = true;
  lastCode = null;
  updateCount();
  showToast('記録を保存しました');
  setStatus(scanning ? '次のQRをスキャンできます' : '保存しました');
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
  const records = loadRecords().filter((r) => r.id !== id);
  saveRecords(records);
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
      r.product.toLowerCase().includes(q) ||
      r.serial.toLowerCase().includes(q) ||
      (r.note || '').toLowerCase().includes(q)
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
      <div class="rc-note"></div>
      <div class="rc-meta">
        <span class="rc-time"></span>
        <button class="rc-delete">削除</button>
      </div>`;
    card.querySelector('.rc-product').textContent = r.product;
    card.querySelector('.rc-serial').textContent = 'S/N: ' + r.serial;
    const noteEl = card.querySelector('.rc-note');
    if (r.note) noteEl.textContent = r.note;
    else noteEl.remove();
    card.querySelector('.rc-time').textContent = formatDate(r.createdAt);
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

/* ---------- CSV書出 ---------- */
btnExport.addEventListener('click', () => {
  const records = loadRecords();
  if (!records.length) {
    showToast('書き出す記録がありません', true);
    return;
  }
  const header = ['製品名', 'シリアル番号', 'メモ', '読取内容', '記録日時'];
  const rows = records.map((r) => [
    r.product,
    r.serial,
    r.note || '',
    r.raw || '',
    formatDate(r.createdAt),
  ]);
  const csv =
    '﻿' +
    [header, ...rows]
      .map((row) => row.map(csvCell).join(','))
      .join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'motor_records_' + new Date().toISOString().slice(0, 10) + '.csv';
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

function formatDate(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return iso;
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

/* ---------- Service Worker (オフライン対応) ---------- */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

/* ---------- 初期化 ---------- */
updateCount();
window.addEventListener('beforeunload', stopCamera);
