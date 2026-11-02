shader_type spatial;
render_mode cull_disabled, skip_vertex_transform;
// Real blades over the verge's lawn (High / Ultra; port of the material in game/grassBlades.ts): positions in static
// buffers per stretch of track, swayed, bent by passing cars and faded into the shells by the vertex shader.

uniform float u_time = 0.0;
uniform vec2 u_wind = vec2(1.0, 0.0);
uniform vec3 u_cam = vec3(0.0);
uniform float u_radius = 40.0;
uniform float u_wet = 0.0;
uniform vec4 u_cars[6];
uniform sampler2D u_lawn : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform vec3 u_lawn_mean = vec3(0.3792, 0.4458, 0.334);

varying float v_h;
varying float v_dry;
varying vec2 v_xz;

float g_hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float g_noise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	vec2 u = f * f * (3.0 - 2.0 * f);
	return mix(mix(g_hash(i), g_hash(i + vec2(1.0, 0.0)), u.x), mix(g_hash(i + vec2(0.0, 1.0)), g_hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

void vertex() {
	vec3 root = MODEL_MATRIX[3].xyz;
	float scale = length(MODEL_MATRIX[1].xyz);
	vec3 local = VERTEX;
	vec3 w = (MODEL_MATRIX * vec4(local, 1.0)).xyz;
	float gh = UV.y;
	vec2 gp = root.xz;
	// fade: shrink into the lawn towards the edge of the radius
	float fade = 1.0 - smoothstep(u_radius * 0.6, u_radius, distance(gp, u_cam.xz));
	// gusts travelling downwind, plus a quick flutter of each blade
	float gw = length(u_wind);
	vec2 dir = gw > 0.01 ? u_wind / gw : vec2(1.0, 0.0);
	float gust = g_noise(gp * 0.06 - u_wind * u_time * 0.09) * 1.4 + g_noise(gp * 0.31 - u_wind * u_time * 0.35) * 0.4;
	float flutter = sin(u_time * (2.6 + gw * 0.5) + gp.x * 1.9 + gp.y * 1.3 + local.x * 31.0 + local.z * 17.0);
	vec2 disp = dir * (gw * 0.006 * (0.3 + gust) + flutter * 0.0035 * (0.4 + gw * 0.35));
	// cars brushing past push the blades away and flatten them
	for (int i = 0; i < 6; i++) {
		vec2 dv = gp - u_cars[i].xy;
		float dl = length(dv) + 1e-3;
		disp += dv / dl * u_cars[i].z * 0.16 * (1.0 - smoothstep(0.6, 3.4, dl));
	}
	disp *= gh * gh * scale * 4.0;
	float bend = length(disp);
	w.xz += disp;
	float rel_y = max(0.0, (w.y - root.y) - bend * 0.55) * fade;
	w.y = root.y + rel_y;
	v_h = gh;
	v_xz = gp;
	v_dry = g_hash(floor(gp * 0.35)) * 0.6 + g_hash(gp) * 0.4;
	VERTEX = (VIEW_MATRIX * vec4(w, 1.0)).xyz;
	NORMAL = (VIEW_MATRIX * vec4(normalize(mat3(MODEL_MATRIX) * NORMAL), 0.0)).xyz;
}

void fragment() {
	// shaded at the root (the blades shade each other), lighter and drier at the tips; darker when wet
	vec2 p = v_xz;
	vec3 lawn = texture(u_lawn, p / 3.2).rgb * 0.65 + texture(u_lawn, mat2(vec2(0.8, 0.6), vec2(-0.6, 0.8)) * p / 11.3 + 0.37).rgb * 0.35;
	vec3 c = COLOR.rgb;
	c *= mix(vec3(1.0), lawn / max(u_lawn_mean, vec3(0.02)), 0.75);
	c *= mix(0.7, 1.08, pow(v_h, 0.8));
	c = mix(c, c * vec3(1.12, 1.06, 0.8), v_dry * v_h * 0.35);
	c *= 1.0 - 0.28 * u_wet;
	ALBEDO = c;
	ROUGHNESS = 0.78 - 0.4 * u_wet;
	SPECULAR = 0.2;
	// a field is lit from the sky: most of the way to "up", whichever side of a blade we see
	NORMAL = normalize(mix(NORMAL, normalize((VIEW_MATRIX * vec4(0.0, 1.0, 0.0, 0.0)).xyz), 0.7));
}
