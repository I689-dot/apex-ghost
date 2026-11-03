shader_type spatial;
render_mode depth_draw_never, cull_back;
// Mown grass with depth on the verges (shell texturing; port of the material in game/grassShells.ts): the lawn near the
// camera is drawn again in thin layers stacked up to SHELL_H above the ground (one instance a layer, lowest first). The
// blade height field decides per pixel and layer whether a blade reaches that high.

global uniform float wind_time;
global uniform float wind_strength;

const float SHELL_H = 0.075;

uniform sampler2D lawn : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D blades : filter_linear_mipmap_anisotropic, repeat_enable;
uniform float lawn_tile = 5.5;
uniform float shell_radius = 16.0;
uniform float shell_count = 6.0;

varying float v_l;
varying vec3 v_w;

void vertex() {
	// lowest layer first
	float l = (float(INSTANCE_ID) + 1.0) / shell_count;
	vec3 wp = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	// straight up, not along the vertex normal: two lawn meshes meeting with different normals opened a crack
	wp.y += l * SHELL_H;
	// the tips sway in the wind
	float s = sin(wind_time * 1.9 + wp.x * 0.7 + wp.z * 0.45) + 0.5 * sin(wind_time * 3.3 + wp.z * 1.3);
	wp.xz += vec2(0.8, 0.5) * s * 0.006 * wind_strength * l * l;
	v_l = l;
	v_w = wp;
	VERTEX = (inverse(MODEL_MATRIX) * vec4(wp, 1.0)).xyz;
}

void fragment() {
	vec2 p = v_w.xz;
	vec4 b1 = texture(blades, p / 1.2);
	vec4 b2 = texture(blades, mat2(vec2(0.6, 0.8), vec2(-0.8, 0.6)) * p / 0.83 + 0.31);
	float bh = max(b1.r, b2.r * 0.93);
	float fade = 1.0 - smoothstep(shell_radius * 0.5, shell_radius, distance(v_w, CAMERA_POSITION_WORLD));
	// no blade this high here, or beyond what the distance fade leaves: the upper layers go first
	if (bh < v_l || v_l > fade) discard;
	vec3 base = texture(lawn, p / lawn_tile).rgb * vec3(0.62, 1.0, 0.72); // GroundDetail.LAWN_TINT
	// dark roots inside the sward, lighter tips, a little colour per blade
	ALBEDO = base * mix(0.62, 1.3, v_l * v_l) * mix(0.86, 1.12, b1.g);
	ROUGHNESS = 1.0;
	SPECULAR = 0.0;
}
