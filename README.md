# OP-1 Firmware Workshop

[Open the workshop](https://hundekraft.github.io/op1-workshop/)

A browser-based firmware configurator for the original Teenage Engineering OP-1. Start with the exact original R246 update, keep op1r 18 as the base, and select Hundekraft synths, effects and the 100/300 user-preset limit.

Firmware is verified and patched locally in your browser. The site does not upload your firmware or require a device key. Download a matching collection of up to 112 presets separately.

This repository contains the generated static release: frontend, checked patch manifests and payloads, screen previews, and preset packs. It contains no complete original or patched firmware, NAND images, or device keys. The Python browser runtime loads from jsDelivr on first use.

## Credits

Built on [pcppcp/op1r](https://github.com/pcppcp/op1r), pinned to [release 18](https://github.com/pcppcp/op1r/commit/fb06689142726d48d7307c4c9eeb687e943ef92d). See [upstream notes and credits](OP1R-README.md). Additional synths, effects and presets by Hundekraft.

Independent project; not affiliated with Teenage Engineering. This targets the original OP-1, not the OP-1 field.

## Publishing

The repository root is served directly by GitHub Pages from the `main` branch. `.nojekyll` disables Jekyll processing. Updates replace the generated release as a complete set; do not mix manifests and payloads from different releases.
