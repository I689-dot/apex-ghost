shader_type spatial;
render_mode cull_disabled;
// Near trees: foliage and bark with wind sway (port of nearMaterial / windChunk in game/forest.ts and vegetation.ts).
// Vertex colours carry the baked occlusion, the instance colour the tree's brightness.

global uniform float wind_time;
global uniform float wind_strength;

uniform sampler2D albedo_tex : source_color, filter_linear_mipmap, repeat_enable;
uniform vec3 tint = vec3(1.0);
uniform vec2 uv_scale = vec2(1.0);
uniform vec2 uv_offset = vec2(0.0);
uniform float bend = 0.0004;
uniform float flutter = 0.05;
uniform bool leaf = true;

void vertex() {
	vec2 root = MODEL_MATRIX[3].xz;
	float ph = dot(root, vec2(0.071, 0.113));
	float t = wind_time;
	float h = max(VERTEX.y, 0.0);
	float gust = 0.6 + 0.4 * sin(t * 0.37 + ph * 0.2);
	float sway = (sin(t * 1.1 + ph) * 0.7 + sin(t * 2.3 + ph * 1.7) * 0.3) * gust * wind_strength;
	VERTEX.x += sway * h * h * bend;
	VERTEX.z += sway * 0.4 * h * h * bend;
	float f = sin(t * 6.5 + dot(VERTEX, vec3(2.3, 1.7, 2.9)) + ph) * flutter * wind_strength * min(h, 1.0);
	VERTEX += vec3(f, f * 0.5, -f * 0.7);
}

void fragment() {
	vec2 uv = UV * uv_scale + uv_offset;
	vec4 t = texture(albedo_tex, uv);
	if (leaf) {
		// alpha-tested foliage thins out with distance: scale alpha up with the mip level (Golus)
		vec2 ts = vec2(textureSize(albedo_tex, 0));
		vec2 dx = dFdx(uv * ts);
		vec2 dy = dFdy(uv * ts);
		float lod = clamp(0.5 * log2(max(dot(dx, dx), dot(dy, dy))), 0.0, 3.0);
		float a = t.a * (1.0 + lod * 0.1);
		if (a < 0.5) discard;
	}
	ALBEDO = t.rgb * tint * COLOR.rgb;
	ROUGHNESS = 1.0;
	SPECULAR = 0.0;
}
