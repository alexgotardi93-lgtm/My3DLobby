// One Character per Hermes agent: a low-poly office person (humanoid.js)
// with its own colour, name tag, speech bubble and a small behaviour machine:
//   working  -> walks to its desk, sits, types (monitor lights up)
//   idle     -> wanders, grabs a coffee, rests on the sofa, thinks at the board
//   sleeping -> sofa (or desk), zzz
//   error    -> desk, shakes its head, warning bubble
//   offline  -> stands greyed-out in the corner
import * as THREE from 'three';
import { Humanoid } from './humanoid.js';
import { findPath, makeTextSprite } from './office.js';
import { t } from './i18n.js';

const WALK_SPEED = 1.4;
const LEISURE = [['walk', 24], ['coffee', 18], ['water', 10], ['table', 10], ['sofa', 22], ['board', 8], ['window', 4], ['chat', 6]];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const rand = (a, b) => a + Math.random() * (b - a);

export class Character {
  constructor(info, scene, office) {
    this.id = info.id;
    this.info = info;
    this.scene = scene;
    this.office = office;
    this.status = null;
    this.activity = '';
    this.spot = null;
    this.goal = null;
    this.path = null;
    this.mode = 'act';
    this.sitting = false;
    this.bubbleText = null;
    this.faceTarget = null;
    this.emoteTimer = rand(6, 14);
    this.moving = 0;

    this.root = new THREE.Group();
    this.human = new Humanoid(info.id, info.color);
    this.model = this.human.root;
    this.model.traverse((o) => { o.userData.agentId = this.id; });
    this.root.add(this.model);
    this.root.userData.agentId = this.id;

    const H = this.human.height;
    this.tag = makeTextSprite(info.name, { w: 512, h: 128, font: 'bold 64px Inter, Arial', color: '#ffffff', bg: 'rgba(12,16,28,0.88)', radius: 40 });
    this.tag.scale.set(1.4, 0.35, 1); this.tag.position.y = H + 0.3; this.root.add(this.tag);
    this.tagBase = H + 0.3;
    this.bubble = null;

    const start = office.spots.corner[0].p.clone().add(new THREE.Vector3(rand(-1, 1), 0, rand(-1, 1)));
    this.root.position.copy(start);
    scene.add(this.root);
  }

  // ------------------------------------------------------------ visuals
  setBubble(text) {
    if (text === this.bubbleText) return;
    this.bubbleText = text;
    if (this.bubble) { this.root.remove(this.bubble); this.bubble.material.map.dispose(); this.bubble.material.dispose(); this.bubble = null; }
    if (!text) return;
    this.bubble = makeTextSprite(text, { w: 900, h: 220, font: '600 58px Inter, Arial', tail: true });
    this.bubble.scale.set(3.0, 0.73, 1);
    this.bubble.position.y = this.tagBase + 0.62;
    this.root.add(this.bubble);
  }

  // ------------------------------------------------------------ spots
  claim(kind) {
    const free = (this.office.spots[kind] || []).filter((s) => !s.busy);
    if (!free.length) return null;
    const s = pick(free); s.busy = this; return s;
  }

  release() { if (this.spot) { this.spot.busy = null; this.spot = null; } }

  myDesk() { const d = this.office.spots.desks; return d[this.info.desk % d.length] || d[0]; }

  // ------------------------------------------------------------ server status
  setStatus(status, activity, info) {
    if (info) this.info = info;
    const changed = status !== this.status;
    this.status = status;
    this.activity = activity || '';
    if (changed) {
      this.human.setGrey(status === 'offline');
      this.goal = null;
    } else if (status === 'working' && this.goal && this.goal.kind === 'desk' && this.mode === 'act') {
      this.setBubble(this.activityText());
    }
  }

  activityText() { const a = this.activity || ''; return a.length > 46 ? a.slice(0, 45) + '…' : a; }

  // ------------------------------------------------------------ planning
  plan() {
    this.release();
    const st = this.status || 'idle';
    const deskGoal = () => { const d = this.myDesk(); return { kind: 'desk', target: d.sit, spot: { p: d.sit, face: d.face, sit: true, seatY: d.seatY, desk: d }, until: Infinity }; };
    if (st === 'working' || st === 'error') {
      this.goal = deskGoal();
    } else if (st === 'sleeping') {
      const s = this.claim('sofa');
      if (s) { this.spot = s; this.goal = { kind: 'sofa', target: s.p, spot: s, until: Infinity }; }
      else this.goal = deskGoal();
    } else if (st === 'offline') {
      const s = this.office.spots.corner[0];
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
          spot = { p: o.root.position.clone().add(dir.multiplyScalar(1.2)), face: Math.atan2(-dir.x, -dir.z), chatWith: o };
        } else kind = 'walk';
      } else {
        spot = this.claim(kind);
        if (spot) this.spot = spot; else kind = 'walk';
      }
    }
    if (!spot) spot = { p: this.root.position.clone(), face: this.root.rotation.y };
    const dur = { walk: rand(4, 9), coffee: rand(14, 28), water: rand(8, 14), table: rand(20, 40), sofa: rand(18, 40), board: rand(12, 24), window: rand(8, 16), chat: rand(10, 18) }[kind];
    this.goal = { kind, target: spot.p, spot, until: performance.now() / 1000 + dur, label: pick(t('leisure')[kind] || ['']) };
  }

  startWalking() {
    const g = this.goal;
    if (!g) return;
    if (this.sitting) { this.sitting = false; }
    this.setBubble(null);
    this.human.setPose('stand');
    this.path = findPath(this.office.nodes, this.root.position, g.target);
    this.mode = 'walk';
  }

  arrive() {
    const g = this.goal;
    this.mode = 'act';
    this.path = null;
    const spot = g.spot;
    if (spot && spot.sit) {
      this.root.position.copy(spot.p);
      this.root.rotation.y = spot.face;
      this.sitting = true;
      this.human.setPose('sit', spot.seatY ?? 0.5);
    } else {
      this.sitting = false;
      this.faceTarget = spot ? spot.face : null;
      this.human.setPose('stand');
    }
    if (g.kind === 'desk') {
      if (this.status === 'error') { this.human.setPose('shake'); this.setBubble(t('error') + ' ' + this.activityText()); }
      else if (this.status === 'sleeping') { this.human.setPose('sleep'); this.setBubble(t('sleep')); }
      else { this.human.setPose('type'); this.setBubble(this.activityText()); }
    } else if (g.kind === 'sofa' || g.kind === 'table') {
      if (this.status === 'sleeping') { this.human.setPose('sleep'); this.setBubble(t('sleep')); }
      else { this.human.setPose(Math.random() < 0.5 ? 'phone' : 'sit'); this.setBubble(g.label || null); }
    } else if (g.kind === 'corner') {
      this.human.setPose('down');
      this.setBubble(null);
    } else {
      this.setBubble(g.label || null);
      if (g.kind === 'coffee' || g.kind === 'water') this.human.setPose('coffee');
      if (g.kind === 'board') this.human.setPose('think');
      if (g.kind === 'chat') this.human.emote('wave', 2.5);
      if (g.kind === 'window') this.human.setPose('stand');
    }
  }

  // ------------------------------------------------------------ per frame
  update(dt, now) {
    if (!this.goal) this.plan();
    const g = this.goal;
    let speed = 0;

    if (this.mode === 'walk' && this.path) {
      const target = this.path[0];
      const pos = this.root.position;
      const dir = new THREE.Vector3().subVectors(target, pos).setY(0);
      const dist = dir.length();
      speed = this.status === 'working' ? WALK_SPEED * 1.5 : WALK_SPEED;
      if (dist < 0.08 || dist < speed * dt) {
        pos.x = target.x; pos.z = target.z;
        this.path.shift();
        if (!this.path.length) { this.arrive(); speed = 0; }
      } else {
        dir.normalize();
        pos.addScaledVector(dir, speed * dt);
        const yaw = Math.atan2(dir.x, dir.z);
        this.root.rotation.y = lerpAngle(this.root.rotation.y, yaw, Math.min(1, dt * 10));
      }
    } else {
      if (this.faceTarget !== null && this.faceTarget !== undefined && !this.sitting) {
        this.root.rotation.y = lerpAngle(this.root.rotation.y, this.faceTarget, Math.min(1, dt * 6));
      }
      if (this.status === 'idle' && g.until !== Infinity) {
        this.emoteTimer -= dt;
        if (this.emoteTimer <= 0 && !this.sitting && g.kind !== 'walk' && g.kind !== 'coffee' && g.kind !== 'water') { this.human.emote(pick(['wave', 'nod', 'thumbs', 'jump']), 2); this.emoteTimer = rand(8, 18); }
        if (now > g.until) this.goal = null;
      }
      if (g.kind === 'chat' && g.spot.chatWith && g.spot.chatWith.mode === 'walk') this.goal = null;
    }
    this.human.update(dt, speed);
  }

  dispose() { this.release(); this.scene.remove(this.root); }
}

function weighted(pairs) {
  const total = pairs.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [k, w] of pairs) { r -= w; if (r <= 0) return k; }
  return pairs[0][0];
}

function lerpAngle(a, b, k) {
  const d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return a + d * k;
}
