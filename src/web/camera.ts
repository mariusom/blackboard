import type { Board } from '../workspace/model';
import { fitBoards, zoomAt } from '../workspace/model';
import { app, viewport, world } from './appState';
import { element } from './dom';

export function renderCamera() {
  const { camera } = app;
  world.style.transform = `translate(${camera.x}px,${camera.y}px) scale(${camera.zoom})`;
  viewport.style.backgroundSize = `${20 * camera.zoom}px ${20 * camera.zoom}px`;
  viewport.style.backgroundPosition = `${camera.x}px ${camera.y}px`;
  element('zoom-value').textContent = `${Math.round(camera.zoom * 100)}%`;
  try {
    localStorage.setItem('blackboard-camera', JSON.stringify(camera));
  } catch {
    // Private-mode storage failures must not block interaction.
  }
}

export function fit(boards: readonly Board[] = app.state?.workspace.boards ?? []) {
  app.camera = fitBoards(boards, viewport.clientWidth, viewport.clientHeight);
  renderCamera();
}

export function setZoom(zoom: number, point = { x: viewport.clientWidth / 2, y: viewport.clientHeight / 2 }) {
  app.camera = zoomAt(app.camera, zoom, point);
  renderCamera();
}

export const localPoint = (event: { clientX: number; clientY: number }) => {
  const rect = viewport.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
};

export function drawBounds(start: { x: number; y: number }, end: { x: number; y: number }) {
  const { camera } = app;
  return {
    x: (Math.min(start.x, end.x) - camera.x) / camera.zoom,
    y: (Math.min(start.y, end.y) - camera.y) / camera.zoom,
    width: Math.max(120, Math.abs(end.x - start.x) / camera.zoom),
    height: Math.max(120, Math.abs(end.y - start.y) / camera.zoom),
  };
}
