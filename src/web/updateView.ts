import type { UpdateInfo } from '../domain/models';

/** The update dialog's words and progress, separated from the DOM so the
 * branching can be exercised directly. `preview` is the interactive
 * demonstration workflow that never touches the installed app. */
export interface UpdateStep {
  readonly label: string;
  readonly state: 'done' | 'current' | 'todo';
  readonly marker: string;
}
export interface UpdateView {
  readonly working: boolean;
  readonly title: string;
  readonly message: string;
  readonly steps: readonly UpdateStep[];
}

const isWorking = (info: UpdateInfo, preview: boolean) =>
  ['checking', 'downloading', 'installing'].includes(info.status) || (info.status === 'restarting' && !preview);

const titleFor = (info: UpdateInfo, preview: boolean) => {
  if (info.status === 'restarting' && preview) return "You're all set.";
  if (info.status === 'ready-to-restart') return 'Ready when you are.';
  return info.hasUpdate ? `Blackboard ${info.latestVersion}` : 'App updates';
};

const stageFor = (info: UpdateInfo) => {
  if (info.status === 'restarting') return 3;
  if (info.status === 'ready-to-restart') return 2;
  return ['downloading', 'installing'].includes(info.status) ? 1 : 0;
};

const messageFor = (info: UpdateInfo, preview: boolean): string => {
  switch (info.status) {
    case 'available':
      return "A new version is ready. Download the signed update, then restart whenever you're ready.";
    case 'downloading':
    case 'installing':
      return 'Downloading, verifying, and installing the signed update. You can keep working.';
    case 'ready-to-restart':
      return 'The signed update is installed. Restart Blackboard to finish. Your canvases are saved locally.';
    case 'manual-download':
      return preview
        ? 'DMG download simulated. The real action opens the release download in your browser, with instructions to install it in Applications.'
        : 'The download has opened in your browser. Open the DMG, drag Blackboard to Applications, then reopen it.';
    case 'up-to-date':
      return "You're on the latest version.";
    case 'checking':
      return 'Checking for a signed update…';
    case 'restarting':
      return preview
        ? `Restart simulated. Blackboard would reopen at version ${info.latestVersion}, with your canvases where you left them.`
        : 'Restarting Blackboard…';
    case 'error':
      return info.errorMessage ?? 'Could not complete the update.';
    default:
      return 'Check for the latest signed release of Blackboard.';
  }
};

export function describeUpdate(info: UpdateInfo, preview: boolean): UpdateView {
  const stage = stageFor(info);
  const steps: readonly UpdateStep[] = ['Available', 'Download & verify', 'Restart'].map((label, index) => ({
    label,
    state: index < stage ? 'done' : index === stage ? 'current' : 'todo',
    marker: index < stage ? '✓' : String(index + 1),
  }));
  return {
    working: isWorking(info, preview),
    title: titleFor(info, preview),
    message: messageFor(info, preview),
    steps,
  };
}

export const showUpdateNotice = (info: UpdateInfo): boolean => info.hasUpdate || info.status === 'error';
