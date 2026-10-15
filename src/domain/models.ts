import { Schema } from 'effect';
import pkg from '../../package.json';

export const APP_VERSION: string = pkg.version;

export const GITHUB_REPO = 'mariusom/blackboard';

// Replaced at compile time. Update trust must not come from the downloaded feed.
declare const BLACKBOARD_UPDATER_PUBLIC_KEY: string;
export const UPDATER_PUBLIC_KEY =
  typeof BLACKBOARD_UPDATER_PUBLIC_KEY === 'undefined' ? '' : BLACKBOARD_UPDATER_PUBLIC_KEY;

declare const UpdateErrorBrand: unique symbol;
export class UpdateError extends Schema.TaggedError<UpdateError, { readonly brand: typeof UpdateErrorBrand }>()(
  'UpdateError',
  {
    message: Schema.String,
    cause: Schema.optional(Schema.String),
  },
) {}

export const SemVer = Schema.Struct({
  major: Schema.Finite,
  minor: Schema.Finite,
  patch: Schema.Finite,
});
export type SemVer = typeof SemVer.Type;

export const UpdateStatus = Schema.Literals([
  'idle',
  'checking',
  'available',
  'manual-download',
  'up-to-date',
  'downloading',
  'installing',
  'ready-to-restart',
  'restarting',
  'error',
]);
export type UpdateStatus = typeof UpdateStatus.Type;

export const UpdateInfo = Schema.Struct({
  currentVersion: Schema.String,
  latestVersion: Schema.String,
  hasUpdate: Schema.Boolean,
  downloadUrl: Schema.NullOr(Schema.String),
  releaseUrl: Schema.String,
  status: UpdateStatus,
  errorMessage: Schema.NullOr(Schema.String),
  canInstallAutomatically: Schema.Boolean,
  installHint: Schema.NullOr(Schema.String),
});
export type UpdateInfo = typeof UpdateInfo.Type;

export const INITIAL_UPDATE_INFO: UpdateInfo = {
  currentVersion: APP_VERSION,
  latestVersion: APP_VERSION,
  hasUpdate: false,
  downloadUrl: null,
  releaseUrl: `https://github.com/${GITHUB_REPO}/releases/latest`,
  status: 'idle',
  errorMessage: null,
  canInstallAutomatically: false,
  installHint: null,
};

export function parseSemVer(versionStr: string): SemVer | null {
  const normalized = versionStr.trim().replace(/^[vV]/, '');
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(normalized);
  if (!match) {
    return null;
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

export function isNewerVersion(currentVersion: string, candidateVersion: string): boolean {
  const current = parseSemVer(currentVersion);
  const candidate = parseSemVer(candidateVersion);
  if (!current || !candidate) {
    return false;
  }
  if (candidate.major !== current.major) {
    return candidate.major > current.major;
  }
  if (candidate.minor !== current.minor) {
    return candidate.minor > current.minor;
  }
  return candidate.patch > current.patch;
}

export function resolveTargetAppBundlePath(execPath: string): string {
  const marker = '.app/Contents/MacOS/';
  const markerIndex = execPath.indexOf(marker);
  if (markerIndex !== -1 && !execPath.includes('/Volumes/')) {
    return execPath.slice(0, markerIndex + '.app'.length);
  }
  return '/Applications/Blackboard.app';
}
