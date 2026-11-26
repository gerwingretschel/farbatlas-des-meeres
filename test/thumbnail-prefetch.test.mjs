import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const client = fs.readFileSync(new URL('../v10-client.js', import.meta.url), 'utf8');

function prefetchApi() {
  const context = {
    console,
    document: { readyState: 'loading', addEventListener: () => {}, querySelector: () => null },
  };
  context.window = context;
  vm.runInNewContext(client, context, { filename: 'v10-client.js' });
  return context.FarbatlasThumbnailPrefetch;
}

test('prefetch window selects current, next five, and previous two thumbnails', () => {
  const prefetch = prefetchApi();
  assert.equal(prefetch.next, 5);
  assert.equal(prefetch.previous, 2);
  assert.deepEqual(
    Array.from(prefetch.indexes(12, 4)),
    [4, 5, 6, 7, 8, 9, 3, 2]
  );
});

test('prefetch window is bounded at both ends without duplicates', () => {
  const prefetch = prefetchApi();
  assert.deepEqual(Array.from(prefetch.indexes(4, 0)), [0, 1, 2, 3]);
  assert.deepEqual(Array.from(prefetch.indexes(4, 3)), [3, 2, 1]);
  assert.deepEqual(Array.from(prefetch.indexes(0, 0)), []);
  assert.deepEqual(Array.from(prefetch.indexes(4, -1)), []);
});

test('background prefetch is thumbnail-only and runs when a reference image is shown', () => {
  const start = client.indexOf('function scheduleThumbnailPrefetch');
  const end = client.indexOf('window.FarbatlasThumbnailPrefetch', start);
  const implementation = client.slice(start, end);
  assert.match(implementation, /assetBlob\(item, 'thumbnail'\)/);
  assert.doesNotMatch(implementation, /assetBlob\(item, 'teaching'\)/);
  assert.match(client, /scheduleThumbnailPrefetch\(gallerySet, galleryIndex\)/);
});
