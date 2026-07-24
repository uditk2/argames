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
// The opening story (narrated in the temple-guardian baritone). Faithful arc:
// Surya's gem judges the worthy/unworthy → Krishna won it → lost when Dwaraka sank
// → later sealed in this temple → you, a relic hunter, come to take it back for all.
export const PREMISE = {
  en: "Surya, the sun, forged a jewel of living light — the Syamantaka. To the worthy it gave gold without end, and turned away every ruin; the unworthy, it destroyed. Kings and brothers fell over it, until Krishna himself fought for the gem and won it. But when Dwaraka, his golden city, sank beneath the sea, the Syamantaka was lost to the deep. For an age no one knew where it lay — then word came it had been raised from the waters and sealed in this temple. You are a relic hunter, come to take it back — not for a throne, but for all of us.",
  hi: 'सूर्य ने जीवित प्रकाश का एक रत्न गढ़ा — स्यमंतक। योग्य को यह अनंत स्वर्ण देता, और हर विनाश को दूर रखता; अयोग्य को यह नष्ट कर देता। राजा और भाई इसके लिए गिरे, जब तक कि स्वयं कृष्ण ने इस रत्न के लिए युद्ध किया और इसे जीता। पर जब उनकी स्वर्ण नगरी द्वारका समुद्र में डूबी, स्यमंतक गहराइयों में खो गया। युगों तक किसी को न पता था यह कहाँ है — फिर ख़बर आई, इसे जल से निकालकर इसी मंदिर में बंद कर दिया गया। तुम एक खोजी हो, इसे वापस लाने आए हो — किसी सिंहासन के लिए नहीं, बल्कि हम सबके लिए।',
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
  en: 'The unworthy are kept. You were not. The Syamantaka Gem has chosen its hunter.',
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
