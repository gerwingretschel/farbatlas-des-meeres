import crypto from 'node:crypto';
import { ValidationError, datasetKey, normalizeName } from './course-utils.mjs';

export const MATERIAL_RULES = Object.freeze({
  warningBytes: 5 * 1024 * 1024,
  maximumBytes: 50 * 1024 * 1024,
  chunkBytes: 384 * 1024,
  maximumNodes: 2000,
  maximumDepth: 16,
});

export const materialManifestKey = (name) => `materials-${datasetKey(name)}`;
export const materialFileKey = (materialId, chunkIndex) => `pdf-${validateMaterialId(materialId)}-chunk-${Number(chunkIndex)}`;
export const materialUploadMetaKey = (uploadId) => `upload-${validateUploadId(uploadId)}-meta`;
export const materialUploadChunkKey = (uploadId, chunkIndex) => `upload-${validateUploadId(uploadId)}-chunk-${Number(chunkIndex)}`;

export function validateMaterialId(value) {
  const id = String(value || '');
  if (!/^[a-z0-9][a-z0-9-]{7,80}$/i.test(id)) throw new ValidationError('Ungültige Material-ID.');
  return id;
}

export function validateUploadId(value) {
  const id = String(value || '');
  if (!/^upload-[a-f0-9-]{16,80}$/i.test(id)) throw new ValidationError('Ungültige Upload-ID.');
  return id;
}

export function cleanMaterialTitle(value, fallback = '') {
  const title = String(value || fallback || '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  if (!title) throw new ValidationError('Name oder Titel fehlt.');
  if (title.length > 160) throw new ValidationError('Name oder Titel ist länger als 160 Zeichen.');
  return title;
}

export function cleanPdfFileName(value) {
  const fileName = cleanMaterialTitle(value).replace(/[\\/:*?"<>|]/g, '_');
  if (!/\.pdf$/i.test(fileName)) throw new ValidationError('Es sind ausschließlich PDF-Dateien erlaubt.');
  return fileName;
}

export function cleanSha256(value) {
  const hash = String(value || '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new ValidationError('Ungültige PDF-Prüfsumme.');
  return hash;
}

export function validatePdfHeader(bytes) {
  const data = Buffer.from(bytes || []);
  if (data.length < 5 || data.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw new ValidationError('Die Datei besitzt keine gültige PDF-Kennung.');
  }
  return true;
}

export function emptyMaterialManifest(name) {
  const normalized = normalizeName(name);
  if (!normalized) throw new ValidationError('Datensatzname fehlt.');
  return {
    schema: 1,
    dataset: normalized,
    version: 0,
    nodes: [],
    updatedAt: null,
  };
}

export function publicMaterialManifest(value) {
  const manifest = value && Array.isArray(value.nodes) ? value : emptyMaterialManifest(value?.dataset || 'Datensatz');
  return {
    schema: 1,
    dataset: manifest.dataset,
    version: Number(manifest.version || 0),
    updatedAt: manifest.updatedAt || null,
    nodes: manifest.nodes.map((node) => ({ ...node })),
  };
}

export function nodeMap(manifest) {
  return new Map((manifest?.nodes || []).map((node) => [node.id, node]));
}

export function assertFolder(manifest, folderId, { allowRoot = true } = {}) {
  if ((folderId === null || folderId === undefined || folderId === '') && allowRoot) return null;
  const id = validateMaterialId(folderId);
  const folder = nodeMap(manifest).get(id);
  if (!folder || folder.type !== 'folder') throw new ValidationError('Zielordner wurde nicht gefunden.', 404);
  return folder;
}

export function descendants(manifest, id) {
  const found = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of manifest.nodes || []) {
      if (node.parentId && found.has(node.parentId) && !found.has(node.id)) {
        found.add(node.id);
        changed = true;
      }
    }
  }
  return found;
}

export function assertValidTree(manifest) {
  if (!manifest || !Array.isArray(manifest.nodes)) throw new ValidationError('Materialverzeichnis ist beschädigt.', 409);
  if (manifest.nodes.length > MATERIAL_RULES.maximumNodes) throw new ValidationError('Das Materialverzeichnis enthält zu viele Einträge.', 409);
  const map = nodeMap(manifest);
  if (map.size !== manifest.nodes.length) throw new ValidationError('Materialverzeichnis enthält doppelte IDs.', 409);
  for (const node of manifest.nodes) {
    validateMaterialId(node.id);
    if (!['folder', 'pdf'].includes(node.type)) throw new ValidationError('Unbekannter Materialtyp.', 409);
    cleanMaterialTitle(node.title);
    if (node.parentId) {
      const parent = map.get(node.parentId);
      if (!parent || parent.type !== 'folder') throw new ValidationError('Materialverzeichnis enthält einen ungültigen Elternordner.', 409);
    }
    let cursor = node;
    const seen = new Set([node.id]);
    for (let depth = 0; cursor?.parentId; depth += 1) {
      if (depth >= MATERIAL_RULES.maximumDepth) throw new ValidationError('Die Ordnerstruktur ist zu tief.', 409);
      if (seen.has(cursor.parentId)) throw new ValidationError('Die Ordnerstruktur enthält einen Zyklus.', 409);
      seen.add(cursor.parentId);
      cursor = map.get(cursor.parentId);
    }
  }
  return manifest;
}

export function createFolderNode(manifest, { parentId = null, title, actor = null } = {}) {
  assertFolder(manifest, parentId);
  const now = new Date().toISOString();
  const node = {
    id: `folder-${crypto.randomUUID()}`,
    type: 'folder',
    parentId: parentId || null,
    title: cleanMaterialTitle(title),
    createdAt: now,
    updatedAt: now,
    createdBy: actor || null,
  };
  return node;
}

export function createPdfNode({ materialId, parentId = null, title, fileName, bytes, pageCount = 0, sha256, chunkSize, chunkCount, actor = null }) {
  const size = Number(bytes);
  if (!Number.isInteger(size) || size <= 0 || size > MATERIAL_RULES.maximumBytes) {
    throw new ValidationError(`PDF-Dateien dürfen höchstens ${Math.round(MATERIAL_RULES.maximumBytes / 1024 / 1024)} MB groß sein.`, 413);
  }
  const pages = Math.max(0, Math.min(100000, Number(pageCount) || 0));
  const now = new Date().toISOString();
  return {
    id: validateMaterialId(materialId),
    type: 'pdf',
    parentId: parentId || null,
    title: cleanMaterialTitle(title, fileName),
    fileName: cleanPdfFileName(fileName),
    bytes: size,
    pageCount: pages,
    version: 1,
    sha256: cleanSha256(sha256),
    chunkSize: Number(chunkSize),
    chunkCount: Number(chunkCount),
    uploadedAt: now,
    updatedAt: now,
    uploadedBy: actor || null,
  };
}

export function renameNode(manifest, id, title) {
  const node = nodeMap(manifest).get(validateMaterialId(id));
  if (!node) throw new ValidationError('Eintrag wurde nicht gefunden.', 404);
  node.title = cleanMaterialTitle(title);
  node.updatedAt = new Date().toISOString();
  return node;
}

export function moveNode(manifest, id, parentId = null) {
  const node = nodeMap(manifest).get(validateMaterialId(id));
  if (!node) throw new ValidationError('Eintrag wurde nicht gefunden.', 404);
  assertFolder(manifest, parentId);
  if (parentId && descendants(manifest, node.id).has(parentId)) {
    throw new ValidationError('Ein Ordner kann nicht in sich selbst oder einen Unterordner verschoben werden.');
  }
  node.parentId = parentId || null;
  node.updatedAt = new Date().toISOString();
  assertValidTree(manifest);
  return node;
}

export function removeNodes(manifest, id) {
  const target = nodeMap(manifest).get(validateMaterialId(id));
  if (!target) throw new ValidationError('Eintrag wurde nicht gefunden.', 404);
  const ids = target.type === 'folder' ? descendants(manifest, target.id) : new Set([target.id]);
  const removed = manifest.nodes.filter((node) => ids.has(node.id));
  manifest.nodes = manifest.nodes.filter((node) => !ids.has(node.id));
  return removed;
}

export function expectedChunks(bytes, chunkSize = MATERIAL_RULES.chunkBytes) {
  const size = Number(bytes);
  if (!Number.isInteger(size) || size <= 0 || size > MATERIAL_RULES.maximumBytes) {
    throw new ValidationError(`PDF-Dateien dürfen höchstens ${Math.round(MATERIAL_RULES.maximumBytes / 1024 / 1024)} MB groß sein.`, 413);
  }
  return Math.ceil(size / chunkSize);
}

export function assertExpectedVersion(manifest, expectedVersion) {
  if (expectedVersion === undefined || expectedVersion === null || expectedVersion === '') return;
  if (Number(expectedVersion) !== Number(manifest.version || 0)) {
    throw new ValidationError('Das Materialverzeichnis wurde zwischenzeitlich geändert. Bitte neu laden.', 409, {
      currentVersion: Number(manifest.version || 0),
    });
  }
}

export function finalizeManifest(manifest) {
  assertValidTree(manifest);
  manifest.version = Number(manifest.version || 0) + 1;
  manifest.updatedAt = new Date().toISOString();
  return manifest;
}
