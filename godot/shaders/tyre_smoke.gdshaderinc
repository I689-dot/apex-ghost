// Tyre smoke and dust puffs (TyreSmoke): camera-facing quads of a multimesh, each playing a pre-rendered smoke puff
// (assets_static/fx/smoke_puff_8x8.png: Unity Labs' "Cloud02" flipbook, CC0, 64 frames) over its life. The sheet's own
// shading gives the billows their depth; the scene's lights shade the puff as a whole through a rounded normal, with
// light through its thin edges. (Noise drawn in the shader read as an even haze, not smoke.)
// INSTANCE_CUSTOM: x spin (rad), y age (0..1 of its life), z seed. COLOR: tint and opacity.
// SOFT_EDGES (Forward+): the puff fades where it meets the track or a wall instead of cutting a straight line.
render_mode blend_mix, depth_draw_never, cull_disabled, specular_disabled;

uniform sampler2D puff_tex : source_color, filter_linear_mipmap, repeat_disable;
// the sheet: 8 x 8 frames; the mean of its shading under the smoke (measured from the file: 0.44), taken as 1
const float GRID = 8.0;
const float FRAMES = 64.0;
const float SHADE_MEAN = 0.44;

#ifdef SOFT_EDGES
uniform sampler2D depth_tex : hint_depth_texture, filter_nearest;
// how far behind the puff the ground must be to show it whole (m)
uniform float soft_distance = 0.6;
#endif

varying vec3 v_custom;

vec2 frame_uv(float f, vec2 uv) {
	return (vec2(mod(f, GRID), floor(f / GRID)) + uv) / GRID;
}

void vertex() {
	// face the camera, keep the instance's size (its basis is a uniform scale) and spin it in the view plane
	float s = length(MODEL_MATRIX[0].xyz);
	float a = INSTANCE_CUSTOM.x;
	VERTEX = vec3(mat2(vec2(cos(a), sin(a)), vec2(-sin(a), cos(a))) * VERTEX.xy * s, 0.0);
	MODELVIEW_MATRIX = VIEW_MATRIX * mat4(INV_VIEW_MATRIX[0], INV_VIEW_MATRIX[1], INV_VIEW_MATRIX[2], MODEL_MATRIX[3]);
	v_custom = INSTANCE_CUSTOM.xyz;
}

void fragment() {
	// the puff's frame for its age, blended with the next (64 frames over a life of under 3 s)
	float f = clamp(v_custom.y, 0.0, 1.0) * (FRAMES - 1.0);
	float f0 = floor(f);
	vec4 c = mix(texture(puff_tex, frame_uv(f0, UV)), texture(puff_tex, frame_uv(min(f0 + 1.0, FRAMES - 1.0), UV)), f - f0);
	vec2 p = UV * 2.0 - 1.0;
	// a rounded normal (view space): the side towards the sun lit, the other in shade
	NORMAL = normalize(vec3(p.x, -p.y, sqrt(max(0.0, 1.0 - dot(p, p))) + 0.6));
	ALBEDO = COLOR.rgb * clamp(c.r / SHADE_MEAN, 0.35, 1.7);
	ROUGHNESS = 1.0;
	// the sun through the thin parts of the puff
	BACKLIGHT = COLOR.rgb * 0.35 * (1.0 - c.a);
	float alpha = c.a * COLOR.a;
	// no puff filling the screen in front of the lens
	alpha *= smoothstep(1.5, 3.0, -VERTEX.z);
#ifdef SOFT_EDGES
	float d = texture(depth_tex, SCREEN_UV).r;
	vec4 world = INV_PROJECTION_MATRIX * vec4(SCREEN_UV * 2.0 - 1.0, d, 1.0);
	float scene_z = -world.z / world.w;
	alpha *= clamp((scene_z + VERTEX.z) / soft_distance, 0.0, 1.0);
#endif
	if (alpha < 0.004) {
		discard;
	}
	ALPHA = clamp(alpha, 0.0, 1.0);
}
