import test from 'node:test';
import assert from 'node:assert/strict';
import {
  IMAGE_RULES,
  compressionBackupKey,
  compressionRunCounts,
  createCompressionRunId,
  newCompressionRun,
  publicCompressionRun,
  sha256,
  validateCompressedReplacement,
  validateCompressionRunId,
} from '../netlify/functions/lib/image-compression-utils.mjs';
import { ValidationError } from '../netlify/functions/lib/course-utils.mjs';

const RUN_ID = '0123456789abcdef-1795610000000-123e4567-e89b-12d3-a456-426614174000';

test('uses the agreed classroom-image limits', () => {
  assert.equal(IMAGE_RULES.maxBytes, 409600);
  assert.equal(IMAGE_RULES.preferredMinBytes, 307200);
  assert.equal(IMAGE_RULES.maxEdge, 1600);
  assert.equal(IMAGE_RULES.outputType, 'image/jpeg');
});

test('creates and validates dataset-bound compression run IDs', () => {
  const runId = createCompressionRunId('Rotes Meer', 1795610000000, '123e4567-e89b-12d3-a456-426614174000');
  assert.match(runId, /^[a-f0-9]{16}-1795610000000-123e4567-/);
  assert.equal(validateCompressionRunId(runId), runId);
  assert.throws(() => validateCompressionRunId('../unsafe'), ValidationError);
});

test('creates deterministic, path-safe backup keys', () => {
  const first = compressionBackupKey(RUN_ID, 'image-123');
  const second = compressionBackupKey(RUN_ID, 'image-123');
  assert.equal(first, second);
  assert.match(first, /^backup-[a-f0-9-]+$/);
});

test('accepts a compliant JPEG replacement for an oversized source', () => {
  const dimensions = validateCompressedReplacement({
    bytes: Buffer.alloc(350000),
    contentType: 'image/jpeg',
    originalBytes: 900000,
    originalType: 'image/jpeg',
    originalDimensions: { width: 3000, height: 2000 },
    compressedDimensions: { width: 1600, height: 1067 },
  });
  assert.deepEqual(dimensions.result, { width: 1600, height: 1067 });
});

test('rejects output above 400 KB, wrong formats, enlargement, and needless recompression', () => {
  const base = {
    bytes: Buffer.alloc(350000),
    contentType: 'image/jpeg',
    originalBytes: 900000,
    originalType: 'image/jpeg',
    originalDimensions: { width: 3000, height: 2000 },
    compressedDimensions: { width: 1600, height: 1067 },
  };
  assert.throws(() => validateCompressedReplacement({ ...base, bytes: Buffer.alloc(409601) }), ValidationError);
  assert.throws(() => validateCompressedReplacement({ ...base, contentType: 'image/webp' }), ValidationError);
  assert.throws(() => validateCompressedReplacement({ ...base, compressedDimensions: { width: 3200, height: 2100 } }), ValidationError);
  assert.throws(() => validateCompressedReplacement({
    ...base,
    originalBytes: 300000,
    originalDimensions: { width: 1400, height: 900 },
    compressedDimensions: { width: 1400, height: 900 },
  }), ValidationError);
});

test('builds a resumable run and reports its reversible states', () => {
  const run = newCompressionRun({
    name: 'Rotes Meer',
    totalImages: 12,
    candidateCount: 5,
    runId: RUN_ID,
    now: '2026-11-25T14:00:00.000Z',
  });
  run.items = {
    one: { imageKey: 'image-1', state: 'compressed' },
    two: { imageKey: 'image-2', state: 'backed-up' },
    three: { imageKey: 'image-3', state: 'restored' },
    four: { imageKey: 'image-4', state: 'conflict' },
  };
  assert.deepEqual(compressionRunCounts(run), { compressed: 1, backedUp: 1, restored: 1, conflicts: 1 });
  const visible = publicCompressionRun(run, true);
  assert.equal(visible.items.length, 4);
  assert.equal(visible.datasetName, 'Rotes Meer');
});

test('hashes original bytes deterministically for conflict protection', () => {
  assert.equal(sha256(Buffer.from('original')), sha256(Buffer.from('original')));
  assert.notEqual(sha256(Buffer.from('original')), sha256(Buffer.from('changed')));
});
