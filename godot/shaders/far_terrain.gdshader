shader_type spatial;
render_mode cull_back;
// The Ardennes around Spa past the model's terrain (SpaFar; tools/asset-pipeline/spa_godot/build_far.py): real heights
// out to 9.5 km, coloured by land cover. cover holds fractions, not colours: R tree cover, G grass and shrub, B crops,
// A built-up, bare ground and water.

uniform sampler2D cover : filter_linear_mipmap, repeat_disable;
// fitted to the video's hills after Blanchimont (f055: 40 / 49 / 39 sRGB, the haze in it)
uniform vec3 c_tree = vec3(0.04, 0.052, 0.034);
uniform vec3 c_grass = vec3(0.08, 0.12, 0.04);
uniform vec3 c_crop = vec3(0.12, 0.12, 0.06);
uniform vec3 c_built = vec3(0.1, 0.1, 0.1);
// the parts of A that are water and bare ground (far_cover2.png: R water, G bare; the North Sea and the dunes at
// Zandvoort); without it A is all c_built
uniform sampler2D cover2 : filter_linear_mipmap, repeat_disable;
uniform bool has_cover2 = false;
// the North Sea seen from the shore: a dark grey-green that the sky's reflection lightens towards the horizon
uniform vec3 c_water = vec3(0.012, 0.024, 0.03);
uniform vec3 c_sand = vec3(0.36, 0.32, 0.24);

varying vec3 v_w;
varying vec3 v_n;

// the forest as crowns: one per cell of a jittered grid this many metres across, a dome lit by the sun, the gaps between
// them in shade; faded to the average where a crown gets smaller than a few pixels (it would shimmer)
uniform float crown_m = 5.5;
uniform vec3 c_tree_light = vec3(0.062, 0.078, 0.045);

vec2 hash2(vec2 p) {
	p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
	return fract(sin(p) * 43758.5453);
}

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

void vertex() {
	v_w = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	v_n = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);
}

void fragment() {
	vec4 f = texture(cover, UV);
	vec3 g = has_cover2 ? texture(cover2, UV).rgb : vec3(0.0);
	float sum = max(f.r + f.g + f.b + f.a, 1e-3);
	f /= sum;
	g /= sum;
	float water = clamp(g.r, 0.0, f.a);
	float bare = clamp(g.g, 0.0, f.a - water);
	float built = f.a - water - bare;
	// crowns and gaps in the forest, a field's grain: faded out with distance before it can shimmer
	float d = distance(v_w, CAMERA_POSITION_WORLD);
	float k = 1.0 - smoothstep(1500.0, 5000.0, d);
	float crowns = mix(1.0, 0.7 + 0.6 * noise(v_w.xz / 14.0) * (0.6 + 0.4 * noise(v_w.xz / 61.0)), k);
	float fields = mix(1.0, 0.85 + 0.3 * noise(v_w.xz / 90.0), k);
	// the nearest crown: its offset from this point and its own shade
	vec2 q = v_w.xz / crown_m;
	vec2 cell = floor(q);
	vec2 best = vec2(0.0);
	float bd = 8.0;
	vec2 bid = cell;
	for (int j = -1; j <= 1; j++) {
		for (int i = -1; i <= 1; i++) {
			vec2 c = cell + vec2(float(i), float(j));
			vec2 o = c + 0.15 + 0.7 * hash2(c) - q;
			float d = dot(o, o);
			if (d < bd) {
				bd = d;
				best = o;
				bid = c;
			}
		}
	}
	float r = 0.62 + 0.25 * hash2(bid + 3.1).x;
	float inside = 1.0 - smoothstep(r * 0.75, r, sqrt(bd));
	float px = length(fwidth(v_w.xz)) / crown_m;
	float detail = (1.0 - smoothstep(0.08, 0.35, px)) * f.r;
	vec3 crown = mix(c_tree, c_tree_light, hash2(bid).y) * mix(0.35, 1.0, inside);
	vec3 tree_col = mix(c_tree * crowns, crown, detail);
	ALBEDO = f.r * tree_col + f.g * c_grass * fields + f.b * c_crop * fields + built * c_built + bare * c_sand * fields + water * c_water;
	// the dome: tilted away from its centre, flat in the gaps
	vec3 nw = normalize(v_n + vec3(-best.x, 0.0, -best.y) / max(r, 0.2) * 0.9 * inside * detail);
	// the sea: flat, swell and chop as a slope (two drifting noises), faded out far off where it would shimmer
	if (water > 0.01) {
		float t = TIME;
		vec2 p = v_w.xz;
		float e = 0.6;
		vec2 a = p / 23.0 + vec2(t * 0.05, t * 0.03);
		vec2 b = p / 7.0 - vec2(t * 0.11, -t * 0.07);
		vec2 slope = vec2(noise(a + vec2(e, 0.0)) - noise(a - vec2(e, 0.0)), noise(a + vec2(0.0, e)) - noise(a - vec2(0.0, e))) * 0.5
			+ vec2(noise(b + vec2(e, 0.0)) - noise(b - vec2(e, 0.0)), noise(b + vec2(0.0, e)) - noise(b - vec2(0.0, e))) * 0.25;
		slope *= 1.0 - smoothstep(800.0, 4000.0, d);
		nw = normalize(mix(nw, normalize(vec3(-slope.x, 1.0, -slope.y)), water));
	}
	NORMAL = normalize((VIEW_MATRIX * vec4(nw, 0.0)).xyz);
	ROUGHNESS = mix(1.0, 0.12, water);
	SPECULAR = mix(0.1, 0.5, water);
}
