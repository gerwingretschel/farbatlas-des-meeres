import crypto from "node:crypto";
import { ValidationError } from "./course-utils.mjs";

export const IMAGE_VARIANTS = Object.freeze({
  teaching: Object.freeze({
    maxBytes: 400 * 1024,
    maxEdge: 1600,
    allowedTypes: Object.freeze(["image/jpeg"]),
  }),
  thumbnail: Object.freeze({
    maxBytes: 90 * 1024,
    maxEdge: 500,
    allowedTypes: Object.freeze(["image/jpeg", "image/webp"]),
  }),
});

const safeInteger = (value, label) => {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw new ValidationError(`${label} fehlt oder ist ungültig.`);
  }
  return number;
};

export function imageVariantBytes(data, variant) {
  const rules = IMAGE_VARIANTS[variant];
  if (!rules) throw new ValidationError("Unbekannte Bildvariante.");
  if (typeof data !== "string" || !data) throw new ValidationError("Bilddaten fehlen.");
  const bytes = Buffer.from(data, "base64");
  if (!bytes.length) throw new ValidationError("Bilddaten sind leer.");
  if (bytes.length > rules.maxBytes) {
    throw new ValidationError(
      variant === "thumbnail"
        ? "Das Vorschaubild ist größer als 90 KB."
        : "Das Unterrichtsbild ist größer als 400 KB.",
      413
    );
  }
  return bytes;
}

export function validateImageVariant({ data, type, width, height }, variant) {
  const rules = IMAGE_VARIANTS[variant];
  if (!rules) throw new ValidationError("Unbekannte Bildvariante.");
  const contentType = String(type || "").toLowerCase();
  if (!rules.allowedTypes.includes(contentType)) {
    throw new ValidationError(
      variant === "thumbnail"
        ? "Vorschaubilder müssen JPEG oder WebP sein."
        : "Unterrichtsbilder müssen JPEG sein."
    );
  }
  const imageWidth = safeInteger(width, "Bildbreite");
  const imageHeight = safeInteger(height, "Bildhöhe");
  if (Math.max(imageWidth, imageHeight) > rules.maxEdge) {
    throw new ValidationError(
      variant === "thumbnail"
        ? "Die längste Kante des Vorschaubilds darf höchstens 500 Pixel betragen."
        : "Die längste Kante des Unterrichtsbilds darf höchstens 1.600 Pixel betragen."
    );
  }
  return {
    bytes: imageVariantBytes(data, variant),
    contentType,
    width: imageWidth,
    height: imageHeight,
  };
}

export const imageSha256 = (bytes) =>
  crypto.createHash("sha256").update(bytes).digest("hex");

export function thumbnailKeyFor(imageKey) {
  const value = String(imageKey || "");
  if (!/^image-[0-9a-f-]{20,}$/i.test(value)) {
    throw new ValidationError("Ungültiger Unterrichtsbild-Schlüssel.");
  }
  return `thumbnail-${value}`;
}

export function thumbnailCondition({ reference, sourceExists, thumbnailExists, thumbnailMetadata, sourceHash }) {
  if (!sourceExists) return "source-missing";
  if (!reference?.thumbnailKey) return "missing";
  if (!thumbnailExists) return "damaged";
  if (thumbnailMetadata?.sourceImageKey !== reference.imageKey) return "damaged";
  if (!thumbnailMetadata?.sourceSha256 || thumbnailMetadata.sourceSha256 !== sourceHash) return "stale";
  const bytes = Number(thumbnailMetadata?.bytes || reference.thumbnailBytes || 0);
  if (!Number.isFinite(bytes) || bytes < 1 || bytes > IMAGE_VARIANTS.thumbnail.maxBytes) return "damaged";
  return "current";
}
