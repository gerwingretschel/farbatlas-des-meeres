import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MATERIAL_RULES,
  assertExpectedVersion,
  assertValidTree,
  cleanPdfFileName,
  createFolderNode,
  createPdfNode,
  emptyMaterialManifest,
  expectedChunks,
  finalizeManifest,
  moveNode,
  removeNodes,
  renameNode,
  validatePdfHeader,
} from '../netlify/functions/lib/material-utils.mjs';

const pdfHash = 'a'.repeat(64);

function fixture() {
  const manifest = emptyMaterialManifest('Rotes Meer');
  const root = createFolderNode(manifest, { title: 'Korallen' });
  manifest.nodes.push(root);
  const child = createFolderNode(manifest, { title: 'Einführung', parentId: root.id });
  manifest.nodes.push(child);
  const pdf = createPdfNode({
    materialId: 'material-12345678', parentId: child.id, title: 'Korallenökologie', fileName: 'korallen.pdf',
    bytes: 900000, pageCount: 12, sha256: pdfHash, chunkSize: MATERIAL_RULES.chunkBytes, chunkCount: expectedChunks(900000),
  });
  manifest.nodes.push(pdf);
  return { manifest, root, child, pdf };
}

test('creates a valid dataset-scoped folder and PDF tree', () => {
  const { manifest, pdf } = fixture();
  assert.equal(assertValidTree(manifest), manifest);
  assert.equal(pdf.type, 'pdf');
  assert.equal(pdf.pageCount, 12);
  assert.equal(pdf.chunkCount, 3);
});

test('detects PDF magic bytes and rejects non-PDF content', () => {
  assert.equal(validatePdfHeader(Buffer.from('%PDF-1.7\n')), true);
  assert.throws(() => validatePdfHeader(Buffer.from('not a pdf')), /PDF-Kennung/);
});

test('enforces the 50 MB maximum and PDF extension', () => {
  assert.throws(() => expectedChunks(MATERIAL_RULES.maximumBytes + 1), /höchstens 50 MB/);
  assert.equal(cleanPdfFileName('Unterricht: Korallen.pdf'), 'Unterricht_ Korallen.pdf');
  assert.throws(() => cleanPdfFileName('unterricht.pptx'), /PDF-Dateien/);
});

test('prevents moving a folder into its own descendant', () => {
  const { manifest, root, child } = fixture();
  assert.throws(() => moveNode(manifest, root.id, child.id), /nicht in sich selbst/);
});

test('renames, moves and recursively removes nodes', () => {
  const { manifest, root, child, pdf } = fixture();
  renameNode(manifest, pdf.id, 'Neue Folien');
  assert.equal(pdf.title, 'Neue Folien');
  moveNode(manifest, pdf.id, root.id);
  assert.equal(pdf.parentId, root.id);
  moveNode(manifest, pdf.id, child.id);
  const removed = removeNodes(manifest, root.id);
  assert.deepEqual(new Set(removed.map((node) => node.id)), new Set([root.id, child.id, pdf.id]));
  assert.equal(manifest.nodes.length, 0);
});

test('uses manifest versions for conflict protection', () => {
  const { manifest } = fixture();
  assertExpectedVersion(manifest, 0);
  finalizeManifest(manifest);
  assert.equal(manifest.version, 1);
  assert.throws(() => assertExpectedVersion(manifest, 0), /zwischenzeitlich geändert/);
});

test('rejects cycles and invalid parent references', () => {
  const { manifest, root, child } = fixture();
  root.parentId = child.id;
  assert.throws(() => assertValidTree(manifest), /Zyklus/);
});
