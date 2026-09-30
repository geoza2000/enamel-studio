import { createDocument } from './document.mjs';
import { SHAPES, poly } from './kernel/_shapes.mjs';
import { geometry, cellKey } from './kernel/_recipe.mjs';

export const PRESETS = [
  { id: 'sunrise', name: 'Sunrise', description: 'A golden sun above warm coral horizons.' },
  { id: 'prism', name: 'Prism', description: 'Jewel-toned geometric facets in a silver hexagon.' },
  { id: 'summit', name: 'Summit', description: 'A snow-capped mountain in a golden shield.' },
  { id: 'orbit', name: 'Orbit', description: 'Concentric cosmic rings inside a silver rounded square.' },
];

// All artwork is constructed from editable cubic chains, never raster assets.
const line = (a, b) => ({ points: [a, a.map((v, i) => v + (b[i] - v) / 3), a.map((v, i) => v + 2 * (b[i] - v) / 3), b], closed: false });
const ring = (diameter, y = 0) => ({ points: SHAPES.circle.build(diameter).map(([x, v]) => [x, v + y]), closed: true });

export function createPreset(id) {
  let shape, metal, strokes, paint;
  switch (id) {
    case 'sunrise':
      shape = 'circle'; metal = '#E8B85C';
      strokes = [ring(46, 36), line([-120, -4], [120, -4]), line([-120, -38], [120, -38])];
      paint = ({ minY, maxY }) => maxY < -38 ? '#A83F51' : maxY < 0 ? '#EF7955' : minY > 0 ? '#FFD36E' : '#F4B183';
      break;
    case 'prism':
      shape = 'hexagon'; metal = '#F7FBFF';
      strokes = [line([-120, 0], [120, 0]), line([0, -120], [0, 120]), line([-120, -120], [120, 120])];
      paint = (_, i) => ['#4361C2', '#35BBA7', '#9261CE', '#E86DAD', '#43A9D1', '#6651A5'][i % 6];
      break;
    case 'summit':
      shape = 'shield'; metal = '#E8B85C';
      strokes = [{ points: poly([[-60, -36], [0, 54], [60, -36]]), closed: true }, line([-24, 18], [24, 18])];
      paint = ({ minY, maxY }) => maxY > 65 ? '#225C68' : minY > 15 ? '#FFF0CC' : '#62A58F';
      break;
    case 'orbit':
      shape = 'squircle'; metal = '#F7FBFF';
      strokes = [ring(144), ring(94), ring(42)];
      paint = ({ maxX }) => maxX > 80 ? '#202C59' : maxX > 55 ? '#6653A3' : maxX > 25 ? '#38ABBB' : '#F5CC83';
      break;
    default:
      throw new TypeError(`Unknown preset: ${String(id)}`);
  }
  const document = { ...createDocument(), shape, outline: SHAPES[shape].build(200), wire: 5, metal, strokes };
  for (const [i, cell] of geometry(document).cells.entries()) {
    const xs = cell[0].map(p => p[0]);
    const ys = cell[0].map(p => p[1]);
    document.cellColors[cellKey(cell)] = paint({ minY: Math.min(...ys), maxY: Math.max(...ys), maxX: Math.max(...xs) }, i);
  }
  return { name: id, document };
}
