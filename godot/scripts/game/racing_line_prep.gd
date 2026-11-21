class_name RacingLinePrep
extends RefCounted
## The racing line is optimised in a thread meanwhile the session loads (port of game/racingLinePrep.ts and its worker):
## start(track) begins the job, finish(task) awaits its result (the line, or null on failure).

class Task:
	extends RefCounted
	var thread := Thread.new()
	var result: Variant = null
	var done := false

static func start(track: Dictionary) -> Task:
	var t := Task.new()
	t.thread.start(func() -> void:
		# the layout's optimised line when it has one (data/racelines), else the minimum curvature one
		var f := AiDriver.line_from_file(track)
		t.result = f if not f.is_empty() else AiDriver.build_racing_line(track)
		t.done = true)
	return t

static func finish(t: Task) -> Variant:
	var tree := Engine.get_main_loop() as SceneTree
	while not t.done:
		await tree.process_frame
	t.thread.wait_to_finish()
	return t.result
