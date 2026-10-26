/* ============================================================
   1. DATOS: las cinco zonas del paisaje
   nx, ny: posición relativa en la pantalla (0 a 1)
   pan: posición en el estéreo (-1 izquierda, 1 derecha)
   scale: volumen relativo de la zona
   ============================================================ */
const RGB = {
  agua: [82, 184, 204], viento: [183, 195, 221], aves: [232, 182, 79],
  voces: [224, 127, 152], tierra: [134, 166, 95]
};
const ZONES = [
  { id: 'agua',   name: 'Agua',   hint: 'gotas y corriente', nx: 0.20, ny: 0.62, pan: -0.7, scale: 0.9 },
  { id: 'viento', name: 'Viento', hint: 'aire en movimiento', nx: 0.46, ny: 0.26, pan: -0.2, scale: 0.8 },
  { id: 'aves',   name: 'Aves',   hint: 'cantos breves',      nx: 0.82, ny: 0.27, pan: 0.7,  scale: 0.9 },
  { id: 'voces',  name: 'Voces',  hint: 'coro lejano',        nx: 0.76, ny: 0.70, pan: 0.4,  scale: 0.8 },
  { id: 'tierra', name: 'Tierra', hint: 'graves profundos',   nx: 0.43, ny: 0.76, pan: 0,    scale: 0.9 }
];
ZONES.forEach(z => { z.level = 0; z.forced = 0; });

/* ============================================================
   2. SONIDO: motor de síntesis con Web Audio
   Cada zona tiene su propia "voz" con un volumen que sigue
   a z.level (0 a 1). Todo pasa por un compresor y una reverb.
   ============================================================ */
function makeNoise(ctx) {
  const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}
function makeImpulse(ctx, secs, decay) {
  const len = Math.floor(ctx.sampleRate * secs);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}
function loopNoise(A) {
  const s = A.ctx.createBufferSource();
  s.buffer = A.noise; s.loop = true; s.start();
  return s;
}
function mkOut(A, z, send) {
  const out = A.ctx.createGain();     // salida real de la zona (su volumen lo controla el nivel)
  out.gain.value = 0;
  const syn = A.ctx.createGain();     // aquí se conecta el sonido sintetizado
  syn.connect(out);
  A.outs[z.id] = { out, syn };
  const pan = A.ctx.createStereoPanner ? A.ctx.createStereoPanner() : null;
  let last = out;
  if (pan) { pan.pan.value = z.pan; out.connect(pan); last = pan; }
  last.connect(A.master);
  const s = A.ctx.createGain();
  s.gain.value = send;
  last.connect(s); s.connect(A.rev);
  // Analizador: permite leer la forma real de la onda de esta zona
  const an = A.ctx.createAnalyser();
  an.fftSize = 512;
  out.connect(an);
  A.an[z.id] = an;
  return syn;
}
function mkLfo(A, freq, depth, target) {
  const o = A.ctx.createOscillator(), g = A.ctx.createGain();
  o.frequency.value = freq; g.gain.value = depth;
  o.connect(g); g.connect(target); o.start();
}

const BUILD = {
  agua(A, z) {
    const { ctx } = A, out = mkOut(A, z, 0.5);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.7;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200;
    const g = ctx.createGain(); g.gain.value = 0.5;
    loopNoise(A).connect(bp); bp.connect(lp); lp.connect(g); g.connect(out);
    mkLfo(A, 0.35, 450, bp.frequency);
    return {
      out,
      tune(L, now) { bp.frequency.setTargetAtTime(700 + L * 800, now, 0.1); },
      fire() { // una gota
        const t = ctx.currentTime, o = ctx.createOscillator(), e = ctx.createGain();
        const f = 500 + Math.random() * 1100;
        o.frequency.setValueAtTime(f, t);
        o.frequency.exponentialRampToValueAtTime(f * 1.7, t + 0.09);
        e.gain.setValueAtTime(0.0001, t);
        e.gain.exponentialRampToValueAtTime(0.35, t + 0.01);
        e.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
        o.connect(e); e.connect(out); o.start(t); o.stop(t + 0.26);
      }
    };
  },
  viento(A, z) {
    const { ctx } = A, out = mkOut(A, z, 0.6);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 450; bp.Q.value = 1.4;
    const g = ctx.createGain(); g.gain.value = 0.8;
    loopNoise(A).connect(bp); bp.connect(g); g.connect(out);
    mkLfo(A, 0.11, 220, bp.frequency);
    mkLfo(A, 0.17, 0.3, g.gain);
    return { out, tune(L, now) { bp.frequency.setTargetAtTime(380 + L * 600, now, 0.12); } };
  },
  aves(A, z) {
    const { ctx } = A, out = mkOut(A, z, 0.55);
    return {
      out,
      fire() { // un canto de 1 a 3 notas
        const n = 1 + Math.floor(Math.random() * 3);
        const base = 2400 + Math.random() * 1800;
        let t = ctx.currentTime;
        for (let i = 0; i < n; i++) {
          const o = ctx.createOscillator(), e = ctx.createGain();
          const f = base * (1 + Math.random() * 0.25);
          o.frequency.setValueAtTime(f, t);
          o.frequency.exponentialRampToValueAtTime(f * (Math.random() < 0.5 ? 1.35 : 0.75), t + 0.08);
          e.gain.setValueAtTime(0.0001, t);
          e.gain.exponentialRampToValueAtTime(0.22, t + 0.01);
          e.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
          o.connect(e); e.connect(out); o.start(t); o.stop(t + 0.14);
          t += 0.09 + Math.random() * 0.05;
        }
      }
    };
  },
  voces(A, z) {
    const { ctx } = A, out = mkOut(A, z, 0.8);
    const bus = ctx.createGain(); bus.gain.value = 0.25;
    const f1 = ctx.createBiquadFilter(), f2 = ctx.createBiquadFilter();
    f1.type = f2.type = 'bandpass'; f1.Q.value = 8; f2.Q.value = 10;
    f1.frequency.value = 700; f2.frequency.value = 1100;
    const mix = ctx.createGain(); mix.gain.value = 1.2;
    bus.connect(f1); bus.connect(f2); f1.connect(mix); f2.connect(mix); mix.connect(out);
    mkLfo(A, 4.8, 0.08, mix.gain);
    const chords = [[110, 165, 220, 330], [98, 147, 196, 294], [123.5, 185, 247, 370], [87.3, 131, 175, 262]];
    const vowels = [[700, 1100], [400, 2000], [300, 2300], [500, 900], [350, 700]];
    const oscs = chords[0].map(f => {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
      o.detune.value = (Math.random() - 0.5) * 18; o.connect(bus); o.start(); return o;
    });
    return {
      out,
      shift() { // cambia la vocal y el acorde, despacio
        const now = ctx.currentTime;
        const v = vowels[Math.floor(Math.random() * vowels.length)];
        const c = chords[Math.floor(Math.random() * chords.length)];
        f1.frequency.setTargetAtTime(v[0], now, 0.6);
        f2.frequency.setTargetAtTime(v[1], now, 0.6);
        oscs.forEach((o, i) => o.frequency.setTargetAtTime(c[i], now, 0.8));
      }
    };
  },
  tierra(A, z) {
    const { ctx } = A, out = mkOut(A, z, 0.4);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 220;
    const g = ctx.createGain(); g.gain.value = 0.7;
    [[55, 'sine'], [82.4, 'sine'], [110, 'triangle']].forEach(([f, type]) => {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = f;
      o.connect(lp); o.start();
    });
    lp.connect(g); g.connect(out);
    mkLfo(A, 0.15, 0.2, g.gain);
    return { out };
  }
};

// Volumen relativo de cada archivo propio (sube el número si tu grabación suena baja)
const SAMPLE_GAIN = { agua: 1, viento: 1, aves: 1, voces: 1, tierra: 1 };

const Motor = {
  ctx: null, master: null, voices: {}, analysers: {}, outs: {}, buf: null, muted: false, vol: 0.7,
  init() {
    if (this.ctx) { this.ctx.resume(); return true; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    const ctx = this.ctx = new AC();
    const comp = ctx.createDynamicsCompressor();
    const master = this.master = ctx.createGain();
    master.gain.value = this.muted ? 0 : this.vol;
    master.connect(comp); comp.connect(ctx.destination);
    const rev = ctx.createConvolver(); rev.buffer = makeImpulse(ctx, 3, 2.6);
    const rg = ctx.createGain(); rg.gain.value = 0.5; rev.connect(rg); rg.connect(master);
    const A = { ctx, master, rev, noise: makeNoise(ctx), an: this.analysers, outs: this.outs };
    ZONES.forEach(z => {
      const v = BUILD[z.id](A, z);
      v.syn = this.outs[z.id].syn;      // sonido sintetizado
      v.out = this.outs[z.id].out;      // salida real (volumen por nivel)
      this.voices[z.id] = v;
    });
    ZONES.forEach(z => this.autoLoad(z.id));   // busca audio/agua.mp3, audio/aves.mp3, etc.
    setInterval(() => { const v = this.voices.voces; if (v) v.shift(); }, 3200);
    return true;
  },
  // Devuelve n valores entre -1 y 1 con la forma de onda actual de la zona.
  // Si no hay audio (modo sin sonido), devuelve una forma simulada.
  shape(z, n) {
    const out = new Float32Array(n);
    const an = this.analysers[z.id];
    if (an) {
      if (!this.buf) this.buf = new Float32Array(an.fftSize);
      an.getFloatTimeDomainData(this.buf);
      let peak = 0;
      for (let i = 0; i < this.buf.length; i++) peak = Math.max(peak, Math.abs(this.buf[i]));
      if (peak > 0.0005) {
        const step = this.buf.length / n;
        for (let i = 0; i < n; i++) out[i] = this.buf[Math.floor(i * step)] / peak;
        return out;
      }
    }
    const seed = z.nx * 50;
    for (let i = 0; i < n; i++) {
      out[i] = (noise(seed + i * 0.12, T * 1.5) - 0.5) * 2;
    }
    return out;
  },
  /* ---- SONIDOS PROPIOS ----
     Un archivo de audio reemplaza el sonido sintetizado de una zona.
     Se reproduce en bucle y el nivel de la zona controla volumen y brillo. */
  useSample(id, buffer, name) {
    const v = this.voices[id], ctx = this.ctx;
    if (!v) return;
    if (v.sample) { try { v.sample.src.stop(); } catch (_) {} v.sample.lp.disconnect(); }
    const src = ctx.createBufferSource();
    src.buffer = buffer; src.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1500;
    const g = ctx.createGain(); g.gain.value = SAMPLE_GAIN[id] || 1;
    src.connect(lp); lp.connect(g); g.connect(v.out);
    src.start(0, Math.random() * buffer.duration);
    v.syn.gain.setTargetAtTime(0, ctx.currentTime, 0.1);   // silencia el sonido sintetizado
    v.sample = { src, lp, g, name };
    onSample(id, name);
  },
  async loadFile(id, file) {
    this.init();
    const ab = await file.arrayBuffer();
    const buf = await this.ctx.decodeAudioData(ab);
    this.useSample(id, buf, file.name);
  },
  async autoLoad(id) {
    for (const ext of ['mp3', 'wav', 'ogg']) {
      try {
        const r = await fetch('audio/' + id + '.' + ext);
        if (!r.ok) continue;
        const buf = await this.ctx.decodeAudioData(await r.arrayBuffer());
        this.useSample(id, buf, id + '.' + ext);
        return;
      } catch (_) { /* sin archivo: se queda el sonido sintetizado */ }
    }
  },
  setLevel(z) {
    const v = this.voices[z.id];
    if (!v || !this.ctx) return;
    const now = this.ctx.currentTime;
    v.out.gain.setTargetAtTime(Math.pow(z.level, 1.4) * z.scale, now, 0.07);
    if (v.tune) v.tune(z.level, now);
    if (v.sample) v.sample.lp.frequency.setTargetAtTime(900 + z.level * 14000, now, 0.1);
  },
  trigger(id) {
    const v = this.voices[id];
    if (v && v.fire && this.ctx.state === 'running') v.fire();
  },
  setVol(x) {
    this.vol = x;
    if (this.master && !this.muted) this.master.gain.setTargetAtTime(x, this.ctx.currentTime, 0.05);
  },
  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : this.vol, this.ctx.currentTime, 0.05);
  }
};

/* ============================================================
   3. INTERACCIÓN: punteros (ratón, dedo o lápiz, varios a la vez)
   ============================================================ */
const pointers = new Map();
let lastAct = 0;           // último momento con actividad del público
let persist = 3;           // segundos que tarda en apagarse una zona
let T = 0;                 // tiempo de la animación
let cnv;
const ripples = [], flashes = [];
const calm = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
const TS = calm ? 0.35 : 1;

function influence(p, z) {
  const d = Math.hypot(p.x - z.cx, p.y - z.cy);
  const t = Math.min(1, Math.max(0, 1 - d / (z.R * 1.5)));
  const f = t * t * (3 - 2 * t);
  return f * (p.pressed ? 1 : 0.75);
}

/* ============================================================
   4. VISUAL: p5.js
   ============================================================ */
function geom() {
  const R = Math.min(width * 0.5, height * 0.8) * 0.26;
  ZONES.forEach(z => { z.cx = z.nx * width; z.cy = z.ny * height; z.R = R; });
}

function setup() {
  const st = document.getElementById('stage');
  cnv = createCanvas(st.clientWidth, st.clientHeight);
  cnv.parent(st);
  pixelDensity(Math.min(2, window.devicePixelRatio || 1));
  noiseSeed(7);
  const el = cnv.elt;
  el.style.touchAction = 'none';

  const upd = e => {
    lastAct = performance.now();
    const r = el.getBoundingClientRect();
    pointers.set(e.pointerId, {
      x: e.clientX - r.left, y: e.clientY - r.top,
      pressed: e.pointerType === 'touch' || (e.buttons & 1) === 1,
      type: e.pointerType
    });
  };
  el.addEventListener('pointerdown', e => {
    upd(e);
    try { el.setPointerCapture(e.pointerId); } catch (_) {}
    e.preventDefault();
  });
  el.addEventListener('pointermove', upd);
  el.addEventListener('pointerup', e => {
    if (e.pointerType === 'touch') pointers.delete(e.pointerId); else upd(e);
  });
  el.addEventListener('pointercancel', e => pointers.delete(e.pointerId));
  el.addEventListener('pointerleave', e => pointers.delete(e.pointerId));

  new ResizeObserver(() => resizeCanvas(st.clientWidth, st.clientHeight)).observe(st);
}

/* --- Sonidos sueltos (gotas y cantos): ya no dibujan nada, solo suenan --- */
function spawnDrop() { Motor.trigger('agua'); }
function spawnChirp() { Motor.trigger('aves'); }

/* --- Figuras ESTÁTICAS de cada zona (no se mueven ni reaccionan) --- */
const STATIC_T = 4.2;
function emblem(z) {
  const [r, g, b] = RGB[z.id], R = z.R;
  noFill();
  // anillo que marca el límite de la zona
  stroke(r, g, b, 60); strokeWeight(1);
  circle(z.cx, z.cy, R * 2.1);
  stroke(r, g, b, 95);
  if (z.id === 'agua') {
    for (let i = 1; i <= 4; i++) ellipse(z.cx, z.cy, R * 0.45 * i, R * 0.18 * i);
  } else if (z.id === 'viento') {
    for (let i = 0; i < 5; i++) {
      beginShape();
      for (let x = -0.9; x <= 0.9; x += 0.06) {
        const px = z.cx + x * R;
        vertex(px, z.cy + (i - 2) * R * 0.17 + (noise(px * 0.006, i * 0.7, STATIC_T) - 0.5) * R * 0.45);
      }
      endShape();
    }
  } else if (z.id === 'aves') {
    for (let i = 0; i < 9; i++) {
      const a = noise(i * 9.1, STATIC_T) * TWO_PI * 2;
      const rad = R * (0.2 + 0.7 * noise(i * 5.3 + 40, STATIC_T));
      const x = z.cx + Math.cos(a) * rad, y = z.cy + Math.sin(a) * rad * 0.8;
      line(x - 6, y + 3, x, y);
      noStroke(); fill(r, g, b, 150); circle(x, y, 3.5); noFill(); stroke(r, g, b, 95);
    }
  } else if (z.id === 'voces') {
    for (let k = 0; k < 3; k++) {
      beginShape();
      for (let a = 0; a < TWO_PI; a += TWO_PI / 40) {
        const n = noise(Math.cos(a) * 0.8 + k * 4, Math.sin(a) * 0.8 + k * 4, STATIC_T);
        const rr = R * (0.28 + k * 0.1) * (0.8 + n * 0.55);
        vertex(z.cx + Math.cos(a) * rr, z.cy + Math.sin(a) * rr);
      }
      endShape(CLOSE);
    }
  } else if (z.id === 'tierra') {
    for (let k = 0; k < 4; k++) {
      beginShape();
      for (let x = -0.9; x <= 0.9; x += 0.06) {
        const px = z.cx + x * R;
        vertex(px, z.cy - R * 0.25 + k * R * 0.17 + Math.sin(x * 3 + k * 1.7) * R * 0.07);
      }
      endShape();
    }
  }
}

/* --- IMAGEN GENERADA por la interacción ---
   Cada zona tiene su propio lienzo (buffer) en el centro. Mientras la zona suena,
   se dibuja sobre él la forma de onda real de ese sonido, en anillo y girando, y la
   figura crece desde el centro. Al soltar, la imagen se desvanece sola. */
const WAVE_N = 96;
function ensureBuf(z) {
  const S = Math.ceil(z.R * 2.2 / 2) * 2;
  if (z.buf && z.S === S) return;
  if (z.buf) z.buf.remove();
  z.S = S;
  z.buf = createGraphics(S, S);
  const c = z.buf.drawingContext;
  c.beginPath(); c.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2); c.clip();   // recorte circular
  z.grow = z.grow || 0; z.rot = z.rot || 0; z.phase = z.phase || Math.random() * 6; z.idle = z.idle || 0;
  z.dir = z.dir || (z.nx > 0.5 ? -1 : 1);
}
function paintZone(z, dt) {
  const L = z.level, h = z.S / 2, buf = z.buf, f = dt * 60;
  const [r, g, b] = RGB[z.id];
  if (L > 0.03) {
    z.idle = 0;
    const wv = Motor.shape(z, WAVE_N);
    z.grow = Math.min(1, z.grow + dt * L * 0.16);
    z.rot += dt * (0.25 + L * 1.3) * z.dir;
    z.phase += dt * (0.5 + L * 1.5);
    const rmax = z.R * (0.22 + 0.68 * z.grow);
    const amp = z.R * (0.1 + 0.22 * L) * (0.4 + 0.6 * z.grow);
    buf.push();
    buf.translate(h, h);
    buf.rotate(z.rot);
    buf.noFill();
    buf.stroke(r, g, b, Math.min(255, (5 + 32 * L) * f));
    buf.strokeWeight(0.8);
    buf.beginShape();
    for (let i = 0; i <= WAVE_N; i++) {
      const a = (i % WAVE_N) / WAVE_N * TWO_PI;
      const rr = rmax * (0.3 + 0.55 * (0.5 + 0.5 * Math.sin(z.phase))) + wv[i % WAVE_N] * amp;
      buf.vertex(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    buf.endShape(CLOSE);
    buf.noStroke();
    buf.fill(r, g, b, Math.min(255, 8 * L * f));
    buf.circle(0, 0, z.R * (0.05 + 0.16 * z.grow));      // núcleo luminoso
    buf.pop();
    // desvanecimiento muy lento mientras se interactúa, para no saturar
    buf.erase(Math.min(255, 255 * (1 - Math.exp(-dt / (persist * 10)))));
    buf.noStroke(); buf.rect(0, 0, z.S, z.S); buf.noErase();
  } else if (z.grow > 0 || z.idle < 99) {
    z.idle += dt;
    z.grow = Math.max(0, z.grow - dt / (persist * 2));
    buf.erase(Math.min(255, 255 * (1 - Math.exp(-dt / (persist * 0.7)))));
    buf.noStroke(); buf.rect(0, 0, z.S, z.S); buf.noErase();
    if (z.idle > persist * 3 + 1) { buf.clear(); z.grow = 0; z.idle = 99; }
  }
}
function showZone(z) {
  if (z.idle >= 99 && z.level <= 0.03) return;
  blendMode(ADD);
  image(z.buf, z.cx - z.S / 2, z.cy - z.S / 2);
  blendMode(BLEND);
}

function draw() {
  const dt = Math.min(deltaTime, 50) / 1000;
  T += dt * TS;
  clear();
  geom();

  // Nivel de cada zona: sube rápido al tocar y baja lento al soltar
  const aAtt = 1 - Math.exp(-dt / 0.12);
  const aRel = 1 - Math.exp(-dt / Math.max(0.2, persist / 3));
  let active = 0;
  ZONES.forEach(z => {
    let sum = 0;
    pointers.forEach(p => { sum += influence(p, z); });
    const target = Math.min(1, Math.max(sum, z.forced));
    z.level += (target - z.level) * (target > z.level ? aAtt : aRel);
    if (target === 0 && z.level < 0.003) z.level = 0;
    if (z.level > 0.08) active++;
    Motor.setLevel(z);
    const frames = dt * 60;
    if (z.id === 'agua' && z.level > 0.08 && Math.random() < (0.02 + z.level * 0.1) * frames) spawnDrop(z);
    if (z.id === 'aves' && z.level > 0.08 && Math.random() < (0.004 + z.level * 0.02) * frames) spawnChirp(z);
    if (z.meter) z.meter.style.transform = 'scaleX(' + z.level.toFixed(3) + ')';
  });

  ZONES.forEach(z => { ensureBuf(z); paintZone(z, dt); showZone(z); emblem(z); });

  // Nombres de zona
  const ctx = drawingContext;
  const fs = width < 520 ? 9 : 11;
  ctx.font = '500 ' + fs + 'px "DM Mono", monospace';
  ctx.textAlign = 'center';
  try { ctx.letterSpacing = '0.14em'; } catch (_) {}
  ZONES.forEach(z => {
    const [r, g, b] = RGB[z.id];
    ctx.fillStyle = 'rgba(' + r + ',' + g + ',' + b + ',' + (0.45 + z.level * 0.5) + ')';
    ctx.fillText(z.name.toUpperCase(), z.cx, Math.min(z.cy + z.R * 1.05, height - 8));
  });

  // Anillo en cada punto de contacto
  noFill();
  pointers.forEach(p => {
    stroke(255, 255, 255, p.pressed ? 150 : 90);
    strokeWeight(1.2);
    circle(p.x, p.y, 18 + 4 * Math.sin(T * 4));
  });

  // Estado
  setText('visitors', pointers.size);
  setText('active', active);
}

/* ============================================================
   5. INTERFAZ: lista de zonas, botones y controles
   ============================================================ */
const _txt = {};
function setText(id, v) {
  if (_txt[id] === v) return;
  _txt[id] = v;
  document.getElementById(id).textContent = v;
}

const legend = document.getElementById('legend');
ZONES.forEach(z => {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'zone';
  b.style.setProperty('--c', 'var(--' + z.id + ')');
  b.innerHTML = '<span class="name"><span class="dot"></span>' + z.name + '</span>' +
                '<span class="hint">' + z.hint + '</span><span class="meter"><i></i></span>';
  z.meter = b.querySelector('.meter i');
  const on = () => { z.forced = 1; }, off = () => { z.forced = 0; };
  b.addEventListener('pointerdown', on);
  b.addEventListener('pointerup', off);
  b.addEventListener('pointerleave', off);
  b.addEventListener('pointercancel', off);
  b.addEventListener('blur', off);
  b.addEventListener('keydown', e => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); on(); } });
  b.addEventListener('keyup', e => { if (e.key === ' ' || e.key === 'Enter') off(); });
  legend.appendChild(b);
});

const overlay = document.getElementById('overlay');
const soundBtn = document.getElementById('soundBtn');
function refreshSoundBtn() {
  soundBtn.textContent = !Motor.ctx ? 'Activar sonido' : (Motor.muted ? 'Activar sonido' : 'Silenciar');
}

/* Pantalla de inicio: cualquier toque empieza la obra con sonido */
overlay.addEventListener('click', e => {
  if (!e.target.closest('#silentBtn')) Motor.init();
  overlay.hidden = true;
  lastAct = performance.now();
  refreshSoundBtn();
});

/* Reinicio automático: si nadie toca en IDLE_MS, vuelve a la pantalla de inicio */
let IDLE_MS = 60000;
function showIntro() {
  ZONES.forEach(z => { z.forced = 0; });
  pointers.clear();
  overlay.hidden = false;
}
window.addEventListener('keydown', () => { lastAct = performance.now(); });
setInterval(() => {
  if (overlay.hidden === false) return;
  let pressed = ZONES.some(z => z.forced);
  pointers.forEach(p => { if (p.pressed) pressed = true; });
  if (pressed) lastAct = performance.now();
  else if (performance.now() - lastAct > IDLE_MS) showIntro();
}, 1000);

soundBtn.addEventListener('click', () => {
  if (!Motor.ctx) { Motor.init(); Motor.setMuted(false); }
  else Motor.setMuted(!Motor.muted);
  refreshSoundBtn();
});

const fsBtn = document.getElementById('fsBtn');
if (!document.fullscreenEnabled) fsBtn.hidden = true;
fsBtn.addEventListener('click', () => {
  const st = document.getElementById('stage');
  if (document.fullscreenElement) document.exitFullscreen();
  else if (st.requestFullscreen) st.requestFullscreen().catch(() => {});
});

/* Modo exposición: oculta toda la interfaz y deja solo la obra (tecla E, Esc para salir) */
const expoBtn = document.getElementById('expoBtn');
const expoHint = document.getElementById('expoHint');
let hintTimer = 0;
function setExpo(on) {
  document.body.classList.toggle('expo', on);
  expoBtn.textContent = on ? 'Salir del modo exposición' : 'Modo exposición (E)';
  if (on) {
    const root = document.documentElement;
    if (root.requestFullscreen && !document.fullscreenElement) root.requestFullscreen().catch(() => {});
    expoHint.classList.add('show');
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => expoHint.classList.remove('show'), 4000);
  } else if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  }
}
expoBtn.addEventListener('click', () => setExpo(!document.body.classList.contains('expo')));
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && document.body.classList.contains('expo')) setExpo(false);
});
window.addEventListener('keydown', e => {
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
  if (e.key === 'e' || e.key === 'E') setExpo(!document.body.classList.contains('expo'));
  else if (e.key === 'Escape' && document.body.classList.contains('expo')) setExpo(false);
});

/* Sonidos propios: elegir zona y cargar un archivo de audio */
const zoneSel = document.getElementById('zoneSel');
const fileIn = document.getElementById('fileIn');
const sampleMsg = document.getElementById('sampleMsg');
const samples = {};
ZONES.forEach(z => {
  const o = document.createElement('option');
  o.value = z.id; o.textContent = z.name;
  zoneSel.appendChild(o);
});
function onSample(id, name) {
  samples[id] = name;
  sampleMsg.textContent = Object.keys(samples)
    .map(k => k.charAt(0).toUpperCase() + k.slice(1) + ': ' + samples[k]).join(' · ');
}
document.getElementById('loadBtn').addEventListener('click', () => {
  Motor.init();            // activa el audio con el clic del usuario
  refreshSoundBtn();
  fileIn.click();
});
fileIn.addEventListener('change', async () => {
  const f = fileIn.files[0];
  if (!f) return;
  try { await Motor.loadFile(zoneSel.value, f); }
  catch (_) { sampleMsg.textContent = 'No se pudo leer ese archivo. Prueba con mp3, wav u ogg.'; }
  fileIn.value = '';
});

const vol = document.getElementById('vol'), volOut = document.getElementById('volOut');
vol.addEventListener('input', () => {
  const v = parseFloat(vol.value);
  Motor.setVol(v);
  volOut.textContent = Math.round(v * 100) + ' %';
});
const per = document.getElementById('persist'), perOut = document.getElementById('persistOut');
per.addEventListener('input', () => {
  persist = parseFloat(per.value);
  perOut.textContent = persist.toFixed(1).replace('.', ',') + ' s';
});
