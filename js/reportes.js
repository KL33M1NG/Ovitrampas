// ==================== Configuración ====================
const STORAGE_KEY = 'ovitrampas_puntos';
const API_URL = 'https://script.google.com/macros/s/AKfycbwGvRt2BOSVF94KooPlBmE0q2NUacsMZmmPz8QoERZE2NxOIOy6n_fMLrt6cYqPGSGGlw/exec';
const API_KEY = '258233KAR';

let mapa, capaCalor, capaMarcadores;
let puntos = [];
let filtrados = [];

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

// ==================== Init ====================
// ==================== Init ====================
async function init() {
  await sincronizar();

  // Crear mapa
  mapa = L.map('map-reporte', {
    zoomControl: true,
    preferCanvas: true
  }).setView([-34.6037, -58.3816], 6);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap'
  }).addTo(mapa);

  capaCalor = L.heatLayer([], {
    radius: 35, blur: 25, maxZoom: 15,
    gradient: { 0.0:'#3288bd',0.3:'#66c2a5',0.5:'#fee08b',0.7:'#f46d43',1.0:'#d53e4f' }
  }).addTo(mapa);

  capaMarcadores = L.layerGroup().addTo(mapa);

  // Forzar cálculo de tamaño DESPUÉS de que el DOM esté listo
  setTimeout(() => {
    mapa.invalidateSize();
    renderizarMapa();
    ajustarVista();
  }, 200);

  // Segundo invalidate por las dudas (algunos navegadores tardan más)
  setTimeout(() => {
    mapa.invalidateSize();
  }, 800);

  asignarEventos();
}

// ==================== Render mapa ====================
function aplicarFiltros() {
  const desde = document.getElementById('rep-desde').value;
  const hasta = document.getElementById('rep-hasta').value;
  const casosMin = parseInt(document.getElementById('rep-casos').value, 10);
  const texto = document.getElementById('rep-texto').value.toLowerCase().trim();
  const riesgo = document.getElementById('rep-riesgo').value;

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

  document.getElementById('rep-contador').textContent =
    `${filtrados.length} de ${puntos.length} puntos seleccionados`;
}

function renderizarMapa() {
  aplicarFiltros();
  capaMarcadores.clearLayers();
  const heatData = [];

  console.log('🎯 Renderizando mapa con', filtrados.length, 'puntos de', puntos.length, 'totales');

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
      .bindPopup(`
        <strong>${escapeHtml(p.nombre)}</strong><br>
        🦟 Casos: <b>${p.casos}</b><br>
        📅 ${p.fecha || 's/f'}<br>
        📍 ${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}
      `).addTo(capaMarcadores);
  });

  capaCalor.setLatLngs(heatData);
}
// ==================== Eventos ====================
function asignarEventos() {
  ['rep-desde','rep-hasta','rep-casos','rep-texto','rep-riesgo'].forEach(id => {
    const el = document.getElementById(id);
    el.addEventListener('input', () => { renderizarMapa(); ajustarVista(); });
    el.addEventListener('change', () => { renderizarMapa(); ajustarVista(); });
  });

  document.getElementById('btn-limpiar-filtros-rep').addEventListener('click', () => {
    ['rep-desde','rep-hasta','rep-casos','rep-texto','rep-riesgo'].forEach(id => {
      document.getElementById(id).value = '';
    });
    renderizarMapa();
    ajustarVista();
  });

  document.getElementById('rep-incluir-heat').addEventListener('change', e => {
    e.target.checked ? mapa.addLayer(capaCalor) : mapa.removeLayer(capaCalor);
  });

  document.getElementById('btn-preview').addEventListener('click', previsualizar);
  document.getElementById('btn-generar-pdf').addEventListener('click', generarPDF);
}

// ==================== Captura del mapa ====================
// ==================== Captura del mapa ====================
async function capturarMapa() {
  const mapEl = document.getElementById('map-reporte');

  // Asegurar que el mapa esté bien dimensionado antes de capturar
  mapa.invalidateSize();
  await new Promise(r => setTimeout(r, 500)); // esperar tiles

  const canvas = await html2canvas(mapEl, {
    useCORS: true,
    allowTaint: false,
    backgroundColor: '#e8eef2',
    scale: 2,
    logging: false,
    width: mapEl.offsetWidth,
    height: mapEl.offsetHeight,
    onclone: (doc) => {
      // Ocultar controles de zoom y atribución en la captura
      doc.querySelectorAll('.leaflet-control-zoom, .leaflet-control-attribution')
        .forEach(el => el.style.display = 'none');
    }
  });
  return canvas.toDataURL('image/png');
}
// ==================== Resumen ====================
function calcularResumen() {
  const total = filtrados.length;
  const casosTotales = filtrados.reduce((sum, p) => sum + (p.casos || 0), 0);
  const alto = filtrados.filter(p => p.casos >= 5).length;
  const medio = filtrados.filter(p => p.casos >= 3 && p.casos < 5).length;
  const bajo = filtrados.filter(p => p.casos < 3).length;
  const promedio = total > 0 ? (casosTotales / total).toFixed(2) : 0;
  return { total, casosTotales, alto, medio, bajo, promedio };
}

// ==================== Generar PDF ====================
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

    // ---------- ENCABEZADO ----------
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

    // Info institución / responsable
    const institucion = document.getElementById('rep-institucion').value.trim();
    const responsable = document.getElementById('rep-responsable').value.trim();
    const fechaGen = new Date().toLocaleString('es-AR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });

    if (institucion) { doc.text(`Institución: ${institucion}`, margen, y); y += 5; }
    if (responsable) { doc.text(`Responsable: ${responsable}`, margen, y); y += 5; }
    doc.text(`Fecha de generación: ${fechaGen}`, margen, y); y += 5;
    doc.text(`Total de puntos: ${filtrados.length}`, margen, y); y += 8;

    // ---------- FILTROS APLICADOS ----------
    const filtrosAplicados = [];
    const desde = document.getElementById('rep-desde').value;
    const hasta = document.getElementById('rep-hasta').value;
    const casosMin = document.getElementById('rep-casos').value;
    const texto = document.getElementById('rep-texto').value.trim();
    const riesgo = document.getElementById('rep-riesgo').value;
    if (desde) filtrosAplicados.push(`Desde: ${desde}`);
    if (hasta) filtrosAplicados.push(`Hasta: ${hasta}`);
    if (casosMin) filtrosAplicados.push(`Casos mínimos: ${casosMin}`);
    if (texto) filtrosAplicados.push(`Búsqueda: "${texto}"`);
    if (riesgo) filtrosAplicados.push(`Riesgo: ${riesgo}`);

    if (filtrosAplicados.length > 0) {
      doc.setFontSize(8);
      doc.setTextColor(100, 100, 100);
      doc.text('Filtros aplicados: ' + filtrosAplicados.join(' · '), margen, y);
      y += 6;
    }

    // ---------- RESUMEN ESTADÍSTICO ----------
    if (document.getElementById('rep-incluir-resumen').checked) {
      const r = calcularResumen();

      doc.setFillColor(240, 247, 250);
      doc.rect(margen, y, ancho - 2 * margen, 22, 'F');

      doc.setFontSize(10);
      doc.setTextColor(27, 73, 101);
      doc.setFont('helvetica', 'bold');
      doc.text('Resumen Estadístico', margen + 4, y + 5);

      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(50, 50, 50);

      const cols = [
        `Puntos: ${r.total}`,
        `Casos totales: ${r.casosTotales}`,
        `Promedio: ${r.promedio}`,
        `🔴 Alto: ${r.alto}`,
        `🟠 Medio: ${r.medio}`,
        `🟢 Bajo: ${r.bajo}`
      ];
      const colWidth = (ancho - 2 * margen - 8) / 3;
      cols.forEach((txt, i) => {
        const col = i % 3;
        const row = Math.floor(i / 3);
        doc.text(txt, margen + 4 + col * colWidth, y + 12 + row * 5);
      });

      y += 28;
    }

    // ---------- MAPA ----------
    if (document.getElementById('rep-incluir-mapa').checked) {
      const captura = await capturarMapa();

      const imgWidth = ancho - 2 * margen;
      // Ratio aproximado de la captura (ancho del div / alto visible)
      const mapEl = document.getElementById('map-reporte');
      const ratio = mapEl.offsetHeight / mapEl.offsetWidth;
      let imgHeight = imgWidth * ratio;

      // Si no entra, achicamos
      const maxHeight = alto - y - 20;
      if (imgHeight > maxHeight) {
        imgHeight = maxHeight;
      }

      if (y + imgHeight + 10 > alto - margen) {
        doc.addPage();
        y = margen;
      }

      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(27, 73, 101);
      doc.text('Mapa de calor', margen, y);
      y += 4;

      doc.addImage(captura, 'PNG', margen, y, imgWidth, imgHeight);
      y += imgHeight + 8;
    }

    // ---------- TABLA DE PUNTOS ----------
    if (document.getElementById('rep-incluir-tabla').checked) {
      doc.addPage();
      y = margen;

      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(27, 73, 101);
      doc.text('Detalle de puntos registrados', margen, y);
      y += 6;

      // Config columnas
      const cols = [
        { key: 'nombre', label: 'Nombre', w: 45 },
        { key: 'lat', label: 'Lat', w: 22 },
        { key: 'lng', label: 'Lng', w: 22 },
        { key: 'casos', label: 'Casos', w: 15 },
        { key: 'fecha', label: 'Fecha', w: 22 },
        { key: 'riesgo', label: 'Riesgo', w: 18 },
        { key: 'notas', label: 'Notas', w: ancho - 2 * margen - 45 - 22 - 22 - 15 - 22 - 18 }
      ];
      const rowHeight = 6;
      const lineHeight = 4;

      // Función para dibujar encabezado
      function dibujarEncabezado() {
        doc.setFillColor(27, 73, 101);
        doc.rect(margen, y, ancho - 2 * margen, rowHeight, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(8);
        doc.setFont('helvetica', 'bold');
        let x = margen + 1;
        cols.forEach(c => {
          doc.text(c.label, x, y + 4);
          x += c.w;
        });
        y += rowHeight;
      }

      dibujarEncabezado();

      doc.setFont('helvetica', 'normal');
      doc.setTextColor(40, 40, 40);
      doc.setFontSize(7.5);

      filtrados.forEach((p, idx) => {
        // Calcular alto de la fila según las notas
        const notasTexto = p.notas || '—';
        const notasLineas = doc.splitTextToSize(notasTexto, cols[6].w - 2);
        const altoFila = Math.max(rowHeight, notasLineas.length * lineHeight + 2);

        // Nueva página si no entra
        if (y + altoFila > alto - margen) {
          doc.addPage();
          y = margen;
          dibujarEncabezado();
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(40, 40, 40);
          doc.setFontSize(7.5);
        }

        // Fondo alterno
        if (idx % 2 === 0) {
          doc.setFillColor(245, 248, 250);
          doc.rect(margen, y, ancho - 2 * margen, altoFila, 'F');
        }

        // Riesgo
        let riesgoTxt = 'Bajo';
        if (p.casos >= 5) riesgoTxt = 'Alto';
        else if (p.casos >= 3) riesgoTxt = 'Medio';

        const fila = [
          p.nombre,
          Number(p.lat).toFixed(4),
          Number(p.lng).toFixed(4),
          String(p.casos),
          p.fecha || '—',
          riesgoTxt,
          notasTexto
        ];

        let x = margen + 1;
        // Nombre (con wrap si es muy largo)
        const nombreLineas = doc.splitTextToSize(fila[0], cols[0].w - 2);
        doc.text(nombreLineas[0], x, y + 4);
        x += cols[0].w;

        doc.text(fila[1], x, y + 4); x += cols[1].w;
        doc.text(fila[2], x, y + 4); x += cols[2].w;
        doc.text(fila[3], x, y + 4); x += cols[3].w;
        doc.text(fila[4], x, y + 4); x += cols[4].w;

        // Color según riesgo
        if (riesgoTxt === 'Alto') doc.setTextColor(213, 62, 79);
        else if (riesgoTxt === 'Medio') doc.setTextColor(244, 109, 67);
        else doc.setTextColor(42, 157, 143);
        doc.text(fila[5], x, y + 4);
        doc.setTextColor(40, 40, 40);
        x += cols[5].w;

        // Notas (multilínea)
        notasLineas.forEach((linea, i) => {
          doc.text(linea, x, y + 4 + i * lineHeight);
        });

        // Línea inferior
        doc.setDrawColor(220, 220, 220);
        doc.line(margen, y + altoFila, ancho - margen, y + altoFila);

        y += altoFila;
      });
    }

    // ---------- OBSERVACIONES ----------
    const observaciones = document.getElementById('rep-observaciones').value.trim();
    if (observaciones) {
      if (y + 30 > alto - margen) { doc.addPage(); y = margen; }
      y += 8;
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(27, 73, 101);
      doc.text('Observaciones', margen, y);
      y += 5;

      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(50, 50, 50);
      const lineas = doc.splitTextToSize(observaciones, ancho - 2 * margen);
      doc.text(lineas, margen, y);
      y += lineas.length * 4 + 4;
    }

    // ---------- PIE DE PÁGINA ----------
    const totalPaginas = doc.internal.getNumberOfPages();
    for (let i = 1; i <= totalPaginas; i++) {
      doc.setPage(i);
      doc.setFontSize(7);
      doc.setTextColor(150, 150, 150);
      doc.text(
        `Sistema de Ovitrampas - ${fechaGen} - Página ${i} de ${totalPaginas}`,
        ancho / 2, alto - 6, { align: 'center' }
      );
    }

    // ---------- GUARDAR ----------
    const nombreArchivo = `reporte_ovitrampas_${new Date().toISOString().slice(0, 10)}.pdf`;
    doc.save(nombreArchivo);

  } catch (err) {
    console.error(err);
    alert('❌ Error al generar el PDF: ' + err.message);
  } finally {
    btn.textContent = textoOriginal;
    btn.disabled = false;
  }
}

// ==================== Previsualizar (nueva ventana) ====================
async function previsualizar() {
  if (filtrados.length === 0) {
    alert('⚠️ No hay puntos para incluir en el reporte.');
    return;
  }
  alert('✅ La previsualización muestra el mapa actual. Al hacer clic en "Generar PDF" se descargará el archivo completo con todos los datos.');
}

// ==================== Utilidades ====================
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

// ==================== Inicio ====================
document.addEventListener('DOMContentLoaded', init);
