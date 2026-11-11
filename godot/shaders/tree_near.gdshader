shader_type spatial;
render_mode cull_disabled;
// Near trees: foliage and bark with wind sway (port of nearMaterial / windChunk in game/forest.ts and vegetation.ts).
// Vertex colours carry the baked occlusion, the instance colour the tree's brightness.

global uniform float wind_time;
global uniform float wind_strength;
global uniform vec3 tree_tint;
global uniform vec2 tree_bands;
// level blends (Forest.fades): x the layer (0 the full model, 1 the light one; < 0 no blend), y the hero range, z the near
// range (m); the bands' widths in tree_bands
instance uniform vec4 fade = vec4(-1.0, 0.0, 0.0, 0.0);
// the layer keeps the pixels whose dither value lies in [x, y): the layers of a blend share them out exactly
varying vec2 v_keep;

uniform sampler2D albedo_tex : source_color, filter_linear_mipmap, repeat_enable;
uniform vec3 tint = vec3(1.0);
uniform vec2 uv_scale = vec2(1.0);
uniform vec2 uv_offset = vec2(0.0);
uniform float bend = 0.0004;
uniform float flutter = 0.05;
uniform bool leaf = true;

float dither(vec2 p) {
	return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

void vertex() {
	vec2 root = MODEL_MATRIX[3].xz;
	v_keep = vec2(0.0, 1.0);
	if (fade.x >= 0.0) {
		float d = distance(root, CAMERA_POSITION_WORLD.xz);
		// the full model's share, and the far card's (tree_far.gdshader keeps [1 - card, 1))
		float full = 1.0 - smoothstep(fade.y - tree_bands.x, fade.y + tree_bands.x, d);
		float card = smoothstep(fade.z, fade.z + tree_bands.y, d);
		v_keep = fade.x < 0.5 ? vec2(0.0, full) : vec2(full, 1.0 - card);
	}
	float ph = dot(root, vec2(0.071, 0.113));
	float t = wind_time;
	float h = max(VERTEX.y, 0.0);
	float gust = 0.6 + 0.4 * sin(t * 0.37 + ph * 0.2);
	float sway = (sin(t * 1.1 + ph) * 0.7 + sin(t * 2.3 + ph * 1.7) * 0.3) * gust * wind_strength;
	VERTEX.x += sway * h * h * bend;
	VERTEX.z += sway * 0.4 * h * h * bend;
	float f = sin(t * 6.5 + dot(VERTEX, vec3(2.3, 1.7, 2.9)) + ph) * flutter * wind_strength * min(h, 1.0);
	VERTEX += vec3(f, f * 0.5, -f * 0.7);
	// wholly faded out: nothing left to draw
	if (v_keep.y <= v_keep.x) {
		VERTEX = vec3(0.0);
	}
}

void fragment() {
	// a level blend: the two layers keep complementary pixels (with TAA it reads as a smooth fade)
	if (v_keep.x > 0.0 || v_keep.y < 1.0) {
		float t = dither(FRAGCOORD.xy);
		if (t < v_keep.x || t >= v_keep.y) discard;
	}
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
	ALBEDO = t.rgb * tint * COLOR.rgb * tree_tint;
	ROUGHNESS = 1.0;
	SPECULAR = 0.0;
}
