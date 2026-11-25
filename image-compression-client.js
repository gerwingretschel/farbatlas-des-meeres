/* Farbatlas: administrative, reversible Bildoptimierung */
(() => {
  'use strict';

  const RULES = Object.freeze({ maxBytes: 400 * 1024, preferredMinBytes: 300 * 1024, maxEdge: 1600 });
  const state = { analysis: null, busy: false, stop: false, previewUrls: [] };
  const el = (selector) => document.querySelector(selector);
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
  const formatBytes = (bytes) => {
    const value = Number(bytes || 0);
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(0)} KB`;
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
  };

  function activeAdminToken() {
    const stored = sessionStorage.getItem('farbatlasAdminTokenV09') || '';
    if (stored) return stored;
    return typeof adminToken === 'undefined' ? '' : String(adminToken || '');
  }

  function runtimeDataset() {
    let bridged = null;
    try { bridged = window.FarbatlasRuntime?.getDataset?.() || null; } catch { bridged = null; }
    const globalName = typeof currentDatasetName === 'undefined' ? '' : String(currentDatasetName || '').trim();
    const bridgedName = String(bridged?.name || '').trim();
    const inputName = String(el('#openDatasetName')?.value || el('#saveDatasetName')?.value || '').trim();
    const globalImages = typeof imported === 'undefined' || !Array.isArray(imported) ? [] : imported;
    const bridgedImages = Array.isArray(bridged?.images) ? bridged.images : [];
    const images = (globalImages.length ? globalImages : bridgedImages).filter((item) => item && item.src);
    const globalLoaded = typeof datasetLoaded !== 'undefined' && Boolean(datasetLoaded);
    return {
      name: globalName || bridgedName || inputName,
      images,
      loaded: Boolean(globalLoaded || bridged?.loaded || ((globalName || bridgedName) && images.length)),
    };
  }

  function api(action, data = {}) {
    const token = activeAdminToken();
    if (!token) return Promise.reject(new Error('Administrator-Anmeldung erforderlich.'));
    return fetch('/api/farbatlas', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ action, ...data })
    }).then(async (response) => {
      const text = await response.text();
      let body;
      try { body = JSON.parse(text); } catch { body = { error: text || `HTTP ${response.status}` }; }
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
      return body;
    });
  }

  function currentName() {
    return runtimeDataset().name;
  }

  function currentImages() {
    return runtimeDataset().images;
  }

  function setStatus(message, type = '') {
    const box = el('#imageCompressionStatus');
    if (!box) return;
    box.className = `image-compression-status ${type}`;
    box.textContent = message;
  }

  function setProgress(done, total, message = '') {
    const percent = total ? Math.round(done / total * 100) : 0;
    el('#imageCompressionProgress').style.width = `${percent}%`;
    el('#imageCompressionProgressText').textContent = `${percent} % · ${done} von ${total}${message ? ` · ${message}` : ''}`;
  }

  function setBusy(value, stoppable = false) {
    state.busy = value;
    ['#imageCompressionAnalyze', '#imageCompressionStart', '#imageCompressionRefreshRuns'].forEach((selector) => {
      const button = el(selector);
      if (button) button.disabled = value;
    });
    const stop = el('#imageCompressionStop');
    if (stop) {
      stop.classList.toggle('hidden', !value || !stoppable);
      stop.disabled = false;
    }
  }

  function dataUrlToBlob(source) {
    const match = String(source || '').match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
    if (!match) throw new Error('Bild liegt nicht als lokal geladene Bilddatei vor. Datensatz bitte neu öffnen.');
    const type = match[1] || 'application/octet-stream';
    if (match[2]) {
      const binary = atob(match[3]);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      return new Blob([bytes], { type });
    }
    return new Blob([decodeURIComponent(match[3])], { type });
  }

  const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('Bild konnte nicht gelesen werden.'));
    reader.readAsDataURL(blob);
  });

  const blobToBase64 = async (blob) => String(await blobToDataUrl(blob)).split(',')[1];

  const loadImage = (source) => new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Bild konnte nicht decodiert werden.'));
    image.src = source;
  });

  function canvasFor(image, maxEdge) {
    const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d', { alpha: false });
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  const encodeJpeg = (canvas, quality) => new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('JPEG konnte nicht erzeugt werden.')), 'image/jpeg', quality);
  });

  async function optimizeImage(item) {
    const image = await loadImage(item.source.src);
    let edge = Math.min(RULES.maxEdge, Math.max(image.naturalWidth, image.naturalHeight));
    let canvas;
    let lowest;
    for (let resize = 0; resize < 8; resize += 1) {
      canvas = canvasFor(image, edge);
      const highBlob = await encodeJpeg(canvas, 0.94);
      if (highBlob.size <= RULES.maxBytes) {
        return { blob: highBlob, width: canvas.width, height: canvas.height, quality: 0.94 };
      }
      lowest = await encodeJpeg(canvas, 0.42);
      if (lowest.size <= RULES.maxBytes) {
        let low = 0.42;
        let high = 0.94;
        let best = lowest;
        let bestQuality = low;
        for (let attempt = 0; attempt < 8; attempt += 1) {
          const quality = (low + high) / 2;
          const candidate = await encodeJpeg(canvas, quality);
          if (candidate.size <= RULES.maxBytes) {
            best = candidate;
            bestQuality = quality;
            low = quality;
          } else {
            high = quality;
          }
        }
        return { blob: best, width: canvas.width, height: canvas.height, quality: bestQuality };
      }
      edge = Math.max(640, Math.floor(edge * 0.86));
    }
    throw new Error(`Bild bleibt auch nach Verkleinerung größer als ${formatBytes(RULES.maxBytes)}.`);
  }

  async function inspectImage(source, index, total) {
    setProgress(index, total, source.name || `Bild ${index + 1}`);
    const blob = dataUrlToBlob(source.src);
    const image = await loadImage(source.src);
    const type = String(blob.type || '').toLowerCase();
    const maxEdge = Math.max(image.naturalWidth, image.naturalHeight);
    const compliant = /^image\/jpe?g$/.test(type) && blob.size <= RULES.maxBytes && maxEdge <= RULES.maxEdge;
    const reasons = [];
    if (blob.size > RULES.maxBytes) reasons.push(`Dateigröße ${formatBytes(blob.size)}`);
    if (maxEdge > RULES.maxEdge) reasons.push(`Kantenlänge ${maxEdge} px`);
    if (!/^image\/jpe?g$/.test(type)) reasons.push(`Format ${type || 'unbekannt'}`);
    if (!source.imageKey) reasons.push('kein V10-Bildschlüssel');
    return {
      source,
      size: blob.size,
      type,
      width: image.naturalWidth,
      height: image.naturalHeight,
      compliant: compliant && Boolean(source.imageKey),
      reasons,
    };
  }

  function renderMetrics(analysis) {
    const originalBytes = analysis.items.reduce((sum, item) => sum + item.size, 0);
    el('#imageCompressionMetrics').innerHTML = [
      ['Geprüft', analysis.items.length],
      ['Regelkonform', analysis.compliant.length],
      ['Zu optimieren', analysis.candidates.length],
      ['Nicht lesbar', analysis.failed.length],
      ['Aktuelle Größe', formatBytes(originalBytes)]
    ].map(([label, value]) => `<div class="image-compression-metric"><b>${escapeHtml(value)}</b>${escapeHtml(label)}</div>`).join('');
    el('#imageCompressionStart').disabled = state.busy || !analysis.candidates.length || analysis.failed.length > 0;
    const details = analysis.candidates.slice(0, 100).map((item) =>
      `<tr><td>${escapeHtml(item.source.name || item.source.imageKey)}</td><td>${formatBytes(item.size)}</td><td>${item.width} × ${item.height}</td><td>${escapeHtml(item.reasons.join(', '))}</td></tr>`
    ).join('');
    el('#imageCompressionTable').innerHTML = details || '<tr><td colspan="4">Alle Bilder erfüllen die Regeln.</td></tr>';
  }

  function clearPreviewUrls() {
    state.previewUrls.forEach((url) => URL.revokeObjectURL(url));
    state.previewUrls = [];
  }

  async function renderPreview(candidates) {
    clearPreviewUrls();
    const box = el('#imageCompressionPreview');
    box.innerHTML = '';
    for (const item of candidates.slice(0, 3)) {
      try {
        const result = await optimizeImage(item);
        const before = item.source.src;
        const after = URL.createObjectURL(result.blob);
        state.previewUrls.push(after);
        box.insertAdjacentHTML('beforeend', `<article class="image-compression-preview-card">
          <h5>${escapeHtml(item.source.name || 'Bild')}</h5>
          <div class="image-compression-preview-pair"><figure><img src="${escapeHtml(before)}" alt="Vorher"><figcaption>Vorher · ${formatBytes(item.size)} · ${item.width} × ${item.height}</figcaption></figure><figure><img src="${escapeHtml(after)}" alt="Vorschau"><figcaption>Vorschau · ${formatBytes(result.blob.size)} · ${result.width} × ${result.height}</figcaption></figure></div>
        </article>`);
      } catch (error) {
        box.insertAdjacentHTML('beforeend', `<p class="image-compression-error">${escapeHtml(error.message)}</p>`);
      }
    }
  }

  async function analyze() {
    if (state.busy) return;
    const context = runtimeDataset();
    const { name, images } = context;
    if (!name || !context.loaded) {
      setStatus('Bitte zuerst den gewünschten Datensatz öffnen.', 'error');
      return;
    }
    if (!images.length) {
      setStatus('Der geladene Datensatz enthält keine Bilder.', 'error');
      return;
    }
    setBusy(true);
    state.analysis = null;
    el('#imageCompressionStart').disabled = true;
    setStatus(`Alle ${images.length} Bilder werden geprüft …`);
    const items = [];
    const failed = [];
    try {
      for (let index = 0; index < images.length; index += 1) {
        try { items.push(await inspectImage(images[index], index, images.length)); }
        catch (error) { failed.push({ source: images[index], error: error.message }); }
      }
      const compliant = items.filter((item) => item.compliant);
      const candidates = items.filter((item) => !item.compliant);
      state.analysis = { name, items, compliant, candidates, failed };
      renderMetrics(state.analysis);
      setProgress(images.length, images.length, 'Prüfung abgeschlossen');
      if (failed.length) {
        setStatus(`${items.length} Bilder geprüft; ${failed.length} Bilder konnten nicht gelesen werden. Vor der Komprimierung bitte neu laden oder prüfen.`, 'error');
      } else if (!candidates.length) {
        setStatus('Alle Bilder erfüllen bereits die festgelegten Regeln. Es wurde nichts verändert.', 'success');
      } else {
        setStatus(`${candidates.length} von ${items.length} Bildern werden für die sichere Komprimierung vorgeschlagen. Noch wurde nichts verändert.`, 'warning');
        await renderPreview(candidates);
      }
      await loadRuns();
    } finally {
      setBusy(false);
      if (state.analysis) el('#imageCompressionStart').disabled = !state.analysis.candidates.length || state.analysis.failed.length > 0;
    }
  }

  async function compressAll() {
    const analysis = state.analysis;
    if (!analysis || state.busy || !analysis.candidates.length) return;
    if (analysis.name !== currentName()) {
      setStatus('Der geladene Datensatz hat sich geändert. Bitte erneut prüfen.', 'error');
      return;
    }
    const confirmation = prompt(`Zur Sicherheitsbestätigung den Datensatznamen exakt eingeben:\n${analysis.name}`);
    if (confirmation !== analysis.name) {
      setStatus('Komprimierung wurde nicht gestartet.', 'warning');
      return;
    }
    setBusy(true, true);
    state.stop = false;
    let completed = 0;
    let failed = 0;
    let compressedBytes = 0;
    const originalBytes = analysis.items.reduce((sum, item) => sum + item.size, 0);
    try {
      const started = await api('image-compression-start', {
        name: analysis.name,
        candidateCount: analysis.candidates.length
      });
      const runId = started.run.runId;
      setStatus(started.resumed ? 'Unterbrochener Sicherungslauf wird fortgesetzt …' : 'Sicherungsstand wurde angelegt. Komprimierung startet …');
      for (let index = 0; index < analysis.candidates.length; index += 1) {
        if (state.stop) {
          setStatus('Sicher angehalten. Bereits bearbeitete Bilder bleiben gesichert; der Lauf kann später fortgesetzt oder wiederhergestellt werden.', 'warning');
          return;
        }
        const item = analysis.candidates[index];
        setProgress(index, analysis.candidates.length, item.source.name || `Bild ${index + 1}`);
        try {
          if (!item.source.imageKey) throw new Error('V10-Bildschlüssel fehlt. Datensatz bitte neu speichern und erneut öffnen.');
          const result = await optimizeImage(item);
          const base64 = await blobToBase64(result.blob);
          await api('image-compression-replace', {
            runId,
            imageKey: item.source.imageKey,
            type: 'image/jpeg',
            data: base64,
            originalDimensions: { width: item.width, height: item.height },
            compressedDimensions: { width: result.width, height: result.height }
          });
          item.source.src = await blobToDataUrl(result.blob);
          item.source.file = undefined;
          completed += 1;
          compressedBytes += result.blob.size;
        } catch (error) {
          failed += 1;
          setStatus(`Bild ${index + 1} wurde übersprungen: ${error.message}`, 'error');
        }
      }
      const compliantBytes = analysis.compliant.reduce((sum, item) => sum + item.size, 0);
      await api('image-compression-finish', {
        runId,
        analysis: {
          checked: analysis.items.length,
          compliant: analysis.compliant.length,
          candidates: analysis.candidates.length,
          failed,
          originalBytes,
          compressedBytes: compliantBytes + compressedBytes
        }
      });
      if (typeof rebuild === 'function') rebuild();
      if (typeof scheduleDatasetCache === 'function') scheduleDatasetCache();
      setProgress(analysis.candidates.length, analysis.candidates.length, 'abgeschlossen');
      setStatus(`${completed} Bilder wurden gesichert und komprimiert${failed ? `; ${failed} Bilder wurden übersprungen` : ''}. Der Sicherungsstand bleibt für „Rückgängig“ erhalten.`, failed ? 'warning' : 'success');
      state.analysis = null;
      el('#imageCompressionStart').disabled = true;
      await loadRuns();
    } catch (error) {
      setStatus(`Komprimierung abgebrochen: ${error.message}`, 'error');
    } finally {
      setBusy(false);
    }
  }

  function runLabel(run) {
    const date = run.createdAt ? new Date(run.createdAt).toLocaleString('de-DE') : 'ohne Datum';
    const labels = {
      running: 'unterbrochen / fortsetzbar',
      completed: 'abgeschlossen',
      'completed-with-errors': 'abgeschlossen mit Hinweisen',
      restoring: 'Wiederherstellung läuft',
      restored: 'wiederhergestellt',
      'restore-partial': 'teilweise wiederhergestellt'
    };
    return `${date} · ${labels[run.status] || run.status}`;
  }

  async function loadRuns() {
    const context = runtimeDataset();
    const name = context.name;
    const box = el('#imageCompressionRuns');
    if (!box) return;
    if (!name || !context.loaded || !activeAdminToken()) {
      box.innerHTML = '<p>Datensatz öffnen und als Administrator anmelden, um Sicherungsstände anzuzeigen.</p>';
      return;
    }
    try {
      const response = await api('image-compression-runs', { name });
      box.innerHTML = response.runs.length ? response.runs.map((run) => {
        const restorable = run.status !== 'restored' && (run.counts.compressed + run.counts.backedUp > 0);
        return `<article class="image-compression-run"><div><b>${escapeHtml(runLabel(run))}</b><div>${run.counts.compressed} komprimiert · ${run.counts.restored} wiederhergestellt · ${run.candidateCount} vorgesehen</div></div>${restorable ? `<button class="btn bad" data-restore-run="${escapeHtml(run.runId)}">Sicherungsstand wiederherstellen</button>` : ''}</article>`;
      }).join('') : '<p>Noch keine Sicherungsstände für diesen Datensatz.</p>';
      box.querySelectorAll('[data-restore-run]').forEach((button) => {
        button.onclick = () => restoreRun(button.dataset.restoreRun);
      });
    } catch (error) {
      box.innerHTML = `<p class="image-compression-error">${escapeHtml(error.message)}</p>`;
    }
  }

  async function restoreRun(runId) {
    if (state.busy) return;
    const confirmation = prompt('Zum vollständigen Rückgängigmachen exakt WIEDERHERSTELLEN eingeben:');
    if (confirmation !== 'WIEDERHERSTELLEN') {
      setStatus('Wiederherstellung wurde nicht gestartet.', 'warning');
      return;
    }
    setBusy(true, true);
    state.stop = false;
    try {
      const response = await api('image-compression-get-run', { runId });
      const items = response.run.items.filter((item) => ['compressed', 'backed-up', 'conflict'].includes(item.state));
      if (!items.length) {
        setStatus('In diesem Lauf sind keine Bilder wiederherzustellen.', 'warning');
        return;
      }
      let restored = 0;
      let failed = 0;
      for (let index = 0; index < items.length; index += 1) {
        if (state.stop) {
          setStatus('Wiederherstellung sicher angehalten. Sie kann über denselben Sicherungsstand fortgesetzt werden.', 'warning');
          return;
        }
        setProgress(index, items.length, items[index].fileName || `Bild ${index + 1}`);
        try {
          await api('image-compression-restore-item', { runId, imageKey: items[index].imageKey });
          restored += 1;
        } catch (error) {
          failed += 1;
          setStatus(`Bild ${index + 1} wurde geschützt übersprungen: ${error.message}`, 'error');
        }
      }
      await api('image-compression-restore-finish', { runId });
      setProgress(items.length, items.length, 'Wiederherstellung abgeschlossen');
      setStatus(`${restored} Originalbilder wurden wiederhergestellt${failed ? `; ${failed} Bilder wurden wegen Konflikten nicht überschrieben` : ''}. Bitte den Datensatz neu öffnen, damit die Originale wieder angezeigt werden.`, failed ? 'warning' : 'success');
      await loadRuns();
    } catch (error) {
      setStatus(`Wiederherstellung abgebrochen: ${error.message}`, 'error');
    } finally {
      setBusy(false);
    }
  }

  function integrationStatus() {
    const context = runtimeDataset();
    return {
      datasetName: context.name,
      datasetLoaded: context.loaded,
      imageCount: context.images.length,
      adminActive: Boolean(activeAdminToken()),
      bridgeActive: Boolean(window.FarbatlasRuntime?.getDataset),
    };
  }

  function refreshIntegration() {
    if (!el('#imageCompressionPanel')?.classList.contains('hidden')) loadRuns();
  }

  function installUi() {
    const anchor = el('#datasetAdminPanel');
    if (!anchor || el('#imageCompressionToggle')) return;
    const style = document.createElement('style');
    style.textContent = `
      .image-compression-toggle{width:100%;border:0;border-radius:15px;padding:15px 18px;background:#a65b16;color:#fff;font-size:18px;font-weight:800;text-align:left;margin-top:14px}
      .image-compression-panel{margin-top:12px;padding:16px;border:1px solid #e0c29f;border-radius:14px;background:#fffaf3}
      .image-compression-panel h3,.image-compression-panel h4{margin:8px 0}.image-compression-rules{padding:11px;border-radius:11px;background:#fff0da}
      .image-compression-actions{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}.image-compression-track{height:15px;background:#dfd7ca;border-radius:999px;overflow:hidden}.image-compression-progress{height:100%;width:0;background:linear-gradient(90deg,#e39a43,#16885a)}
      .image-compression-status{margin:10px 0;padding:10px;border-radius:10px;background:#e8f6f7}.image-compression-status.success{background:#e3f7e9;color:#125b31}.image-compression-status.warning{background:#fff2cc;color:#665000}.image-compression-status.error,.image-compression-error{background:#ffe5e5;color:#811d1d}
      .image-compression-metrics{display:grid;grid-template-columns:repeat(5,1fr);gap:7px;margin:12px 0}.image-compression-metric{text-align:center;padding:9px;border-radius:10px;background:#fff}.image-compression-metric b{display:block;font-size:19px}
      .image-compression-table-wrap{max-height:300px;overflow:auto}.image-compression-table{width:100%;border-collapse:collapse;font-size:13px}.image-compression-table th,.image-compression-table td{padding:7px;border-bottom:1px solid #eadbc8;text-align:left;overflow-wrap:anywhere}
      .image-compression-preview{display:grid;gap:10px}.image-compression-preview-card{padding:10px;border:1px solid #eadbc8;border-radius:12px;background:#fff}.image-compression-preview-card h5{margin:0 0 8px;overflow-wrap:anywhere}.image-compression-preview-pair{display:grid;grid-template-columns:1fr 1fr;gap:8px}.image-compression-preview-pair figure{margin:0}.image-compression-preview-pair img{width:100%;height:180px;object-fit:contain;background:#062d40;border-radius:9px}.image-compression-preview-pair figcaption{font-size:12px;margin-top:4px}
      .image-compression-runs{display:grid;gap:8px}.image-compression-run{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center;padding:10px;border:1px solid #eadbc8;border-radius:11px;background:#fff}
      @media(max-width:750px){.image-compression-metrics{grid-template-columns:repeat(2,1fr)}.image-compression-preview-pair,.image-compression-run{grid-template-columns:1fr}.image-compression-preview-pair img{height:140px}}
    `;
    document.head.appendChild(style);
    anchor.insertAdjacentHTML('afterend', `<button id="imageCompressionToggle" class="image-compression-toggle">🗜️ Bilder prüfen, komprimieren &amp; wiederherstellen</button>
      <section id="imageCompressionPanel" class="image-compression-panel hidden">
        <div class="collapse-row"><button id="imageCompressionClose" class="btn">✕ Zuklappen</button></div>
        <h3>Geladene Bilderdatenbank sicher optimieren</h3>
        <div class="image-compression-rules"><b>Verbindliche Regeln:</b> JPEG · höchstens 400 KB · längste Kante höchstens 1.600 Pixel · keine Vergrößerung. Bereits passende Bilder bleiben unverändert. Vor jedem Austausch wird das aktuelle Serverbild gesichert.</div>
        <div class="image-compression-actions"><button id="imageCompressionAnalyze" class="btn primary">Alle Bilder prüfen &amp; Vorschau</button><button id="imageCompressionStart" class="btn good" disabled>Alle vorgeschlagenen Bilder sicher komprimieren</button><button id="imageCompressionStop" class="btn bad hidden">Nach aktuellem Bild anhalten</button></div>
        <div class="image-compression-track"><div id="imageCompressionProgress" class="image-compression-progress"></div></div><div id="imageCompressionProgressText" class="statusline">0 %</div>
        <div id="imageCompressionStatus" class="image-compression-status">Noch keine Prüfung durchgeführt.</div>
        <div id="imageCompressionMetrics" class="image-compression-metrics"></div>
        <details><summary>Prüfergebnis je betroffenem Bild</summary><div class="image-compression-table-wrap"><table class="image-compression-table"><thead><tr><th>Bild</th><th>Größe</th><th>Pixel</th><th>Grund</th></tr></thead><tbody id="imageCompressionTable"></tbody></table></div></details>
        <details open><summary>Vorher-/Nachher-Vorschau (bis zu 3 Bilder)</summary><div id="imageCompressionPreview" class="image-compression-preview"></div></details>
        <hr><h4>Sicherungsstände / Rückgängig</h4><div class="image-compression-actions"><button id="imageCompressionRefreshRuns" class="btn">Sicherungsstände aktualisieren</button></div><div id="imageCompressionRuns" class="image-compression-runs"></div>
      </section>`);
    el('#imageCompressionToggle').onclick = () => {
      el('#imageCompressionPanel').classList.toggle('hidden');
      if (!el('#imageCompressionPanel').classList.contains('hidden')) loadRuns();
    };
    el('#imageCompressionClose').onclick = () => el('#imageCompressionPanel').classList.add('hidden');
    el('#imageCompressionAnalyze').onclick = analyze;
    el('#imageCompressionStart').onclick = compressAll;
    el('#imageCompressionStop').onclick = () => { state.stop = true; el('#imageCompressionStop').disabled = true; };
    el('#imageCompressionRefreshRuns').onclick = loadRuns;
    window.addEventListener('farbatlas:dataset-changed', () => {
      state.analysis = null;
      el('#imageCompressionStart').disabled = true;
      setStatus('Datensatz erkannt. Die Bildprüfung kann gestartet werden.');
      refreshIntegration();
    });
    if (typeof MutationObserver !== 'undefined') {
      new MutationObserver(refreshIntegration).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    }
  }

  window.FarbatlasImageCompressionIntegration = Object.freeze({
    diagnose: integrationStatus,
    refresh: refreshIntegration,
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installUi);
  else installUi();
})();
