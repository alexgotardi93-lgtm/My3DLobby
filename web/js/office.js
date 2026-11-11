// The office: floor, walls, windows with a view, desks, the copa (kitchenette),
// the lounge (two sofas, TV, lamp), whiteboard, plants — plus the "spots"
// characters go to and the walkable graph between them.
import * as THREE from 'three';

export const FLOOR_W = 26, FLOOR_D = 20;

const mat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, metalness: 0.05, ...o });

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

// ---------------------------------------------------------------- textures
function skyTexture(night) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 420; const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 420);
  if (night) { g.addColorStop(0, '#0b1230'); g.addColorStop(1, '#2a3561'); } else { g.addColorStop(0, '#6fb6ff'); g.addColorStop(1, '#d8efff'); }
  ctx.fillStyle = g; ctx.fillRect(0, 0, 512, 420);
  if (night) { ctx.fillStyle = '#ffffff'; for (let i = 0; i < 60; i++) { ctx.globalAlpha = 0.4 + Math.random() * 0.6; ctx.fillRect(Math.random() * 512, Math.random() * 220, 2, 2); } ctx.globalAlpha = 1; ctx.fillStyle = '#f3f0d8'; ctx.beginPath(); ctx.arc(420, 70, 28, 0, Math.PI * 2); ctx.fill(); }
  else { ctx.fillStyle = '#fff4b0'; ctx.beginPath(); ctx.arc(430, 70, 34, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = 'rgba(255,255,255,0.9)'; for (const [x, y, r] of [[90, 90, 26], [120, 80, 34], [150, 95, 24], [330, 140, 22], [355, 130, 30], [385, 145, 20]]) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); } }
  // distant hills + town
  ctx.fillStyle = night ? '#1b2447' : '#8fc48a'; ctx.beginPath(); ctx.moveTo(0, 300); ctx.quadraticCurveTo(130, 230, 260, 290); ctx.quadraticCurveTo(390, 240, 512, 300); ctx.lineTo(512, 420); ctx.lineTo(0, 420); ctx.fill();
  ctx.fillStyle = night ? '#141b38' : '#5f9a66'; ctx.beginPath(); ctx.moveTo(0, 340); ctx.quadraticCurveTo(170, 290, 300, 345); ctx.quadraticCurveTo(420, 300, 512, 350); ctx.lineTo(512, 420); ctx.lineTo(0, 420); ctx.fill();
  const bld = [[40, 60, 40], [95, 90, 30], [140, 50, 50], [210, 110, 36], [260, 70, 44], [320, 95, 30], [370, 55, 48], [440, 80, 38]];
  for (const [x, h, w] of bld) { ctx.fillStyle = night ? '#232b4d' : '#c9d3e0'; ctx.fillRect(x, 360 - h, w, h + 60); ctx.fillStyle = night ? '#ffd27a' : '#eef4fa'; for (let yy = 368 - h; yy < 400; yy += 14) for (let xx = x + 5; xx < x + w - 6; xx += 10) if ((xx * 7 + yy) % 3 !== 0) ctx.fillRect(xx, yy, 5, 7); }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; return tex;
}

function tileTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256; const ctx = c.getContext('2d');
  ctx.fillStyle = '#e6e2d8'; ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = '#d9d4c8'; for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) if ((x + y) % 2) ctx.fillRect(x * 128, y * 128, 128, 128);
  ctx.strokeStyle = '#c8c2b4'; ctx.lineWidth = 3; for (let i = 0; i <= 256; i += 128) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 256); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(256, i); ctx.stroke(); }
  const tex = new THREE.CanvasTexture(c); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(5, 8); tex.colorSpace = THREE.SRGBColorSpace; return tex;
}

function posterTexture(kind) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 320; const ctx = c.getContext('2d');
  const palettes = [['#2b3a67', '#35d07f', '#ffffff'], ['#d8663b', '#f2c14e', '#1b1f2a'], ['#3b6fd8', '#9fd3ff', '#ffffff']];
  const [a, b, t] = palettes[kind % palettes.length];
  ctx.fillStyle = a; ctx.fillRect(0, 0, 256, 320);
  ctx.fillStyle = b;
  if (kind % 3 === 0) { for (let i = 0; i < 6; i++) ctx.fillRect(30 + i * 34, 240 - i * 28, 22, 60 + i * 28); }
  else if (kind % 3 === 1) { ctx.beginPath(); ctx.arc(128, 150, 80, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = a; ctx.beginPath(); ctx.arc(128, 150, 48, 0, Math.PI * 2); ctx.fill(); }
  else { ctx.beginPath(); ctx.moveTo(40, 280); ctx.lineTo(128, 60); ctx.lineTo(216, 280); ctx.fill(); }
  ctx.fillStyle = t; ctx.font = 'bold 26px Inter, Arial'; ctx.textAlign = 'center'; ctx.fillText(['SUPERCOTA', 'BPG SISTEMAS', 'MY3DLOBBY'][kind % 3], 128, 300);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; return tex;
}

function plateTexture(text, color) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 192; const ctx = c.getContext('2d');
  ctx.fillStyle = color; roundRect(ctx, 0, 0, 1024, 192, 36); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(36, 150, 952, 6);
  ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  let size = 86; ctx.font = `bold ${size}px Inter, Arial`;
  while (ctx.measureText(text).width > 940 && size > 30) { size -= 4; ctx.font = `bold ${size}px Inter, Arial`; }
  ctx.fillText(text, 512, 84);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; return tex;
}

// one colour set per floor: walls, rug and the floor plate
const FLOOR_LOOKS = [
  { back: '#eef1f7', left: '#e3e8f2', rug: '#5b6fa8', rug2: '#7386c4', plate: '#2b3a67' },
  { back: '#edf4ef', left: '#e0ebe3', rug: '#3f7a5c', rug2: '#58a07a', plate: '#2f6b4f' },
  { back: '#f6f0e8', left: '#ece2d5', rug: '#a8643b', rug2: '#c98a5a', plate: '#8a4f2a' },
  { back: '#f1eef7', left: '#e6e1f0', rug: '#6b4fa8', rug2: '#8a6fc4', plate: '#4f3a85' },
];

// ---------------------------------------------------------------- office
export function buildOffice(scene, agentCount) {
  const root = new THREE.Group();
  scene.add(root);
  const add = (m) => { m.castShadow = true; m.receiveShadow = true; root.add(m); return m; };
  const box = (w, h, d, c, x, y, z, o) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(c, o)); m.position.set(x, y, z); return add(m); };
  const cyl = (rt, rb, h, c, x, y, z, seg = 24) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat(c)); m.position.set(x, y, z); return add(m); };
  const nightItems = [];  // {mat, day:{color,emissive,intensity}, night:{...}}
  const lamps = [];

  // ---- floor: light wood planks, tiles in the copa
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(FLOOR_W, FLOOR_D), mat('#cdb28f', { roughness: 0.9 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; floor.name = 'floor'; root.add(floor);
  for (let i = -12; i <= 12; i += 1.3) { const l = new THREE.Mesh(new THREE.PlaneGeometry(0.03, FLOOR_D), mat('#b89c79')); l.rotation.x = -Math.PI / 2; l.position.set(i, 0.002, 0); root.add(l); }
  const tiles = new THREE.Mesh(new THREE.PlaneGeometry(4.7, 8.2), new THREE.MeshStandardMaterial({ map: tileTexture(), roughness: 0.6 }));
  tiles.rotation.x = -Math.PI / 2; tiles.position.set(10.65, 0.003, -5.9); tiles.receiveShadow = true; root.add(tiles);
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 5.2), mat('#5b6fa8')); rug.rotation.x = -Math.PI / 2; rug.position.set(1.2, 0.004, 6.2); rug.receiveShadow = true; root.add(rug);
  const rug2 = new THREE.Mesh(new THREE.PlaneGeometry(6.6, 4.6), mat('#7386c4')); rug2.rotation.x = -Math.PI / 2; rug2.position.set(1.2, 0.005, 6.2); rug2.receiveShadow = true; root.add(rug2);
  const runner = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 9), mat('#b85c4a')); runner.rotation.x = -Math.PI / 2; runner.position.set(-11.3, 0.004, 1.0); runner.receiveShadow = true; root.add(runner);

  // ---- walls, baseboard, windows with a view
  const wallBack = box(FLOOR_W, 6, 0.3, '#eef1f7', 0, 3, -10);
  const wallLeft = box(0.3, 6, FLOOR_D, '#e3e8f2', -13, 3, 0);
  box(FLOOR_W, 0.18, 0.06, '#c9ced9', 0, 0.09, -9.82); box(0.06, 0.18, FLOOR_D, '#c9ced9', -12.82, 0.09, 0);
  const daySky = skyTexture(false), nightSky = skyTexture(true);
  const windows = [];
  for (const x of [-8, -3, 2, 7]) {
    const wm = new THREE.MeshStandardMaterial({ map: daySky, emissive: '#ffffff', emissiveMap: daySky, emissiveIntensity: 0.55, roughness: 0.3 });
    const w = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 2.6), wm); w.position.set(x, 3.2, -9.83); root.add(w); windows.push(wm);
    box(3.4, 0.12, 0.2, '#d9dde6', x, 1.85, -9.8); box(3.4, 0.12, 0.2, '#d9dde6', x, 4.55, -9.8);
    box(0.12, 2.6, 0.2, '#d9dde6', x - 1.66, 3.2, -9.8); box(0.12, 2.6, 0.2, '#d9dde6', x + 1.66, 3.2, -9.8); box(0.06, 2.6, 0.14, '#d9dde6', x, 3.2, -9.8);
  }
  // logo sign
  box(4.2, 1.1, 0.08, '#2b3a67', -6, 4.9, -9.8);
  const sign = makeTextSprite('My3DLobby · BPG', { w: 1024, h: 256, font: 'bold 120px Inter, Arial', color: '#ffffff', bg: 'rgba(0,0,0,0)' });
  sign.scale.set(4, 1, 1); sign.position.set(-6, 4.9, -9.7); root.add(sign);
  // floor plate ("2º ANDAR · MESA WIN"), only when the office has more than one floor
  const plateMat = new THREE.MeshStandardMaterial({ map: plateTexture(' ', '#2b3a67'), roughness: 0.6, transparent: true });
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 0.83), plateMat);
  plate.position.set(4.5, 4.95, -9.8); plate.visible = false; root.add(plate);
  let plateKey = '';
  // posters + clock on the left wall
  [[-12.82, 3.0, 2.2, 0], [-12.82, 3.0, 4.4, 1], [-12.82, 3.0, 6.6, 2]].forEach(([x, y, z, k]) => {
    box(0.06, 1.75, 1.45, '#1b1f2a', x, y, z);
    const p = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.6), new THREE.MeshStandardMaterial({ map: posterTexture(k), roughness: 0.7 })); p.rotation.y = Math.PI / 2; p.position.set(x + 0.04, y, z); root.add(p);
  });
  const clock = cyl(0.42, 0.42, 0.05, '#ffffff', -12.78, 4.3, -6.5, 32); clock.rotation.z = Math.PI / 2;
  const clockRim = cyl(0.46, 0.46, 0.04, '#2b3a67', -12.8, 4.3, -6.5, 32); clockRim.rotation.z = Math.PI / 2;
  box(0.02, 0.3, 0.04, '#1b1f2a', -12.74, 4.42, -6.5); box(0.02, 0.04, 0.22, '#1b1f2a', -12.74, 4.3, -6.4);

  // ---- pendant lamps
  const pendant = (x, z, y = 4.2) => {
    cyl(0.01, 0.01, 6 - y, '#8a8f9c', x, y + (6 - y) / 2, z, 6);
    const shade = cyl(0.12, 0.38, 0.35, '#2b3a67', x, y, z, 24);
    const bulbMat = mat('#fff1c8', { emissive: '#ffd27a', emissiveIntensity: 0.4 });
    const bulb = add(new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 12), bulbMat)); bulb.position.set(x, y - 0.12, z);
    const light = new THREE.PointLight('#ffd9a0', 0, 7); light.position.set(x, y - 0.3, z); root.add(light);
    lamps.push({ mat: bulbMat, light });
    return shade;
  };
  pendant(1.2, 6.2); pendant(10.8, -5.5); pendant(-9, -0.5, 4.4); pendant(4, -0.5, 4.4);

  // ---- desks (row 1 at z=-5, row 2 at z=-0.5 when needed)
  const deskXs = [-8.5, -3.5, 1.5, 6.5];
  const desks = [];
  const monitors = [];
  const n = Math.max(1, agentCount);
  for (let i = 0; i < Math.max(n, 2) && i < 8; i++) {
    const row = Math.floor(i / 4);
    const x = deskXs[i % 4] + (row ? 0.5 : 0);
    const z = row ? -0.5 : -5;
    const g = new THREE.Group(); g.position.set(x, 0, z); root.add(g);
    const a = (m) => { g.add(m); m.castShadow = true; m.receiveShadow = true; return m; };
    const top = a(new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.1, 1.3), mat('#f4ecdc'))); top.position.y = 1.0;
    for (const [dx, dz] of [[-1.15, -0.55], [1.15, -0.55], [-1.15, 0.55], [1.15, 0.55]]) { const l = a(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1, 12), mat('#3a3f4b'))); l.position.set(dx, 0.5, dz); }
    const mon = a(new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.78, 0.06), mat('#2a2e38'))); mon.position.set(0, 1.55, -0.35);
    const scrMat = mat('#141821', { emissive: '#000000', emissiveIntensity: 0 });
    const scr = a(new THREE.Mesh(new THREE.PlaneGeometry(1.12, 0.64), scrMat)); scr.position.set(0, 1.55, -0.31);
    const glow = new THREE.PointLight('#4aa3ff', 0, 4); glow.position.set(0, 1.6, 0.3); g.add(glow);
    monitors.push({ mat: scrMat, light: glow });
    const stand = a(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.4, 0.2), mat('#2a2e38'))); stand.position.set(0, 1.2, -0.4);
    const kb = a(new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.04, 0.3), mat('#3a3f4b'))); kb.position.set(0, 1.07, 0.15);
    const mouse = a(new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.05, 4, 8), mat('#3a3f4b'))); mouse.rotation.x = Math.PI / 2; mouse.position.set(0.62, 1.08, 0.15);
    const mug = a(new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.08, 0.16, 16), mat(['#e65c5c', '#5cb6e6', '#f2c14e', '#9b6be6'][i % 4]))); mug.position.set(0.95, 1.13, 0.2);
    // desk lamp, papers, little plant (alternating)
    if (i % 2 === 0) {
      const lb = a(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.03, 12), mat('#2a2e38'))); lb.position.set(-0.95, 1.06, -0.3);
      const la = a(new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.5, 6), mat('#2a2e38'))); la.rotation.z = 0.35; la.position.set(-0.87, 1.3, -0.3);
      const lh = a(new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.18, 12, 1, true), mat('#2a2e38', { side: THREE.DoubleSide }))); lh.rotation.z = -0.9; lh.position.set(-0.72, 1.5, -0.3);
    } else {
      const pot = a(new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.07, 0.14, 10), mat('#c98a5a'))); pot.position.set(-0.95, 1.12, -0.3);
      const leaf = a(new THREE.Mesh(new THREE.IcosahedronGeometry(0.14, 1), mat('#58b36e'))); leaf.position.set(-0.95, 1.3, -0.3);
    }
    const paper = a(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.01, 0.4), mat('#ffffff'))); paper.position.set(-0.6, 1.06, 0.25); paper.rotation.y = 0.2;
    // chair
    const seat = a(new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.1, 0.7), mat('#2f3340'))); seat.position.set(0, 0.55, 1.05);
    const back = a(new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.8, 0.1), mat('#2f3340'))); back.position.set(0, 1.0, 1.4);
    const post = a(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.55, 10), mat('#8a8f9c'))); post.position.set(0, 0.27, 1.05);
    const base = a(new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.04, 20), mat('#8a8f9c'))); base.position.set(0, 0.02, 1.05);
    // bin
    const bin = a(new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.13, 0.4, 12), mat('#8a8f9c'))); bin.position.set(1.45, 0.2, 0.5);
    desks.push({ x, z, sit: new THREE.Vector3(x, 0, z + 1.05), approach: new THREE.Vector3(x, 0, z + 2.3), face: Math.PI, seatY: 0.6, monitor: monitors[i] });
  }

  // ---- whiteboard + filing cabinet on the left wall. The left wall's inner face is at x = -12.85, so anything
  // hung on it is thin along X and wide along Z (the back wall is the other way round). The marker lines start
  // at the board's left edge as seen from the room (+z) and run toward -z.
  box(0.08, 2.2, 3.6, '#ffffff', -12.8, 2.3, -3); box(0.06, 2.4, 3.8, '#aab0bd', -12.84, 2.3, -3);
  for (const [dy, w] of [[0.5, 2.2], [0.1, 2.8], [-0.3, 1.6], [-0.7, 2.5]]) box(0.02, 0.06, w, dy > 0 ? '#2b3a67' : '#e65c5c', -12.74, 2.3 + dy, -1.5 - w / 2);
  box(0.9, 1.3, 0.5, '#8a8f9c', -12.5, 0.65, -0.3); for (const y of [0.35, 0.75, 1.1]) box(0.04, 0.04, 0.3, '#2a2e38', -12.03, y, -0.3);

  // ---- COPA (kitchenette) in the back-right corner
  box(0.15, 1.1, 1.8, '#dfe3ea', 8.35, 0.55, -9.1); box(0.2, 0.06, 1.9, '#d9c7a6', 8.35, 1.13, -9.1);  // half wall
  box(4.4, 0.9, 0.62, '#f4ecdc', 10.85, 0.45, -9.52); box(4.5, 0.06, 0.7, '#8c6a4a', 10.85, 0.93, -9.5);  // counter + wooden top
  for (const x of [9.2, 10.3, 11.4, 12.5]) box(0.02, 0.6, 0.02, '#8a8f9c', x, 0.45, -9.22);  // cabinet lines
  box(0.6, 0.02, 0.4, '#8a8f9c', 11.9, 0.965, -9.5); box(0.03, 0.25, 0.03, '#8a8f9c', 11.9, 1.08, -9.68); // sink + tap
  box(4.4, 0.8, 0.4, '#f4ecdc', 10.85, 2.6, -9.6); for (const x of [9.2, 10.3, 11.4, 12.5]) box(0.02, 0.7, 0.42, '#c9ced9', x, 2.6, -9.6);  // upper cabinets
  // coffee machine (with a tiny red light), microwave, kettle, cups
  const cm = box(0.5, 0.55, 0.42, '#2a2e38', 9.9, 1.235, -9.5); box(0.08, 0.08, 0.02, '#ff5c5c', 9.72, 1.42, -9.28, { emissive: '#ff3b3b', emissiveIntensity: 1 });
  box(0.3, 0.06, 0.2, '#8a8f9c', 9.9, 1.0, -9.35); cyl(0.05, 0.04, 0.08, '#ffffff', 9.9, 1.04, -9.32, 10);
  box(0.6, 0.36, 0.42, '#c9ced9', 10.85, 1.14, -9.5); box(0.4, 0.26, 0.02, '#1b1f2a', 10.8, 1.14, -9.28);
  for (const [dx, c] of [[0, '#e65c5c'], [0.14, '#5cb6e6'], [0.28, '#f2c14e'], [0.42, '#ffffff']]) cyl(0.05, 0.045, 0.1, c, 12.3 + dx, 1.01, -9.4, 10);
  // fridge
  box(0.8, 1.9, 0.75, '#dfe3ea', 12.55, 0.95, -8.4, { metalness: 0.3, roughness: 0.4 }); box(0.04, 0.5, 0.05, '#8a8f9c', 12.17, 1.35, -8.0); box(0.04, 0.4, 0.05, '#8a8f9c', 12.17, 0.6, -8.0);
  // water cooler (bebedouro)
  box(0.45, 1.0, 0.45, '#eef1f7', 8.95, 0.5, -9.4); box(0.3, 0.15, 0.1, '#5cb6e6', 8.95, 0.75, -9.15); box(0.3, 0.15, 0.1, '#ff5c5c', 8.95, 0.58, -9.15);
  const bottle = add(new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.2, 0.5, 14), mat('#9fd3ff', { transparent: true, opacity: 0.75, roughness: 0.2 }))); bottle.position.set(8.95, 1.25, -9.4);
  const bottleTop = add(new THREE.Mesh(new THREE.SphereGeometry(0.19, 14, 10), mat('#9fd3ff', { transparent: true, opacity: 0.75, roughness: 0.2 }))); bottleTop.position.set(8.95, 1.5, -9.4);
  // round table + 3 stools
  cyl(0.65, 0.65, 0.05, '#f4ecdc', 10.8, 0.72, -5.5, 32); cyl(0.05, 0.05, 0.7, '#3a3f4b', 10.8, 0.36, -5.5, 10); cyl(0.3, 0.3, 0.04, '#3a3f4b', 10.8, 0.02, -5.5, 20);
  cyl(0.06, 0.05, 0.12, '#e65c5c', 10.95, 0.8, -5.4, 10); box(0.3, 0.02, 0.3, '#ffffff', 10.6, 0.75, -5.65);
  const tableSpots = [];
  for (const ang of [Math.PI / 2, Math.PI * 7 / 6, Math.PI * 11 / 6]) {
    const sx = 10.8 + Math.cos(ang) * 0.95, sz = -5.5 + Math.sin(ang) * 0.95;
    cyl(0.22, 0.22, 0.06, '#2f3340', sx, 0.45, sz, 16); cyl(0.03, 0.03, 0.42, '#8a8f9c', sx, 0.21, sz, 8); cyl(0.2, 0.2, 0.03, '#8a8f9c', sx, 0.015, sz, 16);
    tableSpots.push({ p: new THREE.Vector3(sx, 0, sz), face: Math.atan2(10.8 - sx, -5.5 - sz), sit: true, seatY: 0.48 });
  }
  // snack shelf + plant
  box(0.9, 1.6, 0.3, '#8c6a4a', 12.6, 0.8, -6.6); for (const y of [0.4, 0.9, 1.4]) box(0.84, 0.03, 0.28, '#d9c7a6', 12.6, y, -6.6);
  for (const [dx, y, c] of [[-0.25, 0.52, '#e65c5c'], [0, 0.52, '#f2c14e'], [0.25, 0.52, '#35d07f'], [-0.15, 1.02, '#5cb6e6'], [0.2, 1.02, '#ffffff']]) box(0.14, 0.2, 0.14, c, 12.6 + dx, y, -6.6);

  // ---- LOUNGE: two sofas in an L, round coffee table, TV, floor lamp, shelf
  const sofa = (x, z, rot, len = 3) => {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rot; root.add(g);
    const a = (m) => { g.add(m); m.castShadow = true; m.receiveShadow = true; return m; };
    const b = (w, h, d, c, px, py, pz) => { const m = a(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(c))); m.position.set(px, py, pz); return m; };
    b(len, 0.5, 1.2, '#6b7fc4', 0, 0.25, 0); b(len, 0.6, 0.3, '#6b7fc4', 0, 0.8, 0.55);
    b(0.3, 0.7, 1.2, '#5a6db0', -len / 2 - 0.15, 0.35, 0); b(0.3, 0.7, 1.2, '#5a6db0', len / 2 + 0.15, 0.35, 0);
    const seats = Math.round(len / 0.9);
    for (let i = 0; i < seats; i++) b(len / seats - 0.06, 0.08, 1.0, '#7386c4', -len / 2 + (i + 0.5) * len / seats, 0.52, -0.05);
    b(0.35, 0.25, 0.35, '#f2c14e', -len / 2 + 0.4, 0.62, -0.1).rotation.y = 0.3; b(0.35, 0.25, 0.35, '#e65c5c', len / 2 - 0.4, 0.62, -0.1).rotation.y = -0.2;
    return g;
  };
  sofa(1.5, 7.4, 0);                 // faces -z
  sofa(-1.6, 5.6, -Math.PI / 2, 2.4); // faces +x
  cyl(0.5, 0.5, 0.05, '#f4ecdc', 2.0, 0.42, 5.4, 32); cyl(0.05, 0.05, 0.4, '#3a3f4b', 2.0, 0.2, 5.4, 10); cyl(0.25, 0.25, 0.03, '#3a3f4b', 2.0, 0.015, 5.4, 16);
  box(0.25, 0.3, 0.2, '#ffffff', 1.85, 0.6, 5.3); box(0.25, 0.02, 0.2, '#e65c5c', 1.85, 0.76, 5.3);  // magazine
  // TV on a low stand, facing the sofas
  box(0.5, 0.5, 1.8, '#f4ecdc', 5.2, 0.25, 6.0); box(0.06, 1.1, 1.9, '#1b1f2a', 5.0, 1.1, 6.0);
  const tvMat = mat('#0e1220', { emissive: '#1b2a4a', emissiveIntensity: 0.6 });
  const tv = new THREE.Mesh(new THREE.PlaneGeometry(1.75, 0.95), tvMat); tv.rotation.y = -Math.PI / 2; tv.position.set(4.96, 1.1, 6.0); root.add(tv);
  const tvLogo = makeTextSprite('BPG', { w: 256, h: 128, font: 'bold 90px Inter, Arial', color: '#35d07f', bg: 'rgba(0,0,0,0)' }); tvLogo.scale.set(0.8, 0.4, 1); tvLogo.position.set(4.93, 1.1, 6.0); root.add(tvLogo);
  // floor lamp
  cyl(0.2, 0.2, 0.03, '#2a2e38', -2.6, 0.015, 8.4, 16); cyl(0.02, 0.02, 1.6, '#2a2e38', -2.6, 0.8, 8.4, 8);
  const lampShadeMat = mat('#f4ecdc', { emissive: '#ffd27a', emissiveIntensity: 0.25 });
  const lampShade = add(new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 0.4, 16, 1, true), lampShadeMat)); lampShade.material.side = THREE.DoubleSide; lampShade.position.set(-2.6, 1.7, 8.4);
  const floorLight = new THREE.PointLight('#ffd9a0', 0, 5); floorLight.position.set(-2.6, 1.6, 8.4); root.add(floorLight); lamps.push({ mat: lampShadeMat, light: floorLight });
  // bookshelf behind the L
  box(1.6, 1.1, 0.35, '#8c6a4a', -1.6, 0.55, 8.9); for (const y of [0.35, 0.72]) box(1.5, 0.03, 0.33, '#d9c7a6', -1.6, y, 8.9);
  for (const [dx, y, c, h] of [[-0.55, 0.52, '#2b3a67', 0.3], [-0.42, 0.5, '#e65c5c', 0.26], [-0.3, 0.52, '#35d07f', 0.3], [0.2, 0.9, '#f2c14e', 0.3], [0.33, 0.88, '#3b6fd8', 0.26], [0.5, 0.9, '#ffffff', 0.3]]) box(0.1, h, 0.25, c, -1.6 + dx, y, 8.9);

  // ---- plants
  const plant = (x, z, s = 1) => {
    cyl(0.28 * s, 0.22 * s, 0.4 * s, '#8c6a4a', x, 0.2 * s, z);
    const f = add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.5 * s, 1), mat('#3f9e5a'))); f.position.set(x, 0.85 * s, z);
    const f2 = add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.36 * s, 1), mat('#58b36e'))); f2.position.set(x + 0.25 * s, 1.15 * s, z - 0.1 * s);
  };
  plant(-11.8, -8.8); plant(8.0, -9.0, 0.8); plant(-11.8, 8.6); plant(6.2, 8.8); plant(11.8, 7.5); plant(12.4, -3.6, 0.9);

  // ---- spots: where characters go
  const spots = {
    desks,
    coffee: [{ p: new THREE.Vector3(9.9, 0, -8.6), face: Math.PI }, { p: new THREE.Vector3(12.3, 0, -8.5), face: Math.PI }],
    water: [{ p: new THREE.Vector3(8.95, 0, -8.5), face: Math.PI }],
    table: tableSpots,
    sofa: [
      { p: new THREE.Vector3(0.7, 0, 7.4), face: Math.PI, sit: true, seatY: 0.5 },
      { p: new THREE.Vector3(1.5, 0, 7.4), face: Math.PI, sit: true, seatY: 0.5 },
      { p: new THREE.Vector3(2.3, 0, 7.4), face: Math.PI, sit: true, seatY: 0.5 },
      { p: new THREE.Vector3(-1.6, 0, 5.0), face: Math.PI / 2, sit: true, seatY: 0.5 },
      { p: new THREE.Vector3(-1.6, 0, 6.2), face: Math.PI / 2, sit: true, seatY: 0.5 },
    ],
    board: [{ p: new THREE.Vector3(-11.4, 0, -3), face: -Math.PI / 2 }],
    window: [{ p: new THREE.Vector3(-8, 0, -7.6), face: Math.PI }, { p: new THREE.Vector3(2, 0, -7.6), face: Math.PI }],
    corner: [{ p: new THREE.Vector3(12.2, 0, 3.0), face: -Math.PI / 2 }],
  };

  // ---- walkable graph (nodes in free space; edges hand-made to go around furniture)
  const N = {
    a1: [-10.5, -7.6], a2: [-6, -7.6], a3: [-1, -7.6], a4: [4, -7.6], a5: [9.4, -7.4], a6: [12, -7.4],
    l1: [-11.4, -4.5], l2: [-11.4, -1], l3: [-11.4, 3],
    b1: [-8.5, -2.3], b2: [-3.5, -2.3], b3: [1.5, -2.3], b4: [6.5, -2.3],
    k1: [9.4, -3.6], k2: [11.5, -3.6],
    c1: [-10, 3.2], c2: [-6, 3.2], c3: [-2.5, 3.2], c4: [2, 3.2], c5: [6, 3.2], c6: [9.5, 4.5],
    r1: [12.2, -1.5], r2: [12.2, 1.5], r3: [12.2, 4.5],
    f1: [-0.2, 4.4], f2: [3.6, 4.6], d1: [-8, 6.5], d2: [-5, 6.5], d3: [-4.5, 8.8], d4: [6, 9], d5: [8.5, 7.5],
    e1: [-8, 1.9], e2: [-3, 1.9], e3: [2, 1.9], e4: [7, 1.9],
  };
  const E = [
    ['a1', 'a2'], ['a2', 'a3'], ['a3', 'a4'], ['a4', 'a5'], ['a5', 'a6'], ['a1', 'l1'], ['a5', 'k1'], ['k1', 'k2'], ['k1', 'b4'], ['k2', 'r1'],
    ['l1', 'l2'], ['l2', 'l3'], ['l3', 'c1'], ['l2', 'b1'],
    ['b1', 'b2'], ['b2', 'b3'], ['b3', 'b4'], ['r1', 'r2'], ['r2', 'r3'], ['r3', 'c6'], ['c6', 'c5'],
    ['b1', 'e1'], ['b2', 'e2'], ['b3', 'e3'], ['b4', 'e4'], ['e1', 'e2'], ['e2', 'e3'], ['e3', 'e4'], ['e4', 'r2'],
    ['e1', 'c2'], ['e2', 'c3'], ['e3', 'c4'], ['e4', 'c5'],
    ['c1', 'c2'], ['c2', 'c3'], ['c3', 'c4'], ['c4', 'c5'], ['c3', 'f1'], ['c4', 'f1'], ['f1', 'f2'], ['c4', 'f2'], ['c5', 'f2'], ['c1', 'd1'], ['c2', 'd2'], ['d1', 'd2'], ['d2', 'd3'], ['c5', 'd4'], ['c6', 'd5'], ['d4', 'd5'],
  ];
  const nodes = {};
  for (const [k, [x, z]] of Object.entries(N)) nodes[k] = { id: k, p: new THREE.Vector3(x, 0, z), adj: [] };
  for (const [a, b] of E) { nodes[a].adj.push(b); nodes[b].adj.push(a); }

  // ---- day / night
  function setNight(night) {
    for (const wm of windows) { wm.map = night ? nightSky : daySky; wm.emissiveMap = wm.map; wm.emissiveIntensity = night ? 0.5 : 0.55; wm.needsUpdate = true; }
    for (const l of lamps) { l.light.intensity = night ? 9 : 0; l.mat.emissiveIntensity = night ? 1.2 : 0.25; }
    tvMat.emissiveIntensity = night ? 0.9 : 0.6;
  }

  // ---- floors: same room, its own colours and plate
  function setFloor(numero, label, multi) {
    const look = FLOOR_LOOKS[(Math.max(1, numero || 1) - 1) % FLOOR_LOOKS.length];
    wallBack.material.color.set(look.back); wallLeft.material.color.set(look.left);
    rug.material.color.set(look.rug); rug2.material.color.set(look.rug2);
    plate.visible = !!multi;
    const key = multi ? label + '|' + look.plate : '';
    if (multi && key !== plateKey) {
      if (plateMat.map) plateMat.map.dispose();
      plateMat.map = plateTexture(label, look.plate); plateMat.needsUpdate = true;
    }
    plateKey = key;
  }

  return { root, spots, nodes, monitors, windows, setNight, setFloor };
}

// ---------------------------------------------------------------- navigation
export function nearestNode(nodes, p) {
  let best = null, bd = Infinity;
  for (const n of Object.values(nodes)) { const d = n.p.distanceToSquared(p); if (d < bd) { bd = d; best = n; } }
  return best;
}

export function findPath(nodes, from, to) {
  const a = nearestNode(nodes, from), b = nearestNode(nodes, to);
  const prev = { [a.id]: null };
  const q = [a.id];
  while (q.length) {
    const cur = q.shift();
    if (cur === b.id) break;
    for (const nx of nodes[cur].adj) if (!(nx in prev)) { prev[nx] = cur; q.push(nx); }
  }
  const path = [];
  if (b.id in prev) { let c = b.id; while (c) { path.unshift(nodes[c].p.clone()); c = prev[c]; } }
  if (path.length > 1 && from.distanceTo(path[1]) < from.distanceTo(path[0]) + path[0].distanceTo(path[1]) * 0.5) path.shift();
  path.push(to.clone());
  return path;
}

// ---------------------------------------------------------------- sprites
export function makeTextSprite(text, opts = {}) {
  const { w = 768, h = 192, font = '600 60px Inter, Arial', color = '#1b1f2a', bg = '#ffffff', tail = false, radius = 48 } = opts;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  if (bg !== 'rgba(0,0,0,0)') {
    ctx.fillStyle = bg; roundRect(ctx, 8, 8, w - 16, h - (tail ? 48 : 16), radius); ctx.fill();
    if (tail) { ctx.beginPath(); ctx.moveTo(w / 2 - 30, h - 44); ctx.lineTo(w / 2, h - 8); ctx.lineTo(w / 2 + 30, h - 44); ctx.fill(); }
  }
  ctx.fillStyle = color; ctx.font = font; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  let size = parseInt(font.match(/(\d+)px/)[1], 10);
  while (ctx.measureText(text).width > w - 70 && size > 20) { size -= 4; ctx.font = font.replace(/\d+px/, size + 'px'); }
  ctx.fillText(text, w / 2, (h - (tail ? 40 : 0)) / 2 + 4);
  const tex = new THREE.CanvasTexture(c); tex.anisotropy = 4;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  sp.renderOrder = 10;
  return sp;
}
