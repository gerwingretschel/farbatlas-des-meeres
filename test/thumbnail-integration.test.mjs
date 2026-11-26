import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../netlify/functions/farbatlas.mjs', import.meta.url), 'utf8');
const client = fs.readFileSync(new URL('../v10-client.js', import.meta.url), 'utf8');
const compressionClient = fs.readFileSync(new URL('../image-compression-client.js', import.meta.url), 'utf8');

test('server exposes pair import and administrative thumbnail maintenance', () => {
  assert.match(server, /body\.action === "upload-image-pair"/);
  assert.match(server, /body\.action === "thumbnail-status"/);
  assert.match(server, /body\.action === "upload-thumbnail"/);
  assert.match(server, /validateImageVariant\([^)]*, "teaching"\)/s);
  assert.match(server, /validateImageVariant\([^)]*, "thumbnail"\)/s);
});

test('thumbnail maintenance writes the thumbnail key and only reads the teaching image', () => {
  const attach = server.slice(server.indexOf('async function attachThumbnail'), server.indexOf('async function markThumbnailStale'));
  assert.match(attach, /stores\.images\.get\(reference\.imageKey/);
  assert.match(attach, /stores\.images\.set\(thumbnailKey/);
  assert.doesNotMatch(attach, /stores\.images\.set\(reference\.imageKey/);
  assert.doesNotMatch(attach, /stores\.images\.delete\(reference\.imageKey/);
});

test('client implements lazy thumbnails, explicit detail loading and two offline levels', () => {
  assert.match(client, /IntersectionObserver/);
  assert.match(client, /Großes Unterrichtsbild laden/);
  assert.match(client, /prepareOffline\('thumbnails'\)/);
  assert.match(client, /prepareOffline\('complete'\)/);
  assert.match(client, /teachingMaxEdge:\s*1600/);
  assert.match(client, /teachingMaxBytes:\s*400 \* 1024/);
  assert.match(client, /thumbnailMaxEdge:\s*480/);
});

test('prepared local imports use thumbnail in cards and classroom image in detail view', () => {
  const prepareStart = client.indexOf('async function preparePair');
  const prepareEnd = client.indexOf('async function preparePendingImports', prepareStart);
  const preparation = client.slice(prepareStart, prepareEnd);
  assert.match(preparation, /item\.src = await blobToDataUrl\(teaching\.blob\)/);
  assert.match(preparation, /item\.thumbnailSrc = await blobToDataUrl\(thumbnail\.blob\)/);
  const galleryStart = client.indexOf('renderGalleryModal = async function farbatlasRenderGallery');
  const galleryEnd = client.indexOf('renderGalleryModal.__farbatlasDetail', galleryStart);
  const gallery = client.slice(galleryStart, galleryEnd);
  assert.match(gallery, /item\.teachingBlob/);
  assert.match(gallery, /assetUrl\(item, 'teaching'\)/);
});

test('compression marks an existing thumbnail stale after changing a teaching image', () => {
  assert.match(compressionClient, /item\.source\.thumbnailStale = Boolean\(item\.source\.thumbnailKey\)/);
  assert.match(server, /markThumbnailStale\(stores\.datasets, run\.datasetName, imageKey\)/);
});
