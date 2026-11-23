import * as THREE from 'three';
import { Viewer } from './viewer.js';
import {
  boxSolid, prismSolid, pyramidSolid, tetraSolid, octaSolid,
  hullFromPoints, planeFromPoints, sectionOf, fmtNum, fmtFixed, formatPlane, pointName,
} from './solids.js';

/* ─────────────────────────────────────────────────────────────
   Приложение: состояние, взаимодействие, панели
   ───────────────────────────────────────────────────────────── */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const STORE_KEY = 'secheniya.v1';
const POINT_KEYS = ['M', 'N', 'K'];

const PRESETS = {
  cube: {
    title: 'Куб',
    params: [{ key: 'a', label: 'Ребро', min: 1.2, max: 3.6, step: 0.1, def: 2.4 }],
    build: (p) => boxSolid(p.a, p.a, p.a, 'Куб'),
  },
  box: {
    title: 'Параллелепипед',
    params: [
      { key: 'a', label: 'Ширина a', min: 1.2, max: 3.6, step: 0.1, def: 2.8 },
      { key: 'b', label: 'Глубина b', min: 1.2, max: 3.6, step: 0.1, def: 2.2 },
      { key: 'h', label: 'Высота h', min: 1.0, max: 3.6, step: 0.1, def: 2.4 },
    ],
    build: (p) => boxSolid(p.a, p.b, p.h, 'Параллелепипед'),
  },
  prism: {
    title: 'Правильная призма',
    params: [
      { key: 'n', label: 'Сторон в основании', type: 'seg', options: [3, 4, 6], def: 4 },
      { key: 'h', label: 'Высота', min: 1.2, max: 3.6, step: 0.1, def: 2.6 },
    ],
    build: (p) => prismSolid(p.n, p.h),
  },
  pyramid: {
    title: 'Правильная пирамида',
    params: [
      { key: 'n', label: 'Сторон в основании', type: 'seg', options: [3, 4, 6], def: 4 },
      { key: 'h', label: 'Высота', min: 1.4, max: 3.6, step: 0.1, def: 2.6 },
    ],
    build: (p) => pyramidSolid(p.n, p.h),
  },
  tetra: {
    title: 'Тетраэдр',
    params: [{ key: 'a', label: 'Ребро', min: 1.6, max: 3.4, step: 0.1, def: 2.3 }],
    build: (p) => tetraSolid(p.a),
  },
  octa: {
    title: 'Октаэдр',
    params: [{ key: 'r', label: 'Радиус', min: 1.2, max: 2.6, step: 0.1, def: 1.75 }],
    build: (p) => octaSolid(p.r),
  },
};

const TASKS = [
  {
    id: 'hex',
    title: 'Куб: правильный шестиугольник',
    desc: 'Плоскость через середины трёх рёбер. Стороны сечения равны — удобно считать площадь.',
    apply: () => {
      loadPreset('cube', { a: 2.4 });
      seatDefaultPoints();
      state.offset = 0;
    },
  },
  {
    id: 'tri',
    title: 'Куб: равносторонний треугольник',
    desc: 'Сечение проходит через вершины A, C и B₁. Покажите, почему треугольник равносторонний.',
    apply: () => {
      loadPreset('cube', { a: 2.6 });
      setPointAt('M', state.solid, { type: 'vertex', index: 0 });
      setPointAt('N', state.solid, { type: 'vertex', index: 2 });
      setPointAt('K', state.solid, { type: 'vertex', index: 5 });
      state.offset = 0;
    },
  },
  {
    id: 'pyr',
    title: 'Пирамида: сечение через рёбра',
    desc: 'Четырёхугольная пирамида, плоскость через середины боковых рёбер. Сравните с основанием.',
    apply: () => {
      loadPreset('pyramid', { n: 4, h: 2.8 });
      setPointAt('M', state.solid, { type: 'edge', a: 0, b: 4, t: 0.5 });
      setPointAt('N', state.solid, { type: 'edge', a: 1, b: 4, t: 0.5 });
      setPointAt('K', state.solid, { type: 'edge', a: 2, b: 4, t: 0.5 });
      state.offset = 0;
    },
  },
  {
    id: 'cut',
    title: 'Призма: разрез и семейство сечений',
    desc: 'Выберите половину «верхняя» и двигайте сдвиг плоскости: видно, как четырёхугольник превращается в треугольник.',
    apply: () => {
      loadPreset('prism', { n: 3, h: 2.8 });
      seatDefaultPoints();
      state.offset = 0;
      state.visual.cut = 'top';
      syncVisualUI();
    },
  },
];

/* ── состояние ─────────────────────────────────────────────── */

const state = {
  solidId: 'cube',
  params: Object.fromEntries(Object.entries(PRESETS).map(([id, p]) => [id, Object.fromEntries(p.params.map((q) => [q.key, q.def]))])),
  custom: { points: [], labels: [] },
  solid: null,
  points: {},
  plane: null,
  offset: 0,
  visual: { opacity: 0.16, labels: true, grid: true, axes: false, plane: true, cut: 'none', tails: true },
  theme: 'light',
  uiScale: 1,
  upperSign: 1,
  addMode: false,
  hintDismissed: false,
};

let viewer = null;
let drag = null;
let pinch = null;
const pointers = new Map();
let clickCandidate = null;

/* ── инициализация ─────────────────────────────────────────── */

function init() {
  initTheme();
  initUiScale();

  const stage = $('#stage');
  const canvasWrap = $('#canvasWrap');
  try {
    viewer = new Viewer(canvasWrap, $('#labels'));
  } catch (err) {
    console.error(err);
    showFatal('Не удалось включить WebGL. Попробуйте другой браузер или обновите страницу.');
    return;
  }

  const restored = restoreFromHash() || restoreFromStore();
  viewer.setUiScale(state.uiScale, { rebuild: false });
  if (!restored) {
    loadPreset('cube', { a: 2.4 });
    seatDefaultPoints();
  } else {
    applySaved(restored);
  }

  viewer.setTheme(state.theme);
  viewer.setVisual(state.visual);
  viewer.frame(state.solid, false);
  if (restored?.camera) {
    viewer.theta = restored.camera.theta;
    viewer.phi = restored.camera.phi;
    viewer.dist = restored.camera.dist;
    viewer.target.set(...restored.camera.target);
    viewer.markDirty();
  }

  renderPresetActive();
  renderParams();
  renderCustomList();
  syncVisualUI();
  bindUI();
  bindCanvas();
  refreshSection();
  updateHint();
  updateSolidName();
  setTab('solid', false);
  viewer.markDirty();
}

/* ── тела ──────────────────────────────────────────────────── */

function buildSolid() {
  if (state.solidId === 'custom') return buildCustomSolid();
  const preset = PRESETS[state.solidId];
  if (!preset) return null;
  const solid = preset.build(state.params[state.solidId]);
  solid.id = state.solidId;
  return solid;
}

function buildCustomSolid() {
  const { points, labels } = state.custom;
  if (points.length < 4) return { error: 'Нужно минимум четыре точки, не лежащие в одной плоскости.' };
  const uniq = [];
  const uniqLabels = [];
  points.forEach((p, i) => {
    if (!uniq.some((q) => q.distanceToSquared(p) < 1e-8)) {
      uniq.push(p);
      uniqLabels.push(labels[i] ?? pointName(i));
    }
  });
  const res = hullFromPoints(uniq, uniqLabels);
  if (res.error) return { error: res.error };
  res.id = 'custom';
  return res;
}

function applySolid(solid, { frame = false, reseat = false } = {}) {
  if (!solid || solid.error) {
    showNotice(solid?.error ?? 'Фигура не построена', 3200);
    return false;
  }
  state.solid = solid;
  viewer.setSolid(solid);
  if (reseat) seatDefaultPoints();
  if (frame) viewer.frame(solid, true);
  clampPointsToSolid();
  renderCustomList();
  updateSolidName();
  refreshSection();
  scheduleSave();
  return true;
}

function loadPreset(id, params, { frame = true, reseat = true } = {}) {
  state.solidId = id;
  if (params) Object.assign(state.params[id], params);
  state.offset = 0;
  renderPresetActive();
  renderParams();
  const solid = buildSolid();
  const ok = applySolid(solid, { frame, reseat });
  syncVisualUI();
  return ok;
}

function updateSolidName() {
  const name = state.solid?.title ?? 'Своя фигура';
  $('#solidName').textContent = state.solid ? name : 'Пусто — добавьте вершины';
  $('#solidNote').textContent = state.solidId === 'custom'
    ? 'Тяните вершины прямо в сцене — оболочка перестроится. Точки M, N, K задают плоскость сечения.'
    : 'Точки M, N и K задают плоскость сечения. Их можно тянуть по рёбрам.';
  const editBlock = $('#editShapeBlock');
  if (editBlock) editBlock.hidden = state.solidId === 'custom';
}

/* ── точки сечения ─────────────────────────────────────────── */

function pointPosition(solid, spec) {
  if (spec.type === 'vertex') return solid.vertices[spec.index]?.clone() ?? null;
  const a = solid.vertices[spec.a];
  const b = solid.vertices[spec.b];
  if (!a || !b) return null;
  return new THREE.Vector3().lerpVectors(a, b, spec.t ?? 0.5);
}

function setPointAt(key, solid, spec) {
  const pos = pointPosition(solid, spec);
  if (!pos) return;
  state.points[key] = { pos, snap: { ...spec } };
}

function defaultSpecs(solid) {
  if (solid.defaultPoints) return solid.defaultPoints;
  // для своей фигуры: середины трёх рёбер, дающие самое крупное сечение
  const edges = solid.edges;
  const mid = (e) => new THREE.Vector3().lerpVectors(solid.vertices[e[0]], solid.vertices[e[1]], 0.5);
  let best = null;
  let bestArea = 0;
  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      for (let k = j + 1; k < edges.length; k++) {
        const p1 = mid(edges[i]);
        const p2 = mid(edges[j]);
        const p3 = mid(edges[k]);
        const area = new THREE.Vector3().crossVectors(
          new THREE.Vector3().subVectors(p2, p1),
          new THREE.Vector3().subVectors(p3, p1),
        ).length();
        if (area > bestArea) {
          bestArea = area;
          best = [edges[i], edges[j], edges[k]];
        }
      }
    }
  }
  if (best && bestArea > 1e-4) {
    return best.map(([a, b]) => ({ type: 'edge', a, b, t: 0.5 }));
  }
  const n = solid.vertices.length;
  const v0 = 0;
  let v1 = 1;
  let far = -1;
  for (let i = 1; i < n; i++) {
    const d = solid.vertices[i].distanceToSquared(solid.vertices[v0]);
    if (d > far) { far = d; v1 = i; }
  }
  let v2 = (v1 + 1) % n;
  far = -1;
  const dir = new THREE.Vector3().subVectors(solid.vertices[v1], solid.vertices[v0]);
  for (let i = 0; i < n; i++) {
    if (i === v0 || i === v1) continue;
    const d = new THREE.Vector3().crossVectors(dir, new THREE.Vector3().subVectors(solid.vertices[i], solid.vertices[v0])).lengthSq();
    if (d > far) { far = d; v2 = i; }
  }
  return [{ type: 'vertex', index: v0 }, { type: 'vertex', index: v1 }, { type: 'vertex', index: v2 }];
}

function seatDefaultPoints() {
  if (!state.solid) return;
  const specs = defaultSpecs(state.solid);
  POINT_KEYS.forEach((key, i) => {
    const spec = specs[i] ?? specs[0];
    const normalized = (spec.type === 'vertex' || spec.vertex !== undefined)
      ? { type: 'vertex', index: spec.index ?? spec.vertex }
      : { type: 'edge', a: spec.a, b: spec.b, t: spec.t ?? 0.5 };
    setPointAt(key, state.solid, normalized);
  });
  viewer.setPoints(state.points);
  updatePointInputs();
  scheduleSave();
}

function clampPointsToSolid() {
  for (const key of POINT_KEYS) {
    const pt = state.points[key];
    if (!pt) continue;
    if (pt.snap?.type === 'vertex') {
      const v = state.solid.vertices[pt.snap.index];
      if (v) pt.pos = v.clone();
      else pt.snap = null;
    } else if (pt.snap?.type === 'edge') {
      const { a, b, t } = pt.snap;
      const va = state.solid.vertices[a];
      const vb = state.solid.vertices[b];
      if (va && vb) {
        pt.pos = new THREE.Vector3().lerpVectors(va, vb, t);
      } else {
        pt.snap = null;
      }
    }
  }
  viewer.setPoints(state.points);
  updatePointInputs();
}

/* ── сечение ───────────────────────────────────────────────── */

function refreshSection() {
  const warn = $('#secWarning');
  const eqBlock = $('#equationBlock');
  const readout = $('#readout');

  if (!state.solid) {
    state.plane = null;
    viewer.setSection(null);
    viewer.setPlane(null);
    $('#secType').textContent = 'Нет фигуры';
    $('#secSides').textContent = '0';
    $('#secArea').textContent = '0,00';
    $('#secPerimeter').textContent = '0,00';
    $('#secEquation').textContent = '—';
    readout.hidden = true;
    warn.hidden = false;
    warn.innerHTML = '<strong>Сначала вершины.</strong> Добавьте минимум четыре точки, не лежащие в одной плоскости, — и появится тело и сечение.';
    eqBlock.style.opacity = '0.55';
    return;
  }

  const pm = state.points.M?.pos;
  const pn = state.points.N?.pos;
  const pk = state.points.K?.pos;
  const plane = pm && pn && pk ? planeFromPoints(pm, pn, pk) : null;

  if (!plane) {
    state.plane = null;
    viewer.setSection(null);
    viewer.setPlane(null);
    $('#secType').textContent = '—';
    $('#secSides').textContent = '0';
    $('#secArea').textContent = '0';
    $('#secPerimeter').textContent = '0';
    $('#secEquation').textContent = '—';
    readout.hidden = true;
    warn.hidden = false;
    warn.innerHTML = '<strong>Плоскость не задана.</strong> Точки M, N и K лежат на одной прямой — сдвиньте любую точку.';
    eqBlock.style.opacity = '0.55';
    return;
  }

  state.plane = plane;
  state.upperSign = computeUpperSign(state.solid, plane);
  viewer.upperSign = state.upperSign;
  const shifted = { ...plane, offset: state.offset };
  const section = sectionOf(state.solid, plane, state.offset);
  viewer.setSection(section);
  viewer.setPlane(shifted);

  $('#secEquation').textContent = formatPlane({ normal: plane.normal, c: plane.c + state.offset });
  eqBlock.style.opacity = '1';

  if (!section) {
    $('#secType').textContent = 'Нет сечения';
    $('#secSides').textContent = '0';
    $('#secArea').textContent = '0';
    $('#secPerimeter').textContent = '0';
    readout.hidden = true;
    warn.hidden = false;
    warn.innerHTML = '<strong>Плоскость не пересекает тело.</strong> Сдвиньте точки ближе к фигуре или ослабьте сдвиг плоскости.';
    return;
  }

  warn.hidden = true;
  $('#secType').textContent = section.name;
  $('#secSides').textContent = String(section.sides);
  $('#secArea').textContent = fmtFixed(section.area, 2);
  $('#secPerimeter').textContent = fmtFixed(section.perimeter, 2);
  $('#readoutType').textContent = section.name;
  $('#readoutArea').textContent = `S = ${fmtFixed(section.area, 2)}`;
  readout.hidden = false;
  scheduleSave();
}

/**
 * Какая сторона плоскости считается «верхней»: та, где оказалась большая
 * часть самых высоких вершин. Для горизонтального разреза это буквально
 * верхняя половина, для наклонного — та, что визуально выше.
 */
function computeUpperSign(solid, plane) {
  const n = plane.normal;
  const c = plane.c;
  let maxY = -Infinity;
  for (const v of solid.vertices) maxY = Math.max(maxY, v.y);
  let pos = 0;
  let neg = 0;
  for (const v of solid.vertices) {
    if (v.y < maxY - 1e-6) continue;
    const f = n.dot(v) - c;
    if (f > 1e-6) pos++;
    else if (f < -1e-6) neg++;
  }
  if (pos !== neg) return pos > neg ? 1 : -1;
  return n.y >= 0 ? 1 : -1;
}

/* ── интерфейс: вкладки ────────────────────────────────────── */

function setTab(name, open = true) {
  $$('.rail__btn').forEach((b) => {
    const on = b.dataset.tab === name;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-selected', String(on));
  });
  $$('[data-panel]').forEach((sec) => {
    sec.classList.toggle('is-active', sec.dataset.panel === name);
    sec.hidden = sec.dataset.panel !== name;
  });
  const titles = { solid: 'Фигура', points: 'Точки сечения', section: 'Сечение', view: 'Вид', tasks: 'Задачи' };
  $('#panelTitle').textContent = titles[name] ?? '';
  if (open && isMobile()) {
    $('#panel').classList.add('is-open');
    document.body.classList.add('sheet-open');
  }
}

const isMobile = () => window.matchMedia('(max-width: 760px)').matches;
const closeSheet = () => {
  if (isMobile()) {
    $('#panel').classList.remove('is-open');
    document.body.classList.remove('sheet-open');
  }
};

/* ── параметры пресетов ────────────────────────────────────── */

function renderParams() {
  const preset = PRESETS[state.solidId];
  const block = $('#paramsBlock');
  const host = $('#params');
  host.innerHTML = '';
  block.hidden = !preset || state.solidId === 'custom';

  const builder = $('#builder');
  builder.hidden = state.solidId !== 'custom';

  if (!preset) return;

  for (const p of preset.params) {
    const wrap = document.createElement('div');
    wrap.className = 'field';
    const head = document.createElement('div');
    head.className = 'field__head';
    const label = document.createElement('h3');
    label.className = 'label';
    label.textContent = p.label;
    head.appendChild(label);

    if (p.type === 'seg') {
      const val = state.params[state.solidId][p.key];
      const seg = document.createElement('div');
      seg.className = 'seg';
      seg.setAttribute('role', 'group');
      for (const opt of p.options) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'seg__btn' + (val === opt ? ' is-active' : '');
        btn.textContent = String(opt);
        btn.addEventListener('click', () => {
          if (state.params[state.solidId][p.key] === opt) return;
          state.params[state.solidId][p.key] = opt;
          $$('.seg__btn', seg).forEach((b) => b.classList.toggle('is-active', b === btn));
          const solid = buildSolid();
          applySolid(solid, { frame: false, reseat: true });
        });
        seg.appendChild(btn);
      }
      wrap.append(head, seg);
    } else {
      const out = document.createElement('output');
      out.className = 'field__value';
      out.textContent = fmtNum(state.params[state.solidId][p.key], 2);
      head.appendChild(out);

      const input = document.createElement('input');
      input.type = 'range';
      input.min = p.min;
      input.max = p.max;
      input.step = p.step;
      input.value = state.params[state.solidId][p.key];
      input.setAttribute('aria-label', p.label);
      input.addEventListener('input', () => {
        const v = Number(input.value);
        state.params[state.solidId][p.key] = v;
        out.textContent = fmtNum(v, 2);
        const solid = buildSolid();
        applySolid(solid, { frame: true });
      });
      wrap.append(head, input);
    }
    host.appendChild(wrap);
  }
}

function renderPresetActive() {
  $$('.preset').forEach((b) => b.classList.toggle('is-active', b.dataset.preset === state.solidId));
}

/* ── своя фигура: список точек ─────────────────────────────── */

function renderCustomList() {
  const host = $('#customList');
  if (state.solidId !== 'custom') { host.innerHTML = ''; return; }
  host.innerHTML = '';
  state.custom.points.forEach((p, i) => {
    const row = document.createElement('div');
    row.className = 'point-row';

    const name = document.createElement('span');
    name.className = 'point-row__name';
    name.textContent = state.custom.labels[i] ?? pointName(i);

    row.appendChild(name);
    ['x', 'y', 'z'].forEach((axis) => {
      const lab = document.createElement('label');
      lab.className = 'num';
      const span = document.createElement('span');
      span.textContent = axis;
      const input = document.createElement('input');
      input.type = 'text';
      input.inputMode = 'decimal';
      input.value = fmtInput(p[axis]);
      input.setAttribute('aria-label', `${state.custom.labels[i] ?? pointName(i)}: ${axis}`);
      input.addEventListener('focus', () => input.select());
      input.addEventListener('input', () => {
        const v = parseNum(input.value);
        if (!Number.isFinite(v)) return;
        p[axis] = v;
        rebuildCustomFromEdit();
      });
      input.addEventListener('blur', () => { input.value = fmtInput(p[axis]); });
      lab.append(span, input);
      row.appendChild(lab);
    });

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'point-row__del';
    del.setAttribute('aria-label', `Удалить ${state.custom.labels[i] ?? pointName(i)}`);
    del.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    del.addEventListener('click', () => {
      state.custom.points.splice(i, 1);
      state.custom.labels.splice(i, 1);
      if (rebuildCustomFromEdit()) renderCustomList();
    });
    row.appendChild(del);
    host.appendChild(row);
  });
}

function trimNum(v) {
  return String(Math.round(v * 100) / 100);
}

/** «1,5» → 1.5 ; пустое и мусор → NaN */
function parseNum(value) {
  const s = String(value).replace(/\s+/g, '').replace(',', '.').replace('−', '-');
  if (!s) return NaN;
  const v = Number(s);
  return Number.isFinite(v) ? v : NaN;
}

/** число для поля ввода: запятая, без лишних нулей */
function fmtInput(v) {
  return String(Math.round(v * 100) / 100).replace('.', ',');
}

function rebuildCustomFromEdit() {
  const solid = buildCustomSolid();
  if (!solid || solid.error) {
    showNotice(solid?.error ?? 'Не получается построить фигуру', 2600);
    return false;
  }
  state.solid = solid;
  viewer.setSolid(solid);
  clampPointsToSolid();
  refreshSection();
  updateSolidName();
  updateCustomInputs();
  scheduleSave();
  return true;
}

/* ── визуальные переключатели ──────────────────────────────── */

function syncVisualUI() {
  $('#opacity').value = Math.round(state.visual.opacity * 100);
  $('#opacityVal').textContent = `${Math.round(state.visual.opacity * 100)} %`;
  $('#toggleLabels').checked = state.visual.labels;
  $('#toggleGrid').checked = state.visual.grid;
  $('#toggleAxes').checked = state.visual.axes;
  $('#togglePlane').checked = state.visual.plane;
  $('#togglePlane').disabled = state.visual.cut !== 'none';
  $('#planeRow').classList.toggle('is-disabled', state.visual.cut !== 'none');
  $('#toggleTails').checked = state.visual.tails;
  $$('[data-cut]').forEach((b) => {
    const on = b.dataset.cut === state.visual.cut;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-pressed', String(on));
  });
  $('#cutHint').textContent = state.visual.cut === 'none'
    ? 'Выберите половину — вторая исчезнет вместе с подписями, а срез останется закрашенным.'
    : state.visual.cut === 'top'
      ? 'Показана только верхняя часть. Вторая половина и её вершины скрыты.'
      : 'Показана только нижняя часть. Вторая половина и её вершины скрыты.';
  $('#offset').value = state.offset;
  $('#offsetVal').textContent = fmtFixed(state.offset, 2);
  $$('[data-theme-btn]').forEach((b) => b.classList.toggle('is-active', b.dataset.themeBtn === state.theme));
}

function applyVisual(patch, { rebuildSection = false } = {}) {
  Object.assign(state.visual, patch);
  viewer.setVisual(patch);
  if (rebuildSection) refreshSection();
  syncVisualUI();
  scheduleSave();
}

/* ── размер интерфейса ─────────────────────────────────────── */

const UI_KEY = 'secheniya.ui';
const UI_STEPS = [1, 1.25, 1.5];

function defaultUiScale() {
  if (window.innerWidth >= 3300) return 1.5;
  if (window.innerWidth >= 2300) return 1.25;
  return 1;
}

function readUiScale() {
  const saved = parseFloat(safeGet(UI_KEY) ?? '');
  return UI_STEPS.includes(saved) ? saved : defaultUiScale();
}

function applyUiScale(scale, { save = true } = {}) {
  const next = UI_STEPS.includes(scale) ? scale : 1;
  state.uiScale = next;
  document.documentElement.dataset.ui = String(next);
  if (save) safeSet(UI_KEY, String(next));
  $$('[data-ui-btn]').forEach((b) => b.classList.toggle('is-active', Number(b.dataset.uiBtn) === next));
  viewer?.setUiScale?.(next);
}

function initUiScale() {
  applyUiScale(readUiScale(), { save: false });
}

/* ── тема ──────────────────────────────────────────────────── */

function initTheme() {
  const saved = safeGet('secheniya.theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  setTheme(saved || (prefersDark ? 'dark' : 'light'), false);
}

function setTheme(theme, save = true) {
  state.theme = theme;
  document.documentElement.dataset.theme = theme;
  $('#metaTheme')?.setAttribute('content', theme === 'dark' ? '#12141A' : '#F5F1E8');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#12141A' : '#F5F1E8');
  if (save) safeSet('secheniya.theme', theme);
  if (viewer) viewer.setTheme(theme);
  syncVisualUI();
}

/* ── взаимодействие со сценой ──────────────────────────────── */

function canvasRect() {
  return viewer.renderer.domElement.getBoundingClientRect();
}

function bindCanvas() {
  const el = viewer.renderer.domElement;

  el.addEventListener('contextmenu', (e) => e.preventDefault());

  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1 && e.button !== 2) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    el.setPointerCapture?.(e.pointerId);
    clickCandidate = { x: e.clientX, y: e.clientY };

    if (pointers.size === 2) {
      startPinch();
      return;
    }

    const pan = e.button === 1 || e.button === 2 || e.shiftKey;
    if (pan) {
      drag = { type: 'pan', x: e.clientX, y: e.clientY };
      el.style.cursor = 'grabbing';
      return;
    }

    const hit = viewer.pick(e.clientX, e.clientY);
    if (hit?.kind === 'point') {
      const pt = state.points[hit.key];
      drag = {
        type: 'point',
        key: hit.key,
        anchor: pt.pos.clone(),
        moved: 0,
      };
      viewer._autorotate = false;
      markDraggedCard(hit.key, true);
      el.style.cursor = 'grabbing';
      return;
    }
    if (hit?.kind === 'vertex') {
      drag = {
        type: 'vertex',
        index: hit.index,
        anchor: state.solid.vertices[hit.index].clone(),
        moved: 0,
      };
      viewer._autorotate = false;
      el.style.cursor = 'grabbing';
      return;
    }

    drag = { type: 'orbit', x: e.clientX, y: e.clientY };
    viewer._autorotate = false;
    el.style.cursor = 'grabbing';
  });

  el.addEventListener('pointermove', (e) => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pinch) { updatePinch(); return; }

    if (!drag) {
      // курсор-подсказка при наведении
      const hit = viewer.pick(e.clientX, e.clientY);
      el.style.cursor = hit ? 'grab' : 'grab';
      return;
    }

    if (clickCandidate) {
      drag.moved = (drag.moved ?? 0) + Math.abs(e.clientX - clickCandidate.x) + Math.abs(e.clientY - clickCandidate.y);
    }

    if (drag.type === 'orbit') {
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      drag.x = e.clientX;
      drag.y = e.clientY;
      viewer.orbit(dx, dy);
      return;
    }

    if (drag.type === 'pan') {
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      drag.x = e.clientX;
      drag.y = e.clientY;
      viewer.pan(dx, dy);
      return;
    }

    if (drag.type === 'point') {
      movePoint(drag, e);
      return;
    }

    if (drag.type === 'vertex') {
      moveVertex(drag, e);
    }
  });

  const finish = (e) => {
    pointers.delete(e.pointerId);
    if (pinch && pointers.size < 2) pinch = null;

    if (drag?.type === 'point') {
      markDraggedCard(drag.key, false);
      updatePointInputs();
      scheduleSave();
    }
    if (drag?.type === 'vertex') {
      renderCustomList();
      scheduleSave();
    }

    // клик без движения: в режиме добавления или на пустой сцене — поставить точку
    if ((state.addMode || !state.solid) && clickCandidate && (drag?.moved ?? 0) < 6 && drag?.type !== 'point' && drag?.type !== 'vertex') {
      addPointAtPointer(e);
    }

    drag = null;
    clickCandidate = null;
    el.style.cursor = 'grab';
    viewer.markDirty();
  };

  el.addEventListener('pointerup', finish);
  el.addEventListener('pointercancel', finish);
  el.addEventListener('pointerleave', (e) => { if (drag?.type === 'orbit') { /* ничего */ } });

  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    viewer.zoom(Math.exp(e.deltaY * 0.0012));
  }, { passive: false });

  el.addEventListener('dblclick', () => viewer.frame(state.solid, true));
}

function startPinch() {
  const [a, b] = [...pointers.values()];
  const dist = Math.hypot(a.x - b.x, a.y - b.y);
  pinch = { dist, camDist: viewer.dist };
  if (drag?.type === 'point') markDraggedCard(drag.key, false);
  drag = null;
}

function updatePinch() {
  const [a, b] = [...pointers.values()];
  if (!a || !b || !pinch) return;
  const dist = Math.hypot(a.x - b.x, a.y - b.y);
  if (dist < 4) return;
  const want = (pinch.camDist * pinch.dist) / dist;
  const min = Math.max(1.4, (state.solid?.radius ?? 2) * 1.05);
  const max = Math.max(14, (state.solid?.radius ?? 2) * 9);
  viewer.dist = Math.min(max, Math.max(min, want));
  viewer._autorotate = false;
  viewer._userZoomed = true;
  viewer.markDirty();
}

function markDraggedCard(key, on) {
  $$('.pt-card').forEach((c) => c.classList.toggle('is-dragged', on && c.dataset.key === key));
}

/* ── перетаскивание точки сечения ──────────────────────────── */

function movePoint(dragState, e) {
  const { x, y } = e;
  const rect = canvasRect();
  const px = x - rect.left;
  const py = y - rect.top;

  const candidate = screenSnap(px, py, 20);
  if (candidate) {
    setPointAt(dragState.key, state.solid, candidate);
  } else {
    const free = viewer.rayToCameraPlane(x, y, dragState.anchor);
    if (!free) return;
    state.points[dragState.key] = { pos: free, snap: null };
  }

  viewer.setPoints(state.points);
  refreshSection();
  updatePointInputs(true);
}

/** Ближайшее ребро/вершина в экранных координатах */
function screenSnap(px, py, threshold = 18) {
  if (!state.solid) return null;
  const solid = state.solid;
  let bestVertex = null;
  let bestVertexDist = 16;

  for (let i = 0; i < solid.vertices.length; i++) {
    const sp = viewer.projectToScreen(solid.vertices[i]);
    if (!sp.visible) continue;
    const d = Math.hypot(sp.x - px, sp.y - py);
    if (d < bestVertexDist) { bestVertexDist = d; bestVertex = i; }
  }
  if (bestVertex !== null) return { type: 'vertex', index: bestVertex };

  let best = null;
  for (const [a, b] of solid.edges) {
    const sa = viewer.projectToScreen(solid.vertices[a]);
    const sb = viewer.projectToScreen(solid.vertices[b]);
    if (!sa.visible || !sb.visible) continue;
    const dx = sb.x - sa.x;
    const dy = sb.y - sa.y;
    const len2 = dx * dx + dy * dy;
    if (len2 < 1) continue;
    let t = ((px - sa.x) * dx + (py - sa.y) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const cx = sa.x + dx * t;
    const cy = sa.y + dy * t;
    const d = Math.hypot(px - cx, py - cy);
    if (d < threshold && (!best || d < best.dist)) {
      best = { type: 'edge', a, b, t, dist: d };
    }
  }
  if (best) {
    const { type, a, b, t } = best;
    return { type, a, b, t };
  }
  return null;
}

function moveVertex(dragState, e) {
  const free = viewer.rayToCameraPlane(e.clientX, e.clientY, dragState.anchor);
  if (!free) return;
  if (e.shiftKey) {
    free.x = Math.round(free.x * 2) / 2;
    free.y = Math.round(free.y * 2) / 2;
    free.z = Math.round(free.z * 2) / 2;
  }
  state.custom.points[dragState.index]?.copy(free);
  const solid = buildCustomSolid();
  if (solid?.error) return;
  state.solid = solid;
  viewer.setSolid(solid);
  clampPointsToSolid();
  refreshSection();
  updateCustomInputs();
}

function updateCustomInputs() {
  const rows = $$('#customList .point-row');
  rows.forEach((row, i) => {
    const p = state.custom.points[i];
    if (!p) return;
    $$('input', row).forEach((input, axis) => {
      if (document.activeElement === input) return;
      input.value = trimNum(p['xyz'[axis]]);
    });
  });
}

/* ── добавление/удаление вершин ────────────────────────────── */

function addPointAtPointer(e) {
  const ground = viewer.rayToGround(e.clientX, e.clientY, 0);
  if (!ground) return;
  ground.x = Math.round(ground.x * 10) / 10;
  ground.z = Math.round(ground.z * 10) / 10;
  ground.y = 0;

  // если все точки пока лежат на полу, четвёртую поднимаем — иначе тело не построить
  const pts = state.custom.points;
  const flat = pts.length >= 3 && pts.every((p) => Math.abs(p.y - pts[0].y) < 1e-6);
  if (flat) {
    ground.y = 1.6;
    showNotice('Точка поднята на высоту 1,6 — высоту можно изменить в списке', 3200);
  }

  if (state.solidId !== 'custom') {
    convertToCustom();
  }
  state.custom.points.push(ground);
  state.custom.labels.push(pointName(state.custom.points.length - 1));
  const solid = buildCustomSolid();

  if (!solid || solid.error) {
    // тела ещё нет — показываем поставленные точки, продолжаем набор
    state.solid = null;
    state.points = {};
    viewer.clearSolid();
    viewer.setLoosePoints(state.custom.points);
    viewer.setPoints({});
    renderCustomList();
    updateSolidName();
    refreshSection();
    scheduleSave();
    const n = state.custom.points.length;
    showNotice(n < 4 ? `Точек: ${n}. Нужно ещё ${4 - n}.` : (solid?.error ?? 'Оболочка не построилась'), 2800);
    return;
  }

  const hadPoints = POINT_KEYS.every((k) => state.points[k]);
  applySolid(solid, { frame: true, reseat: !hadPoints });
  renderCustomList();
  setAddMode(false);
  showNotice(`Точка ${state.custom.labels.at(-1)} добавлена — тяните её в сцене`, 2600);
}

function clearCustom() {
  state.custom.points = [];
  state.custom.labels = [];
  state.solid = null;
  state.points = {};
  viewer.clearSolid();
  viewer.setLoosePoints([]);
  renderCustomList();
  updateSolidName();
  updatePointInputs();
  refreshSection();
  setAddMode(true);
  scheduleSave();
  showNotice('Кликайте по сетке — каждая точка станет вершиной', 2600);
}

function convertToCustom() {
  if (!state.solid) return;
  state.custom.points = state.solid.vertices.map((v) => v.clone());
  state.custom.labels = [...state.solid.labels];
  state.solidId = 'custom';
  const solid = buildCustomSolid();
  applySolid(solid, { frame: false });
  renderPresetActive();
  renderParams();
  renderCustomList();
  updateSolidName();
  updateHint();
}

function setAddMode(on) {
  state.addMode = on;
  $('#btnAddPoint')?.classList.toggle('is-active', on);
  if (viewer) viewer.renderer.domElement.style.cursor = on ? 'crosshair' : 'grab';
  updateHint();
  if (on) showNotice('Кликните по сетке — там появится вершина. Esc — отмена', 2600);
}

/* ── подписи точек ─────────────────────────────────────────── */

function updatePointInputs(skipFocused = true) {
  for (const card of $$('.pt-card')) {
    const key = card.dataset.key;
    const pt = state.points[key];
    const stateEl = $('[data-state]', card);
    if (!pt) {
      if (stateEl) stateEl.textContent = 'не задана';
      $$('input[data-axis]', card).forEach((input) => {
        if (skipFocused && document.activeElement === input) return;
        input.value = '';
      });
      continue;
    }
    if (stateEl) {
      if (pt.snap?.type === 'edge') {
        const a = state.solid?.labels?.[pt.snap.a] ?? '?';
        const b = state.solid?.labels?.[pt.snap.b] ?? '?';
        stateEl.textContent = `на ребре ${a}${b}`;
      } else if (pt.snap?.type === 'vertex') {
        stateEl.textContent = `в вершине ${state.solid?.labels?.[pt.snap.index] ?? '?'}`;
      } else {
        stateEl.textContent = 'свободная';
      }
    }
    $$('input[data-axis]', card).forEach((input) => {
      if (skipFocused && document.activeElement === input) return;
      const axis = input.dataset.axis;
      const v = pt.pos[axis];
      input.value = fmtInput(v);
    });
  }
}

/* ── подсказка внизу сцены ─────────────────────────────────── */

function updateHint() {
  const hint = $('#hint');
  const text = $('#hintText');
  if (state.hintDismissed) { hint.classList.add('is-hidden'); return; }
  hint.classList.remove('is-hidden');
  if (state.addMode) {
    text.textContent = 'Кликните по сетке — добавится вершина. Esc — отмена';
  } else if (!state.solid) {
    text.textContent = 'Добавьте четыре точки на сетке — соберётся объёмная фигура';
  } else if (state.solidId === 'custom') {
    text.textContent = 'Тяните вершины фигуры — форма и сечение перестроятся';
  } else {
    text.textContent = 'Тяните точку M, N или K — сечение перестроится';
  }
}

/* ── действия: экспорт, сохранение, ссылка ─────────────────── */

function download(dataUrl, filename) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function exportPNG() {
  try {
    const solidName = (state.solid?.title ?? 'figure').toLowerCase().replace(/\s+/g, '-');
    const url = viewer.exportPNG();
    download(url, `sechenie-${solidName}.png`);
    toast('Картинка сохранена');
  } catch (err) {
    console.error(err);
    toast('Не удалось сохранить картинку');
  }
}

function serialize() {
  return {
    v: 1,
    solidId: state.solidId,
    params: state.params,
    custom: {
      points: state.custom.points.map((p) => [round3(p.x), round3(p.y), round3(p.z)]),
      labels: state.custom.labels,
    },
    points: Object.fromEntries(POINT_KEYS.map((k) => [k, state.points[k] ? {
      p: [round3(state.points[k].pos.x), round3(state.points[k].pos.y), round3(state.points[k].pos.z)],
      snap: state.points[k].snap,
    } : null])),
    offset: state.offset,
    visual: state.visual,
    camera: {
      theta: round3(viewer.theta),
      phi: round3(viewer.phi),
      dist: round3(viewer.dist),
      target: [round3(viewer.target.x), round3(viewer.target.y), round3(viewer.target.z)],
    },
  };
}

const round3 = (v) => Math.round(v * 1000) / 1000;

function applySaved(data) {
  if (!data || typeof data !== 'object') return false;
  try {
    if (data.params) {
      for (const [id, params] of Object.entries(data.params)) {
        if (state.params[id]) Object.assign(state.params[id], params);
      }
    }
    if (data.visual) {
      Object.assign(state.visual, data.visual);
      // совместимость со старым форматом «разрез + другая половина»
      if (state.visual.clip !== undefined) {
        state.visual.cut = state.visual.clip ? (state.visual.clipSide ? 'bottom' : 'top') : 'none';
        delete state.visual.clip;
        delete state.visual.clipSide;
      }
      if (!['none', 'top', 'bottom'].includes(state.visual.cut)) state.visual.cut = 'none';
    }
    if (typeof data.offset === 'number') state.offset = data.offset;
    if (data.custom?.points?.length) {
      state.custom.points = data.custom.points.map((p) => new THREE.Vector3(...p));
      state.custom.labels = data.custom.labels ?? state.custom.points.map((_, i) => pointName(i));
    }
    state.solidId = data.solidId ?? 'cube';
    const solid = buildSolid();
    if (state.solidId === 'custom' && (!solid || solid.error)) {
      // «своя фигура» без вершин — пустая сцена, но список точек сохраняем
      state.solid = null;
      state.points = {};
      viewer?.clearSolid?.();
      viewer?.setLoosePoints?.(state.custom.points);
    } else if (!solid || solid.error) {
      state.solidId = 'cube';
      applySolid(buildSolid(), { frame: false });
    } else {
      state.solid = solid;
      viewer?.setSolid?.(solid);
    }

    if (data.points && state.solid) {
      for (const k of POINT_KEYS) {
        const src = data.points[k];
        if (!src) continue;
        state.points[k] = { pos: new THREE.Vector3(...src.p), snap: src.snap ?? null };
      }
    }
    viewer?.setPoints?.(state.points);
    if (state.solid && !POINT_KEYS.every((k) => state.points[k])) seatDefaultPoints();
    updatePointInputs();
    updateSolidName();
    renderPresetActive();
    renderParams();
    renderCustomList();
    syncVisualUI();
    return true;
  } catch (err) {
    console.error('restore failed', err);
    return false;
  }
}

function saveJSON() {
  const blob = new Blob([JSON.stringify(serialize(), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  download(url, 'sechenie.json');
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast('Проект сохранён');
}

function loadJSON(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(String(reader.result));
      if (!applySaved(data)) throw new Error('bad data');
      viewer.setTheme(state.theme);
      viewer.setVisual(state.visual);
      viewer.frame(state.solid, false);
      if (data.camera) {
        viewer.theta = data.camera.theta;
        viewer.phi = data.camera.phi;
        viewer.dist = data.camera.dist;
        viewer.target.set(...data.camera.target);
      }
      refreshSection();
      updatePointInputs();
      viewer.markDirty();
      toast('Проект открыт');
    } catch (err) {
      console.error(err);
      toast('Не удалось открыть файл');
    }
  };
  reader.readAsText(file);
}

function buildShareLink() {
  const json = JSON.stringify(serialize());
  const b64 = btoa(unescape(encodeURIComponent(json))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const base = location.href.split('#')[0];
  return `${base}#s=${b64}`;
}

async function shareLink() {
  const url = buildShareLink();
  try { history.replaceState(null, '', url); } catch { /* file:// может запрещать history API */ }
  const ok = await copyText(url);
  toast(ok ? 'Ссылка скопирована' : 'Ссылка в адресной строке');
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

function restoreFromHash() {
  if (!location.hash.startsWith('#s=')) return null;
  try {
    const raw = location.hash.slice(3).replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(escape(atob(raw)));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function restoreFromStore() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

let saveTimer = null;
function scheduleSave() {
  if (!viewer) return;
  if (!state.solid && state.solidId !== 'custom') return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(serialize())); } catch { /* переполнение — не критично */ }
  }, 450);
}

/* ── вспомогательное ───────────────────────────────────────── */

function safeGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeSet(key, value) {
  try { localStorage.setItem(key, value); } catch { /* ignore */ }
}

let noticeTimer = null;
function showNotice(text, ms = 2400) {
  const el = $('#notice');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { el.hidden = true; }, ms);
}

let toastTimer = null;
function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-on'), 2000);
}

function showFatal(message) {
  const el = $('#notice');
  el.textContent = message;
  el.hidden = false;
}

/* ── привязка интерфейса ───────────────────────────────────── */

function bindUI() {
  $$('.rail__btn').forEach((btn) => btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    const mobile = window.matchMedia('(max-width: 760px)').matches;
    if (mobile && $('#panel').classList.contains('is-open') && btn.classList.contains('is-active')) {
      closeSheet();
      return;
    }
    setTab(tab);
  }));

  $('#panelClose').addEventListener('click', () => $('#panel').classList.remove('is-open'));

  $$('.preset').forEach((btn) => btn.addEventListener('click', () => {
    const id = btn.dataset.preset;
    if (id === 'custom') {
      if (!state.custom.points.length) seedCustom();
      state.solidId = 'custom';
      renderPresetActive();
      renderParams();
      const solid = buildCustomSolid();
      applySolid(solid, { frame: true, reseat: true });
      renderCustomList();
      updateSolidName();
      updateHint();
      setTab('solid');
      closeSheet();
      return;
    }
    if (state.solidId === id) { setTab('solid'); return; }
    loadPreset(id, null);
    updateHint();
    setTab('solid');
    closeSheet();
  }));

  $('#btnEditShape')?.addEventListener('click', () => {
    convertToCustom();
    toast('Теперь вершины можно тянуть');
  });

  $('#btnAddPoint').addEventListener('click', () => setAddMode(!state.addMode));
  $('#btnClearPoints').addEventListener('click', clearCustom);

  // точки сечения: ввод координат
  $$('.pt-card').forEach((card) => {
    const key = card.dataset.key;
    $$('input[data-axis]', card).forEach((input) => {
      input.addEventListener('focus', () => input.select());
      input.addEventListener('input', () => {
        const pt = state.points[key];
        if (!pt) return;
        const v = parseNum(input.value);
        if (!Number.isFinite(v)) return;
        pt.pos[input.dataset.axis] = v;
        pt.snap = null;
        viewer.setPoints(state.points);
        refreshSection();
      });
      input.addEventListener('blur', () => {
        const pt = state.points[key];
        if (pt) input.value = fmtInput(pt.pos[input.dataset.axis]);
      });
    });
  });

  $('#btnResetPoints').addEventListener('click', () => {
    seatDefaultPoints();
    refreshSection();
    toast('Точки вернулись на место');
  });

  $('#offset').addEventListener('input', (e) => {
    state.offset = Number(e.target.value);
    $('#offsetVal').textContent = fmtFixed(state.offset, 2);
    refreshSection();
  });

  $('#togglePlane').addEventListener('change', (e) => {
    applyVisual({ plane: e.target.checked }, { rebuildSection: true });
  });
  $('#toggleTails').addEventListener('change', (e) => {
    applyVisual({ tails: e.target.checked }, { rebuildSection: true });
  });
  $$('[data-cut]').forEach((btn) => btn.addEventListener('click', () => {
    const cut = btn.dataset.cut;
    if (state.visual.cut === cut) return;
    applyVisual({ cut }, { rebuildSection: true });
    updateHint();
  }));
  $('#opacity').addEventListener('input', (e) => {
    applyVisual({ opacity: Number(e.target.value) / 100 });
  });
  $('#toggleLabels').addEventListener('change', (e) => applyVisual({ labels: e.target.checked }));
  $('#toggleGrid').addEventListener('change', (e) => applyVisual({ grid: e.target.checked }));
  $('#toggleAxes').addEventListener('change', (e) => applyVisual({ axes: e.target.checked }));

  $$('[data-theme-btn]').forEach((btn) => btn.addEventListener('click', () => setTheme(btn.dataset.themeBtn)));
  $$('[data-ui-btn]').forEach((btn) => btn.addEventListener('click', () => applyUiScale(Number(btn.dataset.uiBtn))));
  $$('[data-cam]').forEach((btn) => btn.addEventListener('click', () => viewer.cameraPreset(btn.dataset.cam)));

  $('#btnZoomIn').addEventListener('click', () => viewer.zoom(0.82));
  $('#btnZoomOut').addEventListener('click', () => viewer.zoom(1.22));
  $('#btnFrame').addEventListener('click', () => viewer.frame(state.solid, true));

  $('#btnShot').addEventListener('click', exportPNG);
  $('#btnSave').addEventListener('click', saveJSON);
  $('#btnOpen').addEventListener('click', () => $('#fileInput').click());
  $('#fileInput').addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) loadJSON(file);
    e.target.value = '';
  });
  $('#btnShare').addEventListener('click', shareLink);

  $('#hintClose').addEventListener('click', () => {
    state.hintDismissed = true;
    updateHint();
    safeSet('secheniya.hint', 'off');
  });
  if (safeGet('secheniya.hint') === 'off') state.hintDismissed = true;

  // справка
  const help = $('#helpDialog');
  $('#btnHelp').addEventListener('click', () => help.showModal());
  $('#helpClose').addEventListener('click', () => help.close());
  help.addEventListener('click', (e) => { if (e.target === help) help.close(); });

  $('#btnTheme').addEventListener('click', () => setTheme(state.theme === 'light' ? 'dark' : 'light'));

  renderTasks();

  document.addEventListener('keydown', onKeyDown);
}

function renderTasks() {
  const host = $('#taskList');
  host.innerHTML = '';
  TASKS.forEach((task, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'task';
    btn.innerHTML = `
      <span class="task__num">${String(i + 1).padStart(2, '0')}</span>
      <span class="task__body">
        <span class="task__title"></span>
        <span class="task__desc"></span>
      </span>`;
    $('.task__title', btn).textContent = task.title;
    $('.task__desc', btn).textContent = task.desc;
    btn.addEventListener('click', () => {
      task.apply();
      viewer.setTheme(state.theme);
      viewer.setVisual(state.visual);
      viewer.frame(state.solid, true);
      refreshSection();
      syncVisualUI();
      updatePointInputs();
      updateSolidName();
      updateHint();
      setTab('section');
      closeSheet();
      toast('Задача загружена');
    });
    host.appendChild(btn);
  });
}

function seedCustom() {
  const H = 2.2;
  const base = [[-1.3, 0, -0.9], [1.4, 0, -0.7], [0.2, 0, 1.5]];
  const pts = [...base, ...base.map(([x, y, z]) => [x, y + H, z])];
  state.custom.points = pts.map((p) => new THREE.Vector3(...p));
  state.custom.labels = ['A', 'B', 'C', 'A₁', 'B₁', 'C₁'];
  state.solidId = 'custom';
  renderParams();
  renderCustomList();
  renderPresetActive();
}

function onKeyDown(e) {
  const tag = e.target?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  const key = e.key.toLowerCase();
  if (key >= '1' && key <= '5') {
    setTab(['solid', 'points', 'section', 'view', 'tasks'][Number(key) - 1]);
    return;
  }
  if (key === 't') { setTheme(state.theme === 'light' ? 'dark' : 'light'); return; }
  if (key === 'g') { $('#toggleGrid').checked = !state.visual.grid; applyVisual({ grid: !state.visual.grid }); return; }
  if (key === 'l') { $('#toggleLabels').checked = !state.visual.labels; applyVisual({ labels: !state.visual.labels }); return; }
  if (key === 'p') { exportPNG(); return; }
  if (key === 'r') { viewer.frame(state.solid, true); return; }
  if (key === 'escape') {
    if (state.addMode) { setAddMode(false); return; }
    if ($('#helpDialog').open) { $('#helpDialog').close(); return; }
    closeSheet();
  }
}

/* ── старт ─────────────────────────────────────────────────── */

init();

// отладочный доступ: удобно проверять геометрию в консоли браузера
window.__secheniya = { state, viewer, refreshSection, get section() { return state.section; } };
