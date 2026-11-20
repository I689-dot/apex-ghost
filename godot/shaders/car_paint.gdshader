shader_type spatial;
render_mode blend_mix, depth_draw_opaque, cull_back, diffuse_burley, specular_schlick_ggx;
// The cars' paint (CarPaint): it replaces the models' liveries (the game carries no brands), so every car is the
// colours its driver chose. Designs and the race number are placed in the car's own space (+X left, +Y up, +Z forward),
// so they fit every model whatever its UV layout. The crash dents move the body's vertices here (CarVisual.dent).

uniform vec3 base_color : source_color = vec3(0.78, 0.06, 0.18);
uniform vec3 accent_color : source_color = vec3(0.95);
// 0 plain, 1 twin stripes over the top, 2 two-tone (the lower part), 3 fade towards the rear, 4 side stripe, 5 hoop,
// 6 one wide centre stripe, 7 chevron (a V pointing forward), 8 pinstripes along the flanks, 9 split (the front part)
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
// the aero and lower trim in dark carbon, as on the real cars (the wing's whole mesh: trim_all), and how far up the
// sills, splitter and diffuser count as trim (a share of the body's height; 0: none)
uniform vec3 trim_color : source_color = vec3(0.035, 0.037, 0.04);
uniform bool trim_all = false;
// the trim painted (the second colour as paint) instead of carbon
uniform bool trim_paint = false;
uniform float trim_height = 0.11;
// metallic flakes (a finish's sparkle under the clear coat): their strength and size (m)
uniform float flakes = 0.0;
uniform float flake_size = 0.0009;
// (2026-11-21, the user: the cars looked like plastic, the same from every side) the colour as a painter's: the AgX
// grade takes the purity out of saturated colours (a racing red came out pastel), so the pigment is mixed that much
// purer; and the metallic flop: a metallic paint is bright face-on and dark at a grazing angle (the flakes lie
// parallel to the panel and send the light back towards the viewer only face-on), so each panel changes with the view
uniform float paint_purity = 1.0;
uniform float flop = 0.0;

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
	} else if (design == 6) {
		float x = ax / hw;
		a = (1.0 - smoothstep(0.17 - fwidth(x), 0.17 + fwidth(x), x)) * step(0.15, cnrm.y);
	} else if (design == 7) {
		a = band(zf + ax / hw * 0.32, 0.7, 0.79);
	} else if (design == 8) {
		a = (band(yf, 0.4, 0.425) + band(yf, 0.455, 0.48)) * step(0.35, abs(cnrm.x));
	} else if (design == 9) {
		a = smoothstep(0.56 - fwidth(zf), 0.56 + fwidth(zf), zf);
	}
	c = mix(c, accent_color, a);
	float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
	c = max(mix(vec3(luma), c, paint_purity), vec3(0.0));
	// carbon: the wing, and the lowest band of the body (sills, splitter, diffuser)
	float trim = trim_all ? 1.0 : 1.0 - smoothstep(trim_height - 0.012, trim_height + 0.012, yf);
	trim *= step(0.001, trim_height) + (trim_all ? 1.0 : 0.0);
	trim = clamp(trim, 0.0, 1.0);
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
	float nv = clamp(dot(NORMAL, VIEW), 0.0, 1.0);
	if (flop > 0.0) {
		c *= mix(1.0, mix(0.35, 1.18, pow(nv, 0.55)), flop);
	}
	if (pearl > 0.0) {
		float fr = pow(1.0 - clamp(dot(NORMAL, VIEW), 0.0, 1.0), 3.0);
		c = mix(c, c.gbr * 0.6 + c * 0.6, fr * pearl);
	}
	// carbon's weave (2 x 2 twill, 4 mm tows), on the plane the surface faces most; it fades out where a tow would be
	// smaller than a pixel
	vec3 tc = trim_color;
	float carbon = trim_paint ? 0.0 : trim;
	if (carbon > 0.0) {
		vec3 an = abs(cnrm);
		vec2 uvw = an.x > an.y && an.x > an.z ? cpos.zy : (an.y > an.z ? cpos.xz : cpos.xy);
		vec2 tow = uvw / 0.004;
		float px = length(fwidth(tow));
		float dir = mod(floor(tow.x) + floor(tow.y), 4.0) < 2.0 ? 1.0 : 0.0;
		float along = dir > 0.5 ? fract(tow.x) : fract(tow.y);
		float sheen = 0.75 + 0.5 * dir * (0.6 + 0.4 * sin(along * 3.14159));
		tc *= mix(sheen, 1.0, smoothstep(0.4, 1.2, px));
	}
	c = mix(c, tc, trim);
	// what a baked occlusion map gives a car body: the panels darker towards the ground (the floor is the biggest
	// occluder), surfaces facing down darker still, the roof and bonnet open to the sky
	float ground = smoothstep(-0.05, 0.55, yf);
	float facing = clamp(cnrm.y * 0.5 + 0.5, 0.0, 1.0);
	float ao = mix(0.42, 1.0, ground) * mix(0.55, 1.0, facing);
	AO = ao;
	AO_LIGHT_AFFECT = 0.35;
	// flakes: tiny facets under the clear coat, each tilted its own way, sparkling where the light catches them
	float rough = mix(roughness_v, 0.55, carbon);
	if (flakes > 0.0 && trim < 0.5) {
		// a flake smaller than a pixel would only flicker: further off they blend into a slightly rougher sheen
		float px = length(fwidth(cpos));
		float near_f = 1.0 - smoothstep(flake_size * 0.6, flake_size * 2.5, px);
		rough = mix(rough, min(1.0, rough + 0.08), flakes * (1.0 - near_f));
		if (near_f > 0.0) {
			vec3 cell = floor(cpos / flake_size);
			vec3 rnd = fract(sin(vec3(dot(cell, vec3(127.1, 311.7, 74.7)), dot(cell, vec3(269.5, 183.3, 246.1)), dot(cell, vec3(113.5, 271.9, 124.6)))) * 43758.5453);
			NORMAL = normalize(NORMAL + (rnd - 0.5) * 0.35 * flakes * near_f);
			c *= 1.0 + (rnd.x - 0.5) * 0.12 * flakes * near_f;
		}
	}
	ALBEDO = c;
	METALLIC = mix(metallic_v, 0.25, carbon);
	ROUGHNESS = rough;
	// a lacquered panel reflects more than the bare dielectric's 4 % (the clear coat over a base that is itself glossy):
	// racing games raise it so the surroundings read on the bodywork (0.5 is Godot's 4 %)
	SPECULAR = mix(0.8, 0.5, carbon);
	CLEARCOAT = mix(clearcoat_v, 0.6, carbon);
	CLEARCOAT_ROUGHNESS = mix(0.06, 0.25, carbon);
	if (has_normal) {
		NORMAL_MAP = texture(normal_tex, UV).rgb;
		NORMAL_MAP_DEPTH = normal_depth;
	}
}
