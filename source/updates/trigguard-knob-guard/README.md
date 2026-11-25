# Trigger guard: guard the encoder pushes too (source update for Hundekraft 3.3.2)

This is a maintainer source patch, not an installable plugin or firmware file. It changes `plugins/trigguard` and adds a
host test. The live Workshop changes only once you rebuild and publish it.

## Exact base

The published corresponding source:

https://github.com/Hundekraft/op1-workshop/blob/main/source/hundekraft-3.3.2-source.tar.gz

Expected archive SHA-256: `eabeb668bc577e10633400ada35ff5ac8be6ef1318796c0318f03a878990a97f`

## Apply

From the extracted `hundekraft-3.3.2-source` directory:

```sh
git apply --check /path/to/trigguard-knob-guard-hundekraft-3.3.2-update.patch
git apply /path/to/trigguard-knob-guard-hundekraft-3.3.2-update.patch
```

`UPDATE.json` lists the three files' hashes before and after.

## What a user sees

With a worn encoder, one push of a knob sometimes registers as two. On an engine whose press switches a page 2
(`OP1_PRESS_PAGE`), the page then seems not to switch, or switches back. In our case orange did it most, and every
knob now and then.

## Evidence

A probe engine took every encoder push through its `engine_input` hook and timed each down and up with `CYCLES`. One
press of orange:

| Event | ms since the event before |
| --- | --- |
| down | (first) |
| up | 0.2 |
| down | 0.3 |
| up | 88.2 |

That's contact chatter as the switch closes, under a millisecond. It varies from press to press.

## Why

The core flips an engine's page 2 on every encoder down (`dispatcher.c`, `op1_eng_page[...] ^= 1`), so one chatter
flips the page twice. The trigger guard handles exactly this for the note keys, but lets the encoder pushes
(`0x3B`–`0x3E`) through untouched.

## Changes

1. The four encoder pushes become guarded keys 25–28, after the 24 note keys.
2. They follow the guard's existing rule with the release held back: a release, then a press of the same knob inside
   the window, drops both. A page flips on the down, so holding the up for the window costs nothing you can feel.
3. Two new settings: **KNOB GUARD** (`knobs`, on by default) and **KNOB MS** (`kms`, 1–60 ms, 15 by default). The
   chatter measured is under 1 ms; a deliberate second push is over 100 ms.
4. **WINDOWS ALL** and **HOLD RELEASE** stay the note keys' only. Everything for the note keys is unchanged.
5. Dropped pushes count in their own `kg_dropped`, next to `tg_dropped`.
6. `plugin.json`: version 2, the two settings, and the TRIG. GUARD help mentions KNOB GUARD.

## Checks

1. **Host test** `plugins/trigguard/test/knob_guard_test.c` (build line at its top, from `ext/kennel/synth_sdk`),
   nine cases, all passing on the patched 3.3.2 source:
   1. The recorded orange chatter comes out as one push.
   2. A bounce on release is one push.
   3. Two deliberate pushes 150 ms apart are two.
   4. The held release goes out when the window has passed, not before.
   5. KNOB GUARD off passes the chatter as it came.
   6. A 1 ms window still catches the 0.3 ms chatter.
   7. The knobs keep their own rule with HOLD RELEASE off and WINDOWS ALL on.
   8. A note key's bounce is dropped as before.
   9. Other keys (T1) pass untouched.

   The source archive has no `harness/op1_host.h`; the test uses none of its mocks, so outside your tree a stand-in
   that only lets `op1_plugin.h` compile is enough.
2. **Blackfin:** the patched file compiles with the plugin flags (`bfin-elf-gcc -O2 -mcpu=bf524 ...`). Not a full
   Hundekraft build.
3. **On the device:** the same code, renamed `pushguard` and installed in place of the trigger guard, on 3.3.1
   (`trigguard.c` is identical in 3.3.1 and 3.3.2). With KNOB GUARD on, the probe counted one down and one up per press
   on every knob over dozens of presses. With it off, the doubled presses came back (orange: up 0.0 ms, down 0.1 ms).

## Licence

Same as the base source: GPL-3.0-or-later with the OP-1 firmware permission (its LICENSE and NOTICE).
