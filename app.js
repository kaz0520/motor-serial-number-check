'use strict';

const STORAGE_KEY = 'motor-stock-records-v2';

/* ---------- 状態 ---------- */
let codeReader = null;
let imgReader = null;
let scanning = false;
let lastCode = null;
let lastCodeAt = 0;

/* ---------- DOM ---------- */
const video = document.getElementById('video');

const btnStart = document.getElementById('btn-start');
const btnStop = document.getElementById('btn-stop');
const photoInput = document.getElementById('photo-input');
const scanStatus = document.getElementById('scan-status');

const form = document.getElementById('entry-form');
const selModel = document.getElementById('field-model');
const modelOther = document.getElementById('field-model-other');
const modelOtherWrap = document.getElementById('model-other-wrap');
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

/* ---------- 型番リスト（プルダウン） ---------- */
// リストを増やす時はここに型番を追加するだけ（自動でシリーズ分けされます）
const MODELS = [
  'EF-20YSD2-V', 'EF-25ASD2-V', 'EF-30BSD2-V', 'EF-30BTD2-V', 'EF-40DTC2-V', 'EF-50DTC2-V',
  'EG-40CSB06', 'EG-40CTB07', 'EG-50DTC2-V', 'EG-50ETB10', 'EG-60DTC2-V', 'EG-60FTB19', 'EG-60FTC-V',
  'EJ-105HTB11-SW35',
  'EWF-20YSA2', 'EWF-30BSA2',
  'KG-75GTB03', 'KG-90HT03',
  'KH-75FT03', 'KH-80JTF01', 'KH-90GT2',
];
const OTHER = '__other__';

function populateModelSelect() {
  selModel.innerHTML = '';
  const ph = new Option('型番を選択…', '');
  ph.disabled = true;
  ph.selected = true;
  selModel.add(ph);

  const groups = {};
  const order = [];
  MODELS.forEach((m) => {
    const g = m.split('-')[0];
    if (!groups[g]) { groups[g] = []; order.push(g); }
    groups[g].push(m);
  });
  order.forEach((g) => {
    const og = document.createElement('optgroup');
    og.label = g + ' シリーズ';
    groups[g].forEach((m) => og.appendChild(new Option(m, m)));
    selModel.appendChild(og);
  });

  selModel.add(new Option('その他（手入力）', OTHER));
}
populateModelSelect();

selModel.addEventListener('change', () => {
  const isOther = selModel.value === OTHER;
  modelOtherWrap.hidden = !isOther;
  if (isOther) modelOther.focus();
});

// 型番の値を取得（その他の時は手入力欄）
function getModelValue() {
  if (selModel.value === OTHER) return modelOther.value.trim();
  return selModel.value;
}
// 値をプルダウンに反映（一致すれば選択、無ければ「その他」に入れる）
function setModelValue(value) {
  const v = (value || '').trim();
  if (!v) return;
  const found = Array.prototype.some.call(selModel.options, (o) => o.value === v);
  if (found) {
    selModel.value = v;
    modelOtherWrap.hidden = true;
  } else {
    selModel.value = OTHER;
    modelOtherWrap.hidden = false;
    modelOther.value = v;
  }
}
// 選択をリセット
function resetModelSelect() {
  selModel.selectedIndex = 0;
  modelOtherWrap.hidden = true;
  modelOther.value = '';
}

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
    // 高解像度を要求（細かいQRの読取精度を上げる）
    const constraints = {
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: false,
    };
    await codeReader.decodeFromConstraints(constraints, video, (result, err) => {
      if (result) handleDecoded(result.getText(), result.getBarcodeFormat());
      // err はフレーム毎の「未検出」を含むため無視
    });
    scanning = true;
    btnStart.hidden = true;
    btnStop.hidden = false;
    setStatus('QR・バーコードを枠内に合わせてください');
    applyContinuousFocus();
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

// 連続オートフォーカスを要求（対応端末のみ・非対応でも無害）
function applyContinuousFocus() {
  setTimeout(() => {
    try {
      const stream = video.srcObject;
      const track = stream && stream.getVideoTracks && stream.getVideoTracks()[0];
      if (track && track.applyConstraints) {
        track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
      }
    } catch (_) { /* 非対応端末は無視 */ }
  }, 700);
}

/* ---------- 写真から読み取る（ライブ読取の代替・高精度） ---------- */
photoInput.addEventListener('change', async () => {
  const file = photoInput.files && photoInput.files[0];
  if (!file) return;
  const url = URL.createObjectURL(file);
  try {
    setStatus('写真を解析中…');
    if (!imgReader) imgReader = buildReader();
    const result = await imgReader.decodeFromImageUrl(url);
    handleDecoded(result.getText(), result.getBarcodeFormat());
  } catch (e) {
    setStatus('写真からコードを検出できませんでした');
    showToast('写真から読み取れませんでした。QRを画面いっぱいに大きく写して撮り直してください', true);
  } finally {
    URL.revokeObjectURL(url);
    photoInput.value = '';
  }
});

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
  if (parsed.model) setModelValue(parsed.model);
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

  // 3) 三菱製品QR（品目コードが繰り返す固定形式）からシリアルを抽出
  const mit = parseMitsubishi(raw);
  if (mit && mit.serial) return { model: '', serial: mit.serial };

  return { model, serial };
}

// 三菱製QR: 「(先頭)コード␣シリアル+コード␣日付+コード+英字」の並びを利用。
// 品目コードの値に依存せず、"コードが繰り返す"構造からシリアルを取り出す。
// 例: "3096H94  260312002096H94  20260313075JP096H94A" -> "260312002A"
function parseMitsubishi(raw) {
  const chunks = raw.trim().split(/\s+/).filter(Boolean);
  if (chunks.length < 3) return null;
  // 先頭2チャンクの共通サフィックス = 品目コード
  const code = commonSuffix(chunks[0], chunks[1]);
  if (code.length < 4) return null;
  // 別チャンクにも同じコードが含まれることを確認（形式の裏取り）
  if (!chunks.slice(2).some((c) => c.includes(code))) return null;
  // シリアル基幹部 = 2番目チャンクからコードを除いた部分（数字列）
  const base = chunks[1].slice(0, chunks[1].length - code.length);
  if (!/^\d{4,}$/.test(base)) return null;
  // サフィックス = コードの直後に続く英字（例: 末尾の "A"）
  let suffix = '';
  for (const c of chunks) {
    const idx = c.lastIndexOf(code);
    if (idx >= 0) {
      const tail = c.slice(idx + code.length);
      if (/^[A-Za-z]{1,3}$/.test(tail)) { suffix = tail; break; }
    }
  }
  return { serial: base + suffix };
}

// 2つの文字列の末尾から一致する共通部分を返す
function commonSuffix(a, b) {
  let i = a.length - 1;
  let j = b.length - 1;
  let s = '';
  while (i >= 0 && j >= 0 && a[i] === b[j]) {
    s = a[i] + s;
    i--;
    j--;
  }
  return s;
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
    if (btn.dataset.fill === 'serial') fSerial.value = val;
  });
});

/* ---------- 保存 ---------- */
form.addEventListener('submit', (e) => {
  e.preventDefault();
  const qty = parseInt(fQty.value, 10);
  const rec = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    date: fDate.value,
    model: getModelValue(),
    serial: fSerial.value.trim(),
    qty: isNaN(qty) || qty < 1 ? 1 : qty,
    raw: rawValue.textContent || '',
    createdAt: new Date().toISOString(),
  };
  if (!rec.model) {
    showToast('型番を選択してください', true);
    return;
  }
  if (!rec.date) {
    showToast('入庫日付を入力してください', true);
    return;
  }
  // シリアルは任意（SW系など印字のみの箱は空欄で保存可）
  const records = loadRecords();
  records.unshift(rec);
  saveRecords(records);

  // 次の入力へ（日付は保持、他はクリア）
  resetModelSelect();
  fSerial.value = '';
  fQty.value = '1';
  rawBox.hidden = true;
  lastCode = null;
  updateCount();
  showToast('記録を保存しました');
  setStatus(scanning ? '次のコードをスキャンできます' : '保存しました');
  selModel.focus();
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
    card.querySelector('.rc-serial').textContent = r.serial ? 'S/N: ' + r.serial : 'S/N: （なし）';
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
