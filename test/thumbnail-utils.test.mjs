import test from 'node:test';
import assert from 'node:assert/strict';
import {
  IMAGE_VARIANTS,
  imageSha256,
  thumbnailCondition,
  thumbnailKeyFor,
  validateImageVariant,
} from '../netlify/functions/lib/thumbnail-utils.mjs';

test('teaching image accepts JPEG within 1600 px and 400 KB', () => {
  const result = validateImageVariant({
    data: Buffer.alloc(120_000, 1).toString('base64'),
    type: 'image/jpeg',
    width: 1600,
    height: 900,
  }, 'teaching');
  assert.equal(result.bytes.length, 120_000);
  assert.equal(result.width, 1600);
});

test('teaching image rejects oversized dimensions or bytes', () => {
  assert.throws(() => validateImageVariant({
    data: Buffer.alloc(10).toString('base64'), type: 'image/jpeg', width: 1601, height: 900,
  }, 'teaching'), /1\.600 Pixel/);
  assert.throws(() => validateImageVariant({
    data: Buffer.alloc(IMAGE_VARIANTS.teaching.maxBytes + 1).toString('base64'), type: 'image/jpeg', width: 800, height: 600,
  }, 'teaching'), /400 KB/);
});

test('thumbnail accepts JPEG within 500 px and rejects oversized files', () => {
  const result = validateImageVariant({
    data: Buffer.alloc(60_000, 2).toString('base64'), type: 'image/jpeg', width: 480, height: 320,
  }, 'thumbnail');
  assert.equal(result.bytes.length, 60_000);
  assert.throws(() => validateImageVariant({
    data: Buffer.alloc(IMAGE_VARIANTS.thumbnail.maxBytes + 1).toString('base64'), type: 'image/jpeg', width: 480, height: 320,
  }, 'thumbnail'), /90 KB/);
});

test('thumbnail key is deterministic and validates teaching key', () => {
  const imageKey = 'image-12345678-1234-1234-1234-123456789abc';
  assert.equal(thumbnailKeyFor(imageKey), `thumbnail-${imageKey}`);
  assert.throws(() => thumbnailKeyFor('other-key'), /Ungültiger/);
});

test('thumbnail condition distinguishes missing, damaged, stale and current', () => {
  const reference = { imageKey: 'image-a', thumbnailKey: 'thumbnail-image-a', thumbnailBytes: 50_000 };
  assert.equal(thumbnailCondition({ reference: { imageKey: 'image-a' }, sourceExists: true }), 'missing');
  assert.equal(thumbnailCondition({ reference, sourceExists: true, thumbnailExists: false }), 'damaged');
  assert.equal(thumbnailCondition({
    reference, sourceExists: true, thumbnailExists: true,
    thumbnailMetadata: { sourceImageKey: 'image-a', sourceSha256: 'old', bytes: 50_000 }, sourceHash: 'new',
  }), 'stale');
  assert.equal(thumbnailCondition({
    reference, sourceExists: true, thumbnailExists: true,
    thumbnailMetadata: { sourceImageKey: 'image-a', sourceSha256: 'same', bytes: 50_000 }, sourceHash: 'same',
  }), 'current');
});

test('sha256 is stable', () => {
  assert.equal(imageSha256(Buffer.from('farbatlas')), imageSha256(Buffer.from('farbatlas')));
  assert.notEqual(imageSha256(Buffer.from('farbatlas')), imageSha256(Buffer.from('thumbnail')));
});
