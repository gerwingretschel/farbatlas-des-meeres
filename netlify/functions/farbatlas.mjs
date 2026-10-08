import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";

const DS = "farbatlas-datasets-v10";
const IS = "farbatlas-images-v10";

const reply = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });

const normalizeName = (name) => String(name || "").trim();
const dkey = (name) =>
  "dataset-" +
  crypto
    .createHash("sha256")
    .update(normalizeName(name).toLowerCase())
    .digest("hex");

const ph = (password, salt) =>
  crypto
    .pbkdf2Sync(String(password), salt, 210000, 32, "sha256")
    .toString("hex");

const sign = (payload) =>
  crypto
    .createHmac("sha256", process.env.ADMIN_PASSWORD || "")
    .update(payload)
    .digest("base64url");

const token = () => {
  const payload = Buffer.from(
    JSON.stringify({ exp: Date.now() + 28800000 })
  ).toString("base64url");
  return payload + "." + sign(payload);
};

const valid = (value) => {
  try {
    const [payload, signature] = String(value || "").split(".");
    return (
      Boolean(payload) &&
      signature === sign(payload) &&
      JSON.parse(Buffer.from(payload, "base64url")).exp > Date.now()
    );
  } catch {
    return false;
  }
};

const timingSafeTextEqual = (a, b) => {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
};

async function auth(store, name, password) {
  const dataset = await store.get(dkey(name), {
    type: "json",
    consistency: "strong",
  });
  if (!dataset) {
    return { error: reply({ error: "Datensatz nicht gefunden." }, 404) };
  }
  if (ph(password, dataset.salt) !== dataset.passwordHash) {
    return { error: reply({ error: "Datensatz-Passwort ist falsch." }, 401) };
  }
  return { dataset };
}

async function listDatasets(store) {
  const { blobs } = await store.list({ prefix: "dataset-" });
  const datasets = [];

  for (const blob of blobs) {
    const dataset = await store.get(blob.key, {
      type: "json",
      consistency: "strong",
    });
    if (!dataset) continue;
    datasets.push({
      name: dataset.name || "Unbenannter Datensatz",
      updatedAt: dataset.updatedAt || null,
    });
  }

  datasets.sort((a, b) =>
    String(a.name).localeCompare(String(b.name), "de", { sensitivity: "base" })
  );
  return datasets;
}

async function deleteDatasetImages(imageStore, datasetName) {
  const datasetKey = dkey(datasetName);
  const { blobs } = await imageStore.list();
  let deletedImages = 0;

  for (const blob of blobs) {
    const metadata = await imageStore.getMetadata(blob.key);
    if (metadata?.metadata?.dataset !== datasetKey) continue;
    await imageStore.delete(blob.key);
    deletedImages += 1;
  }

  return deletedImages;
}

export default async (req) => {
  if (req.method !== "POST") {
    return reply({ error: "Methode nicht erlaubt." }, 405);
  }

  try {
    const body = await req.json();
    const datasetsStore = getStore(DS);
    const imagesStore = getStore(IS);

    if (body.action === "admin-login") {
      if (!process.env.ADMIN_PASSWORD) {
        return reply({ error: "ADMIN_PASSWORD fehlt in Netlify." }, 500);
      }
      if (!timingSafeTextEqual(body.password, process.env.ADMIN_PASSWORD)) {
        return reply({ error: "Administrator-Passwort ist falsch." }, 401);
      }
      return reply({ token: token() });
    }

    if (body.action === "load") {
      const result = await auth(
        datasetsStore,
        body.name,
        body.password
      );
      return (
        result.error ||
        reply({ name: result.dataset.name, payload: result.dataset.payload })
      );
    }

    if (body.action === "get-image") {
      const result = await auth(
        datasetsStore,
        body.name,
        body.password
      );
      if (result.error) return result.error;

      const arrayBuffer = await imagesStore.get(body.imageKey, {
        type: "arrayBuffer",
      });
      if (!arrayBuffer) {
        return reply({ error: "Bild nicht gefunden." }, 404);
      }

      const metadata = await imagesStore.getMetadata(body.imageKey);
      return reply({
        data: Buffer.from(arrayBuffer).toString("base64"),
        type: metadata?.metadata?.contentType || "image/jpeg",
      });
    }

    const bearer = req.headers
      .get("authorization")
      ?.replace(/^Bearer\s+/i, "");
    if (!valid(bearer)) {
      return reply({ error: "Administrator-Anmeldung erforderlich." }, 401);
    }

    if (body.action === "list-datasets") {
      return reply({ datasets: await listDatasets(datasetsStore) });
    }

    if (body.action === "delete-dataset") {

      const name = normalizeName(body.name);
      if (!name) {
        return reply({ error: "Name des Datensatzes fehlt." }, 400);
      }

      const key = dkey(name);
      const existing = await datasetsStore.get(key, {
        type: "json",
        consistency: "strong",
      });
      if (!existing) {
        return reply({ error: "Datensatz nicht gefunden." }, 404);
      }

      const deletedImages = await deleteDatasetImages(imagesStore, name);
      await datasetsStore.delete(key);
      return reply({
        message: `Datensatz „${existing.name || name}“ wurde gelöscht.`,
        deletedImages,
      });
    }

    if (body.action === "reset-dataset-password") {

      const name = normalizeName(body.name);
      const newPassword = String(body.newPassword || "");
      if (!name || !newPassword.trim()) {
        return reply(
          { error: "Datensatzname und neues Passwort sind erforderlich." },
          400
        );
      }

      const key = dkey(name);
      const existing = await datasetsStore.get(key, {
        type: "json",
        consistency: "strong",
      });
      if (!existing) {
        return reply({ error: "Datensatz nicht gefunden." }, 404);
      }

      const salt = crypto.randomBytes(16).toString("hex");
      await datasetsStore.setJSON(key, {
        ...existing,
        salt,
        passwordHash: ph(newPassword, salt),
        updatedAt: new Date().toISOString(),
      });
      return reply({
        message: `Passwort für „${existing.name || name}“ wurde zurückgesetzt.`,
      });
    }

    if (body.action === "upload-image") {
      const result = await auth(
        datasetsStore,
        body.name,
        body.password
      );
      if (result.error) return result.error;
      if (!body.data || !body.fileName) {
        return reply({ error: "Bilddaten fehlen." }, 400);
      }

      const bytes = Buffer.from(body.data, "base64");
      if (bytes.length > 3800000) {
        return reply(
          { error: "Das vorbereitete Einzelbild ist noch zu groß." },
          413
        );
      }

      const key = "image-" + crypto.randomUUID();
      await imagesStore.set(key, bytes, {
        metadata: {
          contentType: body.type || "image/jpeg",
          fileName: String(body.fileName),
          dataset: dkey(body.name),
        },
      });
      return reply({ imageKey: key });
    }

    if (body.action === "save") {
      if (!body.name || !body.password || !body.payload) {
        return reply(
          { error: "Name, Passwort und Datensatz sind erforderlich." },
          400
        );
      }

      const key = dkey(body.name);
      const old = await datasetsStore.get(key, {
        type: "json",
        consistency: "strong",
      });

      if (body.create === true && old) {
        return reply({ error: "Datensatzname bereits vergeben." }, 409);
      }
      if (body.create !== true && !old) {
        return reply({ error: "Datensatz noch nicht vorhanden." }, 404);
      }
      if (old && ph(body.password, old.salt) !== old.passwordHash) {
        return reply({ error: "Datensatz-Passwort ist falsch." }, 401);
      }

      const salt = old?.salt || crypto.randomBytes(16).toString("hex");
      await datasetsStore.setJSON(key, {
        name: normalizeName(body.name),
        salt,
        passwordHash: ph(body.password, salt),
        payload: body.payload,
        updatedAt: new Date().toISOString(),
      });
      return reply({
        message: old
          ? "Datensatz wurde erfolgreich aktualisiert."
          : "Datensatz wurde erfolgreich neu angelegt.",
      });
    }

    return reply({ error: "Unbekannte Aktion." }, 400);
  } catch (error) {
    console.error("V10", error);
    return reply({ error: "Serverfehler: " + error.message }, 500);
  }
};

export const config = { path: "/api/farbatlas" };
