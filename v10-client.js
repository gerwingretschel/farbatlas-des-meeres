/* Farbatlas V11: Unterrichtsbilder, Thumbnails, Lazy Loading und Offline-Bibliothek */
(() => {
  'use strict';

  const VERSION = 11;
  const RULES = Object.freeze({
    teachingMaxEdge: 1600,
    teachingMaxBytes: 400 * 1024,
    thumbnailMaxEdge: 480,
    thumbnailMaxBytes: 80 * 1024,
    thumbnailTargetMinBytes: 30 * 1024,
  });
  const DATA_SAVER_KEY = 'farbatlas.dataSaver.v1';
  const OFFLINE_DB = 'farbatlas-offline-library-v1';
  const OFFLINE_STORE = 'assets';
  const MANIFEST_STORE = 'manifests';
  const THUMBNAIL_PREFETCH_NEXT = 5;
  const THUMBNAIL_PREFETCH_PREVIOUS = 2;
  const PLACEHOLDER = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="480" viewBox="0 0 480 480"><rect width="480" height="480" fill="#dceef1"/><path d="M95 325l82-91 67 67 45-49 96 103H95z" fill="#8bbec6"/><circle cx="325" cy="145" r="42" fill="#acd5da"/><text x="240" y="410" text-anchor="middle" font-family="Arial,sans-serif" font-size="24" fill="#376b74">Vorschaubild wird geladen</text></svg>'
  );
  const q = (selector) => document.querySelector(selector);
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
  const formatBytes = (bytes) => {
    const value = Number(bytes || 0);
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
  };
  const session = { name: '', password: '', payload: null };
  const memoryUrls = new Map();
  const inflight = new Map();
  const observedImages = new WeakSet();
  let galleryGeneration = 0;
  let thumbnailPrefetchGeneration = 0;
  let importPreparation = null;
  let dataSaver = typeof localStorage !== 'undefined' && localStorage.getItem(DATA_SAVER_KEY) === '1';

  function activeToken() {
    return sessionStorage.getItem('farbatlasAdminTokenV09') || (typeof adminToken === 'undefined' ? '' : String(adminToken || ''));
  }

  async function api(action, data = {}) {
    const token = activeToken();
    const response = await fetch('/api/farbatlas', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify({ action, ...data })
    });
    const text = await response.text();
    let body;
    try { body = JSON.parse(text); } catch { body = { error: text || `HTTP ${response.status}` }; }
    if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
    return body;
  }

  function dbOpen() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(OFFLINE_DB, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(OFFLINE_STORE)) request.result.createObjectStore(OFFLINE_STORE);
        if (!request.result.objectStoreNames.contains(MANIFEST_STORE)) request.result.createObjectStore(MANIFEST_STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function dbGet(storeName, key) {
    const db = await dbOpen();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readonly');
        const request = transaction.objectStore(storeName).get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally { db.close(); }
  }

  async function dbPut(storeName, key, value) {
    const db = await dbOpen();
    try {
      await new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readwrite');
        transaction.objectStore(storeName).put(value, key);
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
      });
    } finally { db.close(); }
  }

  const cacheKey = (name, variant, key) => `${String(name || '').toLowerCase()}|${variant}|${key}`;

  function base64ToBlob(data, type) {
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return new Blob([bytes], { type: type || 'image/jpeg' });
  }

  const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('Bild konnte nicht gelesen werden.'));
    reader.readAsDataURL(blob);
  });
  const blobToBase64 = async (blob) => String(await blobToDataUrl(blob)).split(',')[1];

  function itemFor(recordOrName) {
    const name = typeof recordOrName === 'string' ? recordOrName : recordOrName?.name;
    return (typeof imported === 'undefined' || !Array.isArray(imported))
      ? null
      : imported.find((item) => item?.name === name) || null;
  }

  async function assetBlob(item, variant, { allowNetwork = true } = {}) {
    const localField = variant === 'thumbnail' ? 'thumbnailBlob' : 'teachingBlob';
    const sourceField = variant === 'thumbnail' ? 'thumbnailSrc' : 'src';
    const keyField = variant === 'thumbnail' ? 'thumbnailKey' : 'imageKey';
    if (item?.[localField] instanceof Blob) return item[localField];
    if (!item?.[keyField] && /^data:/i.test(String(item?.[sourceField] || ''))) {
      return fetch(item[sourceField]).then((response) => response.blob());
    }
    const key = item?.[keyField];
    if (!key) throw new Error(variant === 'thumbnail' ? 'Für dieses Bild fehlt noch ein Vorschaubild.' : 'Unterrichtsbild fehlt.');
    const storageKey = cacheKey(session.name || currentDatasetName, variant, key);
    const cached = await dbGet(OFFLINE_STORE, storageKey).catch(() => null);
    if (cached instanceof Blob) return cached;
    if (!allowNetwork) {
      throw new Error('Dieses Bild wurde nicht für die Offline-Nutzung vorbereitet. Stelle eine Internetverbindung her und starte die Vorbereitung erneut.');
    }
    const response = await api('get-image', {
      name: session.name || currentDatasetName,
      password: session.password,
      imageKey: key,
    });
    const blob = base64ToBlob(response.data, response.type);
    await dbPut(OFFLINE_STORE, storageKey, blob).catch(() => {});
    return blob;
  }

  async function assetUrl(item, variant, options) {
    const keyField = variant === 'thumbnail' ? 'thumbnailKey' : 'imageKey';
    const localId = item?.[keyField] || `${item?.name || 'local'}:${variant}`;
    const mapKey = `${variant}:${localId}`;
    if (memoryUrls.has(mapKey)) return memoryUrls.get(mapKey);
    if (inflight.has(mapKey)) return inflight.get(mapKey);
    const promise = assetBlob(item, variant, options).then((blob) => {
      const url = URL.createObjectURL(blob);
      memoryUrls.set(mapKey, url);
      inflight.delete(mapKey);
      return url;
    }).catch((error) => {
      inflight.delete(mapKey);
      throw error;
    });
    inflight.set(mapKey, promise);
    return promise;
  }

  const imageFromBlob = async (blob) => {
    if (typeof createImageBitmap === 'function') return createImageBitmap(blob);
    const url = URL.createObjectURL(blob);
    try {
      return await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('Bild konnte nicht decodiert werden.'));
        image.src = url;
      });
    } finally { URL.revokeObjectURL(url); }
  };

  const canvasBlob = (canvas, quality) => new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('JPEG konnte nicht erzeugt werden.')), 'image/jpeg', quality);
  });

  async function resizeToBudget(sourceBlob, { maxEdge, maxBytes, minQuality = 0.42, maxQuality = 0.94 }) {
    const image = await imageFromBlob(sourceBlob);
    const sourceWidth = image.width || image.naturalWidth;
    const sourceHeight = image.height || image.naturalHeight;
    let edge = Math.min(maxEdge, Math.max(sourceWidth, sourceHeight));
    let best = null;
    for (let resize = 0; resize < 9; resize += 1) {
      const scale = Math.min(1, edge / Math.max(sourceWidth, sourceHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(sourceWidth * scale));
      canvas.height = Math.max(1, Math.round(sourceHeight * scale));
      const context = canvas.getContext('2d', { alpha: false });
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const high = await canvasBlob(canvas, maxQuality);
      if (high.size <= maxBytes) return { blob: high, width: canvas.width, height: canvas.height, quality: maxQuality };
      const lowBlob = await canvasBlob(canvas, minQuality);
      if (lowBlob.size <= maxBytes) {
        let low = minQuality;
        let highQuality = maxQuality;
        best = { blob: lowBlob, width: canvas.width, height: canvas.height, quality: low };
        for (let attempt = 0; attempt < 8; attempt += 1) {
          const quality = (low + highQuality) / 2;
          const candidate = await canvasBlob(canvas, quality);
          if (candidate.size <= maxBytes) {
            best = { blob: candidate, width: canvas.width, height: canvas.height, quality };
            low = quality;
          } else highQuality = quality;
        }
        return best;
      }
      edge = Math.max(360, Math.floor(edge * 0.84));
    }
    throw new Error(`Bild konnte nicht auf höchstens ${formatBytes(maxBytes)} verkleinert werden.`);
  }

  function assertPreparedPair(item) {
    const teachingBytes = Number(item?.teachingBlob?.size || item?.teachingBytes || 0);
    const thumbnailBytes = Number(item?.thumbnailBlob?.size || item?.thumbnailBytes || 0);
    const teachingEdge = Math.max(Number(item?.teachingWidth || 0), Number(item?.teachingHeight || 0));
    const thumbnailEdge = Math.max(Number(item?.thumbnailWidth || 0), Number(item?.thumbnailHeight || 0));
    if (!teachingBytes || teachingBytes > RULES.teachingMaxBytes || !teachingEdge || teachingEdge > RULES.teachingMaxEdge) {
      throw new Error('Die Unterrichtsversion erfüllt 1.600 px / 400 KB nicht.');
    }
    if (!thumbnailBytes || thumbnailBytes > RULES.thumbnailMaxBytes || !thumbnailEdge || thumbnailEdge > RULES.thumbnailMaxEdge) {
      throw new Error('Das Vorschaubild erfüllt die Thumbnail-Grenzen nicht.');
    }
    return {
      teaching: { bytes: teachingBytes, maxEdge: teachingEdge },
      thumbnail: { bytes: thumbnailBytes, maxEdge: thumbnailEdge },
    };
  }

  function importPreparationSummary(items, invalid = 0, failed = 0) {
    const pending = (Array.isArray(items) ? items : []).filter((item) => item && !item.imageKey && !String(item.name || '').startsWith('dummy_'));
    const prepared = pending.filter((item) => {
      try { assertPreparedPair(item); return true; } catch { return false; }
    });
    return {
      total: pending.length + Number(invalid || 0) + Number(failed || 0),
      prepared: prepared.length,
      invalid: Number(invalid || 0),
      failed: Number(failed || 0),
      pending: pending.length,
    };
  }

  function updateImportPreparationDisplay(summary, statusElement = q('#importTitle')) {
    const total = Math.max(0, Number(summary?.total || 0));
    const prepared = Math.max(0, Number(summary?.prepared || 0));
    const invalid = Math.max(0, Number(summary?.invalid || 0));
    const failed = Math.max(0, Number(summary?.failed || 0));
    const completed = prepared + invalid + failed;
    const percent = total ? Math.round(completed / total * 100) : 0;
    if (statusElement) statusElement.innerHTML = `<b>${prepared} neue Bilder sind als Unterrichtsbild und Vorschaubild für die Übertragung vorbereitet.</b>`;
    if (q('#progressBar')) q('#progressBar').style.width = `${percent}%`;
    if (q('#progressText')) q('#progressText').textContent = `${percent} % · ${completed} von ${total} Bildern vorbereitet`;
    if (q('#mTotal')) q('#mTotal').textContent = total;
    if (q('#mOk')) q('#mOk').textContent = prepared;
    if (q('#mInvalid')) q('#mInvalid').textContent = invalid;
    if (q('#mFailed')) q('#mFailed').textContent = failed;
  }

  async function preparePair(item) {
    if (item.preparedImport && item.teachingBlob && item.thumbnailBlob) return item;
    const source = item.file instanceof Blob
      ? item.file
      : await fetch(item.src).then((response) => response.blob());
    const teaching = await resizeToBudget(source, {
      maxEdge: RULES.teachingMaxEdge,
      maxBytes: RULES.teachingMaxBytes,
      minQuality: 0.42,
      maxQuality: 0.94,
    });
    const thumbnail = await resizeToBudget(teaching.blob, {
      maxEdge: RULES.thumbnailMaxEdge,
      maxBytes: RULES.thumbnailMaxBytes,
      minQuality: 0.48,
      maxQuality: 0.9,
    });
    item.teachingBlob = teaching.blob;
    item.thumbnailBlob = thumbnail.blob;
    item.src = await blobToDataUrl(teaching.blob);
    item.thumbnailSrc = await blobToDataUrl(thumbnail.blob);
    item.teachingBytes = teaching.blob.size;
    item.thumbnailBytes = thumbnail.blob.size;
    item.teachingWidth = teaching.width;
    item.teachingHeight = teaching.height;
    item.thumbnailWidth = thumbnail.width;
    item.thumbnailHeight = thumbnail.height;
    item.preparedImport = true;
    item.pendingUpload = true;
    item.file = undefined;
    assertPreparedPair(item);
    return item;
  }

  async function preparePendingImports(statusElement = q('#importTitle'), importState = null) {
    if (importPreparation) return importPreparation;
    importPreparation = (async () => {
      let completedThisRun = 0;
      while (true) {
        const pending = imported.filter((item) => item && !item.imageKey && !item.preparedImport && !String(item.name || '').startsWith('dummy_'));
        if (!pending.length) break;
        for (let index = 0; index < pending.length; index += 1) {
          if (statusElement) statusElement.innerHTML = `<b>Bild ${completedThisRun + 1}: Unterrichtsbild bis 1.600 px / 400 KB und Vorschaubild werden erzeugt …</b>`;
          await preparePair(pending[index]);
          completedThisRun += 1;
        }
      }
      if (typeof rebuild === 'function') rebuild();
      if (typeof scheduleDatasetCache === 'function') scheduleDatasetCache();
      updatePendingNotice();
      const summary = importPreparationSummary(imported, importState?.invalid, importState?.failed);
      updateImportPreparationDisplay(summary, statusElement);
      return summary.prepared;
    })().finally(() => { importPreparation = null; });
    return importPreparation;
  }

  function meta() {
    const sourceRecords = records.filter((record) => !record.name.startsWith('dummy_'));
    return {
      version: VERSION,
      app: document.title,
      images: sourceRecords.map((record) => {
        const source = itemFor(record);
        return {
          name: record.name,
          imageKey: source?.imageKey || null,
          thumbnailKey: source?.thumbnailKey || null,
          teachingBytes: Number(source?.teachingBytes || 0),
          thumbnailBytes: Number(source?.thumbnailBytes || 0),
          teachingWidth: Number(source?.teachingWidth || 0),
          teachingHeight: Number(source?.teachingHeight || 0),
          thumbnailWidth: Number(source?.thumbnailWidth || 0),
          thumbnailHeight: Number(source?.thumbnailHeight || 0),
          thumbnailSourceHash: source?.thumbnailSourceHash || '',
          thumbnailStale: Boolean(source?.thumbnailStale),
        };
      }),
      savedGroups,
      groupMoves,
      recordEdits,
      titleImages,
      deleted: [...deletedRecords],
    };
  }

  async function uploadPending(name, password, status) {
    await preparePendingImports(status);
    const pending = imported.filter((item) => !item.imageKey && !String(item.name || '').startsWith('dummy_'));
    for (let index = 0; index < pending.length; index += 1) {
      const item = pending[index];
      assertPreparedPair(item);
      status.textContent = `Bild ${index + 1} von ${pending.length} wird als Unterrichtsbild und Vorschaubild gespeichert …`;
      const uploaded = await api('upload-image-pair', {
        name,
        password,
        fileName: item.name,
        teachingType: 'image/jpeg',
        teachingData: await blobToBase64(item.teachingBlob),
        teachingWidth: item.teachingWidth,
        teachingHeight: item.teachingHeight,
        thumbnailType: 'image/jpeg',
        thumbnailData: await blobToBase64(item.thumbnailBlob),
        thumbnailWidth: item.thumbnailWidth,
        thumbnailHeight: item.thumbnailHeight,
      });
      if (!uploaded.imageKey || !uploaded.thumbnailKey || uploaded.imageKey === uploaded.thumbnailKey) {
        throw new Error(`Bildpaar „${item.name}“ wurde nicht eindeutig gespeichert.`);
      }
      Object.assign(item, uploaded, {
        pendingUpload: false,
        pairId: uploaded.imageKey,
        src: await blobToDataUrl(item.teachingBlob),
        thumbnailSrc: await blobToDataUrl(item.thumbnailBlob),
      });
    }
    updatePendingNotice();
    return pending.length;
  }

  function applyPayload(payload, name) {
    if (typeof clearSearch === 'function') clearSearch();
    datasetLoaded = true;
    currentDatasetName = String(name || 'Geladener Datensatz');
    session.name = currentDatasetName;
    session.payload = payload;
    imported = (payload.images || []).filter((item) => !String(item.name || '').startsWith('dummy_')).map((item) => ({
      ...item,
      src: item.src && !item.imageKey ? item.src : PLACEHOLDER,
      pendingUpload: !item.imageKey,
    }));
    delete GROUPS.Tiere;
    delete GROUPS.Pflanzen;
    savedGroups = payload.savedGroups || {};
    delete savedGroups.Tiere;
    delete savedGroups.Pflanzen;
    groupMoves = payload.groupMoves || {};
    recordEdits = payload.recordEdits || {};
    titleImages = payload.titleImages || {};
    deletedRecords = new Set(payload.deleted || []);
    Object.entries(savedGroups).forEach(([groupName, data]) => {
      GROUPS[groupName] = [data.icon || '🔬', data.c1 || '#68c7c2', data.c2 || '#357b8c', data.families || []];
    });
    if (typeof saveGroupSettings === 'function') saveGroupSettings();
    rebuild();
    go([], false);
    publishDatasetContext(currentDatasetName, true);
    updatePendingNotice();
  }

  function publishDatasetContext(name, loaded = true) {
    session.name = String(name || session.name || '').trim();
    currentDatasetName = session.name;
    datasetLoaded = Boolean(loaded && session.name);
    window.FarbatlasRuntime ||= {};
    Object.assign(window.FarbatlasRuntime, {
      version: VERSION,
      getDataset: () => ({ name: session.name, loaded: datasetLoaded, images: Array.isArray(imported) ? imported : [] }),
      loadTeachingImage: async (recordOrName, options = {}) => assetUrl(itemFor(recordOrName), 'teaching', options),
      ensureTeachingImages: hydrateAllTeachingImages,
      getDataSaver: () => dataSaver,
    });
    if (typeof updateDatasetIndicator === 'function') updateDatasetIndicator(dataSaver ? 'Datensparmodus' : 'Vorschaubilder werden bei Bedarf geladen');
    if (datasetLoaded && typeof scheduleDatasetCache === 'function') scheduleDatasetCache();
    window.dispatchEvent(new CustomEvent('farbatlas:dataset-changed', {
      detail: { name: session.name, loaded: datasetLoaded, imageCount: Array.isArray(imported) ? imported.length : 0 }
    }));
  }

  async function saveV11(create) {
    const status = q('#saveDatasetStatus');
    const createButton = q('#newDatasetBtn');
    const saveButton = q('#saveDatasetBtn');
    try {
      const name = q('#saveDatasetName').value.trim();
      const password = q('#saveDatasetPassword').value;
      if (!name || !password) throw new Error('Name und Passwort sind erforderlich.');
      createButton.disabled = saveButton.disabled = true;
      status.style.color = '#173640';
      if (create) {
        status.textContent = 'Datensatz wird angelegt …';
        await api('save', { name, password, payload: { ...meta(), images: [] }, create: true });
      }
      session.name = name;
      session.password = password;
      const uploaded = await uploadPending(name, password, status);
      status.textContent = 'Datensatz wird abgeschlossen …';
      const result = await api('save', { name, password, payload: meta(), create: false });
      publishDatasetContext(name, true);
      status.textContent = `${uploaded ? `${uploaded} Bildpaare wurden gespeichert. ` : ''}${result.message}`;
      status.style.color = '#16885a';
    } catch (error) {
      status.textContent = error.message;
      status.style.color = '#c44545';
    } finally {
      createButton.disabled = saveButton.disabled = false;
    }
  }

  async function openV11() {
    const status = q('#datasetStatus');
    try {
      const name = q('#openDatasetName').value.trim();
      const password = q('#openDatasetPassword').value;
      status.textContent = 'Datensatzstruktur wird geladen …';
      const result = await api('load', { name, password });
      session.name = result.name || name;
      session.password = password;
      applyPayload(result.payload || {}, session.name);
      status.textContent = `Datensatz „${session.name}“ ist geöffnet. Große Unterrichtsbilder werden erst bei Bedarf geladen.`;
    } catch (error) {
      status.textContent = error.message;
    }
  }

  async function loadThumbnailInto(image, record) {
    const item = itemFor(record);
    if (!item || image.dataset.thumbnailLoaded === '1') return true;
    if (image.dataset.thumbnailLoading === '1') return false;
    image.dataset.thumbnailLoading = '1';
    try {
      if (!(item.thumbnailKey || item.thumbnailBlob || item.thumbnailSrc)) {
        throw new Error('Für dieses Bild fehlt noch ein Vorschaubild.');
      }
      // Visible images use the shared URL/in-flight path and therefore never wait behind prefetch work.
      const url = await assetUrl(item, 'thumbnail');
      if (!image.isConnected && typeof image.isConnected === 'boolean') return false;
      image.src = url;
      image.dataset.thumbnailLoaded = '1';
      image.dataset.thumbnailAttempts = '0';
      image.classList.remove('farbatlas-image-unavailable');
      record.src = url;
      return true;
    } catch (error) {
      image.alt = `${record.de || 'Bild'} – ${error.message}`;
      image.classList.add('farbatlas-image-unavailable');
      return false;
    } finally {
      image.dataset.thumbnailLoading = '0';
    }
  }

  function retryVisibleThumbnail(image, record) {
    const attempts = Number(image.dataset.thumbnailAttempts || 0) + 1;
    image.dataset.thumbnailAttempts = String(attempts);
    if (attempts > 3 || typeof setTimeout !== 'function') return;
    setTimeout(async () => {
      if (image.dataset.thumbnailLoaded === '1') return;
      if (!image.isConnected && typeof image.isConnected === 'boolean') return;
      const loaded = await loadThumbnailInto(image, record);
      if (loaded) observer?.unobserve(image);
      else retryVisibleThumbnail(image, record);
    }, attempts * 500);
  }

  function thumbnailPrefetchIndexes(length, currentIndex, next = THUMBNAIL_PREFETCH_NEXT, previous = THUMBNAIL_PREFETCH_PREVIOUS) {
    const total = Math.max(0, Number(length) || 0);
    const current = Number(currentIndex);
    if (!Number.isInteger(current) || current < 0 || current >= total) return [];
    const indexes = [current];
    for (let offset = 1; offset <= next && current + offset < total; offset += 1) indexes.push(current + offset);
    for (let offset = 1; offset <= previous && current - offset >= 0; offset += 1) indexes.push(current - offset);
    return indexes;
  }

  function scheduleThumbnailPrefetch(referenceRecords, currentIndex) {
    const generation = ++thumbnailPrefetchGeneration;
    const selected = thumbnailPrefetchIndexes(referenceRecords?.length || 0, currentIndex)
      .map((index) => itemFor(referenceRecords[index]))
      .filter((item) => item && (item.thumbnailKey || item.thumbnailBlob || item.thumbnailSrc));
    const run = async () => {
      for (const item of selected) {
        if (generation !== thumbnailPrefetchGeneration) return;
        try {
          // Deliberately restricted to thumbnails: teaching images remain request-only.
          await assetUrl(item, 'thumbnail');
        } catch {
          // A missing thumbnail must not trigger a teaching-image fallback in the prefetch path.
        }
      }
    };
    if (typeof requestIdleCallback === 'function') requestIdleCallback(() => run(), { timeout: 1200 });
    else if (typeof setTimeout === 'function') setTimeout(run, 0);
  }

  window.FarbatlasThumbnailPrefetch = Object.freeze({
    indexes: thumbnailPrefetchIndexes,
    next: THUMBNAIL_PREFETCH_NEXT,
    previous: THUMBNAIL_PREFETCH_PREVIOUS,
  });

  window.FarbatlasImportDiagnostics = Object.freeze({
    summarize: importPreparationSummary,
    validatePair: assertPreparedPair,
    displayKey: (item, view) => view === 'thumbnail' ? item?.thumbnailKey : item?.imageKey,
    limits: Object.freeze({
      teachingMaxEdge: RULES.teachingMaxEdge,
      teachingMaxBytes: RULES.teachingMaxBytes,
      thumbnailMaxEdge: RULES.thumbnailMaxEdge,
      thumbnailMaxBytes: RULES.thumbnailMaxBytes,
    }),
  });

  const observer = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver((entries) => entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const record = records.find((candidate) => candidate.id === entry.target.dataset.recordId);
      if (record) loadThumbnailInto(entry.target, record).then((loaded) => {
        if (loaded) observer.unobserve(entry.target);
        else retryVisibleThumbnail(entry.target, record);
      });
    }), { rootMargin: '320px 0px' })
    : null;

  function installLazyImages() {
    if (typeof document.querySelectorAll !== 'function') return;
    document.querySelectorAll('.photo').forEach((card) => {
      const id = card.querySelector('[data-id]')?.dataset.id;
      const image = card.querySelector('img');
      const record = records.find((candidate) => candidate.id === id);
      if (!image || !record || observedImages.has(image)) return;
      observedImages.add(image);
      image.dataset.recordId = record.id;
      image.loading = 'lazy';
      image.decoding = 'async';
      if (observer) observer.observe(image); else loadThumbnailInto(image, record);
    });
  }

  async function hydrateAllTeachingImages(progress = () => {}) {
    const items = imported.filter((item) => item?.imageKey);
    for (let index = 0; index < items.length; index += 1) {
      progress(index, items.length, items[index]);
      items[index].src = await assetUrl(items[index], 'teaching');
    }
    if (typeof rebuild === 'function') rebuild();
    progress(items.length, items.length, null);
    return items.length;
  }

  function renderGalleryLoading(record) {
    q('#modalContent').innerHTML = `<div class="farbatlas-detail-loading"><div class="farbatlas-spinner"></div><h2>${escapeHtml(record?.de || 'Unterrichtsbild')}</h2><p>Das große Unterrichtsbild wird geladen …</p></div>`;
    q('#modal').classList.remove('hidden');
  }

  function renderGalleryWithSource(originalRender, record, source) {
    const previous = record.src;
    record.src = source;
    try { originalRender(); } finally { record.src = previous; }
  }

  function installGlobalBridges() {
    if (typeof bindPhotos === 'function' && !bindPhotos.__farbatlasLazy) {
      const originalBindPhotos = bindPhotos;
      bindPhotos = function farbatlasBindPhotos() {
        originalBindPhotos();
        installLazyImages();
      };
      bindPhotos.__farbatlasLazy = true;
    }
    if (typeof learnCard === 'function' && !learnCard.__farbatlasLazy) {
      const originalLearnCard = learnCard;
      learnCard = function farbatlasLearnCard() {
        originalLearnCard();
        const image = q('#learnContent .learn img');
        if (image && learning?.cur) loadThumbnailInto(image, learning.cur);
      };
      learnCard.__farbatlasLazy = true;
    }
    if (typeof renderGalleryModal === 'function' && !renderGalleryModal.__farbatlasDetail) {
      const originalRender = renderGalleryModal;
      renderGalleryModal = async function farbatlasRenderGallery() {
        const generation = ++galleryGeneration;
        const record = gallerySet?.[galleryIndex];
        const item = itemFor(record);
        if (!record || !item) return originalRender();
        const hasTeachingVersion = Boolean(item.imageKey || item.teachingBlob || item.preparedImport);
        if (!hasTeachingVersion) return originalRender();
        scheduleThumbnailPrefetch(gallerySet, galleryIndex);
        let thumbnail = record.src;
        try { thumbnail = await assetUrl(item, 'thumbnail'); } catch { /* thumbnail remains placeholder */ }
        if (generation !== galleryGeneration) return;
        if (dataSaver) {
          renderGalleryWithSource(originalRender, record, thumbnail);
          const stage = q('#modalContent .gallery-stage');
          if (stage && !q('#loadTeachingImage')) {
            const estimate = item.teachingBytes ? formatBytes(item.teachingBytes) : 'bis zu 400 KB';
            stage.insertAdjacentHTML('beforeend', `<button id="loadTeachingImage" class="farbatlas-load-detail">🔍 Großes Unterrichtsbild laden – ${escapeHtml(estimate)}</button>`);
            q('#loadTeachingImage').onclick = async () => {
              const button = q('#loadTeachingImage');
              button.disabled = true;
              button.textContent = 'Unterrichtsbild wird geladen …';
              try {
                const source = await assetUrl(item, 'teaching');
                if (generation === galleryGeneration) renderGalleryWithSource(originalRender, record, source);
              } catch (error) {
                button.disabled = false;
                button.textContent = error.message;
              }
            };
          }
          return;
        }
        renderGalleryLoading(record);
        try {
          const source = await assetUrl(item, 'teaching');
          if (generation === galleryGeneration) renderGalleryWithSource(originalRender, record, source);
        } catch (error) {
          if (generation === galleryGeneration) {
            renderGalleryWithSource(originalRender, record, thumbnail);
            q('#modalContent .gallery-stage')?.insertAdjacentHTML('beforeend', `<div class="farbatlas-detail-error">${escapeHtml(error.message)}</div>`);
          }
        }
      };
      renderGalleryModal.__farbatlasDetail = true;
    }
    if (typeof finishIf === 'function' && !finishIf.__farbatlasImport) {
      const originalFinish = finishIf;
      finishIf = function farbatlasFinishImport(state) {
        originalFinish(state);
        if (state.done === state.total && state.ok) preparePendingImports(q('#importTitle'), state).catch((error) => {
          const box = q('#importBox');
          if (box) box.className = 'import-box error';
          if (q('#importTitle')) q('#importTitle').innerHTML = `<b>Bildvorbereitung fehlgeschlagen: ${escapeHtml(error.message)}</b>`;
        });
      };
      finishIf.__farbatlasImport = true;
    }
  }

  function setOfflineStatus(message, type = '') {
    const box = q('#offlineLibraryStatus');
    if (!box) return;
    box.className = `offline-library-status ${type}`;
    box.textContent = message;
  }

  async function prepareOffline(mode) {
    if (!session.name || !datasetLoaded) {
      setOfflineStatus('Bitte zuerst einen Datensatz öffnen.', 'error');
      return;
    }
    const items = imported.filter((item) => item?.imageKey);
    const buttonA = q('#prepareOfflineThumbnails');
    const buttonB = q('#prepareOfflineComplete');
    buttonA.disabled = buttonB.disabled = true;
    let done = 0;
    let bytes = 0;
    try {
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        setOfflineStatus(`Bild ${index + 1} von ${items.length}: Vorschaubild wird vorbereitet …`);
        const thumbnail = await assetBlob(item, 'thumbnail');
        bytes += thumbnail.size;
        if (mode === 'complete') {
          setOfflineStatus(`Bild ${index + 1} von ${items.length}: Unterrichtsbild wird zusätzlich vorbereitet …`);
          const teaching = await assetBlob(item, 'teaching');
          bytes += teaching.size;
        }
        done += 1;
        q('#offlineLibraryProgress').style.width = `${Math.round(done / Math.max(1, items.length) * 100)}%`;
        q('#offlineLibraryProgressText').textContent = `${done} von ${items.length}`;
      }
      await dbPut(MANIFEST_STORE, String(session.name).toLowerCase(), {
        name: session.name,
        mode,
        imageCount: items.length,
        bytes,
        preparedAt: new Date().toISOString(),
        appVersion: VERSION,
      });
      setOfflineStatus(`Vorbereitung abgeschlossen: ${items.length} Bilder, ${formatBytes(bytes)}. Du kannst jetzt ohne Internet weiterarbeiten.`, 'success');
    } catch (error) {
      setOfflineStatus(`Vorbereitung unvollständig nach ${done} von ${items.length} Bildern: ${error.message}`, 'error');
    } finally {
      buttonA.disabled = buttonB.disabled = false;
    }
  }

  async function showOfflineManifest() {
    if (!session.name) return;
    const manifest = await dbGet(MANIFEST_STORE, String(session.name).toLowerCase()).catch(() => null);
    if (!manifest) return;
    setOfflineStatus(`Zuletzt vollständig vorbereitet: ${new Date(manifest.preparedAt).toLocaleString('de-DE')} · ${manifest.mode === 'complete' ? 'mit Unterrichtsbildern' : 'nur Vorschaubilder'} · ${formatBytes(manifest.bytes)}`, 'success');
  }

  function updateDataSaverUi() {
    const checkbox = q('#dataSaverCheckbox');
    if (checkbox) checkbox.checked = dataSaver;
    document.body.classList.toggle('farbatlas-data-saver', dataSaver);
    if (datasetLoaded && typeof updateDatasetIndicator === 'function') updateDatasetIndicator(dataSaver ? 'Datensparmodus aktiv' : 'Vorschaubilder werden bei Bedarf geladen');
  }

  function pendingItems() {
    return Array.isArray(imported) ? imported.filter((item) => item?.pendingUpload || (!item?.imageKey && !String(item?.name || '').startsWith('dummy_'))) : [];
  }

  function updatePendingNotice() {
    const notice = q('#offlinePendingNotice');
    if (!notice) return;
    const count = pendingItems().length;
    notice.classList.toggle('hidden', !count);
    if (count) {
      notice.innerHTML = `<b>${count} selbst aufgenommene${count === 1 ? 's Foto ist' : ' Fotos sind'} nur auf diesem Gerät gespeichert.</b><br>Damit ${count === 1 ? 'es' : 'sie'} in die gemeinsame Bibliothek gelangt, stelle eine Internetverbindung her, öffne denselben Datensatz und wähle „Datensatz speichern“. Schließe die App erst, wenn die erfolgreiche Übertragung bestätigt wurde.`;
    }
  }

  async function thumbnailAdminStatus() {
    const status = q('#thumbnailAdminStatus');
    if (!session.name || !datasetLoaded) {
      status.textContent = 'Bitte zuerst den gewünschten Datensatz öffnen.';
      return null;
    }
    status.textContent = 'Unterrichtsbilder und Vorschaubilder werden geprüft …';
    try {
      const result = await api('thumbnail-status', { name: session.name });
      const counts = result.counts || {};
      q('#thumbnailAdminMetrics').innerHTML = [
        ['Unterrichtsbilder', result.total],
        ['Aktuell', counts.current || 0],
        ['Fehlen', counts.missing || 0],
        ['Veraltet', counts.stale || 0],
        ['Beschädigt', (counts.damaged || 0) + (counts['source-missing'] || 0)],
      ].map(([label, value]) => `<div><b>${value}</b><span>${label}</span></div>`).join('');
      const needsWork = result.items.filter((item) => ['missing', 'stale', 'damaged'].includes(item.status));
      q('#thumbnailAdminGenerate').disabled = !needsWork.length;
      q('#thumbnailAdminGenerate').dataset.items = JSON.stringify(needsWork);
      status.textContent = needsWork.length
        ? `${needsWork.length} Vorschaubilder müssen erzeugt oder erneuert werden. Die Unterrichtsbilder bleiben unverändert.`
        : 'Alle Vorschaubilder sind vorhanden und aktuell.';
      return result;
    } catch (error) {
      status.textContent = error.message;
      return null;
    }
  }

  async function generateThumbnails() {
    const button = q('#thumbnailAdminGenerate');
    const status = q('#thumbnailAdminStatus');
    let work;
    try { work = JSON.parse(button.dataset.items || '[]'); } catch { work = []; }
    if (!work.length) return;
    button.disabled = true;
    q('#thumbnailAdminCheck').disabled = true;
    let completed = 0;
    try {
      for (let index = 0; index < work.length; index += 1) {
        const entry = work[index];
        const item = imported.find((candidate) => candidate.imageKey === entry.imageKey);
        if (!item) throw new Error(`Bildreferenz fehlt: ${entry.name}`);
        status.textContent = `${index + 1} von ${work.length}: Unterrichtsbild wird gelesen und Vorschaubild erzeugt …`;
        const teaching = await assetBlob(item, 'teaching');
        const thumbnail = await resizeToBudget(teaching, {
          maxEdge: RULES.thumbnailMaxEdge,
          maxBytes: RULES.thumbnailMaxBytes,
          minQuality: 0.48,
          maxQuality: 0.9,
        });
        const response = await api('upload-thumbnail', {
          name: session.name,
          imageKey: item.imageKey,
          fileName: item.name,
          type: 'image/jpeg',
          data: await blobToBase64(thumbnail.blob),
          width: thumbnail.width,
          height: thumbnail.height,
        });
        Object.assign(item, response.image, {
          thumbnailBlob: thumbnail.blob,
          thumbnailSrc: await blobToDataUrl(thumbnail.blob),
        });
        completed += 1;
        q('#thumbnailAdminProgress').style.width = `${Math.round(completed / work.length * 100)}%`;
      }
      status.textContent = `${completed} Vorschaubilder wurden erzeugt. Kein Unterrichtsbild wurde ersetzt oder gelöscht.`;
      await thumbnailAdminStatus();
      if (typeof rebuild === 'function') rebuild();
    } catch (error) {
      status.textContent = `Nach ${completed} Bildern angehalten: ${error.message}`;
    } finally {
      q('#thumbnailAdminCheck').disabled = false;
      button.disabled = false;
    }
  }

  function installUi() {
    if (q('#farbatlasSpeedPanel')) return;
    if (!q('#datasetPanel') && !q('#datasetAdminPanel')) return;
    const datasetPanel = q('#datasetPanel');
    if (datasetPanel) datasetPanel.insertAdjacentHTML('afterend', `<section id="farbatlasSpeedPanel" class="farbatlas-speed-panel">
      <div class="farbatlas-speed-row"><label><input id="dataSaverCheckbox" type="checkbox"> <b>Datensparmodus</b></label><span>Im Atlas werden nur Vorschaubilder genutzt. Große Unterrichtsbilder laden erst nach deiner Bestätigung.</span></div>
      <details><summary><b>Bibliothek für die Offline-Nutzung vorbereiten</b></summary>
        <div class="farbatlas-offline-help"><b>Vorbereitung in einfachen Schritten</b><ol><li>Bleibe mit dem Internet verbunden, bis „Vorbereitung abgeschlossen“ erscheint.</li><li>Nutze später dasselbe Gerät und denselben Browser.</li><li>Lösche keine Website-Daten, verwende kein privates Fenster und deinstalliere den Browser nicht.</li><li>Lass die App während des Einsatzes möglichst geöffnet.</li></ol></div>
        <div class="farbatlas-speed-actions"><button id="prepareOfflineThumbnails" class="btn primary">Datensparend: Texte + alle Vorschaubilder</button><button id="prepareOfflineComplete" class="btn good">Komplett: zusätzlich alle Unterrichtsbilder</button></div>
        <div class="farbatlas-track"><div id="offlineLibraryProgress"></div></div><div id="offlineLibraryProgressText" class="statusline">Noch nicht gestartet.</div><div id="offlineLibraryStatus" class="offline-library-status">Öffne zuerst den Datensatz, den du vorbereiten möchtest.</div>
        <div class="farbatlas-offline-help"><b>Eigene Fotos ohne Internet</b><p>Neue Fotos werden auf diesem Gerät sofort als Unterrichtsbild und Vorschaubild vorbereitet. Sie sind noch nicht Teil der gemeinsamen Bibliothek. Sobald wieder Internet verfügbar ist, öffne denselben Datensatz und speichere ihn. Schließe die App erst nach der Erfolgsmeldung.</p></div>
      </details><div id="offlinePendingNotice" class="farbatlas-pending hidden"></div>
    </section>`);
    q('#dataSaverCheckbox').onchange = (event) => {
      dataSaver = Boolean(event.target.checked);
      localStorage.setItem(DATA_SAVER_KEY, dataSaver ? '1' : '0');
      updateDataSaverUi();
      if (typeof render === 'function') render();
    };
    q('#prepareOfflineThumbnails').onclick = () => prepareOffline('thumbnails');
    q('#prepareOfflineComplete').onclick = () => prepareOffline('complete');

    const adminAnchor = q('#imageCompressionPanel') || q('#datasetAdminPanel');
    if (adminAnchor) adminAnchor.insertAdjacentHTML('afterend', `<button id="thumbnailAdminToggle" class="thumbnail-admin-toggle admin-only">🖼️ Vorschaubilder prüfen &amp; erzeugen</button>
      <section id="thumbnailAdminPanel" class="thumbnail-admin-panel hidden admin-only"><div class="collapse-row"><button id="thumbnailAdminClose" class="btn">✕ Zuklappen</button></div><h3>Vorschaubild-Verwaltung</h3><p>Die Prüfung vergleicht jedes Vorschaubild mit dem zugehörigen Unterrichtsbild. Unterrichtsbilder werden dabei weder ersetzt noch gelöscht.</p><div id="thumbnailAdminMetrics" class="thumbnail-admin-metrics"></div><div class="farbatlas-speed-actions"><button id="thumbnailAdminCheck" class="btn primary">Bibliothek prüfen</button><button id="thumbnailAdminGenerate" class="btn good" disabled>Fehlende oder veraltete Vorschaubilder erzeugen</button></div><div class="farbatlas-track"><div id="thumbnailAdminProgress"></div></div><div id="thumbnailAdminStatus" class="offline-library-status">Noch keine Prüfung durchgeführt.</div></section>`);
    q('#thumbnailAdminToggle').onclick = () => q('#thumbnailAdminPanel').classList.toggle('hidden');
    q('#thumbnailAdminClose').onclick = () => q('#thumbnailAdminPanel').classList.add('hidden');
    q('#thumbnailAdminCheck').onclick = thumbnailAdminStatus;
    q('#thumbnailAdminGenerate').onclick = generateThumbnails;

    const style = document.createElement('style');
    style.textContent = `
      .farbatlas-speed-panel{margin-top:12px;padding:15px;border:1px solid #b7dce2;border-radius:15px;background:#f4fbfc;box-shadow:var(--sh)}
      .farbatlas-speed-row{display:grid;grid-template-columns:auto 1fr;gap:12px;align-items:center}.farbatlas-speed-row label{white-space:nowrap}.farbatlas-speed-panel details{margin-top:13px}.farbatlas-speed-panel summary{cursor:pointer;padding:10px;border-radius:10px;background:#e0f2f4}
      .farbatlas-offline-help{margin:12px 0;padding:12px;border-radius:11px;background:#fff}.farbatlas-offline-help ol{padding-left:22px}.farbatlas-speed-actions{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}.farbatlas-track{height:14px;border-radius:999px;background:#c9dfe2;overflow:hidden}.farbatlas-track>div{height:100%;width:0;background:linear-gradient(90deg,#24bfd0,#16885a);transition:width .18s}.offline-library-status,.farbatlas-pending{margin-top:10px;padding:11px;border-radius:11px;background:#e7f5f7}.offline-library-status.success{background:#e3f7e9;color:#125b31}.offline-library-status.error{background:#ffe5e5;color:#811d1d}.farbatlas-pending{background:#fff2cc;color:#665000}
      .farbatlas-load-detail{position:absolute;left:50%;bottom:20px;transform:translateX(-50%);z-index:20;border:0;border-radius:14px;padding:13px 17px;background:#fff;color:#062d40;font-weight:800;box-shadow:0 5px 20px #0008;cursor:pointer}.farbatlas-load-detail:disabled{opacity:.8}.farbatlas-detail-loading{min-height:420px;display:grid;place-items:center;align-content:center;text-align:center;padding:30px}.farbatlas-spinner{width:52px;height:52px;border:6px solid #cce4e8;border-top-color:#087f9c;border-radius:50%;animation:farbatlas-spin .8s linear infinite}.farbatlas-detail-error{position:absolute;left:12px;right:12px;bottom:12px;padding:10px;border-radius:10px;background:#ffe5e5;color:#811d1d;text-align:center}.farbatlas-image-unavailable{background:#e8f2f3}
      .thumbnail-admin-toggle{width:100%;border:0;border-radius:15px;padding:15px 18px;background:#14745c;color:#fff;font-size:18px;font-weight:800;text-align:left;margin-top:14px}.thumbnail-admin-panel{margin-top:12px;padding:16px;border:1px solid #b9dccf;border-radius:14px;background:#f4fbf7}.thumbnail-admin-metrics{display:grid;grid-template-columns:repeat(5,1fr);gap:8px}.thumbnail-admin-metrics>div{text-align:center;padding:9px;border-radius:10px;background:#fff}.thumbnail-admin-metrics b,.thumbnail-admin-metrics span{display:block}.thumbnail-admin-metrics b{font-size:21px}
      @keyframes farbatlas-spin{to{transform:rotate(360deg)}}@media(max-width:700px){.farbatlas-speed-row{grid-template-columns:1fr}.thumbnail-admin-metrics{grid-template-columns:repeat(2,1fr)}.farbatlas-load-detail{width:calc(100% - 28px)}}
    `;
    document.head.appendChild(style);
    updateDataSaverUi();
    updatePendingNotice();
  }

  async function registerServiceWorker() {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator) || !window.isSecureContext) return;
    try { await navigator.serviceWorker.register('/farbatlas-sw.js'); } catch (error) { console.warn('Offline-Grunddateien konnten nicht registriert werden.', error); }
  }

  function bind() {
    installGlobalBridges();
    installUi();
    const createButton = q('#newDatasetBtn');
    const saveButton = q('#saveDatasetBtn');
    const openButton = q('#openDatasetBtn');
    if (createButton) createButton.onclick = () => saveV11(true);
    if (saveButton) saveButton.onclick = () => saveV11(false);
    if (openButton) openButton.onclick = openV11;
    const status = q('#saveDatasetStatus');
    if (status && !q('#v11hint')) status.insertAdjacentHTML('afterend', '<div id="v11hint" class="hint">Neue Fotos werden vor der Übertragung automatisch als Unterrichtsbild (max. 1.600 px / 400 KB) und Vorschaubild vorbereitet. Das große Original bleibt auf deinem Gerät.</div>');
    installLazyImages();
    registerServiceWorker();
    window.addEventListener('online', () => {
      updatePendingNotice();
      if (pendingItems().length) setOfflineStatus('Die Internetverbindung ist wieder da. Speichere jetzt den Datensatz und warte auf die Erfolgsmeldung.', 'success');
    });
    window.addEventListener('offline', () => setOfflineStatus('Offline: Vorbereitete Inhalte bleiben auf diesem Gerät verfügbar. Noch nicht übertragene Fotos bleiben vorgemerkt.'));
    if (typeof setInterval !== 'function') return;
    let attempts = 0;
    const restoreBridge = setInterval(() => {
      attempts += 1;
      if (typeof datasetLoaded !== 'undefined' && datasetLoaded && currentDatasetName) {
        session.name ||= currentDatasetName;
        publishDatasetContext(currentDatasetName, true);
        installLazyImages();
        showOfflineManifest();
        clearInterval(restoreBridge);
      } else if (attempts > 20) clearInterval(restoreBridge);
    }, 250);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();
