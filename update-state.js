// Verification covers the complete reviewed result, including retained file providers.
export const sameCore = (a, b) => !!a && !!b && ['start', 'len', 'crc'].every(k => a[k] === b[k]);
const sameNames = (a, b) => Array.isArray(a) && Array.isArray(b) && [...a].sort().join('\0') === [...b].sort().join('\0');
export function updateDifferences(inv, expected) {
  if (!inv?.plugins || !expected) return ['No plugin inventory available yet'];
  const differences = [];
  if (expected.core && !sameCore(inv.core, expected.core)) differences.push('Firmware core has not matched yet');
  const installed = new Map((inv.records || []).filter(r => r.path).map(r => [r.path, r]));
  for (const f of expected.files) {
    const now = installed.get(f.path), name = f.path.split('/').pop();
    if (!now) differences.push(`${name} is missing`);
    else if (now.crc !== f.crc) differences.push(`${name} contents do not match`);
    else if (now.state !== (f.on ? 'loaded' : 'off')) differences.push(`${name}: ${now.state || 'unknown'}${now.reason ? ' — ' + now.reason : ''}`);
  }
  for (const path of expected.deletes) if (installed.has(path)) differences.push(`${path.split('/').pop()} has not been removed`);
  if (!sameNames(inv.off, expected.off)) differences.push('Saved on/off choices do not match');
  if (!sameNames(inv.offBoot, expected.off)) differences.push('Restarted on/off choices do not match');
  for (const e of expected.builtins || []) if (!inv.records.some(r => r.source === 'builtin' && r.name === e.name && r.state === (e.on ? 'loaded' : 'off'))) differences.push(`${e.name} state does not match`);
  return differences;
}
export const matchesUpdate = (inv, expected) => updateDifferences(inv, expected).length === 0;
// The OP-1 applies a batch whole or not at all (a failed step rolls everything back) and does not report why.
// expected.before = [{path, crc}] for every file the update changes (crc null: absent before). All still as before:
// nothing was applied. Saved updates without `before` never match.
export function updateNotApplied(inv, expected) {
  if (!inv?.plugins || !Array.isArray(expected?.before) || !expected.before.length) return false;
  const installed = new Map((inv.records || []).filter(r => r.path).map(r => [r.path, r]));
  return expected.before.every(b => b.crc === null ? !installed.has(b.path) : installed.get(b.path)?.crc === b.crc);
}
