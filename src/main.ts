import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { startWorkspaceServer } from './workspace/server';
import { applicationDirectory, discoveryPath } from './workspace/connection';

declare const BLACKBOARD_PACKAGED: boolean | undefined;

if (process.argv.includes('--mcp')) {
  await import('./mcp-main');
} else {
  const development = typeof BLACKBOARD_PACKAGED === 'undefined' || !BLACKBOARD_PACKAGED;
  const browserOnly = process.argv.includes('--browser');
  const isolatedPath = process.argv.find((arg) => arg.startsWith('--workspace='))?.slice('--workspace='.length);
  const discovery = isolatedPath ? `${isolatedPath}.connection.json` : discoveryPath();
  const workspacePath = isolatedPath ?? join(applicationDirectory(), 'workspace.json');
  const agentCommand = process.execPath;
  const agentArgs = [
    ...(development ? [resolve('src/mcp-main.ts')] : ['--mcp']),
    ...(isolatedPath ? [`--connection-file=${discovery}`] : []),
  ];
  try {
    const previous = JSON.parse(await readFile(discovery, 'utf8'));
    if (
      typeof previous.origin === 'string' &&
      /^http:\/\/127\.0\.0\.1:\d+$/.test(previous.origin) &&
      typeof previous.token === 'string'
    ) {
      const response = await fetch(`${previous.origin}/api/state`, {
        headers: { Authorization: `Bearer ${previous.token}` },
        signal: AbortSignal.timeout(1500),
      });
      if (response.ok) {
        console.error('Blackboard is already open.');
        process.exit(0);
      }
    }
  } catch {}
  const server = await startWorkspaceServer({
    path: workspacePath,
    agentCommand,
    agentArgs,
    previewUpdates: process.argv.includes('--preview-updates'),
  });
  await mkdir(dirname(discovery), { recursive: true, mode: 0o700 });
  await writeFile(discovery, JSON.stringify({ origin: server.origin, token: server.token, pid: process.pid }), {
    mode: 0o600,
  });
  let child: ReturnType<typeof Bun.spawn> | undefined;
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    child?.kill();
    await server.close();
    try {
      const record = JSON.parse(await readFile(discovery, 'utf8'));
      if (record.token === server.token) await unlink(discovery);
    } catch {}
  };
  process.once('SIGINT', () => {
    void stop().then(() => process.exit(0));
  });
  process.once('SIGTERM', () => {
    void stop().then(() => process.exit(0));
  });
  process.once('exit', () => {
    child?.kill();
  });
  if (browserOnly) console.log(server.url);
  else {
    const shell = development
      ? resolve('dist/blackboard-webkit')
      : join(dirname(process.execPath), 'blackboard-webkit');
    child = Bun.spawn([shell, server.url], { stdout: 'inherit', stderr: 'inherit' });
    await child.exited;
    await stop();
  }
}
