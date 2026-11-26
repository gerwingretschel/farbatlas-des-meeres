import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createLazyStores } from "../netlify/functions/lib/lazy-stores.mjs";

test("store creation is lazy and caches each requested store", () => {
  const calls = [];
  const stores = createLazyStores(
    { datasets: "datasets", materials: "materials" },
    (name) => {
      calls.push(name);
      return { name };
    }
  );

  assert.deepEqual(calls, []);
  assert.equal(stores.datasets.name, "datasets");
  assert.deepEqual(calls, ["datasets"]);
  assert.equal(stores.datasets.name, "datasets");
  assert.deepEqual(calls, ["datasets"]);
});

test("a failing unrelated store does not break login or dataset store access", () => {
  const stores = createLazyStores(
    { datasets: "datasets", materialAudit: "material-audit" },
    (name) => {
      if (name === "material-audit") throw new Error("material store unavailable");
      return { name };
    }
  );

  assert.equal(stores.datasets.name, "datasets");
  assert.throws(() => stores.materialAudit, /material store unavailable/);
});

test("failed initialization can be retried", () => {
  let attempt = 0;
  const stores = createLazyStores({ datasets: "datasets" }, () => {
    attempt += 1;
    if (attempt === 1) throw new Error("temporary initialization failure");
    return { ready: true };
  });

  assert.throws(() => stores.datasets, /temporary initialization failure/);
  assert.equal(stores.datasets.ready, true);
  assert.equal(attempt, 2);
});

test("server handler creates stores inside its guarded request path", () => {
  const source = fs.readFileSync(new URL("../netlify/functions/farbatlas.mjs", import.meta.url), "utf8");
  const tryAt = source.indexOf("  try {");
  const bodyAt = source.indexOf("const body = await req.json()", tryAt);
  const storesAt = source.indexOf("const stores = createLazyStores", bodyAt);
  const adminAt = source.indexOf('if (body.action === "admin-login")', storesAt);

  assert.ok(tryAt > -1 && bodyAt > tryAt && storesAt > bodyAt && adminAt > storesAt);
  assert.doesNotMatch(source.slice(source.indexOf("export default async"), tryAt), /getStore\s*\(/);
  assert.doesNotMatch(source, /datasets:\s*getStore\s*\(/);
});
