/**
 * Recorded audio, if any is present.
 *
 * Every sound file dropped into `src/assets/audio/` is picked up here at
 * build time and played instead of the matching synth — no code change, no
 * registration list. The file's name is the sound's name:
 *
 *     swish.wav          → plays for the swish
 *     rim.wav            → plays for a rim hit
 *     rim-2.wav          → a second take of the same sound; the game picks
 *     rim-3.ogg            between the takes at random, which is what stops
 *                          repeated hits sounding like a machine gun
 *
 * Recognised names are listed in `SOUND_NAMES` below; anything else in the
 * folder is ignored (and reported once to the console, so a typo is easy to
 * spot). Supported formats are whatever the browser decodes — wav, mp3, ogg,
 * m4a, webm, flac.
 *
 * Any sound with no file keeps its synthesised version, so the folder can be
 * filled in one sound at a time.
 */

/** The sounds the game plays. A file named after one of these replaces it. */
export const SOUND_NAMES = [
  'bounce', // the ball hitting the court
  'catch', // the ball meeting the palm
  'rim', // the ball on the iron
  'backboard', // the ball on the glass
  'swish', // the ball through the net
  'release', // leather leaving the fingertips
  'footstep',
  'squeak', // shoe squeak on a hard move
  'whistle',
  'ambience', // a looping bed; replaces the synthesised wind
];

const MODULES = import.meta.glob('../assets/audio/*.{wav,mp3,ogg,m4a,webm,flac,WAV,MP3,OGG,M4A,WEBM,FLAC}', {
  eager: true,
  query: '?url',
  import: 'default',
});

/**
 * { name: [url, url, …] } for every recognised sound that has files.
 * Variations (`rim-2`, `rim-3`) collect under the base name.
 */
export function collectSampleUrls() {
  const out = {};
  const unknown = [];
  for (const [path, url] of Object.entries(MODULES)) {
    const file = path.slice(path.lastIndexOf('/') + 1);
    const stem = file.slice(0, file.lastIndexOf('.')).toLowerCase();
    // `rim-2`, `rim_2` and `rim 2` are all takes of `rim`.
    const name = stem.replace(/[-_ ]\d+$/, '');
    if (!SOUND_NAMES.includes(name)) {
      unknown.push(file);
      continue;
    }
    (out[name] = out[name] || []).push(url);
  }
  if (unknown.length) {
    console.warn(
      `[audio] ignoring ${unknown.length} file(s) in src/assets/audio with no matching sound: ${unknown.join(', ')}.\n` +
        `Name a file after one of: ${SOUND_NAMES.join(', ')} (optionally with -2, -3 … for extra takes).`
    );
  }
  return out;
}
