// Разовый генератор фонового звука намаза (res/raw/prayer.wav).
// Чистый Node, без зависимостей: 16-bit PCM WAV, ~4 с, макам-фраза (Hijaz)
// аддитивным синтезом + вибрато + эхом, чтобы сигнал был длинным и мягким.
const fs = require('fs');
const SR = 44100, DUR = 4.0, N = Math.round(SR * DUR);
const buf = new Float64Array(N);

//音 highjaz на ре: D Eb F# G A Bb C# D
const SCALE = [293.66, 311.13, 369.99, 392.0, 440.0, 466.16, 554.37, 587.33];
// восходящая-нисходящая фраза: ступень, старт (с), длительность (с), громкость
const PHRASE = [
  [0, 0.05, 0.55, 0.55], [2, 0.55, 0.45, 0.7], [3, 0.95, 0.6, 0.85],
  [4, 1.5, 0.5, 1.0], [5, 1.95, 0.45, 0.9], [4, 2.35, 0.45, 0.8],
  [3, 2.75, 0.6, 0.85], [2, 3.3, 0.55, 0.6], [0, 3.5, 0.5, 0.45],
];

function addNote(at, freq, len, vol) {
  const start = Math.floor(at * SR), span = Math.floor((len + 0.9) * SR);
  // колоколо-флейтовый тембр: нечётные гармоники затухают быстрее чётных
  const parts = [[1, 1.0, 2.6], [2, 0.42, 2.0], [3, 0.20, 1.5], [4, 0.09, 1.2], [6, 0.05, 1.0]];
  for (let i = 0; i < span; i++) {
    const idx = start + i; if (idx >= N) break;
    const t = i / SR;
    const att = Math.min(1, t / 0.045);            // мягкая атака
    const dec = Math.exp(-t * (1 / (len * 0.9)));   // спад по ноте
    const env = att * Math.min(dec, Math.exp(-Math.max(0, t - len) * 3.2));
    const vib = 1 + 0.006 * Math.sin(2 * Math.PI * 5.4 * t) * Math.min(1, t / 0.35);
    let s = 0;
    for (const [h, a, d] of parts) {
      if (freq * h > SR / 2) break;
      s += a * Math.exp(-t * d * 0.55) * Math.sin(2 * Math.PI * freq * h * vib * t);
    }
    buf[idx] += s * env * vol * 0.28;
  }
}

PHRASE.forEach(([st, at, len, vol]) => {
  addNote(at, SCALE[st], len, vol);
  addNote(at + 0.02, SCALE[st] * 2, len * 0.6, vol * 0.22); // октавная подсветка
});

// эхо = ощущение пространства и длинный хвост на 4 секунде
[[0.19, 0.42], [0.38, 0.22], [0.62, 0.12]].forEach(([d, g]) => {
  const off = Math.floor(d * SR), copy = Float64Array.from(buf);
  for (let i = off; i < N; i++) buf[i] += copy[i - off] * g;
});

let peak = 0; for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(buf[i]));
const norm = 0.72 / peak;

const data = Buffer.alloc(N * 2);
for (let i = 0; i < N; i++) {
  const fade = Math.min(1, i / (SR * 0.01)) * Math.min(1, (N - i) / (SR * 0.25));
  let v = Math.max(-1, Math.min(1, buf[i] * norm * fade));
  data.writeInt16LE((v * 32767) | 0, i * 2);
}

const hdr = Buffer.alloc(44);
hdr.write('RIFF', 0); hdr.writeUInt32LE(36 + data.length, 4); hdr.write('WAVE', 8);
hdr.write('fmt ', 12); hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20);
hdr.writeUInt16LE(1, 22); hdr.writeUInt32LE(SR, 24); hdr.writeUInt32LE(SR * 2, 28);
hdr.writeUInt16LE(2, 32); hdr.writeUInt16LE(16, 34);
hdr.write('data', 36); hdr.writeUInt32LE(data.length, 40);

fs.mkdirSync('android/app/src/main/res/raw', { recursive: true });
fs.writeFileSync('android/app/src/main/res/raw/prayer.wav', Buffer.concat([hdr, data]));
console.log('OK prayer.wav', (44 + data.length) / 1024, 'KiB,', DUR, 's');
