# Hundekraft source and plugin SDK

This snapshot contains the kennel runtime, plugin sources, standalone plugin SDK and firmware build tools. It contains no Git history, complete firmware image, device keys or NAND images.

## Build a plugin

Read `PLUGIN_GUIDE.md`, then work from `ext/kennel/`. Copy a template from `synth_sdk/template/`, edit its source and manifest, and run:

```sh
python3 tools/kennel/pack.py synth_sdk/plugins/your_id -o build/your_id.knl
```

Only your plugin is compiled. No original R246 or full firmware build is required. Install the `.knl` through **Your plugins → Update OP-1** in the workshop. Use the SDK matching the installed firmware; check `synth_sdk/kennel/kn_exports.c` before using an optional service.

## Build the firmware

Requirements: Python 3.9+, Blackfin GCC 13.3.0 and matching binutils, Node.js, Playwright with Chrome for Gin font geometry, and your own unmodified R246. Set `NODE_PATH` to Playwright’s `node_modules` directory when needed.

```sh
python3 build.py --verify
python3 build.py --firmware /path/to/op1_246.op1 --toolchain /path/to/gcc/bin --binutils /path/to/binutils/bin
```

Output is in `build/`. Lander is off by default; add `--lander` to enable it. Move `build/generated` aside before a fresh rebuild. Stock artwork/font inputs are derived locally from your R246; no firmware is downloaded or uploaded.

`PROVENANCE.json` records source hashes and the source snapshot identifier. `expected.json` records firmware configurations and expected output hashes. Editorial cleanup changes documentation and comments, not executable source. Toolchain or functional source changes can change build output.

## Licenses and credits

See `LICENSE`, `NOTICE` and `ext/kennel/PROVENANCE.md`. Copyright, component licenses and third-party permission records remain with their sources. Vendored Gin source and its original receipts are retained unchanged. Toolchain binaries are not included.
