// Low-poly office person, built from primitives and animated in code:
// shirt in the agent's colour, skin and hair picked per agent, a badge,
// two-segment arms and legs so it can sit, type, sip coffee and wave.
import * as THREE from 'three';

const SKINS = ['#f1c9a5', '#d9a67a', '#c68642', '#8d5524', '#ffdbac', '#e0ac69'];
const HAIRS = ['#3a2a22', '#1a1a1a', '#6b3b2a', '#8a4b1f', '#2b2b2b', '#4a3b2a', '#5c2e1a'];
const PANTS = '#2e3340';

const HIP_STAND = 0.95;
const THIGH = 0.46, SHIN = 0.44, UPPER = 0.30, FORE = 0.28;

const mat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, metalness: 0.03, ...o });

function hash(s) { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

const lerp = (a, b, k) => a + (b - a) * k;

export class Humanoid {
  constructor(id, color) {
    const h = hash(id);
    this.color = color;
    this.skin = SKINS[h % SKINS.length];
    this.hair = HAIRS[(h >>> 4) % HAIRS.length];
    this.root = new THREE.Group();
    this.mats = [];
    const m = (c, o) => { const x = mat(c, o); this.mats.push(x); return x; };
    const mesh = (geo, material) => { const x = new THREE.Mesh(geo, material); x.castShadow = true; return x; };

    // hips → torso, head
    this.hips = new THREE.Group(); this.hips.position.y = HIP_STAND; this.root.add(this.hips);
    this.shirtMat = m(color);
    const torso = mesh(new THREE.CapsuleGeometry(0.27, 0.46, 6, 14), this.shirtMat); torso.position.y = 0.42; this.hips.add(torso);
    const belt = mesh(new THREE.CylinderGeometry(0.27, 0.25, 0.14, 14), m(PANTS)); belt.position.y = 0.05; this.hips.add(belt);
    const badge = mesh(new THREE.BoxGeometry(0.17, 0.11, 0.02), m('#ffffff')); badge.position.set(0.13, 0.5, 0.27); this.hips.add(badge);
    const badgeStripe = mesh(new THREE.BoxGeometry(0.17, 0.03, 0.022), m(color)); badgeStripe.position.set(0.13, 0.535, 0.27); this.hips.add(badgeStripe);

    this.head = new THREE.Group(); this.head.position.y = 0.78; this.hips.add(this.head);
    const neck = mesh(new THREE.CylinderGeometry(0.08, 0.09, 0.12, 10), m(this.skin)); neck.position.y = 0.02; this.head.add(neck);
    const skull = mesh(new THREE.SphereGeometry(0.25, 20, 16), m(this.skin)); skull.position.y = 0.3; this.head.add(skull);
    const cap = mesh(new THREE.SphereGeometry(0.262, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2.05), m(this.hair)); cap.position.y = 0.32; this.head.add(cap);
    const back = mesh(new THREE.SphereGeometry(0.255, 16, 10, Math.PI * 1.25, Math.PI * 0.5, Math.PI / 2.05, Math.PI / 3), m(this.hair)); back.position.y = 0.32; this.head.add(back);
    for (const dx of [-0.085, 0.085]) { const e = mesh(new THREE.SphereGeometry(0.032, 8, 8), m('#1a1a1a')); e.position.set(dx, 0.32, 0.225); this.head.add(e); }
    const mouth = mesh(new THREE.BoxGeometry(0.07, 0.015, 0.01), m('#8a4b3a')); mouth.position.set(0, 0.22, 0.24); this.head.add(mouth);

    // arms: shoulder → upper arm → elbow → forearm → hand
    const limb = (parent, pos, len, radius, material, tipMat) => {
      const joint = new THREE.Group(); joint.position.copy(pos); parent.add(joint);
      const seg = mesh(new THREE.CapsuleGeometry(radius, len - radius * 2, 4, 10), material); seg.position.y = -len / 2; joint.add(seg);
      const end = new THREE.Group(); end.position.y = -len; joint.add(end);
      if (tipMat) { const tip = mesh(new THREE.SphereGeometry(radius * 1.05, 10, 10), tipMat); end.add(tip); }
      return { joint, end };
    };
    const skinMat = m(this.skin);
    this.shoulderL = limb(this.hips, new THREE.Vector3(-0.36, 0.68, 0), UPPER, 0.075, this.shirtMat);
    this.elbowL = limb(this.shoulderL.end, new THREE.Vector3(0, 0, 0), FORE, 0.065, skinMat, skinMat);
    this.shoulderR = limb(this.hips, new THREE.Vector3(0.36, 0.68, 0), UPPER, 0.075, this.shirtMat);
    this.elbowR = limb(this.shoulderR.end, new THREE.Vector3(0, 0, 0), FORE, 0.065, skinMat, skinMat);
    // legs
    const pantsMat = m(PANTS), shoeMat = m('#1b1d24');
    this.hipL = limb(this.hips, new THREE.Vector3(-0.14, 0, 0), THIGH, 0.095, pantsMat);
    this.kneeL = limb(this.hipL.end, new THREE.Vector3(0, 0, 0), SHIN, 0.085, pantsMat);
    this.hipR = limb(this.hips, new THREE.Vector3(0.14, 0, 0), THIGH, 0.095, pantsMat);
    this.kneeR = limb(this.hipR.end, new THREE.Vector3(0, 0, 0), SHIN, 0.085, pantsMat);
    for (const k of [this.kneeL, this.kneeR]) { const shoe = mesh(new THREE.BoxGeometry(0.16, 0.08, 0.26), shoeMat); shoe.position.set(0, 0.0, 0.05); k.end.add(shoe); }

    // coffee cup (hidden unless sipping)
    this.cup = new THREE.Group();
    const cupBody = mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.1, 12), m('#ffffff')); this.cup.add(cupBody);
    const cupBand = mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.03, 12), m('#e65c5c')); cupBand.position.y = 0.02; this.cup.add(cupBand);
    this.cup.position.set(0, -0.02, 0.05); this.cup.visible = false; this.elbowR.end.add(this.cup);
    // phone
    this.phone = mesh(new THREE.BoxGeometry(0.07, 0.13, 0.01), m('#111318')); this.phone.position.set(0, -0.02, 0.06); this.phone.visible = false; this.elbowR.end.add(this.phone);

    this.height = HIP_STAND + 0.78 + 0.57;
    this.pose = 'stand';
    this.seatY = 0;
    this.t = Math.random() * 10;
    this.walkPhase = 0;
    this.speed = 0;
    this.emoteName = null;
    this.emoteUntil = 0;
    this.cur = this.targets('stand');
  }

  setColor(c) { this.shirtMat.color.set(c); }

  setGrey(grey) {
    this.shirtMat.color.set(grey ? '#6b7280' : this.color);
    for (const mm of this.mats) { mm.transparent = grey; mm.opacity = grey ? 0.7 : 1; }
  }

  // ---------------------------------------------------------- poses
  /** Joint targets for a pose (radians). sx/sz: shoulder, e: elbow, h: hip, k: knee, hx/hy: head, hipY */
  targets(pose) {
    const base = { sLx: 0, sLz: 0.12, eLx: -0.1, sRx: 0, sRz: -0.12, eRx: -0.1, hLx: 0, kLx: 0, hRx: 0, kRx: 0, hx: 0, hy: 0, hipY: HIP_STAND, torso: 0 };
    const sit = { ...base, hLx: -Math.PI / 2, kLx: Math.PI / 2 - 0.05, hRx: -Math.PI / 2, kRx: Math.PI / 2 - 0.05, hipY: this.seatY + 0.1, sLz: 0.15, sRz: -0.15 };
    switch (pose) {
      case 'stand': return base;
      case 'walk': return { ...base, eLx: -0.35, eRx: -0.35 };
      case 'sit': return { ...sit, sLx: -0.35, sRx: -0.35, eLx: -0.9, eRx: -0.9 };
      case 'type': return { ...sit, sLx: -0.55, sRx: -0.55, eLx: -1.05, eRx: -1.05, hx: 0.12 };
      case 'sleep': return { ...sit, sLx: -0.2, sRx: -0.2, eLx: -0.6, eRx: -0.6, hx: 0.45, hy: 0.25, torso: 0.12 };
      // lying on the back in a bed: the whole body turns with the hips; legs straight, arms by the sides
      case 'lie': return { ...base, sLz: 0.08, sRz: -0.08, eLx: -0.15, eRx: -0.15, hipY: this.seatY + 0.14, torso: -Math.PI / 2 };
      case 'phone': return { ...sit, sRx: -0.9, eRx: -1.9, sRz: -0.4, sLx: -0.3, eLx: -0.8, hx: 0.5 };
      case 'coffee': return { ...base, sRx: -1.3, eRx: -1.7, sRz: -0.45, sLz: 0.2, hx: -0.05 };
      case 'think': return { ...base, sLx: -1.3, eLx: -1.7, sLz: 0.45, hx: 0.15, hy: -0.2 };
      case 'wave': return { ...base, sRx: -2.9, sRz: 0.5, eRx: -0.4 };
      case 'thumbs': return { ...base, sRx: -1.2, eRx: -1.2 };
      case 'nod': return base;
      case 'shake': return base;
      case 'jump': return { ...base, sLx: -2.8, sRx: -2.8 };
      case 'down': return { ...base, hx: 0.5, torso: 0.1 };
      default: return base;
    }
  }

  setPose(pose, seatY) {
    if (seatY !== undefined) this.seatY = seatY;
    this.pose = pose;
    this.cup.visible = pose === 'coffee';
    this.phone.visible = pose === 'phone';
  }

  emote(name, seconds = 2.2) { this.emoteName = name; this.emoteUntil = this.t + seconds; }

  // ---------------------------------------------------------- per frame
  update(dt, speed) {
    this.t += dt;
    this.speed = speed;
    const activePose = this.emoteName && this.t < this.emoteUntil ? this.emoteName : (speed > 0.05 ? 'walk' : this.pose);
    if (this.emoteName && this.t >= this.emoteUntil) this.emoteName = null;
    const tg = this.targets(activePose);
    const k = Math.min(1, dt * 9);
    const c = this.cur;
    for (const key of Object.keys(tg)) c[key] = lerp(c[key] ?? tg[key], tg[key], k);

    // procedural layers
    const t = this.t;
    let bob = 0, sL = c.sLx, sR = c.sRx, hL = c.hLx, hR = c.hRx, kL = c.kLx, kR = c.kRx, eL = c.eLx, eR = c.eRx, hx = c.hx, hy = c.hy;
    if (activePose === 'walk') {
      this.walkPhase += dt * Math.max(4, speed * 5.2);
      const p = this.walkPhase;
      const sw = Math.sin(p);
      hL += sw * 0.6; hR -= sw * 0.6;
      kL += Math.max(0, -sw) * 1.0; kR += Math.max(0, sw) * 1.0;
      sL -= sw * 0.45; sR += sw * 0.45;
      bob = Math.abs(Math.cos(p)) * 0.045;
      hy += Math.sin(p * 0.5) * 0.04;
    } else {
      bob = Math.sin(t * 1.6) * 0.008;  // breathing
      hy += Math.sin(t * 0.7) * 0.06;
    }
    if (activePose === 'type') { eL += Math.sin(t * 11) * 0.12; eR += Math.sin(t * 11 + 1.7) * 0.12; hx += Math.sin(t * 0.9) * 0.03; }
    if (activePose === 'coffee') { const sip = Math.max(0, Math.sin(t * 0.9)); eR -= sip * 0.3; hx -= sip * 0.2; }
    if (activePose === 'phone') { eR += Math.sin(t * 2.5) * 0.04; }
    if (activePose === 'think') { eL += Math.sin(t * 1.3) * 0.08; hx += Math.sin(t * 0.5) * 0.08; }
    if (activePose === 'sleep') { bob += Math.sin(t * 1.1) * 0.012; hx += Math.sin(t * 1.1) * 0.04; }
    if (activePose === 'lie') { bob = Math.sin(t * 1.1) * 0.01; hy = 0; }  // slow breathing, head still
    if (activePose === 'wave') { this.elbowR.joint.rotation.z = Math.sin(t * 9) * 0.45; } else { this.elbowR.joint.rotation.z = lerp(this.elbowR.joint.rotation.z, 0, k); }
    if (activePose === 'nod') { hx += Math.sin(t * 7) * 0.25; }
    if (activePose === 'shake') { hy += Math.sin(t * 8) * 0.45; }
    if (activePose === 'jump') { bob += Math.max(0, Math.sin(t * 6)) * 0.25; kL += 0.3; kR += 0.3; }

    this.hips.position.y = c.hipY + bob;
    this.hips.rotation.x = c.torso;
    this.shoulderL.joint.rotation.set(sL, 0, c.sLz);
    this.shoulderR.joint.rotation.set(sR, 0, c.sRz);
    this.elbowL.joint.rotation.x = eL;
    this.elbowR.joint.rotation.x = eR;
    this.hipL.joint.rotation.x = hL; this.hipR.joint.rotation.x = hR;
    this.kneeL.joint.rotation.x = kL; this.kneeR.joint.rotation.x = kR;
    this.head.rotation.set(hx, hy, 0);
  }
}
