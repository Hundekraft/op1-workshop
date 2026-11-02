// No firmware bytes are sent to a server. Only versioned patch assets and the
// Python runtime are fetched. Terminating the worker releases all firmware data.
const PYODIDE = 'https://cdn.jsdelivr.net/pyodide/v314.0.7/full/';
const log = text => postMessage({type:'log', text});
const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2,'0')).join('');
async function get(path, expected) {
  const response = await fetch(path, {cache: 'no-cache'});
  if (!response.ok) throw Error(`Could not load ${path}. Check your connection and retry.`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (expected && await digest(bytes) !== expected) throw Error(`Patch release mismatch: ${path}. Reload the page.`);
  return bytes;
}
async function assets(py, manifest, prefix, destination) {
  py.FS.mkdirTree(destination);
  const blobs = new Set();
  for (const file of manifest.patched_files) for (const op of file.ops) if (op.blob) blobs.add(op.blob);
  for (const file of manifest.added_files) if (file.blob) blobs.add(file.blob);
  for (const blob of blobs) {
    if (blob.startsWith('/') || blob.split('/').includes('..')) throw Error('Invalid patch asset path');
    const path = `${destination}/${blob}`;
    py.FS.mkdirTree(path.substring(0,path.lastIndexOf('/')));
    py.FS.writeFile(path, await get(`${prefix}/${blob}`));
  }
}
// The preset pack alone, filtered to the selection (no R246 needed): the same runtime.filter_preset_zip as a build
async function presetsOnly(config, release) {
  log('Loading the local patcher (first use needs an internet connection)…');
  const {loadPyodide} = await import(PYODIDE + 'pyodide.mjs');
  const py = await loadPyodide({indexURL:PYODIDE});
  py.FS.writeFile('/runtime.py', await get('runtime.py', release.runtime_sha256));
  py.globals.set('config_json', JSON.stringify(config)); py.globals.set('catalog_json', JSON.stringify(release.catalog));
  const ids = py.runPython("import sys; sys.path.insert(0, '/'); import json, runtime as R; catalog = json.loads(catalog_json); config = R.normalize(json.loads(config_json), catalog); [R.config_id(config, catalog), R.config_id(R.variant_config(config, catalog), catalog)]");
  let id, variantId;
  try { [id, variantId] = ids.toJs(); } finally { ids.destroy(); }
  if (!release.variants[variantId]) throw Error('This configuration is not available in this release.');
  const variant = JSON.parse(new TextDecoder().decode(await get(`variants/${variantId}/manifest.json`, release.variants[variantId].sha256)));
  if (variant.release.id !== release.release.id) throw Error('Mixed patch release. Reload the page.');
  log('Putting your preset pack together…');
  py.FS.writeFile('/presets.zip', await get(`variants/${variantId}/presets.zip`, variant.presets.sha256));
  py.runPython("open('/presets-out.zip','wb').write(R.filter_preset_zip(open('/presets.zip','rb').read(), config, catalog))");
  const presets = py.FS.readFile('/presets-out.zip');
  postMessage({type:'presets', presets, id}, [presets.buffer]);
}
// A new core as a patch of the OP-1's own firmware file (runtime.core_update; no R246): the patch plus the base
// files the OP-1's release doesn't have, or the reason it needs the original R246 after all
async function corePatch({variantId, disk, running}, release) {
  log('Loading the local patcher (first use needs an internet connection)…');
  const {loadPyodide} = await import(PYODIDE + 'pyodide.mjs');
  const py = await loadPyodide({indexURL:PYODIDE});
  py.FS.writeFile('/runtime.py', await get('runtime.py', release.runtime_sha256));
  const coresBytes = await get('cores.json', release.cores_sha256);
  const cores = JSON.parse(new TextDecoder().decode(coresBytes));
  const same = (a, b) => a && b && a.start === b.start && a.len === b.len && a.crc >>> 0 === b.crc >>> 0;
  const target = cores.releases.find(r => r.version === cores.current), now = cores.releases.find(r => r.cores.some(c => same(c.core, running)));
  const core = target?.cores.find(c => c.variant === variantId);
  const need = [...(core?.ldr.ops || []).filter(o => o[0] === 'i').map(o => o[3]),
                ...Object.entries(target?.files || {}).filter(([p, [sha, blob]]) => blob && now?.files[p]?.[0] !== sha).map(([, [, blob]]) => 'base/' + blob)];
  log('Preparing the firmware update…');
  for (const path of need) {
    if (path.startsWith('/') || path.split('/').includes('..')) throw Error('Invalid patch asset path');
    py.FS.mkdirTree('/site/' + path.substring(0, path.lastIndexOf('/')));
    py.FS.writeFile('/site/' + path, await get(path));                 // runtime checks every hash
  }
  py.FS.writeFile('/cores.json', coresBytes);
  py.globals.set('job_json', JSON.stringify({variantId, disk, running}));
  py.runPython(`
import sys, json, os; sys.path.insert(0, '/'); import runtime as R
job = json.loads(job_json)
files, why = R.core_update(json.load(open('/cores.json')), job['variantId'], job['disk'], job['running'],
                           lambda p: open('/site/' + p, 'rb').read())
os.makedirs('/core', exist_ok=True)
for i, (name, data) in enumerate(files or []): open(f'/core/{i}', 'wb').write(data)
open('/core.json', 'w').write(json.dumps({'names': [n for n, _ in files or []], 'reason': why}))
`);
  const out = JSON.parse(py.FS.readFile('/core.json', {encoding:'utf8'}));
  const files = out.names.map((name, i) => [name, py.FS.readFile(`/core/${i}`)]);
  postMessage({type:'core', files, reason: out.reason}, files.map(([, d]) => d.buffer));
}
onmessage = async ({data:{bytes,config,release,push,presetsJob,coreJob}}) => {
  try {
    if (presetsJob) return await presetsOnly(config, release);
    if (coreJob) return await corePatch(coreJob, release);
    log('Checking original R246…');
    const baseBytes = await get('base/manifest.json', release.base_sha256);
    const base = JSON.parse(new TextDecoder().decode(baseBytes));
    if (await digest(bytes) !== base.original.sha256) throw Error('This is not the original, unmodified R246 firmware. Choose op1_246.op1 and try again.');
    log('Loading the local patcher (first use needs an internet connection)…');
    const {loadPyodide} = await import(PYODIDE + 'pyodide.mjs');
    const py = await loadPyodide({indexURL:PYODIDE});
    py.FS.writeFile('/runtime.py', await get('runtime.py', release.runtime_sha256));
    py.globals.set('config_json', JSON.stringify(config)); py.globals.set('catalog_json', JSON.stringify(release.catalog));
    // The prebuilt variant never hides op1r plugins; hiding is applied on top of it (runtime.patch).
    // sqlite3 for hiding is part of this Pyodide's standard library (no package to load).
    // On kennel bases the variant has every plugin file; patch() leaves out the ones not chosen.
    const ids = py.runPython("import sys; sys.path.insert(0, '/'); import json, runtime as R; catalog = json.loads(catalog_json); config = R.normalize(json.loads(config_json), catalog); [R.config_id(config, catalog), R.config_id(R.variant_config(config, catalog), catalog)]");
    let id, variantId;
    try { [id, variantId] = ids.toJs(); } finally { ids.destroy(); }
    if (!release.variants[variantId]) throw Error('This configuration is not available in this release.');
    const variantBytes = await get(`variants/${variantId}/manifest.json`, release.variants[variantId].sha256);
    const variant = JSON.parse(new TextDecoder().decode(variantBytes));
    if (variant.release.id !== release.release.id) throw Error('Mixed patch release. Reload the page.');
    await assets(py, base, 'base', '/base');
    await assets(py, variant, `variants/${variantId}`, '/variant');
    py.FS.writeFile('/base.json', baseBytes); py.FS.writeFile('/variant.json', variantBytes);
    py.FS.writeFile('/input.op1', new Uint8Array(bytes)); py.globals.set('progress', log); py.globals.set('want_push', !!push);
    py.FS.writeFile('/presets.zip', await get(`variants/${variantId}/presets.zip`, variant.presets.sha256));
    py.runPython(`
base = json.load(open('/base.json'))
variant = json.load(open('/variant.json'))
if variant['config'] != R.variant_config(config, catalog):
    raise ValueError('Configuration does not match the patch')
out, report = R.patch(open('/input.op1','rb').read(), base, variant,
    lambda n: open('/base/' + n,'rb').read(),
    lambda n: open('/variant/' + n,'rb').read(), progress,
    catalog=catalog, config=config)
open('/output.op1','wb').write(out)
# kennel bases: the variant's preset pack, filtered to this configuration (2.x: unchanged)
presets = R.filter_preset_zip(open('/presets.zip','rb').read(), config, catalog)
open('/presets-out.zip','wb').write(presets)
if presets != open('/presets.zip','rb').read():
    report['presets'] = R.preset_info(presets, config['preset_cap'])
open('/report.json','w').write(json.dumps(report, indent=2) + '\\n')
# files the build changed or added, for the SysEx update (docs/sysex-update.md); te-boot is never sent
changed = []
if want_push:
    before = {m.name: d for m, d in R.unpack(open('/input.op1','rb').read())}
    changed = [(m.name, d) for m, d in R.unpack(out) if d is not None and before.get(m.name) != d and 'te-boot' not in m.name]
import os; os.makedirs('/push', exist_ok=True)
for i, (name, data) in enumerate(changed): open(f'/push/{i}', 'wb').write(data)
open('/push.json', 'w').write(json.dumps([name for name, _ in changed]))
`);
    const out = py.FS.readFile('/output.op1');
    const presets = py.FS.readFile('/presets-out.zip');
    const pushFiles = JSON.parse(py.FS.readFile('/push.json', {encoding:'utf8'})).map((name, i) => [name, py.FS.readFile(`/push/${i}`)]);
    postMessage({type:'done', out, presets, id, report:py.FS.readFile('/report.json',{encoding:'utf8'}), pushFiles},
      [out.buffer, presets.buffer, ...pushFiles.map(([, d]) => d.buffer)]);
  } catch (error) { postMessage({type:'error', text:String(error.message || error)}); }
};
