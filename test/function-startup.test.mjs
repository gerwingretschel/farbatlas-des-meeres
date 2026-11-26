import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const packageJson = JSON.parse(
  fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")
);

test("Netlify Blobs is declared as a production dependency", () => {
  assert.equal(packageJson.dependencies?.["@netlify/blobs"], "^10.7.11");
});

const lockUrl = new URL("../package-lock.json", import.meta.url);
const hasLock = fs.existsSync(lockUrl);
test("the existing package lock declares the same production dependency", { skip: !hasLock }, () => {
  const lock = JSON.parse(fs.readFileSync(lockUrl, "utf8"));
  assert.equal(lock.packages?.[""]?.dependencies?.["@netlify/blobs"], "^10.7.11");
});

test("the deployed function module and all server imports load successfully", async () => {
  const module = await import("../netlify/functions/farbatlas.mjs");
  assert.equal(typeof module.default, "function");
});
