class_name Tyres
extends RefCounted
## Tyre compounds and wear (port of physics/tyres.ts). Compound ids: soft, medium, hard, wet.

const COMPOUNDS := {
	"soft": {"id": "soft", "name": "Soft", "letter": "S", "colour": "#ff3b30", "grip": 1.035, "wetGrip": 0.52, "wear": 1.9, "optimumC": 80.0, "heatCap": 0.85},
	"medium": {"id": "medium", "name": "Medium", "letter": "M", "colour": "#ffd60a", "grip": 1.0, "wetGrip": 0.52, "wear": 1.0, "optimumC": 85.0, "heatCap": 1.0},
	"hard": {"id": "hard", "name": "Hard", "letter": "H", "colour": "#f2f2f2", "grip": 0.965, "wetGrip": 0.5, "wear": 0.55, "optimumC": 92.0, "heatCap": 1.15},
	"wet": {"id": "wet", "name": "Wet", "letter": "W", "colour": "#3a86ff", "grip": 0.86, "wetGrip": 0.8, "wear": 0.7, "optimumC": 60.0, "heatCap": 0.9},
}

## Tread lost per joule of sliding energy.
const WEAR_PER_J := 9e-8

static func compound_grip(c: Dictionary, wetness: float, rain: float) -> float:
	var base: float = c.grip * (1.0 - wetness) + c.wetGrip * wetness
	var aqua := 0.0 if c.id == "wet" else 0.08 * rain * wetness
	return base - aqua

static func wear_rate(c: Dictionary, wetness: float) -> float:
	if c.id == "wet":
		return c.wear * (0.6 + 3.5 * (1.0 - wetness))
	return c.wear * (1.0 - 0.5 * wetness)

static func wear_grip(wear: float) -> float:
	return 1.0 - 0.16 * pow(minf(1.0, wear), 1.6)

static func compound_for_weather(wetness: float) -> String:
	return "wet" if wetness > 0.35 else "medium"
