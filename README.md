# hundekraft 2.6.1 — OP-1 Firmware Workshop

[Open the workshop](https://hundekraft.github.io/op1-workshop/)

A browser-based firmware configurator for the original Teenage Engineering OP-1. Start from the original R246 update, keep op1r 30 as the base, add Maiko’s #249 toolkit if you want it (it’s on by default), choose Hundekraft synths, effects and the 100 or 300 user-preset limit, and pick which of op1r’s own synths and effects to include.

Firmware is verified and patched locally in your browser. The site does not upload your firmware or require a device key. Download a matching collection of up to 112 presets separately.

This repository contains the generated static release: frontend, checked patch manifests and payloads, screen previews, and preset packs. It contains no complete original or patched firmware, NAND images, or device keys. The Python browser runtime loads from jsDelivr on first use.

## Release

Product: **hundekraft 2.6.1**. Asset release: `5a23026bd3493337`. Includes 256 prebuilt configurations; the choice of op1r synths and effects is applied in the browser on top of them. Downloads retain the selection ID, for example `hundekraft-2.6.1-7ff.op1`; build records list the upstream versions, selected features and firmware hashes.

What changed: [CHANGELOG.md](CHANGELOG.md).

## Credits

Built on [pcppcp/op1r](https://github.com/pcppcp/op1r), pinned to [release 30](https://github.com/pcppcp/op1r/commit/6b77bf3fe2a0a006dc79750b34c03c9ba8d8fe01). See [upstream notes and credits](OP1R-README.md). Tape undo/redo, snapshot naming, scale mode and the storage display come from [Maiko Pruett’s #249 firmware](https://maikopruett.com/op-1). Additional synths, effects and presets by Hundekraft.

Independent project; not affiliated with Teenage Engineering. This targets the original OP-1, not the OP-1 field.

## Publishing

The repository root is served directly by GitHub Pages from the `main` branch. `.nojekyll` disables Jekyll processing. Updates replace the generated release as a complete set; do not mix manifests and payloads from different releases.
