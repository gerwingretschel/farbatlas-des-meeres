/* Farbatlas V10: getrennte Bildspeicherung */
(() => {
  'use strict';

  const q = (selector) => document.querySelector(selector);
  let v10Name = '';

  function publishDatasetContext(name, loaded = true) {
    v10Name = String(name || '').trim();
    currentDatasetName = v10Name;
    datasetLoaded = Boolean(loaded && v10Name);
    window.FarbatlasRuntime ||= {};
    window.FarbatlasRuntime.getDataset = () => ({
      name: String(currentDatasetName || v10Name || '').trim(),
      loaded: Boolean(datasetLoaded),
      images: Array.isArray(imported) ? imported : [],
    });
    if (typeof updateDatasetIndicator === 'function') updateDatasetIndicator();
    if (datasetLoaded && typeof scheduleDatasetCache === 'function') scheduleDatasetCache();
    window.dispatchEvent(new CustomEvent('farbatlas:dataset-changed', {
      detail: { name: v10Name, loaded: datasetLoaded, imageCount: Array.isArray(imported) ? imported.length : 0 }
    }));
  }

  async function v10api(action, data = {}) {
    const token = sessionStorage.getItem('farbatlasAdminTokenV09') || (typeof adminToken !== 'undefined' ? adminToken : '');
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

  function meta() {
    return {
      version: 10,
      app: document.title,
      images: records.filter((record) => !record.name.startsWith('dummy_')).map((record) => {
        const source = imported.find((item) => item.name === record.name);
        return { name: record.name, imageKey: source?.imageKey || record.imageKey || null };
      }),
      savedGroups,
      groupMoves,
      recordEdits,
      titleImages,
      deleted: [...deletedRecords]
    };
  }

  const imageFrom = (source) => new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = source;
  });

  async function shrink(source) {
    const image = await imageFrom(source);
    let max = 1800;
    let quality = 0.82;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const scale = Math.min(1, max / Math.max(image.width, image.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      const data = dataUrl.split(',')[1];
      if (Math.ceil(data.length * 3 / 4) < 3500000) return { data, type: 'image/jpeg' };
      max = Math.round(max * 0.78);
      quality = Math.max(0.52, quality - 0.07);
    }
    throw new Error('Ein Bild konnte nicht ausreichend verkleinert werden.');
  }

  async function uploadAll(name, password, status) {
    const pending = imported.filter((item) => !item.imageKey);
    for (let index = 0; index < pending.length; index += 1) {
      status.textContent = `Bild ${index + 1} von ${pending.length} wird vorbereitet …`;
      const prepared = await shrink(pending[index].src);
      status.textContent = `Bild ${index + 1} von ${pending.length} wird einzeln gespeichert …`;
      const uploaded = await v10api('upload-image', {
        name,
        password,
        fileName: pending[index].name,
        type: prepared.type,
        data: prepared.data
      });
      pending[index].imageKey = uploaded.imageKey;
    }
    return pending.length;
  }

  async function saveV10(create) {
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
        status.textContent = 'Datensatz wird vorbereitet …';
        await v10api('save', { name, password, payload: { ...meta(), images: [] }, create: true });
      } else {
        await v10api('save', { name, password, payload: meta(), create: false });
      }
      const count = await uploadAll(name, password, status);
      status.textContent = 'Datensatz wird abgeschlossen …';
      const result = await v10api('save', { name, password, payload: meta(), create: false });
      publishDatasetContext(name, true);
      status.textContent = (count ? `${count} Bilder wurden einzeln gespeichert. ` : '') + result.message;
      status.style.color = '#16885a';
    } catch (error) {
      status.textContent = error.message;
      status.style.color = '#c44545';
    } finally {
      createButton.disabled = saveButton.disabled = false;
    }
  }

  async function openV10() {
    const status = q('#datasetStatus');
    try {
      const name = q('#openDatasetName').value.trim();
      const password = q('#openDatasetPassword').value;
      status.textContent = 'Datensatz wird geladen …';
      const result = await v10api('load', { name, password });
      const loadedImages = [];
      for (let index = 0; index < (result.payload.images || []).length; index += 1) {
        const image = result.payload.images[index];
        status.textContent = `Bild ${index + 1} von ${result.payload.images.length} wird geladen …`;
        const stored = await v10api('get-image', { name, password, imageKey: image.imageKey });
        loadedImages.push({ ...image, src: `data:${stored.type};base64,${stored.data}` });
      }
      imported = loadedImages;
      delete GROUPS.Tiere;
      delete GROUPS.Pflanzen;
      savedGroups = result.payload.savedGroups || {};
      delete savedGroups.Tiere;
      delete savedGroups.Pflanzen;
      groupMoves = result.payload.groupMoves || {};
      recordEdits = result.payload.recordEdits || {};
      titleImages = result.payload.titleImages || {};
      deletedRecords = new Set(result.payload.deleted || []);
      Object.entries(savedGroups).forEach(([groupName, data]) => {
        GROUPS[groupName] = [data.icon || '🔬', data.c1 || '#68c7c2', data.c2 || '#357b8c', data.families || []];
      });
      publishDatasetContext(result.name || name, true);
      rebuild();
      go([], false);
      status.textContent = `Datensatz „${result.name}“ wurde geöffnet.`;
    } catch (error) {
      status.textContent = error.message;
    }
  }

  function bind() {
    const createButton = q('#newDatasetBtn');
    const saveButton = q('#saveDatasetBtn');
    const openButton = q('#openDatasetBtn');
    if (createButton) createButton.onclick = () => saveV10(true);
    if (saveButton) saveButton.onclick = () => saveV10(false);
    if (openButton) openButton.onclick = openV10;
    const status = q('#saveDatasetStatus');
    if (status && !q('#v10hint')) {
      status.insertAdjacentHTML('afterend', '<div id="v10hint" class="hint">V10: Bilder werden beim Speichern einzeln hochgeladen. Bitte die Seite geöffnet lassen.</div>');
    }
    if (typeof datasetLoaded !== 'undefined' && datasetLoaded && typeof currentDatasetName !== 'undefined' && currentDatasetName) {
      publishDatasetContext(currentDatasetName, true);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();
