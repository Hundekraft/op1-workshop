# Gin 1.0.1 source update for Hundekraft 3.3.2

This is a maintainer source patch, not an installable plugin or firmware file.
It does not update the live Workshop until its maintainer rebuilds and publishes
the matching source, plugin, package manifests and release metadata.

## Exact base

Use the published corresponding source:

https://github.com/Hundekraft/op1-workshop/blob/main/source/hundekraft-3.3.2-source.tar.gz

Expected archive SHA-256:

`eabeb668bc577e10633400ada35ff5ac8be6ef1318796c0318f03a878990a97f`

Gin core release: https://github.com/squarewave-studio/op1-mods/releases/tag/gin/v1.0.1

Core source commit: `7e941d389a21d7b6b108e2ef5e319d3966af24f4`.

## Apply

Verify the source archive checksum before extracting. From the extracted
`hundekraft-3.3.2-source` directory, apply the complete patch:

```sh
git apply --check /path/to/gin-1.0.1-hundekraft-3.3.2-update.patch
git apply /path/to/gin-1.0.1-hundekraft-3.3.2-update.patch
```

`git apply` works in the extracted directory without a Git checkout. The patch
has been applied to clean original files and the 14 resulting file hashes
checked against the intended source. `UPDATE.json` lists those hashes.

Rebuild using the source archive's `PLUGIN_GUIDE.md`, the Workshop source README and
normal matched-release procedure, with the existing qualified R246 inputs and
GCC 13.3.0 toolchain. Gin's own preparation still needs the builder's qualified
firmware-derived inputs; no font or firmware data is included here.

The update invalidates only the generated Gin bootstrap/factory directories
when their source identity changes. It then regenerates those coefficients;
do not substitute coefficient files left over from 1.0.0. Keep the generated
version header in `build/gin/`; it is derived from `plugin.json`, not from the
Hundekraft firmware version, with DEV for absent version metadata.

Update the corresponding-source provenance and Workshop manifests/hashes using
the usual release process. The original expected build hashes describe the
unmodified 3.3.2 source and will change. Do not replace a live `gin.knl` without
updating its matching manifests.

## Changes

- Corrected Mod noise-envelope attack bursts and following Exp decay in the
  float reference, preparation and scalar/block integer paths.
- Updated both bootstrap/main copies and the three prepared-voice headers.
- Automatic source identity checks prevent reusing old prepared coefficients.
- Credits show the engine version, PO-32 INSPIRED DRUM SYNTH, SUPPORT MY WORK,
  the tip URL and static QR, LIBPO BY ERIC LEWIS and KITS: CNTR RNDM.
- The credits footer retains existing labels, Shift suppression and Help state.

The patch preserves the host's resampler, gain/limiter, save handling and other
DSP optimisations. It keeps 44.1 kHz and four synthesis voices, with the host's
existing block-renderer setting. No oscillator-phase experiment is included.

Saved normalised parameters and GNS1 state retain their formats. Existing Mod
patches can change audibly because of the envelope correction; Exp and Linear
envelopes and oscillator phase are unchanged.

## Checks and remaining integration work

The reusable core passes its full sanitizer/regression suite in four arithmetic
and block configurations. This source update also passes the host's two FAST
scalar/block Mod schedules, threshold/tiny-attack/mixed-frame checks and
793 non-Mod factory endpoint/morph comparisons per block mode: prepared data
and 4096-sample PCM are byte-identical to the original source. Bootstrap and
192 factory coefficient rows were regenerated and losslessly packed.

The generated version header, cache invalidation and credits footer states
have host checks. BF524 object compilation used GCC 8.5.0, with no unresolved
helpers in the audio callback. These are not a full Hundekraft GCC 13.3.0 build
or hardware timing/audio/save/USB acceptance. The source archive omits the
precise-only `gin_filter_math.h`; the native checks therefore cover its supported
FAST profile. The public core separately covers both arithmetic profiles.

Before publishing native packages, verify the full matching build and physical
OP-1: factory and converted kits, Mod clap/crash/hat behaviour, Finger patterns,
parameter/name persistence, snapshot save/load/reboot, credits navigation,
Shift/Help states and QR scanning. The new QR decodes to
https://squarewave.studio/tip; the live route was checked. Older /support links
still reach the working help page.

## Component licences

Retain the base source's component notices and permissions. Its LICENSE and
NOTICE describe GPL-3.0-or-later with the OP-1 firmware permission. The reusable
synthesis port retains Eric Lewis and SquareWave Studio MIT notices. The
[downloadable update bundle](https://github.com/squarewave-studio/op1-mods/releases/tag/gin/v1.0.1)
also carries copies of those licences. This directory is a source handoff;
it does not replace the Workshop's generated packages or source archives.

GIN is by SquareWave Studio, based on Eric Lewis's libpo. Thanks to Hundekraft,
pcppcp and the op1r contributors for host integration and optimisation work,
and CNTR RNDM for the original kits. Teenage Engineering and Sonic Charge retain
their respective names and rights; this is an independent project.
