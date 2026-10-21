# hundekraft 3.0.3 — OP-1 Firmware Workshop

Build your own Hundekraft 3.0.3 firmware for the original OP-1 at [the workshop](https://hundekraft.github.io/op1-workshop/).

A firmware configurator for the original Teenage Engineering OP-1. Supply the original R246 update, select synths, effects and tools, and build firmware locally in the browser. The kennel core loads individual plugin files; every build supports 300 user synth presets. The current collection contains 152 presets, filtered to each build's synths and active effects.

Current 3.0.3 includes native kennel ports of op1r features through version 40: Randomiser, sampler+, Aether and the latest DSP, editor and monitor refinements. The manual and workshop cards use current kennel emulator captures for those additions; unchanged pages can retain older captures. 

A normal update does not require Format drive. Factory reset clears user data; imported plugin files can survive it and a normal install. Connect the OP-1 and open Your plugins to review and remove an unwanted import. Back up before destructive recovery.

After installing 3.0 once through the boot menu, the workshop can send later updates over USB MIDI. Matching cores need only changed plugin files. Update OP–1 checks the release’s linked core fingerprint first. A mismatch automatically prepares and reviews a full USB MIDI firmware update from the selected original R246; matching cores retain build-free plugin management. The review identifies the scope before transfer. Own .knl/.op1p files up to 512 KB can be added, replaced or removed through a reviewed send plan. Catalog choices use localStorage; own file bytes and pending operations use IndexedDB, scoped to this browser, site address and base.

Firmware is never uploaded. Versioned patch assets and Pyodide are downloaded on first use. Original firmware input is not saved between sessions. Export/Import choices backs up catalog choices only, not plugin bytes.

The current release ID, source variant, package counts and hashes live in release.json and its referenced manifests. Configuration IDs retain their meaning. Build records identify the actual selected configuration and output filename. The firmware core, plugin blobs, runtime, manifests and frontend must be updated as one consistent release.

See [the manual](manual.html), [changelog](CHANGELOG.md) and [op1r credits](OP1R-README.md). Additional work builds on kennel, op1r, Musica Obscura by ultralazr, Maiko Pruett's tools, OberVave by zvenson, cRSID by Hermit and the credited Mutable Instruments ports by Émilie Gillet. Father’s concept and room-illustration reference are by [xylograph on Reddit](https://www.reddit.com/r/OP1users/comments/1x422ip/father_a_stereo_algorithmic_reverb_running_on_the/); kennel’s separate reverb DSP is by Hundekraft. Gin is by SquareWave Studio, with libpo32 by Eric Lewis and kits adapted from CNTR RNDM. Aether’s artwork is by DAN76/Rackes and Reverb’s by DAN76. See the [full credits](manual.html#credits) for sources and component attribution.

Independent project; not affiliated with Teenage Engineering. This targets the original OP-1, not the OP-1 field. No original/patched firmware, NAND images, OTP or device keys belong in a published source or web export. 

Manual links for3.0 use readable selection snapshots: `manual.html?version=3.0&without=oxbow,sid#father`. Excluded canonical plugin IDs are sorted and comma-separated; all-on selection needs only `version=3.0`. Plain `manual.html#father` opens the full manual. `view=all` carries the Show everything choice without removing the selection. Shared links are independent of saved browser choices; live Workshop changes still refresh an already-open manual. Old Base64 `build` links are not decoded; they open the full manual with a format notice. No encoded selection links are generated. Invalid/unsupported selection parameters show the full manual.

Gin is an optional native drum synthesiser by SquareWave Studio (libpo32 by Eric Lewis), with24-key A/B kits, four synthesis voices, full editor and eight factory drum kits. It requires the new drum-synth core services on first installation. Drum kits appear in the OP-1 browser separately from the152-synth-preset ZIP. Workshop configuration IDs use arbitrary-width BigInt arithmetic, preserving all existing bit meanings when newer choices are left out.

## Source and SDK

Download the [3.0.3 corresponding source and plugin SDK](source/hundekraft-3.0.3-source.tar.gz) and [SHA-256](source/hundekraft-3.0.3-source.tar.gz.sha256). Firmware sources are GPL-3.0-or-later with the OP-1 firmware permission; see LICENSE, NOTICE and retained third-party notices in the source bundle. The archive includes a standalone plugin SDK and full firmware rebuild instructions. No original/patched firmware or device keys are included.
