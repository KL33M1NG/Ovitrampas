// ==================== Config ====================
const TUTORIAL_KEY = 'ovitrampas_tutorial_visto';

// ==================== Init ====================
document.addEventListener('DOMContentLoaded', () => {
  const modal = document.getElementById('modal-tutorial');
  const btnAyuda = document.getElementById('btn-ayuda-header');
  const btnVerTutorial = document.getElementById('btn-ver-tutorial');
  const btnCerrar = document.getElementById('modal-cerrar');
  const btnCerrarFooter = document.getElementById('modal-cerrar-footer');
  const chkNoMostrar = document.getElementById('no-mostrar');

  // Mostrar tutorial si nunca se vio
  const yaVisto = localStorage.getItem(TUTORIAL_KEY) === 'true';
  if (!yaVisto) {
    setTimeout(() => abrirModal(), 400);
  }

  // Abrir modal
  function abrirModal() {
    modal.classList.remove('oculto');
    document.body.style.overflow = 'hidden';
    // Marcar el checkbox según preferencia guardada
    chkNoMostrar.checked = yaVisto;
  }

  // Cerrar modal
  function cerrarModal() {
    modal.classList.add('oculto');
    document.body.style.overflow = '';

    // Guardar preferencia "no volver a mostrar"
    if (chkNoMostrar.checked) {
      localStorage.setItem(TUTORIAL_KEY, 'true');
    } else {
      localStorage.removeItem(TUTORIAL_KEY);
    }
  }

  // Eventos
  btnAyuda?.addEventListener('click', abrirModal);
  btnVerTutorial?.addEventListener('click', abrirModal);
  btnCerrar?.addEventListener('click', cerrarModal);
  btnCerrarFooter?.addEventListener('click', cerrarModal);

  // Cerrar al hacer clic fuera del modal
  modal?.addEventListener('click', e => {
    if (e.target === modal) cerrarModal();
  });

  // Cerrar con ESC
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !modal.classList.contains('oculto')) {
      cerrarModal();
    }
  });
});
