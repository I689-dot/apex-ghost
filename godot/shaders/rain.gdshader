shader_type spatial;
render_mode unshaded, depth_draw_never, cull_disabled, blend_mix, skip_vertex_transform;
// Rain: line streaks wrapped around the camera, entirely on the GPU (port of the rain material of game/environment.ts).
// COLOR.r carries aEnd (0 = top of the streak, 1 = bottom).

uniform float uTime = 0.0;
uniform vec3 uCam = vec3(0.0);
uniform vec3 uVel = vec3(0.0);
uniform float uIntensity = 0.0;
uniform vec3 uColor : source_color = vec3(0.7, 0.75, 0.8);

varying float vA;

void vertex() {
	vec3 fall = vec3(1.5, -11.0, 0.6);
	vec3 p = VERTEX + fall * uTime;
	vec3 box = vec3(50.0, 30.0, 50.0);
	vec3 rel = mod(p - uCam + box * 0.5, box) - box * 0.5;
	rel.y += 6.0;
	// streak length follows the relative wind (car speed)
	vec3 rv = fall - uVel;
	rel += normalize(rv) * COLOR.r * clamp(length(rv) * 0.03, 0.25, 1.4);
	vA = (1.0 - COLOR.r * 0.6) * step(fract(VERTEX.x * 13.7 + VERTEX.z * 7.1), uIntensity);
	POSITION = PROJECTION_MATRIX * VIEW_MATRIX * vec4(uCam + rel, 1.0);
}

void fragment() {
	if (vA <= 0.0) {
		discard;
	}
	ALBEDO = uColor;
	ALPHA = 0.32 * vA;
}
