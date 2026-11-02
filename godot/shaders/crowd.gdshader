shader_type spatial;
render_mode cull_disabled;
// One instanced draw call for the spectators (port of the patched Lambert material in game/crowd.ts): eight figures
// side by side in one texture, the figure picked by the instance's custom data.

uniform sampler2D people : source_color, filter_linear_mipmap, repeat_disable;
uniform float variants = 8.0;

varying float v_variant;

void vertex() {
	v_variant = INSTANCE_CUSTOM.x;
}

void fragment() {
	vec2 uv = vec2((UV.x + v_variant) / variants, UV.y);
	vec4 t = texture(people, uv);
	ALBEDO = t.rgb * COLOR.rgb;
	ALPHA = t.a;
	ALPHA_SCISSOR_THRESHOLD = 0.5;
	ROUGHNESS = 1.0;
}
