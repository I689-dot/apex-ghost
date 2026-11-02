shader_type sky;
// The sky: atmosphere (from the LUT) + sun disc + two cloud layers + night (port of the dome shader of game/sky.ts).
// Clouds: a cumulus layer 2 km up and a cirrus layer 9 km up from a tiling noise texture, lit with a few samples
// towards the sun (Beer + powder) and a two-lobe phase. cloud_detail 0: one cumulus sample, no cirrus; 1: one light
// sample + cirrus; 2: two light samples.

uniform sampler2D tLut : filter_linear, repeat_disable;
uniform sampler2D tNoise : filter_linear_mipmap, repeat_enable;
uniform vec3 uSun = vec3(0.0, 1.0, 0.0);
uniform vec3 uSunDisc : source_color = vec3(1.0);
uniform vec3 uCloudSun : source_color = vec3(1.0);
uniform vec3 uCloudAmb : source_color = vec3(0.5);
uniform float uCover = 0.3;
uniform float uCirrus = 0.5;
uniform float uTime = 0.0;
uniform float uFogMix = 0.0;
uniform vec3 uFogColor : source_color = vec3(0.7);
uniform float uNight = 0.0;
uniform int CLOUD_DETAIL = 2;
// Godot's render space is +Z forward for the world, so the sun/sky use the same world axes as the web game's.

const float SKY_PI = 3.14159265;

vec2 skyLutUv(vec3 dir, vec3 sunDir) {
	float el = asin(clamp(dir.y, 0.0, 1.0));
	vec2 a = dir.xz;
	vec2 s = sunDir.xz;
	float la = length(a);
	float ls = length(s);
	float c = (la > 1e-4 && ls > 1e-4) ? dot(a / la, s / ls) : 1.0;
	float az = acos(clamp(c, -1.0, 1.0));
	return vec2(az / SKY_PI, sqrt(el / (0.5 * SKY_PI)));
}

vec3 skyAt(vec3 d) {
	return texture(tLut, skyLutUv(d, uSun)).rgb;
}

float hg(float c, float g) {
	float g2 = g * g;
	return (1.0 - g2) / pow(1.0 + g2 - 2.0 * g * c, 1.5) * 0.0795775;
}

float cloudDensity(vec2 p, float cover) {
	float base = texture(tNoise, p * (1.0 / 14000.0)).r;
	float n = base;
	if (CLOUD_DETAIL > 0) {
		float bill = texture(tNoise, p * (1.0 / 4200.0) + 0.37).g;
		n = base * 0.68 + bill * 0.42 - 0.08;
	}
	return clamp((n - (1.0 - cover)) / max(0.12, cover * 0.55), 0.0, 1.0);
}

void sky() {
	vec3 dir = normalize(EYEDIR);
	vec3 d = vec3(dir.x, max(dir.y, 0.0), dir.z);
	vec3 sky_c = skyAt(normalize(d + vec3(0.0, 1e-4, 0.0)));
	// below the horizon: the haze colour, a little darker towards the ground
	sky_c *= mix(1.0, 0.82, smoothstep(0.0, -0.25, dir.y));
	// night: a deep blue floor (no multiple scattering in the LUT)
	sky_c += uNight * vec3(0.0035, 0.0055, 0.012);
	// sun disc with limb darkening (2.5x the real size, so it reads on a phone)
	float mu = dot(dir, uSun);
	float disc = smoothstep(0.99996, 0.999985, mu);
	vec3 col = sky_c + uSunDisc * disc * (0.6 + 0.4 * smoothstep(0.99996, 0.99999, mu));
	float cloudA = 0.0;
	if (dir.y > 0.0) {
		vec2 wind = vec2(9.0, 3.5) * uTime;
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
			// cirrus, 9 km up: thin streaks, lit by the sun
			float t2 = 9000.0 / max(dir.y, 0.03);
			vec2 q = dir.xz * t2 + wind * 2.6;
			float s = texture(tNoise, vec2(q.x / 52000.0, q.y / 11000.0)).r * 0.7 + texture(tNoise, q / 6000.0).b * 0.3;
			float ca = smoothstep(0.52, 0.85, s) * uCirrus * (1.0 - cloudA) * smoothstep(0.0, 0.12, dir.y) * 0.55;
			col = mix(col, sky_c * 0.55 + uCloudSun * (0.45 + hg(mu, 0.6) * 2.0), ca);
		}
	}
	col = mix(col, uFogColor, uFogMix);
	COLOR = col;
}
