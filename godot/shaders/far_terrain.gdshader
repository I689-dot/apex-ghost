shader_type spatial;
render_mode cull_back;
// The Ardennes around Spa past the model's terrain (SpaFar; tools/asset-pipeline/spa_godot/build_far.py): real heights
// out to 9.5 km, coloured by land cover. cover holds fractions, not colours: R tree cover, G grass and shrub, B crops,
// A built-up, bare ground and water.

uniform sampler2D cover : filter_linear_mipmap, repeat_disable;
uniform vec3 c_tree = vec3(0.03, 0.042, 0.022);
uniform vec3 c_grass = vec3(0.08, 0.12, 0.04);
uniform vec3 c_crop = vec3(0.12, 0.12, 0.06);
uniform vec3 c_built = vec3(0.1, 0.1, 0.1);

varying vec3 v_w;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

void vertex() {
	v_w = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

void fragment() {
	vec4 f = texture(cover, UV);
	f /= max(f.r + f.g + f.b + f.a, 1e-3);
	// crowns and gaps in the forest, a field's grain: faded out with distance before it can shimmer
	float d = distance(v_w, CAMERA_POSITION_WORLD);
	float k = 1.0 - smoothstep(1500.0, 5000.0, d);
	float crowns = mix(1.0, 0.7 + 0.6 * noise(v_w.xz / 14.0) * (0.6 + 0.4 * noise(v_w.xz / 61.0)), k);
	float fields = mix(1.0, 0.85 + 0.3 * noise(v_w.xz / 90.0), k);
	ALBEDO = f.r * c_tree * crowns + f.g * c_grass * fields + f.b * c_crop * fields + f.a * c_built;
	ROUGHNESS = 1.0;
	SPECULAR = 0.1;
}
