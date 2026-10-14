# Changelog

## 2.6

- Base updated to op1r 30. The big addition is drum+: per-pad envelope, pitch envelope, retrig, choke, filter, drive and velocity routing on top of a stock drum kit. In drum mode, press Shift + T1 and pick DRUM+. op1r 28–30 also bring loop points, volume and fade curves to the sample editor, equal slices in auto-cut, and a much faster tape erase.
- Elg and Washer now use about half the CPU they did, Wavetable about a third less, and Snowglobe less too. They sound the same.
- Elg no longer bursts into harsh noise with the white knob high on high notes.
- Maiko's tape undo still works with the faster tape erase.

## 2.5

- Base updated to op1r 27. Our synths and effects are now built into op1r's own engine system.
- Pick which of op1r's synths and effects to include: Supersaw, FM Bell, Granular, Tape, Clouds and Reverb.
- New screens for Wavetable, Taffy, PEW, Elg, Washer and Snowglobe.
- Quad LFO no longer crackles next to heavy effects like Reverb and Snowglobe.
- Washer's white knob now shortens the delay smoothly across its whole range. Before, the upper half jumped.

## 2.1

- Fixes crashes in Dots (press REC, then add a note) and Euclid (hold Shift and press note keys). The OP-1 keeps settings, sounds and sequences in an SQLite database with a fixed amount of working memory. With a lot of saved sounds and sequences, that memory could fill up and the firmware stopped on an error screen. 2.1 limits how much of the database is kept in memory.
- Knobs on Wavetable, Taffy, PEW and Elg are smoother. Turning one while notes play no longer clicks or steps.

## 2.0

- Base updated to op1r 22.
- Adds Maiko's #249 toolkit (tape undo/redo, snapshot naming, scale mode, storage overview), optional and on by default.

## 1.0

- First release, on op1r 18.
- Hundekraft synths (Wavetable, Taffy, PEW, Elg) and effects (Washer, Snowglobe), plus a choice of 100 or 300 user presets.
- A matching collection of up to 112 presets.
