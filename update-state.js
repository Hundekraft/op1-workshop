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
