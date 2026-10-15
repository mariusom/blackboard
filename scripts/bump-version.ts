import { Console, Effect, Schema } from 'effect';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { SemVer } from '../src/domain/models';

declare const BumpErrorBrand: unique symbol;
export class BumpError extends Schema.TaggedError<BumpError, { readonly brand: typeof BumpErrorBrand }>()('BumpError', {
  message: Schema.String,
}) {}

export type ReleaseType = 'patch' | 'minor' | 'major';

const parseSemVer = (versionStr: string): Effect.Effect<SemVer, BumpError> =>
  Effect.gen(function* () {
    const clean = versionStr.trim().replace(/^v/, '');
    const parts = clean.split('.').map((p) => Number.parseInt(p, 10));
    if (parts.length !== 3 || parts.some(Number.isNaN)) {
      return yield* new BumpError({
        message: `Invalid semver format: '${versionStr}'. Expected format 'X.Y.Z'.`,
      });
    }
    const [major = 0, minor = 0, patch = 0] = parts;
    return { major, minor, patch };
  });

const bumpSemVer = (current: SemVer, type: ReleaseType): SemVer => {
  switch (type) {
    case 'major':
      return { major: current.major + 1, minor: 0, patch: 0 };
    case 'minor':
      return { major: current.major, minor: current.minor + 1, patch: 0 };
    case 'patch':
      return { major: current.major, minor: current.minor, patch: current.patch + 1 };
  }
};

const formatSemVer = (v: SemVer): string => `${v.major}.${v.minor}.${v.patch}`;

export const bumpProjectVersion = (releaseType: ReleaseType = 'patch', rootDir: string = process.cwd()) =>
  Effect.gen(function* () {
    const pkgPath = path.join(rootDir, 'package.json');
    const packagerPath = path.join(rootDir, 'packager.json');

    const pkgRaw = yield* Effect.tryPromise({
      try: () => fs.readFile(pkgPath, 'utf-8'),
      catch: (err) => new BumpError({ message: `Failed to read package.json: ${String(err)}` }),
    });

    const packagerRaw = yield* Effect.tryPromise({
      try: () => fs.readFile(packagerPath, 'utf-8'),
      catch: (err) => new BumpError({ message: `Failed to read packager.json: ${String(err)}` }),
    });

    const pkgJson = JSON.parse(pkgRaw) as { version?: string; [key: string]: unknown };
    const packagerJson = JSON.parse(packagerRaw) as { version?: string; [key: string]: unknown };

    const currentVersionStr = pkgJson.version ?? '0.0.0';
    const parsed = yield* parseSemVer(currentVersionStr);
    const bumped = bumpSemVer(parsed, releaseType);
    const nextVersionStr = formatSemVer(bumped);

    pkgJson.version = nextVersionStr;
    packagerJson.version = nextVersionStr;

    yield* Effect.tryPromise({
      try: () => fs.writeFile(pkgPath, `${JSON.stringify(pkgJson, null, 2)}\n`, 'utf-8'),
      catch: (err) => new BumpError({ message: `Failed to write package.json: ${String(err)}` }),
    });

    yield* Effect.tryPromise({
      try: () => fs.writeFile(packagerPath, `${JSON.stringify(packagerJson, null, 2)}\n`, 'utf-8'),
      catch: (err) => new BumpError({ message: `Failed to write packager.json: ${String(err)}` }),
    });

    return nextVersionStr;
  });

// CLI Entry point
const runCli = Effect.gen(function* () {
  const rawArg = (process.argv[2] ?? 'patch').toLowerCase();
  if (rawArg !== 'patch' && rawArg !== 'minor' && rawArg !== 'major') {
    return yield* new BumpError({
      message: `Invalid bump type '${rawArg}'. Must be 'patch', 'minor', or 'major'.`,
    });
  }
  const newVersion = yield* bumpProjectVersion(rawArg);
  yield* Console.log(newVersion);
});

if (import.meta.main) {
  Effect.runPromise(runCli).catch((err) => {
    console.error('Bump version failed:', err);
    process.exit(1);
  });
}
