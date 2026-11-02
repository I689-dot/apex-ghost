shader_type spatial;
render_mode unshaded, cull_disabled;
// Bakes a tree into an alpha-cut impostor card: unlit albedo with the occlusion in the vertex colours.

uniform sampler2D albedo_tex : source_color, filter_linear_mipmap, repeat_enable;
uniform vec3 tint = vec3(1.0);
uniform vec2 uv_scale = vec2(1.0);
uniform vec2 uv_offset = vec2(0.0);
uniform bool leaf = true;

void fragment() {
	vec4 t = texture(albedo_tex, UV * uv_scale + uv_offset);
	if (leaf && t.a < 0.5) discard;
	ALBEDO = t.rgb * tint * COLOR.rgb;
}
