import { Effect, Layer, ManagedRuntime, Schema, Stream } from 'effect';
import { APP_VERSION } from '../domain/models';
import { UpdateService, type UpdateDependencies } from '../services/UpdateService';
import { BoardPatch, CreateBoard, DeleteBoard, WorkspaceError, summarizeBoard } from './model';
import { WorkspaceService } from './WorkspaceService';
import { makeUpdatePreview } from './updatePreview';
import { DeleteToken, UpsertTokens } from './tokens';
import type { WorkspaceState } from './protocol';
import html from '../web/index.html' with { type: 'text' };
import css from '../web/style.css' with { type: 'text' };

declare const BLACKBOARD_WEB_CLIENT: string | undefined;

type ServerRuntime = ManagedRuntime.ManagedRuntime<WorkspaceService | UpdateService, WorkspaceError>;
type UpdatePreview = Effect.Success<typeof makeUpdatePreview>;
type Subscriber = ReadableStreamDefaultController<Uint8Array>;
type RequestEffect<A, E = WorkspaceError> = Effect.Effect<A, E, WorkspaceService | UpdateService>;

interface RequestContext {
  readonly runtime: ServerRuntime;
  readonly token: string;
  readonly page: string;
  readonly editorNonce: string;
  readonly script: string;
  readonly preview: UpdatePreview | undefined;
  readonly subscribers: Set<Subscriber>;
  readonly lastSent: Map<Subscriber, Map<string, number>>;
  readonly encoder: TextEncoder;
  readonly getState: () => Promise<WorkspaceState>;
  readonly execute: <A, E>(effect: RequestEffect<A, E>) => Promise<Response>;
}

const noStoreHeaders = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: noStoreHeaders });
const invalid = (message: string) => new WorkspaceError({ code: 'invalid', message });
const notFound = () => new Response('Not found', { status: 404 });

const decode = <A>(schema: Schema.Decoder<A>, input: unknown) =>
  Schema.decodeUnknownEffect(schema)(input).pipe(
    Effect.mapError(() => invalid('Invalid request. Check the canvas dimensions and content.')),
  );

// A malformed percent-encoding must be a request error, not an uncaught defect.
const decodeId = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
};

const buildClientScript = async () => {
  if (typeof BLACKBOARD_WEB_CLIENT !== 'undefined') return BLACKBOARD_WEB_CLIENT;
  const result = await Bun.build({
    entrypoints: [new URL('../web/client.ts', import.meta.url).pathname],
    target: 'browser',
  });
  if (!result.success) throw new Error(result.logs.join('\n'));
  return result.outputs[0].text();
};

const readState = (
  runtime: ServerRuntime,
  agent: WorkspaceState['agent'],
  updatePreview: boolean,
): Promise<WorkspaceState> =>
  runtime.runPromise(
    Effect.gen(function* () {
      const workspace = yield* WorkspaceService;
      const updates = yield* UpdateService;
      return {
        workspace: yield* workspace.get,
        update: yield* updates.getUpdateState,
        version: APP_VERSION,
        agent,
        updatePreview,
      };
    }),
  );

const makeExecutor =
  (runtime: ServerRuntime) =>
  async <A, E>(effect: RequestEffect<A, E>): Promise<Response> => {
    const result = await runtime.runPromise(Effect.result(effect));
    if (result._tag === 'Success') return json(result.success ?? { ok: true });
    const error = result.failure;
    const status =
      error instanceof WorkspaceError
        ? { conflict: 409, missing: 404, invalid: 400, storage: 500, unavailable: 503 }[error.code]
        : 500;
    return json({ error: error instanceof Error ? error.message : 'The action could not be completed.' }, status);
  };

const isAuthorized = (request: Request, token: string) => {
  const cookie = request.headers
    .get('cookie')
    ?.split(';')
    .some((part) => part.trim() === `blackboard=${token}`);
  return Boolean(cookie) || request.headers.get('authorization') === `Bearer ${token}`;
};

const isCrossOriginWrite = (request: Request, origin: string, token: string) =>
  request.method !== 'GET' &&
  request.headers.get('origin') !== origin &&
  request.headers.get('authorization') !== `Bearer ${token}`;

const signIn = (token: string) =>
  new Response(null, {
    status: 303,
    headers: {
      Location: '/',
      'Set-Cookie': `blackboard=${token}; HttpOnly; SameSite=Strict; Path=/`,
      'Referrer-Policy': 'no-referrer',
    },
  });

const pageResponse = (page: string, nonce: string) =>
  new Response(page, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; frame-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`,
    },
  });

const listBoards = (url: URL) =>
  Effect.flatMap(WorkspaceService, (workspace) =>
    workspace.get.pipe(
      Effect.map((state) => {
        const query = (url.searchParams.get('query') ?? '').trim().toLowerCase();
        return state.boards
          .filter(
            (board) => !query || board.name.toLowerCase().includes(query) || board.html.toLowerCase().includes(query),
          )
          .map(summarizeBoard);
      }),
    ),
  );

const readBoard = (rawId: string) =>
  Effect.gen(function* () {
    const id = decodeId(rawId);
    if (id === null) return yield* invalid('Invalid canvas id.');
    const board = (yield* (yield* WorkspaceService).get).boards.find((candidate) => candidate.id === id);
    if (!board) return yield* new WorkspaceError({ code: 'missing', message: 'This canvas no longer exists.' });
    return board;
  });

const openEventStream = (ctx: RequestContext) => {
  let subscriber: Subscriber;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      subscriber = controller;
      ctx.subscribers.add(controller);
      ctx.lastSent.set(controller, new Map());
      controller.enqueue(ctx.encoder.encode(': connected\n\n'));
    },
    cancel() {
      ctx.subscribers.delete(subscriber);
      ctx.lastSent.delete(subscriber);
    },
  });
  return new Response(body, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
  });
};

const handleGet = async (url: URL, ctx: RequestContext): Promise<Response | undefined> => {
  if (url.pathname === '/') return pageResponse(ctx.page, ctx.editorNonce);
  if (url.pathname === '/client.js')
    return new Response(ctx.script, { headers: { 'Content-Type': 'text/javascript; charset=utf-8' } });
  if (url.pathname === '/style.css')
    return new Response(css, { headers: { 'Content-Type': 'text/css; charset=utf-8' } });
  if (url.pathname === '/api/state') return json(await ctx.getState());
  if (url.pathname === '/api/boards') return ctx.execute(listBoards(url));
  const boardMatch = /^\/api\/boards\/([^/]+)$/.exec(url.pathname);
  if (boardMatch) return ctx.execute(readBoard(boardMatch[1]));
  if (url.pathname === '/api/tokens')
    return ctx.execute(Effect.flatMap(WorkspaceService, (workspace) => workspace.getTokens));
  if (url.pathname === '/api/events') return openEventStream(ctx);
  return undefined;
};

const createBoard = (body: unknown) =>
  Effect.gen(function* () {
    return yield* (yield* WorkspaceService).create(yield* decode(CreateBoard, body));
  });

const upsertTokens = (body: unknown) =>
  Effect.gen(function* () {
    return yield* (yield* WorkspaceService).upsertTokens(yield* decode(UpsertTokens, body));
  });

const deleteToken = (body: unknown) =>
  Effect.gen(function* () {
    const input = yield* decode(DeleteToken, body);
    return yield* (yield* WorkspaceService).deleteToken(input.name, input.expectedRevision);
  });

const renameWorkspace = (body: unknown) =>
  Effect.gen(function* () {
    const input = yield* decode(Schema.Struct({ name: Schema.String }), body);
    yield* (yield* WorkspaceService).rename(input.name);
  });

const mutateBoard = (rawId: string, removing: boolean, body: unknown) =>
  Effect.gen(function* () {
    const service = yield* WorkspaceService;
    const id = decodeId(rawId);
    if (id === null) return yield* invalid('Invalid canvas id.');
    if (removing) return yield* service.remove(id, (yield* decode(DeleteBoard, body)).expectedRevision);
    return yield* service.update(id, yield* decode(BoardPatch, body));
  });

const handlePost = async (request: Request, url: URL, ctx: RequestContext): Promise<Response | undefined> => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'The request must contain JSON.' }, 400);
  }
  if (url.pathname === '/api/boards') return ctx.execute(createBoard(body));
  if (url.pathname === '/api/tokens') return ctx.execute(upsertTokens(body));
  if (url.pathname === '/api/tokens/delete') return ctx.execute(deleteToken(body));
  if (url.pathname === '/api/workspace') return ctx.execute(renameWorkspace(body));
  const match = /^\/api\/boards\/([^/]+)(\/delete)?$/.exec(url.pathname);
  if (match) return ctx.execute(mutateBoard(match[1], match[2] !== undefined, body));
  if (url.pathname === '/api/updates/check')
    return ctx.execute(Effect.flatMap(UpdateService, (updates) => updates.checkForUpdates));
  if (url.pathname === '/api/updates/replay' && ctx.preview) return ctx.execute(ctx.preview.reset);
  if (url.pathname === '/api/updates/install')
    return ctx.execute(Effect.flatMap(UpdateService, (updates) => updates.installUpdate));
  if (url.pathname === '/api/updates/restart')
    return ctx.execute(Effect.flatMap(UpdateService, (updates) => updates.restartApp));
  if (url.pathname === '/api/updates/download')
    return ctx.execute(Effect.flatMap(UpdateService, (updates) => updates.openDownloadPage));
  return undefined;
};

const makeFetch =
  (ctx: RequestContext, port: () => number) =>
  async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const origin = `http://127.0.0.1:${port()}`;
    if (url.origin !== origin) return new Response('Invalid host', { status: 403 });
    if (url.pathname === '/' && url.searchParams.get('session') === ctx.token) return signIn(ctx.token);
    if (!isAuthorized(request, ctx.token)) return new Response('Open this workspace from Blackboard.', { status: 401 });
    if (isCrossOriginWrite(request, origin, ctx.token)) return new Response('Invalid origin', { status: 403 });
    if (request.method === 'GET') return (await handleGet(url, ctx)) ?? notFound();
    if (request.method === 'POST') return (await handlePost(request, url, ctx)) ?? notFound();
    return notFound();
  };

const broadcast = async (ctx: RequestContext) => {
  try {
    const state = await ctx.getState();
    const ids = new Set(state.workspace.boards.map((board) => board.id));
    for (const subscriber of ctx.subscribers) {
      const seen = ctx.lastSent.get(subscriber) ?? new Map<string, number>();
      const boards = state.workspace.boards.map((board) =>
        seen.get(board.id) === board.revision ? { ...board, html: null } : board,
      );
      for (const id of seen.keys()) if (!ids.has(id)) seen.delete(id);
      for (const board of state.workspace.boards) seen.set(board.id, board.revision);
      ctx.lastSent.set(subscriber, seen);
      try {
        subscriber.enqueue(
          ctx.encoder.encode(`data: ${JSON.stringify({ ...state, workspace: { ...state.workspace, boards } })}\n\n`),
        );
      } catch {
        ctx.subscribers.delete(subscriber);
        ctx.lastSent.delete(subscriber);
      }
    }
    // A single failed frame must not end the change stream and silence updates.
  } catch (error) {
    console.error(error);
  }
};

const watch = (
  ctx: RequestContext,
  abort: AbortController,
  effect: Effect.Effect<void, never, WorkspaceService | UpdateService>,
) => {
  void ctx.runtime.runPromise(effect, { signal: abort.signal }).catch((error) => {
    if (!abort.signal.aborted) console.error(error);
  });
};

const watchWorkspace = (ctx: RequestContext, abort: AbortController) =>
  watch(
    ctx,
    abort,
    Effect.gen(function* () {
      yield* Stream.runForEach((yield* WorkspaceService).changes, () => Effect.promise(() => broadcast(ctx)));
    }),
  );

const watchUpdates = (ctx: RequestContext, abort: AbortController) =>
  watch(
    ctx,
    abort,
    Effect.gen(function* () {
      yield* Stream.runForEach((yield* UpdateService).stateChanges, () => Effect.promise(() => broadcast(ctx)));
    }),
  );

export async function startWorkspaceServer(
  options: {
    readonly path?: string;
    readonly updates?: Partial<UpdateDependencies>;
    readonly agentCommand?: string;
    readonly agentArgs?: readonly string[];
    readonly previewUpdates?: boolean;
  } = {},
) {
  // Bun's HTML type declaration describes its bundler entrypoint; this import
  // explicitly uses the text loader. Check that boundary before serving it.
  const embeddedPage: unknown = html;
  const page = typeof embeddedPage === 'string' ? embeddedPage : null;
  if (page === null) throw new Error('The workspace document was not embedded as text.');
  const preview = options.previewUpdates ? await Effect.runPromise(makeUpdatePreview) : undefined;
  const runtime: ServerRuntime = ManagedRuntime.make(
    Layer.mergeAll(
      WorkspaceService.makeLayer({ path: options.path }),
      preview ? Layer.succeed(UpdateService, preview.service) : UpdateService.makeLayer(options.updates),
    ),
  );
  // Acquire storage before opening a window. Invalid files are preserved.
  await runtime.runPromise(Effect.flatMap(WorkspaceService, (service) => service.get));
  const editorNonce = crypto.randomUUID().replaceAll('-', '');
  const ctx: RequestContext = {
    runtime,
    token: crypto.randomUUID() + crypto.randomUUID(),
    page: page.replace('</head>', `<meta name="blackboard-editor-nonce" content="${editorNonce}"></head>`),
    editorNonce,
    script: await buildClientScript(),
    preview,
    subscribers: new Set(),
    lastSent: new Map(),
    encoder: new TextEncoder(),
    getState: () =>
      readState(
        runtime,
        { command: options.agentCommand ?? 'bun', args: options.agentArgs ?? ['run', 'mcp'] },
        preview !== undefined,
      ),
    execute: makeExecutor(runtime),
  };
  // `fetch` needs the bound port, which is only known once the server starts.
  let port = 0;
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    maxRequestBodySize: 4_500_000,
    idleTimeout: 0,
    fetch: makeFetch(ctx, () => port),
    error(error) {
      console.error(error);
      return json({ error: 'The workspace request failed.' }, 500);
    },
  });
  port = server.port ?? 0;
  const abort = new AbortController();
  watchWorkspace(ctx, abort);
  watchUpdates(ctx, abort);
  return {
    origin: `http://127.0.0.1:${port}`,
    token: ctx.token,
    url: `http://127.0.0.1:${port}/?session=${ctx.token}`,
    runtime,
    async close() {
      abort.abort();
      for (const subscriber of ctx.subscribers) {
        try {
          subscriber.close();
        } catch {}
      }
      ctx.subscribers.clear();
      await server.stop(true);
      await runtime.dispose();
    },
  };
}
