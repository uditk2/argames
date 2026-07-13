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

VOICE_EN = os.environ.get('VOICE_EN', 'en-IN-Chirp3-HD-Charon')  # low male
VOICE_HI = os.environ.get('VOICE_HI', 'hi-IN-Chirp3-HD-Charon')
OUT_DIR = os.path.join(os.path.dirname(__file__), '..', 'public', 'assets', 'temple', 'vo')

# key -> { en, hi }  (mirrors src/games/temple/narrative.js)
LINES = {
    'premise': {
        'en': "A thousand years ago, Surya's own gem, the Syamantaka, was sealed in a temple built by Maya himself, so no unworthy hand would ever hold it. You've come to take it anyway.",
        'hi': 'हज़ार साल पहले, सूर्य का रत्न स्यमंतक, माया के बनाए मंदिर में छिपा दिया गया, ताकि कोई अयोग्य हाथ उसे छू न सके। तुम फिर भी आए हो।',
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


def synth(text, lang_code, voice_name, token):
    body = json.dumps({
        'input': {'text': text},
        'voice': {'languageCode': lang_code, 'name': voice_name},
        'audioConfig': {'audioEncoding': 'MP3', 'speakingRate': 0.94, 'pitch': -2.0},
    }).encode('utf-8')
    req = urllib.request.Request(
        'https://texttospeech.googleapis.com/v1/text:synthesize',
        data=body,
        headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json; charset=utf-8'},
    )
    with urllib.request.urlopen(req) as r:
        return base64.b64decode(json.loads(r.read())['audioContent'])


def main():
    try:
        token = sh('gcloud auth print-access-token')
    except Exception:
        sys.exit('ERROR: `gcloud auth print-access-token` failed — run `gcloud auth login` first.')
    voices = {'en': (VOICE_EN, 'en-IN'), 'hi': (VOICE_HI, 'hi-IN')}
    for lang, (voice, code) in voices.items():
        d = os.path.join(OUT_DIR, lang)
        os.makedirs(d, exist_ok=True)
        for key, texts in LINES.items():
            out = os.path.join(d, f'{key}.mp3')
            try:
                audio = synth(texts[lang], code, voice, token)
                with open(out, 'wb') as f:
                    f.write(audio)
                print(f'  ok  {lang}/{key}.mp3  ({len(audio)//1024} KB)')
            except urllib.error.HTTPError as e:
                print(f'  FAIL {lang}/{key}: HTTP {e.code} {e.read().decode("utf-8", "ignore")[:200]}')
            except Exception as e:
                print(f'  FAIL {lang}/{key}: {e}')
    print('\nDone. MP3s are in public/assets/temple/vo/. If a voice name errored, try the'
          '\nWavenet fallback:  VOICE_EN=en-IN-Wavenet-B VOICE_HI=hi-IN-Wavenet-B python3 scripts/generate_vo.py')


if __name__ == '__main__':
    main()
