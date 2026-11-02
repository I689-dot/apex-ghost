"""Team radio voice lines (Piper neural TTS, offline): every phrase the race engineer and the spotter say, in English
and Spanish, rendered once to small Opus files the game plays through its radio filter (audio/radio.ts).

The message set follows iRacing's spotter and crew chief messages (support article 31000170136: gaps to the cars
ahead and behind, personal bests, rivals pitting, faster cars behind, time remaining, damage, near-end motivation)
and an F1 race engineer's calls (box this lap, pit limiter, flags, penalties, tyres, fuel, rain, last lap, result).

  ~/.local/opt/piperenv/bin/python tools/asset-pipeline/radio_voice.py [--only en]

Voices: en_GB-alan-medium and es_ES-davefx-medium (rhasspy/piper-voices, MIT) in ~/.local/opt/piper-voices.
Writes apps/client/public/assets/audio/radio/<lang>/<id>.webm and radio.json (ids → durations).
"""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "apps/client/public/assets/audio/radio"
VOICES = Path.home() / ".local/opt/piper-voices"
PIPER = Path.home() / ".local/opt/piperenv/bin/piper"
VOICE = {"en": "en_GB-alan-medium", "es": "es_ES-davefx-medium"}

EN_NUM = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty".split()
ES_NUM = "cero uno dos tres cuatro cinco seis siete ocho nueve diez once doce trece catorce quince dieciséis diecisiete dieciocho diecinueve veinte".split()


def en_n(n: int) -> str:
    return EN_NUM[n] if n <= 20 else f"twenty {EN_NUM[n - 20]}"


def es_n(n: int) -> str:
    return ES_NUM[n] if n <= 20 else ["veintiuno", "veintidós", "veintitrés", "veinticuatro"][n - 21]


def en_secs(t: float) -> str:
    whole, half = int(t), (t % 1) >= 0.5
    if whole == 0:
        return "half a second"
    return f"{en_n(whole)} point five seconds" if half else f"{en_n(whole)} second{'s' if whole > 1 else ''}"


def es_secs(t: float) -> str:
    whole, half = int(t), (t % 1) >= 0.5
    if whole == 0:
        return "medio segundo"
    if half:
        return f"{es_n(whole).replace('uno', 'un')} segundo{'s' if whole > 1 else ''} y medio"
    return f"{es_n(whole).replace('uno', 'un')} segundo{'s' if whole > 1 else ''}"


# id: (english, spanish)
LINES: dict[str, tuple[str, str]] = {
    # the race engineer
    "radio_check": ("Radio check. Good luck out there.", "Prueba de radio. Mucha suerte ahí fuera."),
    "formation": ("Tyres and brakes, get some heat in them.", "Calienta bien neumáticos y frenos."),
    "good_start": ("Good start, good start.", "Buena salida, buena salida."),
    "box_this_lap": ("Box this lap, box this lap.", "Entra a boxes esta vuelta, entra a boxes."),
    "pit_limiter": ("Pit limiter, pit limiter.", "Limitador, limitador."),
    "pit_go": ("Go, go, go! Watch the pit exit line.", "¡Vamos, vamos! Cuidado con la línea de salida de boxes."),
    "pit_window_open": ("The pit window is open.", "La ventana de paradas está abierta."),
    "personal_best": ("Good lap. That's a personal best.", "Buena vuelta. Es tu mejor vuelta."),
    "fastest_lap": ("Fastest lap of the session. Great job.", "Vuelta rápida de la sesión. Muy bien."),
    "lap_deleted": ("That lap has been deleted. Track limits.", "Te han borrado la vuelta por límites de pista."),
    "limits_warning": ("Careful with track limits, that's a warning.", "Cuidado con los límites de pista, eso es un aviso."),
    "penalty_time": ("We have a time penalty. Keep pushing.", "Tenemos una penalización de tiempo. Sigue apretando."),
    "penalty_dt": ("Drive-through penalty. Serve it through the pit lane.", "Drive-through. Cúmplela pasando por boxes."),
    "yellow": ("Yellow flag ahead, careful.", "Bandera amarilla delante, cuidado."),
    "double_yellow": ("Incident ahead, slow down, no overtaking.", "Incidente delante, reduce, no adelantes."),
    "sc": ("Safety car, safety car. No overtaking.", "Coche de seguridad. No se adelanta."),
    "sc_in": ("Safety car in this lap. Get ready for the restart.", "El coche de seguridad entra esta vuelta. Prepárate para la relanzada."),
    "fcy": ("Full course yellow. Slow down to the limit.", "Amarilla en todo el circuito. Baja al límite de velocidad."),
    "green": ("Green, green, green. Back to racing.", "Verde, verde. Volvemos a correr."),
    "blue": ("Blue flags. Let the leaders through.", "Banderas azules. Deja pasar a los líderes."),
    "faster_behind": ("Faster car coming up behind.", "Viene un coche más rápido por detrás."),
    "puncture": ("Puncture! Bring it back to the pits.", "¡Pinchazo! Vuelve a boxes."),
    "damage_front": ("We're seeing front damage. You'll have less grip at the front.", "Vemos daños delante. Tendrás menos agarre en el morro."),
    "damage_rear": ("Rear damage. The rear will be loose in fast corners.", "Daños detrás. La trasera irá suelta en curvas rápidas."),
    "damage_susp": ("Suspension damage. The car will pull to one side.", "Daño en la suspensión. El coche tirará hacia un lado."),
    "damage_engine": ("Engine damage. We're down on power.", "Daño en el motor. Hemos perdido potencia."),
    "big_crash": ("Are you okay? Talk to me.", "¿Estás bien? Háblame."),
    "fuel_low": ("Fuel is getting low. Two laps left.", "Vamos justos de gasolina. Quedan dos vueltas."),
    "fuel_critical": ("Fuel critical. Box this lap.", "Gasolina crítica. Entra esta vuelta."),
    "tyres_cold": ("Tyres are still cold, push to bring them in.", "Los neumáticos siguen fríos, aprieta para calentarlos."),
    "tyres_hot": ("Tyres are overheating. Look after them.", "Los neumáticos se están sobrecalentando. Cuídalos."),
    "tyres_worn": ("The tyres are going off. Consider a stop.", "Los neumáticos están cayendo. Piensa en parar."),
    "rain_coming": ("Rain expected in a few minutes.", "Se espera lluvia en unos minutos."),
    "rain_now": ("It's raining. Consider the wet tyres.", "Está lloviendo. Piensa en los de lluvia."),
    "drying": ("The track is drying. Slicks soon.", "La pista se está secando. Pronto slicks."),
    "car_ahead_pits": ("The car ahead is pitting.", "El coche de delante entra a boxes."),
    "car_behind_pits": ("The car behind is pitting.", "El coche de detrás entra a boxes."),
    "new_leader": ("We have a new leader.", "Hay un nuevo líder."),
    "catching": ("You're catching him. Keep it up.", "Le estás pillando. Sigue así."),
    "losing": ("He's closing on you. Defend.", "Se te está acercando. Defiende."),
    "min20": ("Twenty minutes to go.", "Quedan veinte minutos."),
    "min10": ("Ten minutes remaining.", "Quedan diez minutos."),
    "min5": ("Five minutes left. Give it everything.", "Quedan cinco minutos. Dalo todo."),
    "last_lap": ("Last lap. Bring it home.", "Última vuelta. Tráelo a casa."),
    "push": ("Push now, push.", "Aprieta ahora, aprieta."),
    "win": ("Yes! Get in there! You've won the race!", "¡Sí! ¡Has ganado la carrera! ¡Enorme!"),
    "podium": ("Great job. That's a podium.", "Muy buen trabajo. Es un podio."),
    "points": ("Good race. Well done.", "Buena carrera. Bien hecho."),
    "finish": ("Chequered flag. Cool down lap.", "Bandera a cuadros. Vuelta de enfriamiento."),
    "pole": ("Pole position! Fantastic lap.", "¡Pole position! Vuelta fantástica."),
    "session_end": ("That's the end of the session.", "Se acabó la sesión."),
    # the spotter
    "car_left": ("Car left.", "Coche a la izquierda."),
    "car_right": ("Car right.", "Coche a la derecha."),
    "three_wide": ("Three wide, you're in the middle.", "Tres en paralelo, vas en medio."),
    "clear": ("Clear.", "Libre."),
    "clear_left": ("Clear left.", "Libre a la izquierda."),
    "clear_right": ("Clear right.", "Libre a la derecha."),
}
for n in range(1, 25):
    LINES[f"pos_{n}"] = (f"You're P {en_n(n)}.", f"Vas P {es_n(n)}.")
for k in range(1, 21):
    t = k / 2
    LINES[f"ahead_{k}"] = (f"Gap to the car ahead, {en_secs(t)}.", f"El de delante está a {es_secs(t)}.")
    LINES[f"behind_{k}"] = (f"Car behind is {en_secs(t)} back.", f"El de detrás está a {es_secs(t)}.")


def render(lang: str) -> dict[str, float]:
    voice = VOICES / f"{VOICE[lang]}.onnx"
    out = OUT / lang
    out.mkdir(parents=True, exist_ok=True)
    durations: dict[str, float] = {}
    with tempfile.TemporaryDirectory() as tmp:
        for i, (key, (en, es)) in enumerate(LINES.items()):
            text = en if lang == "en" else es
            wav = Path(tmp) / f"{key}.wav"
            # a race engineer talks briskly: a little faster than the voice's default
            subprocess.run([str(PIPER), "-m", str(voice), "-f", str(wav), "--length_scale", "0.92", "--sentence_silence", "0.05"], input=text.encode(), check=True, capture_output=True)
            dst = out / f"{key}.webm"
            # mono Opus at 24 kb/s: a few KB a line (the radio filter takes the top and bottom off anyway)
            subprocess.run(
                ["ffmpeg", "-y", "-loglevel", "error", "-i", str(wav), "-af", "silenceremove=start_periods=1:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse", "-ac", "1", "-c:a", "libopus", "-b:a", "24k", str(dst)],
                check=True,
            )
            d = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(dst)], capture_output=True, text=True).stdout.strip()
            durations[key] = round(float(d or 0), 2)
            if i % 20 == 0:
                print(f"[radio] {lang} {i}/{len(LINES)}", flush=True)
    return durations


if __name__ == "__main__":
    langs = [sys.argv[sys.argv.index("--only") + 1]] if "--only" in sys.argv else ["en", "es"]
    manifest = {}
    for lang in langs:
        manifest[lang] = render(lang)
    prev = OUT / "radio.json"
    if prev.exists():
        old = json.loads(prev.read_text())
        old.update(manifest)
        manifest = old
    (OUT / "radio.json").write_text(json.dumps(manifest, separators=(",", ":")))
    total = sum(f.stat().st_size for f in OUT.rglob("*.webm"))
    print(f"[radio] {sum(len(v) for v in manifest.values())} lines, {total / 1024:.0f} KB", flush=True)
