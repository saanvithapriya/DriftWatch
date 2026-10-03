import mermaid from "mermaid";

/**
 * Shared Mermaid initialisation and rendering.
 *
 * One place so every diagram in the application gets the same security
 * configuration: labels come from repository and workflow content, which is
 * untrusted, so `securityLevel: "strict"` (which sanitises the produced SVG)
 * and `htmlLabels: false` stay on everywhere.
 */
let initialised = false;

function ensureInitialised(): void {
  if (initialised) return;
  mermaid.initialize({
    startOnLoad: false,
    theme: "dark",
    securityLevel: "strict",
    // useMaxWidth would scale a wide graph down until labels are unreadable.
    flowchart: { htmlLabels: false, useMaxWidth: false },
  });
  initialised = true;
}

let counter = 0;

/** Unique element id for one render; Mermaid requires a fresh one each time. */
export function nextDiagramId(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

/** Renders a definition to sanitised SVG. Rejects if Mermaid cannot parse it. */
export async function renderMermaid(
  id: string,
  definition: string
): Promise<string> {
  ensureInitialised();
  const { svg } = await mermaid.render(id, definition);
  return svg;
}
