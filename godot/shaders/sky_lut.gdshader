shader_type canvas_item;
// The sky-view LUT (128 x 64): relative azimuth to the sun x sqrt(elevation), re-rendered only when the sun or the
// haze changes (port of the LUT pass of game/sky.ts). Radiance is stored as half-float HDR.
#include "res://shaders/atmosphere.gdshaderinc"

uniform vec3 uSun = vec3(0.0, 1.0, 0.0);
uniform float uHaze = 1.0;

void fragment() {
	float az = UV.x * 3.14159265;
	float el = UV.y * UV.y * 1.5707963;
	vec3 dir = vec3(cos(el) * cos(az), sin(el), cos(el) * sin(az));
	vec3 sun = vec3(sqrt(max(0.0, 1.0 - uSun.y * uSun.y)), uSun.y, 0.0);
	COLOR = vec4(atmo(normalize(dir), normalize(sun), uHaze), 1.0);
}
