shader_type spatial;
render_mode unshaded, blend_mul, depth_draw_never, cull_disabled, fog_disabled;
// Lived-in asphalt as one multiplicative decal over the road (port of the shader in game/roadWear.ts).
// UV = (metres from the centreline, racing line offset); UV2.x = lap distance; COLOR = (braking, cornering) wear.

uniform float strength = 1.0;
uniform float fade_dist = 260.0;
uniform float wet = 0.0;

varying float v_dist;

float h1(float x) { return fract(sin(x * 127.1) * 43758.5453); }
float n1(float x) { float i = floor(x); float f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(h1(i), h1(i + 1.0), f); }

void vertex() {
	v_dist = -(MODELVIEW_MATRIX * vec4(VERTEX, 1.0)).z;
}

void fragment() {
	float v_lat = UV.x;
	float v_s = UV2.x;
	float d = v_lat - UV.y;                       // metres from the racing line
	float brake_w = COLOR.r;
	float corner_w = COLOR.g;
	// the line wanders a little lap after lap
	d += (n1(v_s / 23.0) - 0.5) * 0.6;
	float band = 1.0 - smoothstep(0.6, 1.9 + brake_w * 0.6, abs(d));
	// two wheel tracks ~1.6 m apart
	float tracks = exp(-pow((abs(d) - 0.8) / 0.32, 2.0));
	float dark = band * (0.12 + 0.1 * corner_w) + tracks * band * (0.08 + 0.18 * brake_w);
	// skid streaks in braking zones: thin lines along the lap, broken up
	float lane = floor((d + 3.0) / 0.22);
	float streak = step(0.72, h1(lane * 7.13 + floor(v_s / 9.0))) * smoothstep(0.25, 0.0, abs(fract((d + 3.0) / 0.22) - 0.5) - 0.18);
	streak *= n1(v_s / 3.1 + lane) * brake_w * (1.0 - smoothstep(1.2, 2.6, abs(d)));
	dark += streak * 0.32;
	// marbles and dust just off the line in fast corners: a faint, smooth darkening
	float off = smoothstep(1.6, 2.6, abs(d)) * (1.0 - smoothstep(3.0, 5.0, abs(d)));
	dark += off * corner_w * n1(v_s / 1.7 + floor(v_lat)) * 0.06;
	// repair patches: newer (darker) or older (lighter) asphalt rectangles every so often
	float cell = floor(v_s / 37.0);
	float has_patch = step(0.91, h1(cell * 3.7));
	float p0 = h1(cell * 9.1) * 30.0 + 3.0;
	float pl = 3.0 + h1(cell * 5.3) * 9.0;
	float pc = (h1(cell * 2.9) - 0.5) * 8.0;
	float pw = 1.5 + h1(cell * 4.1) * 3.5;
	float s_in = mod(v_s, 37.0);
	float in_patch = has_patch * smoothstep(p0, p0 + 0.15, s_in) * (1.0 - smoothstep(p0 + pl - 0.15, p0 + pl, s_in))
		* (1.0 - smoothstep(pw - 0.1, pw, abs(v_lat - pc)));
	float patch_tone = h1(cell * 6.6) < 0.6 ? 0.07 : -0.04;
	dark += in_patch * patch_tone;
	float fade = 1.0 - smoothstep(fade_dist * 0.55, fade_dist, v_dist);
	float k = clamp(dark * strength * fade * (1.0 - 0.35 * wet), -0.2, 0.6);
	ALBEDO = vec3(1.0 - k);
	ALPHA = 1.0;
}
