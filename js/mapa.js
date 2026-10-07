// ==================== Configuración ====================
const STORAGE_KEY = 'ovitrampas_puntos';
const API_URL = 'https://script.google.com/macros/s/AKfycbwGvRt2BOSVF94KooPlBmE0q2NUacsMZmmPz8QoERZE2NxOIOy6n_fMLrt6cYqPGSGGlw/exec';
const API_KEY = '258233KAR';

let mapa, capaCalor, capaMarcadores;
let puntos = [];
let modoOnline = true;

// ==================== Utilidades SE ====================
/**
 * Calcula la SE (Semana Epidemiológica) de una fecha dada
 * Mismo algoritmo que el Apps Script para consistencia
 */
function calcularSE(fecha) {
  const d = new Date(fecha + 'T12:00:00'); // mediodía para evitar problemas de zona
  const anio = d.getFullYear();
  const ene1 = new Date(anio, 0, 1);
  const diaSemanaEne1 = ene1.getDay();

  let primerDomingo = new Date(ene1);
  if (diaSemanaEne1 === 0) {
    primerDomingo = ene1;
  } else if (diaSemanaEne1 <= 4) {
    primerDomingo.setDate(ene1.getDate() - diaSemanaEne1);
  } else {
    primerDomingo.setDate(ene1.getDate() + (7 - diaSemanaEne1));
  }

  const diffMs = d - primerDomingo;
  const diffDias = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const se = Math.floor(diffDias / 7) + 1;

  return { se, anio };
}

/**
 * Devuelve la SE actual (hoy)
 */
function getSEActual() {
  const hoy = new Date().toISOString().slice(0, 10);
  return calcularSE(hoy);
}

/**
 * Devuelve las últimas N semanas epidemiológicas (incluyendo la actual)
 * Formato: [{ se, anio, label }, ...] ordenadas de la más reciente a la más vieja
 */
function getUltimasSE(n) {
  const actual = getSEActual();
  const lista = [];
  let se = actual.se;
  let anio = actual.anio;

  for (let i = 0; i < n; i++) {
    lista.push({
      se,
      anio,
      label: `SE ${String(se).padStart(2, '0')} - ${anio}`
    });
    se--;
    if (se < 1) {
      anio--;
      se = 52; // aproximado, suficiente para el filtro
    }
  }
  return lista;
}

/**
 * Formatea una SE como string legible
 */
function formatSE(se, anio) {
  if (!se || !anio) return 'Sin SE';
  return `SE ${String(se).padStart(2, '0')} - ${anio}`;
}

/**
 * Compara si (se1, anio1) >= (se2, anio2)
 */
function seEsMayorOIgual(se1, anio1, se2, anio2) {
  if (anio1 > anio2) return true;
  if (anio1 < anio2) return false;
  return se1 >= se2;
}

// ==================== Init ====================
async function init() {
  mapa = L.map('map').setView([-34.6037, -58.3816], 6);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap'
  }).addTo(mapa);

  capaCalor = L.heatLayer([], {
    radius: 35, blur: 25, maxZoom: 15,
    gradient: { 0.0:'#3288bd',0.3:'#66c2a5',0.5:'#fee08b',0.7:'#f46d43',1.0:'#d53e4f' }
  }).addTo(mapa);

  capaMarcadores = L.layerGroup().addTo(mapa);

  cargarLocal();
  inicializarSelectorSE();
  inicializarFiltroSE();
  renderizar();
  await sincronizar();

  asignarEventos();
  iniciarFiltros();
  actualizarEstadoConexion();

  const idCentrar = sessionStorage.getItem('centrar_punto');
  if (idCentrar) {
    const p = puntos.find(x => String(x.id) === idCentrar);
    if (p) mapa.setView([p.lat, p.lng], 16);
    sessionStorage.removeItem('centrar_punto');
  }
}

// ==================== Selector de SE en el formulario ====================
function inicializarSelectorSE() {
  const select = document.getElementById('se');
  if (!select) return;

  select.innerHTML = '';

  const actual = getSEActual();
  const ultimas = getUltimasSE(52); // hasta 1 año atrás

  ultimas.forEach(item => {
    const opt = document.createElement('option');
    opt.value = `${item.se}|${item.anio}`;
    opt.textContent = item.label + (item.se === actual.se && item.anio === actual.anio ? ' (actual)' : '');
    select.appendChild(opt);
  });

  // Por defecto, seleccionar la SE actual
  select.value = `${actual.se}|${actual.anio}`;

  // Al cambiar la fecha, recalcular SE
  const inputFecha = document.getElementById('fecha');
  if (inputFecha) {
    inputFecha.addEventListener('change', () => {
      const f = inputFecha.value;
      if (!f) return;
      const { se, anio } = calcularSE(f);
      // Verificar que no sea futura
      if (!seEsMayorOIgual(actual.se, actual.anio, se, anio)) {
        alert('⚠️ No se puede cargar un punto con una fecha futura. La SE seleccionada es mayor a la actual.');
        inputFecha.value = '';
        return;
      }
      const val = `${se}|${anio}`;
      if (select.querySelector(`option[value="${val}"]`)) {
        select.value = val;
      }
    });
  }
}

// ==================== Filtro de SE en el mapa ====================
function inicializarFiltroSE() {
  const filtroSE = document.getElementById('filtro-se');
  if (!filtroSE) return;

  filtroSE.innerHTML = '';

  // Opción: SE actual
  const actual = getSEActual();
  const optActual = document.createElement('option');
  optActual.value = 'actual';
  optActual.textContent = `🟢 SE actual (${formatSE(actual.se, actual.anio)})`;
  filtroSE.appendChild(optActual);

  // Opción: Últimas 4 SE
  const opt4 = document.createElement('option');
  opt4.value = 'ultimas4';
  opt4.textContent = '📅 Últimas 4 SE';
  filtroSE.appendChild(opt4);

  // Opción: Todas
  const optTodas = document.createElement('option');
  optTodas.value = 'todas';
  optTodas.textContent = '📊 Todas las SE';
  filtroSE.appendChild(optTodas);

  // Separador
  const sep = document.createElement('option');
  sep.disabled = true;
  sep.textContent = '──────────';
  filtroSE.appendChild(sep);

  // Lista de SE específicas
  const ultimas = getUltimasSE(26); // 6 meses atrás
  ultimas.forEach(item => {
    const opt = document.createElement('option');
    opt.value = `${item.se}|${item.anio}`;
    opt.textContent = item.label;
    filtroSE.appendChild(opt);
  });

  // Por defecto: SE actual
  filtroSE.value = 'actual';
  filtroSE.addEventListener('change', renderizar);
}

/**
 * Determina si un punto debe mostrarse según el filtro de SE actual
 */
function pasaFiltroSE(p) {
  const filtroSE = document.getElementById('filtro-se')?.value || 'actual';
  const actual = getSEActual();

  // Si el punto no tiene SE asignada, usar su fecha para calcularla
  let pSe = p.se;
  let pAnio = p.anio;
  if (!pSe || !pAnio) {
    if (p.fecha) {
      const calc = calcularSE(p.fecha);
      pSe = calc.se;
      pAnio = calc.anio;
    } else {
      return false; // sin fecha ni SE → ocultar
    }
  }

  if (filtroSE === 'actual') {
    return pSe === actual.se && pAnio === actual.anio;
  }
  if (filtroSE === 'ultimas4') {
    const ultimas = getUltimasSE(4);
    return ultimas.some(u => u.se === pSe && u.anio === pAnio);
  }
  if (filtroSE === 'todas') {
    return true;
  }
  // SE específica: "se|anio"
  const [seSel, anioSel] = filtroSE.split('|').map(Number);
  return pSe === seSel && pAnio === anioSel;
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
  try {
    await fetch(API_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, apiKey: API_KEY, ...payload })
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
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

    const seLabel = formatSE(p.se, p.anio);

    L.marker([p.lat, p.lng], { icon: icono })
      .bindPopup(`
        <strong>${escapeHtml(p.nombre)}</strong><br>
        📅 <b>${seLabel}</b><br>
        🦟 Casos: <b>${p.casos}</b><br>
        📆 ${p.fecha || 's/f'}<br>
        📍 ${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}
        ${p.notas ? '<br>📝 ' + escapeHtml(p.notas) : ''}
      `)
      .addTo(capaMarcadores);
  });

  capaCalor.setLatLngs(heatData);
  actualizarContador(filtrados.length, puntos.length);
}

function actualizarContador(nVisible, nTotal) {
  const el = document.getElementById('contador-mapa');
  if (el) {
    el.textContent = `${nVisible} de ${nTotal} punto${nTotal !== 1 ? 's' : ''} visible${nVisible !== 1 ? 's' : ''}`;
  }
}

// ==================== Filtros ====================
function aplicarFiltros(lista) {
  const desde = document.getElementById('filtro-desde')?.value;
  const hasta = document.getElementById('filtro-hasta')?.value;
  const casosMin = parseInt(document.getElementById('filtro-casos')?.value, 10);
  const texto = (document.getElementById('filtro-texto')?.value || '').toLowerCase().trim();
  const riesgo = document.getElementById('filtro-riesgo')?.value;

  return lista.filter(p => {
    // Filtro de SE (principal)
    if (!pasaFiltroSE(p)) return false;

    // Filtros complementarios
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
    // Resetear SE a "actual"
    const selSE = document.getElementById('filtro-se');
    if (selSE) selSE.value = 'actual';
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
    await enviarAlServidor('limpiar', {});
    puntos = [];
    guardarLocal();
    renderizar();
    mostrarToast('🗑 Todos los puntos eliminados');
  });
}

async function agregarPunto() {
  const seValor = document.getElementById('se').value;
  const [se, anio] = seValor.split('|').map(Number);
  const actual = getSEActual();

  // Validar que no sea futura
  if (!seEsMayorOIgual(actual.se, actual.anio, se, anio)) {
    alert('⚠️ No se puede cargar un punto en una SE futura.');
    return;
  }

  const nuevo = {
    id: Date.now().toString(),
    nombre: document.getElementById('nombre').value.trim(),
    lat: parseFloat(document.getElementById('lat').value),
    lng: parseFloat(document.getElementById('lng').value),
    casos: parseInt(document.getElementById('casos').value, 10),
    fecha: document.getElementById('fecha').value,
    notas: document.getElementById('notas').value.trim(),
    se: se,
    anio: anio
  };

  if (isNaN(nuevo.lat) || isNaN(nuevo.lng)) return alert('Lat/Lng inválidas');

  puntos.push(nuevo);
  guardarLocal();
  renderizar();
  mapa.setView([nuevo.lat, nuevo.lng], 15);

  document.getElementById('form-punto').reset();
  document.getElementById('casos').value = 1;
  // Restaurar SE actual
  document.getElementById('se').value = `${actual.se}|${actual.anio}`;

  mostrarToast('⏳ Enviando a Google Sheets...');

  const r = await enviarAlServidor('agregar', { data: nuevo });

  if (r.ok) {
    mostrarToast('✅ Punto guardado en Google Sheets');
    setTimeout(async () => { await sincronizar(); }, 1500);
  } else {
    mostrarToast('⚠️ Guardado local. Error: ' + r.error, 'error');
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

      // Asegurar que cada punto tenga SE
      data.forEach(p => {
        if (!p.se || !p.anio) {
          if (p.fecha) {
            const calc = calcularSE(p.fecha);
            p.se = calc.se;
            p.anio = calc.anio;
          }
        }
      });

      puntos = puntos.concat(data);
      guardarLocal();
      renderizar();

      for (const p of data) {
        await enviarAlServidor('agregar', { data: p });
      }
      alert(`✅ ${data.length} puntos importados`);
      setTimeout(sincronizar, 1500);
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
