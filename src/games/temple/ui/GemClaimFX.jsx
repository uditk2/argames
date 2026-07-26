// ===========================================================================
// Temple / Relic Hunter — GEM CLAIM FX (own module).
// ---------------------------------------------------------------------------
// The "Divine Sunburst" — a Grok-generated clip of the Syamantaka sun-jewel
// igniting (core flare → radial golden rays → an expanding shockwave ring →
// settle), rendered on PURE BLACK so `mix-blend-mode: screen` drops the black
// out and only the light shows. Played once, centred, over the 3D canvas the
// instant the gem is claimed on L5, then fades away. Purely cosmetic overlay —
// no pointer events, no audio.
//
//   <GemClaimFX playKey={n} />   // bump `playKey` (0 = idle) to fire it once
// ===========================================================================
import { useEffect, useRef, useState } from 'react';
import { assetUrl } from '../assetUrl.js';

export default function GemClaimFX({ playKey = 0 }) {
  const videoRef = useRef(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!playKey) return undefined;               // 0 = idle, never played
    const v = videoRef.current;
    if (!v) return undefined;
    setVisible(true);
    try { v.currentTime = 0; const p = v.play(); if (p && p.catch) p.catch(() => {}); } catch { /* ignore */ }
    const hide = () => setVisible(false);
    v.addEventListener('ended', hide);
    const safety = setTimeout(hide, 4200);        // fail-safe if 'ended' never fires
    return () => { v.removeEventListener('ended', hide); clearTimeout(safety); };
  }, [playKey]);

  return (
    <div aria-hidden="true"
      style={{ position: 'absolute', inset: 0, zIndex: 4, pointerEvents: 'none',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        opacity: visible ? 1 : 0, transition: 'opacity 300ms ease' }}>
      <video ref={videoRef} muted playsInline preload="auto"
        style={{ width: 'min(80vh, 84vw)', height: 'min(80vh, 84vw)', maxWidth: 860, maxHeight: 860,
          mixBlendMode: 'screen', objectFit: 'contain' }}>
        <source src={assetUrl('assets/temple/gem_claim.webm')} type="video/webm" />
        <source src={assetUrl('assets/temple/gem_claim.mp4')} type="video/mp4" />
      </video>
    </div>
  );
}
