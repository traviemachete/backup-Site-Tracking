// ====== ปรับค่านี้ให้ตรงกับของคุณ ======
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
// =======================================

// Init map
const map = L.map('map').setView([15.5, 101.0], 7);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap'
}).addTo(map);

// Helper: parse number safely
const num = v => {
  if (v == null) return NaN;
  const cleaned = String(v).trim().replace(/,/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
};

// Marker color by rules
function markerColor(status, warrantyStatus) {
  const st = (status || '').trim();
  const ws = (warrantyStatus || '').trim();
  if (st === 'เปิดใช้งาน' && ws === 'อยู่ในประกัน') return '#00E036'; // green
  if (st === 'เปิดใช้งาน' && ws === 'หมดประกัน') return '#0000E0'; // blue
  if (st === 'ปิดใช้งานชั่วคราว') return '#EB7302'; // orange
  if (st === 'ปิดใช้งาน') return '#EB020A'; // red
  return '#737373'; // fallback gray
}

// Fetch one sheet
async function fetchSheetData(sheetName) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(sheetName)}?key=${API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error('Load sheet failed:', sheetName, res.status, res.statusText);
    return null;
  }
  return res.json();
}

// Render all sheets
async function renderAllSheets() {
  for (const name of SHEET_NAMES) {
    try {
      const data = await fetchSheetData(name);
      if (!data || !data.values || data.values.length < 2) continue;

      const headers = data.values[0].map(h => (h || '').trim());
      const rows    = data.values.slice(1);

      const col = key => headers.indexOf(key);

      const idxLat          = col('Lat');
      const idxLng          = col('Long');
      const idxPlace        = col('พื้นที่');
      const idxType         = col('Type');
      const idxStatus       = col('สถานะ');           // ใช้งาน/ปิดใช้งาน
      const idxWStatus      = col('สถานะประกัน');     // อยู่ในประกัน/หมดประกัน
      const idxContactName  = col('ชื่อผู้ดูแล');
      const idxContactPhone = col('เบอร์โทร/ผู้ดูแล');
      const idxWarrantyDate = col('วันที่หมดระยะประกัน');

      rows.forEach((r) => {
        const lat = num(r[idxLat]);
        const lng = num(r[idxLng]);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

        const place        = r[idxPlace] || '-';
        const type         = r[idxType] || '-';
        const status       = (r[idxStatus]  || '').trim();
        const wStatus      = (r[idxWStatus] || '').trim();
        const contactName  = r[idxContactName]  || '-';
        const contactPhone = r[idxContactPhone] || '-';
        const warrantyDate = r[idxWarrantyDate] || '-';

        const color = markerColor(status, wStatus);
        const marker = L.circleMarker([lat, lng], {
          radius: 7,
          color,
          fillColor: color,
          fillOpacity: 0.85,
          weight: 1
        });

        // ✅ แสดงชื่อ "พื้นที่" เมื่อเอาเมาส์วาง (hover)
        marker.bindTooltip(String(place), {
          sticky: true,          // tooltip จะติดตามเมาส์
          direction: 'top',      // โผล่ด้านบน
          offset: [0, -6],       // ขยับขึ้นเล็กน้อย
          opacity: 0.95
        });

        marker.bindPopup(`
          <b>${place}</b><br/>
          ประเภท: ${type}<br/>
          สถานะ: ${status}<br/>
          สถานะประกัน: ${wStatus}<br/>
          วันที่หมดระยะประกัน: ${warrantyDate}<br/>
          ผู้ดูแล: ${contactName}<br/>
          เบอร์โทร: ${contactPhone}
        `);

        marker.addTo(map);
      });
    } catch (e) {
      console.error('Sheet error:', name, e);
    }
  }
}

renderAllSheets();
