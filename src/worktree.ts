import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";
import { getWorktreeBaseDir } from "./resolve-project.js";

const execFileAsync = promisify(execFile);

async function run(cmd: string, args: string[], cwd?: string): Promise<void> {
  await execFileAsync(cmd, args, {
    maxBuffer: 50 * 1024 * 1024,
    cwd,
  });
}

function detectInstallCommand(worktreePath: string): string {
  if (existsSync(path.join(worktreePath, "composer.json"))) {
    return "composer install --no-interaction";
  }
  if (existsSync(path.join(worktreePath, "package.json"))) {
    return "npm ci";
  }
  return "true";
}

export type PrepareReviewParams = {
  repoPath: string | undefined;
  sourceBranch: string;
  /** URL HTTPS de clone (.git), com oauth2:TOKEN inject depois */
  cloneHttpUrl: string;
  token: string;
  installCommand?: string | undefined;
};

export async function prepareReviewWorktree(params: PrepareReviewParams): Promise<{
  worktreePath: string;
  installStdout: string;
  installStderr: string;
  installCommand: string;
}> {
  const base = getWorktreeBaseDir();
  await mkdir(base, { recursive: true });
  const safeBranch = params.sourceBranch.replace(/[^a-zA-Z0-9._/-]/g, "_");
  const worktreePath = path.join(base, `mr-${safeBranch}-${Date.now().toString(36)}`);

  if (params.repoPath?.trim()) {
    const mainRepo = path.resolve(params.repoPath.trim());
    await run("git", ["-C", mainRepo, "fetch", "origin", params.sourceBranch], mainRepo);
    await run("git", ["-C", mainRepo, "worktree", "add", worktreePath, `origin/${params.sourceBranch}`], mainRepo);
  } else {
    const u = new URL(params.cloneHttpUrl);
    u.username = "oauth2";
    u.password = params.token;
    const authenticated = u.toString();
    await run("git", ["clone", "--depth", "1", "--branch", params.sourceBranch, authenticated, worktreePath]);
  }

  const installCommand =
    params.installCommand?.trim() || detectInstallCommand(worktreePath);

  let installStdout = "";
  let installStderr = "";
  if (installCommand && installCommand !== "true") {
    const shell = process.platform === "win32" ? "cmd.exe" : "/bin/sh";
    const shellArg = process.platform === "win32" ? "/c" : "-c";
    const r = await execFileAsync(shell, [shellArg, installCommand], {
      cwd: worktreePath,
      maxBuffer: 50 * 1024 * 1024,
    });
    installStdout = r.stdout;
    installStderr = r.stderr;
  }

  return { worktreePath, installStdout, installStderr, installCommand };
}
