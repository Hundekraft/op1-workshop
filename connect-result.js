// What the device card says after Connect my OP–1 / Review changes: one message per connection result.
// No browser dependencies (tools/firmware/qa/connect_result_js_test.mjs runs it in Node). The error codes come
// from op1push.js: 'no-midi', 'midi-denied', 'no-port' (no MIDI port named like the OP-1), 'no-reply' (+ error.cmd).
const HELLO = 1;                                                  // op1push.js HELLO: the first message of a session

export const MIDI_ASK = "Your browser will ask to use MIDI devices. Click Allow: that's how the update reaches the OP–1.";
export const NO_MIDI = "This browser can't talk to the OP–1. Open the page in Chrome or Edge on a computer, or install with a file.";
export const NO_ANSWER = "No OP–1 found. Check that it's switched on and not in disk mode or the boot menu. Use a cable that carries data, since some only charge. If the browser asked about MIDI, click Allow.";
export const NOT_HUNDEKRAFT = "Your OP–1 is connected but isn't running hundekraft 3 yet. Install it once with a file. After that, updates go over USB.";
export const RESTARTING = 'Your OP–1 may still be restarting. Wait for the tape screen, then press Try again.';
const WHY = "We can't share Teenage Engineering's firmware ourselves. Choose the file and everything still goes over USB. Nothing has been sent yet.";
export const NEW_CORE = "This update replaces the OP–1's firmware too, and the workshop needs your copy of op1_246.op1 to build it. " + WHY;
const version = label => label.replace(/^hundekraft /, '');
// the same with the versions named (installed: what the OP-1 runs, or null when it isn't a published release)
export const newCoreText = (installed, target) => installed
  ? `Your OP–1 has ${installed}. Updating to ${version(target)} replaces its firmware too, and the workshop needs your copy of op1_246.op1 to build it. ` + WHY
  : NEW_CORE;
// a new core the OP-1 takes as a patch of its own firmware file (core-route.js): no R246
export const patchText = (installed, target) => `Your OP–1 has ${installed}. Updating to ${version(target)} replaces its firmware too, and all of it goes over USB. Review the changes, then send.`;
export const READY = 'Pick your plugins, then send the update.';
// How long after an update was sent a silent or missing OP-1 still counts as restarting: the install wait (1.5 min for
// plugin files, 4 min with a core) ends at notBefore; up to 6 min more, about 10 min after T1 in all.
export const RESTART_GRACE_MS = 6 * 60 * 1000;
export const recentlySent = (notBefore, now = Date.now()) => notBefore > 0 && now < notBefore + RESTART_GRACE_MS;
const JUST_SENT = 'Just pressed T1 for an update? Wait for the tape screen, then connect again.';

// A connection failure as {kind, state, text, hint, retry, file, review}, or null when it isn't one (then the page
// shows the error as before). pending: an update was sent recently (recentlySent), so a silent OP-1 is most likely
// still restarting. retry: show Try again. file: the label of the button that opens the firmware file panel, or null.
// review: whether Review changes stays offered; false means the retry/file buttons are the primary actions.
export function connectionProblem(error, {pending = false} = {}) {
  const code = error?.code;
  if (code === 'no-midi' || code === 'midi-denied')
    return {kind: 'no-midi', state: "This browser can't talk to the OP–1", text: NO_MIDI, hint: '', retry: false, file: 'Use a firmware file instead', review: false};
  if (code !== 'no-port' && !(code === 'no-reply' && error.cmd === HELLO)) return null;
  if (pending) return {kind: 'restarting', state: 'Waiting for your OP–1', text: RESTARTING, hint: '', retry: true, file: null, review: true};
  // The OP-1's MIDI port is there, but nothing answers HELLO: stock R246, op1r or hundekraft 2.7 and older
  if (code === 'no-reply')
    return {kind: 'not-hundekraft', state: "OP–1 isn't running hundekraft 3 yet", text: NOT_HUNDEKRAFT, hint: JUST_SENT, retry: false, file: 'Build firmware file', review: false};
  return {kind: 'no-answer', state: 'No OP–1 found', text: NO_ANSWER, hint: JUST_SENT, retry: true, file: 'Use a firmware file instead', review: false};
}

// What a connected OP-1 runs, from its inventory (op1push.js readInventory; null: it answers the update but has no
// inventory). The inventory has no version string: the release label is named only when the running core is this
// release's (coreMatches). Count: plugin files on the OP-1 (records with a path), not the built-ins.
// newCore: Review changes will send a new core. installed: the release label of the running core (core-route.js
// runningRelease), or null. patch: the new core goes as a patch (core-route.js coreRoute), so no R246 is needed;
// otherwise needOriginal: the page asks for op1_246.op1 (haveFile: already chosen).
export function connectedText(inv, {label = 'hundekraft 3', installed = null, coreMatches = false, haveFile = false, patch = false} = {}) {
  if (!inv?.plugins) return {state: 'OP–1 found: an earlier hundekraft.', text: haveFile ? READY : NEW_CORE, newCore: true, needOriginal: !haveFile};
  const n = (inv.records || []).filter(r => r.path).length;
  const state = `OP–1 found: ${coreMatches ? label : installed || 'hundekraft 3'}, ${n} plugin${n === 1 ? '' : 's'}.`;
  if (coreMatches) return {state, text: READY, newCore: false, needOriginal: false};
  if (patch && installed) return {state, text: patchText(installed, label), newCore: true, needOriginal: false};
  return {state, text: haveFile ? READY : newCoreText(installed, label), newCore: true, needOriginal: !haveFile && !patch};
}
