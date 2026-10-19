import {resolveConflicts} from './conflicts.js';
export {resolveConflicts} from './conflicts.js';
// Firmware update over USB MIDI SysEx (op1r devupd, docs/sysex-update.md): the host side of the protocol, a port of
// op1r-src tools/op1push.py. No browser APIs here: a port is {send(Uint8Array), onSysex(callback)}, so the same code
// runs on Web MIDI and in the Node tests. Message: F0 00 20 76 7D cmd seq_lo seq_hi <7-bit packed payload> F7.
export const HDR = [0xF0, 0x00, 0x20, 0x76, 0x7D];
export const HELLO = 1, BEGIN = 2, DATA = 3, END = 4, COMMIT = 5, ABORT = 6;
export const OK = 0, E_STATE = 2, WAIT_KEY = 9;
export const MAX_MSG = 256, MAX_DATA = 192;
// The OP-1's stock USB-MIDI input takes at most 32 USB-MIDI packets (96 MIDI bytes) per OUT transfer; a longer
// SysEx (macOS sends each message as one transfer) stops all MIDI input until the OP-1 restarts (owner's unit,
// 2026-10-15: 96 bytes pass, 99 don't). So every message stays at or below 96 bytes: 72 data bytes per DATA, and
// one message in flight so the host can't merge two into one transfer.
export const USB_MAX_MSG = 96, USB_MAX_DATA = 72;
const STATUS = ['ok', 'format', 'state', 'path', 'size', 'offset', 'crc', 'io', 'full', 'wait key'];
export const statusText = s => STATUS[s] || `status ${s}`;

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
export function crc32(bytes, crc = 0) {
  crc = ~crc >>> 0;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
  return ~crc >>> 0;
}
export function pack7(bytes) {
  const out = [];
  for (let i = 0; i < bytes.length; i += 7) {
    const g = bytes.subarray(i, i + 7);
    let hi = 0;
    g.forEach((b, k) => { hi |= (b >> 7 & 1) << k; });
    out.push(hi, ...Array.from(g, b => b & 0x7F));
  }
  return out;
}
export function unpack7(bytes) {
  const out = [];
  for (let i = 0; i < bytes.length;) {
    const hi = bytes[i++];
    for (let k = 0; k < 7 && i < bytes.length; k++, i++) out.push(bytes[i] | (hi >> k & 1) << 7);
  }
  return Uint8Array.from(out);
}
export function build(cmd, seq, payload = new Uint8Array(0), max = USB_MAX_MSG) {
  const m = Uint8Array.from([...HDR, cmd, seq & 0x7F, seq >> 7 & 0x7F, ...pack7(payload), 0xF7]);
  if (m.length > max) throw Error('SysEx message too long');
  return m;
}
// reply: [cmd, seq, status, payload] or null (not a devupd reply)
export function parseReply(m) {
  if (m.length < 10 || HDR.some((b, i) => m[i] !== b) || m[m.length - 1] !== 0xF7 || !(m[5] & 0x40)) return null;
  const pl = unpack7(m.subarray(8, m.length - 1));
  return [m[5] & 0x3F, m[6] | m[7] << 7, pl[0], pl.subarray(1)];
}
// the device's allow-list (du_path_ok): OP1_vdk.ldr, content/..., plugins/<file>.knl|.op1p (kennel), never te-boot
export function pathOk(p) {
  if (!p || p.length >= 96 || !/^[A-Za-z0-9_.\/-]+$/.test(p) || p.startsWith('/') || p.endsWith('/')) return false;
  if (/te-boot|te_boot|teboot/i.test(p) || p.includes('..') || p.includes('//')) return false;
  return p === 'OP1_vdk.ldr' || p.startsWith('content/') || /^plugins\/[^/.][^/]*\.(knl|op1p)$/.test(p);
}
// The OP-1's MIDI port is there but nothing answers HELLO: no USB update on it. Released units get it with 3.0, so the unit
// runs hundekraft 2.7 or older, op1r or TE's firmware (or it's busy restarting), and needs one install through the update menu.
export const NO_UPDATE_TEXT = "Your OP–1 is connected but doesn't answer the USB update. It probably runs hundekraft 2.7 or older, op1r or TE's own firmware, and those can't be updated over USB. Install 3.0 once through the update menu: download the firmware, switch the OP–1 off, hold COM while you switch it on, press T1 and copy the file to the OP–1 disk. After that, Send to OP–1 works. If you just confirmed an update, wait for the tape screen and try again.";
// a plugin file the OP-1 may delete (du_plugin_path): content/ or plugins/ <file>.knl|.op1p
export const pluginPath = p => pathOk(p) && /^(content|plugins)\/[^/.][^/]*\.(knl|op1p)$/.test(p);
const u32 = v => [v & 0xFF, v >>> 8 & 0xFF, v >>> 16 & 0xFF, v >>> 24 & 0xFF];
const rd32 = b => (b[0] | b[1] << 8 | b[2] << 16 | b[3] << 24) >>> 0;

// Collects SysEx messages from a port (whole messages or byte runs) and lets the protocol wait for a reply.
class Inbox {
  constructor(port) {
    this.buf = []; this.msgs = []; this.waiter = null;
    port.onSysex(bytes => {
      for (const b of bytes) {
        if (b >= 0xF8) continue;                                   // realtime bytes (MIDI clock) can sit inside SysEx
        if (b === 0xF0) this.buf = [];
        this.buf.push(b);
        if (b === 0xF7) {
          const r = parseReply(Uint8Array.from(this.buf)); this.buf = [];
          if (r) { this.msgs.push(r); if (this.waiter) { const w = this.waiter; this.waiter = null; w(); } }
        }
      }
    });
  }
  async next(timeoutMs, signal) {
    if (signal?.aborted) throw Error('Cancelled device read.');
    if (!this.msgs.length) {
      await new Promise((resolve, reject) => {
        const finish = error => { clearTimeout(timer); this.waiter = null; signal?.removeEventListener('abort', abort); error ? reject(error) : resolve(); };
        const abort = () => finish(Error('Cancelled device read.'));
        const timer = setTimeout(() => finish(), timeoutMs);
        this.waiter = () => finish();
        signal?.addEventListener('abort', abort, {once: true});
        if (signal?.aborted) abort();
      });
    }
    return this.msgs.shift() || null;
  }
}

// files: [[path, Uint8Array], ...]. events: log(text), progress(sent, total), confirm() (the OP-1 shows its prompt).
// resume: an object the caller keeps between attempts with the same files. push() records where it is in it; the
// next push() with it continues in the middle of the file it stopped in, if the OP-1 still has that file open (it
// wasn't switched off). Otherwise it starts over. Every file is still checked by its CRC at the end, and all of them
// again before anything is installed.
// check(inventory): called before anything is sent with what the OP-1 has installed ({records, off, offBoot}, see
// readInventory) or null (a build without the inventory); it may throw to stop the push with nothing changed.
// kennel only (HELLO capability, see planPlugins): deletes = plugin file paths to remove, off = the new switched-off
// list. All of it is applied at the restart, after T1. Without files and deletes the OP-1 just restarts (RESTART).
// Resolves when the OP-1 accepted COMMIT (it then restarts and applies). Throws on refusal, cancel or silence.
export async function push(port, files, {window = 1, timeoutMs = 10000, tries = 8, dataTimeoutMs = 3000, dataTries = 5,
                                         resume = {}, log = () => {}, progress = () => {}, confirm = () => {}, check, signal,
                                         deletes = [], off} = {}) {
  for (const [p] of files) if (!pathOk(p)) throw Error(`${p}: not allowed (only OP1_vdk.ldr, content/ and plugin files)`);
  for (const p of deletes) if (!pluginPath(p)) throw Error(`${p}: only plugin files can be removed`);
  for (const [p] of files) {                                       // BEGIN must fit in one USB transfer too
    try { build(BEGIN, 0, Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 0, ...new TextEncoder().encode(p), 0])); }
    catch { throw Error(`${p}: path too long to send over USB MIDI`); }
  }
  const key = files.map(([p, d]) => `${p}:${d.length}:${crc32(d)}`).join('|') + JSON.stringify({deletes, off});
  if (check) await check(await readInventory(port, {timeoutMs, tries, log}));   // its own session, before ours
  const inbox = new Inbox(port);
  let seq = 0;
  const stop = () => { if (signal?.aborted) throw Error('Cancelled'); };
  // control steps touch the OP-1's file system (create, close, delete files) and may take seconds: long timeout
  async function ask(cmd, payload, ms = timeoutMs, n = tries) {
    for (let t = 0; t < n; t++) {
      stop();
      seq = (seq + 1) & 0x3FFF; const want = seq;
      port.send(build(cmd, want, payload));
      for (;;) {
        const r = await inbox.next(ms);
        if (!r) break;                                              // lost: send again with a new seq
        if (r[0] === cmd && r[1] === want) return [r[2], r[3], t];
      }
    }
    return null;
  }
  const silent = () => Error(NO_UPDATE_TEXT);
  const hello = await ask(HELLO);
  if (!hello) throw silent();
  log(`OP–1 update protocol ${rd32(hello[1])}`);
  if ((deletes.length || off !== undefined) && !(hello[1][4] & CAP_PLUGINS))
    throw Error('This OP–1 cannot apply plugin choices over USB. Install the downloaded firmware through the update menu.');
  const total = files.reduce((n, [, d]) => n + d.length, 0);
  const dataMsg = (data, off) => Uint8Array.from([...u32(off), ...data.subarray(off, off + Math.min(USB_MAX_DATA, data.length - off))]);
  let first = 0, acked = 0;
  if (resume.key === key && resume.open) {                          // continue inside the file we stopped in
    const [, data] = files[resume.index];
    const r = await ask(DATA, dataMsg(data, resume.acked), dataTimeoutMs, dataTries);
    if (r && (r[0] === OK || r[0] === 5)) {                         // the OP-1 still has it open: its byte count
      first = resume.index; acked = rd32(r[1]);
      log(`continuing ${files[first][0]} at ${acked} bytes`);
    }
  }
  if (!first && !acked) {                                           // start over: staging on the OP-1 cleared
    if (!await ask(ABORT)) throw silent();
    Object.assign(resume, {key, index: 0, open: false, acked: 0});
  }
  let done = files.slice(0, first).reduce((n, [, d]) => n + d.length, 0);
  for (let i = first; i < files.length; i++) {
    const [path, data] = files[i];
    if (!(i === first && acked)) {
      const r = await ask(BEGIN, Uint8Array.from([...u32(data.length), ...u32(crc32(data)), ...new TextEncoder().encode(path), 0]));
      if (!r) throw silent();
      // BEGIN is not idempotent: "state" after a resend means the first BEGIN opened the file (ABORT came first)
      if (r[0] !== OK && !(r[0] === E_STATE && r[2])) throw Error(`${path}: refused (${statusText(r[0])})`);
      acked = 0;
    }
    Object.assign(resume, {index: i, open: true, acked});
    let next = acked, quiet = 0; const inflight = new Map();
    while (acked < data.length) {
      while (next < data.length && inflight.size < window) {
        stop();
        seq = (seq + 1) & 0x3FFF;
        port.send(build(DATA, seq, dataMsg(data, next)));
        inflight.set(seq, next); next += Math.min(USB_MAX_DATA, data.length - next);
      }
      const r = await inbox.next(dataTimeoutMs);
      if (!r) {                                                     // lost: resend everything not confirmed
        if (++quiet >= dataTries) throw Error('The OP–1 stopped answering. Check the USB cable, then press Send again to continue.');
        inflight.clear(); next = acked; continue;
      }
      quiet = 0;
      if (r[0] !== DATA || !inflight.has(r[1])) continue;           // stale reply from before a resync
      inflight.delete(r[1]);
      if (r[2] !== OK && r[2] !== 5) throw Error(`${path}: data refused (${statusText(r[2])})`);
      const written = rd32(r[3]);
      if (r[2] === 5) { inflight.clear(); next = written; }         // gap (dropped message): resend from there
      acked = Math.max(acked, written);
      resume.acked = acked;
      progress(done + acked, total);
    }
    const end = await ask(END);
    if (!end) throw Error('The OP–1 stopped answering. Check the USB cable, then press Send again.');
    resume.open = false; resume.index = i + 1;
    if (end[0] !== OK) { resume.key = null; throw Error(`${path}: refused at the end (${statusText(end[0])})`); }
    done += data.length; acked = 0;
    log(`${path}: sent (${data.length} bytes)`);
  }
  let final = ask, cmd = COMMIT;
  if (deletes.length || off) {                                     // kennel: removals and the switched-off list
    const s = session(port, {timeoutMs, tries, log});               // (from here on its inbox gets the replies)
    if (!(await s.hello()).plugins) throw Error('This OP–1 can only take a full update. Send the whole firmware instead.');
    for (const p of deletes) {
      stop();
      const r = await s.ask(DELETE, Uint8Array.from([...new TextEncoder().encode(p), 0]));
      if (r[2] !== OK) { resume.key = null; throw Error(`${p}: removing refused (${statusText(r[2])})`); }
      log(`${p}: removed at the restart`);
    }
    if (off) { await s.setOff(off); log(`switched off: ${off.length ? off.join(', ') : 'nothing'}`); }
    final = async c => { const r = await s.ask(c); return [r[2], r[3]]; };
  }
  if (!files.length && !deletes.length) cmd = RESTART;              // nothing staged: only the restart
  log('confirm on the OP-1: T1 restart, T2 cancel');
  let asked = false;
  for (;;) {
    const r = await final(cmd);
    if (!r) throw silent();
    if (r[0] === OK) { resume.key = null; return; }
    if (r[0] === E_STATE && asked) { resume.key = null; throw Error(off !== undefined ? 'Cancelled on the OP–1. File installation was cancelled; plugin on/off choices are already saved for the next restart.' : 'Cancelled on the OP–1. No file changes were installed.'); }
    if (r[0] !== WAIT_KEY) { resume.key = null; throw Error(`The OP–1 refused the update (${statusText(r[0])})`); }
    if (!asked) { asked = true; confirm(); }
    await new Promise(r => setTimeout(r, 300));
  }
}

// Web MIDI: the OP-1's input and output ports as a protocol port. Needs a SysEx grant.
// debug: log every message to the console (the page turns it on with ?debug in the URL)
export async function openWebMidi(nav = globalThis.navigator, debug = false, {signal} = {}) {
  const cancelled = () => Error('Cancelled connection. Nothing has been sent.');
  const wait = promise => !signal ? promise : new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(cancelled()); };
    if (signal.aborted) { Promise.resolve(promise).catch(() => {}); reject(cancelled()); return; }
    signal.addEventListener('abort', abort, {once: true});
    Promise.resolve(promise).then(value => { signal.removeEventListener('abort', abort); if (signal.aborted) reject(cancelled()); else resolve(value); },
      error => { signal.removeEventListener('abort', abort); reject(error); });
  });
  if (!nav?.requestMIDIAccess) throw Error("This browser can't talk to MIDI devices. Use Chrome, Edge or Firefox on a computer, or install the downloaded firmware as usual.");
  let access;
  try { access = await wait(nav.requestMIDIAccess({sysex: true})); }
  catch { if (signal?.aborted) throw cancelled(); throw Error('MIDI access was blocked. Allow it in the site settings, or install the downloaded firmware as usual.'); }
  const find = ports => [...ports.values()].find(p => p.state !== 'disconnected' && /op-?1/i.test(p.name || ''));
  const output = find(access.outputs), input = find(access.inputs);
  if (!output || !input) {
    const error = Error('No OP–1 found. Connect it by USB and try again.');
    error.hint = 'If you just confirmed an update, wait for the tape screen. If it is already connected, unplug the USB cable and plug it back in.';
    throw error;
  }
  // Open both ports and start listening before the first message: setting onmidimessage opens the input
  // asynchronously, and the OP-1's reply to HELLO can arrive before it is open (then each try waits for its timeout).
  let cb = null; const early = [];
  const hex = d => [...d].slice(0, 16).map(b => b.toString(16).padStart(2, '0')).join(' ');
  const receive = e => { if (debug && e.data[0] !== 0xF8) console.log('op1push in', hex(e.data)); if (cb) cb(e.data); else early.push(e.data); };
  input.onmidimessage = receive;
  try { await wait(Promise.all([input.open(), output.open()])); }
  catch (error) { if (input.onmidimessage === receive) input.onmidimessage = null; throw error; }
  return {
    name: output.name,
    watchConnection: f => {
      const changed = () => f(input.state !== 'disconnected' && output.state !== 'disconnected');
      access.addEventListener('statechange', changed);
      return () => access.removeEventListener('statechange', changed);
    },
    send: bytes => { if (debug) console.log('op1push out', hex(bytes), bytes.length); output.send(bytes); },
    onSysex: f => { cb = f; early.splice(0).forEach(f); },
    close: () => { if (input.onmidimessage === receive) input.onmidimessage = null; }
  };
}

// ---- Inventory (kennel firmware, kennel docs/inventory.md): what is on the OP-1 and what its boot decided ----
// LIST pages through a text the OP-1 builds once per boot; OFF_GET / OFF_SET read and write the switched-off list
// ("kennel.off", applied at the next boot). HELLO's byte 4 says whether the firmware has them: stock 2.x devupd
// builds answer with 4 bytes, and then list() / getOff() return null and setOff() returns false.
export const LIST = 7, OFF_GET = 8, OFF_SET = 9, DELETE = 10, RESTART = 11, CAP_INVENTORY = 1, CAP_PLUGINS = 2, OFF_MAX = 1023;
const OFF_CHUNK = 64;
const E_OFFSET = 5;
// the LIST text -> {core: {start, len, crc} or null, records: [...]}; the header's core field: CRC of the running
// core's code and constants (compare ldrRangeCrc of a build's OP1_vdk.ldr)
export function parseInventory(text) {
  const lines = text.split('\n'), head = lines[0].split('\t');
  if (head[0] !== 'kennel-inventory 1') throw Error('Unknown inventory format from the OP–1');
  const c = (head.find(f => f.startsWith('core ')) || '').split(' ');
  const core = c.length === 4 ? {start: parseInt(c[1], 16), len: parseInt(c[2], 16), crc: parseInt(c[3], 16) >>> 0} : null;
  const pc = (head.find(f => f.startsWith('presets ')) || '').split(' ');   // 'presets N cap C' (newer kennel cores)
  const presets = pc.length === 4 && pc[2] === 'cap' ? {count: parseInt(pc[1], 10), cap: parseInt(pc[3], 10)} : null;
  return {presets, core: core && core.len ? core : null, records: lines.slice(1).filter(l => l).map(l => {
    const [kind, name, source, path, version, author, size, crc, state, claims, reason] = l.split('\t');
    return {kind, name, source, path, version, author, size: +size, crc: parseInt(crc, 16) >>> 0, state, reason: reason || '',
            claims: (claims ? claims.split(',') : []).map(c => ({name: c.slice(1), state: {'+': 'won', '!': 'lost', '~': 'none'}[c[0]] || 'none'}))};
  })};
}
// a protocol session on a port: one message in flight, every reply matched by command and sequence number
export function session(port, {timeoutMs = 3000, tries = 5, log = () => {}, signal} = {}) {
  const inbox = new Inbox(port);
  let seq = 0, hello = null;
  async function ask(cmd, payload) {
    for (let t = 0; t < tries; t++) {
      if (signal?.aborted) throw Error('Cancelled device read.');
      seq = (seq + 1) & 0x3FFF; const want = seq;
      port.send(build(cmd, want, payload));
      for (;;) {
        const r = await inbox.next(timeoutMs, signal);
        if (!r) break;
        if (r[0] === cmd && r[1] === want) return r;
      }
    }
    throw Error(NO_UPDATE_TEXT);
  }
  const s = {
    ask,
    async hello() {                                                // {version, inventory, plugins}
      if (!hello) {
        const r = await ask(HELLO), caps = r[3].length > 4 ? r[3][4] : 0;
        hello = {version: rd32(r[3]), inventory: !!(caps & CAP_INVENTORY), plugins: !!(caps & CAP_PLUGINS)};
        log(`OP–1 update protocol ${hello.version}${hello.inventory ? ', inventory' : ''}`);
      }
      return hello;
    },
    async list() {                                                 // [{kind, name, source, path, ..., claims}] or null
      return (await s.inventory())?.records ?? null;
    },
    async inventory() {                                            // {core, records} or null
      if (!(await s.hello()).inventory) return null;
      const parts = []; let got = 0, total = Infinity;
      while (got < total) {
        const r = await ask(LIST, Uint8Array.from(u32(got)));
        if (r[2] !== OK) throw Error(`The OP–1 refused the inventory request (${statusText(r[2])})`);
        total = rd32(r[3]);
        const chunk = r[3].subarray(4);
        if (!chunk.length && got < total) throw Error('Inventory reply without data');
        parts.push(chunk); got += chunk.length;
      }
      const all = new Uint8Array(got); let o = 0;
      for (const p of parts) { all.set(p, o); o += p.length; }
      return parseInventory(new TextDecoder().decode(all));
    },
    async getOff({atBoot = false} = {}) {                          // names switched off (stored, or in effect), or null
      if (!(await s.hello()).inventory) return null;
      let text = '', total = Infinity;
      while (text.length < total) {
        const r = await ask(OFF_GET, Uint8Array.from([atBoot ? 1 : 0, text.length & 0xFF, text.length >> 8]));
        if (r[2] !== OK) throw Error(`Reading the switched-off list failed (${statusText(r[2])})`);
        total = rd32(r[3]);
        const chunk = r[3].subarray(4);
        if (!chunk.length && text.length < total) throw Error('Switched-off list reply without data');
        text += new TextDecoder().decode(chunk);
      }
      return text.split(',').filter(n => n);
    },
    async setOff(names) {                                          // store the list (next boot); false: not supported
      const v = names.join(',');
      if (names.some(n => !/^[A-Za-z0-9 ._:-]+$/.test(n))) throw Error('A name has characters the OP–1 does not allow');
      if (v.length > OFF_MAX) throw Error(`The switched-off list is longer than ${OFF_MAX} characters`);
      if (!(await s.hello()).inventory) return false;
      const bytes = new TextEncoder().encode(v);
      let at = 0;
      do {
        const n = Math.min(OFF_CHUNK, bytes.length - at);
        const r = await ask(OFF_SET, Uint8Array.from([at & 0xFF, at >> 8, bytes.length & 0xFF, bytes.length >> 8, ...bytes.subarray(at, at + n)]));
        const have = r[3].length >= 2 ? r[3][0] | r[3][1] << 8 : 0;
        if (r[2] === OK) at += n;
        else if (r[2] === E_OFFSET) at = have;                     // a reply was lost: the OP-1 says where it is
        else throw Error(`Storing the switched-off list failed (${statusText(r[2])})`);
      } while (at < bytes.length);
      const back = await s.getOff();                               // read back: the stored list is what we sent
      if (back.join(',') !== names.filter(n => n).join(',')) throw Error('The OP–1 stored a different switched-off list');
      return true;
    }
  };
  return s;
}
// everything the page needs from a kennel OP-1 in one session: {records, core, plugins, off, offBoot}, or null without
// the inventory. plugins: the OP-1 takes single plugin files (DELETE, RESTART, plugins/ paths)
export async function readInventory(port, opts) {
  const s = session(port, opts);
  const inv = await s.inventory();
  if (!inv) return null;
  return {...inv, plugins: (await s.hello()).plugins, off: await s.getOff(), offBoot: await s.getOff({atBoot: true})};
}
export const list = (port, opts) => session(port, opts).list();
export const getOff = (port, opts) => session(port, opts).getOff(opts);
export const setOff = (port, names, opts) => session(port, opts).setOff(names);

// ---- Single plugin files (kennel, HELLO capability 2): what to send, delete and switch off ----
const KINDS = {1: 'synth', 2: 'fx', 3: 'feature'};
// what a .knl or .op1p file says: {name, kind, crc (the CRC it carries, as LIST reports it), claims, author, version}
export function pluginInfo(path, d) {
  const id = path.split('/').pop().replace(/\.(knl|op1p)$/i, '');
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength), cstr = (o, max) => {
    let e = o; while (e < Math.min(d.length, o + max) && d[e]) e++;
    return new TextDecoder().decode(d.subarray(o, e));
  };
  if (path.endsWith('.op1p')) {                                    // trailer: magic, bin_off, bin_len, crc32
    const t = d.length - 16, bin = dv.getUint32(t + 4, true);
    return {name: id, savedName: cstr(bin + 16, 16), kind: dv.getUint32(bin + 12, true) === 1 ? 'fx' : 'synth', crc: dv.getUint32(t + 12, true),
            claims: [], claimsKnown: false, author: '', version: '', size: d.length};
  }
  let h = 0;                                                       // .knl: header after the screen SVG and its NUL
  if (d[0] === 0x3C) { while (h < d.length && d[h]) h++; h = (h + 4) & ~3; }
  if (cstr(h, 4) !== 'KNPL') throw Error(`${path}: not a kennel plugin file`);
  const info = {name: id, savedName: cstr(h + 20, 16), kind: KINDS[d[h + 18]] || '-', crc: dv.getUint32(h + 12, true),
                claims: [], claimsKnown: false, author: '', version: '', size: d.length};
  for (let e = dv.getUint32(h + 140, true); e && e + 4 <= d.length;) {   // extension table: tag, length, bytes
    const tag = dv.getUint16(e, true), n = dv.getUint16(e + 2, true);
    if (!tag) break;
    const v = d.subarray(e + 4, e + 4 + n);
    if (tag === 1) { info.claims = new TextDecoder().decode(v).split('\0').filter(c => c); info.claimsKnown = true; }
    if (tag === 2) info.author = cstr(e + 4, n);
    if (tag === 3) info.version = cstr(e + 4, n);
    e += 4 + ((n + 3) & ~3);
  }
  return info;
}
// ---- Your own plugin files (BYOP): the loader's checks (kennel kn_load.c kn_parse, plugload/op1p_load.c op1p_parse)
// on the page, so a file the OP-1 would skip at boot is refused before it is sent ----
export const PLUGIN_API = 1;                                       // OP1_PLUGIN_API, synth_sdk/op1_plugin.h (= OP1P_API)
export const PLUGIN_MAX = 0x80000;                                // kn_boot.c KN_FILE_MAX: loader limit, not transport limit
const crcSkipping = (d, at) => { const c = d.slice(); c.fill(0, at, at + 4); return crc32(c); };
// fileName, bytes -> {path: plugins/<type name>.knl|.op1p, info (pluginInfo)}; throws an Error that says what's wrong
export function checkPlugin(fileName, d) {
  const ext = /\.op1p$/i.test(fileName) ? 'op1p' : /\.knl$/i.test(fileName) ? 'knl' : null;
  const bad = why => Error(`${fileName}: ${why}`);
  if (!ext) throw bad('not a plugin file (.knl or .op1p)');
  if (d.length < 16 || (ext === 'knl' && d.length % 4)) throw bad('the file is cut short or damaged');   // .knl is padded, op1r's .op1p isn't
  if (d.length > PLUGIN_MAX) throw bad('too big to load (512 KB at most)');
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  let name, svgEnd = 0;
  try {
    if (ext === 'op1p') {
      const t = d.length - 16, binOff = dv.getUint32(t + 4, true), binLen = dv.getUint32(t + 8, true);
      if (dv.getUint32(t, true) !== 0x5431504F) throw bad('not an op1r plugin file');
      if (binOff % 4 || binOff > t || binLen > t - binOff || binLen < 76) throw bad('the file is cut short or damaged');
      if (crc32(d.subarray(binOff, binOff + binLen)) !== dv.getUint32(t + 12, true)) throw bad('damaged (CRC mismatch)');
      if (dv.getUint32(binOff, true) !== 0x5031504F) throw bad('not an op1r plugin file');
      if (dv.getUint32(binOff + 4, true) !== 1 || dv.getUint32(binOff + 8, true) !== PLUGIN_API) throw bad('built for a different core');
      if (dv.getUint32(binOff + 12, true) > 1) throw bad('not a synth or an effect');
      name = new TextDecoder().decode(d.subarray(binOff + 16, binOff + 32)).replace(/\0[\s\S]*$/, '');
      if (!/^[a-z0-9 _-]{1,15}$/.test(name)) throw bad('the plugin name is invalid');
      while (svgEnd < binOff && d[svgEnd]) svgEnd++;
    } else {
      let h = 0;
      if (d[0] === 0x3C) { while (h < d.length && d[h]) h++; svgEnd = h; h = (h + 4) & ~3; }
      if (h + 144 > d.length || new TextDecoder().decode(d.subarray(h, h + 4)) !== 'KNPL') throw bad('not a kennel plugin file');
      if (dv.getUint16(h + 4, true) !== 1) throw bad('plugin format not supported');
      if (dv.getUint16(h + 6, true) < 144 || h + dv.getUint16(h + 6, true) > d.length) throw bad('the file is cut short or damaged');
      if (dv.getUint32(h + 8, true) !== d.length) throw bad('the file is cut short or damaged');
      if (crcSkipping(d, h + 12) !== dv.getUint32(h + 12, true)) throw bad('damaged (CRC mismatch)');
      if (dv.getUint16(h + 16, true) !== PLUGIN_API) throw bad('built for a different core');
      if (d[h + 18] < 1 || d[h + 18] > 3) throw bad('not a synth, an effect or a feature');
      if (d[h + 19] > 31) throw bad('invalid header (order)');
      const nm = d.subarray(h + 20, h + 36), len = nm.indexOf(0);
      if (len < 1 || nm.subarray(0, len).some(c => c < 0x20 || c > 0x7E)) throw bad('the plugin name is invalid');
      name = new TextDecoder().decode(nm.subarray(0, len));
    }
  } catch (e) {
    if (e instanceof RangeError) throw bad('the file is cut short or damaged');
    throw e;
  }
  // R246's SVG parser hangs the boot on numbers with more than 4 decimals (the workshop builder refuses them too)
  if (svgEnd && /\d\.\d{5,}/.test(new TextDecoder().decode(d.subarray(0, svgEnd))))
    throw bad('its screen has numbers with more than 4 decimals, which stop the OP–1 at boot. Round them in the SVG');
  // kennel's naming rule (plugin-format.md "Names"): the id is the shown name with spaces as underscores, [a-z0-9_-],
  // at most 15 characters; the file is <id>.knl / .op1p
  const id = name === 'drum+' ? 'drumplus' : name.replace(/ /g, '_');
  if (!/^[a-z0-9_-]{1,15}$/.test(id)) throw bad(`its name "${name}" doesn't follow the plugin naming rule (lowercase letters, digits, spaces, - and _)`);
  return {path: `plugins/${id}.${ext}`, info: pluginInfo(`plugins/${id}.${ext}`, d)};
}

// CRC-32 of the bytes an OP1_vdk.ldr loads into start .. start + len, or null if its blocks don't cover all of them
export function ldrRangeCrc(ldr, start, len) {
  const out = new Uint8Array(len), have = new Uint8Array(len);
  const dv = new DataView(ldr.buffer, ldr.byteOffset, ldr.byteLength);
  for (let o = 0; o + 16 <= ldr.length;) {
    const flags = dv.getUint16(o, true), addr = dv.getUint32(o + 4, true), count = dv.getUint32(o + 8, true);
    o += 16;
    const fill = flags & 0x100;
    for (let a = Math.max(addr, start); a < Math.min(addr + count, start + len); a++) {
      out[a - start] = fill ? 0 : ldr[o + a - addr]; have[a - start] = 1;
    }
    if (!fill) o += count;
  }
  return have.every(b => b) ? crc32(out) : null;
}
// Compare only conventional numeric release versions. Unknown/prerelease labels are not ordered.
export function comparePluginVersions(a, b) {
  const parse = v => /^v?\d+(?:\.\d+){0,3}$/.test(v || '') ? v.replace(/^v/, '').split('.').map(Number) : null;
  const x = parse(a), y = parse(b);
  if (!x || !y || [...x, ...y].some(n => !Number.isSafeInteger(n))) return null;
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0) ? -1 : 1;
  }
  return 0;
}
// The plan for a kennel OP-1 whose core matches the build: inv from readInventory, wanted = the build's plugin files
// ([[path, bytes]]). Files with the same path and CRC stay; changed or new ones are sent; content/ plugin files the
// build no longer has are removed (plugins/ files the user added by hand stay). Claims: every plugin that will run
// is checked; where two want the same page, view or key combo, one keeps it (winners[claim], else the one that has
// it now, else a built-in, else the first by name) and the others are switched off.
// Your own files (BYOP, checkPlugin): own = [[plugins/ path, bytes]]. They go in with the build's files; one with the
// same name as a build file or a file on the OP-1 replaces it (that one is left out or removed: the loader would skip
// the second file with a name), one named like a built-in replaces the built-in (replaces = what it takes over).
// keepContent: send only own files, keep everything else on the OP-1 (no build to compare with). drop: plugins/
// files on the OP-1 the user chose to remove. Rows the user may remove (plugins/ files that stay) get removable.
// -> {send, deletes, off, offChanged, conflicts: [{claim, names, winner}], entries, removed, changed}
export function planPlugins(inv, wanted, {winners = {}, own = [], drop = [], keepContent = false, metadata = {}, builtins, forceOn = [], forceOff = []} = {}) {
  const ownNames = new Set(own.map(([p, d]) => pluginInfo(p, d).name)), ownPaths = new Set(own.map(([p]) => p));
  const installedOwn = new Set((inv.records || []).filter(r => r.path?.startsWith('plugins/') && !drop.includes(r.path)).map(r => r.name));
  const replaced = new Map();                                      // own name -> what it takes over
  wanted = [...wanted.filter(([p, d]) => {
    const n = pluginInfo(p, d).name;
    if (ownNames.has(n) || installedOwn.has(n)) { replaced.set(n, 'the workshop’s ' + n); return false; }
    return true;
  }), ...own];
  const info = new Map(wanted.map(([p, d]) => [p, pluginInfo(p, d)]));
  inv = {...inv, off: inv.off || []};
  const files = inv.records.filter(r => r.source !== 'builtin' && r.path);
  const byPath = new Map(files.map(r => [r.path, r]));
  const send = wanted.filter(([p]) => !(byPath.get(p) && byPath.get(p).crc === info.get(p).crc && byPath.get(p).state !== 'failed'));
  const removed = files.filter(r => pluginPath(r.path) && !info.has(r.path) && (
    (r.path.startsWith('content/') && !keepContent) || ownNames.has(r.name) || drop.includes(r.path)));
  for (const r of removed) if (ownNames.has(r.name) && !replaced.has(r.name)) replaced.set(r.name, r.path);
  for (const r of inv.records) if (r.source === 'builtin' && ownNames.has(r.name)) replaced.set(r.name, 'the built-in ' + r.name);
  const entries = [];
  for (const [p] of wanted) {
    const i = info.get(p), now = byPath.get(p), previous = now || inv.records.find(r => r.name === i.name);
    if (!ownPaths.has(p)) {
      const m = metadata[i.name];
      if (m && (!m.path || m.path === p)) {
        i.claims = m.claims ?? i.claims; i.claimsKnown = m.claimsKnown ?? i.claimsKnown;
        i.priority = m.priority ?? null;
      }
    }
    entries.push({...i, path: p, source: ownPaths.has(p) ? 'own' : p.endsWith('.op1p') ? 'op1p' : 'knl',
                  action: !now ? 'install' : now.crc === i.crc ? 'keep' : 'update', was: previous || null,
                  versionOrder: previous ? comparePluginVersions(i.version, previous.version) : null,
                  replaces: ownPaths.has(p) ? replaced.get(i.name) || null : null,
                  restoration: !ownPaths.has(p) && files.some(r => r.path.startsWith('plugins/') && r.name === i.name && drop.includes(r.path)),
                  downgrade: !!previous && (previous.path !== p || previous.crc !== i.crc) && comparePluginVersions(i.version, previous.version) === -1});
  }
  // Older inventory cannot prove an explicit empty declaration for a retained file.
  for (const r of files) if (!info.has(r.path) && !removed.includes(r))
    entries.push({...r, claimsKnown: r.source === 'builtin' || !!r.claims?.length, claims: (r.claims || []).map(c => typeof c === 'string' ? c : c.name), action: 'keep', was: r, removable: r.path.startsWith('plugins/')});
  const names = new Set(entries.map(e => e.name));
  for (const r of builtins ?? inv.records.filter(r => r.source === 'builtin'))
    if (!names.has(r.name)) entries.push({...r, claimsKnown: Array.isArray(r.claims), claims: (r.claims || []).map(c => typeof c === 'string' ? c : c.name), action: 'built-in', was: r});
  const holder = new Map();                                        // who holds a claim on the OP-1 now
  for (const r of inv.records) for (const c of r.claims || []) if (c.state === 'won') holder.set(c.name, r.name);
  const off = new Set(inv.off);
  for (const r of inv.records) if (r.name && r.state === 'off' && entries.some(e => e.name === r.name && (e.path || null) === (r.path || null))) off.add(r.name);
  for (const [p] of wanted) off.delete(info.get(p).name);          // chosen in this build: on
  for (const name of forceOn) off.delete(name);
  for (const name of forceOff) off.add(name);
  // Do not retain stale off names for plugins being deleted.
  for (const name of [...off]) if (!entries.some(e => e.name === name)) off.delete(name);
  const resolution = resolveConflicts(entries, {winners, off: [...off], holder: Object.fromEntries(holder)});
  const offChanged = resolution.off.join(',') !== [...inv.off].sort().join(',');
  const restartNeeded = (Array.isArray(inv.offBoot) && resolution.off.join(',') !== [...inv.offBoot].sort().join(',')) ||
    resolution.entries.some(e => e.was && ['off', 'skipped', 'failed'].includes(e.was.state) && e.on);
  return {...resolution, initialOff: [...off], send, deletes: removed.map(r => r.path), offChanged, restartNeeded, removed,
          changed: !!(send.length || removed.length || offChanged || restartNeeded)};
}

// A new core supplies its own built-ins. Installed file plugins survive unless the build replaces/removes them.
export function planFullUpdate(inv, wanted, opts = {}) {
  return planPlugins(inv || {records: [], off: []}, wanted.filter(([p]) => pluginPath(p)),
    {...opts, builtins: opts.builtins || []});
}
export function assertResolvedPlan(plan) {
  if (!plan.resolved) throw Error(plan.errors?.[0] || 'Choose which plugins to keep before sending.');
  return plan;
}
