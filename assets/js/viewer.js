import * as THREE from 'three';

/* ─────────────────────────────────────────────────────────────
   Сцена: тёплый свет, стеклянные грани, чертёжные рёбра.
   Отдельно от логики: сюда приходят готовые solid и section.
   ───────────────────────────────────────────────────────────── */

const PALETTES = {
  light: {
    paper: '#F5F1E8',
    face: 0x8C9CB6,
    edge: 0x25272D,
    sectionFill: 0xC14A32,
    sectionLine: 0xB0432D,
    plane: 0x2C6B62,
    grid1: 0xC9C1AF,
    grid2: 0xDED7C8,
    axisX: 0xC14A32,
    axisY: 0x2C6B62,
    axisZ: 0x5A4FCF,
    handle: 0x25272D,
    labelBg: '#FFFDF9',
    labelInk: '#1B1C20',
    labelLine: '#E3DCCD',
  },
  dark: {
    paper: '#12141A',
    face: 0xA6B6D0,
    edge: 0xD8DCE4,
    sectionFill: 0xE0684B,
    sectionLine: 0xF08165,
    plane: 0x63A99E,
    grid1: 0x333A46,
    grid2: 0x252B35,
    axisX: 0xE0684B,
    axisY: 0x63A99E,
    axisZ: 0x958AF2,
    handle: 0xE8E9EC,
    labelBg: '#1C2029',
    labelInk: '#F2F1EC',
    labelLine: '#3A4150',
  },
};

const POINT_COLORS = { M: '#C14A32', N: '#2C6B62', K: '#5A4FCF' };

const tmpV = new THREE.Vector3();

export class Viewer {
  constructor(stageEl, labelEl) {
    this.stageEl = stageEl;
    this.labelEl = labelEl;
    this.theme = 'light';
    this.palette = PALETTES.light;

    this.solid = null;
    this.section = null;
    this.plane = null;
    this.points = {};

    this.visual = {
      opacity: 0.16,
      labels: true,
      grid: true,
      axes: false,
      plane: true,
      cut: 'none',
    };
    this.upperSign = null;

    this.labels = [];       // {el, kind, key|index, anchor:Vector3}
    this.labelScreens = []; // для экспорта

    this._dirty = true;
    this._autorotate = false;
    this._reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // камера-«орбита»
    this.theta = 0.95;
    this.phi = 1.02;
    this.dist = 9;
    this.target = new THREE.Vector3(0, 1, 0);
    this._tween = null;

    this._initScene();
    this._initLabelsBase();
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  /* ── сцена ───────────────────────────────────────────────── */

  _initScene() {
    const w = this.stageEl.clientWidth || 800;
    const h = this.stageEl.clientHeight || 600;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, w / h, 0.05, 300);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h);
    this.renderer.localClippingEnabled = true;
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.setAttribute('aria-label', 'Трёхмерная сцена: фигура и её сечение. Вращайте перетаскиванием.');
    this.renderer.domElement.setAttribute('role', 'img');
    this.stageEl.appendChild(this.renderer.domElement);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xd9d2c4, 1.25));
    const key = new THREE.DirectionalLight(0xffffff, 1.15);
    key.position.set(6, 9, 7);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xf3e6d8, 0.55);
    fill.position.set(-7, 3, -5);
    this.scene.add(fill);

    this.solidGroup = new THREE.Group();
    this.sectionGroup = new THREE.Group();
    this.planeGroup = new THREE.Group();
    this.pointGroup = new THREE.Group();
    this.handleGroup = new THREE.Group();
    this.looseGroup = new THREE.Group();
    this.helperGroup = new THREE.Group();
    this.scene.add(this.solidGroup, this.planeGroup, this.sectionGroup, this.pointGroup, this.handleGroup, this.looseGroup, this.helperGroup);

    this._buildHelpers();

    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(this.stageEl);
  }

  _buildHelpers() {
    this.grid = new THREE.GridHelper(14, 28, this.palette.grid1, this.palette.grid2);
    this.grid.material.transparent = true;
    this.grid.material.opacity = 0.55;
    this.grid.material.depthWrite = false;
    this.grid.position.y = 0.001;
    this.gridHelper = this.grid;
    this.helperGroup.add(this.grid);

    this.axesGroup = new THREE.Group();
    const mk = (dir, color, label) => {
      const len = 3.2;
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), dir.clone().multiplyScalar(len)]);
      const m = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.75 });
      const line = new THREE.Line(g, m);
      line.userData.axisLabel = label;
      line.userData.dir = dir.clone();
      return line;
    };
    [[new THREE.Vector3(1, 0, 0), this.palette.axisX, 'x'],
      [new THREE.Vector3(0, 1, 0), this.palette.axisY, 'y'],
      [new THREE.Vector3(0, 0, 1), this.palette.axisZ, 'z']].forEach(([d, c, l]) => this.axesGroup.add(mk(d, c, l)));
    this.axesGroup.visible = false;
    this.helperGroup.add(this.axesGroup);
  }

  _applyPalette() {
    const p = this.palette;
    this.grid.material.color.setHex(p.grid2);
    this.grid.material.opacity = this.theme === 'dark' ? 0.5 : 0.55;
    // GridHelper цвет вершин задаётся при создании; пересоберём при смене темы
    this.helperGroup.remove(this.grid);
    disposeObject(this.grid);
    this.grid = new THREE.GridHelper(14, 28, p.grid1, p.grid2);
    this.grid.material.transparent = true;
    this.grid.material.opacity = this.theme === 'dark' ? 0.42 : 0.55;
    this.grid.material.depthWrite = false;
    this.grid.position.y = 0.001;
    this.grid.visible = this.visual.grid;
    this.helperGroup.add(this.grid);

    this.axesGroup.children.forEach((line) => {
      const l = line.userData.axisLabel;
      line.material.color.setHex(l === 'x' ? p.axisX : l === 'y' ? p.axisY : p.axisZ);
    });

    if (this.solid) this._rebuildSolid(this.solid);
    if (this.section) this._rebuildSection(this.section);
    if (this.plane) this._rebuildPlane(this.plane);
    this._rebuildPoints();
    this._rebuildHandles();
    this._dirty = true;
  }

  setTheme(theme) {
    this.theme = theme;
    this.palette = PALETTES[theme] ?? PALETTES.light;
    this._applyPalette();
  }

  /* ── публичное: тела и сечение ───────────────────────────── */

  setSolid(solid) {
    this.solid = solid;
    disposeGroup(this.looseGroup);
    this._rebuildSolid(solid);
    this._updateFaceMaterial();
    this._rebuildLabelsIfNeeded();
    this._rebuildHandles();
    this._dirty = true;
  }

  /** Точки, из которых ещё не собралось тело */
  setLoosePoints(points) {
    disposeGroup(this.looseGroup);
    const r = Math.max(0.055, (this.solid?.radius ?? 2) * 0.03);
    for (const p of points) {
      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(r, 14, 10),
        new THREE.MeshBasicMaterial({ color: this.palette.handle }),
      );
      dot.position.copy(p);
      this.looseGroup.add(dot);
    }
    this._dirty = true;
  }

  /** Полностью убрать тело со сцены (режим «своя фигура» без вершин) */
  clearSolid() {
    this.solid = null;
    this.section = null;
    this.plane = null;
    this.points = {};
    this._picks = [];
    disposeGroup(this.solidGroup);
    disposeGroup(this.handleGroup);
    disposeGroup(this.sectionGroup);
    disposeGroup(this.planeGroup);
    disposeGroup(this.pointGroup);
    this.labelEl.innerHTML = '';
    this.labels = [];
    this._labelSig = '';
    this._dirty = true;
  }

  setSection(section) {
    this.section = section;
    this._rebuildSection(section);
    this._dirty = true;
  }

  setPlane(plane) {
    this.plane = plane;
    this._rebuildPlane(plane);
    this._updateClipPlanes();
    this._dirty = true;
  }

  setPoints(points) {
    this.points = points;
    this._rebuildPoints();
    this._dirty = true;
  }

  setVisual(patch) {
    Object.assign(this.visual, patch);
    this.grid.visible = this.visual.grid;
    this.axesGroup.visible = this.visual.axes;
    if (this.planeGroup) this.planeGroup.visible = this.visual.plane && this.visual.cut === 'none' && !!this.plane;
    this.labelEl.style.display = this.visual.labels ? '' : 'none';
    this._updateFaceMaterial();
    this._dirty = true;
  }

  /* ── построение геометрии ────────────────────────────────── */

  /** Какая половина остаётся: true — со стороны нормали плоскости */
  _keepPositive() {
    if (!this.plane) return true;
    const sign = this.upperSign ?? (this.plane.normal.y >= 0 ? 1 : -1);
    return this.visual.cut === 'top' ? sign > 0 : sign < 0;
  }

  _clipPlanes() {
    if (!this.plane || !this.visual.cut || this.visual.cut === 'none') return [];
    const n = this.plane.normal.clone();
    const c = this.plane.c;
    // three.js отбрасывает фрагменты с отрицательным расстоянием до плоскости:
    // Plane(n, -c) оставляет n·x ≥ c, а с перевёрнутой нормалью — другую половину
    return this._keepPositive() ? [new THREE.Plane(n, -c)] : [new THREE.Plane(n.negate(), c)];
  }

  _updateClipPlanes() {
    const planes = this._clipPlanes();
    this._planes = planes;
    [this.faceMat, this.edgeMat].forEach((m) => { if (m) m.clippingPlanes = planes; });
    if (this.faceMat) this.faceMat.needsUpdate = true;
    if (this.edgeMat) this.edgeMat.needsUpdate = true;
    this.handleGroup?.children.forEach((c) => {
      if (c.material) {
        c.material.clippingPlanes = planes;
        c.material.needsUpdate = true;
      }
    });
  }

  _updateFaceMaterial() {
    if (this.faceMat) {
      // на разрезе оставляем «тело» плотнее, чтобы половина читалась как предмет
      const cut = this.visual.cut !== 'none';
      this.faceMat.opacity = Math.min(0.6, this.visual.opacity + (cut ? 0.16 : 0));
      this.faceMat.color.setHex(this.palette.face);
    }
    if (this.edgeMat) this.edgeMat.color.setHex(this.palette.edge);
    this._updateClipPlanes();
  }

  _rebuildSolid(solid) {
    disposeGroup(this.solidGroup);
    const p = this.palette;
    const radius = solid.radius;

    // грани
    const positions = [];
    for (const face of solid.faces) {
      for (let i = 1; i < face.length - 1; i++) {
        const a = solid.vertices[face[0]];
        const b = solid.vertices[face[i]];
        const c = solid.vertices[face[i + 1]];
        positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
      }
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.computeVertexNormals();

    this.faceMat = new THREE.MeshStandardMaterial({
      color: p.face,
      transparent: true,
      opacity: this.visual.opacity,
      side: THREE.DoubleSide,
      depthWrite: false,
      roughness: 0.9,
      metalness: 0,
      flatShading: true,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
      clippingPlanes: this._planes || [],
    });
    const mesh = new THREE.Mesh(geom, this.faceMat);
    mesh.renderOrder = 2;
    this.solidGroup.add(mesh);

    // рёбра
    this.edgeMat = new THREE.MeshStandardMaterial({
      color: p.edge,
      roughness: 0.45,
      metalness: 0.05,
      clippingPlanes: this._planes || [],
    });
    const r = Math.max(0.008, radius * 0.0075);
    const up = new THREE.Vector3(0, 1, 0);
    for (const [ia, ib] of solid.edges) {
      const a = solid.vertices[ia];
      const b = solid.vertices[ib];
      const dir = tmpV.copy(b).sub(a);
      const len = dir.length();
      if (len < 1e-6) continue;
      const g = new THREE.CylinderGeometry(r, r, len, 8, 1, false);
      const m = new THREE.Mesh(g, this.edgeMat);
      m.position.copy(a).add(b).multiplyScalar(0.5);
      m.quaternion.setFromUnitVectors(up, dir.clone().normalize());
      m.renderOrder = 3;
      this.solidGroup.add(m);
    }
  }

  _rebuildSection(section) {
    disposeGroup(this.sectionGroup);
    if (!section || !section.points || section.points.length < 3) return;
    const p = this.palette;
    const pts = section.points;
    const normal = section.plane.normal.clone().normalize();
    const center = new THREE.Vector3();
    pts.forEach((p) => center.add(p));
    center.multiplyScalar(1 / pts.length);

    const helper = Math.abs(normal.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const u = new THREE.Vector3().crossVectors(normal, helper).normalize();
    const v = new THREE.Vector3().crossVectors(normal, u).normalize();
    const quat = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(u, v, normal));

    const cut = this.visual.cut !== 'none';

    // лёгкая заливка
    const pos = [];
    for (let i = 1; i < pts.length - 1; i++) {
      pos.push(pts[0].x, pts[0].y, pts[0].z, pts[i].x, pts[i].y, pts[i].z, pts[i + 1].x, pts[i + 1].y, pts[i + 1].z);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const mat = new THREE.MeshBasicMaterial({
      color: p.sectionFill,
      transparent: true,
      opacity: cut ? 0.24 : 0.09,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(g, mat);
    mesh.renderOrder = 1.4;
    this.sectionGroup.add(mesh);

    // штриховка «как в тетради»: диагональные линии внутри контура
    const pts2 = pts.map((pt) => new THREE.Vector2(
      pt.clone().sub(center).dot(u),
      pt.clone().sub(center).dot(v),
    ));
    const shape = new THREE.Shape(pts2);
    const hatchGeo = new THREE.ShapeGeometry(shape);
    const hatchMat = new THREE.MeshBasicMaterial({
      color: p.sectionFill,
      map: this._hatchTexture(),
      transparent: true,
      opacity: cut ? 0.7 : 0.42,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const hatch = new THREE.Mesh(hatchGeo, hatchMat);
    hatch.position.copy(center);
    hatch.quaternion.copy(quat);
    hatch.renderOrder = 1.45;
    this.sectionGroup.add(hatch);

    // контур
    const lineMat = new THREE.MeshBasicMaterial({ color: p.sectionLine, transparent: true, opacity: 0.95 });
    const radius = Math.max(0.011, (this.solid?.radius ?? 2) * (cut ? 0.011 : 0.009));
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const dir = new THREE.Vector3().subVectors(b, a);
      const len = dir.length();
      if (len < 1e-6) continue;
      const cyl = new THREE.CylinderGeometry(radius, radius, len, 8, 1, false);
      const m = new THREE.Mesh(cyl, lineMat);
      m.position.copy(a).add(b).multiplyScalar(0.5);
      m.quaternion.setFromUnitVectors(up, dir.normalize());
      m.renderOrder = 5;
      this.sectionGroup.add(m);
    }
  }

  _hatchTexture() {
    if (this._hatch) return this._hatch;
    const size = 64;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    g.clearRect(0, 0, size, size);
    g.strokeStyle = '#ffffff';
    g.lineWidth = 2.4;
    g.lineCap = 'square';
    for (let x = -size; x < size * 2; x += 32) {
      g.beginPath();
      g.moveTo(x, size);
      g.lineTo(x + size, 0);
      g.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1 / 0.46, 1 / 0.46);
    tex.anisotropy = 4;
    this._hatch = tex;
    return tex;
  }

  _rebuildPlane(plane) {
    disposeGroup(this.planeGroup);
    this.planeGroup.visible = this.visual.plane && this.visual.cut === 'none';
    if (!plane) return;
    const n = plane.normal.clone().normalize();
    const c = plane.c;
    const center = n.clone().multiplyScalar(c);
    const size = Math.max(2.6, (this.solid?.radius ?? 2) * 1.45);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);

    const geom = new THREE.PlaneGeometry(size, size);
    const mat = new THREE.MeshBasicMaterial({
      color: this.palette.plane,
      transparent: true,
      opacity: 0.055,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.copy(center);
    mesh.quaternion.copy(q);
    mesh.renderOrder = 1;
    this.planeGroup.add(mesh);
  }

  _rebuildPoints() {
    disposeGroup(this.pointGroup);
    for (const [key, pt] of Object.entries(this.points)) {
      if (!pt || !pt.pos) continue;
      const color = new THREE.Color(POINT_COLORS[key] ?? '#1B1C20');
      const r = Math.max(0.045, (this.solid?.radius ?? 2) * 0.028);

      const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(r, 18, 14),
        new THREE.MeshBasicMaterial({ color }),
      );
      sphere.position.copy(pt.pos);
      sphere.renderOrder = 8;
      this.pointGroup.add(sphere);

      const halo = new THREE.Mesh(
        new THREE.SphereGeometry(r * 1.85, 16, 12),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.16, depthWrite: false }),
      );
      halo.position.copy(pt.pos);
      halo.renderOrder = 7;
      this.pointGroup.add(halo);

      const pick = new THREE.Mesh(
        new THREE.SphereGeometry(r * 3.2, 10, 8),
        new THREE.MeshBasicMaterial({ visible: false }),
      );
      pick.position.copy(pt.pos);
      pick.userData = { kind: 'point', key };
      this.pointGroup.add(pick);
      (this._picks ||= []).push(pick);
    }
    this._collectPicks();
  }

  _rebuildHandles() {
    disposeGroup(this.handleGroup);
    if (!this.solid || this.solid.kind !== 'custom') return;
    const r = Math.max(0.038, this.solid.radius * 0.024);
    for (let i = 0; i < this.solid.vertices.length; i++) {
      const v = this.solid.vertices[i];
      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(r, 14, 10),
        new THREE.MeshBasicMaterial({ color: this.palette.handle, transparent: true, opacity: 0.9, clippingPlanes: this._planes || [] }),
      );
      dot.position.copy(v);
      dot.renderOrder = 6;
      this.handleGroup.add(dot);

      const pick = new THREE.Mesh(
        new THREE.SphereGeometry(r * 3.4, 10, 8),
        new THREE.MeshBasicMaterial({ visible: false }),
      );
      pick.position.copy(v);
      pick.userData = { kind: 'vertex', index: i };
      this.handleGroup.add(pick);
    }
    this._collectPicks();
  }

  _collectPicks() {
    this._picks = [];
    this.handleGroup.children.forEach((c) => { if (c.userData.kind === 'vertex') this._picks.push(c); });
    this.pointGroup.children.forEach((c) => { if (c.userData.kind === 'point') this._picks.push(c); });
  }

  setHandlesVisible(visible) {
    if (!this.solid) return;
    this.handleGroup.visible = visible && this.solid.kind === 'custom';
  }

  /* ── подписи ─────────────────────────────────────────────── */

  _initLabelsBase() {
    this.labelEl.innerHTML = '';
    this.labels = [];
  }

  _makeLabel(kind, text, extra = {}) {
    const el = document.createElement('div');
    el.className = `lbl lbl--${kind}`;
    if (kind === 'point' && extra.color) {
      el.style.background = extra.color;
      el.style.borderColor = extra.color;
    }
    el.textContent = text;
    this.labelEl.appendChild(el);
    return el;
  }

  _rebuildLabels() {
    this.labelEl.innerHTML = '';
    this.labels = [];
    if (!this.solid) return;
    if (this.solid.labels) {
      this.solid.labels.forEach((text, i) => {
        this.labels.push({
          el: this._makeLabel('vertex', text),
          kind: 'vertex',
          index: i,
          text,
        });
      });
    }
    for (const key of ['M', 'N', 'K']) {
      this.labels.push({
        el: this._makeLabel('point', key, { color: POINT_COLORS[key] }),
        kind: 'point',
        key,
        text: key,
      });
    }
    this.labelEl.style.display = this.visual.labels ? '' : 'none';
    this._labelSig = this._labelSignature();
  }

  _labelSignature() {
    const texts = (this.solid?.labels ?? []).concat(['M', 'N', 'K']);
    return texts.join('|');
  }

  /** Пересобирает подписи только если изменился состав вершин */
  _rebuildLabelsIfNeeded() {
    if (this._labelSig === this._labelSignature()) return;
    this._rebuildLabels();
  }

  _rebuildHelperLabels() { /* подписи осей создаются в _drawAxesLabels */ }

  /* ── камера ──────────────────────────────────────────────── */

  _updateCamera() {
    const sinPhi = Math.sin(this.phi);
    this.camera.position.set(
      this.target.x + this.dist * sinPhi * Math.sin(this.theta),
      this.target.y + this.dist * Math.cos(this.phi),
      this.target.z + this.dist * sinPhi * Math.cos(this.theta),
    );
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld(true);
  }

  orbit(dx, dy) {
    this._autorotate = false;
    this.theta -= dx * 0.006;
    this.phi = Math.min(Math.PI - 0.12, Math.max(0.12, this.phi - dy * 0.006));
    this._dirty = true;
  }

  pan(dx, dy) {
    this._autorotate = false;
    const k = this.dist * 0.0016;
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 1);
    this.target.addScaledVector(right, -dx * k).addScaledVector(up, dy * k);
    this._dirty = true;
  }

  zoom(factor) {
    this._autorotate = false;
    this._userZoomed = true;
    const min = Math.max(1.4, (this.solid?.radius ?? 2) * 1.05);
    const max = Math.max(14, (this.solid?.radius ?? 2) * 9);
    this.dist = Math.min(max, Math.max(min, this.dist * factor));
    this._dirty = true;
  }

  frame(solid = this.solid, animate = true) {
    if (!solid) return;
    const fov = (this.camera.fov * Math.PI) / 180;
    const vfov = this.camera.aspect < 1
      ? 2 * Math.atan(Math.tan(fov / 2) * this.camera.aspect)
      : fov;
    const dist = (solid.radius / Math.sin(Math.min(fov, vfov) / 2)) * 1.24;
    this._userZoomed = false;
    const target = solid.center.clone();
    target.y = solid.center.y * 0.92 + solid.radius * 0.06;
    if (!animate || this._reducedMotion) {
      this.dist = dist;
      this.target.copy(target);
      this._dirty = true;
      return;
    }
    this._tween = {
      t: 0,
      from: { dist: this.dist, target: this.target.clone() },
      to: { dist, target },
    };
    this._dirty = true;
  }

  cameraPreset(name) {
    this._autorotate = false;
    if (name === 'fit') { this.frame(); return; }
    const poses = {
      iso: { theta: 0.72, phi: 1.12 },
      front: { theta: 0, phi: Math.PI / 2 },
      top: { theta: 0, phi: 0.06 },
      side: { theta: Math.PI / 2, phi: Math.PI / 2 },
    };
    const pose = poses[name];
    if (!pose) return;
    const from = { theta: this.theta, phi: this.phi, dist: this.dist, target: this.target.clone() };
    const to = { ...pose, dist: this.dist, target: this.target.clone() };
    if (this._reducedMotion) {
      this.theta = to.theta; this.phi = to.phi; this._dirty = true; return;
    }
    this._tween = { t: 0, from, to, camera: true };
  }

  resize() {
    const w = this.stageEl.clientWidth;
    const h = this.stageEl.clientHeight;
    if (!w || !h) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    if (this.solid && !this._userZoomed) this.frame(this.solid, false);
    this._dirty = true;
  }

  /* ── взаимодействие ──────────────────────────────────────── */

  updatePointer(x, y) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this._pointer = new THREE.Vector2(
      ((x - rect.left) / rect.width) * 2 - 1,
      -((y - rect.top) / rect.height) * 2 + 1,
    );
  }

  pick(x, y) {
    if (!this._picks || !this._picks.length) return null;
    this.updatePointer(x, y);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(this._pointer, this.camera);
    const hits = ray.intersectObjects(this._picks, false);
    return hits.length ? { ...hits[0].object.userData, distance: hits[0].distance } : null;
  }

  /** Точка на луче в плоскости, проходящей через anchor перпендикулярно камере */
  rayToCameraPlane(x, y, anchor) {
    this.updatePointer(x, y);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(this._pointer, this.camera);
    const normal = new THREE.Vector3();
    this.camera.getWorldDirection(normal);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, anchor);
    const out = new THREE.Vector3();
    return ray.ray.intersectPlane(plane, out) ? out : null;
  }

  /** Пересечение луча с горизонтальной плоскостью y = level */
  rayToGround(x, y, level = 0) {
    this.updatePointer(x, y);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(this._pointer, this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -level);
    const out = new THREE.Vector3();
    return ray.ray.intersectPlane(plane, out) ? out : null;
  }

  /** Ближайшая точка на отрезке к заданной (в экранных координатах) */
  projectToScreen(v) {
    const p = v.clone().project(this.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    return {
      x: (p.x * 0.5 + 0.5) * rect.width,
      y: (-p.y * 0.5 + 0.5) * rect.height,
      visible: p.z < 1 && p.z > -1,
    };
  }

  /* ── цикл ────────────────────────────────────────────────── */

  markDirty() { this._dirty = true; }

  _loop() {
    requestAnimationFrame(this._loop);
    if (document.hidden) return;

    if (this._autorotate && !this._reducedMotion) {
      this.theta += 0.0022;
      this._dirty = true;
    }

    if (this._tween) {
      this._advanceTween();
      this._dirty = true;
    }

    if (!this._dirty) return;
    this._dirty = false;

    this._updateCamera();
    this._updateLabels();
    this._drawAxesLabels();
    this.renderer.render(this.scene, this.camera);
  }

  _advanceTween() {
    const tw = this._tween;
    tw.t = Math.min(1, tw.t + 0.045);
    const e = 1 - (1 - tw.t) ** 3;
    if (tw.camera) {
      this.theta = tw.from.theta + (tw.to.theta - tw.from.theta) * e;
      this.phi = tw.from.phi + (tw.to.phi - tw.from.phi) * e;
    } else {
      this.dist = tw.from.dist + (tw.to.dist - tw.from.dist) * e;
      this.target.lerpVectors(tw.from.target, tw.to.target, e);
    }
    if (tw.t >= 1) this._tween = null;
  }

  _updateLabels() {
    if (!this.solid) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    const centerScreen = this.projectToScreen(this.solid.center);
    this.labelScreens = [];

    for (const item of this.labels) {
      let world = null;
      let dx = 0;
      let dy = 0;

      if (item.kind === 'vertex') {
        world = this.solid.vertices[item.index];
        if (!world) { item.el.style.display = 'none'; continue; }
        if (this.visual.cut !== 'none' && this.plane) {
          const f = this.plane.normal.dot(world) - this.plane.c;
          const removed = this._keepPositive() ? f < -1e-6 : f > 1e-6;
          if (removed) { item.el.style.opacity = '0'; continue; }
        }
        const sp = this.projectToScreen(world);
        dx = sp.x - centerScreen.x;
        dy = sp.y - centerScreen.y;
        const len = Math.hypot(dx, dy) || 1;
        dx = (dx / len) * 15;
        dy = (dy / len) * 15;
      } else {
        const p = this.points[item.key];
        world = p?.pos;
        if (!world) { item.el.style.display = 'none'; continue; }
        dx = 13; dy = -13;
      }

      const sp = this.projectToScreen(world);
      const x = sp.x + dx;
      const y = sp.y + dy;
      const off = x < -40 || x > w + 40 || y < -30 || y > h + 30 || !sp.visible;
      item.el.style.opacity = off ? '0' : '1';
      if (!off) {
        item.el.style.transform = `translate3d(${x}px,${y}px,0) translate(-50%,-50%)`;
        this.labelScreens.push({ kind: item.kind, text: item.text, x, y, color: item.kind === 'point' ? POINT_COLORS[item.key] : null });
      }
    }
    this._labelSize = { w, h };
  }

  _drawAxesLabels() {
    // подписи осей — небольшие DOM-элементы, создаём один раз
    if (!this._axisLabelEls) {
      this._axisLabelEls = ['x', 'y', 'z'].map((t) => {
        const el = document.createElement('div');
        el.className = 'lbl lbl--axis';
        el.textContent = t;
        this.labelEl.appendChild(el);
        return el;
      });
    }
    const alive = this.visual.axes;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const dirs = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
    dirs.forEach((d, i) => {
      const el = this._axisLabelEls[i];
      if (!alive) { el.style.display = 'none'; return; }
      el.style.display = '';
      const p = this.projectToScreen(d.clone().multiplyScalar(3.35));
      el.style.transform = `translate3d(${p.x}px,${p.y}px,0) translate(-50%,-50%)`;
      el.style.opacity = p.visible ? '1' : '0';
    });
  }

  /* ── экспорт ─────────────────────────────────────────────── */

  exportPNG() {
    this._updateCamera();
    this._updateLabels();
    this.renderer.render(this.scene, this.camera);

    const src = this.renderer.domElement;
    const dpr = src.width / Math.max(1, src.getBoundingClientRect().width);
    const pad = Math.round(40 * dpr);
    const out = document.createElement('canvas');
    out.width = src.width + pad * 2;
    out.height = src.height + pad * 2;
    const ctx = out.getContext('2d');
    ctx.fillStyle = this.palette.paper;
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(src, pad, pad);

    ctx.save();
    ctx.translate(pad, pad);
    ctx.scale(dpr, dpr);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const item of this.labelScreens) {
      if (item.kind === 'vertex') {
        ctx.font = '700 12.5px Manrope, system-ui, sans-serif';
        ctx.lineWidth = 3.5;
        ctx.strokeStyle = this.palette.paper;
        ctx.strokeText(item.text, item.x, item.y);
        ctx.fillStyle = this.palette.labelInk;
        ctx.fillText(item.text, item.x, item.y);
      } else {
        ctx.beginPath();
        ctx.arc(item.x, item.y, 9, 0, Math.PI * 2);
        ctx.fillStyle = item.color || '#C14A32';
        ctx.fill();
        ctx.font = '700 11px Manrope, system-ui, sans-serif';
        ctx.fillStyle = '#fff';
        ctx.fillText(item.text, item.x, item.y + 0.5);
      }
    }
    ctx.restore();
    return out.toDataURL('image/png');
  }
}

/* ── утилиты ───────────────────────────────────────────────── */

function disposeObject(obj) {
  obj.traverse?.((child) => {
    child.geometry?.dispose?.();
    if (child.material) {
      if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose?.());
      else child.material.dispose?.();
    }
  });
}

function disposeGroup(group) {
  if (!group) return;
  while (group.children.length) {
    const child = group.children.pop();
    disposeObject(child);
  }
}
