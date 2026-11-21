import { Vector3 } from 'three';
import { ConvexHull } from '../../vendor/three/addons/math/ConvexHull.js';

/* ─────────────────────────────────────────────────────────────
   Геометрия: тела, оболочка по точкам, сечения, форматирование
   Никакого DOM и WebGL — чистые вычисления.
   ───────────────────────────────────────────────────────────── */

const SUB = ['₀','₁','₂','₃','₄','₅','₆','₇','₈','₉'];
const BASE_LETTERS = 'ABCDEFGH';

export const sub = (n) => String(n).split('').map((d) => SUB[+d] ?? d).join('');
export const pointName = (i) => 'P' + sub(i + 1);

/* ── Тела ──────────────────────────────────────────────────── */

function orientFaces(vertices, faces, center) {
  return faces.map((face) => {
    const n = faceNormal(vertices, face);
    if (n.lengthSq() < 1e-12) return face;
    const fc = faceCentroid(vertices, face);
    return n.dot(fc.clone().sub(center)) < 0 ? [...face].reverse() : face;
  });
}

export function faceNormal(vertices, face) {
  // метод Ньюэлла — устойчив для почти плоских граней
  const n = new Vector3();
  for (let i = 0; i < face.length; i++) {
    const a = vertices[face[i]];
    const b = vertices[face[(i + 1) % face.length]];
    n.x += (a.y - b.y) * (a.z + b.z);
    n.y += (a.z - b.z) * (a.x + b.x);
    n.z += (a.x - b.x) * (a.y + b.y);
  }
  return n.normalize();
}

function faceCentroid(vertices, face) {
  const c = new Vector3();
  face.forEach((i) => c.add(vertices[i]));
  return c.multiplyScalar(1 / face.length);
}

function edgesFromFaces(faces) {
  const seen = new Set();
  const edges = [];
  for (const face of faces) {
    for (let i = 0; i < face.length; i++) {
      const a = face[i];
      const b = face[(i + 1) % face.length];
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push([a, b]);
    }
  }
  return edges;
}

/**
 * @param {{id:string,title:string,kind:'preset'|'custom',vertices:Vector3[],faces:number[][],labels:string[],meta?:object}} raw
 */
export function finalizeSolid(raw) {
  const vertices = raw.vertices.map((v) => v.clone());
  const center = new Vector3();
  vertices.forEach((v) => center.add(v));
  center.multiplyScalar(1 / vertices.length);

  const faces = orientFaces(vertices, raw.faces, center);
  const edges = edgesFromFaces(faces);

  let radius = 0;
  vertices.forEach((v) => { radius = Math.max(radius, v.distanceTo(center)); });

  return {
    ...raw,
    vertices,
    faces,
    edges,
    center,
    radius: Math.max(radius, 0.8),
    labels: raw.labels ?? vertices.map((_, i) => BASE_LETTERS[i] ?? pointName(i)),
  };
}

/** Прямоугольный параллелепипед: основание A B C D на y=0, верх A₁ B₁ C₁ D₁ */
export function boxSolid(a, b, h, title = 'Параллелепипед') {
  const x = a / 2;
  const z = b / 2;
  const v = [
    new Vector3(-x, 0, -z), new Vector3(x, 0, -z), new Vector3(x, 0, z), new Vector3(-x, 0, z),
    new Vector3(-x, h, -z), new Vector3(x, h, -z), new Vector3(x, h, z), new Vector3(-x, h, z),
  ];
  const faces = [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
  return finalizeSolid({
    id: 'box', kind: 'preset', title,
    vertices: v, faces,
    labels: ['A', 'B', 'C', 'D', 'A₁', 'B₁', 'C₁', 'D₁'],
    defaultPoints: [{ a: 3, b: 2, t: 0.5 }, { a: 1, b: 5, t: 0.5 }, { a: 3, b: 7, t: 0.5 }],
  });
}

/** Правильная n-угольная призма */
export function prismSolid(n, h, r = 1.55) {
  const v = [];
  for (let i = 0; i < n; i++) {
    const ang = Math.PI / 2 + (i * 2 * Math.PI) / n;
    v.push(new Vector3(r * Math.cos(ang), 0, r * Math.sin(ang)));
  }
  for (let i = 0; i < n; i++) {
    const ang = Math.PI / 2 + (i * 2 * Math.PI) / n;
    v.push(new Vector3(r * Math.cos(ang), h, r * Math.sin(ang)));
  }
  const faces = [];
  const base = [];
  const top = [];
  for (let i = 0; i < n; i++) {
    base.push(i);
    top.push(n + i);
    faces.push([i, (i + 1) % n, n + ((i + 1) % n), n + i]);
  }
  faces.unshift(base, top);
  const labels = [];
  for (let i = 0; i < n; i++) labels.push(BASE_LETTERS[i] ?? pointName(i));
  for (let i = 0; i < n; i++) labels.push((BASE_LETTERS[i] ?? pointName(i)) + '₁');
  return finalizeSolid({
    id: 'prism', kind: 'preset', title: `Правильная ${n}-угольная призма`,
    vertices: v, faces, labels,
    defaultPoints: [{ a: 0, b: 1, t: 0.5 }, { a: 1, b: n + 1, t: 0.5 }, { a: n + 1, b: n, t: 0.5 }],
    meta: { n, h },
  });
}

/** Правильная n-угольная пирамида, вершина S */
export function pyramidSolid(n, h, r = 1.6) {
  const v = [];
  const off = n === 4 ? Math.PI / 4 : Math.PI / 2;
  for (let i = 0; i < n; i++) {
    const ang = off - (i * 2 * Math.PI) / n;
    v.push(new Vector3(r * Math.cos(ang), 0, r * Math.sin(ang)));
  }
  v.push(new Vector3(0, h, 0));
  const apex = n;
  const faces = [];
  const base = [];
  for (let i = 0; i < n; i++) {
    base.push(i);
    faces.push([i, (i + 1) % n, apex]);
  }
  faces.unshift(base);
  const labels = [];
  for (let i = 0; i < n; i++) labels.push(BASE_LETTERS[i] ?? pointName(i));
  labels.push('S');
  return finalizeSolid({
    id: 'pyramid', kind: 'preset', title: `Правильная ${n}-угольная пирамида`,
    vertices: v, faces, labels,
    defaultPoints: [{ a: 0, b: 1, t: 0.5 }, { a: 1, b: apex, t: 0.45 }, { a: n - 1, b: apex, t: 0.5 }],
    meta: { n, h },
  });
}

/** Тетраэдр (не обязательно правильный, но по умолчанию правильный) */
export function tetraSolid(edge = 2.3) {
  const R = edge / Math.sqrt(3);
  const H = edge * Math.sqrt(2 / 3);
  const v = [];
  for (let i = 0; i < 3; i++) {
    const ang = Math.PI / 2 + (i * 2 * Math.PI) / 3;
    v.push(new Vector3(R * Math.cos(ang), 0, R * Math.sin(ang)));
  }
  v.push(new Vector3(0, H, 0));
  const faces = [[0, 1, 2], [0, 1, 3], [1, 2, 3], [2, 0, 3]];
  return finalizeSolid({
    id: 'tetra', kind: 'preset', title: 'Тетраэдр',
    vertices: v, faces, labels: ['A', 'B', 'C', 'D'],
    defaultPoints: [{ a: 0, b: 1, t: 0.5 }, { a: 1, b: 3, t: 0.5 }, { a: 0, b: 2, t: 0.5 }],
  });
}

/** Октаэдр */
export function octaSolid(r = 1.7) {
  const v = [
    new Vector3(r, 0, 0), new Vector3(-r, 0, 0),
    new Vector3(0, r, 0), new Vector3(0, -r, 0),
    new Vector3(0, 0, r), new Vector3(0, 0, -r),
  ];
  const faces = [
    [0, 2, 4], [0, 4, 3], [0, 3, 5], [0, 5, 2],
    [1, 4, 2], [1, 3, 4], [1, 5, 3], [1, 2, 5],
  ];
  return finalizeSolid({
    id: 'octa', kind: 'preset', title: 'Октаэдр',
    vertices: v, faces, labels: ['A', 'B', 'C', 'D', 'E', 'F'],
    defaultPoints: [{ a: 0, b: 2, t: 0.5 }, { a: 0, b: 3, t: 0.5 }, { a: 0, b: 4, t: 0.5 }],
  });
}

/* ── Своя фигура: выпуклая оболочка ────────────────────────── */

export function hullFromPoints(points, labels = null) {
  const uniq = [];
  for (const p of points) {
    if (!uniq.some((q) => q.distanceToSquared(p) < 1e-8)) uniq.push(p.clone());
  }
  if (uniq.length < 4) return { error: 'Нужно минимум четыре точки.' };

  // проверка некомпланарности
  const a = uniq[0];
  let b = null; let c = null;
  for (const p of uniq.slice(1)) {
    if (p.distanceToSquared(a) > 1e-6) { b = p; break; }
  }
  if (!b) return { error: 'Точки совпадают.' };
  const ab = b.clone().sub(a);
  for (const p of uniq) {
    if (new Vector3().crossVectors(ab, p.clone().sub(a)).lengthSq() > 1e-6) { c = p; break; }
  }
  if (!c) return { error: 'Все точки лежат на одной прямой.' };
  const nrm = new Vector3().crossVectors(ab, c.clone().sub(a)).normalize();
  if (!uniq.some((p) => Math.abs(nrm.dot(p.clone().sub(a))) > 1e-3)) {
    return { error: 'Все точки лежат в одной плоскости — объёмной фигуры не выйдет.' };
  }

  let hull;
  try {
    hull = new ConvexHull().setFromPoints(uniq);
  } catch (e) {
    return { error: 'Не удалось построить оболочку по этим точкам.' };
  }
  if (!hull || !hull.faces || !hull.faces.length) {
    return { error: 'Не удалось построить оболочку по этим точкам.' };
  }

  const indexOf = (p) => uniq.findIndex((q) => q.distanceToSquared(p) < 1e-8);
  const rawFaces = [];
  for (const face of hull.faces) {
    const idx = [];
    let edge = face.edge;
    if (!edge) continue;
    let guard = 0;
    do {
      const p = edge.head().point;
      const i = indexOf(p);
      if (i >= 0 && !idx.includes(i)) idx.push(i);
      edge = edge.next;
      guard++;
    } while (edge && edge !== face.edge && guard < 64);
    if (idx.length >= 3) rawFaces.push(idx);
  }
  if (rawFaces.length < 4) return { error: 'Оболочка получилась плоской — разведите точки.' };

  // склеиваем соседние компланарные треугольники в один многоугольник,
  // чтобы у плоской грани не было «лишней» диагонали
  const center = new Vector3();
  uniq.forEach((p) => center.add(p));
  center.multiplyScalar(1 / uniq.length);

  const groups = [];
  for (const face of rawFaces) {
    const n = faceNormal(uniq, face);
    const fc = faceCentroid(uniq, face);
    let nn = n.clone();
    if (nn.dot(fc.clone().sub(center)) < 0) nn.negate();
    const d = nn.dot(fc);
    const group = groups.find((g) => Math.abs(g.n.dot(nn)) > 1 - 1e-6 && Math.abs(g.d - d) < 1e-4);
    if (group) group.faces.push(face);
    else groups.push({ n: nn, d, faces: [face] });
  }

  const faces = [];
  for (const g of groups) {
    const ids = [...new Set(g.faces.flat())];
    if (ids.length === 3) { faces.push(ids); continue; }
    const gc = new Vector3();
    ids.forEach((i) => gc.add(uniq[i]));
    gc.multiplyScalar(1 / ids.length);
    const helper = Math.abs(g.n.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
    const u = new Vector3().crossVectors(g.n, helper).normalize();
    const v = new Vector3().crossVectors(g.n, u).normalize();
    const ordered = ids
      .map((i) => {
        const rel = uniq[i].clone().sub(gc);
        return { i, ang: Math.atan2(rel.dot(v), rel.dot(u)) };
      })
      .sort((a, b) => a.ang - b.ang)
      .map((o) => o.i);
    faces.push(ordered);
  }

  return finalizeSolid({
    id: 'custom', kind: 'custom', title: 'Своя фигура',
    vertices: uniq, faces,
    labels: labels?.length === uniq.length ? labels : uniq.map((_, i) => pointName(i)),
    meta: { points: uniq.length },
  });
}

/* ── Плоскость и сечение ───────────────────────────────────── */

/** Плоскость по трём точкам: n·x = c (n единичный) */
export function planeFromPoints(p1, p2, p3) {
  const v1 = new Vector3().subVectors(p2, p1);
  const v2 = new Vector3().subVectors(p3, p1);
  const n = new Vector3().crossVectors(v1, v2);
  if (n.lengthSq() < 1e-9) return null;
  n.normalize();
  return { normal: n, c: n.dot(p1) };
}

/** Пересечение плоскости с многогранником → выпуклый многоугольник */
export function sectionOf(solid, plane, offset = 0) {
  if (!solid || !plane) return null;
  const n = plane.normal;
  const c = plane.c + offset;
  const eps = 1e-6;
  const raw = [];

  for (const face of solid.faces) {
    const pts = face.map((i) => solid.vertices[i]);
    const d = pts.map((p) => n.dot(p) - c);
    const hits = [];
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      const di = d[i];
      const dj = d[j];
      if (Math.abs(di) < eps) hits.push(pts[i].clone());
      if ((di > eps && dj < -eps) || (di < -eps && dj > eps)) {
        const t = di / (di - dj);
        hits.push(new Vector3().lerpVectors(pts[i], pts[j], t));
      }
    }
    for (const h of hits) {
      const dup = raw.find((q) => q.distanceToSquared(h) < 1e-8);
      if (!dup) raw.push(h);
    }
  }

  if (raw.length < 3) return null;

  // упорядочивание вокруг центра в базисе плоскости
  const center = new Vector3();
  raw.forEach((p) => center.add(p));
  center.multiplyScalar(1 / raw.length);

  const helper = Math.abs(n.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
  const u = new Vector3().crossVectors(n, helper).normalize();
  const v = new Vector3().crossVectors(n, u).normalize();

  const ordered = raw
    .map((p) => {
      const rel = p.clone().sub(center);
      return { p, ang: Math.atan2(rel.dot(v), rel.dot(u)) };
    })
    .sort((a, b) => a.ang - b.ang)
    .map((o) => o.p);

  // ориентация по нормали плоскости
  const polyNormal = new Vector3();
  for (let i = 0; i < ordered.length; i++) {
    const a = ordered[i];
    const b = ordered[(i + 1) % ordered.length];
    polyNormal.x += (a.y - b.y) * (a.z + b.z);
    polyNormal.y += (a.z - b.z) * (a.x + b.x);
    polyNormal.z += (a.x - b.x) * (a.y + b.y);
  }
  if (polyNormal.dot(n) < 0) ordered.reverse();

  // площадь и периметр
  let doubleArea = 0;
  let perimeter = 0;
  for (let i = 0; i < ordered.length; i++) {
    const a = ordered[i];
    const b = ordered[(i + 1) % ordered.length];
    const ar = a.clone().sub(center);
    const br = b.clone().sub(center);
    doubleArea += ar.dot(u) * br.dot(v) - br.dot(u) * ar.dot(v);
    perimeter += a.distanceTo(b);
  }

  const sides = ordered.length;
  return {
    points: ordered,
    sides,
    area: Math.abs(doubleArea) / 2,
    perimeter,
    name: polygonName(sides),
    plane: { normal: n.clone(), c },
  };
}

export function polygonName(sides) {
  return ({
    3: 'Треугольник',
    4: 'Четырёхугольник',
    5: 'Пятиугольник',
    6: 'Шестиугольник',
    7: 'Семиугольник',
    8: 'Восьмиугольник',
    9: 'Девятиугольник',
    10: 'Десятиугольник',
  })[sides] ?? `${sides}-угольник`;
}

/* ── Форматирование ────────────────────────────────────────── */

const MINUS = '−';

export function fmtNum(value, digits = 2) {  if (!Number.isFinite(value)) return '—';
  const r = Math.abs(value) < 5 * 10 ** -(digits + 1) ? 0 : value;
  let s = r.toFixed(digits);
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  if (s === '-0' || s === '0') s = '0';
  return s.replace('-', MINUS).replace('.', ',');
}

/** Число с фиксированным количеством знаков и запятой: 7,10 */
export function fmtFixed(value, digits = 2) {
  if (!Number.isFinite(value)) return '—';
  return value.toFixed(digits).replace('.', ',');
}

/** Красивое уравнение плоскости: 2x − y + z = 4 */
export function formatPlane(plane) {
  if (!plane) return '—';
  const n = plane.normal;
  let [a, b, c] = [n.x, n.y, n.z];
  let d = plane.c;

  const maxAbs = Math.max(Math.abs(a), Math.abs(b), Math.abs(c));
  if (maxAbs < 1e-9) return '—';

  // ищем целочисленный масштаб, чтобы коэффициенты выглядели «школьно»
  let ints = null;
  for (let k = 1; k <= 8; k++) {
    const vals = [a * k, b * k, c * k, d * k];
    if (vals.every((v) => Math.abs(v - Math.round(v)) < 0.02)) {
      ints = vals.map((v) => Math.round(v));
      break;
    }
  }
  if (ints) {
    [a, b, c, d] = ints;
  } else {
    const s = 1 / maxAbs;
    a *= s; b *= s; c *= s; d *= s;
  }

  // первый ненулевой коэффициент — положительный
  const first = [a, b, c].find((v) => Math.abs(v) > 1e-9);
  if (first !== undefined && first < 0) { a = -a; b = -b; c = -c; d = -d; }

  const coef = (v) => {
    const av = Math.abs(v);
    if (Math.abs(av - 1) < 1e-9) return '';
    return Number.isInteger(v) ? String(av) : fmtNum(av, 2);
  };

  const terms = [];
  const push = (v, letter) => {
    if (Math.abs(v) < 1e-9) return;
    const sign = v < 0 ? MINUS : '+';
    const body = coef(v) + letter;
    terms.push(terms.length === 0 ? (v < 0 ? MINUS + body : body) : ` ${sign} ${body}`);
  };
  push(a, 'x');
  push(b, 'y');
  push(c, 'z');

  const rhs = Math.abs(d) < 1e-9 ? '0' : fmtNum(d, 2);
  return `${terms.join('')} = ${rhs}`;
}

export function edgeLabel(solid, edge) {
  return `${solid.labels[edge[0]]}${solid.labels[edge[1]]}`;
}

export { BASE_LETTERS, SUB };
