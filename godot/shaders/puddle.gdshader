// A puddle on the road (WetFx): an ellipse of still water over the asphalt, its edge broken up by noise, mirror-smooth
// so it reflects the sky, with rings spreading from raindrops while it rains. INSTANCE_CUSTOM.r = depth, .g = seed.
shader_type spatial;
render_mode blend_mix, depth_draw_never, cull_disabled, specular_schlick_ggx;

uniform float level = 1.0;
uniform float rain = 0.0;

varying float v_depth;
varying float v_seed;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
	vec2 i = floor(p), f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}

void vertex() {
	v_depth = INSTANCE_CUSTOM.r;
	v_seed = INSTANCE_CUSTOM.g;
}

// one cell of raindrop rings: a drop at a random point and time, its ring spreading and fading
vec2 ripple(vec2 p, float t) {
	vec2 cell = floor(p);
	vec2 f = fract(p);
	vec2 n = vec2(0.0);
	for (int y = -1; y <= 1; y++) {
		for (int x = -1; x <= 1; x++) {
			vec2 c = cell + vec2(float(x), float(y));
			vec2 centre = c + vec2(hash(c), hash(c + 7.3));
			float phase = fract(t * 1.3 + hash(c + 3.1));
			vec2 d = p - centre;
			float r = length(d);
			float ring = phase * 0.8;
			float w = smoothstep(0.08, 0.0, abs(r - ring)) * (1.0 - phase);
			n += normalize(d + 1e-4) * w * sin((r - ring) * 60.0);
		}
	}
	return n;
}

void fragment() {
	vec2 uv = UV * 2.0 - 1.0;
	float grow = 0.35 + 0.65 * level;
	float r = length(uv / grow);
	float edge = r + (noise(uv * 3.0 + v_seed * 17.0) - 0.5) * 0.45;
	float mask = smoothstep(1.0, 0.7, edge) * clamp(level * 2.0, 0.0, 1.0);
	if (mask < 0.01) discard;
	ALBEDO = vec3(0.02, 0.022, 0.025);
	ROUGHNESS = 0.03;
	METALLIC = 0.0;
	SPECULAR = 0.9;
	if (rain > 0.02) {
		vec2 world = (INV_VIEW_MATRIX * vec4(VERTEX, 1.0)).xz;
		vec2 rn = ripple(world * 2.2, TIME) * rain;
		NORMAL = normalize(NORMAL + (VIEW_MATRIX * vec4(rn.x, 0.0, rn.y, 0.0)).xyz * 0.35);
	}
	ALPHA = mask * (0.55 + 0.4 * clamp(v_depth, 0.0, 1.0));
}
