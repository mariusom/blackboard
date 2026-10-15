import type { Board } from "../workspace/model"

/** Canvas-library presentation, kept free of the DOM so it can be tested and
 * so the list can be updated in place instead of rebuilt on every change. */
export interface CanvasRow {
  readonly icon: string
  readonly label: string
  readonly size: string
  readonly active: boolean
}

export const visibleCanvases = (boards: readonly Board[], query: string): readonly Board[] => {
  const filter = query.trim().toLowerCase()
  return filter ? boards.filter(board => board.name.toLowerCase().includes(filter)) : boards
}

export const canvasRow = (board: Board, selectedId: string | null): CanvasRow => ({
  icon: board.width < board.height ? "▯" : "▤",
  label: board.name,
  size: `${board.width} × ${board.height}`,
  active: board.id === selectedId,
})

export const emptyLibraryMessage = (query: string): string =>
  query.trim() ? "No matching canvases." : "Your canvases will appear here. Start with a frame or an idea."
