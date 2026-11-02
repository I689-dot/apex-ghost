shader_type spatial;
render_mode unshaded, blend_mix, depth_draw_never, cull_disabled;
// The racing-line ribbon (port of the shader in game/racingLineFx.ts): chevrons coloured from what the car needs now.
// UV = (across 0..1, distance along the line); UV2 = (target speed m/s, planned colour 0 go .. 1 lift .. 2 brake).

uniform float car_s = -1000000.0;
uniform float speed = 0.0;
uniform float line_length = 5000.0;
uniform float brake = 9.0;
uniform float opacity = 0.82;

varying float v_depth;

void vertex() {
	vec4 mv = MODELVIEW_MATRIX * vec4(VERTEX, 1.0);
	v_depth = -mv.z;
}

void fragment() {
	float ahead = mod(UV.y - car_s + line_length, line_length);
	float k = UV2.y;
	if (ahead < 320.0) {
		// deceleration needed to be at this point's target speed (share of the car's braking)
		float need = max(0.0, speed * speed - UV2.x * UV2.x) / (2.0 * max(ahead, 4.0)) / brake;
		float dyn = need > 0.62 ? 2.0 : (need > 0.25 ? mix(1.0, 2.0, (need - 0.25) / 0.37) : (need > 0.06 ? 1.0 : 0.0));
		// blend into the plan at the end of the look-ahead
		k = mix(dyn, UV2.y, smoothstep(224.0, 320.0, ahead));
	}
	vec3 go = vec3(0.10, 0.85, 0.30);
	vec3 lift = vec3(1.0, 0.72, 0.05);
	vec3 brk = vec3(1.0, 0.10, 0.12);
	vec3 col = k < 1.0 ? mix(go, lift, k) : mix(lift, brk, k - 1.0);
	// chevrons pointing along the line: a V across the ribbon, repeated every 2.4 m
	float x = abs(UV.x - 0.5) * 2.0;
	float p = fract((UV.y + x * 0.9) / 2.4);
	float w = fwidth(p) * 1.5 + 0.02;
	float band = smoothstep(0.0, w, p) * (1.0 - smoothstep(0.34 - w, 0.34, p));
	// soft edges across the ribbon
	float edge = 1.0 - smoothstep(0.78, 1.0, x);
	// a faint body between the chevrons keeps the line readable far away, where the chevrons blur
	float far_k = smoothstep(60.0, 160.0, v_depth);
	float a = mix(band * 0.95 + 0.12, 0.55, far_k) * edge;
	// not under the car's nose, and fading into the distance
	a *= smoothstep(2.5, 9.0, ahead < line_length - 30.0 ? ahead : 99.0) * (1.0 - smoothstep(260.0, 420.0, v_depth));
	ALBEDO = col * 1.15;
	ALPHA = clamp(a * opacity, 0.0, 1.0);
}
