import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const client = fs.readFileSync(new URL('../v10-client.js', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../netlify/functions/farbatlas.mjs', import.meta.url), 'utf8');

function diagnostics() {
  const context = {
    console,
    document: { readyState: 'loading', addEventListener: () => {}, querySelector: () => null },
  };
  context.window = context;
  vm.runInNewContext(client, context, { filename: 'v10-client.js' });
  return context.FarbatlasImportDiagnostics;
}

const prepared = (name, overrides = {}) => ({
  name,
  teachingBlob: { size: 390 * 1024 },
  thumbnailBlob: { size: 70 * 1024 },
  teachingWidth: 1600,
  teachingHeight: 900,
  thumbnailWidth: 480,
  thumbnailHeight: 270,
  preparedImport: true,
  ...overrides,
});

test('multi-import summary reports all four prepared images consistently', () => {
  const result = diagnostics().summarize([
    prepared('one.jpg'), prepared('two.jpg'), prepared('three.jpg'), prepared('four.jpg'),
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    total: 4,
    prepared: 4,
    invalid: 0,
    failed: 0,
    pending: 4,
  });
});

test('result accounting includes invalid and failed files without changing prepared count', () => {
  const result = diagnostics().summarize([prepared('one.jpg'), prepared('two.jpg')], 1, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    total: 4,
    prepared: 2,
    invalid: 1,
    failed: 1,
    pending: 2,
  });
});

test('prepared classroom and thumbnail variants enforce dimensions and byte limits', () => {
  const api = diagnostics();
  assert.deepEqual(JSON.parse(JSON.stringify(api.validatePair(prepared('valid.jpg')))), {
    teaching: { bytes: 399360, maxEdge: 1600 },
    thumbnail: { bytes: 71680, maxEdge: 480 },
  });
  assert.throws(() => api.validatePair(prepared('wide.jpg', { teachingWidth: 1601 })), /1\.600 px \/ 400 KB/);
  assert.throws(() => api.validatePair(prepared('large.jpg', { teachingBlob: { size: 400 * 1024 + 1 } })), /1\.600 px \/ 400 KB/);
  assert.throws(() => api.validatePair(prepared('large-thumb.jpg', { thumbnailBlob: { size: 80 * 1024 + 1 } })), /Thumbnail-Grenzen/);
});

test('thumbnail cards and detail view resolve separate keys of the same uploaded pair', () => {
  const api = diagnostics();
  const pair = { imageKey: 'image-classroom-1', thumbnailKey: 'thumbnail-image-classroom-1' };
  assert.equal(api.displayKey(pair, 'thumbnail'), 'thumbnail-image-classroom-1');
  assert.equal(api.displayKey(pair, 'teaching'), 'image-classroom-1');
  assert.notEqual(api.displayKey(pair, 'thumbnail'), api.displayKey(pair, 'teaching'));
});

test('pair upload stores teaching and thumbnail bytes separately and returns both mappings', () => {
  const start = server.indexOf('if (body.action === "upload-image-pair")');
  const end = server.indexOf('if (body.action === "save")', start);
  const implementation = server.slice(start, end);
  assert.match(implementation, /stores\.images\.set\(imageKey, teaching\.bytes/);
  assert.match(implementation, /stores\.images\.set\(thumbnailKey, thumbnail\.bytes/);
  assert.match(implementation, /return reply\(\{[\s\S]*imageKey,[\s\S]*thumbnailKey,/);
  assert.doesNotMatch(implementation, /stores\.images\.set\(imageKey, thumbnail\.bytes/);
  assert.doesNotMatch(implementation, /stores\.images\.set\(thumbnailKey, teaching\.bytes/);
});
