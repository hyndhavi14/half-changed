import * as THREE from 'three';

type Draw = (g: CanvasRenderingContext2D, w: number, h: number) => void;

/** Canvas texture, repeat-wrapped. sRGB unless `linear` (alpha masks). */
export function canvasTex(w: number, h: number, draw: Draw, linear = false): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!, w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.colorSpace = linear ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  return t;
}

/** Seeded PRNG so the epoxy speckle is identical on every load. */
function seeded(seed = 7) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

const cache = new Map<string, THREE.Texture>();
function lazy<T extends THREE.Texture>(key: string, make: () => T): () => T {
  return () => {
    let t = cache.get(key) as T | undefined;
    if (!t) cache.set(key, (t = make()));
    return t;
  };
}

export const TEX = {
  epoxy: lazy('epoxy', () => {
    const rnd = seeded(7);
    return canvasTex(512, 512, (g, w, h) => {
      g.fillStyle = '#A59E94';
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 9000; i++) {
        const a = rnd() * 0.05;
        g.fillStyle = rnd() < 0.5 ? `rgba(70,55,45,${a})` : `rgba(255,250,240,${a})`;
        const r = 1 + rnd() * 3;
        g.fillRect(rnd() * w, rnd() * h, r, r);
      }
      g.strokeStyle = 'rgba(80,66,55,0.25)';
      g.lineWidth = 2;
      g.strokeRect(0, 0, w, h);
    });
  }),
  cladding: lazy('clad', () =>
    canvasTex(256, 64, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 32, 0);
      gr.addColorStop(0, '#CFC7BA');
      gr.addColorStop(0.5, '#E3DCD0');
      gr.addColorStop(1, '#C4BCAE');
      for (let x = 0; x < w; x += 32) {
        g.fillStyle = gr;
        g.save();
        g.translate(x, 0);
        g.fillRect(0, 0, 32, h);
        g.restore();
      }
    }),
  ),
  belt: lazy('belt', () =>
    canvasTex(64, 64, (g, w, h) => {
      g.fillStyle = '#25201D';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#3A322D';
      for (let x = 0; x < w; x += 8) g.fillRect(x, 0, 2, h);
    }),
  ),
  dash: lazy('dash', () =>
    canvasTex(128, 16, (g, w, h) => {
      g.fillStyle = 'rgba(255,255,255,0.18)';
      g.fillRect(0, 0, w, h);
      const gr = g.createLinearGradient(0, 0, 70, 0);
      gr.addColorStop(0, 'rgba(255,255,255,0.2)');
      gr.addColorStop(0.75, 'rgba(255,255,255,1)');
      gr.addColorStop(1, 'rgba(255,255,255,0.2)');
      g.fillStyle = gr;
      g.fillRect(0, 0, 70, h);
    }),
  ),
  hatch: lazy('hatch', () =>
    canvasTex(64, 64, (g, w, h) => {
      g.fillStyle = 'rgba(30,24,20,0.85)';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = '#E0AE35';
      g.lineWidth = 11;
      for (let i = -64; i < 128; i += 32) {
        g.beginPath();
        g.moveTo(i, 0);
        g.lineTo(i + 64, 64);
        g.stroke();
      }
    }),
  ),
  solarPanel: lazy('panel', () =>
    canvasTex(128, 208, (g, w, h) => {
      g.fillStyle = '#1B2A47';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = '#7F93B8';
      g.lineWidth = 1.5;
      for (let x = 0; x <= w; x += w / 4) {
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x, h);
        g.stroke();
      }
      for (let y = 0; y <= h; y += h / 8) {
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(w, y);
        g.stroke();
      }
      g.strokeStyle = '#C9CED6';
      g.lineWidth = 6;
      g.strokeRect(0, 0, w, h);
    }),
  ),
  blob: lazy('blob', () =>
    canvasTex(
      128,
      128,
      (g, w, h) => {
        const gr = g.createRadialGradient(64, 64, 4, 64, 64, 64);
        gr.addColorStop(0, 'rgba(0,0,0,0.6)');
        gr.addColorStop(0.55, 'rgba(0,0,0,0.32)');
        gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr;
        g.fillRect(0, 0, w, h);
      },
      true,
    ),
  ),
  jute: lazy('jute', () =>
    canvasTex(64, 64, (g, w, h) => {
      g.fillStyle = '#B08F64';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(90,65,40,0.35)';
      g.lineWidth = 1;
      for (let i = 0; i < w; i += 4) {
        g.beginPath();
        g.moveTo(i, 0);
        g.lineTo(i, h);
        g.stroke();
        g.beginPath();
        g.moveTo(0, i);
        g.lineTo(w, i);
        g.stroke();
      }
    }),
  ),
  carton: lazy('carton', () =>
    canvasTex(64, 64, (g, w, h) => {
      g.fillStyle = '#C9A27A';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#A9825C';
      g.fillRect(0, 28, w, 8);
      g.fillStyle = '#5A3A26';
      g.fillRect(8, 8, 14, 10);
    }),
  ),
  fence: lazy('fence', () =>
    canvasTex(
      32,
      32,
      (g, w, h) => {
        g.clearRect(0, 0, w, h);
        g.strokeStyle = 'rgba(70,64,58,0.9)';
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(0, 0);
        g.lineTo(w, h);
        g.moveTo(w, 0);
        g.lineTo(0, h);
        g.stroke();
      },
      true,
    ),
  ),
  sign: lazy('sign', () => {
    const t = canvasTex(1024, 256, drawSign);
    // Redraw once the brand fonts arrive so the sign uses Fraunces, not the fallback.
    if (typeof document !== 'undefined' && document.fonts?.load) {
      Promise.all([
        document.fonts.load('700 92px Fraunces'),
        document.fonts.load('400 40px "Inter"'),
      ])
        .then(() => {
          const c = t.image as HTMLCanvasElement;
          drawSign(c.getContext('2d')!, c.width, c.height);
          t.needsUpdate = true;
        })
        .catch(() => {});
    }
    return t;
  }),
};

function drawSign(g: CanvasRenderingContext2D, w: number, h: number) {
  g.fillStyle = '#3B2416';
  g.fillRect(0, 0, w, h);
  const s = 150,
    ox = 60,
    oy = 53;
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) {
      g.fillStyle = i === 2 && j === 2 ? '#E3A72F' : '#6E4B35';
      g.fillRect(ox + j * 52, oy + i * 52, 44, 44);
    }
  // The bite out of the top-right corner of the Bitten Bar.
  g.fillStyle = '#3B2416';
  g.beginPath();
  g.arc(ox + s + 4, oy - 4, 32, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#F5EDE0';
  g.font = '700 92px Fraunces, Georgia, serif';
  g.textBaseline = 'middle';
  g.fillText('ByteMe', 270, 110);
  g.fillStyle = '#D9C6AC';
  g.font = '400 40px "Inter", Arial, sans-serif';
  g.fillText('Chocolate Works · Vizag', 274, 186);
}

export function skyTexture(top: string, mid: string, bottom: string) {
  return canvasTex(8, 512, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, top);
    gr.addColorStop(0.55, mid);
    gr.addColorStop(1, bottom);
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
  });
}

/** A clone with its own repeat/offset (shares the canvas image). */
export function cloneTex(t: THREE.Texture, rx: number, ry: number) {
  const c = t.clone();
  c.repeat.set(rx, ry);
  c.needsUpdate = true;
  return c;
}
