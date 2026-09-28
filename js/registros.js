// ==================== Configuración ====================
const STORAGE_KEY = 'ovitrampas_puntos';
const API_URL = 'https://script.google.com/macros/s/AKfycbwGvRt2BOSVF94KooPlBmE0q2NUacsMZmmPz8QoERZE2NxOIOy6n_fMLrt6cYqPGSGGlw/exec';
const API_KEY = '258233kar';

let puntos = [];
let filtrados = [];

// ==================== Sincronización ====================
async function sincronizar() {
  try {
    const res = await fetch(`${API_URL}?action=listar`);
    const json = await res.json();
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

// ==================== Filtros ====================
function aplicarFiltros() {
  const desde = document.getElementById('f-desde').value;
  const hasta = document.getElementById('f-hasta').value;
  const casosMin = parseInt(document.getElementById('f-casos').value, 10);
  const texto = document.getElementById('buscar').value.toLowerCase().trim();
  const riesgo = document.getElementById('f-riesgo').value;

  filtrados = puntos.filter(p => {
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
    tbody.innerHTML = `<tr><td colspan="8" class="sin-datos">No hay registros que coincidan</td></tr>`;
    return;
  }

  filtrados.forEach((p, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${i + 1}</td>
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

  // Eliminar local
  puntos = puntos.filter(p => String(p.id) !== String(id));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(puntos));

  // Eliminar en Sheets
  try {
    await fetch(API_URL, {
      method: 'POST',
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
  const headers = ['Nombre', 'Latitud', 'Longitud', 'Casos', 'Fecha', 'Notas'];
  const filas = filtrados.map(p =>
    [p.nombre, p.lat, p.lng, p.casos, p.fecha, (p.notas || '').replace(/[\n;]/g, ' ')]
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
  renderizar();

  document.getElementById('buscar').addEventListener('input', renderizar);
  ['f-desde', 'f-hasta', 'f-casos', 'f-riesgo'].forEach(id =>
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
    renderizar();
  });
});
