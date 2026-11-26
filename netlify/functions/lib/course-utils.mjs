import crypto from "node:crypto";

export const COURSE_PERMISSIONS = Object.freeze({
  FAMILY: "record.family.edit",
  GENUS: "record.genus.edit",
  SPECIES: "record.species.edit",
  GERMAN_NAME: "record.de.edit",
  ENGLISH_NAME: "record.en.edit",
  PLACE: "record.place.edit",
  AUTHOR: "record.author.edit",
  GROUP: "record.group.edit",
  KNOWLEDGE: "knowledge.edit",
  ACADEMIC_LINKS: "academicLinks.edit",
});

export const COURSE_RECORD_FIELD_PERMISSIONS = Object.freeze({
  family: COURSE_PERMISSIONS.FAMILY,
  genus: COURSE_PERMISSIONS.GENUS,
  species: COURSE_PERMISSIONS.SPECIES,
  de: COURSE_PERMISSIONS.GERMAN_NAME,
  en: COURSE_PERMISSIONS.ENGLISH_NAME,
  place: COURSE_PERMISSIONS.PLACE,
  author: COURSE_PERMISSIONS.AUTHOR,
  group: COURSE_PERMISSIONS.GROUP,
});

export const DEFAULT_COURSE_PERMISSIONS = Object.freeze([
  COURSE_PERMISSIONS.KNOWLEDGE,
  COURSE_PERMISSIONS.ACADEMIC_LINKS,
]);

export class ValidationError extends Error {
  constructor(message, status = 400, details = undefined) {
    super(message);
    this.name = "ValidationError";
    this.status = status;
    this.details = details;
  }
}

export const normalizeName = (value) => String(value || "").trim();
export const normalizeUsername = (value) =>
  normalizeName(value).toLocaleLowerCase("de").replace(/\s+/g, ".");

export const datasetKey = (name) =>
  "dataset-" +
  crypto
    .createHash("sha256")
    .update(normalizeName(name).toLocaleLowerCase("de"))
    .digest("hex");

export const userKey = (username) =>
  "course-user-" +
  crypto.createHash("sha256").update(normalizeUsername(username)).digest("hex");

export function assertStrongPassword(password) {
  const value = String(password || "");
  if (value.length < 12) {
    throw new ValidationError("Das Passwort muss mindestens 12 Zeichen lang sein.");
  }
  if (value.length > 256) {
    throw new ValidationError("Das Passwort ist zu lang.");
  }
  return value;
}

export function createPasswordRecord(password) {
  const value = assertStrongPassword(password);
  const salt = crypto.randomBytes(16).toString("hex");
  return {
    passwordSalt: salt,
    passwordHash: crypto.scryptSync(value, salt, 32).toString("hex"),
  };
}

export function verifyPassword(password, record) {
  try {
    const actual = crypto.scryptSync(
      String(password || ""),
      record.passwordSalt,
      32
    );
    const expected = Buffer.from(record.passwordHash, "hex");
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

const escapeAttribute = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

export function normalizeAcademicUrl(value) {
  let raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.length > 2048) {
    throw new ValidationError("Die Webadresse ist zu lang.");
  }
  raw = raw.replace(/\s+/g, "");
  if (/^www\./i.test(raw)) raw = "https://" + raw;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(raw) && /^[^/\s]+\.[^/\s]+/.test(raw)) {
    raw = "https://" + raw;
  }
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new Error("unsupported protocol");
    }
    return url.href;
  } catch {
    throw new ValidationError("Bitte eine gültige HTTP- oder HTTPS-Webadresse eingeben.");
  }
}

export function sanitizeKnowledgeHtml(value) {
  const input = String(value || "").replaceAll("\0", "");
  if (input.length > 100_000) {
    throw new ValidationError("Der Wissenstext ist zu lang.");
  }

  const allowed = new Set(["a", "br", "p", "b", "strong", "em", "i", "ul", "ol", "li"]);
  const voidTags = new Set(["br"]);
  const tokens = input.match(/<!--[\s\S]*?-->|<[^>]*>|[^<]+|</g) || [];
  const result = [];

  for (const token of tokens) {
    if (token.startsWith("<!--")) continue;
    if (!token.startsWith("<")) {
      result.push(token);
      continue;
    }

    const match = token.match(/^<\s*(\/?)\s*([a-z0-9]+)([\s\S]*?)>$/i);
    if (!match) {
      result.push("&lt;");
      continue;
    }

    const closing = Boolean(match[1]);
    const tag = match[2].toLowerCase();
    if (!allowed.has(tag)) continue;
    if (closing) {
      if (!voidTags.has(tag)) result.push(`</${tag}>`);
      continue;
    }

    if (tag !== "a") {
      result.push(`<${tag}>`);
      continue;
    }

    const attributes = match[3] || "";
    const hrefMatch = attributes.match(
      /(?:^|\s)href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i
    );
    if (!hrefMatch) continue;
    try {
      const href = normalizeAcademicUrl(hrefMatch[1] ?? hrefMatch[2] ?? hrefMatch[3] ?? "");
      result.push(
        `<a href="${escapeAttribute(href)}" target="_blank" rel="noopener noreferrer" title="${escapeAttribute(href)}">`
      );
    } catch {
      continue;
    }
  }

  return result.join("");
}

const cleanPermissions = (values) => {
  const allowed = new Set(Object.values(COURSE_PERMISSIONS));
  return [...new Set((Array.isArray(values) ? values : []).filter((x) => allowed.has(x)))];
};

export function normalizeCourseLeaderInput(body, existing = null) {
  const username = normalizeUsername(body.username ?? existing?.username);
  const displayName = normalizeName(body.displayName ?? existing?.displayName);
  if (!username || !/^[\p{L}\p{N}._-]{3,80}$/u.test(username)) {
    throw new ValidationError(
      "Der Benutzername muss 3 bis 80 Zeichen lang sein und darf Buchstaben, Zahlen, Punkt, Unterstrich und Bindestrich enthalten."
    );
  }
  if (!displayName || displayName.length > 120) {
    throw new ValidationError("Bitte einen Namen mit höchstens 120 Zeichen eingeben.");
  }

  const datasets = [...new Set((Array.isArray(body.datasets) ? body.datasets : existing?.datasets || [])
    .map(normalizeName)
    .filter(Boolean))];
  if (datasets.length > 100) throw new ValidationError("Zu viele Datensatzzuweisungen.");

  let expiresAt = body.expiresAt === "" ? null : body.expiresAt ?? existing?.expiresAt ?? null;
  if (expiresAt) {
    const parsed = new Date(expiresAt);
    if (Number.isNaN(parsed.getTime())) throw new ValidationError("Das Ablaufdatum ist ungültig.");
    expiresAt = parsed.toISOString();
  }

  return {
    username,
    displayName,
    datasets,
    permissions: cleanPermissions(body.permissions ?? existing?.permissions ?? DEFAULT_COURSE_PERMISSIONS),
    active: body.active === undefined ? existing?.active ?? true : Boolean(body.active),
    expiresAt,
  };
}

export function publicCourseLeader(user) {
  return {
    username: user.username,
    displayName: user.displayName,
    datasets: [...(user.datasets || [])],
    permissions: cleanPermissions(user.permissions),
    active: Boolean(user.active),
    expiresAt: user.expiresAt || null,
    createdAt: user.createdAt || null,
    updatedAt: user.updatedAt || null,
  };
}

function clone(value) {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

export function applyContentChanges(payload, changes, permissions) {
  const permissionSet = new Set(cleanPermissions(permissions));
  const knowledge = Array.isArray(changes?.knowledge) ? changes.knowledge : [];
  const recordFields = Array.isArray(changes?.recordFields) ? changes.recordFields : [];
  const academicLinks = Array.isArray(changes?.academicLinks) ? changes.academicLinks : [];
  if (knowledge.length + recordFields.length + academicLinks.length > 200) {
    throw new ValidationError("Pro Speichervorgang sind höchstens 200 Änderungen erlaubt.");
  }

  const next = clone(payload || {});
  next.recordEdits ||= {};
  next.groupMoves ||= {};
  next.savedGroups ||= {};
  const conflicts = [];
  const pending = [];
  const seen = new Set();
  const imageNames = new Set((next.images || []).map((image) => String(image?.name || "")));

  const baseRecord = (key) => {
    const parts = String(key || "").split("#");
    return {
      family: parts[0] || "",
      genus: parts[1] || "",
      species: parts[2] || "",
      de: parts[3] || "",
      en: parts[4] || "",
      place: parts[6] || "",
      author: parts[7] || "",
    };
  };
  const cleanRecordValue = (value) => {
    const cleaned = String(value ?? "").replaceAll("\0", "").trim();
    if (cleaned.length > 500) throw new ValidationError("Ein Tierdatenfeld ist zu lang.");
    return cleaned;
  };

  if (knowledge.length && !permissionSet.has(COURSE_PERMISSIONS.KNOWLEDGE)) {
    throw new ValidationError("Das Recht zum Bearbeiten von Wissenstexten fehlt.", 403);
  }
  for (const change of knowledge) {
    const key = String(change?.key || "");
    if (!key || key.length > 600 || !imageNames.has(key)) {
      throw new ValidationError("Ein Wissenstext verweist auf keinen Datensatz-Eintrag.");
    }
    if (seen.has("knowledge:" + key)) throw new ValidationError("Doppelte Wissenstext-Änderung.");
    seen.add("knowledge:" + key);
    const current = sanitizeKnowledgeHtml(next.recordEdits[key]?.knowledge || "");
    const base = sanitizeKnowledgeHtml(change.baseValue || "");
    const proposed = sanitizeKnowledgeHtml(change.value || "");
    if (current !== base) {
      conflicts.push({ field: "knowledge", key, serverValue: current, proposedValue: proposed });
    } else if (current !== proposed) {
      pending.push({ field: "knowledge", key, before: current, after: proposed });
    }
  }

  for (const change of recordFields) {
    const key = String(change?.key || "");
    const field = String(change?.field || "");
    const requiredPermission = COURSE_RECORD_FIELD_PERMISSIONS[field];
    if (!key || key.length > 600 || !imageNames.has(key)) {
      throw new ValidationError("Eine Tierdatenänderung verweist auf keinen Datensatz-Eintrag.");
    }
    if (!requiredPermission) throw new ValidationError("Unbekanntes Tierdatenfeld.");
    if (!permissionSet.has(requiredPermission)) {
      throw new ValidationError("Das Recht zum Bearbeiten dieses Tierdatenfeldes fehlt.", 403);
    }
    if (seen.has(`record:${field}:${key}`)) throw new ValidationError("Doppelte Tierdatenänderung.");
    seen.add(`record:${field}:${key}`);

    const currentRaw = field === "group"
      ? next.groupMoves[key] || ""
      : next.recordEdits[key]?.[field] ?? baseRecord(key)[field] ?? "";
    const current = cleanRecordValue(currentRaw);
    const base = cleanRecordValue(change.baseValue);
    const proposed = cleanRecordValue(change.value);
    if (current !== base) {
      conflicts.push({ field, key, serverValue: current, proposedValue: proposed });
    } else if (current !== proposed) {
      pending.push({ field, key, before: current, after: proposed });
    }
  }

  if (academicLinks.length && !permissionSet.has(COURSE_PERMISSIONS.ACADEMIC_LINKS)) {
    throw new ValidationError("Das Recht zum Bearbeiten akademischer Links fehlt.", 403);
  }
  for (const change of academicLinks) {
    const key = normalizeName(change?.key);
    if (!key || key.length > 120) throw new ValidationError("Ungültige Organismengruppe.");
    if (seen.has("academicLink:" + key)) throw new ValidationError("Doppelte Link-Änderung.");
    seen.add("academicLink:" + key);
    const currentRaw = next.savedGroups[key]?.academicUrl || "";
    const current = currentRaw ? normalizeAcademicUrl(currentRaw) : "";
    const base = change.baseValue ? normalizeAcademicUrl(change.baseValue) : "";
    const proposed = change.value ? normalizeAcademicUrl(change.value) : "";
    if (current !== base) {
      conflicts.push({ field: "academicLink", key, serverValue: current, proposedValue: proposed });
    } else if (current !== proposed) {
      pending.push({ field: "academicLink", key, before: current, after: proposed });
    }
  }

  if (conflicts.length) return { payload: next, auditChanges: [], conflicts };

  for (const change of pending) {
    if (change.field === "knowledge") {
      next.recordEdits[change.key] = {
        ...(next.recordEdits[change.key] || {}),
        knowledge: change.after,
      };
    } else if (change.field === "academicLink") {
      next.savedGroups[change.key] = {
        icon: "🔬",
        c1: "#68c7c2",
        c2: "#357b8c",
        families: [],
        ...(next.savedGroups[change.key] || {}),
        academicUrl: change.after,
      };
    } else if (change.field === "group") {
      if (change.after) next.groupMoves[change.key] = change.after;
      else delete next.groupMoves[change.key];
    } else {
      next.recordEdits[change.key] = {
        ...(next.recordEdits[change.key] || {}),
        [change.field]: change.after,
      };
    }
  }

  return { payload: next, auditChanges: pending, conflicts: [] };
}
