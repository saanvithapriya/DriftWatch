import { Handle, Position, useStore } from "@xyflow/react";
import type { SchemaGraphNode } from "../types/schema";
import {
  MAX_FIELDS_SHOWN_ON_NODE,
  SCHEMA_FIELD_FLAG_TITLES,
  fieldFlags,
  providerLabel,
} from "./schemaModel";

export interface SchemaModelNodeData {
  node: SchemaGraphNode;
  selected: boolean;
  showFields: boolean;
  modelNames: ReadonlySet<string>;
  searchActive: boolean;
  relationCount: number;
  [key: string]: unknown;
}

/** Below this zoom level the node collapses to just its header + summary (spec section 11). */
const ZOOM_COLLAPSE_THRESHOLD = 0.55;

/**
 * One ER "table" card. A plain styled `<div>` with React Flow `Handle`s on
 * all four sides (one source + one target per side) so relationships can
 * exit/enter from whichever side actually faces the other model, instead of
 * every edge converging on a single connection point (spec section 5).
 *
 * All text — model name, field names, types — is repository-controlled and
 * rendered as plain React children, never `dangerouslySetInnerHTML`.
 */
export function SchemaModelNode({ data }: { data: SchemaModelNodeData }) {
  const zoom = useStore((state) => state.transform[2]);
  const condensed = zoom < ZOOM_COLLAPSE_THRESHOLD;

  const { node, selected, showFields, modelNames, searchActive, relationCount } = data;
  const model = node.model;
  const fields = model.fields;
  const shown = fields.slice(0, MAX_FIELDS_SHOWN_ON_NODE);
  const hiddenCount = fields.length - shown.length;

  const classNames = [
    "sch-node",
    selected ? "is-selected" : "",
    searchActive ? "is-match" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classNames}>
      <Handle type="target" position={Position.Top} id="top-target" className="sch-node__handle" />
      <Handle type="source" position={Position.Top} id="top-source" className="sch-node__handle" />
      <Handle type="target" position={Position.Right} id="right-target" className="sch-node__handle" />
      <Handle type="source" position={Position.Right} id="right-source" className="sch-node__handle" />
      <Handle type="target" position={Position.Bottom} id="bottom-target" className="sch-node__handle" />
      <Handle type="source" position={Position.Bottom} id="bottom-source" className="sch-node__handle" />
      <Handle type="target" position={Position.Left} id="left-target" className="sch-node__handle" />
      <Handle type="source" position={Position.Left} id="left-source" className="sch-node__handle" />

      <div className="sch-node__header">
        <span className="sch-node__name">{model.name}</span>
        <span className={`sch-node__badge sch-node__badge--${model.sourceType}`}>
          {providerLabel(model.sourceType)}
        </span>
      </div>

      {showFields && !condensed && (
        <div className="sch-node__body">
          {shown.map((field) => {
            const flags = fieldFlags(field, modelNames);
            const isPrimaryKey = flags.includes("PK");
            return (
              <div className="sch-node__row" key={field.id}>
                <span className="sch-node__key" aria-hidden="true">
                  {isPrimaryKey ? "🔑" : ""}
                </span>
                <span className="sch-node__field">{field.name}</span>
                <span className="sch-node__type">{field.type}</span>
                <span className="sch-node__flags">
                  {flags
                    .filter((flag) => flag !== "PK")
                    .map((flag) => (
                      <span
                        key={flag}
                        className={`sch-node__flag sch-node__flag--${flag.toLowerCase()}`}
                        title={SCHEMA_FIELD_FLAG_TITLES[flag]}
                        aria-label={SCHEMA_FIELD_FLAG_TITLES[flag]}
                      >
                        {flag}
                      </span>
                    ))}
                </span>
              </div>
            );
          })}
          {hiddenCount > 0 && (
            <div className="sch-node__more">+{hiddenCount} more field{hiddenCount === 1 ? "" : "s"}</div>
          )}
        </div>
      )}

      <div className="sch-node__footer">
        {fields.length} field{fields.length === 1 ? "" : "s"} · {relationCount} relation
        {relationCount === 1 ? "" : "s"}
      </div>
    </div>
  );
}
