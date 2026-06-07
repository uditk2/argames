// ReplayCard HUD — side-by-side "Realm | You" instant-replay placeholder
// (bottom-right, matches mockup). Real capture lives in recording/replayBuffer.
import React from 'react';

export default function ReplayCard({ supported }) {
  return (
    <div className="absolute bottom-3 right-3 sm:bottom-5 sm:right-5 w-[136px] sm:w-[268px] rounded-xl sm:rounded-2xl overflow-hidden panel pointer-events-none">
      <div className="flex items-center justify-between px-2 sm:px-3 py-1 sm:py-2 gap-1">
        <span className="text-[10px] sm:text-[13px] font-semibold">Instant replay</span>
        <span className="text-[8px] sm:text-[11px] text-magic/70 truncate">
          {supported ? 'last 10s' : 'unavailable'}
        </span>
      </div>
      <div className="flex gap-1 px-1.5 sm:px-2 pb-1.5 sm:pb-2 relative">
        <div className="flex-1 h-[44px] sm:h-[84px] rounded-lg relative overflow-hidden bg-[radial-gradient(60%_70%_at_50%_40%,rgba(176,121,255,.55),#1a0c30_75%)]">
          <span className="absolute bottom-0.5 left-1 text-[8px] sm:text-[10px] tracking-wider uppercase text-white/85">Realm</span>
        </div>
        <div className="flex-1 h-[44px] sm:h-[84px] rounded-lg relative overflow-hidden bg-[radial-gradient(70%_80%_at_50%_120%,rgba(87,227,255,.3),#10202c_70%)]">
          <span className="absolute bottom-0.5 left-1 text-[8px] sm:text-[10px] tracking-wider uppercase text-white/85">You</span>
        </div>
        <svg className="absolute left-1/2 top-[14px] sm:top-[34px] -translate-x-1/2 w-6 h-6 sm:w-8 sm:h-8" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="11" fill="rgba(0,0,0,.45)" />
          <path d="M9 7 L17 12 L9 17 Z" fill="#fff" />
        </svg>
      </div>
    </div>
  );
}
