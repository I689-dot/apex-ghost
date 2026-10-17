/**
 * Offline render of every car's engine sound (recorded bank + procedural layer, exactly as in game): a rev
 * sweep (idle → redline at full load, then lift-off) to WAV files in tools/sim/out/, plus the RMS of the two
 * layers on their own and mixed, so all engines sit at similar loudness. `--synth` renders the procedural layer
 * alone (the old sound) for comparison.
 *
 *   pnpm tsx tools/sim/engineaudio.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CarsFile } from '../../packages/shared/src/index.ts';
import { engineProfileFor } from '../../apps/client/src/audio/engineProfiles.ts';
import { EngineDSP, SampleEngine, mixEngine } from '../../apps/client/src/audio/engine-worklet.js';
import { decodeBank, type EngineBankMeta } from '../../apps/client/src/audio/engineBank.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'out');
mkdirSync(out, { recursive: true });
const cars = JSON.parse(readFileSync(path.resolve(here, '../../apps/client/public/assets/cars.json'), 'utf8')) as CarsFile;
const SR = 44100;
const synthOnly = process.argv.includes('--synth');
const audioDir = path.resolve(here, '../../apps/client/public/assets/audio');
const bankFor = (name: string) => {
  const meta = JSON.parse(readFileSync(path.join(audioDir, `engine_${name}.json`), 'utf8')) as EngineBankMeta;
  const pcm = readFileSync(path.join(audioDir, `engine_${name}.bin`));
  return decodeBank(meta, pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength), SR);
};

function wav(samples: Float32Array): Buffer {
  const b = Buffer.alloc(44 + samples.length * 2);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + samples.length * 2, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(SR, 24);
  b.writeUInt32LE(SR * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) b.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(samples[i] * 32767))), 44 + i * 2);
  return b;
}

const seen = new Set<string>();
for (const car of cars.cars) {
  const p = engineProfileFor(car);
  if (seen.has(p.name)) continue;
  seen.add(p.name);
  const dsp = new EngineDSP(SR, p);
  const rec = synthOnly ? null : new SampleEngine(SR, bankFor(p.bank), p.cyl);
  // layer levels on their own (same sweep), for calibrating sampleGain against the old procedural level
  const solo = { synth: new EngineDSP(SR, p), rec: synthOnly ? null : new SampleEngine(SR, bankFor(p.bank), p.cyl) };
  const tmp = new Float32Array(128);
  let sSyn = 0;
  let sRec = 0;
  const secs = 7;
  const n = SR * secs;
  const buf = new Float32Array(n);
  const B = 128;
  let rpm = p.idle;
  let load = 0;
  let peak = 0;
  let sum = 0;
  let cnt = 0;
  for (let i = 0; i < n; i += B) {
    const t = i / SR;
    // 0-1 s idle, 1-5 s full-load sweep to redline, 5-7 s lift-off (overrun)
    const tr = t < 1 ? p.idle : t < 5 ? p.idle + (p.redline - p.idle) * ((t - 1) / 4) : p.redline - p.redline * 0.5 * ((t - 5) / 2);
    const tl = t < 1 ? 0.05 : t < 5 ? 1 : 0;
    const m = Math.min(B, n - i);
    mixEngine(dsp, rec, p, buf.subarray(i, i + m), m, rpm, tr, load, tl, 0);
    if (t > 2 && t < 5) {
      solo.synth.render(tmp, m, rpm, tr, load, tl, 0);
      for (let k = 0; k < m; k++) sSyn += tmp[k] * tmp[k];
      if (solo.rec) {
        tmp.fill(0);
        solo.rec.render(tmp, m, rpm, tr, load, tl, 0, p.sampleGain * Math.min(1.25, 0.45 + 0.6 * ((rpm + tr) / 2 / p.redline)));
        for (let k = 0; k < m; k++) sRec += tmp[k] * tmp[k];
      }
    }
    rpm = tr;
    load = tl;
    if (t > 2 && t < 5)
      for (let k = i; k < Math.min(n, i + B); k++) {
        peak = Math.max(peak, Math.abs(buf[k]));
        sum += buf[k] * buf[k];
        cnt++;
      }
  }
  if (buf.some((x) => !Number.isFinite(x))) throw new Error(`${p.name}: non-finite samples`);
  const file = `${car.id}${synthOnly ? '_synth' : ''}.wav`;
  writeFileSync(path.join(out, file), wav(buf));
  const rms = (x: number) => Math.sqrt(x / cnt).toFixed(3);
  console.log(`${p.name.padEnd(55)} full-load RMS ${rms(sum)} (synth ${rms(sSyn)}, recording ${rms(sRec)})  peak ${peak.toFixed(2)}  → tools/sim/out/${file}`);
}
