// ==================== Configuración ====================
const STORAGE_KEY = 'ovitrampas_puntos';
const API_URL = 'https://script.google.com/macros/s/AKfycbwGvRt2BOSVF94KooPlBmE0q2NUacsMZmmPz8QoERZE2NxOIOy6n_fMLrt6cYqPGSGGlw/exec';
const API_KEY = '258233KAR';

let mapa, capaCalor, capaMarcadores;
let puntos = [];
let filtrados = [];

// ==================== Utilidades SE ====================
function calcularSE(fecha) {
  const d = new Date(fecha + 'T12:00:00');
  const anio = d.getFullYear();
  const ene1 = new Date(anio, 0, 1);
  const ds = ene1.getDay();
  let pd = new Date(ene1);
  if (ds === 0) pd = ene1;
  else if (ds <= 4) pd.setDate(ene1.getDate() - ds);
  else pd.setDate(ene1.getDate() + (7 - ds));
  const dd = Math.floor((d - pd) / (1000 * 60 * 60 * 24));
  return { se: Math.floor(dd / 7) + 1, anio };
}
function getSEActual() { return calcularSE(new Date().toISOString().slice(0, 10)); }
function getUltimasSE(n) {
  const a = getSEActual();
  const lista = [];
  let se = a.se, anio = a.anio;
  for (let i = 0; i < n; i++) {
    lista.push({ se, anio, label: `SE ${String(se).padStart(2, '0')} - ${anio}` });
    se--; if (se < 1) { anio--; se = 52; }
  }
  return lista;
}
function formatSE(se, anio) {
  if (!se || !anio) return 'Sin SE';
  return `SE ${String(se).padStart(2, '0')} - ${anio}`;
}

// ==================== JSONP ====================
function jsonpGet(url) {
  return new Promise((resolve, reject) => {
    const callbackName = 'jsonp_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
    const script = document.createElement('script');
    const timeout = setTimeout(() => { cleanup(); reject(new Error('Timeout')); }, 10000);
    function cleanup() {
      clearTimeout(timeout);
      delete window[callbackName];
      if (script.parentNode) script.parentNode.removeChild(script);
    }
    window[callbackName] = (data) => { cleanup(); resolve(data); };
    script.onerror = () => { cleanup(); reject(new Error('Error JSONP')); };
    script.src = `${url}${url.includes('?') ? '&' : '?'}callback=${callbackName}`;
    document.body.appendChild(script);
  });
}

async function sincronizar() {
  try {
    const json = await jsonpGet(`${API_URL}?action=listar`);
    if (json.ok) {
      puntos = json.data || [];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(puntos));
    } else throw new Error(json.error);
  } catch (err) {
    console.warn('Sin conexión:', err);
    puntos = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  }
}

// ==================== Filtro SE ====================
function inicializarFiltroSE() {
  const sel = document.getElementById('rep-se');
  if (!sel) return;
  sel.innerHTML = '';

  const a = getSEActual();
  const o1 = document.createElement('option');
  o1.value = 'actual';
  o1.textContent = `🟢 SE actual (${formatSE(a.se, a.anio)})`;
  sel.appendChild(o1);

  const o2 = document.createElement('option');
  o2.value = 'ultimas4';
  o2.textContent = '📅 Últimas 4 SE';
  sel.appendChild(o2);

  const o3 = document.createElement('option');
  o3.value = 'todas';
  o3.textContent = '📊 Todas las SE';
  sel.appendChild(o3);

  const sep = document.createElement('option');
  sep.disabled = true;
  sep.textContent = '──────────';
  sel.appendChild(sep);

  getUltimasSE(26).forEach(item => {
    const o = document.createElement('option');
    o.value = `${item.se}|${item.anio}`;
    o.textContent = item.label;
    sel.appendChild(o);
  });

  sel.value = 'actual';
}

function pasaFiltroSE(p) {
  const sel = document.getElementById('rep-se')?.value || 'actual';
  const actual = getSEActual();
  let pSe = p.se, pAnio = p.anio;
  if (!pSe || !pAnio) {
    if (p.fecha) { const c = calcularSE(p.fecha); pSe = c.se; pAnio = c.anio; }
    else return false;
  }
  if (sel === 'actual') return pSe === actual.se && pAnio === actual.anio;
  if (sel === 'ultimas4') return getUltimasSE(4).some(u => u.se === pSe && u.anio === pAnio);
  if (sel === 'todas') return true;
  const [s, a] = sel.split('|').map(Number);
  return pSe === s && pAnio === a;
}

// ==================== Init ====================
async function init() {
  await sincronizar();

  mapa = L.map('map-reporte', { preferCanvas: true }).setView([-34.6037, -58.3816], 6);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© OpenStreetMap'
  }).addTo(mapa);

  capaCalor = L.heatLayer([], {
    radius: 35, blur: 25, maxZoom: 15,
    gradient: { 0.0:'#3288bd',0.3:'#66c2a5',0.5:'#fee08b',0.7:'#f46d43',1.0:'#d53e4f' }
  }).addTo(mapa);

  capaMarcadores = L.layerGroup().addTo(mapa);

  inicializarFiltroSE();

  setTimeout(() => {
    mapa.invalidateSize();
    renderizarMapa();
    ajustarVista();
  }, 200);
  setTimeout(() => mapa.invalidateSize(), 800);

  asignarEventos();
}

function aplicarFiltros() {
  const desde = document.getElementById('rep-desde').value;
  const hasta = document.getElementById('rep-hasta').value;
  const casosMin = parseInt(document.getElementById('rep-casos').value, 10);
  const texto = document.getElementById('rep-texto').value.toLowerCase().trim();
  const riesgo = document.getElementById('rep-riesgo').value;

  filtrados = puntos.filter(p => {
    if (!pasaFiltroSE(p)) return false;
    if (desde && p.fecha && p.fecha < desde) return false;
    if (hasta && p.fecha && p.fecha > hasta) return false;
    if (!isNaN(casosMin) && (p.casos || 0) < casosMin) return false;
    if (texto && !p.nombre.toLowerCase().includes(texto)) return false;
    if (riesgo === 'alto' && p.casos < 5) return false;
    if (riesgo === 'medio' && (p.casos < 3 || p.casos >= 5)) return false;
    if (riesgo === 'bajo' && p.casos >= 3) return false;
    return true;
  });

  document.getElementById('rep-contador').textContent =
    `${filtrados.length} de ${puntos.length} puntos seleccionados`;
}

function renderizarMapa() {
  aplicarFiltros();
  capaMarcadores.clearLayers();
  const heatData = [];

  filtrados.forEach(p => {
    const intensidad = Math.min(1, (p.casos || 1) / 10);
    heatData.push([p.lat, p.lng, Math.max(0.3, intensidad)]);

    const color = p.casos >= 5 ? '#d53e4f' : p.casos >= 3 ? '#f46d43' : '#66c2a5';
    const icono = L.divIcon({
      className: '',
      html: `<div style="background:${color};width:18px;height:18px;border-radius:50%;border:3px solid white;box-shadow:0 0 6px rgba(0,0,0,.5);"></div>`,
      iconSize: [18, 18], iconAnchor: [9, 9]
    });

    L.marker([p.lat, p.lng], { icon: icono })
      .bindPopup(`<strong>${escapeHtml(p.nombre)}</strong><br>📅 ${formatSE(p.se, p.anio)}<br>🦟 Casos: <b>${p.casos}</b>`)
      .addTo(capaMarcadores);
  });

  capaCalor.setLatLngs(heatData);
}

function ajustarVista() {
  if (filtrados.length === 0) return;
  const bounds = L.latLngBounds(filtrados.map(p => [p.lat, p.lng]));
  mapa.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 });
}

function asignarEventos() {
  ['rep-desde','rep-hasta','rep-casos','rep-texto','rep-riesgo','rep-se'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', () => { renderizarMapa(); ajustarVista(); });
    el.addEventListener('change', () => { renderizarMapa(); ajustarVista(); });
  });

  document.getElementById('btn-limpiar-filtros-rep').addEventListener('click', () => {
    ['rep-desde','rep-hasta','rep-casos','rep-texto','rep-riesgo'].forEach(id => {
      document.getElementById(id).value = '';
    });
    document.getElementById('rep-se').value = 'actual';
    renderizarMapa();
    ajustarVista();
  });

  document.getElementById('rep-incluir-heat').addEventListener('change', e => {
    e.target.checked ? mapa.addLayer(capaCalor) : mapa.removeLayer(capaCalor);
  });

  document.getElementById('btn-preview').addEventListener('click', () => {
    alert('✅ La previsualización muestra el mapa actual. Al hacer clic en "Generar PDF" se descargará el archivo completo.');
  });

  document.getElementById('btn-generar-pdf').addEventListener('click', generarPDF);
}

async function capturarMapa() {
  const mapEl = document.getElementById('map-reporte');
  mapa.invalidateSize();
  await new Promise(r => setTimeout(r, 500));

  const canvas = await html2canvas(mapEl, {
    useCORS: true, allowTaint: false,
    backgroundColor: '#e8eef2', scale: 2, logging: false,
    width: mapEl.offsetWidth, height: mapEl.offsetHeight,
    onclone: (doc) => {
      doc.querySelectorAll('.leaflet-control-zoom, .leaflet-control-attribution')
        .forEach(el => el.style.display = 'none');
    }
  });
  return canvas.toDataURL('image/png');
}

function calcularResumen() {
  const total = filtrados.length;
  const casosTotales = filtrados.reduce((s, p) => s + (p.casos || 0), 0);
  const alto = filtrados.filter(p => p.casos >= 5).length;
  const medio = filtrados.filter(p => p.casos >= 3 && p.casos < 5).length;
  const bajo = filtrados.filter(p => p.casos < 3).length;
  const promedio = total > 0 ? (casosTotales / total).toFixed(2) : 0;
  return { total, casosTotales, alto, medio, bajo, promedio };
}

async function generarPDF() {
  if (filtrados.length === 0) {
    alert('⚠️ No hay puntos para incluir en el reporte.');
    return;
  }

  const btn = document.getElementById('btn-generar-pdf');
  const textoOriginal = btn.textContent;
  btn.textContent = '⏳ Generando PDF...';
  btn.disabled = true;

  try {
    const { jsPDF } = window.jspdf;
    const orientacion = document.getElementById('rep-orientacion').value;
    const doc = new jsPDF({ orientation: orientacion, unit: 'mm', format: 'a4' });

    const ancho = doc.internal.pageSize.getWidth();
    const alto = doc.internal.pageSize.getHeight();
    const margen = 15;
    let y = margen;

    doc.setFillColor(27, 73, 101);
    doc.rect(0, 0, ancho, 22, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    const titulo = document.getElementById('rep-titulo').value || 'Reporte de Ovitrampas';
    doc.text(titulo, margen, 14);

    y = 30;
    doc.setTextColor(50, 50, 50);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');

    const institucion = document.getElementById('rep-institucion').value.trim();
    const responsable = document.getElementById('rep-responsable').value.trim();
    const fechaGen = new Date().toLocaleString('es-AR', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });

    if (institucion) { doc.text(`Institución: ${institucion}`, margen, y); y += 5; }
    if (responsable) { doc.text(`Responsable: ${responsable}`, margen, y); y += 5; }
    doc.text(`Fecha de generación: ${fechaGen}`, margen, y); y += 5;
    doc.text(`Total de puntos: ${filtrados.length}`, margen, y); y += 8;

    const filtrosAplicados = [];
    const seFiltro = document.getElementById('rep-se').value;
    if (seFiltro === 'actual') filtrosAplicados.push(`SE actual (${formatSE(getSEActual().se, getSEActual().anio)})`);
    else if (seFiltro === 'ultimas4') filtrosAplicados.push('Últimas 4 SE');
    else if (seFiltro === 'todas') filtrosAplicados.push
