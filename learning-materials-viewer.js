/* Farbatlas PDF viewer: responsive single/two-page reading, thumbnails, zoom and fullscreen */
(() => {
  'use strict';

  const state = {
    pdfjs: null,
    document: null,
    blob: null,
    meta: null,
    page: 1,
    spread: false,
    scale: 1,
    fit: 'width',
    rendering: 0,
    pointers: new Map(),
    pinchDistance: 0,
    pinchScale: 1,
    swipeStart: null,
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
          <button id="pdfClose" class="pdf-icon" title="Viewer schließen">✕</button>
          <div class="pdf-title"><strong id="pdfTitle">PDF</strong><span id="pdfStatus"></span></div>
          <button id="pdfThumbnails" class="pdf-icon" title="Miniaturansichten">▦</button>
          <button id="pdfPrevious" class="pdf-icon" title="Vorherige Seite">‹</button>
          <label class="pdf-page-field"><input id="pdfPage" type="number" min="1" value="1" aria-label="Seite"><span id="pdfPageCount">/ 1</span></label>
          <button id="pdfNext" class="pdf-icon" title="Nächste Seite">›</button>
          <button id="pdfZoomOut" class="pdf-icon" title="Verkleinern">−</button>
          <input id="pdfZoom" class="pdf-zoom" type="range" min="40" max="350" step="5" value="100" aria-label="Zoom">
          <button id="pdfZoomIn" class="pdf-icon" title="Vergrößern">+</button>
          <button id="pdfFitWidth" class="pdf-tool" title="Seitenbreite anpassen">Breite</button>
          <button id="pdfFitPage" class="pdf-tool" title="Ganze Seite einpassen">Seite</button>
          <button id="pdfSpread" class="pdf-tool" title="Ein- oder Zweiseitenansicht">1 Seite</button>
          <button id="pdfFullscreen" class="pdf-icon" title="Vollbild">⛶</button>
        </header>
        <div class="pdf-body">
          <aside id="pdfThumbDrawer" class="pdf-thumbs hidden" aria-label="Seitenminiaturen"><div id="pdfThumbList"></div></aside>
          <main id="pdfStage" class="pdf-stage" tabindex="0"><div id="pdfPages" class="pdf-pages"></div></main>
        </div>
      </section>`);
    q('#pdfClose').onclick = close;
    q('#pdfPrevious').onclick = () => changePage(state.page - (state.spread ? 2 : 1));
    q('#pdfNext').onclick = () => changePage(state.page + (state.spread ? 2 : 1));
    q('#pdfPage').onchange = (event) => changePage(Number(event.target.value));
    q('#pdfZoomOut').onclick = () => setScale(state.scale - 0.1);
    q('#pdfZoomIn').onclick = () => setScale(state.scale + 0.1);
    q('#pdfZoom').oninput = (event) => setScale(Number(event.target.value) / 100, false);
    q('#pdfZoom').onchange = () => renderPages();
    q('#pdfFitWidth').onclick = () => { state.fit = 'width'; renderPages(); };
    q('#pdfFitPage').onclick = () => { state.fit = 'page'; renderPages(); };
    q('#pdfSpread').onclick = () => { state.spread = !state.spread; q('#pdfSpread').textContent = state.spread ? '2 Seiten' : '1 Seite'; renderPages(); };
    q('#pdfThumbnails').onclick = () => q('#pdfThumbDrawer').classList.toggle('hidden');
    q('#pdfFullscreen').onclick = toggleFullscreen;
    const stage = q('#pdfStage');
    stage.addEventListener('pointerdown', pointerDown);
    stage.addEventListener('pointermove', pointerMove);
    stage.addEventListener('pointerup', pointerUp);
    stage.addEventListener('pointercancel', pointerUp);
    stage.addEventListener('wheel', wheelZoom, { passive: false });
    window.addEventListener('keydown', keyDown);
    window.addEventListener('resize', debounce(() => state.document && renderPages(), 180));
    screen.orientation?.addEventListener?.('change', () => setTimeout(() => state.document && renderPages(), 180));
  }

  function debounce(fn, delay) {
    let timer;
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); };
  }

  function updateControls() {
    if (!state.document) return;
    q('#pdfPage').value = String(state.page);
    q('#pdfPage').max = String(state.document.numPages);
    q('#pdfPageCount').textContent = `/ ${state.document.numPages}`;
    q('#pdfPrevious').disabled = state.page <= 1;
    q('#pdfNext').disabled = state.page >= state.document.numPages;
    q('#pdfZoom').value = String(Math.round(state.scale * 100));
    q('#pdfStatus').textContent = `${Math.round(state.scale * 100)} %${state.meta?.offline ? ' · offline' : ''}`;
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
    state.fit = 'width';
    q('#pdfSpread').textContent = '1 Seite';
    try {
      const library = await pdfJs();
      const bytes = new Uint8Array(await blob.arrayBuffer());
      state.document = await library.getDocument({ data: bytes }).promise;
      state.page = clamp(state.page, 1, state.document.numPages);
      buildThumbnails();
      await renderPages();
      q('#pdfStage').focus();
    } catch (error) {
      q('#pdfPages').innerHTML = `<div class="pdf-error"><h2>PDF konnte nicht geöffnet werden</h2><p>${escapeHtml(error.message || String(error))}</p></div>`;
      q('#pdfStatus').textContent = 'Fehler';
    }
  }

  async function inspect(blob) {
    const library = await pdfJs();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const document = await library.getDocument({ data: bytes }).promise;
    const pageCount = document.numPages;
    await document.destroy();
    return { pageCount };
  }

  async function close() {
    q('#farbatlasPdfViewer')?.classList.add('hidden');
    document.body.classList.remove('pdf-viewer-open');
    state.thumbObserver?.disconnect();
    state.thumbObserver = null;
    if (state.document) await state.document.destroy().catch(() => {});
    state.document = null;
    state.blob = null;
    state.meta = null;
  }

  function pageNumbers() {
    if (!state.spread) return [state.page];
    const first = state.page === 1 ? 1 : state.page % 2 === 0 ? state.page : state.page - 1;
    return [first, first + 1].filter((page) => page <= state.document.numPages);
  }

  async function fitScale(page) {
    const base = page.getViewport({ scale: 1 });
    const stage = q('#pdfStage');
    const availableWidth = Math.max(180, stage.clientWidth - (state.spread ? 44 : 32));
    const availableHeight = Math.max(180, stage.clientHeight - 32);
    const pageWidth = state.spread ? availableWidth / 2 : availableWidth;
    return state.fit === 'page'
      ? Math.min(pageWidth / base.width, availableHeight / base.height)
      : pageWidth / base.width;
  }

  async function renderPages() {
    if (!state.document) return;
    const generation = ++state.rendering;
    const container = q('#pdfPages');
    const oldScrollLeft = q('#pdfStage').scrollLeft;
    const oldScrollTop = q('#pdfStage').scrollTop;
    container.classList.toggle('spread', state.spread);
    container.innerHTML = '';
    const numbers = pageNumbers();
    for (const number of numbers) {
      const page = await state.document.getPage(number);
      if (generation !== state.rendering) return;
      const automatic = await fitScale(page);
      const effectiveScale = state.fit ? automatic * state.scale : state.scale;
      const viewport = page.getViewport({ scale: clamp(effectiveScale, 0.15, 6) * (window.devicePixelRatio || 1) });
      const displayWidth = viewport.width / (window.devicePixelRatio || 1);
      const displayHeight = viewport.height / (window.devicePixelRatio || 1);
      const wrapper = document.createElement('article');
      wrapper.className = 'pdf-page';
      wrapper.dataset.page = String(number);
      wrapper.innerHTML = `<canvas aria-label="Seite ${number}"></canvas><span>${number}</span>`;
      const canvas = wrapper.querySelector('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      canvas.style.width = `${displayWidth}px`;
      canvas.style.height = `${displayHeight}px`;
      container.appendChild(wrapper);
      await page.render({ canvasContext: canvas.getContext('2d', { alpha: false }), viewport }).promise;
      if (generation !== state.rendering) return;
    }
    q('#pdfStage').scrollLeft = oldScrollLeft;
    q('#pdfStage').scrollTop = oldScrollTop;
    updateControls();
    document.querySelectorAll('.pdf-thumb.active').forEach((item) => item.classList.remove('active'));
    q(`[data-pdf-thumb="${state.page}"]`)?.classList.add('active');
  }

  function changePage(page) {
    if (!state.document) return;
    state.page = clamp(Math.round(page || 1), 1, state.document.numPages);
    q('#pdfStage').scrollTo({ top: 0, left: 0, behavior: 'smooth' });
    renderPages();
  }

  function setScale(scale, render = true) {
    state.scale = clamp(Number(scale || 1), 0.4, 3.5);
    updateControls();
    if (render) renderPages();
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
    const viewport = page.getViewport({ scale: scale * (window.devicePixelRatio || 1) });
    const canvas = button.querySelector('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    canvas.style.width = `${viewport.width / (window.devicePixelRatio || 1)}px`;
    await page.render({ canvasContext: canvas.getContext('2d', { alpha: false }), viewport }).promise;
  }

  async function toggleFullscreen() {
    const viewer = q('#farbatlasPdfViewer');
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (viewer.requestFullscreen) await viewer.requestFullscreen();
      else viewer.classList.toggle('pdf-browser-fullscreen');
    } catch {
      viewer.classList.toggle('pdf-browser-fullscreen');
    }
  }

  function keyDown(event) {
    if (!state.document || q('#farbatlasPdfViewer')?.classList.contains('hidden')) return;
    if (['INPUT', 'TEXTAREA'].includes(event.target.tagName) && event.target.id !== 'pdfPage') return;
    if (event.key === 'Escape') close();
    else if (['ArrowRight', 'PageDown'].includes(event.key)) changePage(state.page + (state.spread ? 2 : 1));
    else if (['ArrowLeft', 'PageUp'].includes(event.key)) changePage(state.page - (state.spread ? 2 : 1));
    else if (event.key === '+' || event.key === '=') setScale(state.scale + 0.1);
    else if (event.key === '-') setScale(state.scale - 0.1);
  }

  function wheelZoom(event) {
    if (!(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    setScale(state.scale + (event.deltaY < 0 ? 0.08 : -0.08));
  }

  function pointerDown(event) {
    q('#pdfStage').setPointerCapture?.(event.pointerId);
    state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (state.pointers.size === 1) state.swipeStart = { x: event.clientX, y: event.clientY, at: Date.now() };
    if (state.pointers.size === 2) {
      const [a, b] = [...state.pointers.values()];
      state.pinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
      state.pinchScale = state.scale;
      state.swipeStart = null;
    }
  }

  function pointerMove(event) {
    if (!state.pointers.has(event.pointerId)) return;
    state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (state.pointers.size !== 2) return;
    const [a, b] = [...state.pointers.values()];
    const distance = Math.hypot(a.x - b.x, a.y - b.y);
    if (state.pinchDistance > 0) {
      state.scale = clamp(state.pinchScale * distance / state.pinchDistance, 0.4, 3.5);
      updateControls();
      q('#pdfPages').style.transform = `scale(${state.scale / state.pinchScale})`;
    }
  }

  function pointerUp(event) {
    const final = state.pointers.get(event.pointerId);
    const wasPinching = state.pointers.size === 2;
    state.pointers.delete(event.pointerId);
    if (wasPinching) {
      q('#pdfPages').style.transform = '';
      renderPages();
      state.swipeStart = null;
      return;
    }
    if (state.swipeStart && final && state.scale <= 1.15 && Date.now() - state.swipeStart.at < 700) {
      const dx = final.x - state.swipeStart.x;
      const dy = final.y - state.swipeStart.y;
      if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.3) changePage(state.page + (dx < 0 ? 1 : -1));
    }
    state.swipeStart = null;
  }

  window.FarbatlasPdfViewer = Object.freeze({ open, close, inspect });
})();
