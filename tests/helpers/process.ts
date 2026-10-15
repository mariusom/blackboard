import { spawn, type ChildProcess } from "node:child_process"

/** Test helper: the suite runs under vitest (Node), so it cannot use Bun.spawn. */
export function spawnProcess(command: string, args: readonly string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): ChildProcess {
  return spawn(command, [...args], { cwd: options.cwd, env: options.env, stdio: ["pipe", "pipe", "pipe"] })
}

export interface ProcessResult {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

export function collect(child: ChildProcess): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    let stdout = ""
    let stderr = ""
    child.stdout?.setEncoding("utf8")
    child.stderr?.setEncoding("utf8")
    child.stdout?.on("data", chunk => { stdout += chunk })
    child.stderr?.on("data", chunk => { stderr += chunk })
    child.on("error", reject)
    child.on("close", code => resolve({ code: code ?? 0, stdout, stderr }))
  })
}

export function run(command: string, args: readonly string[], options: Parameters<typeof spawnProcess>[2] = {}): Promise<ProcessResult> {
  return collect(spawnProcess(command, args, options))
}
