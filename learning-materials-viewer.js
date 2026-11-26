/* Farbatlas PDF viewer: centered fit modes, deep zoom, pan, thumbnails and fullscreen */
(() => {
  'use strict';

  const MIN_SCALE = 0.15;
  const MAX_SCALE = 6;
  const state = {
    pdfjs: null,
    document: null,
    blob: null,
    meta: null,
    page: 1,
    spread: false,
    scale: 1,
    fit: 'page',
    rendering: 0,
    pointers: new Map(),
    pinchDistance: 0,
    pinchScale: 1,
    swipeStart: null,
    dragStart: null,
    thumbObserver: null,
  };
  const q = (selector) => document.querySelector(selector);
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[character]));
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  async function pdfJs() {
    if (state.pdfjs) return state.pdfjs;
    const library = await import('/vendor/pdfjs/pdf.mjs');
    library.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.mjs';
    state.pdfjs = library;
    return library;
  }

  function installShell() {
    if (q('#farbatlasPdfViewer')) return;
    document.body.insertAdjacentHTML('beforeend', `
      <section id="farbatlasPdfViewer" class="pdf-viewer hidden" role="dialog" aria-modal="true" aria-label="PDF-Lernmaterial">
        <header class="pdf-toolbar">
          <button id="pdfClose" class="pdf-icon" title="Viewer schließen" aria-label="Viewer schließen">✕</button>
          <div class="pdf-title"><strong id="pdfTitle">PDF</strong><span id="pdfStatus"></span></div>
          <button id="pdfThumbnails" class="pdf-icon" title="Seitenübersicht ein- oder ausblenden" aria-label="Seitenübersicht">▦</button>
          <button id="pdfPrevious" class="pdf-icon" title="Vorherige Seite" aria-label="Vorherige Seite">‹</button>
          <label class="pdf-page-field"><input id="pdfPage" type="number" min="1" value="1" aria-label="Seite"><span id="pdfPageCount">/ 1</span></label>
          <button id="pdfNext" class="pdf-icon" title="Nächste Seite" aria-label="Nächste Seite">›</button>
          <button id="pdfZoomOut" class="pdf-icon" title="Verkleinern" aria-label="Verkleinern">−</button>
          <input id="pdfZoom" class="pdf-zoom" type="range" min="15" max="600" step="1" value="100" aria-label="Zoomstufe">
          <button id="pdfZoomIn" class="pdf-icon" title="Vergrößern" aria-label="Vergrößern">+</button>
          <button id="pdfFitWidth" class="pdf-tool" title="Auf die verfügbare Breite einpassen">↔ Breite</button>
          <button id="pdfFitPage" class="pdf-tool" title="Die ganze Seite sichtbar einpassen">▣ Ganze Seite</button>
          <button id="pdfFitFill" class="pdf-tool" title="Fenster vollständig füllen; Randbereiche sind durch Scrollen erreichbar">⤢ Fenster füllen</button>
          <button id="pdfSpread" class="pdf-tool" title="Zwischen Einzel- und Doppelseitenansicht wechseln">Ansicht: Einzelseite</button>
          <button id="pdfFullscreen" class="pdf-tool" title="Browser-Vollbild ein- oder ausschalten">⛶ Vollbild</button>
        </header>
        <div class="pdf-body">
          <aside id="pdfThumbDrawer" class="pdf-thumbs hidden" aria-label="Seitenminiaturen"><div id="pdfThumbList"></div></aside>
          <main id="pdfStage" class="pdf-stage" tabindex="0" aria-label="PDF-Seiten"><div id="pdfPages" class="pdf-pages"></div></main>
        </div>
      </section>`);
    q('#pdfClose').onclick = close;
    q('#pdfPrevious').onclick = () => changePage(state.page - (state.spread ? 2 : 1));
    q('#pdfNext').onclick = () => changePage(state.page + (state.spread ? 2 : 1));
    q('#pdfPage').onchange = (event) => changePage(Number(event.target.value));
    q('#pdfZoomOut').onclick = () => setScale(state.scale - zoomStep());
    q('#pdfZoomIn').onclick = () => setScale(state.scale + zoomStep());
    q('#pdfZoom').oninput = (event) => setScale(Number(event.target.value) / 100, false);
    q('#pdfZoom').onchange = () => renderPages({ preserveView: true });
    q('#pdfFitWidth').onclick = () => applyFit('width');
    q('#pdfFitPage').onclick = () => applyFit('page');
    q('#pdfFitFill').onclick = () => applyFit('fill');
    q('#pdfSpread').onclick = async () => {
      state.spread = !state.spread;
      updateControls();
      if (state.fit === 'custom') await renderPages({ center: true });
      else await applyFit(state.fit);
    };
    q('#pdfThumbnails').onclick = toggleThumbnails;
    q('#pdfFullscreen').onclick = toggleFullscreen;
    const stage = q('#pdfStage');
    stage.addEventListener('pointerdown', pointerDown);
    stage.addEventListener('pointermove', pointerMove);
    stage.addEventListener('pointerup', pointerUp);
    stage.addEventListener('pointercancel', pointerUp);
    stage.addEventListener('wheel', wheelZoom, { passive: false });
    window.addEventListener('keydown', keyDown);
    window.addEventListener('resize', debounce(handleViewportChange, 180));
    screen.orientation?.addEventListener?.('change', () => setTimeout(handleViewportChange, 180));
    document.addEventListener('fullscreenchange', () => {
      updateControls();
      setTimeout(handleViewportChange, 80);
    });
  }

  function debounce(fn, delay) {
    let timer;
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); };
  }

  function nextFrame() {
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }

  async function toggleThumbnails() {
    q('#pdfThumbDrawer').classList.toggle('hidden');
    // The grid width changes only after layout. Recalculate the active fit mode
    // against the real, newly available stage width instead of the old split view.
    await nextFrame();
    await handleViewportChange();
  }

  function zoomStep() {
    return state.scale < 1 ? 0.1 : state.scale < 3 ? 0.2 : 0.5;
  }

  function fitLabel() {
    return { width: 'Breite', page: 'Ganze Seite', fill: 'Fenster füllen', custom: 'Freier Zoom' }[state.fit] || 'Freier Zoom';
  }

  function updateControls() {
    if (!state.document) return;
    q('#pdfPage').value = String(state.page);
    q('#pdfPage').max = String(state.document.numPages);
    q('#pdfPageCount').textContent = `/ ${state.document.numPages}`;
    q('#pdfPrevious').disabled = state.page <= 1;
    q('#pdfNext').disabled = state.page >= state.document.numPages;
    q('#pdfZoom').value = String(Math.round(state.scale * 100));
    q('#pdfStatus').textContent = `${Math.round(state.scale * 100)} % · ${fitLabel()}${state.meta?.offline ? ' · offline' : ''}`;
    q('#pdfSpread').textContent = state.spread ? 'Ansicht: Doppelseite' : 'Ansicht: Einzelseite';
    q('#pdfSpread').setAttribute('aria-pressed', String(state.spread));
    for (const [id, mode] of [['#pdfFitWidth', 'width'], ['#pdfFitPage', 'page'], ['#pdfFitFill', 'fill']]) {
      const button = q(id);
      const active = state.fit === mode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    }
    const fullscreen = Boolean(document.fullscreenElement || q('#farbatlasPdfViewer')?.classList.contains('pdf-browser-fullscreen'));
    q('#pdfFullscreen').textContent = fullscreen ? '⛶ Vollbild beenden' : '⛶ Vollbild';
    q('#pdfFullscreen').setAttribute('aria-pressed', String(fullscreen));
  }

  async function open(blob, meta = {}) {
    installShell();
    const viewer = q('#farbatlasPdfViewer');
    viewer.classList.remove('hidden');
    document.body.classList.add('pdf-viewer-open');
    q('#pdfTitle').textContent = meta.title || meta.fileName || 'PDF-Lernmaterial';
    q('#pdfStatus').textContent = 'PDF wird geöffnet …';
    q('#pdfPages').innerHTML = '<div class="pdf-loading">PDF wird geladen …</div>';
    state.blob = blob;
    state.meta = meta;
    state.page = clamp(Number(meta.page || 1), 1, 100000);
    state.spread = false;
    state.scale = 1;
    state.fit = 'page';
    state.pointers.clear();
    try {
      const library = await pdfJs();
      const bytes = new Uint8Array(await blob.arrayBuffer());
      state.document = await library.getDocument({ data: bytes }).promise;
      state.page = clamp(state.page, 1, state.document.numPages);
      buildThumbnails();
      await applyFit('page', { top: true });
      q('#pdfStage').focus();
    } catch (error) {
      q('#pdfPages').innerHTML = `<div class="pdf-error"><h2>PDF konnte nicht geöffnet werden</h2><p>${escapeHtml(error.message || String(error))}</p></div>`;
      q('#pdfStatus').textContent = 'Fehler';
    }
  }

  async function inspect(blob) {
    const library = await pdfJs();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const pdfDocument = await library.getDocument({ data: bytes }).promise;
    const pageCount = pdfDocument.numPages;
    await pdfDocument.destroy();
    return { pageCount };
  }

  async function close() {
    const viewer = q('#farbatlasPdfViewer');
    if (document.fullscreenElement && viewer?.contains(document.fullscreenElement)) {
      await document.exitFullscreen().catch(() => {});
    }
    viewer?.classList.add('hidden');
    viewer?.classList.remove('pdf-browser-fullscreen');
    document.body.classList.remove('pdf-viewer-open');
    state.thumbObserver?.disconnect();
    state.thumbObserver = null;
    if (state.document) await state.document.destroy().catch(() => {});
    state.document = null;
    state.blob = null;
    state.meta = null;
    state.pointers.clear();
  }

  function pageNumbers() {
    if (!state.spread) return [state.page];
    const first = state.page === 1 ? 1 : state.page % 2 === 0 ? state.page : state.page - 1;
    return [first, first + 1].filter((page) => page <= state.document.numPages);
  }

  function stageSpace() {
    const stage = q('#pdfStage');
    const style = getComputedStyle(stage);
    const horizontalPadding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
    const verticalPadding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    const pageGap = parseFloat(getComputedStyle(q('#pdfPages')).columnGap || 0);
    return {
      width: Math.max(120, stage.clientWidth - horizontalPadding),
      height: Math.max(120, stage.clientHeight - verticalPadding),
      gap: Number.isFinite(pageGap) ? pageGap : 0,
    };
  }

  async function calculateFitScale(mode) {
    if (!state.document) return 1;
    const page = await state.document.getPage(pageNumbers()[0]);
    const base = page.getViewport({ scale: 1 });
    const space = stageSpace();
    const count = state.spread ? Math.min(2, pageNumbers().length) : 1;
    const pageWidth = Math.max(80, (space.width - space.gap * (count - 1)) / count);
    const widthScale = pageWidth / base.width;
    const heightScale = space.height / base.height;
    if (mode === 'page') return Math.min(widthScale, heightScale);
    if (mode === 'fill') return Math.max(widthScale, heightScale);
    return widthScale;
  }

  async function applyFit(mode, { top = false } = {}) {
    if (!state.document) return;
    state.fit = mode;
    state.scale = clamp(await calculateFitScale(mode), MIN_SCALE, MAX_SCALE);
    await renderPages({ center: true, top });
  }

  function viewRatios(stage) {
    return {
      x: stage.scrollWidth > 0 ? (stage.scrollLeft + stage.clientWidth / 2) / stage.scrollWidth : 0.5,
      y: stage.scrollHeight > 0 ? (stage.scrollTop + stage.clientHeight / 2) / stage.scrollHeight : 0.5,
    };
  }

  function restoreView(stage, ratios, center, top, bottom) {
    requestAnimationFrame(() => {
      const maxLeft = Math.max(0, stage.scrollWidth - stage.clientWidth);
      const maxTop = Math.max(0, stage.scrollHeight - stage.clientHeight);
      stage.scrollLeft = center ? maxLeft / 2 : clamp(ratios.x * stage.scrollWidth - stage.clientWidth / 2, 0, maxLeft);
      stage.scrollTop = top ? 0 : bottom ? maxTop : center ? (state.fit === 'fill' ? maxTop / 2 : 0) : clamp(ratios.y * stage.scrollHeight - stage.clientHeight / 2, 0, maxTop);
      stage.classList.toggle('is-pannable', maxLeft > 1 || maxTop > 1);
    });
  }

  async function renderPages({ preserveView = false, center = false, top = false, bottom = false } = {}) {
    if (!state.document) return;
    const generation = ++state.rendering;
    const container = q('#pdfPages');
    const stage = q('#pdfStage');
    const ratios = preserveView ? viewRatios(stage) : { x: 0.5, y: 0.5 };
    container.classList.toggle('spread', state.spread);
    container.classList.toggle('is-contained', state.fit === 'page');
    container.innerHTML = '';
    const numbers = pageNumbers();
    const ratio = window.devicePixelRatio || 1;
    for (const number of numbers) {
      const page = await state.document.getPage(number);
      if (generation !== state.rendering) return;
      const viewport = page.getViewport({ scale: state.scale * ratio });
      const displayWidth = viewport.width / ratio;
      const displayHeight = viewport.height / ratio;
      const wrapper = document.createElement('article');
      wrapper.className = 'pdf-page';
      wrapper.dataset.page = String(number);
      wrapper.innerHTML = `<canvas aria-label="Seite ${number}"></canvas><span>${number}</span>`;
      const canvas = wrapper.querySelector('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      canvas.style.width = `${displayWidth}px`;
      canvas.style.height = `${displayHeight}px`;
      wrapper.style.width = `${displayWidth}px`;
      wrapper.style.height = `${displayHeight}px`;
      container.appendChild(wrapper);
      await page.render({ canvasContext: canvas.getContext('2d', { alpha: false }), viewport }).promise;
      if (generation !== state.rendering) return;
    }
    updateControls();
    document.querySelectorAll('.pdf-thumb.active').forEach((item) => item.classList.remove('active'));
    q(`[data-pdf-thumb="${state.page}"]`)?.classList.add('active');
    restoreView(stage, ratios, center, top, bottom);
  }

  async function changePage(page, { position = 'top' } = {}) {
    if (!state.document) return;
    state.page = clamp(Math.round(page || 1), 1, state.document.numPages);
    const edge = { top: position === 'top', bottom: position === 'bottom' };
    if (state.fit === 'custom') await renderPages({ center: true, ...edge });
    else {
      state.scale = clamp(await calculateFitScale(state.fit), MIN_SCALE, MAX_SCALE);
      await renderPages({ center: true, ...edge });
    }
  }

  function isAtPageTop(stage) {
    return stage.scrollTop <= 2;
  }

  function isAtPageBottom(stage) {
    return stage.scrollTop + stage.clientHeight >= stage.scrollHeight - 2;
  }

  function pageStep() {
    return state.spread ? 2 : 1;
  }

  function changePageAtVerticalEdge(direction) {
    const stage = q('#pdfStage');
    if (direction > 0 && state.page < state.document.numPages && isAtPageBottom(stage)) {
      changePage(state.page + pageStep(), { position: 'top' });
      return true;
    }
    if (direction < 0 && state.page > 1 && isAtPageTop(stage)) {
      changePage(state.page - pageStep(), { position: 'bottom' });
      return true;
    }
    return false;
  }

  function setScale(scale, render = true) {
    state.fit = 'custom';
    state.scale = clamp(Number(scale || 1), MIN_SCALE, MAX_SCALE);
    updateControls();
    if (render) renderPages({ preserveView: true });
  }

  function buildThumbnails() {
    const list = q('#pdfThumbList');
    list.innerHTML = '';
    for (let number = 1; number <= state.document.numPages; number += 1) {
      const button = document.createElement('button');
      button.className = 'pdf-thumb';
      button.dataset.pdfThumb = String(number);
      button.innerHTML = `<canvas></canvas><span>${number}</span>`;
      button.onclick = () => { changePage(number); if (window.innerWidth < 760) q('#pdfThumbDrawer').classList.add('hidden'); };
      list.appendChild(button);
    }
    state.thumbObserver?.disconnect();
    state.thumbObserver = new IntersectionObserver((entries) => entries.forEach((entry) => {
      if (!entry.isIntersecting || entry.target.dataset.rendered) return;
      entry.target.dataset.rendered = '1';
      renderThumbnail(entry.target, Number(entry.target.dataset.pdfThumb));
    }), { root: q('#pdfThumbDrawer'), rootMargin: '280px 0px' });
    list.querySelectorAll('.pdf-thumb').forEach((button) => state.thumbObserver.observe(button));
  }

  async function renderThumbnail(button, number) {
    if (!state.document) return;
    const page = await state.document.getPage(number);
    const base = page.getViewport({ scale: 1 });
    const scale = 128 / base.width;
    const ratio = window.devicePixelRatio || 1;
    const viewport = page.getViewport({ scale: scale * ratio });
    const canvas = button.querySelector('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    canvas.style.width = `${viewport.width / ratio}px`;
    await page.render({ canvasContext: canvas.getContext('2d', { alpha: false }), viewport }).promise;
  }

  async function toggleFullscreen() {
    const viewer = q('#farbatlasPdfViewer');
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (viewer.requestFullscreen) await viewer.requestFullscreen({ navigationUI: 'hide' });
      else viewer.classList.toggle('pdf-browser-fullscreen');
    } catch {
      viewer.classList.toggle('pdf-browser-fullscreen');
    }
    updateControls();
    setTimeout(handleViewportChange, 80);
  }

  async function handleViewportChange() {
    if (!state.document) return;
    if (state.fit === 'custom') await renderPages({ preserveView: true });
    else await applyFit(state.fit);
  }

  function keyDown(event) {
    if (!state.document || q('#farbatlasPdfViewer')?.classList.contains('hidden')) return;
    if (['INPUT', 'TEXTAREA'].includes(event.target.tagName) && event.target.id !== 'pdfPage') return;
    if (event.key === 'Escape') close();
    else if (event.key === 'ArrowDown' && changePageAtVerticalEdge(1)) event.preventDefault();
    else if (event.key === 'ArrowUp' && changePageAtVerticalEdge(-1)) event.preventDefault();
    else if (['ArrowRight', 'PageDown'].includes(event.key)) changePage(state.page + (state.spread ? 2 : 1));
    else if (['ArrowLeft', 'PageUp'].includes(event.key)) changePage(state.page - (state.spread ? 2 : 1));
    else if (event.key === '+' || event.key === '=') setScale(state.scale + zoomStep());
    else if (event.key === '-') setScale(state.scale - zoomStep());
    else if (event.key === '0') applyFit('page');
  }

  function wheelZoom(event) {
    if (!(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.08 : 1 / 1.08;
    setScale(state.scale * factor);
  }

  function pointerDown(event) {
    const stage = q('#pdfStage');
    stage.setPointerCapture?.(event.pointerId);
    state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (state.pointers.size === 1) {
      state.swipeStart = { x: event.clientX, y: event.clientY, at: Date.now() };
      state.dragStart = { x: event.clientX, y: event.clientY, left: stage.scrollLeft, top: stage.scrollTop, moved: false };
      stage.classList.add('dragging');
    }
    if (state.pointers.size === 2) {
      const [a, b] = [...state.pointers.values()];
      state.pinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
      state.pinchScale = state.scale;
      state.swipeStart = null;
      state.dragStart = null;
    }
  }

  function pointerMove(event) {
    if (!state.pointers.has(event.pointerId)) return;
    state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const stage = q('#pdfStage');
    if (state.pointers.size === 2) {
      event.preventDefault();
      const [a, b] = [...state.pointers.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (state.pinchDistance > 0) {
        state.fit = 'custom';
        state.scale = clamp(state.pinchScale * distance / state.pinchDistance, MIN_SCALE, MAX_SCALE);
        updateControls();
        q('#pdfPages').style.transform = `scale(${state.scale / state.pinchScale})`;
      }
      return;
    }
    if (!state.dragStart) return;
    const dx = event.clientX - state.dragStart.x;
    const dy = event.clientY - state.dragStart.y;
    const canPan = stage.scrollWidth > stage.clientWidth + 1 || stage.scrollHeight > stage.clientHeight + 1;
    if (canPan && Math.hypot(dx, dy) > 5) {
      event.preventDefault();
      state.dragStart.moved = true;
      stage.scrollLeft = state.dragStart.left - dx;
      stage.scrollTop = state.dragStart.top - dy;
    }
  }

  function pointerUp(event) {
    const stored = state.pointers.get(event.pointerId);
    const final = stored && {
      x: Number.isFinite(event.clientX) ? event.clientX : stored.x,
      y: Number.isFinite(event.clientY) ? event.clientY : stored.y,
    };
    const wasPinching = state.pointers.size === 2;
    const wasDragging = Boolean(state.dragStart?.moved);
    state.pointers.delete(event.pointerId);
    q('#pdfStage').classList.remove('dragging');
    if (wasPinching) {
      q('#pdfPages').style.transform = '';
      renderPages({ preserveView: true });
      state.swipeStart = null;
      state.dragStart = null;
      return;
    }
    if (state.swipeStart && final) {
      const elapsed = Date.now() - state.swipeStart.at;
      const dx = final.x - state.swipeStart.x;
      const dy = final.y - state.swipeStart.y;
      const verticalSwipe = Math.abs(dy) > 70 && Math.abs(dy) > Math.abs(dx) * 1.3;
      if (verticalSwipe && changePageAtVerticalEdge(dy < 0 ? 1 : -1)) {
        event.preventDefault();
      } else if (!wasDragging && elapsed < 700 && Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.3) {
        changePage(state.page + (dx < 0 ? 1 : -1));
      }
    }
    state.swipeStart = null;
    state.dragStart = null;
  }

  window.FarbatlasPdfViewer = Object.freeze({ open, close, inspect });
})();
