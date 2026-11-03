shader_type spatial;
render_mode unshaded, blend_mul, depth_draw_never, fog_disabled;
// World-space detail over the track's ground, multiplied onto the lit surface (port of addMacroVariation in
// game/track.ts: as racing games break texture tiling): two octaves of value noise metres to tens of metres across, a
// dry / lush hue drift on grass, the mown lawn's photo detail with mowing stripes, the asphalt's aggregate, pebbles on
// gravel. kind: 0 grass, 1 gravel, 2 paved, 3 asphalt.

global uniform float shell_ground;

uniform int kind = 2;
uniform float strength = 0.22;
uniform bool hue = false;
uniform float detail = 0.2;
uniform sampler2D detail_tex : filter_linear_mipmap_anisotropic, repeat_enable;
uniform vec3 detail_mean = vec3(0.5);

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
	vec2 wp = v_w.xz;
	float n = noise(wp / 37.0) * 0.65 + noise(wp / 9.0) * 0.35;
	vec3 f = vec3(1.0 + (n - 0.5) * strength * 2.0);
	if (hue) {
		float d = noise(wp / 61.0 + 7.3);
		f *= mix(vec3(1.0), vec3(1.12, 1.04, 0.78), smoothstep(0.55, 0.9, d) * 0.6);
	}
	mat2 rot = mat2(vec2(0.8, 0.6), vec2(-0.6, 0.8));
	if (kind == 0 && detail > 0.0) {
		vec3 g = texture(detail_tex, wp / 3.2).rgb * 0.65 + texture(detail_tex, rot * wp / 11.3 + 0.37).rgb * 0.35;
		vec3 gr = g / max(detail_mean, vec3(0.02));
		gr = mix(vec3(dot(gr, vec3(0.3, 0.5, 0.2))), gr, 0.7);
		f *= mix(vec3(1.0), gr, min(1.0, detail * 2.7));
		// mowing stripes, 6 m wide, the blades of each laid the opposite way: a band looks light seen with the grain and
		// dark against it, so the pattern changes with the viewing direction like on a real circuit
		vec2 sd = vec2(0.8, 0.6);
		float s = fract(dot(wp, sd) / 12.0);
		float lay = (smoothstep(0.0, 0.03, s) - smoothstep(0.5, 0.53, s)) * 2.0 - 1.0;
		vec3 v = normalize(v_w - CAMERA_POSITION_WORLD);
		float along = dot(normalize(v.xz + vec2(1e-4)), sd);
		f *= 1.0 + lay * (0.06 + 0.13 * along * (1.0 - abs(v.y) * 0.6));
		// a lusher, deeper green
		// (the lawn's colour itself is the base material's tint, GroundDetail.LAWN_TINT)
		// under the 3D blades near the camera (grass shells): soil and shade between them
		if (shell_ground > 0.0) f *= 1.0 - 0.12 * (1.0 - smoothstep(shell_ground * 0.5, shell_ground, distance(v_w, CAMERA_POSITION_WORLD)));
	} else if (kind == 3 && detail > 0.0) {
		// photo asphalt: the aggregate at two scales
		vec3 a1 = texture(detail_tex, wp / 3.8).rgb;
		vec3 a2 = texture(detail_tex, rot * wp / 11.3 + 0.41).rgb;
		float alb = (a1.r * 0.62 + a2.r * 0.38) - 0.5;
		f *= 1.0 + alb * detail * 4.5;
	} else if (detail > 0.0) {
		float fine = kind == 1 ? 0.32 : 1.6;
		float coarse = kind == 1 ? 1.25 : 7.3;
		float g = texture(detail_tex, wp / fine).r * 0.6 + texture(detail_tex, wp / coarse + 0.37).r * 0.4;
		f *= 1.0 + (g - 0.5) * detail * 2.0;
	}
	ALBEDO = f;
	ALPHA = 1.0;
}
