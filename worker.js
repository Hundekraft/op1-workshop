// No firmware bytes are sent to a server. Only versioned patch assets and the
// Python runtime are fetched. Terminating the worker releases all firmware data.
const PYODIDE = 'https://cdn.jsdelivr.net/pyodide/v314.0.7/full/';
const log = text => postMessage({type:'log', text});
const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2,'0')).join('');
async function get(path, expected) {
  const response = await fetch(path);
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
onmessage = async ({data:{bytes,config,release}}) => {
  try {
    log('Checking original R246…');
    const baseBytes = await get('base/manifest.json', release.base_sha256);
    const base = JSON.parse(new TextDecoder().decode(baseBytes));
    if (await digest(bytes) !== base.original.sha256) throw Error('This is not the original, unmodified R246 firmware. Choose op1_246.op1 and try again.');
    log('Loading the local patcher (first use needs an internet connection)…');
    const {loadPyodide} = await import(PYODIDE + 'pyodide.mjs');
    const py = await loadPyodide({indexURL:PYODIDE});
    py.FS.writeFile('/runtime.py', await get('runtime.py', release.runtime_sha256));
    py.globals.set('config_json', JSON.stringify(config)); py.globals.set('catalog_json', JSON.stringify(release.catalog));
    const id = py.runPython("import sys; sys.path.insert(0, '/'); import json, runtime as R; config = R.normalize(json.loads(config_json), json.loads(catalog_json)); R.config_id(config, json.loads(catalog_json))");
    if (!release.variants[id]) throw Error('This configuration is not available in this release.');
    const variantBytes = await get(`variants/${id}/manifest.json`, release.variants[id].sha256);
    const variant = JSON.parse(new TextDecoder().decode(variantBytes));
    if (variant.release.id !== release.release.id) throw Error('Mixed patch release. Reload the page.');
    await assets(py, base, 'base', '/base');
    await assets(py, variant, `variants/${id}`, '/variant');
    py.FS.writeFile('/base.json', baseBytes); py.FS.writeFile('/variant.json', variantBytes);
    py.FS.writeFile('/input.op1', new Uint8Array(bytes)); py.globals.set('progress', log);
    py.runPython(`
base = json.load(open('/base.json'))
variant = json.load(open('/variant.json'))
if variant['config'] != config:
    raise ValueError('Configuration does not match the patch')
out, report = R.patch(open('/input.op1','rb').read(), base, variant,
    lambda n: open('/base/' + n,'rb').read(),
    lambda n: open('/variant/' + n,'rb').read(), progress)
open('/output.op1','wb').write(out)
open('/report.json','w').write(json.dumps(report, indent=2) + '\\n')
`);
    const out = py.FS.readFile('/output.op1');
    const presets = await get(`variants/${id}/presets.zip`, variant.presets.sha256);
    postMessage({type:'done', out, presets, id, report:py.FS.readFile('/report.json',{encoding:'utf8'})}, [out.buffer, presets.buffer]);
  } catch (error) { postMessage({type:'error', text:String(error.message || error)}); }
};
