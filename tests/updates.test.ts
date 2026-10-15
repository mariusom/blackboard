import { describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import { APP_VERSION } from '../src/domain/models';
import { UpdateService, type SignedUpdate, type UpdateDependencies } from '../src/services/UpdateService';

const fakeUpdate = (install = async () => {}): SignedUpdate => ({
  version: '9.9.9',
  downloadUrl: 'https://github.com/mariusom/blackboard/releases/download/v9.9.9/Blackboard-aarch64.app.tar.gz',
  format: 'app',
  downloadAndInstall: install,
});
const layer = (overrides: Partial<UpdateDependencies> = {}) =>
  UpdateService.makeLayer({
    publicKey: 'pinned-test-key',
    execPath: '/Applications/Blackboard.app/Contents/MacOS/blackboard',
    platform: 'darwin',
    checkUpdate: async () => fakeUpdate(),
    relaunch: async () => {},
    ...overrides,
  });

const checkAndInstall = Effect.gen(function* () {
  const updates = yield* UpdateService;
  yield* updates.checkForUpdates;
  return yield* updates.installUpdate;
});

describe('signed application updates', () => {
  it.effect('starts idle and passes the embedded trust key and current version to the native verifier', () => {
    let checked = false;
    return Effect.gen(function* () {
      const updates = yield* UpdateService;
      expect((yield* updates.getUpdateState).status).toBe('idle');
      const result = yield* updates.checkForUpdates;
      expect(checked).toBe(true);
      expect(result.status).toBe('available');
      expect(result.latestVersion).toBe('9.9.9');
    }).pipe(
      Effect.provide(
        layer({
          checkUpdate: async (version, options) => {
            expect(version).toBe(APP_VERSION);
            expect(options.pubkey).toBe('pinned-test-key');
            expect(options.endpoints).toEqual(['https://github.com/mariusom/blackboard/releases/latest']);
            checked = true;
            return fakeUpdate();
          },
        }),
      ),
    );
  });

  it.effect('refuses an unconfigured trust key before contacting the feed', () => {
    let checked = false;
    return Effect.gen(function* () {
      const updates = yield* UpdateService;
      expect((yield* Effect.exit(updates.checkForUpdates))._tag).toBe('Failure');
      const state = yield* updates.getUpdateState;
      expect(checked).toBe(false);
      expect(state.status).toBe('error');
      expect(state.errorMessage).toContain('not configured');
    }).pipe(
      Effect.provide(
        layer({
          publicKey: '',
          checkUpdate: async () => {
            checked = true;
            return null;
          },
        }),
      ),
    );
  });

  it.effect('reports no update when the native verifier returns null', () =>
    Effect.gen(function* () {
      const state = yield* (yield* UpdateService).checkForUpdates;
      expect(state.status).toBe('up-to-date');
      expect(state.hasUpdate).toBe(false);
      expect(state.downloadUrl).toBeNull();
    }).pipe(Effect.provide(layer({ checkUpdate: async () => null }))),
  );

  for (const update of [
    { ...fakeUpdate(), version: APP_VERSION },
    { ...fakeUpdate(), version: '0.0.0' },
    { ...fakeUpdate(), version: 'invalid' },
    { ...fakeUpdate(), format: 'dmg' },
    { ...fakeUpdate(), downloadUrl: 'http://example.com/update.tar.gz' },
  ]) {
    it.effect(`rejects unsupported update metadata: ${update.version}, ${update.format}, ${update.downloadUrl}`, () =>
      Effect.gen(function* () {
        const exit = yield* Effect.exit((yield* UpdateService).checkForUpdates);
        expect(exit._tag).toBe('Failure');
      }).pipe(Effect.provide(layer({ checkUpdate: async () => update }))),
    );
  }

  it.effect('surfaces network and missing-signature failures without leaving an installable update', () =>
    Effect.gen(function* () {
      const updates = yield* UpdateService;
      yield* Effect.exit(updates.checkForUpdates);
      expect((yield* Effect.exit(updates.installUpdate))._tag).toBe('Failure');
      const state = yield* updates.getUpdateState;
      expect(state.status).toBe('error');
      expect(state.hasUpdate).toBe(false);
    }).pipe(
      Effect.provide(
        layer({
          checkUpdate: async () => {
            throw new Error('missing .sig');
          },
        }),
      ),
    ),
  );

  it.effect('keeps signature failures visible and never reports readiness or restarts', () => {
    let restarted = false;
    return Effect.gen(function* () {
      const updates = yield* UpdateService;
      yield* updates.checkForUpdates;
      expect((yield* Effect.exit(updates.installUpdate))._tag).toBe('Failure');
      expect((yield* Effect.exit(updates.restartApp))._tag).toBe('Failure');
      const state = yield* updates.getUpdateState;
      expect(restarted).toBe(false);
      expect(state.status).toBe('error');
    }).pipe(
      Effect.provide(
        layer({
          checkUpdate: async () =>
            fakeUpdate(async () => {
              throw new Error('signature mismatch');
            }),
          relaunch: async () => {
            restarted = true;
          },
        }),
      ),
    );
  });

  for (const execPath of [
    '/Volumes/Blackboard/Blackboard.app/Contents/MacOS/blackboard',
    '/tmp/dist/blackboard',
    '/private/var/folders/test/AppTranslocation/id/d/Blackboard.app/Contents/MacOS/blackboard',
  ]) {
    it.effect(`refuses installation from ${execPath}`, () => {
      let installed = false;
      return Effect.gen(function* () {
        const exit = yield* Effect.exit(checkAndInstall);
        expect(exit._tag).toBe('Failure');
        expect(installed).toBe(false);
      }).pipe(
        Effect.provide(
          layer({
            execPath,
            checkUpdate: async () =>
              fakeUpdate(async () => {
                installed = true;
              }),
          }),
        ),
      );
    });
  }

  it.effect('serializes installs, preserves readiness across checks, and restarts the installed bundle', () => {
    let installs = 0;
    let restartedPath = '';
    return Effect.gen(function* () {
      const updates = yield* UpdateService;
      yield* updates.checkForUpdates;
      yield* Effect.all([updates.installUpdate, updates.installUpdate], { concurrency: 'unbounded' });
      const checked = yield* updates.checkForUpdates;
      expect(checked.status).toBe('ready-to-restart');
      yield* updates.restartApp;
      const state = yield* updates.getUpdateState;
      expect(installs).toBe(1);
      expect(restartedPath).toBe('/Applications/Blackboard.app');
      expect(state.status).toBe('restarting');
    }).pipe(
      Effect.provide(
        layer({
          checkUpdate: async () =>
            fakeUpdate(async () => {
              installs++;
            }),
          relaunch: async (appPath) => {
            restartedPath = appPath;
          },
        }),
      ),
    );
  });

  it.effect('allows a restart retry without reinstalling after relaunch fails', () => {
    let attempts = 0;
    return Effect.gen(function* () {
      const updates = yield* UpdateService;
      yield* updates.checkForUpdates;
      yield* updates.installUpdate;
      expect((yield* Effect.exit(updates.restartApp))._tag).toBe('Failure');
      expect((yield* updates.getUpdateState).status).toBe('ready-to-restart');
      yield* updates.restartApp;
      const state = yield* updates.getUpdateState;
      expect(attempts).toBe(2);
      expect(state.status).toBe('restarting');
    }).pipe(
      Effect.provide(
        layer({
          relaunch: async () => {
            attempts++;
            if (attempts === 1) throw new Error('launch failed');
          },
        }),
      ),
    );
  });
});
