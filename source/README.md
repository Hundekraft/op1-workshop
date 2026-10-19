# Hundekraft 3.0 corresponding source and plugin SDK

GPL-3.0-or-later with the OP-1 firmware permission in NOTICE. Third-party notices are retained under ext/kennel, including Gin and its kit provenance. This package contains no complete original/patched firmware, device keys or NAND images.

To build your own plugin, use ext/kennel/synth_sdk/ headers/templates and ext/kennel/tools/kennel/pack.py. No R246 or complete firmware build is needed for standalone .knl development. Follow the workshop manual's Make your own plugin chapter; its paths are relative to ext/kennel.

For a complete firmware rebuild, provide Python 3.9+, Blackfin GCC 13.3.0, matching binutils, Node.js, Playwright (with Chrome available) for Gin's locally generated font geometry, and your own unmodified R246. Put Playwright's node_modules directory in NODE_PATH if installed outside this folder. No firmware input is sent to a server.

    python3 build.py --verify
    python3 build.py --firmware /path/to/op1_246.op1 --toolchain /path/to/gcc/bin --binutils /path/to/binutils/bin

Lander is OFF by default; add --lander for ON. Output is in build/. Move build/generated aside for another fresh build. The script derives the stock Iter/font inputs locally from your verified R246, then compiles the exact source snapshot and validates the firmware. expected.json contains firmware hashes and selected configurations, not firmware bytes. PROVENANCE.json authenticates source files. Changing source or compiler can change the output.

The public workshop repository separately contains the webapp, manual and browser patch runtime. Firmware source is supplied here as a self-contained snapshot; the private maintainer repository is not required. Toolchain binaries are not bundled; obtain Blackfin GCC/binutils from their upstream sources.
