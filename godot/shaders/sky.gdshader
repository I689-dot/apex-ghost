shader_type sky;
// The sky: atmosphere (from the LUT) + sun disc + two cloud layers + night (port of the dome shader of game/sky.ts).
// Clouds: a cumulus layer 2 km up and a cirrus layer 9 km up from a tiling noise texture, lit with a few samples
// towards the sun (Beer + powder) and a two-lobe phase. cloud_detail 0: one cumulus sample, no cirrus; 1: one light
// sample + cirrus; 2: two light samples. (High / Ultra on the PC: sky_volumetric.gdshader.)

#include "res://shaders/sky_common.gdshaderinc"

void sky() {
	vec3 dir = normalize(EYEDIR);
	vec3 sky_c;
	float mu;
	vec3 col = skyBase(dir, sky_c, mu);
	float cloudA = 0.0;
	if (AT_CUBEMAP_PASS) {
		col = cubemapClouds(col, dir);
	} else if (dir.y > 0.0) {
		vec2 wind = cloudWind();
		// cumulus layer, 2 km up
		float t = 2000.0 / max(dir.y, 0.02);
		vec2 p = dir.xz * t + wind;
		float dens = cloudDensity(p, uCover);
		if (dens > 0.001) {
			vec2 sunStep = normalize(uSun.xz + vec2(1e-4)) * 380.0;
			float toSun = dens * 0.8;
			if (CLOUD_DETAIL > 0) {
				toSun = cloudDensity(p + sunStep, uCover);
				if (CLOUD_DETAIL > 1) {
					toSun = toSun * 0.6 + cloudDensity(p + sunStep * 2.4, uCover) * 0.4;
				}
			}
			float od = toSun * (2.0 + 4.0 * uCover);
			float beer = exp(-od);
			float powder = 1.0 - exp(-dens * 3.5);
			float phase = mix(hg(mu, 0.55), hg(mu, -0.15), 0.35) * 6.0;
			vec3 lit = uCloudSun * beer * powder * (0.55 + phase);
			// thick decks are dark underneath
			vec3 amb = uCloudAmb * mix(1.05, 0.5, dens * uCover);
			vec3 c = amb + lit;
			// aerial perspective: far clouds melt into the horizon
			float far_f = 1.0 - exp(-t / 38000.0);
			c = mix(c, sky_c, far_f * 0.85);
			cloudA = smoothstep(0.0, 0.85, dens) * smoothstep(0.0, 0.07, dir.y);
			col = mix(col, c, cloudA);
		}
		if (CLOUD_DETAIL > 0) {
			col = addCirrus(col, dir, sky_c, mu, cloudA);
		}
	}
	if (!AT_CUBEMAP_PASS) {
		col = addNight(col, dir);
	}
	col = mix(col, uFogColor, uFogMix);
	COLOR = col;
}
