const TRUTHY = new Set(["true", "1", "yes"]);

export function isGitLabReadOnly(): boolean {
  const v = process.env.GITLAB_READ_ONLY?.trim().toLowerCase();
  return v !== undefined && TRUTHY.has(v);
}

export function assertWriteAllowed(operation?: string): void {
  if (!isGitLabReadOnly()) {
    return;
  }
  const suffix = operation ? ` (${operation})` : "";
  throw new Error(
    `Operation blocked${suffix}: GITLAB_READ_ONLY=true. Set GITLAB_READ_ONLY=false to allow writes (merge, comment, approve, pipeline control, etc.).`,
  );
}

export const MR_WRITE_ACTIONS = new Set([
  "create",
  "update",
  "approve",
  "unapprove",
  "comment",
  "merge",
  "close",
  "reopen",
  "mark_draft",
  "mark_ready",
]);

export const PIPELINE_WRITE_ACTIONS = new Set([
  "play",
  "retry_job",
  "retry_pipeline",
  "cancel_pipeline",
]);
