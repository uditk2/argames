#!/usr/bin/env python3
# ===========================================================================
# Relic Hunter — TEMPLE-VOICE NARRATION via Google Cloud Text-to-Speech.
# ---------------------------------------------------------------------------
# Generates the bilingual narration (English + Hindi) as small MP3s into
#   public/assets/temple/vo/<lang>/<key>.mp3
# which the game plays through its VO hook (playVO in TempleDash.jsx).
#
# HOW TO RUN (in YOUR terminal, where gcloud is logged in):
#   1) gcloud auth login            # if not already
#   2) gcloud config set project <YOUR_PROJECT>
#   3) gcloud services enable texttospeech.googleapis.com   # once
#   4) cd <this project>            # the connected workspace folder
#   5) python3 scripts/generate_vo.py
#
# Voice: Chirp3-HD, a low male voice for the temple-guardian tone, same voice
# feel across both languages. Override with env VOICE_EN / VOICE_HI if you want
# a different one (e.g. a Wavenet fallback: en-IN-Wavenet-B / hi-IN-Wavenet-B).
# Credentials never leave your machine — this uses `gcloud auth print-access-token`.
# ===========================================================================
import base64, json, os, subprocess, sys, urllib.request, urllib.error

# Deep, grave baritone (temple-guardian mystery). Neural2/Wavenet support pitch, so
# they get pitched down (see VO_PITCH); the language code is derived from the voice.
VOICE_EN = os.environ.get('VOICE_EN', 'en-US-Neural2-J')   # deep US male baritone
VOICE_HI = os.environ.get('VOICE_HI', 'hi-IN-Neural2-B')   # deep Hindi male
OUT_DIR = os.path.join(os.path.dirname(__file__), '..', 'public', 'assets', 'temple', 'vo')

# key -> { en, hi }  (mirrors src/games/temple/narrative.js)
LINES = {
    'premise': {
        'en': ("Surya, the sun, forged a jewel of living light: the Syamantaka. "
               "To the worthy it gave gold without end, and turned away every ruin. The unworthy, it destroyed. "
               "Kings and brothers fell over it, until Krishna himself fought for the gem and won it. "
               "But when Dwaraka, his golden city, sank beneath the sea, the Syamantaka was lost to the deep. "
               "For an age, no one knew where it lay. Then word came: it had been raised from the waters, and sealed in this temple. "
               "You are a relic hunter. You have come to take it back, not for a throne, but for all of us."),
        'hi': ('सूर्य ने जीवित प्रकाश का एक रत्न गढ़ा: स्यमंतक। '
               'योग्य को यह अनंत स्वर्ण देता, और हर विनाश को दूर रखता। अयोग्य को यह नष्ट कर देता। '
               'राजा और भाई इसके लिए गिरे, जब तक कि स्वयं कृष्ण ने इस रत्न के लिए युद्ध किया और इसे जीता। '
               'पर जब उनकी स्वर्ण नगरी द्वारका समुद्र में डूबी, स्यमंतक गहराइयों में खो गया। '
               'युगों तक किसी को न पता था यह कहाँ है। फिर ख़बर आई: इसे जल से निकालकर इसी मंदिर में बंद कर दिया गया। '
               'तुम एक खोजी हो। इसे वापस लाने आए हो, किसी सिंहासन के लिए नहीं, बल्कि हम सबके लिए।'),
    },
    'goal': {
        'en': 'Read the map. Reach the light before the temple falls.',
        'hi': 'नक़्शा पढ़ो। मंदिर के गिरने से पहले रोशनी तक पहुँचो।',
    },
    'l1': {'en': "The outer halls test nothing but memory. Walk them as if you'd read the palm leaves.",
           'hi': 'बाहरी गलियारे बस याददाश्त आज़माते हैं। इन्हें ऐसे चलो जैसे ताड़पत्र में पढ़ा हो।'},
    'l2': {'en': 'The temple has noticed you. The blades wake first.',
           'hi': 'मंदिर ने तुम्हें देख लिया है। सबसे पहले धार जागती है।'},
    'l3': {'en': 'Deeper now. Even the light refuses to follow.',
           'hi': 'और गहरे। यहाँ रोशनी भी साथ छोड़ देती है।'},
    'l4': {'en': 'What the blades miss, the guardians burn. The sanctum is close.',
           'hi': 'जो धार से बच जाए, उसे पहरेदार जला देते हैं। गर्भगृह पास है।'},
    'l5': {'en': 'There it is. Remember, the gem judges the hand that lifts it.',
           'hi': 'वह रहा। याद रखना, स्यमंतक उठाने वाले हाथ को परखता है।'},
    'l6': {'en': 'The temple knows what you carry. Run.',
           'hi': 'मंदिर जानता है तुम क्या लिए जा रहे हो। भागो।'},
    'grab': {'en': 'It burns cold in your grip. Now the temple has no reason to stand.',
             'hi': 'तुम्हारी मुट्ठी में वह ठंडा जलता है। अब मंदिर के खड़े रहने की कोई वजह नहीं।'},
    'victory': {'en': 'The unworthy are kept. You were not. The Syamantaka has chosen its hunter.',
                'hi': 'अयोग्य यहीं रह जाते हैं। तुम नहीं रुके। स्यमंतक ने अपना शिकारी चुन लिया।'},
    'gameover': {'en': 'The temple keeps you.', 'hi': 'मंदिर तुम्हें रख लेता है।'},
    'retry': {'en': 'Not yet. The trial allows another step.', 'hi': 'अभी नहीं। परीक्षा एक और क़दम की इजाज़त देती है।'},
    'pause': {'en': 'The collapse holds its breath.', 'hi': 'ढहता मंदिर साँस रोके खड़ा है।'},
}


def sh(cmd):
    return subprocess.check_output(cmd, shell=True, text=True).strip()


API_KEY = os.environ.get('TTS_API_KEY', '').strip()   # simplest auth — bypasses ADC/quota-project IAM


def synth(text, lang_code, voice_name, token, project):
    # Chirp3-HD rejects `pitch`; Wavenet/Neural2/Studio support it, so for those we
    # drop the pitch low for a heavy, grave baritone (temple-guardian mystery).
    audio_cfg = {'audioEncoding': 'MP3', 'speakingRate': 0.88}
    if 'Chirp3' not in voice_name:
        audio_cfg['pitch'] = float(os.environ.get('VO_PITCH', '-5.0'))
    body = json.dumps({
        'input': {'text': text},
        'voice': {'languageCode': lang_code, 'name': voice_name},
        'audioConfig': audio_cfg,
    }).encode('utf-8')
    url = 'https://texttospeech.googleapis.com/v1/text:synthesize'
    headers = {'Content-Type': 'application/json; charset=utf-8'}
    if API_KEY:
        # API-key auth: no bearer token, no quota project, no serviceusage role needed.
        url += f'?key={API_KEY}'
    else:
        headers['Authorization'] = f'Bearer {token}'
        if project:
            headers['x-goog-user-project'] = project   # required for user ADC tokens
    req = urllib.request.Request(url, data=body, headers=headers)
    with urllib.request.urlopen(req) as r:
        return base64.b64decode(json.loads(r.read())['audioContent'])


def main():
    token, project = '', ''
    if API_KEY:
        print('Using API key auth (TTS_API_KEY).')
    else:
        try:
            token = sh('gcloud auth print-access-token')
        except Exception:
            sys.exit('ERROR: `gcloud auth print-access-token` failed — run `gcloud auth login`, or set TTS_API_KEY.')
        project = os.environ.get('GCP_PROJECT') or os.environ.get('GOOGLE_CLOUD_PROJECT') or ''
        if not project:
            try: project = sh('gcloud config get-value project 2>/dev/null')
            except Exception: project = ''
        if project in ('', '(unset)'):
            sys.exit('ERROR: no project set. Run `gcloud config set project seerly` (or set GCP_PROJECT).')
        print(f'Using ADC token · quota project: {project}')
    # language code is derived from the voice name (e.g. en-US-Neural2-J -> en-US).
    langOf = lambda v: '-'.join(v.split('-')[:2])
    voices = {'en': (VOICE_EN, langOf(VOICE_EN)), 'hi': (VOICE_HI, langOf(VOICE_HI))}
    for lang, (voice, code) in voices.items():
        d = os.path.join(OUT_DIR, lang)
        os.makedirs(d, exist_ok=True)
        for key, texts in LINES.items():
            out = os.path.join(d, f'{key}.mp3')
            try:
                audio = synth(texts[lang], code, voice, token, project)
                with open(out, 'wb') as f:
                    f.write(audio)
                print(f'  ok  {lang}/{key}.mp3  ({len(audio)//1024} KB)')
            except urllib.error.HTTPError as e:
                print(f'  FAIL {lang}/{key}: HTTP {e.code} {e.read().decode("utf-8", "ignore")[:200]}')
            except Exception as e:
                print(f'  FAIL {lang}/{key}: {e}')
    print('\nDone. MP3s are in public/assets/temple/vo/.'
          '\n  • Voice name errored?  add  VOICE_EN=en-IN-Wavenet-B VOICE_HI=hi-IN-Wavenet-B'
          '\n  • Permission/quota 403? use an API key:  TTS_API_KEY=<key> python3 scripts/generate_vo.py')


if __name__ == '__main__':
    main()
