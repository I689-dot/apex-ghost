# Controller (gamepad) steering

How APEX GHOST turns a thumbstick and two triggers into steering and pedals, and why.

## What other racing games do

Pad steering in sims is built from the same stages almost everywhere; only the names differ.

| Stage | ACC | RaceRoom / BeamNG / others | Purpose |
|---|---|---|---|
| Dead zone (rescaled) | Deadzone 1–2 % | 0.05–0.15 | ignore stick drift without a jump at its edge |
| Response curve | Steer gamma 2.2–3.5 (raw lock) | linearity / gamma ≈ 1.5 | fine control near centre, full lock at the rim |
| Rate limit | Steer filter / steer speed | rate 6/s → 2.5/s with speed | hide the stick's instant jumps; keeps the car settled |
| Speed sensitivity | 50–75 % | lock or rate falls with speed | small inputs at 250 km/h are lane changes, not spins |
| Slip-angle limit | Steer assist | Forza "normal" steering, BeamNG understeer reduction | full stick = front tyres at peak grip, not full lock |
| Counter-steer help | Steer assist | oversteer reduction | a pad cannot feel the rear going |

Players' complaints point the same way: too much filtering feels like "driving a brick"; too little is twitchy;
too much speed reduction makes fast corners feel delayed.

Sources: Coach Dave Academy and SimRacingSetup ACC controller guides; ACC Steam discussions on steer filter /
speed / gamma; solox.gg RaceRoom pad setup; BeamNG forum threads on understeer/oversteer reduction;
gambarini/racing PR #75 (open-source gamepad steering filter).

## What we do

1. **Stick** (src/input/gamepad.ts): dead zone 6 % with the rest rescaled, full value at 97 % travel, curve
   exponent 1.7 (player setting 1–3). Applied once; the physics profile only adds a mild 1.0 → 1.25 curve at speed.
2. **Physics step, PAD profile** (src/physics/keyboardDriver.ts, 120 Hz):
   - rate limit 7.5/s (out), 9/s (back to centre), 11/s (reversing) at low speed, falling to 3.2 / 4.5 / 5.5/s at
     240 km/h, scaled by "steering speed" and "speed sensitivity"; 30 ms low-pass for stick jitter;
   - the same slip-based limit as the keys, at 97 % of the peak slip angle (90 % at 240 km/h): full stick is the
     grip limit at every speed, so speed sensitivity comes from the tyres, not an arbitrary lock reduction;
   - the limit opens up to the rear slip angle when counter-steering, so slides can always be caught;
   - self-steer (caster), blended out by the input.
   Measured: full stick reaches 90 % in 160 ms at 60 km/h and 320 ms at 240 km/h (keys: 280 / 740 ms);
   a 30 % correction takes 90–130 ms.
3. **Triggers**: 4 % rest dead zone, full just before the end stop, throttle curve 1.1, brake curve 1.4 (player
   setting) so the short trigger travel is spent near the locking point; ramps of 14–22/s just hide sensor steps.
4. **Rumble** on wall hits, scaled by the impulse.
