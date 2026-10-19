// Browser-local desired state. Restoring state never changes a device.
const PREFIX = 'hundekraft-selection-v1:';
const selections = new Map(), revisions = new Map();
export const newPluginState = () => ({schema: 1, revision: 0, files: [], removals: [], reviews: {}, toggles: {}, verification: null});
const conflict = () => Object.assign(Error('Another workshop tab changed saved selections. Reload this tab before continuing.'), {name: 'StateConflictError'});
const record = v => !!v && typeof v === 'object' && !Array.isArray(v);
export function loadSelection(base) {
  const raw = localStorage.getItem(PREFIX + base);
  selections.set(base, raw);
  if (raw === null) return null;
  const v = JSON.parse(raw);
  if (!record(v) || v.schema !== 1 || !record(v.inputs) || ![100, 300].includes(v.cap) || Object.values(v.inputs).some(x => typeof x !== 'boolean'))
    throw Error('Unsupported saved selection; existing data was preserved');
  return v;
}
export function saveSelection(base, inputs, cap) {
  const key = PREFIX + base, current = localStorage.getItem(key);
  if (!selections.has(base) || current !== selections.get(base)) throw conflict();
  const raw = JSON.stringify({schema: 1, inputs, cap});
  if (raw !== current) localStorage.setItem(key, raw);
  selections.set(base, raw);
}
let database;
function open() {
  if (!database) {
    const pending = new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => fail(Error('Plugin storage did not respond. Close other workshop tabs and reload.')), 8000);
      const fail = e => { if (!settled) { settled = true; clearTimeout(timer); reject(e); } };
      const r = indexedDB.open('hundekraft-own-plugins', 1);
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('states')) r.result.createObjectStore('states'); };
      r.onsuccess = () => {
        if (settled) { r.result.close(); return; }
        settled = true; clearTimeout(timer);
        r.result.onversionchange = () => { r.result.close(); database = undefined; };
        r.result.onclose = () => { database = undefined; };
        resolve(r.result);
      };
      r.onerror = () => fail(r.error);
      r.onblocked = () => fail(Error('Close other workshop tabs to unlock plugin storage'));
    });
    database = pending;
    pending.catch(() => { if (database === pending) database = undefined; });
  }
  return database;
}
export async function loadPlugins(base) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('states', 'readonly'), r = tx.objectStore('states').get(base);
    tx.oncomplete = () => {
      const v = r.result || newPluginState(), revision = v.revision ?? 0;
      if (!Number.isSafeInteger(revision) || revision < 0) { reject(Error('Invalid saved plugin revision')); return; }
      revisions.set(base, revision); resolve(v);
    };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || Error('Plugin storage read was interrupted'));
  });
}
let writes = Promise.resolve();
export function savePlugins(base, state) {
  const snapshot = structuredClone(state);
  const task = writes.catch(() => {}).then(async () => {
    if (!revisions.has(base)) throw Error('Saved plugins were not loaded; existing data was preserved');
    const expected = revisions.get(base), db = await open();
    await new Promise((resolve, reject) => {
      // Compare and write inside one transaction so two tabs cannot overwrite each other.
      const tx = db.transaction('states', 'readwrite'), store = tx.objectStore('states');
      let failure;
      const r = store.get(base);
      r.onsuccess = () => {
        if ((r.result?.revision ?? 0) !== expected) { failure = conflict(); tx.abort(); return; }
        snapshot.revision = expected + 1; store.put(snapshot, base);
      };
      tx.oncomplete = () => { revisions.set(base, expected + 1); resolve(); };
      tx.onerror = () => reject(failure || tx.error);
      tx.onabort = () => reject(failure || tx.error || Error('Plugin storage write was interrupted'));
    });
  });
  writes = task; return task;
}
export const providerSignature = e => JSON.stringify([e.name, e.path || null, e.crc ?? null, e.version || '', e.claimsKnown,
  (e.claims || []).map(c => typeof c === 'string' ? c : c.name).sort()]);
export const reviewSignature = (inv, entries) => JSON.stringify([inv?.core || null,
  entries.map(providerSignature).sort()]);
