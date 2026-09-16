# Event asset layout

- `G05+G09/`: shared chest sprite and chest-search cue audio.
- `G06+G10/`: shared closed/open chest frames, index-finger sprite, ridge-trace audio and chest-open audio.
- `G07+G11/`: shared projectile sprite/audio and danger-zone artwork (`ground-fill`, `marker-frames`, `impact-frames`).
- `G12/`: `g12.wav` is the five-second fireworks master audio. The current four-burst animation is geometric CSS so its four peaks can stay frame-accurate; replace it later with a transparent sprite sequence without changing the audio path.

All event-specific runtime references are declared in `app/game/eventTimeline.ts`. Root-level assets remain only for persistent scene background and shared hero/boss sprites.
