// The workshop's front page: what's in a build, by category (index.html #catalog, app.js renderCatalog).
// Per item: name, a short line, who made it (by), a screen (img: card() from cards/, else img() from the manual), its manual section, and pick: the
// choice its tick sets ('synths:<id>' / 'effects:<id>' / 'utilities:<id>' in release.catalog, 'plugin:<id>' = an op1r
// plugin or kennel file choice, left out when unticked). Without pick, or with one the release catalog doesn't
// offer (built in on that base), it is always included. kennel: only on kennel (3.0) bases.
// Picks are kennel ids (plugin-format.md "Names"); pick2x is the frozen published 2.x catalog id where it differs.
// isNew: true is an explicit release badge, reserved for plugins added AFTER the initial 3.0 release.
// The initial 3.0 catalog is the baseline: no badges, regardless of a browser's saved selections.
// Remove the flag when a plugin is no longer being highlighted.
// Order inside a category: hundekraft first, then op1r, then the rest.
const HK = 'hundekraft', OP = 'op1r', MO = 'Musica Obscura · ultralazr', MI = 'Mutable Instruments';
const img = name => `manual/img/${name}.png`;
const card = name => `cards/${name}.png?v=3.0.1`;   // clean screens for the cards (run/cards/capture.py); img() where none exists yet
export const CATEGORIES = [
  {id: 'synths', label: 'Synths and drums', items: [
    {name: 'Wavetable', line: 'morphing waves, ladder filter', by: HK, img: card('wavetable'), manual: 'wavetable', pick: 'synths:wavetable'},
    {name: 'Taffy', line: 'phase distortion', by: HK, img: card('taffy'), manual: 'taffy', pick: 'synths:taffy'},
    {name: 'Pew', line: 'drawbar organ, rotary speaker', by: HK, img: card('pew'), manual: 'pew', pick: 'synths:pew'},
    {name: 'Elg', line: 'slow drones with a growl', by: HK, img: card('elg'), manual: 'elg', pick: 'synths:elg'},
    {name: 'EVA', line: 'an astronaut on the radio', by: HK, img: card('eva'), manual: 'eva', kennel: true, pick: 'plugin:eva'},
    {name: 'MBIRA', line: 'thumb piano', by: HK, img: card('mbira'), manual: 'mbira', kennel: true, pick: 'plugin:mbira'},
    {name: 'Oxbow', line: 'OB-style polysynth, normal OP-1 presets', by: `${HK}, after OberVave by zvenson`, img: card('oxbow'), imageAlt: 'OP-1 emulator screen: Oxbow playing a chord: wide blue horns, red birds, green bell and voice stars, with room below the fur.', kennelImg: 'cards/oxbow-kennel.png?v=05bcb48868c8', kennelImageAlt: "OP-1 emulator: Oxbow playing a chord with current wide artwork and voice stars.", manual: 'oxbow', kennel: true, pick: 'plugin:oxbow'},
    {name: 'SID', line: '8580-inspired chip synth', by: `${HK}, after cRSID by Hermit`, img: 'cards/sid.png?v=3.0-manual-20261018', imageAlt: 'OP-1 emulator screen: SID screen showing saw mode, Voices 49, Cutoff 97 and Res 25.', manual: 'sid', kennel: true, requiresChoice: true, pick: 'plugin:sid'},
    {name: 'Amp', line: 'live input, compressor, tone, drive and tuner', by: 'Hundekraft · workflow inspired by OP-1 Field', img: 'cards/amp.png?v=3.0.1', manual: 'amp', kennel: true, requiresChoice: true, isNew: true, pick: 'plugin:amp'},
    {name: 'Supersaw', line: 'detuned saw stack', by: OP, img: card('supersaw'), manual: 'supersaw', pick: 'plugin:supersaw'},
    {name: 'FM Bell', line: 'FM bells', by: OP, img: card('fmbell'), manual: 'fmbell', pick: 'plugin:fmbell'},
    {name: 'Granular', line: 'plays a sample as grains', by: OP, img: card('granular'), manual: 'granular', pick: 'plugin:granular'},
    {name: 'Aether', line: 'play pitch and volume by tilting', by: `${OP} · artwork by DAN76/Rackes`, img: card('aether'), kennelImg: 'cards/aether-kennel.png?v=b394840cb0a1', kennelImageAlt: "OP-1 emulator: Aether satellite dish and radio signals responding to a held note and tilt.", manual: 'aether', kennel: true, requiresChoice: true, pick: 'plugin:aether'},
    {name: 'Iter lab', line: 'the stock Iter, opened up', by: OP, img: card('iterlab'), manual: 'iterlab'},
    {name: 'Mixtur', line: 'subharmonic organ', by: MO, img: card('mixtur'), manual: 'mixtur', pick: 'plugin:mixtur'},
    {name: 'Arc', line: 'singing arc lamp, 1899', by: MO, img: card('arc'), manual: 'arc', pick: 'plugin:arc'},
    {name: 'drum+', line: 'per-pad envelopes and drive', by: OP, img: card('drumplus'), manual: 'drumplus', pick: 'plugin:drumplus'},
    {name: 'Gin', line: '24 drum sounds, A/B morph, four synth voices', by: 'SquareWave Studio · libpo32 by Eric Lewis · kits after CNTR RNDM', img: card('gin'), manual: 'gin', kennel: true, requiresChoice: true, pick: 'plugin:gin'}]},
  {id: 'effects', label: 'Effects', items: [
    {name: 'Washer', line: 'chorus, ensemble, flanger', by: HK, img: card('washer'), manual: 'washer', pick: 'effects:washer'},
    {name: 'Snowglobe', line: 'shimmer reverb with freeze', by: HK, img: card('snowglobe'), manual: 'snowglobe', pick: 'effects:snowglobe'},
    {name: 'STUTTER', line: 'stutter locked to the beat', by: HK, img: card('stutter'), manual: 'stutter', kennel: true, pick: 'plugin:stutter'},
    {name: 'HAIL', line: 'clouds of grains', by: `${HK}, after ${MI} Beads by Émilie Gillet`, img: card('hail'), manual: 'hail', kennel: true, pick: 'plugin:hail'},
    {name: 'Crush', line: 'bit depth, sample rate and drive', by: 'Maiko · kennel port by hundekraft', img: 'cards/crush.png?v=3.0-manual-20261018', imageAlt: 'OP-1 emulator screen: Crush screen showing Bits 6, Rate 8.0, Drive 6 and Mix 99.', manual: 'crush', kennel: true, requiresChoice: true, pick: 'plugin:crush'},
    {name: 'Warble', line: 'chorus, vibrato and tape wobble', by: 'Maiko · kennel port by hundekraft', img: 'cards/warble.png?v=3.0-manual-20261018', imageAlt: 'OP-1 emulator screen: Warble screen showing Rate 52, Depth 57, Tone 79 and Mix 49.', manual: 'warble', kennel: true, requiresChoice: true, pick: 'plugin:warble'},
    {name: 'Plate', line: 'damped plate reverb', by: 'Maiko · kennel port by hundekraft', img: 'cards/plate.png?v=3.0-manual-20261018', imageAlt: 'OP-1 emulator screen: Plate screen showing Decay 49, Tone 59, Pre 32 and Mix 30.', manual: 'plate', kennel: true, requiresChoice: true, pick: 'plugin:plate'},
    {name: 'Father', line: 'from a nearby room to distant ambience', by: `${HK} DSP · Father concept/visual reference by xylograph`, img: 'cards/father.png?v=3.0-manual-20261018', imageAlt: 'OP-1 emulator screen: Father room screen showing Distance 49, Gate, Color, a Mix bar and the small green person.', manual: 'father', kennel: true, requiresChoice: true, pick: 'plugin:father'},
    {name: 'Tape', line: 'tape echo', by: OP, img: card('tape'), manual: 'tape-fx', pick: 'plugin:tape'},
    {name: 'Clouds', line: 'granular textures', by: `${OP}, after ${MI} Clouds by Émilie Gillet`, img: card('clouds'), manual: 'clouds', pick: 'plugin:clouds'},
    {name: 'Reverb', line: 'plate and hall', by: `${OP}, after ${MI} Elements by Émilie Gillet · artwork by DAN76`, img: card('reverb'), kennelImg: 'cards/reverb-kennel.png?v=a876a3750de6', kennelImageAlt: "OP-1 emulator: Reverb skull and fire artwork with Time, Tone, Diffusion and Mix in knob order.", manual: 'reverb', pick: 'plugin:reverb'},
    {name: 'Palme', line: 'sympathetic strings', by: MO, img: card('palme'), manual: 'palme', pick: 'plugin:palme'},
    {name: 'In a room', line: 'a loop through a room', by: MO, img: card('in_a_room'), kennelImg: 'cards/in_a_room-kennel.png?v=edebca3f802f', kennelImageAlt: "OP-1 emulator: In a room before capture, showing Size, Shape, Erode and Mix.", manual: 'in-a-room', pick: 'plugin:in_a_room'}]},
  {id: 'play', label: 'Play and sequence', items: [
    {name: 'Randomiser', line: 'new sound variations, six steps back', by: 'Lewis-Clayton / pcppcp · native kennel port by hundekraft', img: 'cards/randomiser.png?v=3.0-randomiser-20261018', kennelImg: 'cards/randomiser-kennel.png?v=6ff9d9f58ddc', kennelImageAlt: "OP-1 emulator: Randomiser RANDOM panel over the Wavetable synth page.", manual: 'randomiser', kennel: true, requiresChoice: true, pick: 'plugin:randomiser'},
    {name: 'Chord mode', line: 'every key plays a chord', by: HK, img: card('chord'), manual: 'chord', pick: 'plugin:chord'},
    {name: 'Scale mode', line: 'keys snap to a scale', by: `${HK}, after Maiko`, img: card('scale'), manual: 'scale', pick: 'utilities:scale'},
    {name: 'MIDI sequencer', line: 'notes and CCs with the tape', by: OP, img: card('midiseq'), kennelImg: 'cards/midiseq-kennel.png?v=4bffb82d9c6c', kennelImageAlt: "OP-1 emulator: Empty MIDI Tape with four lanes, continuous separators, playhead and loop-off marker.", manual: 'midiseq', kennel: true, pick: 'plugin:midiseq'},
    {name: 'CC automation', line: 'CCs turn the synth’s knobs', by: OP, img: card('midicc'), manual: 'midicc', kennel: true, pick: 'plugin:midicc'},
    {name: 'Euclid', line: 'euclidean rhythms', by: OP, img: card('euclid'), manual: 'euclid', pick: 'plugin:euclid'},
    {name: 'Dots', line: 'draw notes, lock FX', by: OP, img: card('dots'), manual: 'dots', pick: 'plugin:dots'},
    {name: 'C64 arpeggiator', line: 'edit the pitch table and dwell time', by: HK, img: 'cards/c64arp.png?v=3.0-manual-20261018', kennelImg: 'cards/c64arp-kennel.png?v=76e1f6a4217b', kennelImageAlt: "OP-1 emulator: C64arp main page with Gate on orange instead of Run.", manual: 'c64arp', kennel: true, requiresChoice: true, pick: 'plugin:c64arp'},
    {name: 'Quad LFO', line: 'four LFOs', by: OP, img: card('quad'), manual: 'quad', pick: 'plugin:quad'},
    {name: 'Oracle', line: 'a sequencer from geomancy', by: MO, img: card('oracle'), manual: 'oracle', pick: 'plugin:oracle'},
    {name: 'Peal', line: 'English bell ringing', by: MO, img: card('peal'), manual: 'peal', pick: 'plugin:peal'}]},
  {id: 'tape', label: 'Tape and sampler', items: [
    {name: 'Four tapes', line: 'hold tape, press T1 to T4', by: `${HK}, after Maiko`, img: card('tapes'), manual: 'tapes', kennel: true, pick: 'plugin:tapes'},
    {name: 'Undo and tape edits', line: 'seven steps back, merge, bounce', by: `${HK}, after Maiko`, img: card('undo'), manual: 'undo', pick: 'utilities:undo'},
    {name: 'Sampler tools', line: 'zoom, tuner, fit to bars', by: `${HK}, after Maiko`, img: card('sampletools'), manual: 'sampletools', kennel: true, pick: 'plugin:sampletools'},
    {name: 'Sampler+', line: 'envelopes, filtering, loop crossfade and sync', by: OP, img: card('samplerplus'), kennelImg: 'cards/samplerplus-kennel.png?v=d0333c6f5fd9', kennelImageAlt: "OP-1 emulator: Sampler+ ACIDRONE waveform, forward mode, Crossfade, Pitch envelope, Sync and Drive.", manual: 'samplerplus', kennel: true, requiresChoice: true, pick: 'plugin:samplerplus'},
    {name: 'Markers', line: 'mark the tape, jump back', by: OP, img: card('markers'), manual: 'markers', pick: 'plugin:markers'},
    {name: 'Punch-in', line: 'record between two markers', by: OP, img: card('punch'), manual: 'punch', pick: 'plugin:punch'},
    {name: 'Count-in', line: '4, 8 or 16 beats before REC', by: OP, img: card('countin'), manual: 'count-in', pick: 'plugin:countin'},
    {name: 'Fast tape erase', line: 'clear a track in one go', by: OP, img: card('fasterase'), manual: 'erase', pick: 'plugin:fasterase'},
    {name: 'Sample editor', line: 'trim, fades, loop points', by: OP, img: card('sampedit'), kennelImg: 'cards/sampedit-kennel.png?v=4bef8a323867', kennelImageAlt: "OP-1 emulator: Synth sample editor with waveform, start/end markers and Trim, Zero, Norm and Rev.", manual: 'sampedit'}]},
  {id: 'system', label: 'System and storage', items: [
    {name: 'Lander', line: 'Original game · full firmware option', by: 'TE · OFF BY DEFAULT', img: 'cards/lander.png', imageAlt: 'OP-1 emulator: the original Lander (Choplifter) game with helicopter, terrain, score and fuel.', manual: 'lander', pick: 'core:lander', kennel: true, requiresChoice: true, defaultOn: false},
    {name: 'FILE and flash check', line: 'what uses your storage', by: `${HK}, after Maiko`, img: card('file'), manual: 'file', pick: 'utilities:file', pick2x: 'utilities:files'},
    {name: 'Name your sounds', line: 'up to 12 letters', by: `${HK}, after Maiko`, img: card('naming'), manual: 'naming', pick: 'utilities:naming'},
    {name: 'Safer recording', line: 'stops good flash being retired', by: HK, img: card('saferec'), manual: 'badblock', kennel: true},
    {name: 'Resource monitor', line: 'CPU, memory, disk', by: OP, img: card('monitor'), kennelImg: 'cards/monitor-kennel.png?v=70facdf48d2f', kennelImageAlt: "OP-1 emulator: Resource monitor showing the split audio bar and audio category detail.", manual: 'monitor', pick: 'plugin:sysmon'},
    {name: 'USB output', line: 'six channels of audio', by: OP, img: card('usbout'), manual: 'usb', pick: 'plugin:usbout'},
    {name: 'Oblique Strategies', line: 'Eno and Schmidt’s cards', by: `${OP}, cards by Brian Eno and Peter Schmidt`, img: card('oblique'), manual: 'oblique', pick: 'plugin:oblique'}]},
];
