import { Schema } from 'effect';
import type { Board } from '../workspace/model';

export const AgentFormat = Schema.Literals(['responsive', 'desktop', 'mobile', 'custom']);
export type AgentFormat = typeof AgentFormat.Type;
export function buildAgentPrompt(brief: string, format: AgentFormat, board?: Board): string {
  const output =
    format === 'responsive'
      ? 'Create separate desktop and mobile canvases.'
      : format === 'desktop'
        ? 'Design a desktop canvas.'
        : format === 'mobile'
          ? 'Design a mobile canvas.'
          : 'Choose canvas dimensions that suit the design.';
  return `Use the Blackboard MCP tools to ${board ? `refine canvas ${JSON.stringify(board.name)} (id: ${board.id})` : 'create new canvases'}.\n\n${brief}\n\n${board ? 'Keep the selected canvas as the target; preserve its dimensions unless the brief asks for a change.' : output}\n\nCall canvas_list_boards and canvas_list_tokens first. Reuse design tokens as var(--token-name); create missing reusable colors, spacing, typography and radii with canvas_upsert_tokens before generating HTML. Preserve unrelated tokens and canvases. ${board ? 'Read the current HTML with canvas_get_board before replacing it.' : 'Place the new canvases alongside existing work.'} Use complete HTML and inline CSS. Embed images as data URLs or use inline SVG/CSS artwork. Scripts and external resources are disabled in previews. Use expectedRevision for token and canvas edits. Return the design directly to the open Blackboard workspace.`;
}
