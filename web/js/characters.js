// One Character per Hermes agent: a RobotExpressive clone with its own colour,
// name tag, speech bubble and a small behaviour machine:
//   working  -> walks to its desk, sits, types (monitor lights up)
//   idle     -> wanders, grabs a coffee, rests on the sofa, thinks at the board
//   sleeping -> sofa (or desk), zzz
//   error    -> desk, shakes its head, warning bubble
//   offline  -> stands greyed-out in the corner
import * as THREE from 'three';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import { findPath, makeTextSprite } from './office.js';
import { t } from './i18n.js';

const HEIGHT = 1.75;
const WALK_SPEED = 1.5;
const ONE_SHOT = new Set(['Jump', 'Yes', 'No', 'Wave', 'Punch', 'ThumbsUp', 'WalkJump', 'Death']);
const LEISURE = [['walk', 32], ['coffee', 24], ['sofa', 24], ['board', 10], ['window', 6], ['chat', 4]];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const rand = (a, b) => a + Math.random() * (b - a);

export class Character {
  constructor(info, gltf, scene, office) {
    this.id = info.id;
    this.info = info;
    this.scene = scene;
    this.office = office;
    this.status = null;
    this.activity = '';
    this.spot = null;          // currently claimed spot
    this.goal = null;          // {kind, spot, until}
    this.path = null;
    this.mode = 'act';
    this.actName = '';
    this.sitting = false;
    this.bubbleText = null;
    this.faceTarget = null;
    this.typingTimer = 0;
    this.emoteTimer = rand(6, 14);

    // model
    this.root = new THREE.Group();
    this.model = skeletonClone(gltf.scene);
    this.model.updateMatrixWorld(true);  // the armature carries a x100 scale: apply it before measuring
    const bb = new THREE.Box3().setFromObject(this.model);
    const s = HEIGHT / (bb.max.y - bb.min.y);
    this.model.scale.setScalar(s);
    this.model.position.y = -bb.min.y * s;
    this.materials = [];
    this.model.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true; o.receiveShadow = false;
        o.userData.agentId = this.id;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        const cloned = mats.map((m) => {
          const c = m.clone();
          if (m.name === 'Main') { c.color.set(info.color); c.userData.main = true; }
          this.materials.push(c);
          return c;
        });
        o.material = Array.isArray(o.material) ? cloned : cloned[0];
      }
    });
    this.root.add(this.model);
    this.root.userData.agentId = this.id;

    // animation
    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = {};
    for (const clip of gltf.animations) {
      const a = this.mixer.clipAction(clip);
      if (ONE_SHOT.has(clip.name)) { a.setLoop(THREE.LoopOnce); a.clampWhenFinished = true; }
      this.actions[clip.name] = a;
    }
    this.mixer.addEventListener('finished', () => { if (ONE_SHOT.has(this.actName)) this.play(this.restAction(), 0.3); });

    // name tag + bubble
    this.tag = makeTextSprite(info.name, { w: 512, h: 128, font: 'bold 64px Inter, Arial', color: '#ffffff', bg: info.color, radius: 40 });
    this.tag.scale.set(1.3, 0.33, 1); this.tag.position.y = HEIGHT + 0.28; this.root.add(this.tag);
    this.bubble = null;

    // start somewhere free
    const start = office.spots.corner[0].p.clone().add(new THREE.Vector3(rand(-1, 1), 0, rand(-1, 1)));
    this.root.position.copy(start);
    scene.add(this.root);
    this.play('Idle', 0);
  }

  // ------------------------------------------------------------ animation helpers
  play(name, fade = 0.35) {
    if (!this.actions[name] || this.actName === name) return;
    const prev = this.actions[this.actName];
    const next = this.actions[name];
    next.reset();
    if (ONE_SHOT.has(name)) next.setLoop(THREE.LoopOnce);
    next.fadeIn(fade).play();
    if (prev) prev.fadeOut(fade);
    this.actName = name;
  }

  restAction() {
    if (this.sitting) return 'Sitting';
    return this.status === 'offline' ? 'Standing' : 'Idle';
  }

  setBubble(text) {
    if (text === this.bubbleText) return;
    this.bubbleText = text;
    if (this.bubble) { this.root.remove(this.bubble); this.bubble.material.map.dispose(); this.bubble.material.dispose(); this.bubble = null; }
    if (!text) return;
    this.bubble = makeTextSprite(text, { w: 900, h: 220, font: '600 58px Inter, Arial', tail: true });
    this.bubble.scale.set(3.2, 0.78, 1);
    this.bubble.position.y = HEIGHT + 0.95;
    this.root.add(this.bubble);
  }

  setGrey(grey) {
    for (const m of this.materials) {
      if (m.userData.main) m.color.set(grey ? '#6b7280' : this.info.color);
      m.opacity = grey ? 0.75 : 1; m.transparent = grey;
    }
  }

  // ------------------------------------------------------------ spots
  claim(kind) {
    const list = this.office.spots[kind] || [];
    const free = list.filter((s) => !s.busy);
    if (!free.length) return null;
    const s = pick(free);
    s.busy = this;
    return s;
  }

  release() {
    if (this.spot) { this.spot.busy = null; this.spot = null; }
  }

  myDesk() {
    const d = this.office.spots.desks;
    return d[this.info.desk % d.length] || d[0];
  }

  // ------------------------------------------------------------ server status
  setStatus(status, activity, info) {
    if (info) { this.info = info; }
    const changed = status !== this.status;
    this.status = status;
    this.activity = activity || '';
    if (changed) {
      this.setGrey(status === 'offline');
      this.goal = null;  // re-plan on next update
    } else if (status === 'working' && this.goal && this.goal.kind === 'desk' && this.mode === 'act') {
      this.setBubble(this.activityText());
    }
  }

  activityText() {
    const a = this.activity ? this.activity : '';
    return a.length > 46 ? a.slice(0, 45) + '…' : a;
  }

  // ------------------------------------------------------------ planning
  plan() {
    this.release();
    const st = this.status || 'idle';
    if (st === 'working' || st === 'error') {
      const d = this.myDesk();
      this.goal = { kind: 'desk', target: d.sit, spot: { p: d.sit, face: d.face, sit: true, desk: d }, until: Infinity };
    } else if (st === 'sleeping') {
      const s = this.claim('sofa');
      if (s) { this.spot = s; this.goal = { kind: 'sofa', target: s.p, spot: s, until: Infinity }; }
      else { const d = this.myDesk(); this.goal = { kind: 'desk', target: d.sit, spot: { p: d.sit, face: d.face, sit: true, desk: d }, until: Infinity }; }
    } else if (st === 'offline') {
      const s = this.claim('corner') || this.office.spots.corner[0];
      this.spot = s.busy === this ? s : null;
      this.goal = { kind: 'corner', target: s.p.clone().add(new THREE.Vector3(rand(-0.8, 0.8), 0, rand(-0.8, 0.8))), spot: { face: s.face }, until: Infinity };
    } else {
      this.planLeisure();
    }
    this.startWalking();
  }

  planLeisure() {
    let kind = weighted(LEISURE);
    let spot = null;
    for (let tries = 0; tries < 3 && !spot; tries++) {
      if (kind === 'walk') {
        const nodes = Object.values(this.office.nodes);
        spot = { p: pick(nodes).p.clone().add(new THREE.Vector3(rand(-0.6, 0.6), 0, rand(-0.6, 0.6))), face: rand(0, Math.PI * 2) };
      } else if (kind === 'chat') {
        const others = Object.values(window.__characters || {}).filter((c) => c !== this && c.status === 'idle' && c.mode === 'act' && !c.sitting);
        if (others.length) {
          const o = pick(others);
          const dir = new THREE.Vector3().subVectors(this.root.position, o.root.position).setY(0).normalize();
          if (dir.lengthSq() < 0.01) dir.set(1, 0, 0);
          spot = { p: o.root.position.clone().add(dir.multiplyScalar(1.3)), face: Math.atan2(-dir.x, -dir.z), chatWith: o };
        } else kind = 'walk';
      } else {
        spot = this.claim(kind);
        if (spot) this.spot = spot; else kind = 'walk';
      }
    }
    if (!spot) spot = { p: this.root.position.clone(), face: this.root.rotation.y };
    const dur = { walk: rand(4, 9), coffee: rand(14, 28), sofa: rand(18, 40), board: rand(12, 24), window: rand(8, 16), chat: rand(10, 18) }[kind];
    this.goal = { kind, target: spot.p, spot, until: performance.now() / 1000 + dur, label: pick(t('leisure')[kind] || ['']) };
  }

  startWalking() {
    const g = this.goal;
    if (!g) return;
    this.standUp();
    this.setBubble(null);
    this.path = findPath(this.office.nodes, this.root.position, g.target);
    this.mode = 'walk';
    this.play(this.status === 'working' ? 'Running' : 'Walking');
  }

  standUp() {
    if (this.sitting) { this.sitting = false; this.root.position.y = 0; }
  }

  arrive() {
    const g = this.goal;
    this.mode = 'act';
    this.path = null;
    const spot = g.spot;
    if (spot && spot.sit) {
      this.root.position.copy(spot.p); this.root.position.y = 0.52; this.sitting = true;
      this.root.rotation.y = spot.face; this.play('Sitting');
    } else {
      this.sitting = false; this.root.position.y = 0;
      this.faceTarget = spot ? spot.face : null;
      this.play(this.status === 'offline' ? 'Standing' : 'Idle');
    }
    if (g.kind === 'desk') {
      if (this.status === 'error') { this.play('No'); this.setBubble(t('error') + ' ' + this.activityText()); }
      else if (this.status === 'sleeping') this.setBubble(t('sleep'));
      else this.setBubble(this.activityText());
    } else if (g.kind === 'sofa' && this.status === 'sleeping') {
      this.setBubble(t('sleep'));
    } else if (g.kind === 'corner') {
      this.setBubble(null);
    } else {
      this.setBubble(g.label || null);
      if (g.kind === 'chat') this.play('Wave');
      if (g.kind === 'board') this.play('Yes');
    }
  }

  // ------------------------------------------------------------ per frame
  update(dt, now) {
    this.mixer.update(dt);
    if (!this.goal) this.plan();
    const g = this.goal;

    if (this.mode === 'walk' && this.path) {
      const target = this.path[0];
      const pos = this.root.position;
      const dir = new THREE.Vector3().subVectors(target, pos).setY(0);
      const dist = dir.length();
      const speed = this.status === 'working' ? WALK_SPEED * 1.6 : WALK_SPEED;
      if (dist < 0.08 || dist < speed * dt) {
        pos.x = target.x; pos.z = target.z;
        this.path.shift();
        if (!this.path.length) this.arrive();
      } else {
        dir.normalize();
        pos.addScaledVector(dir, speed * dt);
        const yaw = Math.atan2(dir.x, dir.z);
        this.root.rotation.y = lerpAngle(this.root.rotation.y, yaw, Math.min(1, dt * 10));
      }
      return;
    }

    // acting
    if (this.faceTarget !== null && this.faceTarget !== undefined) {
      this.root.rotation.y = lerpAngle(this.root.rotation.y, this.faceTarget, Math.min(1, dt * 6));
    }
    if (g.kind === 'desk' && this.status === 'working') {
      // "typing": the monitor flickers in the office; here we bob a little
      this.typingTimer += dt;
      this.model.position.y = (this.model.userData.baseY ??= this.model.position.y) + Math.sin(this.typingTimer * 9) * 0.006;
      // small dot animation in the bubble
      if (this.typingTimer > 2.5 && !this.activity) { this.setBubble(t('typing')); }
    }
    if (this.status === 'idle' && g.until !== Infinity) {
      this.emoteTimer -= dt;
      if (this.emoteTimer <= 0 && !this.sitting && g.kind !== 'walk') { this.play(pick(['Wave', 'Yes', 'ThumbsUp', 'Jump'])); this.emoteTimer = rand(8, 18); }
      if (now > g.until) { this.goal = null; }
    }
    if (g.kind === 'chat' && g.spot.chatWith && g.spot.chatWith.goal && g.spot.chatWith.mode === 'walk') {
      // the other one left: do something else
      this.goal = null;
    }
  }

  dispose() {
    this.release();
    this.scene.remove(this.root);
  }
}

function weighted(pairs) {
  const total = pairs.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [k, w] of pairs) { r -= w; if (r <= 0) return k; }
  return pairs[0][0];
}

function lerpAngle(a, b, k) {
  let d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return a + d * k;
}
