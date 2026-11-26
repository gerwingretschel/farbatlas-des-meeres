import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const client = fs.readFileSync(new URL('../v10-client.js', import.meta.url), 'utf8');

function makeClassList() {
  const values = new Set();
  return {
    add: (...names) => names.forEach((name) => values.add(name)),
    remove: (...names) => names.forEach((name) => values.delete(name)),
    contains: (name) => values.has(name),
  };
}

test('a previously uncached visible thumbnail is fetched and replaces its placeholder', async () => {
  const listeners = {};
  const requests = [];
  let intersectionCallback;
  let objectUrlCounter = 0;
  const image = {
    src: 'placeholder.svg',
    alt: '',
    dataset: {},
    classList: makeClassList(),
    isConnected: true,
  };
  const card = {
    querySelector: (selector) => selector === 'img' ? image : { dataset: { id: 'record-1' } },
  };
  class FakeIntersectionObserver {
    constructor(callback) { intersectionCallback = callback; }
    observe() {}
    unobserve() {}
  }
  const context = {
    console,
    Blob,
    Uint8Array,
    atob,
    currentDatasetName: 'Rotes Meer',
    datasetLoaded: true,
    imported: [{ name: 'koralle.jpg', imageKey: 'image-teaching-1', thumbnailKey: 'thumbnail-1' }],
    records: [{ id: 'record-1', name: 'koralle.jpg', de: 'Koralle', src: 'placeholder.svg' }],
    document: {
      readyState: 'loading',
      addEventListener: (name, callback) => { listeners[name] = callback; },
      querySelector: () => null,
      querySelectorAll: (selector) => selector === '.photo' ? [card] : [],
    },
    navigator: { onLine: true },
    IntersectionObserver: FakeIntersectionObserver,
    URL: { createObjectURL: () => `blob:thumbnail-${++objectUrlCounter}`, revokeObjectURL: () => {} },
    fetch: async (_url, options) => {
      const request = JSON.parse(options.body);
      requests.push(request);
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ type: 'image/jpeg', data: 'AA==' }),
      };
    },
    setTimeout: (callback) => { callback(); return 1; },
    setInterval: () => 1,
    clearInterval: () => {},
    addEventListener: () => {},
  };
  context.window = context;
  context.sessionStorage = { getItem: () => null };
  vm.runInNewContext(client, context, { filename: 'v10-client.js' });
  listeners.DOMContentLoaded();
  assert.equal(typeof intersectionCallback, 'function');
  intersectionCallback([{ isIntersecting: true, target: image }]);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(requests.length, 1);
  assert.equal(requests[0].action, 'get-image');
  assert.equal(requests[0].imageKey, 'thumbnail-1');
  assert.equal(image.src, 'blob:thumbnail-1');
  assert.equal(image.dataset.thumbnailLoaded, '1');
  assert.equal(image.classList.contains('farbatlas-image-unavailable'), false);
});

test('visible thumbnail loading and prefetch share the same in-flight URL path', () => {
  const visibleStart = client.indexOf('async function loadThumbnailInto');
  const visibleEnd = client.indexOf('function retryVisibleThumbnail', visibleStart);
  const visibleImplementation = client.slice(visibleStart, visibleEnd);
  const prefetchStart = client.indexOf('function scheduleThumbnailPrefetch');
  const prefetchEnd = client.indexOf('window.FarbatlasThumbnailPrefetch', prefetchStart);
  const prefetchImplementation = client.slice(prefetchStart, prefetchEnd);
  assert.match(visibleImplementation, /assetUrl\(item, 'thumbnail'\)/);
  assert.match(prefetchImplementation, /assetUrl\(item, 'thumbnail'\)/);
  assert.doesNotMatch(visibleImplementation, /'teaching'/);
  assert.doesNotMatch(prefetchImplementation, /'teaching'/);
});