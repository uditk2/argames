// ===========================================================================
// Relic Hunter — NARRATIVE / FOLKLORE COPY (text only; no art or audio here).
// ---------------------------------------------------------------------------
// The story layer grounded in Indian folklore (review 8b–8e). The relic is the
// SYAMANTAKA — Surya's sun-gem that "blesses a worthy keeper and ruins an
// unworthy taker," so the collapse is mythologically caused by the theft itself.
// Four legends supply meaning for mechanics that already exist, applied purely
// through wording: Maya's deceptive palace (the mazes), the Bhangarh curse (the
// collapse timer — "the temple keeps you"), Kirtimukha the devourer (the closing
// gate), Simhasan Battisi (the six trials that test worthiness).
//
// Voice: the temple itself — calm, ancient, faintly amused; never shouting.
// Hindi lines are written natively in folk-tale register (for the later VO task,
// review 8d), not literal translations. Only English is shown on screen today.
// ===========================================================================

// Premise, shown on the wizard's first step (and line 1 of the VO script).
export const PREMISE = {
  en: "A thousand years ago, Surya's own gem — the Syamantaka — was sealed in a temple built by Maya himself, so no unworthy hand would ever hold it. You've come to take it anyway.",
  hi: 'हज़ार साल पहले, सूर्य का रत्न स्यमंतक, माया के बनाए मंदिर में छिपा दिया गया — ताकि कोई अयोग्य हाथ उसे छू न सके। तुम फिर भी आए हो।',
};

// One line per level, shown on that level's study screen (and VO lines 2–6, 8).
// Keyed by 0-based level index; doubles as the study-screen subtitle.
export const LEVEL_LINES = [
  { en: "The outer halls test nothing but memory. Walk them as if you'd read the palm leaves.", hi: 'बाहरी गलियारे बस याददाश्त आज़माते हैं। इन्हें ऐसे चलो जैसे ताड़पत्र में पढ़ा हो।' },
  { en: 'The temple has noticed you. The blades wake first.', hi: 'मंदिर ने तुम्हें देख लिया है। सबसे पहले धार जागती है।' },
  { en: 'Deeper now. Even the light refuses to follow.', hi: 'और गहरे। यहाँ रोशनी भी साथ छोड़ देती है।' },
  { en: 'What the blades miss, the guardians burn. The sanctum is close.', hi: 'जो धार से बच जाए, उसे पहरेदार जला देते हैं। गर्भगृह पास है।' },
  { en: 'There it is. Remember — the gem judges the hand that lifts it.', hi: 'वह रहा। याद रखना — स्यमंतक उठाने वाले हाथ को परखता है।' },
  { en: 'The temple knows what you carry. Run.', hi: 'मंदिर जानता है तुम क्या लिए जा रहे हो। भागो।' },
];

// The grab moment (VO line 7) — the on-screen cue stays "THE SYAMANTAKA!".
export const GRAB_LINE = {
  en: 'It burns cold in your grip. Now the temple has no reason to stand.',
  hi: 'तुम्हारी मुट्ठी में वह ठंडा जलता है। अब मंदिर के खड़े रहने की कोई वजह नहीं।',
};

// Endings.
export const VICTORY_LINE = {
  en: 'The unworthy are kept. You were not. The Syamantaka has chosen its hunter.',
  hi: 'अयोग्य यहीं रह जाते हैं। तुम नहीं रुके। स्यमंतक ने अपना शिकारी चुन लिया।',
};
export const GAMEOVER_LINE = { en: 'The temple keeps you.', hi: 'मंदिर तुम्हें रख लेता है।' };
export const RETRY_LINE = { en: 'Not yet. The trial allows another step.', hi: 'अभी नहीं। परीक्षा एक और क़दम की इजाज़त देती है।' };
export const PAUSE_LINE = { en: 'The collapse holds its breath.', hi: 'ढहता मंदिर साँस रोके खड़ा है।' };

// Death cause → a soft, in-voice subtitle (replaces the shouty SLICED/BURNED
// headings; teaching value kept — the player still learns what got them).
export const CAUSE_SUBTITLE = {
  blade: 'caught by the blades',
  fire: "the guardians' fire found you",
  collapse: 'the temple came down',
  pit: 'the floor gave way',
  blocked: 'the way stayed shut',
  crush: 'the stone took you',
};
export function causeSubtitle(cause) { return CAUSE_SUBTITLE[cause] || CAUSE_SUBTITLE.crush; }

export default {
  PREMISE, LEVEL_LINES, GRAB_LINE, VICTORY_LINE, GAMEOVER_LINE, RETRY_LINE, PAUSE_LINE,
  CAUSE_SUBTITLE, causeSubtitle,
};
