# OP-1 custom firmware patcher (R246)

## Web patcher

### [Patch OG OP1 Firmware in your browser](https://pcppcp.github.io/op1r/web/)

## What is this

Turns the original Teenage Engineering OP-1 firmware **R246** (`op1_246.op1`) into a custom firmware
with:

- custom synth engines with their own screens: **supersaw** (chainsaw), **fmbell** (bell), **granular**; they follow note velocity
  - **granular** plays the slot's sample: press **input** on a granular slot for "keyboard to sample" and record
    straight into it (the slot stays granular); **red press** = page 2, sample gain (0–4×)
- animated **lab screen for the stock iter synth**: gauges follow the knobs; bubbles, flame, falling dashes, voice
  dots and a note display react to the knobs and to what you play (graphic: `iter-lab.svg` from
  [op1repacker](https://github.com/op1hacks/op1repacker), MIT License, © 2016 op1hacks)
- boot screen shows `op1r <version>` under the TE logo
- custom FX with their own screens, usable on instruments **and as master FX** (mixer):
  - **tape**: vintage tape echo (time with tape-speed pitch bends, feedback up to self-oscillation, wow &
    flutter, age)
  - **clouds**: granular texture FX, a port of Mutable Instruments Clouds (position, size, pitch, density;
    encoder presses switch to a second page, red press freezes)
  - **reverb**: lush plate/hall reverb, a port of the Mutable Instruments Elements reverb (time, mix, diffusion,
    tone); its own screen (Kali: graphics by DAN76): blue shows 1–6 arms, green lights the mix scale, white brightens the skulls,
    red fades in the fire
- **quad** LFO: four LFOs in one slot, one row each: live output, frequency, amount, target and type
  - blue frequency (0.05–20 Hz) or tempo division, green amount (±100 %), white target (synth / drum engine knob,
    envelope A D S R, FX knob, or another LFO's frequency / amount / phase offset (F / A / O), shown as a
    symbol plus a dot in the knob / LFO colour; an LFO can't target itself), red type
  - types: **VOIC** (per voice), **FREE** (free-running), **GATE** (restarts at note-on), **MONO** (restarts at every
    note-on, shared), **SHOT** (one cycle after note-on, then holds), **RAND** (new random value per note)
  - press an encoder to select LFO 1–4
  - hold **Shift** for a table of all four LFOs: blue phase offset, green smoothing, white waveform (sine, triangle,
    ramp up/down, square, sample & hold), red sync to the OP-1 tempo (4/1 … 1/32, triplets)
- **euclid** sequencer, an extra sequencer next to the stock ones (pick it in the sequencer list), for synth and drums
  - 6 sequencer slots, each playing one note; **Shift + white** selects the slot, a note key on the euclid screen
    assigns its note, at the octave of that moment
  - blue steps, green pulses, white rotation, red start/stop (**Shift + red**: all slots); press an encoder for
    page 2: rate (1/4 … 1/32, triplets), gate, octave, **level** (note velocity, per slot)
  - the level is always shown as a red bar at the right border (triangle next to the dot while red is on page 2);
    a playing slot shows a red dot in the centre of its ring
  - **Shift + G A B C D E** (the last six white keys) mutes/unmutes slots 1–6, **Shift + D#** mutes/unmutes all;
    a muted slot keeps running (dimmed dots) but plays nothing; works from any screen
  - **Shift + C#** starts all slots at once, or stops them if any is running; works from any screen. Hold **REC**
    (tape armed) while starting and the tape starts recording with the first step
  - **4 patterns** per synth/drum: **Shift + F G A B** (the first four white keys) switches to pattern 1–4
    immediately, from any screen (also the tape view). A pattern holds the notes and settings of all slots incl. mutes;
    which slots are playing stays the same across patterns. The pattern number (P1–P4) is shown bottom left
  - on the euclid screen **lift / drop / scissors** copy / paste / cut the selected slot; with **Shift** the whole
    pattern
  - runs at the OP-1 tempo, plays polyphonically and sends MIDI; slot settings and mutes are saved (slots come
    back stopped)
- **count-in**: with the tape stopped, hold **REC** and press **metronome**: 4 / 8 / 16 metronome clicks, then
  recording starts on the next beat and runs until STOP (REC can be released). STOP or REC + metronome again cancels.
  Audible even with the metronome level at 0. The number of beats is set on the settings page: clock / card + **T3**
- **metronome accent**: beat 1 of each 4/4 bar clicks an octave higher (bars follow the tape; after a count-in
  they start where the recording started)
- **Oblique Strategies cards**: **Shift + help** shows a random card from Brian Eno and Peter Schmidt's *Oblique
  Strategies* in the clock's place; Shift + help again shows the clock, again a new card (the last view is
  remembered). T1 / T2 (monitor, USB out) work from both. Idea and card list from
  [ultralazr/op1-oblique-strategies](https://github.com/ultralazr/op1-oblique-strategies) (code MIT, Martin
  Mairinger; the card texts are Eno / Schmidt's and not covered by that licence)
- **resource monitor**: on the clock screen (**Shift + help**) press **T1** to switch to a page with CPU load,
  audio processing load (both with a peak marker), RAM and disk usage and the MIDI in / out buffer fill; T1 again
  goes back to the clock
- **USB track outs**: the OP-1 shows up as a 6-channel USB audio input (24 bit, 44.1 kHz): main L/R on channels
  1–2, tape tracks 1–4 on channels 3–6 (pre-fader, following tape speed and reverse). Clock screen + **T2**: the blue
  knob switches between **MASTER** (track channels silent, saves 5–7 % CPU; default) and **MASTER + TRACKS**; the
  setting is saved. Tested on Linux and macOS (Windows untested: if the OP-1 still shows 2 channels, remove the old
  OP-1 device entry once)
- **tape markers**: on the tape screen, press **red** to set a marker at the cursor, **Shift + red** press removes the
  marker under the cursor, **Shift + red** turn jumps to the next / previous marker (wraps around; works while
  playing). Up to 32 markers, shown as green ticks above the tracks, saved
- **MIDI CC control** (USB MIDI, on the OP-1's MIDI channel):
  - keys: CC = key code + 5 as in the OP-1's own CTRL mode, value ≥ 64 press / < 64 release: 5 help, 6 metronome,
    7–10 synth/drum/tape/mixer, 11–14 T1–T4, 15–17 lift/drop/scissors, 21–25 and 50–52 the keys 1–8,
    26 sequencer, 38/39/40 REC/PLAY/STOP, 41/42 left/right, 43 Shift, 48 mic/input, 49 COM
  - encoders: CC 102–105 = blue/green/white/red, relative (1–63 up, 65–127 down); works on every screen
  - mixer: CC 106–109 track 1–4 volume, 110–113 pan (64 = centre), 114–117 mute (≥ 64 = muted); CC 118 tape input
    level
- **dots** step sequencer (pick it in the sequencer list), for synth and drums
  - 6 slots playing at the same time, each up to 64 steps (4 rows of 16 dots); a step is empty (grey) or a
    trigger (green) with its own note and level
  - **blue** moves the cursor, **Shift + white** selects the slot, **red** starts / stops the slot,
    **Shift + red** (or **Shift + C#**) starts / stops all slots
  - **REC** switches recording on / off, **press red** chooses the type: **REC** (step: a note key puts a trigger at
    the cursor and moves on) or **LIVE** (while the slot runs, keys are recorded at the playhead, quantised, with the
    gate taken from how long the key is held; while stopped LIVE records at the cursor). Keys always sound
  - while recording: red sets the level of the trigger, **Shift + blue** erases while moving, **green** changes the
    length, **Shift + green** extends to the next full row and copies the row above
  - per-trigger parameters (white; press white to choose the parameter): gate (or tie), ratchet 1–8, chance,
    condition (play in loop a of b), nudge (±1/2 step), ratchet level ramp
  - **FX parameter locks**: FX1–FX4 in the same list set knob 1–4 (blue … red) of the instrument's FX for that
    step (`--` = off, the default, or 0–100 %); the knob returns to its own setting after the step's gate (TIE: at the
    slot's next trigger). **Press blue** while recording to put a **lock trigger** (no note, hollow square) on an
    empty step, again to remove it; a key on it adds a note
  - mutes (**Shift + G A B C D E**, D# all), 4 patterns (**Shift + F G A B**), lift / drop / scissors copy / paste /
    cut the slot (Shift: whole pattern), all saved
- **MIDI sync** (tempo sync = MIDI in): on MIDI START the stock pattern sequencer, dots and euclid restart so their
  first step falls on the master's downbeat, also right after a pause; notes then follow the external clock within
  about 1 ms
- hidden **OP-Z controller mode** in COM → CTRL, switched on by the SysEx `F0 00 20 76 00 01 03 F7`
  from the host (any MIDI tool that can send SysEx; `F0 00 20 76 00 01 00 F7` switches it off)

## Screens

Rendered on the PC from the same screen code that runs on the OP-1 (host harness in the synth SDK).

| Synth engines | |
|---|---|
| ![supersaw](docs/images/synth_supersaw.png) **supersaw** | ![fmbell](docs/images/synth_fmbell.png) **fmbell** |
| ![granular](docs/images/synth_granular.png) **granular** | ![iter lab](docs/images/synth_iterlab.png) **iter** (lab screen) |

| Effects | |
|---|---|
| ![tape](docs/images/fx_tape.png) **tape** echo | ![clouds](docs/images/fx_clouds.png) **clouds** |
| ![reverb](docs/images/fx_reverb.png) **reverb** | |

| LFO | Sequencer |
|---|---|
| ![quad LFO](docs/images/lfo_quad.png) **quad** LFO | ![euclid](docs/images/seq_euclid.png) **euclid** sequencer |
| ![dots](docs/images/seq_dots.png) **dots** sequencer (record mode: notes, lock triggers as hollow squares, a note with an FX lock) | |

| Resource monitor | |
|---|---|
| ![resource monitor](docs/images/sysmon.png) clock screen + **T1** (text in the OP-1 font on the device) | |

The repository contains no Teenage Engineering firmware. You provide the original update file, and the
patcher applies only the differences stored in `data/`. These are our code, our screen SVGs and small
byte edits.

## Usage

Requirements: Python 3.8 or newer, standard library only.

```sh
git clone https://github.com/pcppcp/op1r.git && cd op1r
python3 patch_op1.py /path/to/op1_246.op1            # -> /path/to/op1_246-custom.op1
python3 patch_op1.py /path/to/op1_246.op1 -o op1-custom.op1
python3 patch_op1.py --info                          # what the patch contains + checksums
```

The patcher:
1. Checks the input SHA-256 against the original R246 image and refuses anything else.
2. Unpacks it (CRC-32 → LZMA → tar).
3. Checks every file it touches, both before and after patching (SHA-256 per file).
4. Repacks deterministically: original tar order and metadata, op1repacker's LZMA settings.
5. Checks the result against the reference build's SHA-256.

If only the last step differs while the archive content matched, your Python has a different liblzma
version. The firmware content is still verified identical, and `--accept-recompressed` writes it anyway.

| | SHA-256 |
|---|---|
| input `op1_246.op1` (original R246) | `c5315218f825f143b415ca554516541898abee843d3a236df0b54c04e1fb13a9` |
| output (reference build) | `5b20c4e874597b68f9b4d67ecceab8546e4746b468173bb621909aeb1a0db559` (also `python3 patch_op1.py --info`) |

Install the result like any OP-1 update (bootloader update mode). The bootloader is not modified, so the
original `op1_246.op1` can always be flashed back. **Use at your own risk.**

Original firmware files (`*.op1`, `*.ldr`, unpacked trees) are git-ignored and must never be committed.

See [CHANGELOG.md](CHANGELOG.md) for what changed between versions.

## Maintainers: rebuilding the patch data

The patch data is generated from a custom firmware tree built with the synth SDK (`make_firmware.py`,
not part of this repository; needs the Blackfin toolchain):

```sh
python3 <sdk>/synth_sdk/make_firmware.py --opz --release          # builds <sdk>/op1_246_custom/
python3 build_patch.py /path/to/op1_246.op1 <sdk>/op1_246_custom  # regenerates data/ + reference image
```

`build_patch.py` diffs the custom tree against the original image:
- **Changed files** (`OP1_vdk.ldr`, `content/op1_factory.db`): stored as byte edits plus one insertion,
  the new code block.
- **New files** (our SVGs): stored whole.
- **New files identical to a stock file**, such as `fxgeneric.svg` (= `iter.svg`): recorded as `copy_of` and
  recreated from the user's image.

It then runs the patcher once. It writes the reference image (`<custom tree>-patched.op1`, or
`--reference <file>`) and its checksums to `data/manifest.json`, and checks that the reference unpacks to exactly the custom tree.
Flash-test the reference image before publishing a new patch, and commit `data/` together with the
updated output checksum in this README.
