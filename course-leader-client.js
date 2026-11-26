/* Farbatlas Phase 1: Kursleiter-Arbeitsversion */
(() => {
  'use strict';

  const COURSE_TOKEN_KEY = 'farbatlasCourseTokenV1';
  const COURSE_PROFILE_KEY = 'farbatlasCourseProfileV1';
  const PERMISSION_KNOWLEDGE = 'knowledge.edit';
  const PERMISSION_ACADEMIC = 'academicLinks.edit';
  const RECORD_FIELDS = Object.freeze([
    { key: 'family', permission: 'record.family.edit', label: 'Familie', input: 'editFamily' },
    { key: 'genus', permission: 'record.genus.edit', label: 'Gattung', input: 'editGenus' },
    { key: 'species', permission: 'record.species.edit', label: 'Art', input: 'editSpecies' },
    { key: 'de', permission: 'record.de.edit', label: 'Deutscher Name', input: 'editDe' },
    { key: 'en', permission: 'record.en.edit', label: 'Englischer Name', input: 'editEn' },
    { key: 'place', permission: 'record.place.edit', label: 'Fundort', input: 'editPlace' },
    { key: 'author', permission: 'record.author.edit', label: 'Beschreiber', input: 'editAuthor' },
    { key: 'group', permission: 'record.group.edit', label: 'Tiergruppe', input: 'targetGroup' },
  ]);
  const RECORD_FIELD_BY_KEY = Object.fromEntries(RECORD_FIELDS.map((field) => [field.key, field]));
  const $c = (selector) => document.querySelector(selector);
  const cEsc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));

  let courseToken = sessionStorage.getItem(COURSE_TOKEN_KEY) || '';
  let courseProfile = null;
  let selectedDataset = '';
  let versionTag = '';
  let baseline = { knowledge: {}, academicLinks: {}, recordFields: {}, groups: {}, effectiveGroups: {} };
  let adminUsers = [];
  let adminDatasets = [];

  try {
    courseProfile = JSON.parse(sessionStorage.getItem(COURSE_PROFILE_KEY) || 'null');
  } catch {
    courseProfile = null;
  }

  class ApiError extends Error {
    constructor(message, status, body) {
      super(message);
      this.status = status;
      this.body = body;
    }
  }

  async function request(action, data = {}, mode = 'course') {
    const token = mode === 'admin'
      ? (typeof adminToken !== 'undefined' ? adminToken : '')
      : courseToken;
    const response = await fetch('/api/farbatlas', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: 'Bearer ' + token } : {})
      },
      body: JSON.stringify({ action, ...data })
    });
    const text = await response.text();
    let body;
    try { body = JSON.parse(text); } catch { body = { error: text || `HTTP ${response.status}` }; }
    if (!response.ok) throw new ApiError(body.error || `HTTP ${response.status}`, response.status, body);
    return body;
  }

  const hasPermission = (permission) =>
    Boolean(courseProfile?.permissions?.includes(permission));

  function installStyles() {
    const style = document.createElement('style');
    style.textContent = `
      .course-toggle{background:#4b7f52!important}
      .course-session{display:grid;gap:10px}
      .course-session-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
      .course-session-row select{flex:1;min-width:220px;padding:10px;border:1px solid #b7d5d9;border-radius:9px}
      .course-badge{display:inline-block;border-radius:999px;padding:6px 10px;background:#dff2e2;color:#174b25;font-weight:800}
      .course-warning{padding:10px;border-radius:10px;background:#fff2cc;color:#665000}
      .course-admin{margin-top:14px;padding:14px;border:1px solid #acd0b3;border-radius:14px;background:#f4fbf5}
      .course-admin-list{display:grid;gap:9px;margin-top:12px}
      .course-admin-row{display:grid;grid-template-columns:minmax(190px,1fr) auto auto auto;gap:8px;align-items:center;padding:11px;border:1px solid #c8dfcd;border-radius:12px;background:#fff}
      .course-admin-meta{font-size:13px;color:#536d5a}
      .course-fieldset{border:1px solid #c9dde0;border-radius:12px;padding:12px;margin-top:12px}
      .course-fieldset label{display:block;margin:8px 0}
      .course-fieldset input[type=text],.course-fieldset input[type=password],.course-fieldset input[type=datetime-local]{width:100%;padding:10px;border:1px solid #b7d5d9;border-radius:9px}
      .course-datasets{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:7px;max-height:210px;overflow:auto}
      .course-history{display:grid;gap:10px}
      .course-history-entry{border:1px solid #c9dde0;border-radius:12px;padding:12px;background:#f8fcfc}
      .course-version{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px}
      .course-version pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:180px;overflow:auto;background:#fff;border:1px solid #d7e8ea;border-radius:8px;padding:8px;margin:0}
      .course-conflict{border:1px solid #e0b56a;border-radius:12px;padding:12px;background:#fffaf0;margin:10px 0}
      body.course-leader-mode.course-can-academic:not(.admin-mode) .edit-group{display:block!important}
      body.course-leader-mode:not(.admin-mode) .move,
      body.course-leader-mode:not(.admin-mode) .image-pick,
      body.course-leader-mode:not(.admin-mode) .trash-card,
      body.course-leader-mode:not(.admin-mode) .undo-zone{display:none!important}
      body.course-leader-mode.course-can-record:not(.admin-mode) .move{display:flex!important}
      body.course-leader-mode:not(.admin-mode) .course-readonly{background:#eef4f5;color:#52666b;cursor:not-allowed}
      body.course-leader-mode:not(.admin-mode) .knowledge-editor[contenteditable=false]{background:#eef4f5;color:#52666b}
      @media(max-width:760px){.course-admin-row{grid-template-columns:1fr}.course-version{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }

  function installCoursePanel() {
    const stack = $c('.access-stack');
    const adminToggle = $c('#adminToggle');
    if (!stack || !adminToggle || $c('#courseToggle')) return;
    adminToggle.insertAdjacentHTML('beforebegin', `
      <button id="courseToggle" class="access-toggle course-toggle">🎓 Kursleiter Login</button>
      <section id="coursePanel" class="access-panel hidden">
        <div class="access-card">
          <div class="collapse-row"><button id="closeCoursePanel" class="btn">✕ Zuklappen</button></div>
          <div id="courseLoginView">
            <input id="courseUsername" autocomplete="username" placeholder="Benutzername">
            <input id="coursePassword" type="password" autocomplete="current-password" placeholder="Passwort">
            <button id="courseLoginBtn" class="btn primary">Als Kursleiter anmelden</button>
          </div>
          <div id="courseSessionView" class="course-session hidden">
            <div><span id="courseIdentity" class="course-badge"></span></div>
            <div id="coursePermissions" class="statusline"></div>
            <div class="course-session-row">
              <select id="courseDatasetSelect"></select>
              <button id="courseOpenDataset" class="btn primary">Datensatz öffnen</button>
            </div>
            <div class="course-session-row">
              <button id="courseSave" class="btn good">Datensatz speichern</button>
              <button id="courseHistory" class="btn">Meine Änderungen</button>
              <button id="courseLogout" class="btn bad">Abmelden</button>
            </div>
          </div>
          <div id="courseStatus" class="statusline"></div>
        </div>
      </section>
    `);
    $c('#courseToggle').onclick = () => toggleCoursePanel(true);
    $c('#closeCoursePanel').onclick = () => toggleCoursePanel(false);
    $c('#courseLoginBtn').onclick = loginCourseLeader;
    $c('#courseOpenDataset').onclick = openCourseDataset;
    $c('#courseSave').onclick = saveCourseChanges;
    $c('#courseHistory').onclick = showCourseHistory;
    $c('#courseLogout').onclick = logoutCourseLeader;
    $c('#coursePassword').addEventListener('keydown', (event) => {
      if (event.key === 'Enter') loginCourseLeader();
    });
  }

  function installAdminPanel() {
    const host = $c('#adminPanel .admin-only');
    if (!host || $c('#courseAdminToggle')) return;
    host.insertAdjacentHTML('beforeend', `
      <button id="courseAdminToggle" class="dataset-admin-toggle" style="background:#4b7f52">🎓 Kursleiterkonten &amp; Änderungsprotokoll</button>
      <section id="courseAdminPanel" class="course-admin hidden">
        <div class="collapse-row"><button id="closeCourseAdminPanel" class="btn">✕ Zuklappen</button></div>
        <div class="dataset-actions">
          <button id="newCourseLeader" class="btn primary">Kursleiter anlegen</button>
          <button id="refreshCourseLeaders" class="btn">Liste aktualisieren</button>
          <button id="showAudit" class="btn">Änderungsprotokoll</button>
        </div>
        <div id="courseAdminStatus" class="statusline"></div>
        <div id="courseAdminList" class="course-admin-list"></div>
      </section>
    `);
    $c('#courseAdminToggle').onclick = async () => {
      $c('#courseAdminPanel').classList.remove('hidden');
      await loadCourseAdminData();
    };
    $c('#closeCourseAdminPanel').onclick = () => $c('#courseAdminPanel').classList.add('hidden');
    $c('#newCourseLeader').onclick = () => openCourseLeaderForm(null);
    $c('#refreshCourseLeaders').onclick = loadCourseAdminData;
    $c('#showAudit').onclick = showAdminAudit;
  }

  function toggleCoursePanel(open) {
    $c('#coursePanel')?.classList.toggle('hidden', !open);
  }

  function setStatus(message, kind = '') {
    const status = $c('#courseStatus');
    if (!status) return;
    status.textContent = message;
    status.style.color = kind === 'error' ? '#c44545' : kind === 'success' ? '#16885a' : '#173640';
  }

  function updateCourseUi() {
    const signedIn = Boolean(courseToken && courseProfile);
    document.body.classList.toggle('course-leader-mode', signedIn);
    document.body.classList.toggle('course-can-academic', signedIn && hasPermission(PERMISSION_ACADEMIC));
    document.body.classList.toggle('course-can-record', signedIn && (
      RECORD_FIELDS.some((field) => hasPermission(field.permission)) || hasPermission(PERMISSION_KNOWLEDGE)
    ));
    $c('#courseLoginView')?.classList.toggle('hidden', signedIn);
    $c('#courseSessionView')?.classList.toggle('hidden', !signedIn);
    if (!signedIn) return;

    $c('#courseIdentity').textContent = courseProfile.displayName;
    const labels = [];
    const editableRecordLabels = RECORD_FIELDS.filter((field) => hasPermission(field.permission)).map((field) => field.label);
    if (editableRecordLabels.length) labels.push('Tierdaten (' + editableRecordLabels.join(', ') + ')');
    if (hasPermission(PERMISSION_KNOWLEDGE)) labels.push('Wissenstexte');
    if (hasPermission(PERMISSION_ACADEMIC)) labels.push('akademische Links');
    $c('#coursePermissions').textContent = labels.length
      ? 'Freigegeben: ' + labels.join(', ')
      : 'Keine Bearbeitungsrechte; nur Lesen.';
    const select = $c('#courseDatasetSelect');
    select.innerHTML = (courseProfile.datasets || []).length
      ? courseProfile.datasets.map((name) => `<option value="${cEsc(name)}">${cEsc(name)}</option>`).join('')
      : '<option value="">Kein Datensatz zugewiesen</option>';
    $c('#courseOpenDataset').disabled = !(courseProfile.datasets || []).length;
    $c('#courseSave').disabled = !selectedDataset || !labels.length;
  }

  function storeCourseSession(token, profile) {
    courseToken = token;
    courseProfile = profile;
    sessionStorage.setItem(COURSE_TOKEN_KEY, token);
    sessionStorage.setItem(COURSE_PROFILE_KEY, JSON.stringify(profile));
    updateCourseUi();
  }

  async function loginCourseLeader() {
    try {
      setStatus('Anmeldung wird geprüft …');
      const result = await request('course-login', {
        username: $c('#courseUsername').value.trim(),
        password: $c('#coursePassword').value
      });
      storeCourseSession(result.token, result.profile);
      $c('#coursePassword').value = '';
      setStatus('Kursleiter-Anmeldung erfolgreich.', 'success');
    } catch (error) {
      setStatus(error.message, 'error');
    }
  }

  async function clearLocalDatasetCache() {
    await new Promise((resolve) => {
      try {
        const open = indexedDB.open('farbatlas-des-meeres-cache', 1);
        open.onerror = () => resolve();
        open.onupgradeneeded = () => {
          if (!open.result.objectStoreNames.contains('state')) open.result.createObjectStore('state');
        };
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('state', 'readwrite');
          tx.objectStore('state').delete('lastDataset');
          tx.oncomplete = () => { db.close(); resolve(); };
          tx.onerror = () => { db.close(); resolve(); };
        };
      } catch { resolve(); }
    });
  }

  async function logoutCourseLeader() {
    const pending = collectCourseChanges();
    if ((pending.knowledge.length || pending.recordFields.length || pending.academicLinks.length) &&
        !confirm('Es gibt noch nicht serverseitig gespeicherte Änderungen. Wirklich abmelden und lokale Änderungen verwerfen?')) return;
    sessionStorage.removeItem(COURSE_TOKEN_KEY);
    sessionStorage.removeItem(COURSE_PROFILE_KEY);
    courseToken = '';
    courseProfile = null;
    selectedDataset = '';
    versionTag = '';
    baseline = { knowledge: {}, academicLinks: {}, recordFields: {}, groups: {}, effectiveGroups: {} };
    await clearLocalDatasetCache();
    location.reload();
  }

  function captureBaseline(payload) {
    const knowledge = {};
    const recordFields = {};
    const groups = {};
    const effectiveGroups = {};
    const liveRecords = new Map(
      typeof records !== 'undefined' && Array.isArray(records)
        ? records.map((record) => [record.name, record])
        : []
    );
    for (const image of payload.images || []) {
      const parts = String(image.name || '').split('#');
      const edit = payload.recordEdits?.[image.name] || {};
      const live = liveRecords.get(image.name) || {};
      const fallback = {
        family: parts[0] || '', genus: parts[1] || '', species: parts[2] || '',
        de: parts[3] || '', en: parts[4] || '', place: parts[6] || '', author: parts[7] || ''
      };
      recordFields[image.name] = {};
      for (const field of RECORD_FIELDS.filter((entry) => entry.key !== 'group')) {
        recordFields[image.name][field.key] = String(live[field.key] ?? edit[field.key] ?? fallback[field.key] ?? '').trim();
      }
      knowledge[image.name] = sanitizeKnowledgeHtml(live.knowledge ?? edit.knowledge ?? '');
      groups[image.name] = String(payload.groupMoves?.[image.name] || '');
      effectiveGroups[image.name] = String(live.group || groups[image.name] || '');
    }
    const academicLinks = {};
    for (const [group, value] of Object.entries(payload.savedGroups || {})) {
      academicLinks[group] = safeKnowledgeUrl(value?.academicUrl || '') || '';
    }
    baseline = { knowledge, academicLinks, recordFields, groups, effectiveGroups };
  }

  async function openCourseDataset() {
    const select = $c('#courseDatasetSelect');
    const name = select.value;
    if (!name) return;
    const button = $c('#courseOpenDataset');
    try {
      button.disabled = true;
      setStatus('Datensatz wird geladen …');
      const result = await request('load', { name });
      const payload = result.payload || {};
      if (window.FarbatlasRuntime?.applyDatasetPayload) {
        window.FarbatlasRuntime.applyDatasetPayload(payload, result.name, result.versionTag || '');
      } else {
        const images = [];
        for (let index = 0; index < (payload.images || []).length; index += 1) {
          const image = payload.images[index];
          setStatus(`Bild ${index + 1} von ${payload.images.length} wird geladen …`);
          if (image.src) images.push(image);
          else if (image.imageKey) {
            const loaded = await request('get-image', { name, imageKey: image.imageKey });
            images.push({ ...image, src: `data:${loaded.type};base64,${loaded.data}` });
          }
        }
        loadDatasetPayload({ ...payload, images }, result.name);
      }
      selectedDataset = result.name;
      versionTag = result.versionTag || '';
      captureBaseline(payload);
      $c('#courseSave').disabled = !(
        hasPermission(PERMISSION_KNOWLEDGE)
        || hasPermission(PERMISSION_ACADEMIC)
        || RECORD_FIELDS.some((field) => hasPermission(field.permission))
      );
      setStatus(`Datensatz „${result.name}“ wurde geöffnet.`, 'success');
    } catch (error) {
      setStatus(error.message, 'error');
    } finally {
      button.disabled = !(courseProfile?.datasets || []).length;
    }
  }

  function collectCourseChanges() {
    const knowledge = [];
    const recordFields = [];
    const academicLinks = [];
    if (!selectedDataset) return { knowledge, recordFields, academicLinks };

    for (const [key, initial] of Object.entries(baseline.recordFields || {})) {
      for (const field of RECORD_FIELDS.filter((entry) => entry.key !== 'group')) {
        if (!hasPermission(field.permission)) continue;
        const baseValue = initial[field.key] || '';
        const value = String(recordEdits?.[key]?.[field.key] ?? baseValue).trim();
        if (value !== baseValue) recordFields.push({ key, field: field.key, baseValue, value });
      }
      const groupField = RECORD_FIELD_BY_KEY.group;
      if (hasPermission(groupField.permission)) {
        const initialEffective = baseline.effectiveGroups?.[key] || '';
        const value = String(groupMoves?.[key] ?? initialEffective).trim();
        if (value !== initialEffective) {
          recordFields.push({ key, field: 'group', baseValue: baseline.groups?.[key] || '', value });
        }
      }
    }

    if (hasPermission(PERMISSION_KNOWLEDGE)) {
      const keys = new Set([...Object.keys(baseline.knowledge), ...Object.keys(recordEdits || {})]);
      for (const key of keys) {
        const baseValue = baseline.knowledge[key] || '';
        const value = sanitizeKnowledgeHtml(recordEdits?.[key]?.knowledge || '');
        if (value !== baseValue) knowledge.push({ key, baseValue, value });
      }
    }
    if (hasPermission(PERMISSION_ACADEMIC)) {
      const keys = new Set([...Object.keys(baseline.academicLinks), ...Object.keys(savedGroups || {})]);
      for (const key of keys) {
        const baseValue = baseline.academicLinks[key] || '';
        const value = safeKnowledgeUrl(savedGroups?.[key]?.academicUrl || '') || '';
        if (value !== baseValue) academicLinks.push({ key, baseValue, value });
      }
    }
    return { knowledge, recordFields, academicLinks };
  }

  function acceptSavedChanges(changes) {
    for (const change of changes.knowledge || []) baseline.knowledge[change.key] = change.value;
    for (const change of changes.recordFields || []) {
      if (change.field === 'group') {
        baseline.groups[change.key] = change.value;
        baseline.effectiveGroups[change.key] = change.value;
      } else {
        baseline.recordFields[change.key] ||= {};
        baseline.recordFields[change.key][change.field] = change.value;
      }
    }
    for (const change of changes.academicLinks || []) baseline.academicLinks[change.key] = change.value;
  }

  async function saveCourseChanges() {
    if (!selectedDataset) {
      setStatus('Bitte zuerst einen zugewiesenen Datensatz öffnen.', 'error');
      return;
    }
    const changes = collectCourseChanges();
    const count = changes.knowledge.length + changes.recordFields.length + changes.academicLinks.length;
    if (!count) {
      setStatus('Keine neuen Änderungen vorhanden.');
      return;
    }
    if (count > 200) {
      setStatus('Mehr als 200 Änderungen sind offen. Bitte in kleineren Paketen bearbeiten und speichern.', 'error');
      return;
    }
    const button = $c('#courseSave');
    try {
      button.disabled = true;
      setStatus(`${count} Änderung(en) werden geprüft und gespeichert …`);
      const result = await request('course-save-content', {
        name: selectedDataset,
        versionTag,
        changes
      });
      versionTag = result.versionTag || versionTag;
      acceptSavedChanges(changes);
      scheduleDatasetCache();
      setStatus(result.message, result.auditWarning ? 'error' : 'success');
      if (result.auditWarning) alert(result.auditWarning);
    } catch (error) {
      if (error.status === 409 && Array.isArray(error.body?.conflicts) && error.body.conflicts.length) {
        showConflictDialog(error.body.conflicts);
      } else {
        setStatus(error.message, 'error');
      }
    } finally {
      button.disabled = false;
    }
  }

  function setLocalConflictValue(conflict, value) {
    if (conflict.field === 'knowledge') {
      recordEdits[conflict.key] = {
        ...(recordEdits[conflict.key] || {}),
        knowledge: sanitizeKnowledgeHtml(value || '')
      };
    } else if (conflict.field === 'academicLink') {
      const group = conflict.key;
      const current = savedGroups[group] || {};
      const fallback = GROUPS[group] || ['🔬', '#68c7c2', '#357b8c', []];
      savedGroups[group] = {
        icon: current.icon || fallback[0],
        c1: current.c1 || fallback[1],
        c2: current.c2 || fallback[2],
        families: current.families || fallback[3] || [],
        ...current,
        academicUrl: value || ''
      };
    } else if (conflict.field === 'group') {
      if (value) groupMoves[conflict.key] = value;
      else delete groupMoves[conflict.key];
    } else if (RECORD_FIELD_BY_KEY[conflict.field]) {
      recordEdits[conflict.key] = {
        ...(recordEdits[conflict.key] || {}),
        [conflict.field]: String(value ?? '')
      };
    }
  }

  function changeLabel(field) {
    if (field === 'knowledge') return 'Wissenstext';
    if (field === 'academicLink') return 'Akademischer Link';
    return RECORD_FIELD_BY_KEY[field]?.label || field;
  }

  function showConflictDialog(conflicts) {
    const rows = conflicts.map((conflict, index) => `
      <div class="course-conflict" data-conflict="${index}">
        <b>${cEsc(changeLabel(conflict.field))}: ${cEsc(conflict.key)}</b>
        <div class="course-version">
          <div><strong>Serverfassung</strong><pre>${cEsc(conflict.serverValue || '(leer)')}</pre></div>
          <div><strong>Eigene Fassung</strong><pre>${cEsc(conflict.proposedValue || '(leer)')}</pre></div>
        </div>
        <label><input type="radio" name="conflict-${index}" value="server"> Serverfassung übernehmen</label><br>
        <label><input type="radio" name="conflict-${index}" value="own"> Eigene Fassung erneut speichern</label>
      </div>
    `).join('');
    $c('#modalContent').innerHTML = `
      <div class="formbox"><h2>Gleichzeitige Änderung erkannt</h2>
      <p>Für jeden Konflikt muss ausdrücklich eine Fassung gewählt werden. Es wird nichts still überschrieben.</p>
      ${rows}
      <div class="form-actions"><button id="cancelConflict" class="btn">Abbrechen</button><button id="applyConflict" class="btn primary">Entscheidung anwenden</button></div></div>
    `;
    $c('#modal').classList.remove('hidden');
    $c('#cancelConflict').onclick = () => $c('#modal').classList.add('hidden');
    $c('#applyConflict').onclick = async () => {
      const choices = conflicts.map((_, index) =>
        $c(`input[name="conflict-${index}"]:checked`)?.value || ''
      );
      if (choices.some((choice) => !choice)) {
        alert('Bitte für jeden Konflikt eine Fassung wählen.');
        return;
      }
      conflicts.forEach((conflict, index) => {
        if (conflict.field === 'knowledge') baseline.knowledge[conflict.key] = conflict.serverValue || '';
        else if (conflict.field === 'academicLink') baseline.academicLinks[conflict.key] = conflict.serverValue || '';
        else if (conflict.field === 'group') {
          baseline.groups[conflict.key] = conflict.serverValue || '';
          baseline.effectiveGroups[conflict.key] = conflict.serverValue || baseline.effectiveGroups[conflict.key] || '';
        } else {
          baseline.recordFields[conflict.key] ||= {};
          baseline.recordFields[conflict.key][conflict.field] = conflict.serverValue || '';
        }
        if (choices[index] === 'server') setLocalConflictValue(conflict, conflict.serverValue || '');
      });
      saveGroupSettings();
      rebuild();
      $c('#modal').classList.add('hidden');
      await saveCourseChanges();
    };
    setStatus('Konflikt erkannt: Bitte beide Fassungen vergleichen.', 'error');
  }

  function openCourseRecordEditor(record) {
    if (!record || !selectedDataset) return;
    const can = (key) => hasPermission(RECORD_FIELD_BY_KEY[key]?.permission);
    const input = (field, wide = false) => {
      const editable = can(field.key);
      return `<div class="${wide ? 'wide' : ''}"><label>${cEsc(field.label)}</label><input id="${field.input}" value="${cEsc(record[field.key] || '')}" ${editable ? '' : 'disabled'} class="${editable ? '' : 'course-readonly'}"></div>`;
    };
    const standardFields = RECORD_FIELDS.filter((field) => !['group', 'author'].includes(field.key));
    const canKnowledge = hasPermission(PERMISSION_KNOWLEDGE);
    const canGroup = can('group');
    const anyEditable = canKnowledge || RECORD_FIELDS.some((field) => can(field.key));
    const names = Object.keys(GROUPS || {}).sort((a, b) => a.localeCompare(b, 'de'));
    const currentGroup = record.group || '';
    $c('#modalContent').innerHTML = `<div class="formbox"><h2>Tierdaten bearbeiten</h2>
      <div class="edit-grid">
        ${standardFields.map((field) => input(field)).join('')}
        ${input(RECORD_FIELD_BY_KEY.author, true)}
        <div class="wide"><label>Wissen zur Spezies</label>
          ${canKnowledge ? '<div class="knowledge-toolbar"><button id="insertKnowledgeLink" class="link-tool hidden" type="button" title="Link für markierten Text einfügen">🔗</button><div id="knowledgeLinkInputs" class="link-inputs hidden"><input id="knowledgeLinkUrl" type="url" placeholder="https://…"><button id="applyKnowledgeLink" class="btn primary" type="button">Link einsetzen</button><button id="cancelKnowledgeLink" class="btn" type="button">Abbrechen</button></div></div>' : ''}
          <div id="editKnowledge" class="knowledge-editor ${canKnowledge ? '' : 'course-readonly'}" contenteditable="${canKnowledge ? 'true' : 'false'}" role="textbox" aria-multiline="true">${sanitizeKnowledgeHtml(record.knowledge || '')}</div>
          <div class="knowledge-hint">${canKnowledge ? 'Der Wissenstext kann bearbeitet und anschließend mit „Datensatz speichern“ serverseitig gespeichert werden.' : 'Dieses Feld ist sichtbar, aber vom Administrator nicht zur Bearbeitung freigegeben.'}</div>
        </div>
        <div class="wide"><label>Tiergruppe</label><select id="targetGroup" ${canGroup ? '' : 'disabled'} class="${canGroup ? '' : 'course-readonly'}">
          ${names.map((group) => `<option ${group === currentGroup ? 'selected' : ''}>${cEsc(group)}</option>`).join('')}
        </select></div>
      </div>
      <div class="form-actions"><button class="btn" id="cancelCourseRecord">${anyEditable ? 'Abbrechen' : 'Schließen'}</button>${anyEditable ? '<button class="btn primary" id="saveCourseRecord">Lokal übernehmen</button>' : ''}</div>
    </div>`;
    $c('#modal').classList.remove('hidden');
    if (canKnowledge) setupKnowledgeEditor();
    $c('#cancelCourseRecord').onclick = () => $c('#modal').classList.add('hidden');
    if (!anyEditable) return;
    $c('#saveCourseRecord').onclick = () => {
      const next = { ...(recordEdits[record.name] || {}) };
      for (const field of RECORD_FIELDS.filter((entry) => entry.key !== 'group')) {
        if (can(field.key)) next[field.key] = $c('#' + field.input).value.trim();
      }
      if (canKnowledge) next.knowledge = sanitizeKnowledgeHtml($c('#editKnowledge').innerHTML);
      recordEdits[record.name] = next;
      if (canGroup) groupMoves[record.name] = $c('#targetGroup').value;
      saveGroupSettings();
      rebuild();
      $c('#modal').classList.add('hidden');
      setStatus('Tierdaten lokal vorbereitet. Bitte anschließend „Datensatz speichern“ wählen.');
    };
  }

  function openCourseKnowledge(record) {
    if (!record) return;
    const body = sanitizeKnowledgeHtml(record.knowledge || '');
    const editable = hasPermission(PERMISSION_KNOWLEDGE);
    $c('#modalContent').innerHTML = `
      <div class="knowledge-panel"><h2>🧠 Wissen: ${cEsc(title(record.de))}</h2>
      ${editable ? `
        <div class="knowledge-toolbar"><button id="insertKnowledgeLink" class="link-tool hidden" type="button" title="Link für markierten Text einfügen">🔗</button>
        <div id="knowledgeLinkInputs" class="link-inputs hidden"><input id="knowledgeLinkUrl" type="url" placeholder="https://…"><button id="applyKnowledgeLink" class="btn primary" type="button">Link einsetzen</button><button id="cancelKnowledgeLink" class="btn" type="button">Abbrechen</button></div></div>
        <div id="editKnowledge" class="knowledge-editor" contenteditable="true" role="textbox" aria-multiline="true">${body}</div>
        <div class="knowledge-hint">Die Änderung wird zuerst lokal vorbereitet und erst mit „Änderungen speichern“ serverseitig versioniert.</div>
      ` : `<div class="knowledge-content ${body ? '' : 'knowledge-empty'}">${body || 'Für diese Spezies sind noch keine zusätzlichen Wissensinhalte eingetragen.'}</div>`}
      <div class="form-actions"><button id="courseKnowledgeClose" class="btn">Zurück</button>${editable ? '<button id="courseKnowledgeApply" class="btn primary">Lokal übernehmen</button>' : ''}</div></div>
    `;
    $c('#modal').classList.remove('hidden');
    if (editable) setupKnowledgeEditor();
    $c('#courseKnowledgeClose').onclick = () => $c('#modal').classList.add('hidden');
    if (editable) $c('#courseKnowledgeApply').onclick = () => {
      recordEdits[record.name] = {
        ...(recordEdits[record.name] || {}),
        knowledge: sanitizeKnowledgeHtml($c('#editKnowledge').innerHTML)
      };
      saveGroupSettings();
      rebuild();
      $c('#modal').classList.add('hidden');
      setStatus('Wissenstext lokal vorbereitet. Bitte anschließend serverseitig speichern.');
    };
  }

  function openCourseAcademicEditor(group) {
    if (!hasPermission(PERMISSION_ACADEMIC)) return;
    const value = savedGroups[group]?.academicUrl || '';
    $c('#modalContent').innerHTML = `
      <div class="formbox"><h2>Akademischen Link bearbeiten</h2>
      <p><strong>${cEsc(group)}</strong></p>
      <label>URL für akademische Informationen</label>
      <input id="courseAcademicUrl" type="url" value="${cEsc(value)}" placeholder="https://… oder www.beispiel.at">
      <div class="group-url-hint">Die Bezeichnung und Struktur der Organismengruppe bleiben unverändert.</div>
      <div class="form-actions"><button id="courseAcademicCancel" class="btn">Abbrechen</button><button id="courseAcademicApply" class="btn primary">Lokal übernehmen</button></div></div>
    `;
    $c('#modal').classList.remove('hidden');
    $c('#courseAcademicCancel').onclick = () => $c('#modal').classList.add('hidden');
    $c('#courseAcademicApply').onclick = () => {
      const raw = $c('#courseAcademicUrl').value.trim();
      const academicUrl = raw ? safeKnowledgeUrl(raw) : '';
      if (raw && !academicUrl) {
        alert('Bitte eine gültige HTTP- oder HTTPS-Webadresse eingeben.');
        return;
      }
      const fallback = GROUPS[group] || ['🔬', '#68c7c2', '#357b8c', []];
      savedGroups[group] = {
        icon: fallback[0], c1: fallback[1], c2: fallback[2], families: fallback[3] || [],
        ...(savedGroups[group] || {}), academicUrl
      };
      saveGroupSettings();
      rebuild();
      $c('#modal').classList.add('hidden');
      setStatus('Akademischer Link lokal vorbereitet. Bitte anschließend serverseitig speichern.');
    };
  }

  function installEditorOverrides() {
    if (typeof openKnowledge === 'function') {
      const originalKnowledge = openKnowledge;
      openKnowledge = (record) => {
        if (courseToken && courseProfile) return openCourseRecordEditor(record);
        return originalKnowledge(record);
      };
    }
    if (typeof openGroupAssignment === 'function') {
      const originalRecordEditor = openGroupAssignment;
      openGroupAssignment = (record) => {
        if (courseToken && courseProfile) return openCourseRecordEditor(record);
        return originalRecordEditor(record);
      };
    }
    if (typeof openRenameGroup === 'function') {
      const originalRename = openRenameGroup;
      openRenameGroup = (group) => {
        if (courseToken && courseProfile) return openCourseAcademicEditor(group);
        return originalRename(group);
      };
    }
  }

  async function showCourseHistory() {
    if (!selectedDataset) {
      setStatus('Bitte zuerst einen Datensatz öffnen.', 'error');
      return;
    }
    try {
      setStatus('Eigene Änderungen werden geladen …');
      const result = await request('course-my-history', { name: selectedDataset });
      const entries = result.entries || [];
      const html = entries.length ? entries.map((entry) => {
        const changes = (entry.changes || []).map((change, index) => `
          <div class="course-history-entry">
            <b>${cEsc(changeLabel(change.field))}: ${cEsc(change.key)}</b>
            <div class="course-version"><div><strong>Vorher</strong><pre>${cEsc(change.before || '(leer)')}</pre></div><div><strong>Nachher</strong><pre>${cEsc(change.after || '(leer)')}</pre></div></div>
            <button class="btn" data-restore-key="${cEsc(entry.key)}" data-restore-index="${index}">Vorherige Version wiederherstellen</button>
          </div>`).join('');
        return `<section><h3>${cEsc(new Date(entry.at).toLocaleString('de-DE'))}</h3>${changes}</section>`;
      }).join('') : '<div class="empty">Noch keine eigenen serverseitigen Änderungen vorhanden.</div>';
      $c('#modalContent').innerHTML = `<div class="formbox"><h2>Meine letzten Änderungen</h2><div class="course-history">${html}</div><div class="form-actions"><button id="closeCourseHistory" class="btn">Schließen</button></div></div>`;
      $c('#modal').classList.remove('hidden');
      $c('#closeCourseHistory').onclick = () => $c('#modal').classList.add('hidden');
      document.querySelectorAll('[data-restore-key]').forEach((button) => {
        button.onclick = async () => {
          if (!confirm('Soll die vorherige Fassung als neue, protokollierte Version wiederhergestellt werden?')) return;
          try {
            await request('course-restore-version', {
              name: selectedDataset,
              auditKey: button.dataset.restoreKey,
              changeIndex: Number(button.dataset.restoreIndex)
            });
            $c('#modal').classList.add('hidden');
            await openCourseDataset();
          } catch (error) {
            alert(error.message);
          }
        };
      });
      setStatus(`${entries.length} Änderungsprotokoll-Einträge geladen.`);
    } catch (error) {
      setStatus(error.message, 'error');
    }
  }

  async function loadCourseAdminData() {
    const status = $c('#courseAdminStatus');
    try {
      status.textContent = 'Kursleiterkonten und Datensätze werden geladen …';
      const [usersResult, datasetsResult] = await Promise.all([
        request('list-course-leaders', {}, 'admin'),
        request('list-datasets', {}, 'admin')
      ]);
      adminUsers = usersResult.users || [];
      adminDatasets = datasetsResult.datasets || [];
      renderCourseAdminList();
      status.textContent = `${adminUsers.length} Kursleiterkonto/-konten · ${adminDatasets.length} Datensätze`;
    } catch (error) {
      status.textContent = error.message;
      status.style.color = '#c44545';
    }
  }

  function renderCourseAdminList() {
    const box = $c('#courseAdminList');
    if (!box) return;
    box.innerHTML = adminUsers.length ? adminUsers.map((user) => `
      <div class="course-admin-row">
        <div><b>${cEsc(user.displayName)}</b><div class="course-admin-meta">${cEsc(user.username)} · ${user.active ? 'aktiv' : 'gesperrt'} · ${(user.datasets || []).length} Datensatz/Datensätze${user.expiresAt ? ' · gültig bis ' + cEsc(new Date(user.expiresAt).toLocaleString('de-DE')) : ''}</div></div>
        <button class="btn" data-edit-course="${encodeURIComponent(user.username)}">Bearbeiten</button>
        <button class="btn" data-reset-course="${encodeURIComponent(user.username)}">Passwort</button>
        <button class="btn bad" data-delete-course="${encodeURIComponent(user.username)}">Löschen</button>
      </div>
    `).join('') : '<div class="dataset-admin-empty">Noch keine Kursleiterkonten vorhanden.</div>';
    document.querySelectorAll('[data-edit-course]').forEach((button) => {
      button.onclick = () => openCourseLeaderForm(
        adminUsers.find((user) => user.username === decodeURIComponent(button.dataset.editCourse))
      );
    });
    document.querySelectorAll('[data-reset-course]').forEach((button) => {
      button.onclick = () => resetCourseLeaderPassword(decodeURIComponent(button.dataset.resetCourse));
    });
    document.querySelectorAll('[data-delete-course]').forEach((button) => {
      button.onclick = () => deleteCourseLeader(decodeURIComponent(button.dataset.deleteCourse));
    });
  }

  function toLocalDateTime(value) {
    if (!value) return '';
    const date = new Date(value);
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  }

  function openCourseLeaderForm(user) {
    const create = !user;
    const selected = new Set(user?.datasets || []);
    const datasets = adminDatasets.length
      ? `<div class="course-datasets">${adminDatasets.map((dataset, index) => `<label><input type="checkbox" data-course-dataset value="${cEsc(dataset.name)}" ${selected.has(dataset.name) ? 'checked' : ''}> ${cEsc(dataset.name)}</label>`).join('')}</div>`
      : '<div class="course-warning">Es sind noch keine Datensätze vorhanden.</div>';
    $c('#modalContent').innerHTML = `
      <div class="formbox"><h2>${create ? 'Kursleiter anlegen' : 'Kursleiter bearbeiten'}</h2>
      <div class="course-fieldset"><label>Name<input id="courseFormName" type="text" value="${cEsc(user?.displayName || '')}"></label>
      <label>Benutzername<input id="courseFormUsername" type="text" value="${cEsc(user?.username || '')}" ${create ? '' : 'disabled'}></label>
      ${create ? '<label>Temporäres Passwort (mindestens 12 Zeichen)<input id="courseFormPassword" type="password" autocomplete="new-password"></label>' : ''}
      <label><input id="courseFormActive" type="checkbox" ${user?.active === false ? '' : 'checked'}> Konto aktiv</label>
      <label>Gültig bis (optional)<input id="courseFormExpires" type="datetime-local" value="${cEsc(toLocalDateTime(user?.expiresAt))}"></label></div>
      <fieldset class="course-fieldset"><legend>Einzelrechte</legend>
      ${RECORD_FIELDS.map((field) => `<label><input data-course-record-permission="${cEsc(field.permission)}" type="checkbox" ${(user?.permissions || []).includes(field.permission) ? 'checked' : ''}> ${cEsc(field.label)} bearbeiten</label>`).join('')}
      <label><input id="coursePermKnowledge" type="checkbox" ${(user?.permissions || [PERMISSION_KNOWLEDGE]).includes(PERMISSION_KNOWLEDGE) ? 'checked' : ''}> Wissenstexte bearbeiten</label>
      <label><input id="coursePermAcademic" type="checkbox" ${(user?.permissions || [PERMISSION_ACADEMIC]).includes(PERMISSION_ACADEMIC) ? 'checked' : ''}> Akademische Links bearbeiten</label></fieldset>
      <fieldset class="course-fieldset"><legend>Zugewiesene Datensätze</legend>${datasets}</fieldset>
      <div class="form-actions"><button id="cancelCourseForm" class="btn">Abbrechen</button><button id="saveCourseForm" class="btn primary">Speichern</button></div></div>
    `;
    $c('#modal').classList.remove('hidden');
    $c('#cancelCourseForm').onclick = () => $c('#modal').classList.add('hidden');
    $c('#saveCourseForm').onclick = async () => {
      const permissions = [];
      document.querySelectorAll('[data-course-record-permission]:checked').forEach((input) => permissions.push(input.dataset.courseRecordPermission));
      if ($c('#coursePermKnowledge').checked) permissions.push(PERMISSION_KNOWLEDGE);
      if ($c('#coursePermAcademic').checked) permissions.push(PERMISSION_ACADEMIC);
      const expiresRaw = $c('#courseFormExpires').value;
      const body = {
        create,
        displayName: $c('#courseFormName').value.trim(),
        username: $c('#courseFormUsername').value.trim(),
        password: create ? $c('#courseFormPassword').value : undefined,
        active: $c('#courseFormActive').checked,
        expiresAt: expiresRaw ? new Date(expiresRaw).toISOString() : '',
        permissions,
        datasets: [...document.querySelectorAll('[data-course-dataset]:checked')].map((input) => input.value)
      };
      try {
        await request('save-course-leader', body, 'admin');
        $c('#modal').classList.add('hidden');
        await loadCourseAdminData();
      } catch (error) {
        alert(error.message);
      }
    };
  }

  async function resetCourseLeaderPassword(username) {
    const password = prompt(`Neues Passwort für „${username}“ (mindestens 12 Zeichen):`);
    if (password === null) return;
    const repeat = prompt('Passwort zur Bestätigung erneut eingeben:');
    if (repeat === null) return;
    if (password !== repeat) return alert('Die Passwörter stimmen nicht überein.');
    try {
      const result = await request('reset-course-leader-password', { username, password }, 'admin');
      alert(result.message);
      await loadCourseAdminData();
    } catch (error) {
      alert(error.message);
    }
  }

  async function deleteCourseLeader(username) {
    if (!confirm(`Kursleiterkonto „${username}“ wirklich löschen? Das Änderungsprotokoll bleibt erhalten.`)) return;
    try {
      const result = await request('delete-course-leader', { username }, 'admin');
      $c('#courseAdminStatus').textContent = result.message;
      await loadCourseAdminData();
    } catch (error) {
      alert(error.message);
    }
  }

  async function showAdminAudit() {
    try {
      const options = ['<option value="">Alle Datensätze</option>', ...adminDatasets.map((dataset) => `<option value="${cEsc(dataset.name)}">${cEsc(dataset.name)}</option>`)].join('');
      $c('#modalContent').innerHTML = `<div class="formbox"><h2>Änderungsprotokoll</h2><div class="course-session-row"><select id="auditDataset">${options}</select><button id="loadAudit" class="btn primary">Laden</button></div><div id="auditResults" class="course-history"></div><div class="form-actions"><button id="closeAudit" class="btn">Schließen</button></div></div>`;
      $c('#modal').classList.remove('hidden');
      $c('#closeAudit').onclick = () => $c('#modal').classList.add('hidden');
      $c('#loadAudit').onclick = async () => {
        const box = $c('#auditResults');
        box.innerHTML = '<p>Protokoll wird geladen …</p>';
        try {
          const result = await request('list-audit', { name: $c('#auditDataset').value, limit: 100 }, 'admin');
          box.innerHTML = (result.entries || []).length ? result.entries.map((entry) => `
            <div class="course-history-entry"><b>${cEsc(entry.actor?.displayName || entry.actor?.username || 'Unbekannt')}</b> · ${cEsc(entry.dataset)}<div class="course-admin-meta">${cEsc(new Date(entry.at).toLocaleString('de-DE'))} · ${(entry.changes || []).length} Änderung(en)</div>
            ${(entry.changes || []).map((change) => `<div><strong>${cEsc(changeLabel(change.field))}: ${cEsc(change.key)}</strong><div class="course-version"><div><span>Vorher</span><pre>${cEsc(change.before || '(leer)')}</pre></div><div><span>Nachher</span><pre>${cEsc(change.after || '(leer)')}</pre></div></div></div>`).join('')}</div>
          `).join('') : '<div class="empty">Keine Protokolleinträge gefunden.</div>';
        } catch (error) {
          box.innerHTML = `<div class="course-warning">${cEsc(error.message)}</div>`;
        }
      };
      $c('#loadAudit').click();
    } catch (error) {
      alert(error.message);
    }
  }

  async function restoreCourseSession() {
    if (!courseToken) {
      updateCourseUi();
      return;
    }
    try {
      const result = await request('course-session');
      courseProfile = result.profile;
      sessionStorage.setItem(COURSE_PROFILE_KEY, JSON.stringify(courseProfile));
      updateCourseUi();
      setStatus('Kursleiter-Sitzung wiederhergestellt.', 'success');
    } catch {
      sessionStorage.removeItem(COURSE_TOKEN_KEY);
      sessionStorage.removeItem(COURSE_PROFILE_KEY);
      courseToken = '';
      courseProfile = null;
      await clearLocalDatasetCache();
      location.reload();
    }
  }

  function installHelp() {
    if (typeof HELP_CHAPTERS === 'undefined' || HELP_CHAPTERS.some((chapter) => chapter.id === 'course-leader')) return;
    HELP_CHAPTERS.push({
      id: 'course-leader',
      title: '10. Kursleiter-Arbeitsversion',
      text: 'Kursleiter melden sich im grünen Bereich an und öffnen ausschließlich zugewiesene Datensätze mit derselben Schnellladefunktion wie der Administrator. Das Bearbeiten-Symbol öffnet alle Tierdaten; änderbar sind nur die vom Administrator einzeln freigegebenen Felder. Lokale Änderungen werden mit „Datensatz speichern“ geprüft, versioniert und protokolliert. Bei parallelen Änderungen müssen beide Fassungen verglichen werden.'
    });
  }

  function init() {
    installStyles();
    installCoursePanel();
    installAdminPanel();
    installEditorOverrides();
    installHelp();
    updateCourseUi();
    restoreCourseSession();
    window.FarbatlasCourseLeader = {
      collectChanges: collectCourseChanges,
      getProfile: () => courseProfile,
      getDataset: () => selectedDataset
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
