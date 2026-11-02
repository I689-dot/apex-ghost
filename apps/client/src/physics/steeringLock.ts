/**
 * Steering-wheel rotation lock to lock (degrees) of each car, as the sims set them from the real cars (ACC's per-car
 * locks, Coach Dave Academy's list: Porsche 911 GT3 R 800°, Ferrari 296 GT3 800°, BMW M4 GT3 516°, Mercedes-AMG
 * GT3 640°, McLaren 720S / 650S GT3 480°, Lamborghini Huracán GT3 620°, Audi R8 LMS 720°, Aston Martin Vantage
 * GT3 640°, Lexus RC F GT3 640°, Ford Mustang GT3 516°). Cars not in the list: estimates from their siblings.
 *
 * Used for the steering wheel in the cockpit (it turns as far as the real one) and for a real wheel's soft lock: a
 * wheel base set to 900° drives a 516° car with 516° of its rotation, as ACC and iRacing do.
 */
const LOCKS: [RegExp, number][] = [
  [/porsche/, 800],
  [/ferrari_296_gt3/, 800],
  [/ferrari_296_challenge/, 640],
  [/bmw_m4/, 516],
  [/mercedes_amg_gt3|mercedes_amg_gt3_evo|marin_kitagawa/, 640],
  [/project_one/, 540],
  [/mclaren/, 480],
  [/lamborghini/, 620],
  [/audi/, 720],
  [/vantage/, 640],
  [/lexus/, 640],
  [/mustang/, 516],
  // the Corvette Z06 GT3.R is not in the list: a front-engined GT3 like the Mustang and the AMG
  [/corvette/, 560],
];

export function steeringLockDeg(carId: string): number {
  for (const [re, deg] of LOCKS) if (re.test(carId)) return deg;
  return 600;
}
