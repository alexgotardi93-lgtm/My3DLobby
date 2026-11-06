// The office: floor, walls, desks, coffee corner, sofa, whiteboard, plants —
// plus the "spots" characters go to and the walkable graph between them.
import * as THREE from 'three';

export const FLOOR_W = 26, FLOOR_D = 20;

const mat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, metalness: 0.05, ...o });

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

export function buildOffice(scene, agentCount) {
  const root = new THREE.Group();
  scene.add(root);
  const add = (m) => { m.castShadow = true; m.receiveShadow = true; root.add(m); return m; };
  const box = (w, h, d, c, x, y, z, o) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(c, o)); m.position.set(x, y, z); return add(m); };
  const cyl = (rt, rb, h, c, x, y, z, seg = 24) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat(c)); m.position.set(x, y, z); return add(m); };

  // floor
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(FLOOR_W, FLOOR_D), mat('#cdb28f', { roughness: 0.9 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; floor.name = 'floor'; root.add(floor);
  for (let i = -12; i <= 12; i += 1.3) {
    const l = new THREE.Mesh(new THREE.PlaneGeometry(0.03, FLOOR_D), mat('#b89c79')); l.rotation.x = -Math.PI / 2; l.position.set(i, 0.002, 0); root.add(l);
  }
  const rug = new THREE.Mesh(new THREE.CircleGeometry(3.2, 48), mat('#5b6fa8')); rug.rotation.x = -Math.PI / 2; rug.position.set(-1, 0.004, 5.5); rug.receiveShadow = true; root.add(rug);

  // walls + windows
  box(FLOOR_W, 6, 0.3, '#eef1f7', 0, 3, -10);
  box(0.3, 6, FLOOR_D, '#e3e8f2', -13, 3, 0);
  const windows = [];
  for (const x of [-8, -3, 2, 7]) {
    const w = box(3.2, 2.6, 0.12, '#9fd3ff', x, 3.2, -9.82, { emissive: '#9fd3ff', emissiveIntensity: 0.35, roughness: 0.2 });
    windows.push(w);
    box(3.4, 0.12, 0.2, '#d9dde6', x, 1.85, -9.8); box(3.4, 0.12, 0.2, '#d9dde6', x, 4.55, -9.8);
  }
  // logo sign
  box(4.2, 1.1, 0.08, '#2b3a67', -6, 4.9, -9.8);
  const sign = makeTextSprite('My3DLobby · BPG', { w: 1024, h: 256, font: 'bold 120px Inter, Arial', color: '#ffffff', bg: 'rgba(0,0,0,0)' });
  sign.scale.set(4, 1, 1); sign.position.set(-6, 4.9, -9.7); root.add(sign);

  // desks (row 1 at z=-5, row 2 at z=0.5 when needed)
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
    const mug = a(new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.08, 0.16, 16), mat(['#e65c5c', '#5cb6e6', '#f2c14e', '#9b6be6'][i % 4]))); mug.position.set(0.95, 1.13, 0.2);
    // chair
    const seat = a(new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.1, 0.7), mat('#2f3340'))); seat.position.set(0, 0.55, 1.05);
    const back = a(new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.8, 0.1), mat('#2f3340'))); back.position.set(0, 1.0, 1.4);
    const post = a(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.55, 10), mat('#8a8f9c'))); post.position.set(0, 0.27, 1.05);
    const base = a(new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.04, 20), mat('#8a8f9c'))); base.position.set(0, 0.02, 1.05);
    desks.push({ x, z, sit: new THREE.Vector3(x, 0, z + 1.05), approach: new THREE.Vector3(x, 0, z + 2.3), face: Math.PI, monitor: monitors[i] });
  }

  // whiteboard on the left wall
  box(3.6, 2.2, 0.08, '#ffffff', -12.8, 2.3, -3); box(3.8, 2.4, 0.06, '#aab0bd', -12.84, 2.3, -3);
  for (const [dy, w] of [[0.5, 2.2], [0.1, 2.8], [-0.3, 1.6], [-0.7, 2.5]]) box(w, 0.06, 0.02, dy > 0 ? '#2b3a67' : '#e65c5c', -12.74, 2.3 + dy, -3);

  // coffee corner (right side)
  box(2.2, 1.0, 0.9, '#f4ecdc', 10.5, 0.5, 2.0);
  box(0.5, 0.6, 0.5, '#3a3f4b', 10.2, 1.3, 2.0);
  cyl(0.12, 0.12, 0.2, '#e65c5c', 11.1, 1.1, 1.9);
  box(2.2, 0.08, 0.9, '#d9c7a6', 10.5, 1.04, 2.0);
  cyl(0.08, 0.08, 0.12, '#f4ecdc', 10.8, 1.14, 2.25, 12); cyl(0.08, 0.08, 0.12, '#5cb6e6', 11.0, 1.14, 1.7, 12);

  // sofa
  box(3, 0.5, 1.2, '#6b7fc4', 1.5, 0.25, 7.2); box(3, 0.6, 0.3, '#6b7fc4', 1.5, 0.8, 7.75);
  box(0.3, 0.7, 1.2, '#5a6db0', -0.15, 0.35, 7.2); box(0.3, 0.7, 1.2, '#5a6db0', 3.15, 0.35, 7.2);
  box(1.2, 0.08, 0.6, '#f4ecdc', 1.5, 0.42, 5.6); for (const [dx, dz] of [[-0.5, -0.2], [0.5, -0.2], [-0.5, 0.2], [0.5, 0.2]]) cyl(0.03, 0.03, 0.4, '#3a3f4b', 1.5 + dx, 0.2, 5.6 + dz, 8);

  // plants
  const plant = (x, z) => {
    cyl(0.28, 0.22, 0.4, '#8c6a4a', x, 0.2, z);
    const f = add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 1), mat('#3f9e5a'))); f.position.set(x, 0.85, z);
    const f2 = add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.36, 1), mat('#58b36e'))); f2.position.set(x + 0.25, 1.15, z - 0.1);
  };
  plant(-11.8, -8.8); plant(11.8, -8.8); plant(-11.8, 7.5); plant(6.5, 8.5); plant(11.8, 7.5);

  // spots: where characters go
  const spots = {
    desks,
    coffee: [
      { p: new THREE.Vector3(10.0, 0, 3.4), face: Math.PI },
      { p: new THREE.Vector3(11.2, 0, 3.4), face: Math.PI },
    ],
    sofa: [
      { p: new THREE.Vector3(0.7, 0, 7.2), face: Math.PI, sit: true },
      { p: new THREE.Vector3(1.5, 0, 7.2), face: Math.PI, sit: true },
      { p: new THREE.Vector3(2.3, 0, 7.2), face: Math.PI, sit: true },
    ],
    board: [{ p: new THREE.Vector3(-11.4, 0, -3), face: -Math.PI / 2 }],
    window: [{ p: new THREE.Vector3(-8, 0, -7.6), face: Math.PI }, { p: new THREE.Vector3(7, 0, -7.6), face: Math.PI }],
    corner: [{ p: new THREE.Vector3(12.0, 0, -3), face: -Math.PI / 2 }],
  };

  // walkable graph (nodes in free space; edges hand-made to go around furniture)
  const N = {
    a1: [-10.5, -7.6], a2: [-6, -7.6], a3: [-1, -7.6], a4: [4, -7.6], a5: [9, -7.6], a6: [12, -7.6],
    l1: [-11.4, -4.5], l2: [-11.4, -1], l3: [-11.4, 3],
    b1: [-8.5, -2.3], b2: [-3.5, -2.3], b3: [1.5, -2.3], b4: [6.5, -2.3],
    c1: [-10, 3.2], c2: [-6, 3.2], c3: [-2, 3.2], c4: [2, 3.2], c5: [6, 3.2], c6: [9, 4.5],
    r1: [12.2, -3.5], r2: [12.2, 0.5], r3: [12.2, 4.5],
    d1: [-8, 6.5], d2: [-4, 6.5], d3: [-1.5, 8.6], d4: [4.6, 6.5], d5: [8.5, 7.5],
    e1: [-8, 1.9], e2: [-3, 1.9], e3: [2, 1.9], e4: [7, 1.9],
  };
  const E = [
    ['a1', 'a2'], ['a2', 'a3'], ['a3', 'a4'], ['a4', 'a5'], ['a5', 'a6'], ['a1', 'l1'], ['a6', 'r1'],
    ['l1', 'l2'], ['l2', 'l3'], ['l3', 'c1'], ['l2', 'b1'],
    ['b1', 'b2'], ['b2', 'b3'], ['b3', 'b4'], ['b4', 'r1'], ['r1', 'r2'], ['r2', 'r3'], ['r3', 'c6'], ['c6', 'c5'],
    ['b1', 'e1'], ['b2', 'e2'], ['b3', 'e3'], ['b4', 'e4'], ['e1', 'e2'], ['e2', 'e3'], ['e3', 'e4'], ['e4', 'r2'],
    ['e1', 'c2'], ['e2', 'c3'], ['e3', 'c4'], ['e4', 'c5'],
    ['c1', 'c2'], ['c2', 'c3'], ['c3', 'c4'], ['c4', 'c5'], ['c1', 'd1'], ['c2', 'd1'], ['c3', 'd2'], ['d2', 'd3'], ['c4', 'd4'], ['c5', 'd4'], ['d4', 'd5'], ['c6', 'd5'],
    ['d1', 'd2'], ['d3', 'd4'],
  ];
  const nodes = {};
  for (const [k, [x, z]] of Object.entries(N)) nodes[k] = { id: k, p: new THREE.Vector3(x, 0, z), adj: [] };
  for (const [a, b] of E) { nodes[a].adj.push(b); nodes[b].adj.push(a); }

  return { root, spots, nodes, monitors, windows };
}

// ---------------------------------------------------------------- navigation
export function nearestNode(nodes, p) {
  let best = null, bd = Infinity;
  for (const n of Object.values(nodes)) { const d = n.p.distanceToSquared(p); if (d < bd) { bd = d; best = n; } }
  return best;
}

export function findPath(nodes, from, to) {
  // BFS over the graph between the nearest nodes, then straight to the target
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
  // drop the first node if it is behind us (closer to go straight)
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
