shader_type spatial;
render_mode blend_mix, depth_draw_opaque, cull_back, diffuse_burley, specular_schlick_ggx;
// The cars' paint (CarPaint): it replaces the models' liveries (the game carries no brands), so every car is the
// colours its driver chose. Designs and the race number are placed in the car's own space (+X left, +Y up, +Z forward),
// so they fit every model whatever its UV layout. The crash dents move the body's vertices here (CarVisual.dent).

uniform vec3 base_color : source_color = vec3(0.78, 0.06, 0.18);
uniform vec3 accent_color : source_color = vec3(0.95);
// 0 plain, 1 twin stripes over the top, 2 two-tone (the lower part), 3 fade towards the rear, 4 side stripe, 5 hoop
uniform int design = 0;
uniform float metallic_v = 0.0;
uniform float roughness_v = 0.3;
uniform float clearcoat_v = 1.0;
// a pearl's colour shift at grazing angles (0: none)
uniform float pearl = 0.0;
uniform sampler2D number_tex : source_color, filter_linear_mipmap_anisotropic, repeat_disable;
uniform bool show_number = true;
// mesh space -> car space
uniform mat4 to_car = mat4(1.0);
// the body in car space: half width, lowest y, highest y, rear z (x, y, z, w) and front z
uniform vec4 box = vec4(1.0, 0.0, 1.2, -2.3);
uniform float box_front = 2.3;
// door numbers: centre z, centre y, size; bonnet number: centre z, size
uniform vec3 door_number = vec3(0.4, 0.55, 0.42);
uniform vec2 hood_number = vec2(1.4, 0.5);
uniform sampler2D normal_tex : hint_normal;
uniform bool has_normal = false;
uniform float normal_depth = 1.0;
uniform vec4 dent_p[8];
uniform vec4 dent_d[8];

varying vec3 cpos;

void vertex() {
	cpos = (to_car * vec4(VERTEX, 1.0)).xyz;
	for (int i = 0; i < 8; i++) {
		float r = dent_p[i].w;
		if (r <= 0.0) {
			continue;
		}
		vec3 dp = VERTEX - dent_p[i].xyz;
		float d2 = dot(dp, dp);
		if (d2 < r * r) {
			float f = 1.0 - sqrt(d2) / r;
			float k = dent_d[i].w * f * f;
			VERTEX += dent_d[i].xyz * vec3(k, k * 0.5, k);
		}
	}
}

float band(float x, float a, float b) {
	float w = fwidth(x) * 0.75 + 1e-5;
	return smoothstep(a - w, a + w, x) * (1.0 - smoothstep(b - w, b + w, x));
}

void fragment() {
	// the surface's normal in car space, as drawn (some models' panels face inwards and are drawn from both sides:
	// NORMAL is already turned to the viewer)
	vec3 cnrm = normalize(mat3(to_car) * (inverse(mat3(MODEL_MATRIX)) * (mat3(INV_VIEW_MATRIX) * NORMAL)));
	vec3 c = base_color;
	float hw = box.x;
	float y0 = box.y;
	float y1 = box.z;
	float h = max(0.1, y1 - y0);
	float len = max(0.5, box_front - box.w);
	// 0 at the rear, 1 at the front
	float zf = (cpos.z - box.w) / len;
	float yf = (cpos.y - y0) / h;
	float ax = abs(cpos.x);
	float a = 0.0;
	if (design == 1) {
		// twin stripes either side of the centre line, over the bonnet, roof and tail
		a = band(ax / hw, 0.06, 0.2) * step(0.15, cnrm.y);
	} else if (design == 2) {
		// two-tone: the lower part
		a = 1.0 - smoothstep(0.38 - fwidth(yf), 0.38 + fwidth(yf), yf);
	} else if (design == 3) {
		// the accent sweeping in towards the rear
		a = 1.0 - smoothstep(0.15, 0.6, zf);
	} else if (design == 4) {
		// a stripe along the flanks
		a = band(yf, 0.36, 0.46) * step(0.35, abs(cnrm.x));
	} else if (design == 5) {
		// a hoop round the car behind the doors
		a = band(zf, 0.3, 0.4);
	}
	c = mix(c, accent_color, a);
	if (show_number) {
		// on the doors (each side reads left to right), and on the bonnet (upright seen from the front)
		float s = door_number.z;
		if (abs(cnrm.x) > 0.45 && ax > hw * 0.55) {
			float u = (cpos.x < 0.0 ? (cpos.z - door_number.x) : (door_number.x - cpos.z)) / s + 0.5;
			float v = (door_number.y - cpos.y) / s + 0.5;
			if (u > 0.0 && u < 1.0 && v > 0.0 && v < 1.0) {
				vec4 n = texture(number_tex, vec2(u, v));
				c = mix(c, n.rgb, n.a);
			}
		}
		float hs = hood_number.y;
		if (cnrm.y > 0.55) {
			float u = cpos.x / hs + 0.5;
			float v = (cpos.z - hood_number.x) / hs + 0.5;
			if (u > 0.0 && u < 1.0 && v > 0.0 && v < 1.0) {
				vec4 n = texture(number_tex, vec2(u, v));
				c = mix(c, n.rgb, n.a);
			}
		}
	}
	if (pearl > 0.0) {
		float fr = pow(1.0 - clamp(dot(NORMAL, VIEW), 0.0, 1.0), 3.0);
		c = mix(c, c.gbr * 0.6 + c * 0.6, fr * pearl);
	}
	ALBEDO = c;
	METALLIC = metallic_v;
	ROUGHNESS = roughness_v;
	CLEARCOAT = clearcoat_v;
	CLEARCOAT_ROUGHNESS = 0.06;
	if (has_normal) {
		NORMAL_MAP = texture(normal_tex, UV).rgb;
		NORMAL_MAP_DEPTH = normal_depth;
	}
}
