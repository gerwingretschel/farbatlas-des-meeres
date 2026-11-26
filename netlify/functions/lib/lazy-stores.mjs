export function createLazyStores(bindings, getStore) {
  if (!bindings || typeof bindings !== "object") {
    throw new TypeError("Store bindings must be an object.");
  }
  if (typeof getStore !== "function") {
    throw new TypeError("getStore must be a function.");
  }

  const stores = Object.create(null);
  for (const [property, storeName] of Object.entries(bindings)) {
    let initialized = false;
    let value;
    Object.defineProperty(stores, property, {
      enumerable: true,
      configurable: false,
      get() {
        if (!initialized) {
          value = getStore(storeName);
          initialized = true;
        }
        return value;
      },
    });
  }
  return Object.freeze(stores);
}
