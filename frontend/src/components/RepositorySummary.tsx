import type { RepositoryTree } from "../types/github";

interface Props {
  result: RepositoryTree;
}

function countNodes(tree: RepositoryTree) {
  let files = 0;
  let directories = 0;
  for (const node of tree.tree) {
    if (node.type === "file") files++;
    else directories++;
  }
  return { files, directories, total: files + directories };
}

function fmt(n: number) {
  return n.toLocaleString();
}

export function RepositorySummary({ result }: Props) {
  const { files, directories, total } = countNodes(result);
  const { owner, name, defaultBranch } = result.repository;

  return (
    <div className="repo-summary card">
      <p className="repo-summary__section-label">Repository</p>
      <h2 className="repo-summary__name">
        {owner}<span className="repo-summary__slash">/</span>{name}
      </h2>

      <div className="repo-summary__stats">
        <div className="repo-summary__stat">
          <span className="repo-summary__stat-label">Branch</span>
          <span className="repo-summary__stat-value repo-summary__stat-value--mono">
            {defaultBranch}
          </span>
        </div>
        <div className="repo-summary__divider" aria-hidden="true" />
        <div className="repo-summary__stat">
          <span className="repo-summary__stat-label">Files</span>
          <span className="repo-summary__stat-value">{fmt(files)}</span>
        </div>
        <div className="repo-summary__divider" aria-hidden="true" />
        <div className="repo-summary__stat">
          <span className="repo-summary__stat-label">Directories</span>
          <span className="repo-summary__stat-value">{fmt(directories)}</span>
        </div>
        <div className="repo-summary__divider" aria-hidden="true" />
        <div className="repo-summary__stat">
          <span className="repo-summary__stat-label">Total Nodes</span>
          <span className="repo-summary__stat-value">{fmt(total)}</span>
        </div>
      </div>

      {result.truncated && (
        <div className="alert alert-warning repo-summary__truncated" role="alert">
          <span aria-hidden="true">⚠</span>
          <div>
            <strong className="alert-title">Large repository</strong>
            <span className="alert-body">
              GitHub returned a truncated tree. Some files may not be displayed.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
