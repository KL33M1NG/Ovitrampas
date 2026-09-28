// ==================== Configuración ====================
const STORAGE_KEY = 'ovitrampas_puntos';
const API_URL = 'https://script.google.com/macros/s/AKfycbwGvRt2BOSVF94KooPlBmE0q2NUacsMZmmPz8QoERZE2NxOIOy6n_fMLrt6cYqPGSGGlw/exec';
const API_KEY = '258233kar';

let mapa, capaCalor, capaMarcadores;
let puntos = [];
let modoOnline = true;

// ==================== Init ====================
async function init() {
  mapa = L.map('map').setView([-34.6037, -58.3816], 6);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap'
  }).addTo(mapa);

  capaCalor = L.heatLayer([], {
    radius: 35,
    blur: 25,
    maxZoom: 15,
    gradient: {
      0.0: '#3288bd',
      0.3: '#66c2a5',
      0.5: '#fee08b',
      0.7: '#f46d43',
      1.0: '#d53e4f'
    }
  }).addTo(mapa);

  capaMarcadores = L.layerGroup().addTo(mapa);

  // Cargar local primero (rápido), luego sincronizar con Sheets
  cargarLocal();
  renderizar();
  await sincronizar();

  asignarEventos();
  iniciarFiltros();
  actualizarEstadoConexion();

  // Si venimos de "Ver en mapa" desde la tabla
  const idCentrar = sessionStorage.getItem('centrar_punto');
  if (idCentrar) {
    const p = puntos.find(x => String(x.id) === idCentrar);
    if (p) mapa.setView([p.lat, p.lng], 16);
    sessionStorage.removeItem('centrar_punto');
  }
}

// ==================== Local ====================
function cargarLocal() {
  try {
    puntos = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    puntos = [];
  }
}

function guardarLocal() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(puntos));
}

// ==================== Sincronización con Sheets ====================
async function sincronizar() {
  try {
    const res = await fetch(`${API_URL}?action=listar`);
    const json = await res.json();
    if (json.ok) {
      puntos = json.data || [];
      guardarLocal();
      renderizar();
      modoOnline = true;
    } else {
      throw new Error(json.error || 'Error desconocido');
    }
  } catch (err) {
    console.warn('Sin conexión, usando datos locales:', err);
    modoOnline = false;
  }
  actualizarEstadoConexion();
}

async function enviarAlServidor(action, payload) {
  const res = await fetch(API_URL, {
    method: 'POST',
    // text/plain evita preflight CORS con Apps Script
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, apiKey: API_KEY, ...payload })
  });
  return await res.json();
}

function actualizarEstadoConexion() {
  const el = document.getElementById('estado-conexion');
  if (!el) return;
  el.textContent = modoOnline ? '🟢 Conectado a Google Sheets' : '🔴 Offline (datos locales)';
  el.className = modoOnline ? 'online' : 'offline';
}

// ==================== Render ====================
function renderizar() {
  const filtrados = aplicarFiltros(puntos);
  capaMarcadores.clearLayers();
  const heatData = [];

  filtrados.forEach(p => {
    const intensidad = Math.min(1, (p.casos || 1) / 10);
    heatData.push([p.lat, p.lng, Math.max(0.3, intensidad)]);

    const color = p.casos >= 5 ? '#d53e4f' : p.casos >= 3 ? '#f46d43' : '#66c2a5';
    const icono = L.divIcon({
      className: '',
      html: `<div style="background:${color};width:18px;height:18px;border-radius:50%;border:3px solid white;box-shadow:0 0 6px rgba(0,0,0,.5);"></div>`,
      iconSize: [18, 18],
      iconAnchor: [9, 9]
    });

    L.marker([p.lat, p.lng], { icon: icono })
      .bindPopup(`
        <strong>${escapeHtml(p.nombre)}</strong><br>
        🦟 Casos: <b>${p.casos}</b><br>
        📅 ${p.fecha || 's/f'}<br>
        📍 ${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}
        ${p.notas ? '<br>📝 ' + escapeHtml(p.notas) : ''}
      `)
      .addTo(capaMarcadores);
  });

  capaCalor.setLatLngs(heatData);
  actualizarContador(filtrados.length);
}

function actualizarContador(n) {
  const el = document.getElementById('contador-mapa');
  if (el) el.textContent = `${n} punto${n !== 1 ? 's' : ''} visible${n !== 1 ? 's' : ''}`;
}

// ==================== Filtros ====================
function aplicarFiltros(lista) {
  const desde = document.getElementById('filtro-desde')?.value;
  const hasta = document.getElementById('filtro-hasta')?.value;
  const casosMin = parseInt(document.getElementById('filtro-casos')?.value, 10);
  const texto = (document.getElementById('filtro-texto')?.value || '').toLowerCase().trim();
  const riesgo = document.getElementById('filtro-riesgo')?.value;

  return lista.filter(p => {
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

function iniciarFiltros() {
  ['filtro-desde', 'filtro-hasta', 'filtro-casos', 'filtro-texto', 'filtro-riesgo']
    .forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('input', renderizar);
        el.addEventListener('change', renderizar);
      }
    });

  const btnLimpiar = document.getElementById('limpiar-filtros');
  if (btnLimpiar) btnLimpiar.addEventListener('click', () => {
    ['filtro-desde', 'filtro-hasta', 'filtro-casos', 'filtro-texto', 'filtro-riesgo']
      .forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
    renderizar();
  });
}

// ==================== Eventos ====================
function asignarEventos() {
  document.getElementById('form-punto').addEventListener('submit', async e => {
    e.preventDefault();
    await agregarPunto();
  });

  document.getElementById('btn-ubicacion').addEventListener('click', () => {
    if (!navigator.geolocation) return alert('Geolocalización no disponible');
    navigator.geolocation.getCurrentPosition(
      pos => {
        document.getElementById('lat').value = pos.coords.latitude.toFixed(6);
        document.getElementById('lng').value = pos.coords.longitude.toFixed(6);
      },
      () => alert('No se pudo obtener la ubicación')
    );
  });

  document.getElementById('toggle-heat').addEventListener('change', e => {
    e.target.checked ? mapa.addLayer(capaCalor) : mapa.removeLayer(capaCalor);
  });

  document.getElementById('toggle-markers').addEventListener('change', e => {
    e.target.checked ? mapa.addLayer(capaMarcadores) : mapa.removeLayer(capaMarcadores);
  });

  document.getElementById('btn-export').addEventListener('click', exportarJSON);
  document.getElementById('btn-import').addEventListener('click', () => {
    document.getElementById('file-import').click();
  });
  document.getElementById('file-import').addEventListener('change', importarJSON);

  document.getElementById('btn-sync').addEventListener('click', async () => {
    await sincronizar();
    alert(modoOnline ? '✅ Sincronizado con Google Sheets' : '❌ Sin conexión al servidor');
  });

  document.getElementById('btn-limpiar').addEventListener('click', async () => {
    if (!confirm('¿Borrar TODOS los registros? Esta acción no se puede deshacer.')) return;
    try {
      if (modoOnline) {
        const r = await enviarAlServidor('limpiar', {});
        if (!r.ok) throw new Error(r.error);
      }
      puntos = [];
      guardarLocal();
      renderizar();
      mostrarToast('🗑 Todos los puntos eliminados');
    } catch (err) {
      alert('Error al eliminar en el servidor: ' + err.message);
    }
  });
}

async function agregarPunto() {
  const nuevo = {
    id: Date.now().toString(),
    nombre: document.getElementById('nombre').value.trim(),
    lat: parseFloat(document.getElementById('lat').value),
    lng: parseFloat(document.getElementById('lng').value),
    casos: parseInt(document.getElementById('casos').value, 10),
    fecha: document.getElementById('fecha').value,
    notas: document.getElementById('notas').value.trim()
  };

  if (isNaN(nuevo.lat) || isNaN(nuevo.lng)) return alert('Lat/Lng inválidas');

  // Guardar local primero (funciona offline)
  puntos.push(nuevo);
  guardarLocal();
  renderizar();
  mapa.setView([nuevo.lat, nuevo.lng], 15);

  document.getElementById('form-punto').reset();
  document.getElementById('casos').value = 1;

  if (modoOnline) {
    try {
      const r = await enviarAlServidor('agregar', { data: nuevo });
      if (!r.ok) throw new Error(r.error);
      mostrarToast('✅ Punto guardado en Google Sheets');
    } catch (err) {
      mostrarToast('⚠️ Guardado local. Error al sincronizar: ' + err.message, 'error');
    }
  } else {
    mostrarToast('⚠️ Guardado solo local (sin conexión)', 'warn');
  }
}

function mostrarToast(msg, tipo = 'ok') {
  const t = document.createElement('div');
  t.className = 'toast ' + tipo;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

// ==================== Import / Export JSON ====================
function exportarJSON() {
  const blob = new Blob([JSON.stringify(puntos, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `ovitrampas_${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
}

async function importarJSON(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async ev => {
    try {
      const data = JSON.parse(ev.target.result);
      if (!Array.isArray(data)) throw new Error();

      puntos = puntos.concat(data);
      guardarLocal();
      renderizar();

      if (modoOnline) {
        for (const p of data) {
          try { await enviarAlServidor('agregar', { data: p }); } catch {}
        }
      }
      alert(`✅ ${data.length} puntos importados`);
    } catch {
      alert('❌ Archivo JSON inválido');
    }
  };
  reader.readAsText(file);
  e.target.value = '';
}

// ==================== Utilidades ====================
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

document.addEventListener('DOMContentLoaded', init);
