import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const imageClient = fs.readFileSync(new URL('../image-compression-client.js', import.meta.url), 'utf8');
const v10Client = fs.readFileSync(new URL('../v10-client.js', import.meta.url), 'utf8');

function makeSessionStorage(values = {}) {
  const data = new Map(Object.entries(values));
  return {
    getItem: (key) => data.get(key) || null,
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
}

test('compression integration detects the legacy V10 state and stored admin session', () => {
  const elements = {
    '#openDatasetName': { value: 'Rotes Meer' },
    '#saveDatasetName': { value: '' },
  };
  const context = {
    console,
    sessionStorage: makeSessionStorage({ farbatlasAdminTokenV09: 'admin-session-token' }),
    currentDatasetName: '',
    datasetLoaded: true,
    imported: [{ name: 'bild.jpg', imageKey: 'image-1', src: 'data:image/jpeg;base64,AA==' }],
    document: {
      readyState: 'loading',
      querySelector: (selector) => elements[selector] || null,
      addEventListener: () => {},
    },
  };
  context.window = context;
  vm.runInNewContext(imageClient, context, { filename: 'image-compression-client.js' });
  const status = context.FarbatlasImageCompressionIntegration.diagnose();
  assert.deepEqual(JSON.parse(JSON.stringify(status)), {
    datasetName: 'Rotes Meer',
    datasetLoaded: true,
    imageCount: 1,
    adminActive: true,
    bridgeActive: false,
  });
});

test('compression integration reads the explicit runtime bridge', () => {
  const context = {
    console,
    sessionStorage: makeSessionStorage({ farbatlasAdminTokenV09: 'admin-session-token' }),
    document: { readyState: 'loading', querySelector: () => null, addEventListener: () => {} },
    FarbatlasRuntime: {
      getDataset: () => ({
        name: 'Meeresschule Rovinj',
        loaded: true,
        images: [{ name: 'bild.jpg', imageKey: 'image-2', src: 'data:image/jpeg;base64,AA==' }],
      }),
    },
  };
  context.window = context;
  vm.runInNewContext(imageClient, context, { filename: 'image-compression-client.js' });
  const status = context.FarbatlasImageCompressionIntegration.diagnose();
  assert.equal(status.datasetName, 'Meeresschule Rovinj');
  assert.equal(status.datasetLoaded, true);
  assert.equal(status.imageCount, 1);
  assert.equal(status.adminActive, true);
  assert.equal(status.bridgeActive, true);
});

test('V10 opening publishes the loaded dataset to the shared runtime bridge', async () => {
  const listeners = {};
  const events = [];
  const elements = {
    '#openDatasetName': { value: 'Rotes Meer' },
    '#openDatasetPassword': { value: 'dataset-password' },
    '#datasetStatus': { textContent: '' },
    '#openDatasetBtn': {},
    '#newDatasetBtn': {},
    '#saveDatasetBtn': {},
    '#saveDatasetStatus': { textContent: '', style: {}, insertAdjacentHTML: () => {} },
    '#v10hint': null,
  };
  const responses = {
    load: { name: 'Rotes Meer', payload: { images: [{ name: 'bild.jpg', imageKey: 'image-1' }] } },
    'get-image': { type: 'image/jpeg', data: 'AA==' },
  };
  const context = {
    console,
    currentDatasetName: '',
    datasetLoaded: false,
    adminToken: '',
    imported: [],
    records: [],
    savedGroups: {},
    groupMoves: {},
    recordEdits: {},
    titleImages: {},
    deletedRecords: new Set(),
    GROUPS: { Tiere: [], Pflanzen: [] },
    sessionStorage: makeSessionStorage({ farbatlasAdminTokenV09: 'admin-session-token' }),
    document: {
      title: 'Farbatlas des Meeres',
      readyState: 'loading',
      querySelector: (selector) => elements[selector] || null,
      addEventListener: (name, callback) => { listeners[name] = callback; },
      createElement: () => { throw new Error('not needed in this test'); },
    },
    fetch: async (_url, options) => {
      const request = JSON.parse(options.body);
      return { ok: true, status: 200, text: async () => JSON.stringify(responses[request.action]) };
    },
    updateDatasetIndicator: () => {},
    scheduleDatasetCache: () => {},
    rebuild: () => {},
    go: () => {},
    CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init.detail; } },
  };
  context.window = context;
  context.addEventListener = () => {};
  context.dispatchEvent = (event) => events.push(event);
  vm.runInNewContext(v10Client, context, { filename: 'v10-client.js' });
  listeners.DOMContentLoaded();
  await elements['#openDatasetBtn'].onclick();
  assert.equal(context.currentDatasetName, 'Rotes Meer');
  assert.equal(context.datasetLoaded, true);
  assert.equal(context.imported.length, 1);
  assert.equal(context.FarbatlasRuntime.getDataset().name, 'Rotes Meer');
  assert.equal(context.FarbatlasRuntime.getDataset().images.length, 1);
  assert.equal(events.at(-1).type, 'farbatlas:dataset-changed');
  assert.equal(events.at(-1).detail.name, 'Rotes Meer');
});
