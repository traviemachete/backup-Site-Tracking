// ====== script.js ======
const SHEET_ID    = '1OF8QYGVpeiKjVToRvJQfTuKUreZTOcc9yZYxQXlh5vQ';
const SHEET_NAMES = [
  'เอน คอนเนค',
  'อินโนวาเทค โซลูชั่น',
  'พินพอยท์ อินโนเวชั่น',
  'เอสทีอาร์ อินโนเวชั่น',
  'อีสาน-ส่วนกลาง',
  'เขต 7'
];
const API_KEY     = 'AIzaSyBJ99_hsyJJQe4SyntE4SzORk8S0VhNF7I';

// ===== DOM =====
const selType     = document.getElementById('filter-type');
const selYear     = document.getElementById('filter-year');
const selWarranty = document.getElementById('filter-warranty');
const selStatus   = document.getElementById('filter-status');
const btnReset    = document.getElementById('btn-reset');
const matchCount  = document.getElementById('match-count');
const totalCount  = document.getElementById('total-count');

// Summary card DOM
const statActive  = document.getElementById('stat-active');
const statTemp    = document.getElementById('stat-temp');
const statOff     = document.getElementById('stat-off');
const statWIn     = document.getElementById('stat-w-in');
const statWOut    = document.getElementById('stat-w-out');
const typeBody    = document.getElementById('type-body');

// ===== Map =====
const map = L.map('map').setView([15.5, 101.0], 7);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19, attribution: '&copy; OpenStreetMap'
}).addTo(map);

// ===== Helpers =====
const num = v => {
  if (v == null) return NaN;
  const cleaned = String(v).trim().replace(/,/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
};

function markerColor(status, warrantyStatus) {
  const st = (status || '').trim();
  const ws = (warrantyStatus || '').trim();
  if (st === 'เปิดใช้งาน' && ws === 'อยู่ในประกัน') return '#00E036';
  if (st === 'เปิดใช้งาน' && ws === 'หมดประกัน')   return '#0000E0';
  if (st === 'ปิดใช้งานชั่วคราว')                  return '#EB7302';
  if (st === 'ปิดใช้งาน')                           return '#EB020A';
  return '#737373';
}

/** ดึงเฉพาะแถวที่ "ไม่ถูกซ่อน" ด้วย includeGridData */
async function fetchVisibleRows(sheetName) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}`
            + `?includeGridData=true&ranges=${encodeURIComponent(sheetName)}&key=${API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) { console.error('Load sheet failed:', sheetName, res.status, res.statusText); return { headers: [], rows: [] }; }
  const data = await res.json();

  const sheet = (data.sheets || []).find(s => s?.properties?.title === sheetName);
  const grid  = sheet?.data?.[0];
  const rowData = grid?.rowData || [];
  const rowMeta = grid?.rowMetadata || [];

  if (!rowData.length) return { headers: [], rows: [] };

  // header = แถวแรกที่ไม่ถูกซ่อน
  let headerIdx = 0;
  while (headerIdx < rowData.length) {
    const hiddenHeader = !!(rowMeta?.[headerIdx]?.hiddenByUser || rowMeta?.[headerIdx]?.hiddenByFilter);
    if (!hiddenHeader) break;
    headerIdx++;
  }
  const headers = (rowData[headerIdx]?.values || []).map(c => (c?.formattedValue ?? '').toString().trim());

  // rows = เฉพาะแถวที่ไม่ถูกซ่อน และไม่ว่างทั้งแถว
  const rows = [];
  for (let i = headerIdx + 1; i < rowData.length; i++) {
    const hidden = !!(rowMeta?.[i]?.hiddenByUser || rowMeta?.[i]?.hiddenByFilter);
    if (hidden) continue;
    const vals = (rowData[i]?.values || []).map(c => (c?.formattedValue ?? '').toString().trim());
    if (!vals.some(v => v !== '')) continue;
    rows.push(vals);
  }
  return { headers, rows };
}

// ===== State =====
// กลุ่มตามพื้นที่; นับโครงการเป็น "แถว"
const placeGroups = new Map(); // place -> { place, items:[], typeSet, yearSet, warrantySet, statusSet, lat, lng, marker }
const uniqueVals  = { type: new Set(), year: new Set(), warranty: new Set(), status: new Set() };
let totalItems = 0;

// เลือกแถวตัวแทนสำหรับ popup
function pickRepresentative(items) {
  const withCoord = items.find(it => Number.isFinite(it.lat) && Number.isFinite(it.lng));
  return withCoord || items[0];
}

// เติม options ให้ select
function populateSelect(selectEl, valuesSet) {
  const values = [...valuesSet].filter(v => v && v !== '-')
    .sort((a,b) => String(a).localeCompare(String(b), 'th'));
  selectEl.length = 1;
  for (const v of values) {
    const opt = document.createElement('option');
    opt.value = v; opt.textContent = v;
    selectEl.appendChild(opt);
  }
}

// ===== Matching (ระดับ "แถว") =====
function itemMatchesFilter(it) {
  const fType     = (selType.value || '').trim();
  const fYear     = (selYear.value || '').trim();
  const fWarranty = (selWarranty.value || '').trim();
  const fStatus   = (selStatus.value || '').trim();
  return (!fType     || it.type     === fType) &&
         (!fYear     || it.year     === fYear) &&
         (!fWarranty || it.wStatus  === fWarranty) &&
         (!fStatus   || it.status   === fStatus);
}

// เติมตาราง Type
function renderTypeTable(typeCounts) {
  typeBody.innerHTML = '';
  const rows = Object.entries(typeCounts)
    .sort((a,b) => b[1] - a[1]); // มาก -> น้อย
  for (const [t, c] of rows) {
    const tr = document.createElement('tr');
    const td1 = document.createElement('td'); td1.textContent = t || '-';
    const td2 = document.createElement('td'); td2.textContent = String(c);
    tr.appendChild(td1); tr.appendChild(td2);
    typeBody.appendChild(tr);
  }
}

// ฟิลเตอร์ + สรุปสถิติ
function applyFilters() {
  let matchedRows = 0;

  // ตามสถานะใช้งาน
  let active = 0, temp = 0, off = 0;
  // ตามสถานะประกัน
  let wIn = 0, wOut = 0;
  // ตาม Type
  const typeCounts = {};

  for (const group of placeGroups.values()) {
    const matchedItems = group.items.filter(itemMatchesFilter);
    matchedRows += matchedItems.length;

    for (const it of matchedItems) {
      // นับสถานะใช้งาน
      const st = (it.status || '').trim();
      if (st === 'เปิดใช้งาน') active++;
      else if (st === 'ปิดใช้งานชั่วคราว') temp++;
      else if (st === 'ปิดใช้งาน') off++;

      // นับสถานะประกัน
      const ws = (it.wStatus || '').trim();
      if (ws === 'อยู่ในประกัน') wIn++;
      else if (ws === 'หมดประกัน') wOut++;

      // นับ Type
      const t = it.type || '-';
      typeCounts[t] = (typeCounts[t] || 0) + 1;
    }

    // แสดง/ซ่อน marker ของพื้นที่ (มีอย่างน้อย 1 แถวตรงเงื่อนไข)
    const show = matchedItems.length > 0;
    const m = group.marker;
    if (m) {
      const onMap = map.hasLayer(m);
      if (show && !onMap) m.addTo(map);
      else if (!show && onMap) m.removeFrom(map);
    }
  }

  // ตัวเลขหลัก
  matchCount.textContent = String(matchedRows);
  totalCount.textContent = String(totalItems);

  // การ์ดสรุป
  statActive.textContent = String(active);
  statTemp.textContent   = String(temp);
  statOff.textContent    = String(off);
  statWIn.textContent    = String(wIn);
  statWOut.textContent   = String(wOut);

  renderTypeTable(typeCounts);
}

function resetFilters() {
  selType.value = '';
  selYear.value = '';
  selWarranty.value = '';
  selStatus.value = '';
  applyFilters();
}

// ===== Load & Build =====
async function renderAllSheets() {
  for (const name of SHEET_NAMES) {
    try {
      const { headers, rows } = await fetchVisibleRows(name);
      if (!headers.length || !rows.length) continue;

      const col = key => headers.indexOf(key);
      const idxLat          = col('Lat');
      const idxLng          = col('Long');
      const idxPlace        = col('พื้นที่');
      const idxType         = col('Type');
      const idxStatus       = col('สถานะ');
      const idxWStatus      = col('สถานะประกัน');
      const idxBudgetYear   = col('ปีงบประมาณ');
      const idxContactName  = col('ชื่อผู้ดูแล');
      const idxContactPhone = col('เบอร์โทร/ผู้ดูแล');
      const idxWarrantyDate = col('วันที่หมดระยะประกัน');

      rows.forEach(r => {
        const place        = (r[idxPlace] || '-').toString().trim();
        const lat          = num(r[idxLat]);
        const lng          = num(r[idxLng]);
        const type         = (r[idxType] || '-').toString().trim();
        const status       = (r[idxStatus]  || '').toString().trim();
        const wStatus      = (r[idxWStatus] || '').toString().trim();
        const year         = (idxBudgetYear >= 0 ? (r[idxBudgetYear] || '').toString().trim() : '');
        const contactName  = (r[idxContactName]  || '-').toString().trim();
        const contactPhone = (r[idxContactPhone] || '-').toString().trim();
        const warrantyDate = (r[idxWarrantyDate] || '-').toString().trim();

        // เก็บค่าลง dropdown
        if (type)    uniqueVals.type.add(type);
        if (year)    uniqueVals.year.add(year);
        if (wStatus) uniqueVals.warranty.add(wStatus);
        if (status)  uniqueVals.status.add(status);

        // กลุ่มตามพื้นที่
        if (!placeGroups.has(place)) {
          placeGroups.set(place, {
            place,
            items: [],
            typeSet: new Set(),
            yearSet: new Set(),
            warrantySet: new Set(),
            statusSet: new Set(),
            lat: undefined,
            lng: undefined,
            marker: null
          });
        }
        const g = placeGroups.get(place);
        const item = { place, type, status, wStatus, year, lat, lng, contactName, contactPhone, warrantyDate };
        g.items.push(item);
        totalItems += 1;

        g.typeSet.add(type);
        if (year)    g.yearSet.add(year);
        if (wStatus) g.warrantySet.add(wStatus);
        if (status)  g.statusSet.add(status);

        // พิกัดตัวแทน
        if ((!Number.isFinite(g.lat) || !Number.isFinite(g.lng)) &&
            Number.isFinite(lat) && Number.isFinite(lng)) {
          g.lat = lat; g.lng = lng;
        }
      });
    } catch(e) {
      console.error('Sheet error:', name, e);
    }
  }

  // สร้าง marker ต่อพื้นที่
  for (const group of placeGroups.values()) {
    if (Number.isFinite(group.lat) && Number.isFinite(group.lng)) {
      const rep = pickRepresentative(group.items);
      const color = markerColor(rep.status, rep.wStatus);
      const m = L.circleMarker([group.lat, group.lng], {
        radius: 7, color, fillColor: color, fillOpacity: 0.85, weight: 1
      });

      m.bindTooltip(String(group.place), {
        sticky: true, direction: 'top', offset: [0, -6], opacity: 0.95
      });

      m.bindPopup(`
        <b>${group.place}</b><br/>
        Type: ${rep.type}<br/>
        ปีงบประมาณ: ${rep.year || '-'}<br/>
        สถานะ: ${rep.status}<br/>
        สถานะประกัน: ${rep.wStatus}<br/>
        วันที่หมดระยะประกัน: ${rep.warrantyDate}<br/>
        ผู้ดูแล: ${rep.contactName}<br/>
        เบอร์โทร: ${rep.contactPhone}
      `);

      m.addTo(map);
      group.marker = m;
    }
  }

  // เติมตัวเลือก
  populateSelect(selType, uniqueVals.type);
  populateSelect(selYear, uniqueVals.year);
  populateSelect(selWarranty, uniqueVals.warranty);
  populateSelect(selStatus, uniqueVals.status);

  // ตัวเลขเริ่มต้น
  totalCount.textContent = String(totalItems);
  applyFilters();
}

// Events
selType.addEventListener('change', applyFilters);
selYear.addEventListener('change', applyFilters);
selWarranty.addEventListener('change', applyFilters);
selStatus.addEventListener('change', applyFilters);
btnReset.addEventListener('click', resetFilters);

// Run
renderAllSheets();
