shader_type canvas_item;
// Screen-space rain droplets on the windshield, cockpit view only (port of the fragment shader of WindshieldFx in
// game/environment.ts). Drops are tiny lenses: mostly clear, a bright lower crescent (they refract the sky upside
// down), a darker rim and a pin-point highlight; pushed up and stretched by the airflow at speed, leaving faint streaks.

uniform float u_time = 0.0;
uniform float u_rain = 0.0;
uniform float u_speed = 0.0;
uniform float u_aspect = 1.0;
uniform float u_light = 1.0;

float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

// xyz: lens normal (x, y) and coverage; w: streak
vec4 drops(vec2 uv, float scale, float t, float seed) {
	uv *= scale;
	vec2 id = floor(uv);
	vec2 f = fract(uv) - 0.5;
	float r = h(id + seed);
	if (r > u_rain) return vec4(0.0);
	float life = fract(t * (0.12 + r * 0.25) + r * 7.0);
	vec2 o = vec2(h(id + 3.1 + seed) - 0.5, h(id + 7.7 + seed) - 0.5) * 0.5;
	o.y += life * u_speed * 0.8;
	float size = 0.05 + 0.09 * h(id + 1.3 + seed);
	vec2 q = (f - o) / vec2(size, size * (1.0 + u_speed * 1.6));
	float d = length(q);
	// streak left behind a drop the airflow drags upwards
	float streak = u_speed * smoothstep(0.012, 0.0, abs(f.x - o.x)) * step(f.y, o.y) * smoothstep(-0.5, o.y, f.y) * 0.5;
	float cov = (1.0 - smoothstep(0.82, 1.0, d)) * (1.0 - life * 0.6);
	return vec4(q * cov, cov, streak);
}

void fragment() {
	// three.js UVs run up from the bottom
	vec2 vuv = vec2(UV.x, 1.0 - UV.y);
	vec2 uv = vec2(vuv.x * u_aspect, vuv.y);
	vec4 a = drops(uv, 11.0, u_time, 0.0);
	vec4 b = drops(uv + 0.37, 19.0, u_time * 1.3, 5.0);
	vec4 c = drops(uv + 0.71, 31.0, u_time * 1.7, 9.0);
	vec4 m = (a.z >= b.z && a.z >= c.z) ? a : (b.z >= c.z ? b : c);
	float cov = m.z;
	vec2 n = m.xy / max(cov, 1e-3);
	float rim = pow(clamp(length(n), 0.0, 1.0), 4.0);
	// refraction: the lower half of a drop shows the bright sky, the upper half the darker ground
	float lum = clamp(0.55 - 0.45 * n.y, 0.0, 1.0) * u_light;
	float spec = pow(max(0.0, 1.0 - length(n - vec2(-0.35, 0.45)) * 2.2), 6.0) * u_light;
	vec3 col = vec3(0.82, 0.88, 0.95) * lum + spec;
	float alpha = cov * (0.06 + 0.32 * rim) + spec * cov * 0.8 + (a.w + b.w + c.w) * 0.06;
	// only on the windscreen: fade out towards the dashboard (lower part of the view)
	alpha *= smoothstep(0.36, 0.52, vuv.y);
	COLOR = vec4(col, clamp(alpha, 0.0, 0.95));
}
