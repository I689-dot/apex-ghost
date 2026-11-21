class_name ChatPanel
extends VBoxContainer
## Text chat in the race (iRacing: T to type, /rc for the admins): the last lines fade after a while, and an input line
## opens on the chat key (or the CHAT touch button). While it is open the car gets no input (RaceSession.chat_open).

signal submitted(text: String)
signal closed

const SHOW_LINES := 6
const FADE_AFTER_MS := 12000.0
const MAX_KEPT := 40

var _lines: Array = [] # [Label, shown_at_ms]
var _input := LineEdit.new()
var is_open := false

func _init() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_theme_constant_override("separation", 2)
	_input.max_length = Validation.CHAT_MAX_LEN
	_input.placeholder_text = I18n.t("Chat (/rc: message to the host)")
	_input.custom_minimum_size = Vector2(360, 0)
	_input.visible = false
	_input.text_submitted.connect(_on_submit)
	_input.gui_input.connect(func(e: InputEvent) -> void:
		if e is InputEventKey and e.pressed and e.keycode == KEY_ESCAPE:
			close()
			get_viewport().set_input_as_handled())
	add_child(_input)

## One line of chat: nick in the car's colour, then the text; rc lines (to the host) are marked.
func add_line(nick: String, text: String, rc: bool, colour: Color = Color.WHITE) -> void:
	var l := RichTextLabel.new()
	l.bbcode_enabled = true
	l.fit_content = true
	l.scroll_active = false
	l.custom_minimum_size = Vector2(420, 0)
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	l.add_theme_font_size_override("normal_font_size", 16)
	l.add_theme_font_size_override("bold_font_size", 16)
	l.add_theme_constant_override("outline_size", 4)
	l.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.85))
	l.text = "%s[b][color=#%s]%s[/color][/b]  %s" % ["[color=#ffd60a][RC][/color] " if rc else "", colour.to_html(false), _esc(nick), _esc(text)]
	add_child(l)
	move_child(l, get_child_count() - 2 if _input.get_parent() == self else -1)
	_lines.append([l, Time.get_ticks_msec()])
	while _lines.size() > MAX_KEPT:
		var old: Array = _lines.pop_front()
		old[0].queue_free()

## Text that can't open a tag of the label.
static func _esc(s: String) -> String:
	return s.replace("[", "[lb]")

func open() -> void:
	is_open = true
	_input.visible = true
	_input.text = ""
	_input.grab_focus()

func close() -> void:
	is_open = false
	_input.release_focus()
	_input.visible = false
	closed.emit()

func _on_submit(text: String) -> void:
	var t := text.strip_edges()
	if not t.is_empty():
		submitted.emit(t)
	close()

func _process(_dt: float) -> void:
	var now := Time.get_ticks_msec()
	var shown := 0
	for i in range(_lines.size() - 1, -1, -1):
		var l: RichTextLabel = _lines[i][0]
		var fresh: bool = now - float(_lines[i][1]) < FADE_AFTER_MS
		l.visible = (fresh or is_open) and shown < (SHOW_LINES if not is_open else MAX_KEPT / 4)
		if l.visible:
			shown += 1
