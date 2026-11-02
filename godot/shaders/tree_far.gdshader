shader_type spatial;
render_mode cull_disabled, skip_vertex_transform;
// Far trees: camera-facing (cylindrical) impostor cards baked from the models, one draw call per cell for every species
// (port of impostorMaterial in game/forest.ts). Instance transform: position, scale; instance colour: tint, alpha = species.

uniform sampler2DArray cards : source_color, filter_linear_mipmap, repeat_disable;
uniform vec4 card_w = vec4(12.0);   // card width (m) per species at scale 1
uniform vec4 card_h = vec4(25.0);   // card height (m) per species at scale 1
uniform vec4 near_r = vec4(80.0);   // inside this distance the 3D model stands there instead
varying flat float v_kind;
varying vec3 v_tint;

void vertex() {
	int k = int(COLOR.a + 0.5);
	v_kind = float(k);
	v_tint = COLOR.rgb;
	vec3 c = MODEL_MATRIX[3].xyz;
	float s = length(MODEL_MATRIX[1].xyz);
	float w = length(MODEL_MATRIX[0].xyz);
	float cw = k == 0 ? card_w.x : (k == 1 ? card_w.y : (k == 2 ? card_w.z : card_w.w));
	float ch = k == 0 ? card_h.x : (k == 1 ? card_h.y : (k == 2 ? card_h.z : card_h.w));
	float nr = k == 0 ? near_r.x : (k == 1 ? near_r.y : (k == 2 ? near_r.z : near_r.w));
	vec3 right = normalize(vec3(INV_VIEW_MATRIX[0].x, 0.0, INV_VIEW_MATRIX[0].z) + vec3(1e-5, 0.0, 0.0));
	// VERTEX: x in -0.5..0.5, y in 0..1 (the card)
	vec3 world = c + right * VERTEX.x * cw * (w / max(s, 1e-4)) * s + vec3(0.0, VERTEX.y * ch * s, 0.0);
	vec2 d = c.xz - CAMERA_POSITION_WORLD.xz;
	if (dot(d, d) < nr * nr) {
		world = vec3(0.0, -10000.0, 0.0);
	}
	VERTEX = (VIEW_MATRIX * vec4(world, 1.0)).xyz;
	NORMAL = (VIEW_MATRIX * vec4(0.0, 1.0, 0.0, 0.0)).xyz;
}

void fragment() {
	vec4 t = texture(cards, vec3(UV, v_kind));
	// alpha-tested: thin foliage keeps its coverage in the mips
	vec2 ts = vec2(textureSize(cards, 0).xy);
	vec2 dx = dFdx(UV * ts);
	vec2 dy = dFdy(UV * ts);
	float lod = clamp(0.5 * log2(max(dot(dx, dx), dot(dy, dy))), 0.0, 3.0);
	if (t.a * (1.0 + lod * 0.12) < 0.45) discard;
	ALBEDO = t.rgb * v_tint;
	ROUGHNESS = 1.0;
	SPECULAR = 0.0;
	NORMAL = (VIEW_MATRIX * vec4(0.0, 1.0, 0.0, 0.0)).xyz;
}
