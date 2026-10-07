// ==================== Configuración ====================
const STORAGE_KEY = 'ovitrampas_puntos';
const API_URL = 'https://script.google.com/macros/s/AKfycbwGvRt2BOSVF94KooPlBmE0q2NUacsMZmmPz8QoERZE2NxOIOy6n_fMLrt6cYqPGSGGlw/exec';
const API_KEY = '258233KAR';

let puntos = [];
let filtrados = [];

// ==================== Utilidades SE ====================
function calcularSE(fecha) {
  const d = new Date(fecha + 'T12:00:00');
  const anio = d.getFullYear();
  const ene1 = new Date(anio, 0, 1);
  const diaSemanaEne1 = ene1.getDay();
  let primerDomingo = new Date(ene1);
  if (diaSemanaEne1 === 0) primerDomingo = ene1;
  else if (diaSemanaEne1 <= 4) primerDomingo.setDate(ene1.getDate() - diaSemanaEne1);
  else primerDomingo.setDate(ene1.getDate() + (7 - diaSemanaEne1));
  const diffDias = Math.floor((d - primerDomingo) / (1000 * 60 * 60 * 24));
  return { se: Math.floor(diffDias / 7) + 1, anio };
}

function getSEActual() {
  return calcularSE(new Date().toISOString().slice(0, 10));
}

function getUltimasSE(n) {
  const actual = getSEActual();
  const lista = [];
  let se = actual.se, anio = actual.anio;
  for (let i = 0; i < n; i++) {
    lista.push({ se, anio, label: `SE ${String(se).padStart(2, '0')} - ${anio}` });
    se--;
    if (se < 1) { anio--; se = 52; }
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
    const timeout = setTimeout(() => { cleanup(); reject(new Error('Timeout JSONP')); }, 10000);
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
    } else {
      throw new Error(json.error);
    }
  } catch (err) {
    console.warn('Sin conexión, usando datos locales:', err);
    puntos = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  }
}

// ==================== Filtro SE ====================
function inicializarFiltroSE() {
  const sel = document.getElementById('f-se');
  if (!sel) return;
  sel.innerHTML = '';

  const actual = getSEActual();
  const o1 = document.createElement('option');
  o1.value = 'actual';
  o1.textContent = `🟢 SE actual (${formatSE(actual.se, actual.anio)})`;
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

  sel.value = 'todas'; // en registros mostramos todas por defecto
}

function pasaFiltroSE(p) {
  const sel = document.getElementById('f-se')?.value || 'todas';
  const actual = getSEActual();

  let pSe = p.se, pAnio = p.anio;
  if (!pSe || !pAnio) {
    if (p.fecha) {
      const c = calcularSE(p.fecha);
      pSe = c.se; pAnio = c.anio;
    } else return false;
  }

  if (sel === 'actual') return pSe === actual.se && pAnio === actual.anio;
  if (sel === 'ultimas4') {
    return getUltimasSE(4).some(u => u.se === pSe && u.anio === pAnio);
  }
  if (sel === 'todas') return true;
  const [seSel, anioSel] = sel.split('|').map(Number);
  return pSe === seSel && pAnio === anioSel;
}

// ==================== Filtros ====================
function aplicarFiltros() {
  const desde = document.getElementById('f-desde').value;
  const hasta = document.getElementById('f-hasta').value;
  const casosMin = parseInt(document.getElementById('f-casos').value, 10);
  const texto = document.getElementById('buscar').value.toLowerCase().trim();
  const riesgo = document.getElementById('f-riesgo').value;

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
}

// ==================== Render ====================
function renderizar() {
  aplicarFiltros();

  const tbody = document.querySelector('#tabla-registros tbody');
  const contador = document.getElementById('contador');
  tbody.innerHTML = '';

  contador.textContent = `${filtrados.length} de ${puntos.length} registros`;

  if (filtrados.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="sin-datos">No hay registros que coincidan</td></tr>`;
    return;
  }

// Ordenar por SE descendente y luego por nombre (seguro ante nulls)
  filtrados.sort((a, b) => {
    const aSe = (Number(a.anio) || 0) * 100 + (Number(a.se) || 0);
    const bSe = (Number(b.anio) || 0) * 100 + (Number(b.se) || 0);
    if (aSe !== bSe) return bSe - aSe;
    const aNom = String(a.nombre || '').toLowerCase();
    const bNom = String(b.nombre || '').toLowerCase();
    return aNom.localeCompare(bNom);
  });

  filtrados.forEach((p, i) => {
    const tr = document.createElement('tr');
    const seLabel = formatSE(p.se, p.anio);
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td><strong>${seLabel}</strong></td>
      <td>${escapeHtml(p.nombre)}</td>
      <td>${Number(p.lat).toFixed(5)}</td>
      <td>${Number(p.lng).toFixed(5)}</td>
      <td><strong>${p.casos}</strong></td>
      <td>${p.fecha || '—'}</td>
      <td>${escapeHtml(p.notas || '—')}</td>
      <td class="acciones">
        <button class="btn-ver" data-id="${p.id}">Ver</button>
        <button class="btn-eliminar" data-id="${p.id}">Eliminar</button>
      </td>`;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('.btn-ver').forEach(b =>
    b.addEventListener('click', () => verEnMapa(b.dataset.id))
  );
  tbody.querySelectorAll('.btn-eliminar').forEach(b =>
    b.addEventListener('click', () => eliminar(b.dataset.id))
  );
}

// ==================== Acciones ====================
function verEnMapa(id) {
  sessionStorage.setItem('centrar_punto', id);
  window.location.href = 'index.html';
}

async function eliminar(id) {
  if (!confirm('¿Eliminar este registro?')) return;

  puntos = puntos.filter(p => String(p.id) !== String(id));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(puntos));

  try {
    await fetch(API_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'eliminar', apiKey: API_KEY, id })
    });
  } catch (e) {
    console.warn('No se pudo eliminar online', e);
  }

  renderizar();
}

function exportarCSV() {
  if (filtrados.length === 0) return alert('No hay datos para exportar');
  const headers = ['SE', 'Año', 'Nombre', 'Latitud', 'Longitud', 'Casos', 'Fecha', 'Notas'];
  const filas = filtrados.map(p =>
    [formatSE(p.se, p.anio), p.anio || '', p.nombre, p.lat, p.lng, p.casos, p.fecha, (p.notas || '').replace(/[\n;]/g, ' ')]
      .map(v => `"${String(v ?? '').replace(/"/g, '""')}"`)
      .join(';')
  );
  const csv = [headers.join(';'), ...filas].join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `ovitrampas_filtrado_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
}

// ==================== Utilidades ====================
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

// ==================== Init ====================
document.addEventListener('DOMContentLoaded', async () => {
  await sincronizar();
  inicializarFiltroSE();
  renderizar();

  document.getElementById('buscar').addEventListener('input', renderizar);
  ['f-desde', 'f-hasta', 'f-casos', 'f-riesgo', 'f-se'].forEach(id =>
    document.getElementById(id).addEventListener('input', renderizar)
  );

  document.getElementById('btn-exportar-csv').addEventListener('click', exportarCSV);

  document.getElementById('btn-recargar').addEventListener('click', async () => {
    await sincronizar();
    renderizar();
  });

  document.getElementById('btn-limpiar-filtros').addEventListener('click', () => {
    ['f-desde', 'f-hasta', 'f-casos', 'f-riesgo', 'buscar'].forEach(id =>
      document.getElementById(id).value = ''
    );
    document.getElementById('f-se').value = 'todas';
    renderizar();
  });
});
