/* Farbatlas learning materials: dataset-scoped PDF library, upload, lazy loading and offline storage */
(() => {
  'use strict';

  const API = '/api/farbatlas';
  const DB_NAME = 'farbatlas-learning-materials-v1';
  const PDF_STORE = 'pdfs';
  const MANIFEST_STORE = 'manifests';
  const DATA_SAVER_KEY = 'farbatlas.dataSaver.v1';
  const WARNING_BYTES = 5 * 1024 * 1024;
  const MAXIMUM_BYTES = 50 * 1024 * 1024;
  const q = (selector) => document.querySelector(selector);
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[character]));
  const formatBytes = (bytes) => {
    const value = Number(bytes || 0);
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
  };

  let manifest = null;
  let currentFolderId = null;
  let datasetPassword = '';
  let loading = false;
  const expandedFolderIds = new Set();

  function activeToken() {
    return sessionStorage.getItem('farbatlasCourseTokenV1')
      || sessionStorage.getItem('farbatlasAdminTokenV09')
      || '';
  }

  function canManage() {
    return Boolean(activeToken());
  }

  function datasetName() {
    if (typeof currentDatasetName !== 'undefined' && String(currentDatasetName || '').trim()) return String(currentDatasetName).trim();
    return q('#openDatasetName')?.value.trim() || q('#saveDatasetName')?.value.trim() || '';
  }

  async function request(action, data = {}) {
    const token = activeToken();
    const body = { action, ...data };
    if (!token && !body.password && datasetPassword) body.password = datasetPassword;
    const response = await fetch(API, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    let result;
    try { result = JSON.parse(text); } catch { result = { error: text || `HTTP ${response.status}` }; }
    if (!response.ok) {
      const error = new Error(result.error || `HTTP ${response.status}`);
      error.status = response.status;
      error.details = result;
      throw error;
    }
    return result;
  }

  function dbOpen() {
    return new Promise((resolve, reject) => {
      const open = indexedDB.open(DB_NAME, 1);
      open.onupgradeneeded = () => {
        if (!open.result.objectStoreNames.contains(PDF_STORE)) open.result.createObjectStore(PDF_STORE);
        if (!open.result.objectStoreNames.contains(MANIFEST_STORE)) open.result.createObjectStore(MANIFEST_STORE);
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
  }

  async function dbGet(store, key) {
    const db = await dbOpen();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction(store, 'readonly');
        const get = transaction.objectStore(store).get(key);
        get.onsuccess = () => resolve(get.result);
        get.onerror = () => reject(get.error);
      });
    } finally { db.close(); }
  }

  async function dbPut(store, key, value) {
    const db = await dbOpen();
    try {
      await new Promise((resolve, reject) => {
        const transaction = db.transaction(store, 'readwrite');
        transaction.objectStore(store).put(value, key);
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
      });
    } finally { db.close(); }
  }

  async function dbDelete(store, key) {
    const db = await dbOpen();
    try {
      await new Promise((resolve, reject) => {
        const transaction = db.transaction(store, 'readwrite');
        transaction.objectStore(store).delete(key);
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
      });
    } finally { db.close(); }
  }

  const datasetKey = (name = datasetName()) => String(name || '').trim().toLocaleLowerCase('de');
  const manifestCacheKey = (name = datasetName()) => `${datasetKey(name)}|manifest`;
  const pdfCacheKey = (node, name = datasetName()) => `${datasetKey(name)}|${node.id}|${node.version}|${node.sha256}`;

  function status(message, type = '') {
    const element = q('#materialsStatus');
    if (!element) return;
    element.className = `materials-status ${type}`;
    element.textContent = message;
  }

  async function loadManifest({ quiet = false } = {}) {
    const name = datasetName();
    if (!name) throw new Error('Bitte zuerst einen Farbatlas-Datensatz öffnen.');
    if (!quiet) status('Materialverzeichnis wird geladen …');
    try {
      const result = await request('material-list', { name });
      manifest = result.manifest;
      await dbPut(MANIFEST_STORE, manifestCacheKey(name), manifest).catch(() => {});
      if (!quiet) status(`${manifest.nodes.filter((node) => node.type === 'pdf').length} Lernmaterialien verfügbar.`, 'success');
    } catch (error) {
      const cached = await dbGet(MANIFEST_STORE, manifestCacheKey(name)).catch(() => null);
      if (!cached) throw error;
      manifest = cached;
      status('Offline: lokal gespeichertes Materialverzeichnis wird angezeigt.', 'warning');
    }
    if (currentFolderId && !manifest.nodes.some((node) => node.id === currentFolderId && node.type === 'folder')) currentFolderId = null;
    renderLibrary();
    return manifest;
  }

  function folders() {
    return (manifest?.nodes || []).filter((node) => node.type === 'folder');
  }

  function children(parentId) {
    return (manifest?.nodes || [])
      .filter((node) => (node.parentId || null) === (parentId || null))
      .sort((a, b) => (a.type === b.type ? a.title.localeCompare(b.title, 'de') : a.type === 'folder' ? -1 : 1));
  }

  function expandFolderPath(folderId, includeSelf = true) {
    if (!folderId || !manifest) return;
    const byId = new Map(manifest.nodes.map((node) => [node.id, node]));
    let folder = byId.get(folderId);
    if (!includeSelf) folder = folder?.parentId ? byId.get(folder.parentId) : null;
    const visited = new Set();
    while (folder?.type === 'folder' && !visited.has(folder.id)) {
      expandedFolderIds.add(folder.id);
      visited.add(folder.id);
      folder = folder.parentId ? byId.get(folder.parentId) : null;
    }
  }

  function folderTree(parentId = null, depth = 0) {
    return children(parentId).filter((node) => node.type === 'folder').map((folder) => {
      const childFolders = children(folder.id).filter((node) => node.type === 'folder');
      const hasChildren = childFolders.length > 0;
      const isExpanded = hasChildren && expandedFolderIds.has(folder.id);
      const toggle = hasChildren
        ? `<button class="material-tree-toggle" data-material-toggle="${folder.id}" aria-expanded="${isExpanded}" aria-label="Ordner ${escapeHtml(folder.title)} ${isExpanded ? 'einklappen' : 'ausklappen'}">${isExpanded ? '▾' : '▸'}</button>`
        : '<span class="material-tree-spacer" aria-hidden="true"></span>';
      return `<li class="material-tree-item">
        <div class="material-tree-row" style="--depth:${depth}">${toggle}<button class="material-tree-folder ${folder.id === currentFolderId ? 'active' : ''}" data-material-folder="${folder.id}">📁 ${escapeHtml(folder.title)}</button></div>
        ${isExpanded ? `<ul class="material-tree-children">${folderTree(folder.id, depth + 1)}</ul>` : ''}
      </li>`;
    }).join('');
  }

  function breadcrumbNodes() {
    const map = new Map((manifest?.nodes || []).map((node) => [node.id, node]));
    const chain = [];
    let current = currentFolderId ? map.get(currentFolderId) : null;
    while (current) {
      chain.unshift(current);
      current = current.parentId ? map.get(current.parentId) : null;
    }
    return chain;
  }

  function managementButtons(node) {
    if (!canManage()) return '';
    return `<span class="material-row-actions">
      <button data-material-rename="${node.id}" title="Umbenennen">✎</button>
      <button data-material-move="${node.id}" title="Verschieben">↗</button>
      <button data-material-delete="${node.id}" title="Löschen">🗑</button>
    </span>`;
  }

  function renderLibrary() {
    if (!manifest || !q('#materialsContent')) return;
    const validFolderIds = new Set(folders().map((folder) => folder.id));
    for (const id of expandedFolderIds) if (!validFolderIds.has(id)) expandedFolderIds.delete(id);
    expandFolderPath(currentFolderId, false);
    const items = children(currentFolderId);
    q('#materialsTree').innerHTML = `<ul><li class="material-tree-root"><div class="material-tree-row root"><span class="material-tree-spacer" aria-hidden="true"></span><button class="material-tree-folder ${currentFolderId ? '' : 'active'}" data-material-folder="">📚 Lernmaterialien</button></div><ul class="material-tree-children root-children">${folderTree()}</ul></li></ul>`;
    q('#materialsBreadcrumbs').innerHTML = `<button data-material-folder="">Lernmaterialien</button>${breadcrumbNodes().map((folder) => ` › <button data-material-folder="${folder.id}">${escapeHtml(folder.title)}</button>`).join('')}`;
    q('#materialsContent').innerHTML = items.length ? items.map((node) => node.type === 'folder' ? `
      <article class="material-row folder"><button class="material-main" data-material-folder="${node.id}"><span class="material-icon">📁</span><span><strong>${escapeHtml(node.title)}</strong><small>Ordner</small></span></button>${managementButtons(node)}</article>` : `
      <article class="material-row pdf"><button class="material-main" data-material-open="${node.id}"><span class="material-icon">📄</span><span><strong>${escapeHtml(node.title)}</strong><small>${escapeHtml(node.fileName)} · ${formatBytes(node.bytes)}${node.pageCount ? ` · ${node.pageCount} Seiten` : ''} · <span data-material-offline="${node.id}">Online verfügbar</span></small></span></button>${managementButtons(node)}</article>`).join('') : '<div class="materials-empty">Dieser Ordner ist leer.</div>';
    q('#materialsManagement').classList.toggle('hidden', !canManage());
    document.querySelectorAll('[data-material-folder]').forEach((button) => button.onclick = () => {
      currentFolderId = button.dataset.materialFolder || null;
      expandFolderPath(currentFolderId);
      renderLibrary();
    });
    document.querySelectorAll('[data-material-toggle]').forEach((button) => button.onclick = () => {
      const id = button.dataset.materialToggle;
      if (expandedFolderIds.has(id)) expandedFolderIds.delete(id);
      else expandedFolderIds.add(id);
      renderLibrary();
    });
    document.querySelectorAll('[data-material-open]').forEach((button) => button.onclick = () => openPdf(button.dataset.materialOpen));
    document.querySelectorAll('[data-material-rename]').forEach((button) => button.onclick = () => renameEntry(button.dataset.materialRename));
    document.querySelectorAll('[data-material-move]').forEach((button) => button.onclick = () => moveEntry(button.dataset.materialMove));
    document.querySelectorAll('[data-material-delete]').forEach((button) => button.onclick = () => deleteEntry(button.dataset.materialDelete));
    updateOfflineBadges();
  }

  async function updateOfflineBadges() {
    for (const node of children(currentFolderId).filter((entry) => entry.type === 'pdf')) {
      const cached = await dbGet(PDF_STORE, pdfCacheKey(node)).catch(() => null);
      const badge = q(`[data-material-offline="${node.id}"]`);
      if (badge && cached?.blob instanceof Blob) {
        badge.textContent = 'Offline gespeichert';
        badge.classList.add('offline');
      }
    }
  }

  function base64Bytes(data) {
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

  function bytesBase64(bytes) {
    let binary = '';
    const step = 0x8000;
    for (let index = 0; index < bytes.length; index += step) binary += String.fromCharCode(...bytes.subarray(index, index + step));
    return btoa(binary);
  }

  async function sha256(buffer) {
    const hash = await crypto.subtle.digest('SHA-256', buffer);
    return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  async function obtainPdf(node, { forceNetwork = false, progress = () => {} } = {}) {
    const cacheKey = pdfCacheKey(node);
    const cached = await dbGet(PDF_STORE, cacheKey).catch(() => null);
    if (!forceNetwork && cached?.blob instanceof Blob) return { blob: cached.blob, offline: true };
    if (!navigator.onLine) throw new Error('Dieses PDF wurde nicht für die Offline-Nutzung vorbereitet. Stelle eine Internetverbindung her und lade die Lernmaterialien.');
    const chunks = [];
    let downloaded = 0;
    for (let index = 0; index < Number(node.chunkCount || 0); index += 1) {
      const result = await request('material-download-chunk', { name: datasetName(), materialId: node.id, chunkIndex: index });
      const bytes = base64Bytes(result.data);
      chunks.push(bytes);
      downloaded += bytes.length;
      progress(downloaded, node.bytes, index + 1, node.chunkCount);
    }
    const blob = new Blob(chunks, { type: 'application/pdf' });
    if (blob.size !== Number(node.bytes)) throw new Error('Die PDF-Datei wurde nicht vollständig übertragen.');
    const checksum = await sha256(await blob.arrayBuffer());
    if (checksum !== node.sha256) throw new Error('Die Prüfsumme der PDF-Datei stimmt nicht. Bitte erneut laden.');
    await dbPut(PDF_STORE, cacheKey, { blob, nodeId: node.id, version: node.version, sha256: node.sha256, savedAt: new Date().toISOString() });
    return { blob, offline: false };
  }

  async function openPdf(id) {
    const node = manifest?.nodes.find((entry) => entry.id === id && entry.type === 'pdf');
    if (!node || loading) return;
    loading = true;
    try {
      const cached = await dbGet(PDF_STORE, pdfCacheKey(node)).catch(() => null);
      if (!cached?.blob && localStorage.getItem(DATA_SAVER_KEY) === '1') {
        if (!confirm(`PDF laden?\n\n„${node.title}“ ist ${formatBytes(node.bytes)} groß.\nIm Datensparmodus wird die Datei erst nach deiner Bestätigung geladen.`)) return;
      }
      status(`„${node.title}“ wird geladen … 0 %`);
      const result = await obtainPdf(node, { progress: (done, total) => status(`„${node.title}“ wird geladen … ${Math.round(done / total * 100)} % · ${formatBytes(done)} von ${formatBytes(total)}`) });
      status(`„${node.title}“ ist geöffnet.`, 'success');
      await window.FarbatlasPdfViewer.open(result.blob, { ...node, offline: result.offline || Boolean(cached?.blob) });
      renderLibrary();
    } catch (error) {
      status(error.message, 'error');
    } finally { loading = false; }
  }

  async function createFolder() {
    const title = prompt('Name des neuen Ordners:');
    if (title === null || !title.trim()) return;
    try {
      const result = await request('material-create-folder', { name: datasetName(), parentId: currentFolderId, title: title.trim(), expectedVersion: manifest.version });
      manifest = result.manifest;
      if (currentFolderId) expandedFolderIds.add(currentFolderId);
      await dbPut(MANIFEST_STORE, manifestCacheKey(), manifest).catch(() => {});
      renderLibrary();
      status(result.message, 'success');
    } catch (error) { status(error.message, 'error'); }
  }

  async function renameEntry(id) {
    const node = manifest.nodes.find((entry) => entry.id === id);
    const title = prompt('Neuer Name:', node?.title || '');
    if (title === null || !title.trim()) return;
    try {
      const result = await request('material-rename', { name: datasetName(), id, title: title.trim(), expectedVersion: manifest.version });
      manifest = result.manifest;
      await dbPut(MANIFEST_STORE, manifestCacheKey(), manifest).catch(() => {});
      renderLibrary();
      status(result.message, 'success');
    } catch (error) { status(error.message, 'error'); }
  }

  async function moveEntry(id) {
    const node = manifest.nodes.find((entry) => entry.id === id);
    const choices = [{ id: null, title: 'Lernmaterialien (Hauptverzeichnis)' }, ...folders().filter((folder) => folder.id !== id)];
    const list = choices.map((folder, index) => `${index + 1}: ${folder.title}`).join('\n');
    const answer = prompt(`„${node?.title || 'Eintrag'}“ verschieben nach:\n\n${list}\n\nNummer eingeben:`);
    if (answer === null) return;
    const choice = choices[Number(answer) - 1];
    if (!choice) return status('Ungültiger Zielordner.', 'error');
    try {
      const result = await request('material-move', { name: datasetName(), id, parentId: choice.id, expectedVersion: manifest.version });
      manifest = result.manifest;
      await dbPut(MANIFEST_STORE, manifestCacheKey(), manifest).catch(() => {});
      renderLibrary();
      status(result.message, 'success');
    } catch (error) { status(error.message, 'error'); }
  }

  async function deleteEntry(id) {
    const node = manifest.nodes.find((entry) => entry.id === id);
    if (!node || !confirm(`„${node.title}“ wirklich löschen?${node.type === 'folder' ? '\nAlle enthaltenen Ordner und PDFs werden ebenfalls gelöscht.' : ''}`)) return;
    try {
      const removed = node.type === 'pdf' ? [node] : manifest.nodes.filter((entry) => {
        let cursor = entry;
        const map = new Map(manifest.nodes.map((item) => [item.id, item]));
        while (cursor?.parentId) { if (cursor.parentId === id) return true; cursor = map.get(cursor.parentId); }
        return entry.id === id;
      });
      const result = await request('material-delete', { name: datasetName(), id, expectedVersion: manifest.version });
      manifest = result.manifest;
      for (const entry of removed.filter((item) => item.type === 'pdf')) await dbDelete(PDF_STORE, pdfCacheKey(entry)).catch(() => {});
      await dbPut(MANIFEST_STORE, manifestCacheKey(), manifest).catch(() => {});
      renderLibrary();
      status(result.message, 'success');
    } catch (error) { status(error.message, 'error'); }
  }

  async function uploadFiles(files) {
    if (!files.length) return;
    for (const file of files) {
      try {
        if (!/\.pdf$/i.test(file.name) || !['application/pdf', 'application/octet-stream', ''].includes(file.type)) throw new Error(`${file.name}: nur PDF-Dateien sind erlaubt.`);
        if (file.size > MAXIMUM_BYTES) throw new Error(`${file.name}: maximal 50 MB pro PDF.`);
        if (file.size > WARNING_BYTES && !confirm(`Große PDF-Datei\n\n„${file.name}“ ist ${formatBytes(file.size)} groß. Große Dateien benötigen beim Öffnen und bei der Offline-Vorbereitung mehr Datenvolumen und Speicherplatz.\n\nTrotzdem hochladen?`)) continue;
        const buffer = await file.arrayBuffer();
        const signature = new TextDecoder('ascii').decode(new Uint8Array(buffer, 0, Math.min(5, buffer.byteLength)));
        if (signature !== '%PDF-') throw new Error(`${file.name}: keine gültige PDF-Kennung.`);
        status(`${file.name}: Prüfsumme wird berechnet …`);
        const checksum = await sha256(buffer);
        let pageCount = 0;
        try { pageCount = (await window.FarbatlasPdfViewer.inspect(new Blob([buffer], { type: 'application/pdf' }))).pageCount; } catch { /* optional metadata */ }
        const start = await request('material-upload-start', {
          name: datasetName(), parentId: currentFolderId, title: file.name.replace(/\.pdf$/i, ''), fileName: file.name,
          bytes: file.size, pageCount, sha256: checksum, expectedVersion: manifest.version,
        });
        const bytes = new Uint8Array(buffer);
        for (let index = 0; index < start.chunkCount; index += 1) {
          const chunk = bytes.subarray(index * start.chunkSize, Math.min(bytes.length, (index + 1) * start.chunkSize));
          status(`${file.name}: Abschnitt ${index + 1} von ${start.chunkCount} wird hochgeladen …`);
          await request('material-upload-chunk', { name: datasetName(), uploadId: start.uploadId, chunkIndex: index, data: bytesBase64(chunk) });
        }
        status(`${file.name}: Upload wird geprüft und veröffentlicht …`);
        const result = await request('material-upload-finish', { name: datasetName(), uploadId: start.uploadId });
        manifest = result.manifest;
        await dbPut(MANIFEST_STORE, manifestCacheKey(), manifest).catch(() => {});
        renderLibrary();
        status(`${file.name}: PDF wurde erfolgreich veröffentlicht.`, 'success');
      } catch (error) {
        status(error.message, 'error');
        break;
      }
    }
    q('#materialsUploadInput').value = '';
  }

  async function prepareMaterialsOffline() {
    const button = q('#prepareOfflineMaterials');
    try {
      button.disabled = true;
      if (!manifest || manifest.dataset !== datasetName()) await loadManifest({ quiet: true });
      const pdfs = manifest.nodes.filter((node) => node.type === 'pdf');
      const total = pdfs.reduce((sum, node) => sum + Number(node.bytes || 0), 0);
      const estimate = await navigator.storage?.estimate?.().catch(() => null);
      const available = estimate ? Math.max(0, Number(estimate.quota || 0) - Number(estimate.usage || 0)) : null;
      const storageText = available === null ? '' : `\nGeschätzt verfügbarer Browserspeicher: ${formatBytes(available)}.`;
      if (!pdfs.length) return status('Für diesen Datensatz sind noch keine Lernmaterialien vorhanden.', 'warning');
      if (!confirm(`${pdfs.length} Lernmaterialien, insgesamt ${formatBytes(total)}.\nDie PDFs werden auf diesem Gerät und in diesem Browser gespeichert.${storageText}\n\nJetzt laden?`)) return;
      let done = 0;
      let bytes = 0;
      for (const node of pdfs) {
        status(`Lernmaterial ${done + 1} von ${pdfs.length}: „${node.title}“ wird geladen …`);
        const result = await obtainPdf(node, { progress: (loaded) => {
          q('#offlineMaterialsProgress').style.width = `${Math.round((bytes + loaded) / Math.max(1, total) * 100)}%`;
          q('#offlineMaterialsProgressText').textContent = `${formatBytes(bytes + loaded)} von ${formatBytes(total)}`;
        }});
        bytes += result.blob.size;
        done += 1;
      }
      q('#offlineMaterialsProgress').style.width = '100%';
      q('#offlineMaterialsProgressText').textContent = `${done} von ${pdfs.length} · ${formatBytes(bytes)}`;
      status(`Offline-Vorbereitung abgeschlossen: ${done} Lernmaterialien, ${formatBytes(bytes)}.`, 'success');
      renderLibrary();
    } catch (error) {
      status(`Offline-Vorbereitung unvollständig: ${error.message}`, 'error');
    } finally { button.disabled = false; }
  }

  async function openLibrary() {
    if (loading) return;
    const name = datasetName();
    if (!name || (typeof datasetLoaded !== 'undefined' && !datasetLoaded && !activeToken())) {
      alert('Bitte zuerst einen Farbatlas-Datensatz öffnen.');
      return;
    }
    q('#atlas')?.classList.add('hidden');
    q('#learning')?.classList.add('hidden');
    q('#learningMaterials')?.classList.remove('hidden');
    try { await loadManifest(); } catch (error) { status(error.message, 'error'); }
  }

  function leaveLibrary(target) {
    q('#learningMaterials')?.classList.add('hidden');
    if (target) q(target)?.classList.remove('hidden');
  }

  function installUi() {
    if (q('#learningMaterialsBtn')) return;
    const learn = q('#learnBtn');
    if (!learn) return;
    learn.insertAdjacentHTML('afterend', '<button class="btn ghost" id="learningMaterialsBtn">📚 Lernmaterialien</button>');
    const main = q('main');
    main.insertAdjacentHTML('beforeend', `
      <section id="learningMaterials" class="learning-materials hidden">
        <div class="materials-heading"><div><h1>📚 Lernmaterialien</h1><p>PDF-Folien des geöffneten Datensatzes. Dateien werden erst beim Öffnen oder bei der Offline-Vorbereitung geladen.</p></div><button id="materialsClose" class="btn">← Zum Atlas</button></div>
        <div id="materialsManagement" class="materials-management hidden"><button id="materialsNewFolder" class="btn primary">📁 Neuer Ordner</button><label class="btn good">📄 PDF hochladen<input id="materialsUploadInput" hidden type="file" accept="application/pdf,.pdf" multiple></label></div>
        <div id="materialsStatus" class="materials-status">Bitte einen Datensatz öffnen.</div>
        <div id="materialsBreadcrumbs" class="materials-breadcrumbs"></div>
        <div class="materials-layout"><nav id="materialsTree" class="materials-tree" aria-label="Materialordner"></nav><div id="materialsContent" class="materials-content"></div></div>
      </section>`);
    q('#learningMaterialsBtn').onclick = openLibrary;
    q('#materialsClose').onclick = () => leaveLibrary('#atlas');
    q('#materialsNewFolder').onclick = createFolder;
    q('#materialsUploadInput').onchange = (event) => uploadFiles([...event.target.files]);
    q('#atlasBtn')?.addEventListener('click', () => leaveLibrary('#atlas'));
    q('#learnBtn')?.addEventListener('click', () => leaveLibrary('#learning'));

    const speedActions = q('#prepareOfflineComplete')?.closest('.farbatlas-speed-actions');
    if (speedActions && !q('#prepareOfflineMaterials')) {
      speedActions.insertAdjacentHTML('beforeend', '<button id="prepareOfflineMaterials" class="btn material-offline-button">📚 Lernmaterialien laden</button>');
      speedActions.insertAdjacentHTML('afterend', '<div class="material-offline-progress"><div id="offlineMaterialsProgress"></div></div><div id="offlineMaterialsProgressText" class="statusline">Lernmaterialien noch nicht geladen.</div>');
      q('#prepareOfflineMaterials').onclick = prepareMaterialsOffline;
    }

    q('#openDatasetBtn')?.addEventListener('click', () => {
      datasetPassword = q('#openDatasetPassword')?.value || '';
      setTimeout(() => { if (!q('#learningMaterials')?.classList.contains('hidden')) loadManifest().catch((error) => status(error.message, 'error')); }, 900);
    }, true);
    q('#courseOpenDataset')?.addEventListener('click', () => setTimeout(() => {
      if (!q('#learningMaterials')?.classList.contains('hidden')) loadManifest().catch((error) => status(error.message, 'error'));
    }, 900));
  }

  function waitForOfflinePanel(attempt = 0) {
    installUi();
    if (!q('#prepareOfflineMaterials') && attempt < 30) setTimeout(() => waitForOfflinePanel(attempt + 1), 250);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => waitForOfflinePanel());
  else waitForOfflinePanel();

  window.FarbatlasLearningMaterials = Object.freeze({ open: openLibrary, reload: loadManifest, prepareOffline: prepareMaterialsOffline });
})();
