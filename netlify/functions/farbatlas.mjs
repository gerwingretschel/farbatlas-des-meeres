import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";
import {
  ValidationError,
  applyContentChanges,
  createPasswordRecord,
  datasetKey,
  normalizeCourseLeaderInput,
  normalizeName,
  normalizeUsername,
  publicCourseLeader,
  userKey,
  verifyPassword,
} from "./lib/course-utils.mjs";
import {
  IMAGE_RULES,
  compressionBackupKey,
  compressionRunCounts,
  compressionRunKey,
  createCompressionRunId,
  newCompressionRun,
  publicCompressionRun,
  sha256,
  validateCompressedReplacement,
  validateCompressionRunId,
  validateImageKey,
} from "./lib/image-compression-utils.mjs";
import {
  imageSha256,
  thumbnailCondition,
  thumbnailKeyFor,
  validateImageVariant,
} from "./lib/thumbnail-utils.mjs";

const STORES = Object.freeze({
  DATASETS: "farbatlas-datasets-v10",
  IMAGES: "farbatlas-images-v10",
  COURSE_LEADERS: "farbatlas-course-leaders-v1",
  AUDIT: "farbatlas-course-audit-v1",
  AUTH: "farbatlas-auth-throttle-v1",
  IMAGE_BACKUPS: "farbatlas-image-backups-v1",
});
const SESSION_MS = 8 * 60 * 60 * 1000;

const reply = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });

const passwordHash = (password, salt) =>
  crypto.pbkdf2Sync(String(password), salt, 210000, 32, "sha256").toString("hex");

const timingSafeTextEqual = (left, right) => {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

function sessionSecret() {
  const secret = String(process.env.SESSION_SECRET || "");
  if (secret.length < 32) {
    throw new ValidationError("SESSION_SECRET fehlt oder ist kürzer als 32 Zeichen.", 500);
  }
  return secret;
}

const imageReferences = (entry) => {
  const images = entry?.data?.payload?.images;
  return Array.isArray(images) ? images.filter((image) => image?.imageKey) : [];
};

async function thumbnailStatus(stores, entry) {
  const references = imageReferences(entry);
  const items = new Array(references.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(12, Math.max(1, references.length)) }, async () => {
    while (cursor < references.length) {
      const index = cursor++;
      const reference = references[index];
    const sourceEnvelope = await stores.images.getMetadata(reference.imageKey);
    const sourceMetadata = sourceEnvelope?.metadata || null;
    let thumbnailMetadata = null;
    if (reference.thumbnailKey) {
      thumbnailMetadata = (await stores.images.getMetadata(reference.thumbnailKey))?.metadata || null;
    }
    const condition = reference.thumbnailStale
      ? "stale"
      : thumbnailCondition({
        reference,
        sourceExists: Boolean(sourceEnvelope),
        thumbnailExists: Boolean(thumbnailMetadata),
        thumbnailMetadata,
        sourceHash: reference.thumbnailSourceHash || thumbnailMetadata?.sourceSha256 || "",
      });
      items[index] = {
      name: String(reference.name || "Bild"),
      imageKey: reference.imageKey,
      thumbnailKey: reference.thumbnailKey || null,
      teachingBytes: Number(sourceMetadata?.bytes || reference.teachingBytes || 0),
      thumbnailBytes: Number(thumbnailMetadata?.bytes || reference.thumbnailBytes || 0),
        status: condition,
      };
    }
  });
  await Promise.all(workers);
  const counts = items.reduce((result, item) => {
    result[item.status] = (result[item.status] || 0) + 1;
    return result;
  }, { current: 0, missing: 0, stale: 0, damaged: 0, "source-missing": 0 });
  return { items, counts, total: items.length };
}

async function attachThumbnail(stores, entry, body) {
  const reference = datasetImage(entry, String(body.imageKey || ""));
  const sourceBuffer = await stores.images.get(reference.imageKey, { type: "arrayBuffer" });
  if (!sourceBuffer) throw new ValidationError("Unterrichtsbild nicht gefunden.", 404);
  const sourceBytes = Buffer.from(sourceBuffer);
  const thumbnail = validateImageVariant(body, "thumbnail");
  const thumbnailKey = reference.thumbnailKey || thumbnailKeyFor(reference.imageKey);
  await stores.images.set(thumbnailKey, thumbnail.bytes, {
    metadata: {
      dataset: datasetKey(entry.data.name),
      fileName: String(reference.name || body.fileName || "thumbnail.jpg"),
      contentType: thumbnail.contentType,
      variant: "thumbnail",
      sourceImageKey: reference.imageKey,
      sourceSha256: imageSha256(sourceBytes),
      bytes: thumbnail.bytes.length,
      width: thumbnail.width,
      height: thumbnail.height,
      generatedAt: new Date().toISOString(),
    },
  });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const fresh = attempt ? await getDatasetEntry(stores.datasets, entry.data.name) : entry;
    if (!fresh) throw new ValidationError("Datensatz nicht gefunden.", 404);
    const images = imageReferences(fresh).map((image) => image.imageKey === reference.imageKey ? {
      ...image,
      thumbnailKey,
      thumbnailBytes: thumbnail.bytes.length,
      thumbnailWidth: thumbnail.width,
      thumbnailHeight: thumbnail.height,
      teachingBytes: sourceBytes.length,
      thumbnailSourceHash: imageSha256(sourceBytes),
      thumbnailStale: false,
    } : image);
    const next = {
      ...fresh.data,
      payload: { ...fresh.data.payload, version: Math.max(11, Number(fresh.data.payload?.version || 0)), images },
      updatedAt: new Date().toISOString(),
    };
    const saved = await stores.datasets.setJSON(datasetKey(fresh.data.name), next, { onlyIfMatch: fresh.etag });
    if (saved.modified) return {
      imageKey: reference.imageKey,
      thumbnailKey,
      thumbnailBytes: thumbnail.bytes.length,
      thumbnailWidth: thumbnail.width,
      thumbnailHeight: thumbnail.height,
      teachingBytes: sourceBytes.length,
      thumbnailSourceHash: imageSha256(sourceBytes),
      thumbnailStale: false,
    };
  }
  throw new ValidationError("Datensatz wurde gleichzeitig geändert. Bitte die Thumbnail-Prüfung wiederholen.", 409);
}

async function markThumbnailStale(datasetStore, name, imageKey) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const entry = await getDatasetEntry(datasetStore, name);
    if (!entry) throw new ValidationError("Datensatz nicht gefunden.", 404);
    const images = imageReferences(entry).map((image) => image.imageKey === imageKey
      ? { ...image, thumbnailStale: Boolean(image.thumbnailKey) }
      : image);
    const next = {
      ...entry.data,
      payload: { ...entry.data.payload, images },
      updatedAt: new Date().toISOString(),
    };
    const saved = await datasetStore.setJSON(datasetKey(name), next, { onlyIfMatch: entry.etag });
    if (saved.modified) return;
  }
  throw new ValidationError("Datensatz wurde gleichzeitig geändert. Bild wurde nicht ersetzt.", 409);
}

const sign = (payload) =>
  crypto.createHmac("sha256", sessionSecret()).update(payload).digest("base64url");

function makeToken(claims) {
  const payload = Buffer.from(
    JSON.stringify({ ...claims, iat: Date.now(), exp: Date.now() + SESSION_MS, nonce: crypto.randomUUID() })
  ).toString("base64url");
  return payload + "." + sign(payload);
}

function readToken(req) {
  try {
    const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    const [payload, signature] = String(bearer || "").split(".");
    if (!payload || !signature || !timingSafeTextEqual(signature, sign(payload))) return null;
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return claims.exp > Date.now() ? claims : null;
  } catch {
    return null;
  }
}

const isExpired = (user) =>
  Boolean(user.expiresAt && new Date(user.expiresAt).getTime() <= Date.now());

async function getCourseLeader(store, username) {
  return store.get(userKey(username), { type: "json", consistency: "strong" });
}

async function principal(req, courseStore) {
  const claims = readToken(req);
  if (!claims) throw new ValidationError("Anmeldung erforderlich.", 401);
  if (claims.role === "admin") return { role: "admin", claims };
  if (claims.role !== "courseLeader" || !claims.username) {
    throw new ValidationError("Anmeldung erforderlich.", 401);
  }
  const user = await getCourseLeader(courseStore, claims.username);
  if (!user || !user.active || isExpired(user) || user.tokenVersion !== claims.tokenVersion) {
    throw new ValidationError("Die Kursleiter-Sitzung ist nicht mehr gültig.", 401);
  }
  return { role: "courseLeader", claims, user };
}

function requireAdmin(actor) {
  if (actor.role !== "admin") throw new ValidationError("Administrator-Anmeldung erforderlich.", 403);
}

function requireCourseLeader(actor) {
  if (actor.role !== "courseLeader") throw new ValidationError("Kursleiter-Anmeldung erforderlich.", 403);
  return actor.user;
}

function assertAssigned(user, name) {
  const wanted = datasetKey(name);
  if (!(user.datasets || []).some((assigned) => datasetKey(assigned) === wanted)) {
    throw new ValidationError("Dieser Datensatz ist dem Kursleiter nicht zugewiesen.", 403);
  }
}

async function getDatasetEntry(store, name) {
  return store.getWithMetadata(datasetKey(name), { type: "json", consistency: "strong" });
}

async function authenticateDataset(req, stores, body) {
  const claims = readToken(req);
  if (claims?.role === "courseLeader") {
    const actor = await principal(req, stores.courseLeaders);
    assertAssigned(actor.user, body.name);
    const entry = await getDatasetEntry(stores.datasets, body.name);
    if (!entry) throw new ValidationError("Datensatz nicht gefunden.", 404);
    return { entry, actor };
  }
  const entry = await getDatasetEntry(stores.datasets, body.name);
  if (!entry) throw new ValidationError("Datensatz nicht gefunden.", 404);
  if (passwordHash(body.password, entry.data.salt) !== entry.data.passwordHash) {
    throw new ValidationError("Datensatz-Passwort ist falsch.", 401);
  }
  return { entry, actor: claims?.role === "admin" ? { role: "admin", claims } : null };
}

async function listDatasets(store) {
  const { blobs } = await store.list({ prefix: "dataset-" });
  const values = await Promise.all(
    blobs.map((blob) => store.get(blob.key, { type: "json", consistency: "strong" }))
  );
  return values
    .filter(Boolean)
    .map((dataset) => ({ name: dataset.name || "Unbenannter Datensatz", updatedAt: dataset.updatedAt || null }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name), "de", { sensitivity: "base" }));
}

async function deleteDatasetImages(imageStore, name) {
  const key = datasetKey(name);
  const blobs = await listAllBlobs(imageStore, "", 5000);
  let deletedImages = 0;
  for (const blob of blobs) {
    const metadata = await imageStore.getMetadata(blob.key);
    if (metadata?.metadata?.dataset !== key) continue;
    await imageStore.delete(blob.key);
    deletedImages += 1;
  }
  return deletedImages;
}

async function listAllBlobs(store, prefix, maximum = 500) {
  const blobs = [];
  let cursor;
  do {
    const page = await store.list({ prefix, ...(cursor ? { cursor } : {}) });
    blobs.push(...(page.blobs || []));
    cursor = page.nextCursor;
  } while (cursor && blobs.length < maximum);
  return blobs.slice(0, maximum);
}

async function getCompressionRun(store, runId) {
  const entry = await store.getWithMetadata(compressionRunKey(runId), {
    type: "json",
    consistency: "strong",
  });
  if (!entry) throw new ValidationError("Komprimierungslauf nicht gefunden.", 404);
  return entry;
}

async function mutateCompressionRun(store, runId, change) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const entry = await getCompressionRun(store, runId);
    const next = change(structuredClone(entry.data));
    next.updatedAt = new Date().toISOString();
    const saved = await store.setJSON(compressionRunKey(runId), next, { onlyIfMatch: entry.etag });
    if (saved.modified) return next;
  }
  throw new ValidationError("Der Sicherungsstand wurde gleichzeitig geändert. Bitte erneut versuchen.", 409);
}

async function listCompressionRuns(store, name = "") {
  const wanted = name ? datasetKey(name) : "";
  const blobs = await listAllBlobs(store, "run-", 300);
  const selected = blobs.sort((a, b) => b.key.localeCompare(a.key)).slice(0, 100);
  const runs = await Promise.all(
    selected.map((blob) => store.get(blob.key, { type: "json", consistency: "strong" }))
  );
  return runs
    .filter((run) => run && (!wanted || run.datasetKey === wanted))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

function datasetImage(entry, imageKey) {
  const image = (entry?.data?.payload?.images || []).find((item) => item?.imageKey === imageKey);
  if (!image) throw new ValidationError("Bild gehört nicht zum Datensatz.", 403);
  return image;
}

function compressionAnalysis(value, run) {
  const integer = (key, fallback = 0) => {
    const number = Number(value?.[key] ?? fallback);
    return Number.isInteger(number) && number >= 0 && number <= 100_000_000_000 ? number : fallback;
  };
  return {
    checked: integer("checked", run.totalImages),
    compliant: integer("compliant"),
    candidates: integer("candidates", run.candidateCount),
    failed: integer("failed"),
    originalBytes: integer("originalBytes"),
    compressedBytes: integer("compressedBytes"),
  };
}

const clientIp = (req) =>
  req.headers.get("x-nf-client-connection-ip") ||
  req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
  "unknown";

const throttleKey = (username, ip) =>
  "attempt-" + crypto.createHash("sha256").update(normalizeUsername(username) + "|" + ip).digest("hex");

async function assertNotThrottled(store, username, ip) {
  const state = await store.get(throttleKey(username, ip), { type: "json", consistency: "strong" });
  if (state?.blockedUntil > Date.now()) {
    throw new ValidationError("Zu viele Anmeldeversuche. Bitte kurz warten.", 429, {
      retryAfterSeconds: Math.ceil((state.blockedUntil - Date.now()) / 1000),
    });
  }
  return state || { failures: 0 };
}

async function recordLoginFailure(store, username, ip, previous) {
  const failures = Math.min(10, Number(previous?.failures || 0) + 1);
  const delay = Math.min(60_000, 750 * 2 ** Math.max(0, failures - 1));
  await store.setJSON(throttleKey(username, ip), {
    failures,
    blockedUntil: Date.now() + delay,
    updatedAt: new Date().toISOString(),
  });
}

async function clearLoginFailures(store, username, ip) {
  await store.delete(throttleKey(username, ip)).catch(() => {});
}

async function listCourseLeaders(store) {
  const { blobs } = await store.list({ prefix: "course-user-" });
  const users = await Promise.all(
    blobs.map((blob) => store.get(blob.key, { type: "json", consistency: "strong" }))
  );
  return users
    .filter(Boolean)
    .map(publicCourseLeader)
    .sort((a, b) => a.displayName.localeCompare(b.displayName, "de", { sensitivity: "base" }));
}

async function writeAudit(store, batch) {
  const key = `audit-${datasetKey(batch.dataset)}-${Date.now()}-${crypto.randomUUID()}`;
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await store.setJSON(key, batch, { onlyIfNew: true });
      if (result.modified) return key;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("Audit-Protokoll konnte nicht geschrieben werden.");
}

async function listAudit(store, { dataset = "", username = "", limit = 100 } = {}) {
  const prefix = dataset ? `audit-${datasetKey(dataset)}-` : "audit-";
  const { blobs } = await store.list({ prefix });
  const selected = blobs
    .sort((a, b) => b.key.localeCompare(a.key))
    .slice(0, Math.min(500, Math.max(limit * 3, limit)));
  const batches = await Promise.all(
    selected.map(async (blob) => {
      const value = await store.get(blob.key, { type: "json", consistency: "strong" });
      return value ? { key: blob.key, ...value } : null;
    })
  );
  return batches
    .filter((entry) => entry && (!username || entry.actor?.username === username))
    .slice(0, limit);
}

async function saveCourseContent(stores, user, body, reason = "edit") {
  const name = normalizeName(body.name);
  if (!name) throw new ValidationError("Datensatzname fehlt.");
  assertAssigned(user, name);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const entry = await getDatasetEntry(stores.datasets, name);
    if (!entry) throw new ValidationError("Datensatz nicht gefunden.", 404);
    const applied = applyContentChanges(entry.data.payload, body.changes, user.permissions);
    if (applied.conflicts.length) {
      throw new ValidationError("Mindestens ein Inhalt wurde zwischenzeitlich geändert.", 409, {
        conflicts: applied.conflicts,
        versionTag: entry.etag,
      });
    }
    if (!applied.auditChanges.length) {
      return { message: "Keine neuen Änderungen vorhanden.", versionTag: entry.etag };
    }

    const now = new Date().toISOString();
    const nextDataset = { ...entry.data, payload: applied.payload, updatedAt: now };
    const write = await stores.datasets.setJSON(datasetKey(name), nextDataset, {
      onlyIfMatch: entry.etag,
    });
    if (!write.modified) continue;

    const batch = {
      at: now,
      dataset: entry.data.name || name,
      reason,
      actor: { role: "courseLeader", username: user.username, displayName: user.displayName },
      changes: applied.auditChanges,
      resultingVersionTag: write.etag,
    };
    let auditWarning = "";
    try {
      await writeAudit(stores.audit, batch);
    } catch (error) {
      console.error("AUDIT_WRITE_FAILED", error);
      auditWarning = "Die Änderung wurde gespeichert, aber das Änderungsprotokoll konnte nicht geschrieben werden. Bitte den Administrator informieren.";
    }
    return {
      message: `${applied.auditChanges.length} Änderung(en) wurden gespeichert.`,
      versionTag: write.etag,
      auditWarning,
    };
  }
  throw new ValidationError(
    "Der Datensatz wurde gleichzeitig geändert. Bitte neu laden und erneut vergleichen.",
    409,
    { conflicts: [] }
  );
}

function errorReply(error) {
  if (error instanceof ValidationError) {
    return reply({ error: error.message, ...(error.details || {}) }, error.status || 400);
  }
  console.error("FARBATLAS_SERVER_ERROR", error);
  return reply({ error: "Interner Serverfehler." }, 500);
}

export default async (req) => {
  if (req.method !== "POST") return reply({ error: "Methode nicht erlaubt." }, 405);

  const stores = {
    datasets: getStore(STORES.DATASETS),
    images: getStore(STORES.IMAGES),
    courseLeaders: getStore(STORES.COURSE_LEADERS),
    audit: getStore(STORES.AUDIT),
    auth: getStore(STORES.AUTH),
    imageBackups: getStore(STORES.IMAGE_BACKUPS),
  };

  try {
    const body = await req.json();

    if (body.action === "admin-login") {
      if (!process.env.ADMIN_PASSWORD) throw new ValidationError("ADMIN_PASSWORD fehlt in Netlify.", 500);
      sessionSecret();
      if (!timingSafeTextEqual(body.password, process.env.ADMIN_PASSWORD)) {
        throw new ValidationError("Administrator-Passwort ist falsch.", 401);
      }
      return reply({ token: makeToken({ role: "admin" }) });
    }

    if (body.action === "course-login") {
      sessionSecret();
      const username = normalizeUsername(body.username);
      const ip = clientIp(req);
      const throttle = await assertNotThrottled(stores.auth, username, ip);
      const user = await getCourseLeader(stores.courseLeaders, username);
      const accepted = user && user.active && !isExpired(user) && verifyPassword(body.password, user);
      if (!accepted) {
        await recordLoginFailure(stores.auth, username, ip, throttle);
        throw new ValidationError("Benutzername oder Passwort ist falsch.", 401);
      }
      await clearLoginFailures(stores.auth, username, ip);
      return reply({
        token: makeToken({ role: "courseLeader", username: user.username, tokenVersion: user.tokenVersion }),
        profile: publicCourseLeader(user),
      });
    }

    if (body.action === "load") {
      const { entry } = await authenticateDataset(req, stores, body);
      return reply({ name: entry.data.name, payload: entry.data.payload, versionTag: entry.etag });
    }

    if (body.action === "get-image") {
      await authenticateDataset(req, stores, body);
      const arrayBuffer = await stores.images.get(body.imageKey, { type: "arrayBuffer" });
      if (!arrayBuffer) throw new ValidationError("Bild nicht gefunden.", 404);
      const metadata = await stores.images.getMetadata(body.imageKey);
      if (metadata?.metadata?.dataset !== datasetKey(body.name)) {
        throw new ValidationError("Bild gehört nicht zu diesem Datensatz.", 403);
      }
      return reply({
        data: Buffer.from(arrayBuffer).toString("base64"),
        type: metadata?.metadata?.contentType || "image/jpeg",
      });
    }

    const actor = await principal(req, stores.courseLeaders);

    if (body.action === "course-session") {
      return reply({ profile: publicCourseLeader(requireCourseLeader(actor)) });
    }
    if (body.action === "course-save-content") {
      return reply(await saveCourseContent(stores, requireCourseLeader(actor), body));
    }
    if (body.action === "course-my-history") {
      const user = requireCourseLeader(actor);
      assertAssigned(user, body.name);
      return reply({
        entries: await listAudit(stores.audit, { dataset: body.name, username: user.username, limit: 100 }),
      });
    }
    if (body.action === "course-restore-version") {
      const user = requireCourseLeader(actor);
      assertAssigned(user, body.name);
      const key = String(body.auditKey || "");
      if (!/^audit-[a-z0-9-]+$/i.test(key)) throw new ValidationError("Ungültiger Protokolleintrag.");
      const entry = await stores.audit.get(key, { type: "json", consistency: "strong" });
      if (!entry || entry.actor?.username !== user.username || entry.dataset !== body.name) {
        throw new ValidationError("Protokolleintrag nicht gefunden.", 404);
      }
      const change = entry.changes?.[Number(body.changeIndex)];
      if (!change) throw new ValidationError("Änderung nicht gefunden.", 404);
      const changes = change.field === "knowledge"
        ? { knowledge: [{ key: change.key, baseValue: change.after, value: change.before }] }
        : { academicLinks: [{ key: change.key, baseValue: change.after, value: change.before }] };
      return reply(await saveCourseContent(
        stores,
        user,
        { name: body.name, changes },
        `restore:${key}:${Number(body.changeIndex)}`
      ));
    }

    requireAdmin(actor);

    if (body.action === "thumbnail-status") {
      const name = normalizeName(body.name);
      if (!name) throw new ValidationError("Datensatzname fehlt.");
      const entry = await getDatasetEntry(stores.datasets, name);
      if (!entry) throw new ValidationError("Datensatz nicht gefunden.", 404);
      return reply(await thumbnailStatus(stores, entry));
    }
    if (body.action === "upload-thumbnail") {
      const name = normalizeName(body.name);
      if (!name) throw new ValidationError("Datensatzname fehlt.");
      const entry = await getDatasetEntry(stores.datasets, name);
      if (!entry) throw new ValidationError("Datensatz nicht gefunden.", 404);
      return reply({
        image: await attachThumbnail(stores, entry, body),
        message: "Vorschaubild wurde gespeichert und dem Unterrichtsbild zugeordnet.",
      });
    }

    if (body.action === "image-compression-runs") {
      const name = normalizeName(body.name);
      if (!name) throw new ValidationError("Datensatzname fehlt.");
      const runs = await listCompressionRuns(stores.imageBackups, name);
      return reply({ runs: runs.slice(0, 20).map((run) => publicCompressionRun(run)) });
    }
    if (body.action === "image-compression-get-run") {
      const run = (await getCompressionRun(stores.imageBackups, validateCompressionRunId(body.runId))).data;
      return reply({ run: publicCompressionRun(run, true) });
    }
    if (body.action === "image-compression-start") {
      const name = normalizeName(body.name);
      const datasetEntry = await getDatasetEntry(stores.datasets, name);
      if (!datasetEntry) throw new ValidationError("Datensatz nicht gefunden.", 404);
      const allImages = datasetEntry.data.payload?.images || [];
      if (!Array.isArray(allImages) || allImages.some((image) => !image?.imageKey)) {
        throw new ValidationError("Der Datensatz enthält noch nicht einzeln gespeicherte Bilder.", 409);
      }
      const existing = (await listCompressionRuns(stores.imageBackups, name))
        .find((run) => run.status === "running");
      if (existing) return reply({ run: publicCompressionRun(existing, true), resumed: true });

      const runId = createCompressionRunId(name);
      const run = newCompressionRun({
        name: datasetEntry.data.name || name,
        totalImages: allImages.length,
        candidateCount: Number(body.candidateCount),
        runId,
      });
      const saved = await stores.imageBackups.setJSON(compressionRunKey(runId), run, { onlyIfNew: true });
      if (!saved.modified) throw new ValidationError("Sicherungsstand konnte nicht angelegt werden.", 409);
      return reply({ run: publicCompressionRun(run, true), resumed: false });
    }
    if (body.action === "image-compression-replace") {
      const runId = validateCompressionRunId(body.runId);
      const imageKey = validateImageKey(body.imageKey);
      const runEntry = await getCompressionRun(stores.imageBackups, runId);
      const run = runEntry.data;
      if (run.status !== "running") throw new ValidationError("Dieser Komprimierungslauf ist bereits abgeschlossen.", 409);
      const datasetEntry = await getDatasetEntry(stores.datasets, run.datasetName);
      if (!datasetEntry) throw new ValidationError("Datensatz nicht gefunden.", 404);
      const imageReference = datasetImage(datasetEntry, imageKey);
      const sourceBuffer = await stores.images.get(imageKey, { type: "arrayBuffer" });
      if (!sourceBuffer) throw new ValidationError("Serverbild nicht gefunden.", 404);
      const sourceBytes = Buffer.from(sourceBuffer);
      const sourceMetadataEnvelope = await stores.images.getMetadata(imageKey);
      const sourceMetadata = { ...(sourceMetadataEnvelope?.metadata || {}) };
      if (sourceMetadata.dataset !== run.datasetKey) {
        throw new ValidationError("Bild gehört nicht zum Sicherungsstand.", 403);
      }

      const prior = run.items?.[imageKey];
      const currentHash = sha256(sourceBytes);
      if (prior?.state === "compressed" && currentHash === prior.compressedHash) {
        return reply({ item: prior, message: "Bild war bereits komprimiert." });
      }
      if (prior?.state === "restored") {
        throw new ValidationError("Das Bild wurde aus diesem Sicherungsstand bereits wiederhergestellt.", 409);
      }
      if (prior?.originalHash && ![prior.originalHash, prior.compressedHash].includes(currentHash)) {
        throw new ValidationError("Das Bild wurde zwischenzeitlich anderweitig verändert und wird nicht überschrieben.", 409);
      }
      if (prior?.state === "backed-up" && currentHash === prior.compressedHash) {
        const recovered = await mutateCompressionRun(stores.imageBackups, runId, (next) => {
          next.items[imageKey].state = "compressed";
          next.items[imageKey].compressedAt ||= new Date().toISOString();
          return next;
        });
        return reply({ item: recovered.items[imageKey], message: "Unterbrochener Schritt wurde bestätigt." });
      }

      const compressedBytes = Buffer.from(String(body.data || ""), "base64");
      const dimensions = validateCompressedReplacement({
        bytes: compressedBytes,
        contentType: body.type,
        originalBytes: sourceBytes.length,
        originalType: sourceMetadata.contentType || "image/jpeg",
        originalDimensions: body.originalDimensions,
        compressedDimensions: body.compressedDimensions,
      });
      const originalHash = sha256(sourceBytes);
      const compressedHash = sha256(compressedBytes);
      const backupKey = prior?.backupKey || compressionBackupKey(runId, imageKey);
      if (!prior?.backupKey) {
        await stores.imageBackups.set(backupKey, sourceBytes, {
          metadata: {
            runId,
            imageKey,
            dataset: run.datasetKey,
            contentType: sourceMetadata.contentType || "image/jpeg",
            fileName: String(sourceMetadata.fileName || imageReference.name || imageKey),
            sha256: originalHash,
          },
        });
      }

      await mutateCompressionRun(stores.imageBackups, runId, (next) => {
        next.items ||= {};
        next.items[imageKey] = {
          imageKey,
          fileName: String(sourceMetadata.fileName || imageReference.name || imageKey),
          state: "backed-up",
          backupKey,
          originalBytes: sourceBytes.length,
          compressedBytes: compressedBytes.length,
          originalHash,
          compressedHash,
          originalType: sourceMetadata.contentType || "image/jpeg",
          originalMetadata: sourceMetadata,
          originalDimensions: dimensions.source,
          compressedDimensions: dimensions.result,
          backedUpAt: new Date().toISOString(),
        };
        return next;
      });

      await markThumbnailStale(stores.datasets, run.datasetName, imageKey);
      await stores.images.set(imageKey, compressedBytes, {
        metadata: {
          ...sourceMetadata,
          contentType: IMAGE_RULES.outputType,
          dataset: run.datasetKey,
          fileName: String(sourceMetadata.fileName || imageReference.name || imageKey),
          compressionRunId: runId,
          compressedAt: new Date().toISOString(),
        },
      });
      const savedRun = await mutateCompressionRun(stores.imageBackups, runId, (next) => {
        next.items[imageKey].state = "compressed";
        next.items[imageKey].compressedAt = new Date().toISOString();
        return next;
      });
      return reply({
        item: savedRun.items[imageKey],
        message: "Bild wurde gesichert und komprimiert.",
      });
    }
    if (body.action === "image-compression-finish") {
      const runId = validateCompressionRunId(body.runId);
      const run = await mutateCompressionRun(stores.imageBackups, runId, (next) => {
        if (next.status !== "running") return next;
        next.analysis = compressionAnalysis(body.analysis, next);
        next.status = next.analysis.failed ? "completed-with-errors" : "completed";
        next.completedAt = new Date().toISOString();
        return next;
      });
      return reply({ run: publicCompressionRun(run), message: "Komprimierungslauf wurde abgeschlossen." });
    }
    if (body.action === "image-compression-restore-item") {
      const runId = validateCompressionRunId(body.runId);
      const imageKey = validateImageKey(body.imageKey);
      const runEntry = await getCompressionRun(stores.imageBackups, runId);
      const run = runEntry.data;
      const item = run.items?.[imageKey];
      if (!item) throw new ValidationError("Bild ist in diesem Sicherungsstand nicht enthalten.", 404);
      if (item.state === "restored") return reply({ item, message: "Bild war bereits wiederhergestellt." });
      if (!item.backupKey) throw new ValidationError("Originalsicherung fehlt.", 409);

      const backupBuffer = await stores.imageBackups.get(item.backupKey, { type: "arrayBuffer" });
      if (!backupBuffer) throw new ValidationError("Originalsicherung wurde nicht gefunden.", 404);
      const originalBytes = Buffer.from(backupBuffer);
      if (sha256(originalBytes) !== item.originalHash) {
        throw new ValidationError("Prüfsumme der Originalsicherung stimmt nicht.", 409);
      }
      const currentBuffer = await stores.images.get(imageKey, { type: "arrayBuffer" });
      if (!currentBuffer) throw new ValidationError("Aktuelles Serverbild wurde nicht gefunden.", 404);
      const currentHash = sha256(Buffer.from(currentBuffer));
      if (currentHash !== item.compressedHash && currentHash !== item.originalHash) {
        await mutateCompressionRun(stores.imageBackups, runId, (next) => {
          next.items[imageKey].state = "conflict";
          next.items[imageKey].error = "Bild wurde nach der Komprimierung anderweitig verändert.";
          return next;
        });
        throw new ValidationError("Bild wurde nach der Komprimierung anderweitig verändert und wird nicht überschrieben.", 409);
      }
      if (currentHash !== item.originalHash) {
        await markThumbnailStale(stores.datasets, run.datasetName, imageKey);
        await stores.images.set(imageKey, originalBytes, { metadata: item.originalMetadata || {} });
      }
      const restored = await mutateCompressionRun(stores.imageBackups, runId, (next) => {
        next.status = "restoring";
        next.items[imageKey].state = "restored";
        next.items[imageKey].restoredAt = new Date().toISOString();
        return next;
      });
      return reply({ item: restored.items[imageKey], message: "Originalbild wurde wiederhergestellt." });
    }
    if (body.action === "image-compression-restore-finish") {
      const runId = validateCompressionRunId(body.runId);
      const run = await mutateCompressionRun(stores.imageBackups, runId, (next) => {
        const counts = compressionRunCounts(next);
        next.status = counts.compressed || counts.backedUp ? "restore-partial" : "restored";
        next.restoredAt = new Date().toISOString();
        return next;
      });
      return reply({ run: publicCompressionRun(run), message: "Wiederherstellungslauf wurde abgeschlossen." });
    }

    if (body.action === "list-datasets") return reply({ datasets: await listDatasets(stores.datasets) });
    if (body.action === "list-course-leaders") {
      return reply({ users: await listCourseLeaders(stores.courseLeaders) });
    }
    if (body.action === "save-course-leader") {
      const create = body.create === true;
      const normalized = normalizeCourseLeaderInput(body);
      const key = userKey(normalized.username);
      const existingEntry = await stores.courseLeaders.getWithMetadata(key, {
        type: "json",
        consistency: "strong",
      });
      if (create && existingEntry) throw new ValidationError("Benutzername bereits vergeben.", 409);
      if (!create && !existingEntry) throw new ValidationError("Kursleiterkonto nicht gefunden.", 404);
      const now = new Date().toISOString();
      const existing = existingEntry?.data || null;
      const credentials = create
        ? createPasswordRecord(body.password)
        : { passwordSalt: existing.passwordSalt, passwordHash: existing.passwordHash };
      const user = {
        ...existing,
        ...normalized,
        ...credentials,
        tokenVersion: Number(existing?.tokenVersion || 0) + 1,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      };
      const result = await stores.courseLeaders.setJSON(
        key,
        user,
        create ? { onlyIfNew: true } : { onlyIfMatch: existingEntry.etag }
      );
      if (!result.modified) throw new ValidationError("Konto wurde gleichzeitig geändert. Bitte Liste neu laden.", 409);
      return reply({
        user: publicCourseLeader(user),
        message: create ? "Kursleiterkonto wurde angelegt." : "Kursleiterkonto wurde aktualisiert.",
      });
    }
    if (body.action === "reset-course-leader-password") {
      const key = userKey(body.username);
      const existingEntry = await stores.courseLeaders.getWithMetadata(key, {
        type: "json",
        consistency: "strong",
      });
      if (!existingEntry) throw new ValidationError("Kursleiterkonto nicht gefunden.", 404);
      const user = {
        ...existingEntry.data,
        ...createPasswordRecord(body.password),
        tokenVersion: Number(existingEntry.data.tokenVersion || 0) + 1,
        updatedAt: new Date().toISOString(),
      };
      const result = await stores.courseLeaders.setJSON(key, user, { onlyIfMatch: existingEntry.etag });
      if (!result.modified) throw new ValidationError("Konto wurde gleichzeitig geändert. Bitte erneut versuchen.", 409);
      return reply({ message: "Passwort wurde zurückgesetzt; bestehende Sitzungen sind beendet." });
    }
    if (body.action === "delete-course-leader") {
      const key = userKey(body.username);
      const existing = await stores.courseLeaders.get(key, { type: "json", consistency: "strong" });
      if (!existing) throw new ValidationError("Kursleiterkonto nicht gefunden.", 404);
      await stores.courseLeaders.delete(key);
      return reply({ message: `Kursleiterkonto „${existing.displayName}“ wurde gelöscht.` });
    }
    if (body.action === "list-audit") {
      return reply({
        entries: await listAudit(stores.audit, {
          dataset: normalizeName(body.name),
          limit: Math.min(200, Number(body.limit || 100)),
        }),
      });
    }
    if (body.action === "delete-dataset") {
      const name = normalizeName(body.name);
      const existing = await stores.datasets.get(datasetKey(name), {
        type: "json",
        consistency: "strong",
      });
      if (!existing) throw new ValidationError("Datensatz nicht gefunden.", 404);
      const deletedImages = await deleteDatasetImages(stores.images, name);
      await stores.datasets.delete(datasetKey(name));
      return reply({ message: `Datensatz „${existing.name || name}“ wurde gelöscht.`, deletedImages });
    }
    if (body.action === "reset-dataset-password") {
      const name = normalizeName(body.name);
      const existingEntry = await getDatasetEntry(stores.datasets, name);
      if (!existingEntry) throw new ValidationError("Datensatz nicht gefunden.", 404);
      const newPassword = String(body.newPassword || "");
      if (!newPassword.trim()) throw new ValidationError("Neues Passwort fehlt.");
      const salt = crypto.randomBytes(16).toString("hex");
      const next = {
        ...existingEntry.data,
        salt,
        passwordHash: passwordHash(newPassword, salt),
        updatedAt: new Date().toISOString(),
      };
      const result = await stores.datasets.setJSON(datasetKey(name), next, { onlyIfMatch: existingEntry.etag });
      if (!result.modified) throw new ValidationError("Datensatz wurde gleichzeitig geändert. Bitte erneut versuchen.", 409);
      return reply({ message: `Passwort für „${existingEntry.data.name || name}“ wurde zurückgesetzt.` });
    }
    if (body.action === "upload-image") {
      const entry = await getDatasetEntry(stores.datasets, body.name);
      if (!entry || passwordHash(body.password, entry.data.salt) !== entry.data.passwordHash) {
        throw new ValidationError("Datensatz-Passwort ist falsch.", 401);
      }
      if (!body.data || !body.fileName) throw new ValidationError("Bilddaten fehlen.");
      const bytes = Buffer.from(body.data, "base64");
      if (bytes.length > 3_800_000) throw new ValidationError("Das vorbereitete Einzelbild ist noch zu groß.", 413);
      const key = "image-" + crypto.randomUUID();
      await stores.images.set(key, bytes, {
        metadata: {
          contentType: body.type || "image/jpeg",
          fileName: String(body.fileName),
          dataset: datasetKey(body.name),
        },
      });
      return reply({ imageKey: key });
    }
    if (body.action === "upload-image-pair") {
      const entry = await getDatasetEntry(stores.datasets, body.name);
      if (!entry || passwordHash(body.password, entry.data.salt) !== entry.data.passwordHash) {
        throw new ValidationError("Datensatz-Passwort ist falsch.", 401);
      }
      if (!body.fileName) throw new ValidationError("Dateiname fehlt.");
      const teaching = validateImageVariant({
        data: body.teachingData,
        type: body.teachingType,
        width: body.teachingWidth,
        height: body.teachingHeight,
      }, "teaching");
      const thumbnail = validateImageVariant({
        data: body.thumbnailData,
        type: body.thumbnailType,
        width: body.thumbnailWidth,
        height: body.thumbnailHeight,
      }, "thumbnail");
      const imageKey = "image-" + crypto.randomUUID();
      const thumbnailKey = thumbnailKeyFor(imageKey);
      const dataset = datasetKey(body.name);
      const sourceHash = imageSha256(teaching.bytes);
      await stores.images.set(imageKey, teaching.bytes, {
        metadata: {
          contentType: teaching.contentType,
          fileName: String(body.fileName),
          dataset,
          variant: "teaching",
          bytes: teaching.bytes.length,
          width: teaching.width,
          height: teaching.height,
          importedAt: new Date().toISOString(),
        },
      });
      try {
        await stores.images.set(thumbnailKey, thumbnail.bytes, {
          metadata: {
            contentType: thumbnail.contentType,
            fileName: String(body.fileName),
            dataset,
            variant: "thumbnail",
            sourceImageKey: imageKey,
            sourceSha256: sourceHash,
            bytes: thumbnail.bytes.length,
            width: thumbnail.width,
            height: thumbnail.height,
            generatedAt: new Date().toISOString(),
          },
        });
      } catch (error) {
        await stores.images.delete(imageKey).catch(() => {});
        throw error;
      }
      return reply({
        imageKey,
        thumbnailKey,
        teachingBytes: teaching.bytes.length,
        thumbnailBytes: thumbnail.bytes.length,
        teachingWidth: teaching.width,
        teachingHeight: teaching.height,
        thumbnailWidth: thumbnail.width,
        thumbnailHeight: thumbnail.height,
      });
    }
    if (body.action === "save") {
      if (!body.name || !body.password || !body.payload) {
        throw new ValidationError("Name, Passwort und Datensatz sind erforderlich.");
      }
      const key = datasetKey(body.name);
      const existingEntry = await stores.datasets.getWithMetadata(key, {
        type: "json",
        consistency: "strong",
      });
      if (body.create === true && existingEntry) throw new ValidationError("Datensatzname bereits vergeben.", 409);
      if (body.create !== true && !existingEntry) throw new ValidationError("Datensatz noch nicht vorhanden.", 404);
      if (existingEntry && passwordHash(body.password, existingEntry.data.salt) !== existingEntry.data.passwordHash) {
        throw new ValidationError("Datensatz-Passwort ist falsch.", 401);
      }
      if (existingEntry && body.expectedVersionTag && body.expectedVersionTag !== existingEntry.etag) {
        throw new ValidationError(
          "Der Datensatz wurde auf dem Server zwischenzeitlich geändert. Lokale Änderungen wurden nicht überschrieben.",
          409,
          { conflict: true, currentVersionTag: existingEntry.etag }
        );
      }
      const salt = existingEntry?.data.salt || crypto.randomBytes(16).toString("hex");
      const value = {
        name: normalizeName(body.name),
        salt,
        passwordHash: passwordHash(body.password, salt),
        payload: body.payload,
        updatedAt: new Date().toISOString(),
      };
      const result = await stores.datasets.setJSON(
        key,
        value,
        existingEntry ? { onlyIfMatch: existingEntry.etag } : { onlyIfNew: true }
      );
      if (!result.modified) throw new ValidationError("Datensatz wurde gleichzeitig geändert. Bitte neu laden.", 409);
      return reply({
        message: existingEntry ? "Datensatz wurde erfolgreich aktualisiert." : "Datensatz wurde erfolgreich neu angelegt.",
        versionTag: result.etag,
      });
    }
    throw new ValidationError("Unbekannte Aktion.");
  } catch (error) {
    return errorReply(error);
  }
};

export const config = { path: "/api/farbatlas" };
