# Sound files go here

Drop a sound file in this folder and the game plays it instead of the
synthesised placeholder. Nothing else to do — no code change, no list to
register it in. Rebuild (or just save, if `npm run dev` is running) and it is
in the game.

## Naming

The file's **name is the sound**:

| File | Plays when |
| --- | --- |
| `bounce.wav` | the ball hits the court |
| `catch.wav` | the ball meets a palm |
| `rim.wav` | the ball hits the iron |
| `backboard.wav` | the ball hits the glass |
| `swish.wav` | the ball goes through the net |
| `release.wav` | the ball leaves the fingertips on a shot |
| `footstep.wav` | a step |
| `squeak.wav` | a shoe squeak on a hard move |
| `whistle.wav` | a whistle |
| `ambience.wav` | looped background bed (replaces the synth wind and birds) |

`wav`, `mp3`, `ogg`, `m4a`, `webm` and `flac` all work. Anything the browser
can decode is fine; `wav` or `ogg` are the safest.

## Several takes of one sound

Add a number and the game picks between them at random, never the same one
twice in a row:

```
rim.wav
rim-2.wav
rim-3.wav
```

This is worth doing for anything that fires repeatedly — `bounce`, `rim`,
`footstep`, `catch`. One take of a bounce played eighty times in a row sounds
like a machine gun; three takes sound like a basketball. `rim_2.wav` and
`rim 2.wav` work too.

## Loudness

The game scales each sound by how hard the hit was, so record or trim your
files at a consistent, fairly hot level and let the game do the rest. If one
sound comes out too loud or quiet next to the others, the per-sound multiplier
is in `src/audio/AudioManager.js` — each sound's first line, e.g.
`this._playSample('rim', v * 0.85)`.

A file that is a lot longer than the sound itself (a second of silence at the
head, say) will feel late. Trim the silence off the front.

## One at a time is fine

Sounds with no file keep their synthesised version, so you can replace
`swish` today and the rest whenever. A file whose name matches nothing on the
list above is ignored, and the browser console says so — that is where to look
if a file seems to do nothing.
