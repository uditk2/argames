// ===========================================================================
// TWO-INSTANCE FIGHT TEST (loopback) — proves the netcode end to end without a
// real network: two sessions linked by a simulated wire (latency/jitter),
// mocked pose streams + scripted jabs, asserting clock sync, pose transfer,
// block vs hit resolution, HP replication, and KO agreement.
//   run:  node tests/versus.fight.test.mjs
// ===========================================================================

import { createLoopbackPair } from '../src/net/dataLink.js';
import { createClock } from '../src/net/clock.js';
import { createVersusEngine } from '../src/versus/versusEngine.js';
import { createVersusSession } from '../src/versus/versusSession.js';
import { decode, encodePose } from '../src/net/protocol.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}  ${extra}`); }
}

// A simple full-body landmark set (normalized), with a movable right wrist.
function mockPose(rightWristX = 0.66, rightWristY = 0.5) {
  const lm = new Array(33).fill(null).map(() => ({ x: 0.5, y: 0.5, visibility: 0 }));
  const set = (i, x, y) => { lm[i] = { x, y, visibility: 1 }; };
  set(0, 0.5, 0.25);
  set(11, 0.42, 0.4); set(12, 0.58, 0.4);
  set(13, 0.38, 0.5); set(14, 0.62, 0.5);
  set(15, 0.34, 0.5); set(16, rightWristX, rightWristY);
  set(23, 0.45, 0.65); set(24, 0.55, 0.65);
  set(25, 0.45, 0.8); set(26, 0.55, 0.8);
  set(27, 0.45, 0.95); set(28, 0.55, 0.95);
  set(7, 0.46, 0.22); set(8, 0.54, 0.22);
  return lm;
}

async function main() {
  console.log('\nVERSUS two-instance fight test (loopback wire: 60ms ±20ms)\n');

  const [linkHost, linkGuest] = createLoopbackPair({ latencyMs: 60, jitterMs: 20, loss: 0 });

  // Simulate the guest's machine clock being SKEW ms ahead of the host's.
  const SKEW = 1234;
  const hostClock = createClock({ localNow: () => performance.now() });
  const guestClock = createClock({ localNow: () => performance.now() + SKEW });

  const hostEng = createVersusEngine();
  const guestEng = createVersusEngine();

  let hostSynced = false, guestSynced = false;
  const host = createVersusSession({
    link: linkHost, isHost: true, clock: hostClock, engine: hostEng,
    hooks: { onSynced: () => { hostSynced = true; } },
  }).start();
  const guest = createVersusSession({
    link: linkGuest, isHost: false, clock: guestClock, engine: guestEng,
    hooks: { onSynced: () => { guestSynced = true; } },
  }).start();

  // --- 1) Clock sync -------------------------------------------------------
  await sleep(1500);
  const offErr = Math.abs(guestClock.getOffset() + SKEW); // want offset ≈ -SKEW
  const skew = Math.abs(guestClock.now() - hostClock.now());
  console.log(`  [clock] guest offset=${guestClock.getOffset().toFixed(1)} (want ~${-SKEW}), rtt=${guestClock.getRtt().toFixed(1)}ms, residual skew=${skew.toFixed(1)}ms`);
  check('guest synced flag set', guestSynced);
  check('recovered offset ≈ -SKEW (±40ms)', offErr < 40, `err=${offErr.toFixed(1)}`);
  check('shared-clock residual skew < 40ms', skew < 40, `skew=${skew.toFixed(1)}`);
  check('rtt ≈ 120ms (±60)', Math.abs(guestClock.getRtt() - 120) < 60, `rtt=${guestClock.getRtt().toFixed(1)}`);

  // --- 2) Pose transfer + interpolation -----------------------------------
  for (let i = 0; i < 6; i++) { host.sendPose(mockPose(0.5 + i * 0.03, 0.5)); await sleep(40); }
  await sleep(150);
  check('guest received pose samples', guest.poseBufferSize() > 0, `size=${guest.poseBufferSize()}`);
  const rt = guestClock.now() - 100;
  const rp = guest.remotePoseAt(rt);
  check('guest can sample a remote pose', !!rp && !!rp[16], '');
  check('remote right wrist in plausible range', !!rp && rp[16].x > 0.45 && rp[16].x < 0.72, rp && rp[16] ? `x=${rp[16].x.toFixed(3)}` : 'none');

  // --- 3) Clean hit (guest guard DOWN) ------------------------------------
  const guestHp0 = guestEng.state().selfHp;
  host.sendPunch({ side: 'right', x: 0.6, y: 0.45 });
  await sleep(200);
  check('guest took a clean hit (-10)', guestEng.state().selfHp === guestHp0 - 10, `hp=${guestEng.state().selfHp}`);
  await sleep(200);
  check('host sees opponent hp replicated (90)', hostEng.state().oppHp === 90, `oppHp=${hostEng.state().oppHp}`);

  // --- 4) Blocked punch (guest guard UP within window) --------------------
  guest.setLocalGuard(true);
  await sleep(120);
  const hpBeforeBlock = guestEng.state().selfHp;
  host.sendPunch({ side: 'right', x: 0.6, y: 0.45 });
  await sleep(220);
  check('guest blocked (chip -2 only)', guestEng.state().selfHp === hpBeforeBlock - 2, `hp=${guestEng.state().selfHp}`);
  guest.setLocalGuard(false);

  // --- 5) Drive to KO (guard down), assert both agree on winner -----------
  let guard = 1000;
  while (!hostEng.state().over && guard-- > 0) {
    host.sendPunch({ side: 'right', x: 0.6, y: 0.45 });
    await sleep(80);
  }
  await sleep(300);
  const hs = hostEng.state(), gs = guestEng.state();
  console.log(`  [ko] host: over=${hs.over} winner=${hs.winner} oppHp=${hs.oppHp} | guest: over=${gs.over} winner=${gs.winner} selfHp=${gs.selfHp}`);
  check('guest is KO (selfHp 0)', gs.selfHp === 0 && gs.over);
  check('guest knows it lost', gs.winner === 'opponent');
  check('host knows it won', hs.over && hs.winner === 'self');

  host.destroy(); guest.destroy();

  console.log(`\n  RESULT: ${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
