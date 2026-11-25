import crypto from "node:crypto";
import { ValidationError, datasetKey, normalizeName } from "./course-utils.mjs";

export const IMAGE_RULES = Object.freeze({
  version: 1,
  maxBytes: 400 * 1024,
  preferredMinBytes: 300 * 1024,
  maxEdge: 1600,
  outputType: "image/jpeg",
});

const RUN_ID_RX = /^[a-f0-9]{16}-\d{13}-[a-f0-9-]{36}$/;
const IMAGE_KEY_RX = /^[A-Za-z0-9._:-]{1,240}$/;

export const sha256 = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");

export function createCompressionRunId(name, now = Date.now(), uuid = crypto.randomUUID()) {
  return `${datasetKey(name).slice(8, 24)}-${now}-${uuid}`;
}

export function validateCompressionRunId(value) {
  const runId = String(value || "");
  if (!RUN_ID_RX.test(runId)) throw new ValidationError("Ungültiger Komprimierungslauf.");
  return runId;
}

export function validateImageKey(value) {
  const imageKey = String(value || "");
  if (!IMAGE_KEY_RX.test(imageKey)) throw new ValidationError("Ungültiger Bildschlüssel.");
  return imageKey;
}

export const compressionRunKey = (runId) => `run-${validateCompressionRunId(runId)}`;

export const compressionBackupKey = (runId, imageKey) =>
  `backup-${validateCompressionRunId(runId)}-${sha256(validateImageKey(imageKey)).slice(0, 32)}`;

export function normalizeDimensions(value, label = "Bildabmessungen") {
  const width = Number(value?.width);
  const height = Number(value?.height);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 50_000 || height > 50_000) {
    throw new ValidationError(`${label} sind ungültig.`);
  }
  return { width, height };
}

export function validateCompressedReplacement({
  bytes,
  contentType,
  originalBytes,
  originalType,
  originalDimensions,
  compressedDimensions,
}) {
  if (!Buffer.isBuffer(bytes) || !bytes.length) throw new ValidationError("Komprimierte Bilddaten fehlen.");
  if (bytes.length > IMAGE_RULES.maxBytes) {
    throw new ValidationError("Das komprimierte Bild ist größer als 400 KB.", 413);
  }
  if (String(contentType || "").toLowerCase() !== IMAGE_RULES.outputType) {
    throw new ValidationError("Komprimierte Bilder müssen als JPEG gespeichert werden.");
  }
  const source = normalizeDimensions(originalDimensions, "Ursprüngliche Bildabmessungen");
  const result = normalizeDimensions(compressedDimensions, "Komprimierte Bildabmessungen");
  if (Math.max(result.width, result.height) > IMAGE_RULES.maxEdge) {
    throw new ValidationError("Die längste Bildkante ist größer als 1.600 Pixel.");
  }
  if (result.width > source.width || result.height > source.height) {
    throw new ValidationError("Bilder dürfen bei der Komprimierung nicht vergrößert werden.");
  }
  const needsOptimization =
    Number(originalBytes) > IMAGE_RULES.maxBytes ||
    Math.max(source.width, source.height) > IMAGE_RULES.maxEdge ||
    !/^image\/jpe?g$/i.test(String(originalType || ""));
  if (!needsOptimization) {
    throw new ValidationError("Das Bild erfüllt die Regeln bereits und darf nicht erneut komprimiert werden.");
  }
  return { source, result };
}

export function newCompressionRun({ name, totalImages, candidateCount, now = new Date().toISOString(), runId }) {
  const datasetName = normalizeName(name);
  if (!datasetName) throw new ValidationError("Datensatzname fehlt.");
  const total = Number(totalImages);
  const candidates = Number(candidateCount);
  if (!Number.isInteger(total) || total < 0 || total > 100_000) throw new ValidationError("Ungültige Bildanzahl.");
  if (!Number.isInteger(candidates) || candidates < 0 || candidates > total) throw new ValidationError("Ungültige Anzahl zu komprimierender Bilder.");
  return {
    version: 1,
    runId: validateCompressionRunId(runId),
    datasetName,
    datasetKey: datasetKey(datasetName),
    status: "running",
    rules: { ...IMAGE_RULES },
    totalImages: total,
    candidateCount: candidates,
    items: {},
    createdAt: now,
    updatedAt: now,
  };
}

export function compressionRunCounts(run) {
  const counts = { compressed: 0, backedUp: 0, restored: 0, conflicts: 0 };
  for (const item of Object.values(run?.items || {})) {
    if (item.state === "compressed") counts.compressed += 1;
    else if (item.state === "backed-up") counts.backedUp += 1;
    else if (item.state === "restored") counts.restored += 1;
    else if (item.state === "conflict") counts.conflicts += 1;
  }
  return counts;
}

export function publicCompressionRun(run, includeItems = false) {
  const result = {
    runId: run.runId,
    datasetName: run.datasetName,
    status: run.status,
    rules: run.rules,
    totalImages: run.totalImages,
    candidateCount: run.candidateCount,
    counts: compressionRunCounts(run),
    analysis: run.analysis || null,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    completedAt: run.completedAt || null,
    restoredAt: run.restoredAt || null,
  };
  if (includeItems) {
    result.items = Object.values(run.items || {}).map((item) => ({
      imageKey: item.imageKey,
      fileName: item.fileName,
      state: item.state,
      originalBytes: item.originalBytes,
      compressedBytes: item.compressedBytes,
      error: item.error || "",
    }));
  }
  return result;
}
