// Start clean (docs/clean-install-helper-2026-11-04.md E): the steps for back up, format, reinstall, and an optional
// copy of the OP-1's disk-mode folders to the computer through the File System Access API (Chrome / Edge; the button
// stays hidden elsewhere). Reads only TAPE, ALBUM, DRUM and SYNTH on the OP-1 disk and writes only into a new folder
// inside the one the user picks. The format itself happens on the OP-1, never from the page.
// copyFolders / verifyCopy take directory handles and have no other browser dependencies
// (tools/firmware/qa/backup_js_test.mjs runs them on fake handles in Node).
export const FOLDERS = ['tape', 'album', 'drum', 'synth'];

// The four folders on the OP-1 disk, matched without case: {found: [[name, handle]], missing: [name]}
export async function findFolders(root) {
  const found = new Map();
  for await (const [name, handle] of root.entries())
    if (handle.kind === 'directory' && FOLDERS.includes(name.toLowerCase())) found.set(name.toLowerCase(), [name, handle]);
  return {found: FOLDERS.filter(f => found.has(f)).map(f => found.get(f)), missing: FOLDERS.filter(f => !found.has(f))};
}

// Copies a folder tree (hidden names such as .DS_Store left out); onFile(path, bytes) after each file
async function copyTree(src, dst, path, onFile, signal) {
  let files = 0, bytes = 0;
  for await (const [name, handle] of src.entries()) {
    if (signal?.aborted) throw Error('Copy stopped.');
    if (name.startsWith('.')) continue;
    if (handle.kind === 'directory') {
      const r = await copyTree(handle, await dst.getDirectoryHandle(name, {create: true}), `${path}/${name}`, onFile, signal);
      files += r.files; bytes += r.bytes;
      continue;
    }
    const file = await handle.getFile(), out = await (await dst.getFileHandle(name, {create: true})).createWritable();
    try { await out.write(file); } finally { await out.close(); }
    files++; bytes += file.size;
    onFile?.(`${path}/${name}`, file.size);
  }
  return {files, bytes};
}

export const backupName = (d = new Date()) => {
  const p = n => String(n).padStart(2, '0');
  return `op1-backup-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
};

// The OP-1's folders into dest/<backupName>: {name, files, bytes, folders, missing}
export async function copyFolders(root, dest, {onFile, signal, name = backupName()} = {}) {
  const {found, missing} = await findFolders(root);
  if (!found.length) throw Error("This doesn't look like the OP–1 disk: it has no tape, album, drum or synth folder.");
  const target = await dest.getDirectoryHandle(name, {create: true});
  let files = 0, bytes = 0;
  for (const [folder, handle] of found) {
    const r = await copyTree(handle, await target.getDirectoryHandle(folder, {create: true}), folder, onFile, signal);
    files += r.files; bytes += r.bytes;
  }
  return {name, files, bytes, folders: found.map(([f]) => f), missing};
}

// Every file of src again in dst with the same size: the paths that are missing or differ
export async function verifyCopy(src, dst, path = '') {
  const bad = [];
  for await (const [name, handle] of src.entries()) {
    if (name.startsWith('.')) continue;
    const here = path ? `${path}/${name}` : name;
    try {
      if (handle.kind === 'directory') bad.push(...await verifyCopy(handle, await dst.getDirectoryHandle(name), here));
      else if ((await handle.getFile()).size !== (await (await dst.getFileHandle(name)).getFile()).size) bad.push(here);
    } catch { bad.push(here); }
  }
  return bad;
}

const mb = n => n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`;

// The dialog: opened by every link to #start-clean; Build firmware file hands over to the page's own button
export function initStartClean(doc = document, win = window) {
  const $ = id => doc.getElementById(id), dialog = $('start-clean');
  if (!dialog) return;
  const open = e => { e?.preventDefault(); if (!dialog.open) dialog.showModal(); };
  doc.querySelectorAll('a[href="#start-clean"]').forEach(a => a.addEventListener('click', open));
  if (win.location?.hash === '#start-clean') open();
  $('start-clean-close').onclick = () => dialog.close();
  $('start-clean-build').onclick = () => { dialog.close(); $('path-build')?.click(); };
  const copy = $('start-clean-copy'), status = $('start-clean-status');
  if (typeof win.showDirectoryPicker !== 'function') { $('start-clean-assist').hidden = true; return; }
  const say = (text, error = false) => { status.textContent = text; status.classList.toggle('error', error); status.hidden = false; };
  copy.onclick = async () => {
    copy.disabled = true;
    try {
      say('Choose the OP–1 disk.');
      const root = await win.showDirectoryPicker({id: 'op1-disk', mode: 'read'});
      say('Now choose a folder on your computer to copy into.');
      const dest = await win.showDirectoryPicker({id: 'op1-backup', mode: 'readwrite'});
      let files = 0, bytes = 0;
      const r = await copyFolders(root, dest, {onFile: (path, n) => { files++; bytes += n; say(`Copying… ${files} files, ${mb(bytes)}. ${path}`); }});
      say(`Checking the copy… ${r.files} files, ${mb(r.bytes)}.`);
      const target = await dest.getDirectoryHandle(r.name), bad = [];
      for (const [folder, handle] of (await findFolders(root)).found)
        bad.push(...(await verifyCopy(handle, await target.getDirectoryHandle(folder))).map(p => `${folder}/${p}`));
      if (bad.length) say(`${bad.length} file${bad.length === 1 ? '' : 's'} didn't copy right, for example ${bad[0]}. Try again, or copy the folders yourself.`, true);
      else say(`Done: ${r.files} files, ${mb(r.bytes)} in “${r.name}”.${r.missing.length ? ` No ${r.missing.join(' or ')} folder on the OP–1.` : ''} Eject the OP–1 disk before you switch it off.`);
    } catch (e) {
      if (e?.name === 'AbortError') say('Nothing copied. Choose the OP–1 disk and a folder to start again.');
      else say((e?.message || String(e)) + ' Copy the folders yourself if this keeps happening.', true);
    } finally { copy.disabled = false; }
  };
}
