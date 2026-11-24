// What the two skies share (sky.gdshader: a flat cloud layer; sky_volumetric.gdshader: ray-marched cumulus): the
// atmosphere from the LUT, the sun disc, the cloud coverage, the cirrus 9 km up, the night (stars, moon) and the fog.

uniform sampler2D tLut : filter_linear, repeat_disable;
uniform sampler2D tNoise : filter_linear_mipmap, repeat_enable;
uniform vec3 uSun = vec3(0.0, 1.0, 0.0);
uniform vec3 uSunDisc : source_color = vec3(1.0);
uniform vec3 uCloudSun : source_color = vec3(1.0);
uniform vec3 uCloudAmb : source_color = vec3(0.5);
uniform float uCover = 0.3;
uniform float uCirrus = 0.5;
// the cloud drift is a global: the sky's radiance map (ambient light, reflections) is not re-rendered every frame for it
global uniform float sky_time;
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

// the cumulus coverage at a point of the cloud layer (m): 0 clear .. 1 thick
float cloudDensity(vec2 p, float cover) {
	float base = texture(tNoise, p * (1.0 / 14000.0)).r;
	float n = base;
	if (CLOUD_DETAIL > 0) {
		float bill = texture(tNoise, p * (1.0 / 4200.0) + 0.37).g;
		n = base * 0.68 + bill * 0.42 - 0.08;
	}
	return clamp((n - (1.0 - cover)) / max(0.12, cover * 0.55), 0.0, 1.0);
}

vec2 cloudWind() {
	return vec2(9.0, 3.5) * sky_time;
}

// the clear sky in a direction (sky_c: without the sun disc; mu: the cosine to the sun)
vec3 skyBase(vec3 dir, out vec3 sky_c, out float mu) {
	vec3 d = vec3(dir.x, max(dir.y, 0.0), dir.z);
	sky_c = skyAt(normalize(d + vec3(0.0, 1e-4, 0.0)));
	// below the horizon: the haze colour, a little darker towards the ground
	sky_c *= mix(1.0, 0.82, smoothstep(0.0, -0.25, dir.y));
	// night: a deep blue floor (no multiple scattering in the LUT)
	sky_c += uNight * vec3(0.0035, 0.0055, 0.012);
	// sun disc with limb darkening (2.5x the real size, so it reads on a phone)
	mu = dot(dir, uSun);
	float disc = smoothstep(0.99996, 0.999985, mu);
	return sky_c + uSunDisc * disc * (0.6 + 0.4 * smoothstep(0.99996, 0.99999, mu));
}

// the radiance map (ambient light and reflections) is redone every frame: no cloud march in it, just their average tint
vec3 cubemapClouds(vec3 col, vec3 dir) {
	return mix(col, uCloudAmb * 0.9 + uCloudSun * 0.12, uCover * 0.55 * smoothstep(0.0, 0.25, dir.y));
}

// cirrus, 9 km up: thin streaks, lit by the sun; cloudA: the cumulus in front of them
vec3 addCirrus(vec3 col, vec3 dir, vec3 sky_c, float mu, float cloudA) {
	float t2 = 9000.0 / max(dir.y, 0.03);
	vec2 q = dir.xz * t2 + cloudWind() * 2.6;
	float s = texture(tNoise, vec2(q.x / 52000.0, q.y / 11000.0)).r * 0.7 + texture(tNoise, q / 6000.0).b * 0.3;
	float ca = smoothstep(0.52, 0.85, s) * uCirrus * (1.0 - cloudA) * smoothstep(0.0, 0.12, dir.y) * 0.55;
	return mix(col, sky_c * 0.55 + uCloudSun * (0.45 + hg(mu, 0.6) * 2.0), ca);
}

// night: stars (2500 over the dome in the web game) and the moon opposite the sun
vec3 addNight(vec3 col, vec3 dir) {
	if (uNight > 0.01 && dir.y > 0.0) {
		float vis = uNight * (1.0 - uCover) * (1.0 - uFogMix);
		vec3 p = dir * 70.0;
		vec3 cell = floor(p);
		float hs = fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
		if (hs > 0.972 && vis > 0.0) {
			vec3 c = cell + 0.2 + 0.6 * vec3(fract(hs * 7.31), fract(hs * 13.7), fract(hs * 29.1));
			float d = distance(p, c);
			col += vec3(0.9, 0.93, 1.0) * smoothstep(0.045, 0.0, d) * vis * (0.5 + 0.9 * fract(hs * 91.7));
		}
		vec3 mdir = normalize(vec3(-uSun.x, abs(uSun.y) + 0.133, -uSun.z));
		float ang = acos(clamp(dot(dir, mdir), -1.0, 1.0));
		float halo = (1.0 - smoothstep(0.0158, 0.0317, ang)) * 0.25;
		float core = 1.0 - smoothstep(0.0127, 0.0158, ang);
		col = mix(col, vec3(0.78, 0.82, 1.0), halo * uNight * (1.0 - uCover * 0.9));
		col = mix(col, vec3(1.0, 1.0, 0.94) * 1.4, core * uNight * (1.0 - uCover * 0.9));
	}
	return col;
}
