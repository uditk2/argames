// ===========================================================================
// AVATAR / SKIN REGISTRY
// ---------------------------------------------------------------------------
// NOTE: As of the "webcam-fx" player render mode, the LIVE fighter is the
// player's mirrored webcam image with glowing pose-tracked effects (see
// config/game.config.js -> PLAYER_RENDER_MODE and render/pixiScene.js). These
// avatars are NO LONGER the live fighter — they are a registry of *skins* that
// are intended to be rigged to the pose later (or used by the legacy 'sprite'
// render mode). The static boxer sprite is kept here as the first such skin;
// do not delete its sprite assets.
//
// Each avatar is a plain data object. The legacy 'sprite' render path and the
// StartScreen read the ACTIVE avatar from here — no sprite path is hardcoded
// elsewhere.
//
// >>> TO ADD A NEW SKIN: append an object below. Nothing else changes. <<<
//
//   {
//     id:    unique string key
//     name:  display name (StartScreen)
//     sprites: { idle, punch, block }  served URLs under /assets
//     scale: render scale multiplier in the Pixi scene (1 = native)
//   }
// ===========================================================================

export const AVATARS = [
  {
    id: 'boxer',
    name: 'Boxer',
    sprites: {
      idle: '/assets/sprites/player_idle.png',
      punch: '/assets/sprites/player_punch.png',
      block: '/assets/sprites/player_block.png',
    },
    scale: 1,
  },
  // Example of how a second avatar would be added (commented; drop in real art):
  // {
  //   id: 'mage',
  //   name: 'Mage',
  //   sprites: { idle: '/assets/sprites/mage_idle.png', punch: '...', block: '...' },
  //   scale: 1.1,
  // },
];

/** The avatar selected by default on the StartScreen. */
export const DEFAULT_AVATAR_ID = 'boxer';

/** Look up an avatar by id, falling back to the default. */
export function getAvatar(id = DEFAULT_AVATAR_ID) {
  return AVATARS.find((a) => a.id === id) || AVATARS[0];
}
