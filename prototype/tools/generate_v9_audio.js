'use strict';

/* Deterministic, tiny PCM loops for the public H5 story. They intentionally
 * stay mono/8-bit so five lazy-loaded beds add less than 350 KiB to the build. */
const fs = require('fs');
const path = require('path');

const SAMPLE_RATE = 11025;
const OUTPUT = path.resolve(__dirname, '..', 'assets', 'audio');

function clamp(value) { return Math.max(-1, Math.min(1, value)); }
function seeded(seed) {
  let value = seed >>> 0;
  return function () {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function writeWave(filename, seconds, sampleAt) {
  const count = Math.floor(seconds * SAMPLE_RATE);
  const data = Buffer.alloc(count);
  for (let index = 0; index < count; index += 1) {
    const time = index / SAMPLE_RATE;
    const edge = Math.min(1, time / 0.05, (seconds - time) / 0.05);
    data[index] = Math.round(128 + 126 * clamp(sampleAt(time, index) * Math.max(0, edge)));
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE, 28);
  header.writeUInt16LE(1, 32);
  header.writeUInt16LE(8, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  fs.writeFileSync(path.join(OUTPUT, filename), Buffer.concat([header, data]));
}

function melody(notes, base, seed) {
  const random = seeded(seed);
  const shimmer = Array.from({ length: 48 }, () => random() * 2 - 1);
  return function (time) {
    const beatLength = 0.9;
    const beat = Math.floor(time / beatLength);
    const local = time - beat * beatLength;
    const frequency = notes[beat % notes.length];
    const pluck = Math.exp(-3.2 * local) * (
      Math.sin(Math.PI * 2 * frequency * local) * 0.2 +
      Math.sin(Math.PI * 2 * frequency * 2.01 * local) * 0.055
    );
    const breath = 0.035 * Math.sin(Math.PI * 2 * base * time) +
      0.018 * Math.sin(Math.PI * 2 * (base * 1.5) * time);
    return breath + pluck + shimmer[beat % shimmer.length] * 0.008;
  };
}

fs.mkdirSync(OUTPUT, { recursive: true });

writeWave('bgm_qiongqi_gate.wav', 8, melody([293.66, 369.99, 440, 369.99, 329.63, 293.66, 246.94, 293.66], 73.42, 17));
writeWave('bgm_qiongqi_home.wav', 8, melody([293.66, 369.99, 440, 493.88, 440, 369.99, 329.63, 369.99], 73.42, 29));

{
  const random = seeded(41);
  let wind = 0;
  writeWave('amb_gate_wind.wav', 5, function (time) {
    wind = wind * 0.985 + (random() * 2 - 1) * 0.015;
    const gust = 0.45 + 0.35 * Math.sin(Math.PI * 2 * 0.13 * time);
    const bell = Math.exp(-5 * (time % 2.5)) * Math.sin(Math.PI * 2 * 784 * time) * 0.018;
    return wind * gust * 0.9 + bell;
  });
}

{
  const random = seeded(53);
  let room = 0;
  let crackle = 0;
  writeWave('amb_clinic_fire.wav', 5, function (time) {
    room = room * 0.96 + (random() * 2 - 1) * 0.04;
    if (random() > 0.996) crackle = 0.18 + random() * 0.18;
    crackle *= 0.87;
    return 0.018 * Math.sin(Math.PI * 2 * 92 * time) + room * 0.08 + crackle;
  });
}

{
  const random = seeded(67);
  let low = 0;
  let drop = 0;
  writeWave('amb_rain.wav', 5, function (time) {
    const white = random() * 2 - 1;
    low = low * 0.82 + white * 0.18;
    if (random() > 0.993) drop = 0.28 + random() * 0.22;
    drop *= 0.91;
    return (white - low) * 0.105 + low * 0.045 + drop * Math.sin(Math.PI * 2 * 1180 * time);
  });
}

console.log('Generated v9 BGM and ambience loops in ' + OUTPUT);
