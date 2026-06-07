// ReplayCard HUD — side-by-side "Realm | You" instant-replay placeholder
// (bottom-right, matches mockup). Real capture lives in recording/replayBuffer.
import React from 'react';

export default function ReplayCard({ supported }) {
  return (
    <div className="absolute bottom-5 right-5 w-[268px] rounded-2xl overflow-hidden panel pointer-events-none">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-[13px] font-semibold">Instant replay</span>
        <span className="text-[11px] text-magic/70">
          {supported ? 'last 10s · tap to share' : 'unavailable'}
        </span>
      </div>
      <div className="flex gap-1 px-2 pb-2 relative">
        <div className="flex-1 h-[84px] rounded-lg relative overflow-hidden bg-[radial-gradient(60%_70%_at_50%_40%,rgba(176,121,255,.55),#1a0c30_75%)]">
          <span className="absolute bottom-1 left-1.5 text-[10px] tracking-wider uppercase text-white/85">Realm</span>
        </div>
        <div className="flex-1 h-[84px] rounded-lg relative overflow-hidden bg-[radial-gradient(70%_80%_at_50%_120%,rgba(87,227,255,.3),#10202c_70%)]">
          <span className="absolute bottom-1 left-1.5 text-[10px] tracking-wider uppercase text-white/85">You</span>
        </div>
        <svg className="absolute left-1/2 top-[34px] -translate-x-1/2 w-8 h-8" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="11" fill="rgba(0,0,0,.45)" />
          <path d="M9 7 L17 12 L9 17 Z" fill="#fff" />
        </svg>
      </div>
    </div>
  );
}
