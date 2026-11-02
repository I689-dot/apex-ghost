// Physically based sky: single scattering through a spherical atmosphere (Rayleigh, Mie and ozone). Port of
// ATMOSPHERE_GLSL in game/atmosphere.ts. Units: kilometres. Radiance x SKY_EXPOSURE for a sun of SUN_E.
const float A_RE = 6360.000;
const float A_RA = 6420.000;
const vec3 A_BR = vec3(5.8020e-3, 1.3558e-2, 3.3100e-2);
const float A_BM = 3.9960e-3;
const vec3 A_BO = vec3(6.5000e-4, 1.8810e-3, 8.5000e-5);
const float A_PI = 3.14159265;
const float A_VIEW_H = 0.600;
const float A_SUN_E = 20.0;
const float A_SKY_EXPOSURE = 1.25;

vec2 atmoRaySphere(vec3 o, vec3 d, float r) {
	float b = dot(o, d);
	float c = dot(o, o) - r * r;
	float h = b * b - c;
	if (h < 0.0) {
		return vec2(-1.0, -1.0);
	}
	h = sqrt(h);
	return vec2(-b - h, -b + h);
}

// optical depth densities at height h: rayleigh, mie, ozone
vec3 atmoDensity(float h) {
	return vec3(exp(-h / 8.000), exp(-h / 1.200), max(0.0, 1.0 - abs(h - 25.0) / 15.0));
}

vec3 atmoExtinction(vec3 od, float haze) {
	return A_BR * od.x + A_BM * 1.11 * haze * od.y + A_BO * od.z;
}

vec3 atmoTransmittance(vec3 dir, float haze) {
	vec3 o = vec3(0.0, A_RE + A_VIEW_H, 0.0);
	vec2 t = atmoRaySphere(o, dir, A_RA);
	vec3 od = vec3(0.0);
	for (int i = 0; i < 12; i++) {
		// quadratic spacing: dense steps in the thick air near the ground
		float u = (float(i) + 0.5) / 12.0;
		float ds = 2.0 * u * t.y / 12.0;
		vec3 p = o + dir * (u * u * t.y);
		od += atmoDensity(length(p) - A_RE) * ds;
	}
	vec2 g = atmoRaySphere(o, dir, A_RE);
	return g.x > 0.0 ? vec3(0.0) : exp(-atmoExtinction(od, haze));
}

vec3 atmo(vec3 dir, vec3 sunDir, float haze) {
	vec3 o = vec3(0.0, A_RE + A_VIEW_H, 0.0);
	vec2 ta = atmoRaySphere(o, dir, A_RA);
	vec2 tg = atmoRaySphere(o, dir, A_RE);
	float len = tg.x > 0.0 ? tg.x : ta.y;
	float mu = dot(dir, sunDir);
	float pr = 3.0 / (16.0 * A_PI) * (1.0 + mu * mu);
	float g = 0.76;
	float g2 = g * g;
	float pm = 3.0 / (8.0 * A_PI) * ((1.0 - g2) * (1.0 + mu * mu)) / ((2.0 + g2) * pow(max(1e-4, 1.0 + g2 - 2.0 * g * mu), 1.5));
	vec3 odv = vec3(0.0);
	vec3 sr = vec3(0.0);
	vec3 sm = vec3(0.0);
	for (int i = 0; i < 16; i++) {
		float u = (float(i) + 0.5) / 16.0;
		float ds = 2.0 * u * len / 16.0;
		vec3 p = o + dir * (u * u * len);
		float h = length(p) - A_RE;
		vec3 d = atmoDensity(h) * ds;
		odv += d;
		// light ray to the sun: blocked by the planet, else integrate
		vec2 sg = atmoRaySphere(p, sunDir, A_RE);
		if (sg.x > 0.0) {
			continue;
		}
		vec2 sa = atmoRaySphere(p, sunDir, A_RA);
		float dl = sa.y / 4.0;
		vec3 odl = vec3(0.0);
		for (int j = 0; j < 4; j++) {
			vec3 q = p + sunDir * (float(j) + 0.5) * dl;
			odl += atmoDensity(length(q) - A_RE) * dl;
		}
		vec3 tau = atmoExtinction(odv + odl, haze);
		vec3 att = exp(-tau);
		sr += att * d.x;
		sm += att * d.y;
	}
	return A_SUN_E * (sr * A_BR * pr + sm * A_BM * haze * pm) * A_SKY_EXPOSURE;
}
