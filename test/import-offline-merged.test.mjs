import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const client = fs.readFileSync(new URL('../v10-client.js', import.meta.url), 'utf8');
const worker = fs.readFileSync(new URL('../farbatlas-sw.js', import.meta.url), 'utf8');

function apis() {
  const context = {
    console,
    document: { readyState: 'loading', addEventListener: () => {}, querySelector: () => null },
  };
  context.window = context;
  vm.runInNewContext(client, context, { filename: 'v10-client.js' });
  return { imports: context.FarbatlasImportDiagnostics, sync: context.FarbatlasOfflineSync };
}

const prepared = (name, suffix = name) => ({
  name,
  teachingBlob: { size: 300 * 1024 },
  thumbnailBlob: { size: 55 * 1024 },
  teachingSrc: `data:image/jpeg;base64,TEACHING-${suffix}`,
  thumbnailSrc: `data:image/jpeg;base64,THUMB-${suffix}`,
  teachingWidth: 1600,
  teachingHeight: 1067,
  thumbnailWidth: 480,
  thumbnailHeight: 320,
  preparedImport: true,
  pendingUpload: true,
});

test('successive import runs keep independent result counts', () => {
  const { imports } = apis();
  const allItems = [prepared('run1-a.jpg'), prepared('run1-b.jpg')];
  const firstRun = imports.summarize(allItems, 0, 0, 2);
  const beforeSecondRun = new Set(allItems);
  allItems.push(prepared('run2-only.jpg'));
  const secondItems = imports.itemsAddedSince(allItems, beforeSecondRun);
  const secondRun = imports.summarize(secondItems, 0, 0, 1);
  const firstDisplay = imports.displayModel(firstRun);
  const secondDisplay = imports.displayModel(secondRun);

  assert.deepEqual(JSON.parse(JSON.stringify(firstRun)), {
    total: 2, prepared: 2, invalid: 0, failed: 0, pending: 2,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(secondRun)), {
    total: 1, prepared: 1, invalid: 0, failed: 0, pending: 1,
  });
  assert.equal(firstDisplay.progress, '100 % · 2 von 2 Bildern vorbereitet');
  assert.equal(firstDisplay.prepared, 2);
  assert.equal(secondDisplay.progress, '100 % · 1 von 1 Bildern vorbereitet');
  assert.equal(secondDisplay.prepared, 1);
  assert.match(secondDisplay.title, /^1 neues Bild/);
});

test('the index import bridge scopes finishIf results to the current importFiles run', () => {
  assert.match(client, /importFiles = function farbatlasImportFiles/);
  assert.match(client, /before: new Set\(Array\.isArray\(imported\) \? imported : \[\]\)/);
  assert.match(client, /itemsAddedSince\(imported, run\.before\)/);
  assert.match(client, /total: run\?\.selectedTotal \?\? state\.total/);
});

test('each prepared image keeps distinct classroom and thumbnail sources', () => {
  const { imports } = apis();
  const item = prepared('separate.jpg');
  imports.validatePair(item);
  assert.equal(imports.localDisplaySource(item, 'thumbnail'), item.thumbnailSrc);
  assert.equal(imports.localDisplaySource(item, 'teaching'), item.teachingSrc);
  assert.notEqual(imports.localDisplaySource(item, 'thumbnail'), imports.localDisplaySource(item, 'teaching'));
});

test('v4 image-pair pipeline and v5 offline synchronization coexist in one runtime', () => {
  const { imports, sync } = apis();
  const newImage = prepared('offline-new.jpg');
  assert.equal(imports.validatePair(newImage).teaching.maxEdge, 1600);
  const snapshot = {
    baseVersionTag: 'etag-before-offline',
    imported: [
      { name: 'server-test.jpg', imageKey: 'image-old', thumbnailKey: 'thumbnail-old' },
      newImage,
    ],
    deleted: ['server-test.jpg'],
  };
  const plan = sync.plan(snapshot, 'etag-before-offline');
  assert.equal(plan.conflict, false);
  assert.deepEqual(Array.from(plan.uploads), ['offline-new.jpg']);
  assert.deepEqual(Array.from(plan.deletions), ['server-test.jpg']);
  assert.ok(newImage.teachingBlob);
  assert.ok(newImage.thumbnailBlob);
});

test('application scripts are network-first so a deploy cannot keep stale v4/v5 code mixed', () => {
  assert.match(worker, /farbatlas-app-shell-v13-learning-materials/);
  assert.match(worker, /isApplicationCode/);
  assert.match(worker, /fetch\(request, \{ cache: 'no-store' \}\)/);
  const networkFirst = worker.slice(worker.indexOf('if (isApplicationCode)'), worker.indexOf("event.respondWith(caches.match", worker.indexOf('if (isApplicationCode)')));
  assert.ok(networkFirst.indexOf('fetch(request') < networkFirst.indexOf('caches.match(request)'));
});

test('prepared local teaching display cannot silently fall back to a thumbnail source', () => {
  const start = client.indexOf('async function assetBlob');
  const end = client.indexOf('async function assetUrl', start);
  const implementation = client.slice(start, end);
  assert.match(implementation, /sourceField = variant === 'thumbnail' \? 'thumbnailSrc' : 'teachingSrc'/);
  assert.match(implementation, /item\?\.preparedImport && !item\?\.\[keyField\]/);
  assert.match(implementation, /Die vorbereitete Unterrichtsversion fehlt lokal/);
});
