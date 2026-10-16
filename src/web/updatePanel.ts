import type { UpdateInfo } from '../domain/models';
import { app } from './appState';
import { element, escapeHtml, icon, icons } from './dom';
import { describeUpdate, showUpdateNotice, type UpdateView } from './updateView';

export interface UpdatePanelDeps {
  readonly request: (path: string, body?: unknown) => Promise<unknown>;
  readonly refresh: () => Promise<void>;
  readonly perform: (action: () => Promise<unknown>) => void;
  readonly notify: (message: string) => void;
}

type UpdateAction = 'check' | 'install' | 'restart' | 'download' | 'replay';

const updateLabel = (info: UpdateInfo) =>
  info.hasUpdate
    ? info.status === 'ready-to-restart'
      ? 'Restart to update'
      : 'New update available'
    : info.status === 'checking'
      ? 'Checking for updates…'
      : info.status === 'error'
        ? 'Update check failed · Retry'
        : info.status === 'up-to-date'
          ? 'Blackboard is up to date'
          : 'Check for updates';

const updateButtons = (info: UpdateInfo, preview: boolean) => {
  if (info.status === 'restarting' && preview)
    return '<button data-update="replay" class="primary">Replay preview</button><button data-later class="quiet">Back to canvas</button>';
  if (info.status === 'ready-to-restart')
    return '<button data-update="restart" class="primary">Restart now</button><button data-later class="quiet">Restart later</button>';
  const manual = info.hasUpdate || info.status === 'manual-download';
  if (info.hasUpdate && info.canInstallAutomatically && info.status !== 'manual-download')
    return `<button data-update="install" class="primary">${info.status === 'error' ? 'Try again' : 'Download and install'}</button><button data-update="download" class="quiet">Download DMG</button>`;
  return `<button data-update="${manual ? 'download' : 'check'}" class="primary">${manual ? 'Download DMG' : 'Check for updates'}</button>`;
};

const updateSteps = (view: UpdateView) =>
  `<div class="update-steps">${view.steps
    .map(
      (step) =>
        `<div class="${step.state === 'todo' ? '' : step.state}" ${step.state === 'current' ? 'aria-current="step"' : ''}><span class="step-dot" aria-hidden="true">${escapeHtml(step.marker)}</span><span>${escapeHtml(step.label)}</span></div>`,
    )
    .join('')}</div>`;

function updateBody(info: UpdateInfo, view: UpdateView, preview: boolean) {
  const notice = preview
    ? '<div class="preview-notice">INTERACTIVE PREVIEW <span>No files are downloaded or installed.</span></div>'
    : '';
  const steps = info.hasUpdate ? updateSteps(view) : '';
  const progress = view.working
    ? '<div class="update-progress" role="progressbar" aria-label="Update in progress"></div>'
    : '';
  const hint =
    info.installHint && !info.canInstallAutomatically
      ? `<p style="font-size:10px;margin:6px 0">${escapeHtml(info.installHint)}</p>`
      : '';
  const error =
    info.errorMessage && info.status !== 'error' ? `<p role="alert">${escapeHtml(info.errorMessage)}</p>` : '';
  return `${notice}${steps}<div class="update-status" role="status">${escapeHtml(view.message)}</div>${progress}${hint}${error}<div class="update-actions">${view.working ? '' : updateButtons(info, preview)}</div><div class="update-version">Current version ${escapeHtml(info.currentVersion)}</div>`;
}

export function createUpdatePanel(deps: UpdatePanelDeps) {
  let busy = false;

  function onUpdateButton(action: string | undefined) {
    if (
      action === 'check' ||
      action === 'install' ||
      action === 'restart' ||
      action === 'download' ||
      action === 'replay'
    )
      deps.perform(() => updateAction(action));
    else element<HTMLDialogElement>('update-dialog').close();
  }

  function renderUpdate() {
    const state = app.state;
    if (!state) return;
    const { update: info, updatePreview: preview } = state;
    const view = describeUpdate(info, preview);
    const button = element('updates-button');
    button.hidden = !showUpdateNotice(info);
    button.classList.toggle('available', info.hasUpdate);
    button.innerHTML = `${icon(icons.update)}<span>${updateLabel(info)}</span>`;
    button.setAttribute(
      'aria-label',
      info.hasUpdate
        ? `${info.status === 'ready-to-restart' ? 'Restart to update' : 'Update available'} · Blackboard ${info.latestVersion}`
        : 'App updates',
    );
    button.title = info.hasUpdate ? `Blackboard ${info.latestVersion} is available` : 'App updates';
    element('update-title').textContent = view.title;
    element('update-body').innerHTML = updateBody(info, view, preview);
    element('update-body')
      .querySelectorAll<HTMLButtonElement>('button')
      .forEach((node) => {
        node.disabled = busy;
        node.addEventListener('click', () => onUpdateButton(node.dataset.update));
      });
  }

  async function updateAction(action: UpdateAction) {
    if (busy) return;
    if (action === 'restart' && window.blackboardHasUnsavedChanges?.()) {
      deps.notify('Save your drafts before restarting.');
      return;
    }
    busy = true;
    renderUpdate();
    try {
      await deps.request(`updates/${action}`, {});
      if (action === 'replay') await deps.request('updates/check', {});
    } finally {
      busy = false;
      await deps.refresh();
    }
  }

  return { renderUpdate, updateAction };
}
