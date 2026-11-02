class_name Weather
extends RefCounted
## Deterministic weather, time of day and temperatures from a seed (port of packages/shared/src/weather.ts).
## Every client and the server agree on the same plan. A plan and a state are Dictionaries with the TS field names.

const KINDS := ["clear", "cloudy", "overcast", "light_rain", "heavy_rain", "fog"]

const LABEL := {
	"clear": "Clear", "cloudy": "Cloudy", "overcast": "Overcast", "light_rain": "Light rain", "heavy_rain": "Heavy rain", "fog": "Fog",
}

const PARAMS := {
	"clear": {"clouds": 0.08, "rain": 0.0, "fog": 0.02},
	"cloudy": {"clouds": 0.45, "rain": 0.0, "fog": 0.05},
	"overcast": {"clouds": 0.9, "rain": 0.0, "fog": 0.12},
	"light_rain": {"clouds": 0.92, "rain": 0.35, "fog": 0.22},
	"heavy_rain": {"clouds": 1.0, "rain": 1.0, "fog": 0.4},
	"fog": {"clouds": 0.75, "rain": 0.0, "fog": 1.0},
}

const NEXT := {
	"clear": ["cloudy"], "cloudy": ["overcast", "light_rain", "clear"], "overcast": ["light_rain", "cloudy"],
	"light_rain": ["heavy_rain", "overcast"], "heavy_rain": ["light_rain"], "fog": ["cloudy", "overcast"],
}

const TIME_HOURS := {"dawn": 6.5, "morning": 9.5, "midday": 13.0, "afternoon": 16.5, "evening": 19.75, "night": 22.5}
const TIME_LABEL := {
	"random": "Random", "dawn": "Dawn 06:30", "morning": "Morning 09:30", "midday": "Midday 13:00",
	"afternoon": "Afternoon 16:30", "evening": "Evening 19:45", "night": "Night 22:30",
}

## Climate of each circuit: altitude, and the monthly average daily high / low (C) from May to September.
const CLIMATE := {
	"nurburgring": {"altitudeM": 620.0, "highLow": [[16, 7], [20, 11], [22, 12], [21, 13], [18, 10]]},
	"zandvoort": {"altitudeM": 5.0, "highLow": [[14, 10], [18, 13], [20, 16], [20, 16], [18, 14]]},
	"spa": {"altitudeM": 430.0, "highLow": [[17, 7], [20, 10], [22, 12], [21, 12], [18, 9]]},
}

static func _pick_weighted(rng: Prng, entries: Array) -> String:
	var total := 0.0
	for e in entries:
		total += e[1]
	var r := rng.next() * total
	for e in entries:
		r -= e[1]
		if r <= 0.0:
			return e[0]
	return entries[entries.size() - 1][0]

## Everything is derived from the seed (and the host's choices). opts: {weather, time, changes} (all optional).
static func plan_weather(seed_value: int, opts: Dictionary = {}) -> Dictionary:
	var rng := Prng.new(seed_value ^ 0x9e3779b9)
	var kind := _pick_weighted(rng, [["clear", 28], ["cloudy", 22], ["overcast", 14], ["light_rain", 15], ["heavy_rain", 10], ["fog", 11]])
	var rolled_hour := floorf((6.25 + rng.next() * 15.25) * 4.0 + 0.5) / 4.0 # 06:15 .. 21:30
	var day_of_year := 120 + int(floorf(rng.next() * 150.0)) # May .. late September
	var rolled_change := rng.next() < 0.35
	var w = opts.get("weather", "random")
	if w != null and w != "random":
		kind = w
	var t = opts.get("time", "random")
	var start_hour: float = TIME_HOURS[t] if t != null and t != "random" else rolled_hour
	var ch = opts.get("changes", "random")
	var has_change: bool = true if ch == "on" else (false if ch == "off" else rolled_change)
	var options: Array = NEXT[kind]
	var change = null
	if has_change:
		change = {
			"to": options[int(floorf(rng.next() * options.size()))],
			"atSec": 60 + int(floorf(rng.next() * 180.0)),
			"durationSec": 60 + int(floorf(rng.next() * 90.0)),
		}
	var damp_after_rain: bool = kind == "overcast" and rng.next() < 0.3
	var rain: float = PARAMS[kind].rain
	var initial_wetness: float = rain if rain > 0.0 else (0.35 if damp_after_rain else 0.0)
	return {"seed": seed_value, "startHour": start_hour, "timeScale": 6.0, "dayOfYear": day_of_year, "kind": kind, "change": change, "initialWetness": initial_wetness}

static func _smooth(x: float) -> float:
	return 0.0 if x <= 0.0 else (1.0 if x >= 1.0 else x * x * (3.0 - 2.0 * x))

static func _rain_at(plan: Dictionary, t: float) -> float:
	var a: float = PARAMS[plan.kind].rain
	if plan.change == null:
		return a
	var k := _smooth((t - plan.change.atSec) / plan.change.durationSec)
	return lerpf(a, PARAMS[plan.change.to].rain, k)

## Weather t seconds after the race start. Wetness integrates rain with a ~40 s soaking and ~240 s drying constant.
static func weather_at(plan: Dictionary, t_sec: float) -> Dictionary:
	var t := maxf(0.0, t_sec)
	var k := _smooth((t - plan.change.atSec) / plan.change.durationSec) if plan.change != null else 0.0
	var a: Dictionary = PARAMS[plan.kind]
	var b: Dictionary = PARAMS[plan.change.to] if plan.change != null else a
	var clouds := lerpf(a.clouds, b.clouds, k)
	var fog := lerpf(a.fog, b.fog, k)
	var rain := _rain_at(plan, t)
	var wet := maxf(plan.initialWetness, PARAMS[plan.kind].rain)
	var steps := mini(int(floorf(t)), 3600)
	for s in steps:
		var r := _rain_at(plan, s)
		wet += (r - wet) / 40.0 if r > wet else (r - wet) / 240.0
	var frac := t - steps
	if frac > 0.0:
		var r2 := _rain_at(plan, steps)
		wet += ((r2 - wet) / 40.0 if r2 > wet else (r2 - wet) / 240.0) * frac
	wet = clampf(wet, 0.0, 1.0)
	var hour := fmod(plan.startHour + (t * plan.timeScale) / 3600.0, 24.0)
	return {
		"hour": hour, "clouds": clouds, "rain": rain, "fog": fog, "wetness": wet,
		"grip": grip_from_wetness(wet, rain), "visibility": lerpf(6000.0, 140.0, pow(fog, 0.8)),
	}

static func grip_from_wetness(wetness: float, rain: float) -> float:
	return 1.0 - 0.27 * wetness - 0.05 * rain * wetness

## Solar elevation/azimuth in radians for Nuerburg (50.33 N, 6.94 E), CEST clock. Returns {elevation, azimuth}.
static func sun_position(day_of_year: float, hour: float) -> Dictionary:
	var lat := deg_to_rad(50.335)
	var decl := deg_to_rad(-23.44) * cos(((2.0 * PI) / 365.0) * (day_of_year + 10.0))
	var solar_hour := hour - 2.0 + 6.94 / 15.0
	var ha := deg_to_rad((solar_hour - 12.0) * 15.0)
	var sin_el := sin(lat) * sin(decl) + cos(lat) * cos(decl) * cos(ha)
	var elevation := asin(sin_el)
	var cos_az := (sin(decl) - sin(elevation) * sin(lat)) / (cos(elevation) * cos(lat))
	var azimuth := acos(clampf(cos_az, -1.0, 1.0))
	if ha > 0.0:
		azimuth = 2.0 * PI - azimuth
	return {"elevation": elevation, "azimuth": azimuth}

static func format_hour(hour: float) -> String:
	var h := int(floorf(hour)) % 24
	var m := int(floorf((hour - floorf(hour)) * 60.0))
	return "%02d:%02d" % [h, m]

## Air and track temperature and air density for the forecast at this moment. Returns {airC, trackC, airDensity}.
static func temperatures(plan: Dictionary, w: Dictionary, map_id: String = "nurburgring") -> Dictionary:
	var c: Dictionary = CLIMATE.get(map_id, CLIMATE.nurburgring)
	var month := clampi(int(floorf((plan.dayOfYear - 121) / 30.5)), 0, 4)
	var hl: Array = c.highLow[month]
	var high: float = hl[0]
	var low: float = hl[1]
	var anomaly := (Prng.new(plan.seed ^ 0x51ed270b).next() - 0.5) * 7.0
	var h := fposmod(fposmod(w.hour, 24.0) + 24.0, 24.0)
	var day: float
	if h >= 5.0 and h <= 15.0:
		day = 0.5 - 0.5 * cos((PI * (h - 5.0)) / 10.0)
	else:
		day = 0.5 + 0.5 * cos(PI * (fposmod(h - 15.0 + 24.0, 24.0) / 14.0))
	var mean := (high + low) / 2.0
	var amp := ((high - low) / 2.0) * (1.0 - 0.5 * w.clouds)
	var air_c: float = mean + anomaly + amp * (2.0 * day - 1.0) - 2.5 * w.rain
	var sun := maxf(0.0, sin(sun_position(plan.dayOfYear, h).elevation))
	var dry: float = 1.0 - w.wetness
	var track_c: float = air_c + dry * (2.0 + 20.0 * pow(sun, 0.8) * (1.0 - 0.8 * w.clouds))
	var pressure := 101325.0 * exp(-c.altitudeM / 8434.0)
	return {"airC": air_c, "trackC": track_c, "airDensity": pressure / (287.05 * (air_c + 273.15))}
