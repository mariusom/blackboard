import { expect, it } from '@effect/vitest';
import { vi } from 'vitest';
import { renderCamera } from '../src/web/camera';

const fixture = vi.hoisted(() => ({
  app: { camera: { x: 80, y: 110, zoom: 0.5 } },
  viewport: { style: { transform: '', backgroundSize: '', backgroundPosition: '' } },
  world: { style: { transform: '' } },
  zoom: { textContent: '' },
}));
vi.mock('../src/web/appState', () => fixture);
vi.mock('../src/web/dom', () => ({ element: () => fixture.zoom }));

it('moves only the world so panning and zooming preserve viewport bounds and pointer coordinates', () => {
  renderCamera();
  expect(fixture.world.style.transform).toBe('translate(80px,110px) scale(0.5)');
  expect(fixture.viewport.style.transform).toBe('');
  expect(fixture.viewport.style.backgroundPosition).toBe('80px 110px');
  expect(fixture.zoom.textContent).toBe('50%');
});
