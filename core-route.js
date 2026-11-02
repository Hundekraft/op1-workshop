// Which hundekraft a connected OP-1 runs, and whether a new core can go over USB without the original R246
// (docs/sysex-update.md "Core patches"). cores: the release's cores.json (tools/firmware/cores.py). No browser
// dependencies (tools/firmware/qa/core_route_js_test.mjs runs it in Node); runtime.core_update checks it all again.
const same = (a, b) => !!a && !!b && a.start === b.start && a.len === b.len && (a.crc >>> 0) === (b.crc >>> 0);

// the release whose core is running (inventory `core`), or null: an rc, a test build or another firmware
export function runningRelease(cores, core) {
  return core && cores?.releases?.find(r => r.cores.some(c => same(c.core, core))) || null;
}

// {route: 'patch'} or {route: 'original', reason}. inv: readInventory's result (patch: the OP-1 takes core patches);
// disk: {size, crc} of its OP1_vdk.ldr (readCoreFile), variant: the selection's variant id
export function coreRoute(cores, inv, disk, variant) {
  if (!cores?.releases?.length) return {route: 'original', reason: 'cores'};
  if (!inv?.patch) return {route: 'original', reason: 'firmware'};
  const target = cores.releases.find(r => r.version === cores.current);
  if (!target?.cores.some(c => c.variant === variant)) return {route: 'original', reason: 'target'};
  if (!disk || !cores.releases.some(r => r.cores.some(c => c.ldr.size === disk.size && (c.ldr.crc >>> 0) === (disk.crc >>> 0))))
    return {route: 'original', reason: 'disk'};
  const now = runningRelease(cores, inv.core);
  if (!now) return {route: 'original', reason: 'running'};
  if (now.factory !== target.factory) return {route: 'original', reason: 'factory'};
  if (Object.entries(target.files).some(([p, [sha, blob]]) => !blob && now.files[p]?.[0] !== sha))
    return {route: 'original', reason: 'files'};
  return {route: 'patch'};
}
