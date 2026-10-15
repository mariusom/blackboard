import type { UpdateInfo } from "../domain/models"

/** The update dialog's words and progress, separated from the DOM so the
 * branching can be exercised directly. `preview` is the interactive
 * demonstration workflow that never touches the installed app. */
export interface UpdateStep {
  readonly label: string
  readonly state: "done" | "current" | "todo"
  readonly marker: string
}
export interface UpdateView {
  readonly working: boolean
  readonly title: string
  readonly message: string
  readonly steps: readonly UpdateStep[]
}

export function describeUpdate(info: UpdateInfo, preview: boolean): UpdateView {
  const working = ["checking", "downloading", "installing"].includes(info.status) || (info.status === "restarting" && !preview)
  const title =
    info.status === "restarting" && preview
      ? "You're all set."
      : info.status === "ready-to-restart"
        ? "Ready when you are."
        : info.hasUpdate
          ? `Blackboard ${info.latestVersion}`
          : "App updates"
  const message =
    info.status === "available"
      ? "A new version is ready. Download the signed update, then restart whenever you're ready."
      : info.status === "downloading" || info.status === "installing"
        ? "Downloading, verifying, and installing the signed update. You can keep working."
        : info.status === "ready-to-restart"
          ? "The signed update is installed. Restart Blackboard to finish. Your canvases are saved locally."
          : info.status === "manual-download"
            ? preview
              ? "DMG download simulated. The real action opens the release download in your browser, with instructions to install it in Applications."
              : "The download has opened in your browser. Open the DMG, drag Blackboard to Applications, then reopen it."
            : info.status === "up-to-date"
              ? "You're on the latest version."
              : info.status === "checking"
                ? "Checking for a signed update…"
                : info.status === "restarting"
                  ? preview
                    ? `Restart simulated. Blackboard would reopen at version ${info.latestVersion}, with your canvases where you left them.`
                    : "Restarting Blackboard…"
                  : info.status === "error"
                    ? (info.errorMessage ?? "Could not complete the update.")
                    : "Check for the latest signed release of Blackboard."
  const stage =
    info.status === "restarting" ? 3 : info.status === "ready-to-restart" ? 2 : ["downloading", "installing"].includes(info.status) ? 1 : 0
  const steps: readonly UpdateStep[] = ["Available", "Download & verify", "Restart"].map((label, index) => ({
    label,
    state: index < stage ? "done" : index === stage ? "current" : "todo",
    marker: index < stage ? "✓" : String(index + 1)
  }))
  return { working, title, message, steps }
}
