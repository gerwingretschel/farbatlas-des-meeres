import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const client = fs.readFileSync(new URL('../v10-client.js', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../netlify/functions/farbatlas.mjs', import.meta.url), 'utf8');

function syncApi() {
  const context = {
    console,
    document: { readyState: 'loading', addEventListener: () => {}, querySelector: () => null },
  };
  context.window = context;
  vm.runInNewContext(client, context, { filename: 'v10-client.js' });
  return context.FarbatlasOfflineSync;
}

test('Netlify access HTML is converted to a safe synchronization message', () => {
  const result = syncApi().classifyResponse(
    { redirected: true, status: 200, headers: { get: () => 'text/html; charset=utf-8' } },
    '<!DOCTYPE html><title>Login Redirect</title><p>Please enable JavaScript to continue</p>'
  );
  assert.equal(result.code, 'ACCESS_REDIRECT');
  assert.match(result.message, /Änderungen bleiben auf diesem Gerät gespeichert/);
  assert.doesNotMatch(result.message, /<!DOCTYPE|<html|Login Redirect|script/i);
});

test('offline import plus offline deletion remain in one pending synchronization plan', () => {
  const plan = syncApi().plan({
    baseVersionTag: 'etag-1',
    imported: [
      { name: 'existing-a.jpg', imageKey: 'image-a', thumbnailKey: 'thumbnail-a' },
      { name: 'new-offline.jpg', preparedImport: true, teachingBlob: { size: 200000 }, thumbnailBlob: { size: 50000 } },
    ],
    deleted: ['existing-a.jpg'],
  }, 'etag-1');
  assert.equal(plan.conflict, false);
  assert.deepEqual(Array.from(plan.uploads), ['new-offline.jpg']);
  assert.deepEqual(Array.from(plan.deletions), ['existing-a.jpg']);
});

test('an uploaded pair from a failed final save is retained for later synchronization', () => {
  const plan = syncApi().plan({
    baseVersionTag: 'etag-1',
    imported: [{
      name: 'new-offline.jpg',
      imageKey: 'image-new',
      thumbnailKey: 'thumbnail-image-new',
      pendingUpload: true,
    }],
    deleted: ['old-test.jpg'],
  }, 'etag-1');
  assert.equal(plan.conflict, false);
  assert.deepEqual(JSON.parse(JSON.stringify(plan.retainedUploadedPairs)), [
    { imageKey: 'image-new', thumbnailKey: 'thumbnail-image-new' },
  ]);
  assert.deepEqual(Array.from(plan.uploads), []);
  assert.deepEqual(Array.from(plan.deletions), ['old-test.jpg']);
});

test('later synchronization stops on an intervening server change', () => {
  const plan = syncApi().plan({
    baseVersionTag: 'etag-loaded-offline',
    imported: [{ name: 'new-offline.jpg', preparedImport: true }],
    deleted: ['old-test.jpg'],
  }, 'etag-newer-server');
  assert.equal(plan.conflict, true);
  assert.deepEqual(Array.from(plan.uploads), ['new-offline.jpg']);
  assert.deepEqual(Array.from(plan.deletions), ['old-test.jpg']);
});

test('client persists before synchronization and server enforces expected version tag', () => {
  const saveStart = client.indexOf('async function saveV11');
  const saveEnd = client.indexOf('async function openV11', saveStart);
  const saveImplementation = client.slice(saveStart, saveEnd);
  assert.ok(saveImplementation.indexOf('persistPendingSync') < saveImplementation.indexOf("api('load'"));
  assert.match(saveImplementation, /expectedVersionTag/);
  assert.match(saveImplementation, /clearPendingSync/);
  assert.match(server, /body\.expectedVersionTag && body\.expectedVersionTag !== existingEntry\.etag/);
  assert.match(server, /Lokale Änderungen wurden nicht überschrieben/);
});

test('deleted unsynchronized imports are not uploaded', () => {
  const preparationStart = client.indexOf('async function preparePendingImports');
  const uploadEnd = client.indexOf('function applyPayload', preparationStart);
  const implementation = client.slice(preparationStart, uploadEnd);
  assert.match(implementation, /!deletedRecords\.has\(item\.name\)/);
});
