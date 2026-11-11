shader_type spatial;
render_mode cull_disabled, skip_vertex_transform;
// Spa's spectators (SpaCrowd): scanned people as sprites (tools/asset-pipeline/spa_godot/render_people.py), one
// instanced draw. Each card turns about its upright to face the camera (seen along the track, a card facing the track
// showed edge-on); the figure and its view (front or 35 degrees either side) from the instance's custom data.

uniform sampler2D people : source_color, filter_linear_mipmap, repeat_disable;
uniform float columns = 10.0;
uniform float rows = 3.0;
// the sprites were rendered under an even white sky at 1.0 and a weak sun: brought to an albedo (clothes average ~0.25)
uniform float gain = 1.7;

varying vec2 v_cell;

void vertex() {
	vec3 origin = MODEL_MATRIX[3].xyz;
	float sc = length(MODEL_MATRIX[1].xyz);
	vec3 to = CAMERA_POSITION_WORLD - origin;
	to.y = 0.0;
	vec3 fwd = length(to) > 1e-4 ? normalize(to) : vec3(0.0, 0.0, 1.0);
	vec3 right = vec3(fwd.z, 0.0, -fwd.x);
	vec3 w = origin + right * VERTEX.x * sc + vec3(0.0, VERTEX.y * sc, 0.0);
	VERTEX = (VIEW_MATRIX * vec4(w, 1.0)).xyz;
	// lit half from the front, half from above: a flat card shaded as a figure would be on average
	NORMAL = normalize((VIEW_MATRIX * vec4(normalize(fwd + vec3(0.0, 1.0, 0.0)), 0.0)).xyz);
	v_cell = INSTANCE_CUSTOM.xy;
}

void fragment() {
	vec4 t = texture(people, vec2((UV.x + v_cell.x) / columns, (UV.y + v_cell.y) / rows));
	ALBEDO = t.rgb * COLOR.rgb * gain;
	ALPHA = t.a;
	ALPHA_SCISSOR_THRESHOLD = 0.5;
	ROUGHNESS = 1.0;
	SPECULAR = 0.2;
}
