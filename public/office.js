// Kantor 3D: setiap agen berjalan ke tempat yang sesuai status kerjanya yang asli.
// idle → lounge, thinking/working → meja sendiri, meeting → meja rapat, delivering → depan meja CEO.

const THREE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';

function loadThree() {
  if (window.THREE) return Promise.resolve(window.THREE);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = THREE_URL;
    s.onload = () => resolve(window.THREE);
    s.onerror = () => reject(new Error('Three.js gagal dimuat'));
    document.head.appendChild(s);
  });
}

// Posisi meja (x, z). Kursi ada di sisi +z meja; agen menghadap -z ke monitor.
const DESKS = {
  ceo: [0, -6.2],
  ops: [-8, -3], ops_admin: [-8, 0.8], ops_analyst: [-8, 4.6],
  mkt: [8, -3], mkt_research: [8, 0.8], mkt_copy: [8, 4.6], mkt_content: [4.4, 4.6],
};
const MEETING = [0, 0];
const LOUNGE = [[-3.4, 6.3], [-2.2, 7.0], [-1, 6.4], [0.3, 7.1], [1.5, 6.4], [2.7, 7.0], [3.8, 6.3], [-4.4, 7.2]];

export async function createOffice(container, roster) {
  const THREE = await loadThree();
  const dark = matchMedia('(prefers-color-scheme: dark)').matches && document.documentElement.dataset.theme !== 'light';
  const pal = dark
    ? { bg: 0x0f181d, floor: 0x1b272e, rug: 0x173634, wall: 0x22313a, desk: 0x5a4636, top: 0x7a5f48, screen: 0x0b1216, screenOn: 0x5cc7c9, plant: 0x2f7a4f, sofa: 0x3d4f73, label: '#e3ecef', labelBg: 'rgba(19,29,35,0.88)' }
    : { bg: 0xeef2f4, floor: 0xdfe5e8, rug: 0xc6e3e1, wall: 0xf7f9fa, desk: 0x9a7a5c, top: 0xc49b72, screen: 0x1d2a33, screenOn: 0x0b6e74, plant: 0x3f9a63, sofa: 0x5b74a8, label: '#15212a', labelBg: 'rgba(255,255,255,0.92)' };

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(pal.bg);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);

  scene.add(new THREE.HemisphereLight(0xffffff, dark ? 0x223038 : 0xb9c7cf, dark ? 0.55 : 0.75));
  const sun = new THREE.DirectionalLight(0xffffff, dark ? 0.6 : 0.85);
  sun.position.set(8, 18, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 14, bottom: -14 });
  scene.add(sun);

  const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...extra });
  const box = (w, h, d, color, x, y, z, parent = scene) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };

  // Lantai, dinding, karpet
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(26, 18), mat(pal.floor));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  box(26, 2.4, 0.3, pal.wall, 0, 1.2, -9);
  box(0.3, 2.4, 18, pal.wall, -13, 1.2, 0);
  box(0.3, 2.4, 18, pal.wall, 13, 1.2, 0);
  const rug = new THREE.Mesh(new THREE.CircleGeometry(3.4, 48), mat(pal.rug));
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(0, 0.01, 0);
  rug.receiveShadow = true;
  scene.add(rug);

  // Label zona di lantai
  const floorText = (text, x, z, w = 5) => {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 96;
    const g = c.getContext('2d');
    g.font = '600 44px "IBM Plex Sans", system-ui, sans-serif';
    g.fillStyle = dark ? 'rgba(227,236,239,0.35)' : 'rgba(21,33,42,0.28)';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 256, 48);
    const t = new THREE.CanvasTexture(c);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 96 / 512), new THREE.MeshBasicMaterial({ map: t, transparent: true }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.02, z);
    scene.add(m);
  };
  floorText('OPERASIONAL', -8, -5.2);
  floorText('MARKETING', 7, -5.2);
  floorText('RUANG CEO', 0, -8.2);
  floorText('LOUNGE', 0, 8.3, 4);

  // Meja kerja + monitor
  const screens = {};
  for (const [id, [x, z]] of Object.entries(DESKS)) {
    const big = id === 'ceo';
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    box(big ? 3 : 2.2, 0.08, big ? 1.3 : 1.1, pal.top, 0, 0.78, 0, g);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(0.08, 0.76, 0.08, pal.desk, sx * (big ? 1.4 : 1.0), 0.38, sz * (big ? 0.55 : 0.45), g);
    box(0.9, 0.55, 0.06, 0x222222, 0, 1.15, -0.35, g);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.82, 0.47), new THREE.MeshStandardMaterial({ color: pal.screen, emissive: pal.screenOn, emissiveIntensity: 0 }));
    screen.position.set(0, 1.15, -0.315);
    g.add(screen);
    box(0.1, 0.3, 0.1, 0x333333, 0, 0.92, -0.35, g);
    box(0.6, 0.45, 0.6, 0x3a3f44, 0, 0.45, 0.95, g); // kursi
    screens[id] = screen;
    scene.add(g);
  }

  // Meja rapat bundar + kursi
  const table = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 0.08, 40), mat(pal.top));
  table.position.set(MEETING[0], 0.78, MEETING[1]);
  table.castShadow = true;
  scene.add(table);
  const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.3, 0.76, 16), mat(pal.desk));
  leg.position.set(MEETING[0], 0.38, MEETING[1]);
  scene.add(leg);

  // Lounge: sofa + tanaman
  box(5, 0.45, 1, pal.sofa, 0, 0.3, 7.9);
  box(5, 0.7, 0.25, pal.sofa, 0, 0.6, 8.35);
  for (const [x, z] of [[-11.8, -7.8], [11.8, -7.8], [-11.8, 7.8], [11.8, 7.8], [5.5, 7.6], [-5.5, 7.6]]) {
    box(0.5, 0.5, 0.5, 0x8a6f58, x, 0.25, z);
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.55, 14, 10), mat(pal.plant));
    leaf.position.set(x, 1.0, z);
    leaf.castShadow = true;
    scene.add(leaf);
  }

  // Sprite label (nama) dan gelembung (aktivitas)
  function textSprite(lines, { bold = false, maxWidth = 360 } = {}) {
    const c = document.createElement('canvas');
    const scale = 2;
    const g = c.getContext('2d');
    const font = `${bold ? 600 : 400} ${13 * scale}px "IBM Plex Sans", system-ui, sans-serif`;
    g.font = font;
    const wrapped = [];
    for (const line of lines) {
      let cur = '';
      for (const word of String(line).split(' ')) {
        const test = cur ? cur + ' ' + word : word;
        if (g.measureText(test).width > maxWidth * scale && cur) { wrapped.push(cur); cur = word; } else cur = test;
      }
      if (cur) wrapped.push(cur);
    }
    const shown = wrapped.slice(0, 3);
    const w = Math.ceil(Math.max(...shown.map((l) => g.measureText(l).width), 10)) + 20 * scale;
    const lh = 18 * scale;
    const h = shown.length * lh + 10 * scale;
    c.width = w; c.height = h;
    g.font = font;
    g.fillStyle = pal.labelBg;
    const r = 8 * scale;
    g.beginPath();
    g.moveTo(r, 0); g.arcTo(w, 0, w, h, r); g.arcTo(w, h, 0, h, r); g.arcTo(0, h, 0, 0, r); g.arcTo(0, 0, w, 0, r);
    g.fill();
    g.fillStyle = pal.label;
    g.textBaseline = 'middle';
    shown.forEach((l, i) => g.fillText(l, 10 * scale, 5 * scale + lh * (i + 0.5)));
    const tex = new THREE.CanvasTexture(c);
    tex.minFilter = THREE.LinearFilter;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    const k = 0.0105 / scale * 2;
    sp.scale.set(w * k / 2, h * k / 2, 1);
    sp.renderOrder = 10;
    return sp;
  }

  // Agen
  const agents = {};
  roster.forEach((a, i) => {
    const g = new THREE.Group();
    const color = new THREE.Color(a.color);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, 0.9, 16), mat(color));
    body.position.y = 0.75;
    body.castShadow = true;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 18, 14), mat(0xf0c9a0));
    head.position.y = 1.42;
    head.castShadow = true;
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.25, 18, 14, 0, Math.PI * 2, 0, Math.PI / 2), mat(a.id === 'ceo' ? 0x222222 : color.clone().multiplyScalar(0.45)));
    hair.position.y = 1.47;
    const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.2, 0.32, 12), mat(0x2b3440));
    legs.position.y = 0.16;
    g.add(body, head, hair, legs);
    if (a.id === 'ceo') {
      const tie = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.4, 0.02), mat(0xb3261e));
      tie.position.set(0, 0.95, 0.33);
      g.add(tie);
    }
    const label = textSprite([`${a.name} · ${a.title}`], { bold: true });
    label.position.y = 2.05;
    g.add(label);
    const start = LOUNGE[i % LOUNGE.length];
    g.position.set(start[0], 0, start[1]);
    scene.add(g);
    agents[a.id] = { group: g, body, label, bubble: null, bubbleText: '', target: new THREE.Vector3(start[0], 0, start[1]), facing: 0, status: 'idle', phase: Math.random() * 6 };
  });

  function targetFor(a, status, index) {
    if (status === 'meeting') {
      const ids = Object.keys(agents);
      const ang = (index / ids.length) * Math.PI * 2;
      return { pos: [MEETING[0] + Math.cos(ang) * 2.15, MEETING[1] + Math.sin(ang) * 2.15], face: Math.atan2(-Math.cos(ang), -Math.sin(ang)) };
    }
    if (status === 'delivering') {
      const [x, z] = DESKS.ceo;
      return { pos: [x + (index % 3 - 1) * 0.9, z + 1.9], face: Math.PI };
    }
    if (status === 'thinking' || status === 'working') {
      const [x, z] = DESKS[a] || [0, 0];
      return { pos: [x, z + 0.95], face: Math.PI };
    }
    const [x, z] = LOUNGE[index % LOUNGE.length];
    return { pos: [x, z], face: 0 };
  }

  function update(list) {
    list.forEach((a, i) => {
      const ag = agents[a.id];
      if (!ag) return;
      ag.status = a.status;
      const t = targetFor(a.id, a.status, i);
      ag.target.set(t.pos[0], 0, t.pos[1]);
      ag.restFacing = t.face;
      if (screens[a.id]) screens[a.id].material.emissiveIntensity = a.status === 'working' || a.status === 'thinking' ? 0.9 : 0;
      const text = a.status === 'idle' ? '' : `${{ thinking: '💭', meeting: '🗣️', working: '⌨️', delivering: '📨' }[a.status] || ''} ${a.activity || a.status}${a.model ? ' · ' + a.model : ''}`;
      if (text !== ag.bubbleText) {
        if (ag.bubble) { ag.group.remove(ag.bubble); ag.bubble.material.map.dispose(); ag.bubble.material.dispose(); ag.bubble = null; }
        if (text) {
          ag.bubble = textSprite([text], { maxWidth: 220 });
          ag.bubble.position.y = 2.55;
          ag.group.add(ag.bubble);
        }
        ag.bubbleText = text;
      }
    });
  }

  // Kamera orbit sederhana (seret untuk memutar, scroll/pinch untuk zoom)
  let yaw = 0.0;
  let pitch = 0.82;
  let dist = 24;
  const placeCamera = () => {
    camera.position.set(Math.sin(yaw) * Math.cos(pitch) * dist, Math.sin(pitch) * dist, Math.cos(yaw) * Math.cos(pitch) * dist);
    camera.lookAt(0, 0, 0.5);
  };
  placeCamera();
  let drag = null;
  const el = renderer.domElement;
  el.style.touchAction = 'none';
  el.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; el.setPointerCapture(e.pointerId); });
  el.addEventListener('pointermove', (e) => {
    if (!drag) return;
    yaw -= (e.clientX - drag.x) * 0.006;
    pitch = Math.max(0.35, Math.min(1.35, pitch + (e.clientY - drag.y) * 0.004));
    drag = { x: e.clientX, y: e.clientY };
    placeCamera();
  });
  el.addEventListener('pointerup', () => (drag = null));
  el.addEventListener('wheel', (e) => { e.preventDefault(); dist = Math.max(12, Math.min(38, dist + e.deltaY * 0.02)); placeCamera(); }, { passive: false });

  const resize = () => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.fov = w < 600 ? 55 : 42;
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clock = new THREE.Clock();
  let raf;
  const tmp = new THREE.Vector3();
  function tick() {
    raf = requestAnimationFrame(tick);
    const dt = Math.min(0.05, clock.getDelta());
    const time = clock.elapsedTime;
    for (const ag of Object.values(agents)) {
      const p = ag.group.position;
      tmp.subVectors(ag.target, p);
      const d = tmp.length();
      if (d > 0.05) {
        const step = Math.min(d, (reduceMotion ? 20 : 2.4) * dt);
        tmp.normalize();
        p.addScaledVector(tmp, step);
        ag.facing = Math.atan2(tmp.x, tmp.z);
        ag.body.position.y = 0.75 + Math.abs(Math.sin(time * 10 + ag.phase)) * 0.06;
      } else {
        ag.facing += ((ag.restFacing ?? ag.facing) - ag.facing) * Math.min(1, dt * 5);
        const busy = ag.status === 'working' || ag.status === 'thinking';
        ag.body.position.y = 0.75 + (busy && !reduceMotion ? Math.sin(time * 6 + ag.phase) * 0.02 : 0);
      }
      ag.group.rotation.y = ag.facing;
      ag.label.material.rotation = 0;
    }
    renderer.render(scene, camera);
  }
  tick();

  return {
    update,
    destroy() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.dispose();
      el.remove();
    },
  };
}
