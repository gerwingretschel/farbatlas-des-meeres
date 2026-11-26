import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const client = read('learning-materials-client.js');
const viewer = read('learning-materials-viewer.js');

test('upload view contains an accessible overall progress bar and one row per file', () => {
  assert.match(client, /id="materialsUploadProgress"[\s\S]*role="region"[\s\S]*aria-live="polite"/);
  assert.match(client, /id="materialsUploadOverallProgress"[\s\S]*aria-label="Gesamtfortschritt"/);
  assert.match(client, /data-material-upload-row="\$\{index\}"/);
  assert.match(client, /aria-label="Upload-Fortschritt für \$\{escapeHtml\(item\.file\.name\)\}"/);
});

test('upload view shows preparation, transfer, verification, completion and error stages', () => {
  for (const label of [
    'Datei wird geprüft', 'Prüfsumme wird berechnet', 'PDF-Seiten werden analysiert',
    'Wird hochgeladen', 'Wird serverseitig geprüft und veröffentlicht',
    'Erfolgreich veröffentlicht', 'Upload fehlgeschlagen',
  ]) assert.match(client, new RegExp(label));
  assert.match(client, /formatBytes\(uploadedBytes\)[\s\S]*Abschnitt \$\{index \+ 1\} von \$\{start\.chunkCount\}/);
});

test('chunk progress advances only after the chunk request has completed', () => {
  const requestPosition = client.indexOf("await request('material-upload-chunk'");
  const updatePosition = client.indexOf('const uploadedBytes =', requestPosition);
  assert.ok(requestPosition >= 0);
  assert.ok(updatePosition > requestPosition);
  assert.match(client.slice(updatePosition, updatePosition + 700), /15 \+ \(uploadedBytes \/ Math\.max\(1, bytes\.length\)\) \* 75/);
});

test('multiple uploads are weighted by file size and concurrent selection is blocked', () => {
  assert.match(client, /totalWeight = items\.reduce[\s\S]*Math\.max\(1, item\.file\.size\)/);
  assert.match(client, /weightedProgress = items\.reduce[\s\S]*item\.file\.size\) \* item\.progress/);
  assert.match(client, /if \(!files\.length \|\| uploadInProgress\) return/);
  assert.match(client, /setUploadInputDisabled\(true\)/);
  assert.match(client, /setUploadInputDisabled\(false\)/);

  const testable = client.replace(
    'window.FarbatlasLearningMaterials = Object.freeze({ open: openLibrary, reload: loadManifest, prepareOffline: prepareMaterialsOffline });',
    'window.__uploadProgressTest = { updateUploadOverview };',
  );
  const elements = new Map([
    ['#materialsUploadOverallProgress', { value: 0 }],
    ['#materialsUploadOverallPercent', { textContent: '' }],
    ['#materialsUploadSummary', { textContent: '' }],
  ]);
  const sandbox = {
    window: {},
    document: { readyState: 'loading', addEventListener() {}, querySelector(selector) { return elements.get(selector) || null; } },
    sessionStorage: { getItem() { return ''; } },
    localStorage: { getItem() { return ''; } },
    console,
  };
  vm.runInNewContext(testable, sandbox);
  sandbox.window.__uploadProgressTest.updateUploadOverview([
    { file: { size: 100 }, progress: 100 },
    { file: { size: 300 }, progress: 0 },
  ], 'Test');
  assert.equal(elements.get('#materialsUploadOverallProgress').value, 25);
  assert.equal(elements.get('#materialsUploadOverallPercent').textContent, '25 %');
  assert.equal(elements.get('#materialsUploadSummary').textContent, 'Test');
});

test('existing upload protocol and limits remain in place', () => {
  assert.match(client, /WARNING_BYTES = 5 \* 1024 \* 1024/);
  assert.match(client, /MAXIMUM_BYTES = 50 \* 1024 \* 1024/);
  for (const action of ['material-upload-start', 'material-upload-chunk', 'material-upload-finish']) {
    assert.match(client, new RegExp(action));
  }
  assert.match(client, /signature !== '%PDF-'/);
  assert.match(client, /expectedVersion: manifest\.version/);
});

test('opening and every page-change path requests the selected page head', () => {
  assert.match(viewer, /await applyFit\('page', \{ top: true \}\)/);
  assert.match(viewer, /const edge = \{ top: position === 'top', bottom: position === 'bottom' \}/);
  assert.match(viewer, /await renderPages\(\{ center: true, \.\.\.edge \}\)/);
  assert.match(viewer, /q\('#pdfPrevious'\)\.onclick = \(\) => changePage/);
  assert.match(viewer, /q\('#pdfNext'\)\.onclick = \(\) => changePage/);
  assert.match(viewer, /q\('#pdfPage'\)\.onchange = \(event\) => changePage/);
  assert.match(viewer, /button\.onclick = \(\) => \{ changePage\(number\)/);
});

test('top reset keeps horizontal centering and forces vertical scroll to zero', () => {
  const testable = viewer.replace(
    'window.FarbatlasPdfViewer = Object.freeze({ open, close, inspect });',
    'window.__pageHeadTest = { restoreView, state };',
  );
  const sandbox = {
    window: { addEventListener() {} },
    document: { querySelector() { return null; } },
    screen: { orientation: null },
    requestAnimationFrame(callback) { callback(); },
    console,
  };
  vm.runInNewContext(testable, sandbox);
  const { restoreView, state } = sandbox.window.__pageHeadTest;
  state.fit = 'fill';
  const stage = {
    scrollWidth: 1200, clientWidth: 400, scrollHeight: 1800, clientHeight: 600,
    scrollLeft: 99, scrollTop: 700,
    classList: { toggle() {} },
  };
  restoreView(stage, { x: 0.5, y: 0.5 }, true, true, false);
  assert.equal(stage.scrollLeft, 400);
  assert.equal(stage.scrollTop, 0);
});

test('width, page, fill and custom zoom calculations are unchanged', () => {
  assert.match(viewer, /if \(mode === 'page'\) return Math\.min\(widthScale, heightScale\)/);
  assert.match(viewer, /if \(mode === 'fill'\) return Math\.max\(widthScale, heightScale\)/);
  assert.match(viewer, /return widthScale/);
  assert.match(viewer, /const MAX_SCALE = 6/);
  assert.match(viewer, /state\.fit = 'custom'/);
  assert.match(viewer, /renderPages\(\{ preserveView: true \}\)/);
});

test('changes remain isolated from KL data collection and server routing', () => {
  for (const source of [client, viewer]) {
    assert.doesNotMatch(source, /collectCourseChanges|captureBaseline|datasetRecordKeys/);
  }
  assert.doesNotMatch(viewer, /material-upload-start|material-upload-chunk|material-upload-finish/);
});
