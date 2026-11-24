shader_type sky;
render_mode use_half_res_pass;
// The sky of High / Ultra on the PC (Forward+): the same atmosphere, cirrus and night as sky.gdshader, with the cumulus
// ray-marched through a layer 1.5 to 3 km up instead of drawn flat at 2 km (the user, 2026-11-23: "improving the sky
// quality, clouds"). Where the clouds are comes from the same coverage noise (sky_common's cloudDensity); their shape
// from a height profile (flat bases, round tops as high as the cloud is thick) eroded by a 3D noise; their light from a
// few samples towards the sun (Beer and powder: dark bases, bright edges against the sun) and the sky's light from above.
// The march runs in Godot's half-resolution sky pass (HALF_RES_COLOR: the cloud's light and its cover) and is laid
// over the sky in the full pass. The radiance map (ambient, reflections) keeps the flat tint (cubemapClouds).

#include "res://shaders/sky_common.gdshaderinc"

uniform sampler3D tNoise3D : filter_linear_mipmap, repeat_enable;
// samples along the view ray through the layer, and towards the sun from each
uniform int STEPS = 28;
const int LIGHT_STEPS = 4;
// the layer (m above the track) and how far a view ray is marched through it (m)
const float BASE = 1500.0;
const float TOP = 3000.0;
const float MAX_PATH = 14000.0;
// extinction per metre at full density
const float SIGMA = 0.008;
// the step along a view ray (m): short enough near the horizon, where the ray crosses kilometres of the layer (spread
// over the samples it drew streaks)
const float STEP_MIN = 60.0;
const float STEP_MAX = 150.0;

float cloud3d(vec3 p) {
	float cov = cloudDensity(p.xz, uCover);
	if (cov <= 0.0) {
		return 0.0;
	}
	float h = clamp((p.y - BASE) / (TOP - BASE), 0.0, 1.0);
	// a flat base and a dome: the edges draw in with height, the thickest clouds reach highest (coverage the same at
	// every height drew straight walls)
	float top_h = 0.3 + 0.7 * cov;
	float prof = smoothstep(0.0, 0.05, h) * (1.0 - smoothstep(0.0, top_h, h) * 0.9);
	// billows: the 3D noise eats into the edges more than the core
	// (finer up and down than across: no smooth walls; the noise's values sit close together, stretched to 0..1)
	float n = texture(tNoise3D, p * vec3(1.0 / 2200.0, 1.0 / 900.0, 1.0 / 2200.0) + vec3(0.0, sky_time * 0.0004, 0.0)).r;
	n = smoothstep(0.3, 0.6, n);
	float d = cov * 1.5 - (1.0 - prof) * 0.95 - (1.0 - n) * 0.6;
	return clamp(d * smoothstep(0.0, 0.05, h) * (1.0 - smoothstep(0.97, 1.0, h)), 0.0, 1.0);
}

void sky() {
	vec3 dir = normalize(EYEDIR);
	if (AT_HALF_RES_PASS) {
		vec3 light = vec3(0.0);
		float trans = 1.0;
		if (dir.y > 0.015) {
			float t0 = BASE / dir.y;
			float t1 = min(TOP / dir.y, t0 + MAX_PATH);
			float step_len = clamp((t1 - t0) / float(STEPS), STEP_MIN, STEP_MAX);
			// a different start per pixel (interleaved gradient noise): no bands between the samples
			float jit = fract(52.9829189 * fract(dot(FRAGCOORD.xy, vec2(0.06711056, 0.00583715))));
			vec2 wind = cloudWind();
			vec3 off = vec3(wind.x, 0.0, wind.y);
			float mu = dot(dir, uSun);
			float phase = (hg(mu, 0.6) * 0.7 + hg(mu, -0.2) * 0.3) * 6.0;
			for (int i = 0; i < STEPS; i++) {
				float t = t0 + (float(i) + jit) * step_len;
				if (t > t1) {
					break;
				}
				vec3 p = dir * t + off;
				float d = cloud3d(p);
				if (d > 0.002) {
					// towards the sun: growing steps through the layer
					float od = 0.0;
					float sl = 90.0;
					vec3 q = p;
					for (int j = 0; j < LIGHT_STEPS; j++) {
						q += uSun * sl;
						od += cloud3d(q) * sl;
						sl *= 2.0;
					}
					float beer = exp(-od * SIGMA);
					float powder = 1.0 - exp(-d * 2.0 * step_len * SIGMA);
					float h = clamp((p.y - BASE) / (TOP - BASE), 0.0, 1.0);
					vec3 sun_l = uCloudSun * beer * mix(1.0, powder, 0.5) * (0.55 + phase);
					// the sky's light, more on the tops than under the base
					vec3 amb_l = uCloudAmb * mix(0.5, 1.1, h);
					float ts = exp(-d * SIGMA * step_len);
					light += trans * (1.0 - ts) * (sun_l + amb_l);
					trans *= ts;
					if (trans < 0.02) {
						break;
					}
				}
			}
			// near the horizon the clouds thin into the haze
			float fade = smoothstep(0.015, 0.07, dir.y);
			light *= fade;
			trans = mix(1.0, trans, fade);
		}
		COLOR = light;
		ALPHA = 1.0 - trans;
	} else {
		vec3 sky_c;
		float mu;
		vec3 col = skyBase(dir, sky_c, mu);
		float cloudA = 0.0;
		if (AT_CUBEMAP_PASS) {
			col = cubemapClouds(col, dir);
		} else if (dir.y > 0.0) {
			vec4 cl = HALF_RES_COLOR;
			// aerial perspective: far clouds melt into the horizon
			float t = BASE / max(dir.y, 0.02);
			float far_f = (1.0 - exp(-t / 38000.0)) * 0.85;
			vec3 cloud_rgb = mix(cl.rgb, sky_c * cl.a, far_f);
			col = col * (1.0 - cl.a) + cloud_rgb;
			cloudA = cl.a;
			col = addCirrus(col, dir, sky_c, mu, cloudA);
		}
		if (!AT_CUBEMAP_PASS) {
			col = addNight(col, dir);
		}
		col = mix(col, uFogColor, uFogMix);
		COLOR = col;
	}
}
