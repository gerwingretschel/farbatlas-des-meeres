import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const server = read('netlify/functions/farbatlas.mjs');
const client = read('learning-materials-client.js');
const viewer = read('learning-materials-viewer.js');
const serviceWorker = read('farbatlas-sw.js');
const inject = read('inject-v10.mjs');

test('server exposes listing, chunked upload/download and material administration', () => {
  for (const action of [
    'material-list', 'material-download-chunk', 'material-upload-start', 'material-upload-chunk',
    'material-upload-finish', 'material-create-folder', 'material-rename', 'material-move', 'material-delete',
  ]) assert.match(server, new RegExp(`body\\.action === ["']${action}["']`));
  assert.match(server, /assertCanManageMaterials/);
  assert.match(server, /assertAssigned\(user, name\)/);
  assert.match(server, /validatePdfHeader/);
  assert.match(server, /hash\.digest\("hex"\) !== meta\.sha256/);
});

test('public material read routes are dispatched by the main handler before login-only routes', () => {
  const handlerStart = server.indexOf('export default async (req) =>');
  const listRoute = server.indexOf('if (body.action === "material-list")');
  const downloadRoute = server.indexOf('if (body.action === "material-download-chunk")');
  const actorGate = server.indexOf('const actor = await principal(req, stores.courseLeaders);', handlerStart);
  const authenticateDatasetStart = server.indexOf('async function authenticateDataset');
  const authenticateDatasetEnd = server.indexOf('async function listDatasets', authenticateDatasetStart);
  const authenticateDatasetBody = server.slice(authenticateDatasetStart, authenticateDatasetEnd);

  assert.ok(handlerStart >= 0 && listRoute > handlerStart, 'material-list must be in the request handler');
  assert.ok(downloadRoute > listRoute, 'download route must follow material-list');
  assert.ok(actorGate > downloadRoute, 'read routes must run before the login-only principal gate');
  assert.doesNotMatch(authenticateDatasetBody, /material-list|material-download-chunk/);
});

test('dataset deletion cleans material manifests, chunks, uploads and audit records', () => {
  assert.match(server, /deleteDatasetMaterials\(stores, name\)/);
  assert.match(server, /deletedMaterialChunks/);
  assert.match(server, /deletedMaterialUploads/);
  assert.match(server, /material-audit-/);
});

test('client keeps PDF data lazy and warns in data saver mode', () => {
  assert.match(client, /material-list/);
  assert.match(client, /material-download-chunk/);
  assert.match(client, /localStorage\.getItem\(DATA_SAVER_KEY\)/);
  assert.match(client, /Im Datensparmodus wird die Datei erst nach deiner Bestätigung geladen/);
  assert.doesNotMatch(client, /material-download-chunk[\s\S]{0,400}loadManifest/);
});

test('client implements 5 MB warning, 50 MB maximum and chunked upload', () => {
  assert.match(client, /WARNING_BYTES = 5 \* 1024 \* 1024/);
  assert.match(client, /MAXIMUM_BYTES = 50 \* 1024 \* 1024/);
  assert.match(client, /material-upload-start/);
  assert.match(client, /material-upload-chunk/);
  assert.match(client, /material-upload-finish/);
});

test('folder tree renders real nested lists with expandable hierarchy', () => {
  assert.match(client, /expandedFolderIds = new Set\(\)/);
  assert.match(client, /data-material-toggle/);
  assert.match(client, /aria-expanded=/);
  assert.match(client, /<ul class="material-tree-children">\$\{folderTree\(folder\.id, depth \+ 1\)\}<\/ul>/);
  assert.match(client, /expandFolderPath\(currentFolderId, false\)/);
  assert.match(client, /if \(currentFolderId\) expandedFolderIds\.add\(currentFolderId\)/);
  assert.doesNotMatch(client, /\$\{folderTree\(folder\.id, depth \+ 1\)\}<\/li>/);

  const testableClient = client.replace(
    'window.FarbatlasLearningMaterials = Object.freeze({ open: openLibrary, reload: loadManifest, prepareOffline: prepareMaterialsOffline });',
    'window.__materialTreeTest = { folderTree, expandedFolderIds, expandFolderPath, setManifest(value) { manifest = value; } };',
  );
  const sandbox = {
    window: {},
    document: { readyState: 'loading', addEventListener() {}, querySelector() { return null; } },
    sessionStorage: { getItem() { return ''; } },
    localStorage: { getItem() { return ''; } },
    console,
  };
  vm.runInNewContext(testableClient, sandbox);
  const tree = sandbox.window.__materialTreeTest;
  tree.setManifest({ nodes: [
    { id: 'test', type: 'folder', title: 'Test', parentId: null },
    { id: 'test1', type: 'folder', title: 'Test1', parentId: 'test' },
    { id: 'test2', type: 'folder', title: 'Test2', parentId: 'test' },
    { id: 'deep', type: 'folder', title: 'Deep', parentId: 'test1' },
  ] });
  tree.expandFolderPath('test1');
  const expandedMarkup = tree.folderTree();
  assert.match(expandedMarkup, /aria-expanded="true"[^>]*>▾<\/button>/);
  assert.match(expandedMarkup, /📁 Test<\/button>[\s\S]*<ul class="material-tree-children">[\s\S]*📁 Test1[\s\S]*📁 Deep[\s\S]*📁 Test2/);

  tree.expandedFolderIds.delete('test');
  const collapsedMarkup = tree.folderTree();
  assert.match(collapsedMarkup, /aria-expanded="false"[^>]*>▸<\/button>/);
  assert.doesNotMatch(collapsedMarkup, /📁 Test1|📁 Test2|📁 Deep/);
});

test('offline preparation is separate from image preparation and persists PDFs in IndexedDB', () => {
  assert.match(client, /prepareOfflineMaterials/);
  assert.match(client, /Lernmaterialien laden/);
  assert.match(client, /farbatlas-learning-materials-v1/);
  assert.match(client, /await dbPut\(PDF_STORE/);
  assert.match(client, /navigator\.storage/);
});

test('viewer provides zoom, touch pinch, fullscreen, spreads and thumbnails', () => {
  assert.match(viewer, /pdfZoom/);
  assert.match(viewer, /pinchDistance/);
  assert.match(viewer, /requestFullscreen/);
  assert.match(viewer, /state\.spread/);
  assert.match(viewer, /buildThumbnails/);
  assert.match(viewer, /screen\.orientation/);
  assert.match(viewer, /PageDown/);
});

test('PDF.js and the material app are local app-shell assets', () => {
  for (const asset of [
    '/learning-materials-viewer.js', '/learning-materials-client.js', '/learning-materials.css',
    '/vendor/pdfjs/pdf.mjs', '/vendor/pdfjs/pdf.worker.mjs',
  ]) assert.match(serviceWorker, new RegExp(asset.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(inject, /learning-materials-viewer\.js/);
  assert.match(inject, /learning-materials-client\.js/);
  assert.match(inject, /learning-materials\.css/);
});

test('material implementation does not change course content collection functions', () => {
  assert.doesNotMatch(client, /collectCourseChanges|captureBaseline|datasetRecordKeys/);
  assert.doesNotMatch(viewer, /collectCourseChanges|captureBaseline|datasetRecordKeys/);
});
