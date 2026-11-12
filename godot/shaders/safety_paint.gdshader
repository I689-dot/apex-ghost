shader_type spatial;
// The safety car's paint (SafetyCarLook): the Vantage GT3's livery turned to the safety car's colours by its brightness,
// the dark and middle tones the green, the light ones (lettering, stripes) white, so the livery's graphics show through.

uniform sampler2D livery : source_color, filter_linear_mipmap_anisotropic;
uniform vec3 paint : source_color = vec3(0.043, 0.365, 0.231);
uniform vec3 light : source_color = vec3(0.92, 0.93, 0.9);
uniform float roughness_v = 0.28;

void fragment() {
	vec3 c = texture(livery, UV).rgb;
	float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
	ALBEDO = mix(paint * mix(0.75, 1.15, smoothstep(0.02, 0.35, l)), light, smoothstep(0.45, 0.7, l));
	ROUGHNESS = roughness_v;
	METALLIC = 0.35;
	CLEARCOAT = 1.0;
	CLEARCOAT_ROUGHNESS = 0.05;
}
