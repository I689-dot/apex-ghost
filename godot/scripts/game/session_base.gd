class_name SessionBase
extends Node3D
## RaceSession's first layer: its state (every field and constant, the cars' records Remote and LocalBot) and the small
## helpers every other layer uses. The session is split in layers, each a file extending the one below, so each
## subsystem reads on its own and the session stays one object (the order: session_base, then the subsystems, then
## race_session.gd on top, which runs the session). A layer can call what it and the layers below it declare.
##
## The session is a Node3D holding the world: track, environment, my car (a Jolt Vehicle with a CarVisual
## child, interpolated by the engine), the bots I simulate (also Vehicles), the other drivers' cars (CarVisuals driven by
## RemoteCarBuffer), cameras and the HUD. Optional subsystems (cinematic, TV cameras, audio, grass,
## forest ...) are plain fields that stay null until their module attaches: every use is guarded.

## The physics step: 120 Hz (a phone runs 60: the sim holds its lap time within 0.3 %, see tests/ailap.gd).
var FIXED_DT := 1.0 / float(Engine.physics_ticks_per_second)
var STEPS_PER_SAMPLE := maxi(1, Engine.physics_ticks_per_second / 20) # physics Hz / STATE_HZ
const MAX_FRAME_DT := 0.1
## How far a bot moves over to pass a slower car (m).
const PASS_OFFSET := 3.6
## AI cars leave the grid one at a time, this far apart (qualifying: no rolling start).
const BOT_RELEASE_MS := 1000.0
## The tyres leave the pits this much above the air's temperature: no tyre warmers (°C).
const TYRE_OUT_C := 12.0
## Contact rule: a car simulated elsewhere is a stand-in here with its real mass, driven every step to where the
## prediction puts it (velocity towards that pose, PROXY_TAU_S).
const PROXY_TAU_S := 0.06
const PROXY_SNAP_M := 3.0
const PROXY_PULL_MS := 12.0
const BUMP_MIN := 300.0
const BUMP_SEND_MS := 60.0
const BUMP_DEDUPE_MS := 500.0
var RESCUE_STEPS := maxi(1, Engine.physics_ticks_per_second / 10)
## The bots' driving decisions per second (their physics runs at every step), and the physics steps per decision.
const AI_HZ := 60
var AI_DIV := maxi(1, Engine.physics_ticks_per_second / AI_HZ)
const FCY_MS := 80.0 / 3.6
## Maps whose pit lane gets our own surface: Zandvoort's model draws it near-white.
const PIT_SURFACE_MAPS := ["zandvoort"]
## What race control's penalties are for (the drive-through announcements).
const PENALTY_TEXT := {
	"track-limits": "track limits", "reset": "reset", "shortcut": "shortcut",
	"overtake-sc": "overtaking under the safety car", "overtake-fcy": "overtaking under the full-course yellow",
	"overtake-yellow": "overtaking under yellow flags", "passed-sc": "overtaking the safety car",
	"blue-flags": "ignoring blue flags", "missed-stop": "no mandatory stop", "unserved": "drive-through not served",
}

## Another driver's car: a human's (buffer-driven) or a bot I simulate (bot != null).
class Remote:
	extends RefCounted
	var id: String
	var slot: int
	var entry: Dictionary
	var visual: CarVisual
	var buffer := RemoteCarBuffer.new()
	var damage := DamageState.new()
	## Last known velocity (for engine pitch and Doppler).
	var vel := Vector3.ZERO
	## Set on the host for bots: simulated here and streamed to everyone else.
	var bot: LocalBot = null
	## Contact rule: its stand-in body, and the velocity set before the last solver step.
	var body: RigidBody3D = null
	var set_v := Vector3.ZERO
	## The stand-in jumped and passes through cars until clear of them.
	var ghosted := false
	## Impulse it took from a car simulated here, not yet sent (N*s, world; yaw N*m*s), from whom, last sent.
	var bump := Vector3.ZERO
	var bump_yaw := 0.0
	var bump_from := ""
	var bump_sent := 0.0

class LocalBot:
	extends RefCounted
	var vehicle: Vehicle
	var ai: AiDriver
	var pending: Array = [CarState.new(), CarState.new()]
	var pending_count := 0
	var seq := 0
	var reset_flag_samples := 0
	var limits := TrackLimits.new()
	var hint := -1
	## Seconds left before a pass manoeuvre is given up (traffic cleared).
	var pass_hold := 0.0
	## Whether the driver has decided since its start (the first decision after the green light is not held back).
	var decided := false
	var pit: PitLaneMonitor = null
	var stop_lap := 0
	var service_end := 0.0
	var service_plan: Variant = null
	var service_start := 0.0
	var service_events: Variant = null
	var fired := 0
	var lift := 0.0
	var exit_at := 0.0
	var pit_sent := false

## Callbacks the app supplies: on_countdown_text(text, sub), on_pause_toggle(open), on_replay_toggle(open),
## on_results(msg), on_fatal(message), audio() (the GameAudio).
var cb: Dictionary = {}
var conn: Connection
var race: Dictionary
var room: Dictionary
var me: String
var cars_file: Dictionary
var spectator := false
var contact := false
var side_screens: SideScreens
## Damage at which a part comes off (its zone's value), and the jump in one hit that tears it off sooner.
const TEAR_AT := {"bumper_front": [0, 0.45], "bumper_rear": [1, 0.45], "wing": [1, 0.7]}
const TEAR_JUMP := 0.25

var track: TrackScene
var track_data: Dictionary
var env: GameEnvironment
var vehicle: Vehicle
var my_visual: CarVisual
var cockpit: CockpitCamera
var chase := ChaseCamera.new()
var remotes := {} # slot -> Remote
var kb: KeyboardInput
var smoother := InputSmoother.new()
var damage := DamageState.new()
var hud: Hud
var local_tracker: RaceTracker = null
var names := {}
var numbers := {}
var standings: Array = []
var running := false
var step_count := 0
var start_at: Variant = null
var seq := 0
var pending: Array = [CarState.new(), CarState.new()]
var pending_count := 0
var reset_flag_samples := 0
var career := {"km": 0.0, "laps": 0, "cleanLaps": 0, "pbs": 0, "incidents": 0, "lapIncidents": 0}
var freeze_until := 0.0
var last_reset_at := -1e9
var wrong_way_time := 0.0
var stuck_time := 0.0
var weather: Dictionary
var weather_timer := 0.0
var headlights_on := false
var last_damage_sent := 0.0
var damage_version_sent := 0
var paused := false
var air: Dictionary = {"airC": 20.0, "trackC": 25.0, "airDensity": 1.2}

# my race progress (from server events)
var my_laps := 0
var lap_times: Array = []
var best_lap: Variant = null
var best_sectors: Array = []
var sector_delta: Variant = null
var sector_delta_until := 0.0
var finished_ms: Variant = null
var limits := TrackLimits.new()
var lap_delta: LapDelta = null
var live_delta: Variant = null
## Something spoiled the sector being driven (a penalty, a reset, the pits): it can't become a best sector.
var sector_dirty := false
## Text chat (rooms this game hosts): the panel, and whether its input line is open (the car then gets no input).
var chat: ChatPanel = null
var chat_open := false
var chat_closed_frame := -1
## Replay (game/replay.gd): the last minutes of every car, watched from a camera of its own while the race goes on.
const REPLAY_CAMERAS := ["Chase camera", "TV cameras", "Front camera"]
var replay := Replay.new()
var replay_open := false
var replay_playing := true
var replay_speed := 1.0
var replay_t := 0.0
var replay_car := 0
var replay_cam_mode := 0
var replay_cam: Camera3D = null
var ghost := BestLapGhost.new()
var ghost_visual: CarVisual = null
var ghost_loading := false
var wake_cars: Array = []
var message := ""
var message_until := 0.0
## What a message is about (the HUD's colour tag): info, lap, pb, best, good, warn, bad, flag; "osd" is a small note
## over the speedometer (camera, gearbox), not a message.
var message_kind := "info"
## Race control's flags and course state (from the server).
var rc: Dictionary = RaceControl.green_state(0)
var green_until := 0.0
var sc_path: Variant = null
var sc_park: Variant = null
var sc: Variant = null # {visual, body, s, speed, vel, visible, solid, look}
var last_contact := {}
var hit_at := {}
var fuel_per_lap := 0.0
var fuel_at_lap: Variant = null
var flagged := false
var pit: PitLaneMonitor = null
var pit_menu: PitMenu = null
var pit_hold := false
var service: Variant = null
var jack_lift := 0.0
var loc := {"s": 0.0, "dot": 1.0, "index": 0, "lateral": 0.0}
var map_timer := 0.0
var rel_hints := {}
var countdown_shown := ""
var spec_target := ""
var spec_cam := Camera3D.new()
var spec_cam_init := false
var tv_view := false
var spec_tv := true
var pit_cam := Camera3D.new()
var pit_cam_on := false
var pit_cam_t := 0.0

# optional subsystems, attached by their modules
var cinematic: Cinematic = null
var snd: SessionAudio = null
var tv: TvCameras = null
var tv_on := false
var racing_line: RacingLineFx = null
var road_wear: RoadWear = null
var mirror: RearMirror = null
var windshield: WindshieldFx = null
var dash: DashDisplays = null
var crash_fx: CrashFx = null
var forest: Forest = null
var shells: GrassShells = null
## Puddles on a wet track (felt by every car's tyres) and the spray behind each car.
var wet_fx: WetFx = null
var sprays := {}
var blades: GrassBlades = null
var timing: TimingScreen

## Dev: a driver for my car (tests: the AI drives it).
var autodrive: AiDriver = null

func _init(race_setup: Dictionary, room_snapshot: Dictionary, my_id: String, cars: Dictionary, connection: Connection, callbacks: Dictionary, watching: bool = false) -> void:
	race = race_setup
	room = room_snapshot
	me = my_id
	cars_file = cars
	conn = connection
	cb = callbacks
	spectator = watching
	name = "race_session"
	kb = KeyboardInput.new(Settings.data.bindings)
	for p: Dictionary in room.players:
		names[p.id] = p.nick
		if p.get("num") != null:
			numbers[p.id] = p.num
	contact = bool(race.get("rules", {}).get("contact", false)) and not spectator

func car_number(id: String) -> Variant:
	return numbers.get(id)

## An incident (iRacing's points: off track 1, a wall 2, contact or a reset 4).
func incident(points: int) -> void:
	career.incidents += points
	career.lapIncidents += points

## What this session gave the career (read before the session is disposed).
func career_stats() -> Dictionary:
	var c := career
	var turns: Variant = track_data.get("turns")
	return {"km": c.km, "laps": c.laps, "cleanLaps": c.cleanLaps, "corners": c.laps * (turns if turns != null else 12), "incidents": c.incidents, "personalBests": c.pbs}

## The race's laps: set, or for a timed race what fits in its time at a GT3's pace here.
func race_laps() -> int:
	var ms: float = race.get("raceMs", 0)
	if ms <= 0.0:
		return race.laps
	var lap_ms: float = (track_data.length / 43.0) * 1000.0
	return maxi(1, ceili(ms / lap_ms) + 1)

## A timed race's pit window (server ms, when the pit entry must be crossed), or null.
func pit_window_ms() -> Variant:
	var ms: float = race.get("raceMs", 0)
	if ms == 0.0 or start_at == null or not race.get("rules", {}).get("pitWindow", false):
		return null
	return {"open": start_at + ms * RaceTracker.PIT_WINDOW.timedOpenShare, "close": start_at + ms * RaceTracker.PIT_WINDOW.timedCloseShare}

func remote_by_id(id: String) -> Remote:
	for r: Remote in remotes.values():
		if r.id == id:
			return r
	return null

func flash(msg: String, ms: float = 2500.0, kind: String = "info") -> void:
	message = msg
	message_kind = kind
	message_until = Time.get_ticks_msec() + ms
