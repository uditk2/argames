// ===========================================================================
// RENDER LAYERS — names + z-order for the Pixi scene containers.
// pixiScene.js creates Containers in this order (back -> front). Kept as a
// single source of truth so future layers slot in consistently.
// ===========================================================================

export const LAYER_ORDER = ['bg', 'demons', 'player', 'fx'];

export const LAYER_DESCRIPTIONS = {
  bg: 'Night-sky background + purple/fire tint',
  demons: 'Streaming demon sprites (registry-driven)',
  player: 'Pose-tracked energy FX (fist orbs, live skeleton overlay, aura, shield arc) over the live webcam — or legacy avatar sprite in sprite mode',
  fx: 'Particle hits/kills/shield flashes + punch bursts/trails',
};
