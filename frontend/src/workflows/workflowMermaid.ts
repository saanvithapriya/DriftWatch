import type { Workflow, WorkflowJob } from "../types/workflows";
import { escapeLabel } from "../utils/mermaid";

/**
 * Mermaid generation for a workflow's job dependency graph.
 *
 * Pure: no DOM, no React, no network. The graph is JOB -> JOB only; a job's
 * steps live in the details panel, never as graph nodes, so a workflow with
 * hundreds of steps still produces a small diagram.
 *
 * Every label passes through the shared `escapeLabel`, because workflow names
 * are repository-controlled and therefore untrusted.
 */

/** Upper bound on nodes in one workflow diagram. */
export const MAX_WORKFLOW_GRAPH_NODES = 120;

export interface WorkflowDiagram {
  /** Mermaid source, or null when the guard tripped or there are no jobs. */
  definition: string | null;
  /** Jobs that would be drawn. */
  nodeCount: number;
  exceededMaxNodes: boolean;
  /** Mermaid node id -> job id, so the UI can make nodes clickable. */
  jobIdByNodeId: Map<string, string>;
}

export interface WorkflowDiagramOptions {
  maxNodes?: number;
}

/** Compact node caption: name, runner, and step or reusable-workflow summary. */
export function describeJob(job: WorkflowJob): string[] {
  const lines = [job.name];

  if (job.uses !== undefined) {
    lines.push("reusable workflow");
  } else if (job.runsOn !== undefined) {
    lines.push(job.runsOn);
  }

  if (job.matrix !== undefined && job.matrix.dimensions.length > 0) {
    const total = job.matrix.dimensions.reduce(
      (product, d) => product * Math.max(d.values.length, 1),
      1
    );
    lines.push(`matrix ×${total}`);
  }

  if (job.uses === undefined) {
    lines.push(job.stepCount === 1 ? "1 step" : `${job.stepCount} steps`);
  }

  return lines;
}

/**
 * Builds the `flowchart TD` for one workflow.
 *
 * Node ids are sequential (`job_1`, `job_2`, …) assigned in the jobs' existing
 * sorted order, so they are deterministic and cannot collide however exotic a
 * job id is. An edge is only drawn when the job named in `needs` actually
 * exists in this workflow — a dangling reference never invents a node.
 */
export function generateWorkflowDiagram(
  workflow: Workflow,
  options: WorkflowDiagramOptions = {}
): WorkflowDiagram {
  const maxNodes = options.maxNodes ?? MAX_WORKFLOW_GRAPH_NODES;
  const jobIdByNodeId = new Map<string, string>();
  const nodeCount = workflow.jobs.length;

  if (nodeCount === 0) {
    return { definition: null, nodeCount: 0, exceededMaxNodes: false, jobIdByNodeId };
  }

  if (nodeCount > maxNodes) {
    return { definition: null, nodeCount, exceededMaxNodes: true, jobIdByNodeId };
  }

  const nodeIdByJobId = new Map<string, string>();
  workflow.jobs.forEach((job, index) => {
    const nodeId = `job_${index + 1}`;
    nodeIdByJobId.set(job.id, nodeId);
    jobIdByNodeId.set(nodeId, job.id);
  });

  const lines: string[] = ["flowchart TD"];

  for (const job of workflow.jobs) {
    const nodeId = nodeIdByJobId.get(job.id) as string;
    const label = describeJob(job).map(escapeLabel).join("<br/>");
    lines.push(`  ${nodeId}["${label}"]`);
  }

  const emitted = new Set<string>();
  for (const job of workflow.jobs) {
    const targetId = nodeIdByJobId.get(job.id) as string;

    for (const need of job.needs) {
      const sourceId = nodeIdByJobId.get(need);
      // A `needs` pointing at a job that is not in this workflow is skipped
      // rather than turned into an invented node.
      if (sourceId === undefined) continue;

      const edge = `  ${sourceId} --> ${targetId}`;
      if (emitted.has(edge)) continue;
      emitted.add(edge);
      lines.push(edge);
    }
  }

  return {
    definition: lines.join("\n"),
    nodeCount,
    exceededMaxNodes: false,
    jobIdByNodeId,
  };
}
