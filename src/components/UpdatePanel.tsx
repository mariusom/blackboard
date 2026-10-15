import React, { useEffect, useState } from "react"
import { isUpdateBusy, type AppThemeConfig, type UpdateInfo } from "../domain/models"

export interface UpdatePanelProps {
  readonly info: UpdateInfo
  readonly theme: AppThemeConfig
  readonly onInstall: () => void
  readonly onRestart: () => void
  readonly onCheck: () => void
  readonly onDownload: () => void
  readonly onDismiss: () => void
}

function Action({ label, testId, onClick, primary = false, disabled = false, theme }: {
  readonly label: string
  readonly testId: string
  readonly onClick: () => void
  readonly primary?: boolean
  readonly disabled?: boolean
  readonly theme: AppThemeConfig
}) {
  const activate = () => { if (!disabled) onClick() }
  return (
    <div
      role="button"
      aria-label={label}
      aria-description={disabled ? "Please wait for the update to finish" : undefined}
      tabIndex={disabled ? -1 : 0}
      testId={testId}
      onClick={activate}
      onKeyDown={(event) => { if (event.key === "enter" || event.key === "space") activate() }}
      style={{
        paddingTop: 9, paddingBottom: 9, paddingLeft: 15, paddingRight: 15,
        borderRadius: 7, backgroundColor: primary ? (disabled ? "#164e63" : "#0284c7") : theme.buttonBg,
        opacity: disabled ? 0.65 : 1, cursor: disabled ? "default" : "pointer",
      }}
    >
      <text style={{ color: primary ? "#ffffff" : theme.textPrimary, fontSize: 12, fontWeight: "bold" }}>{label}</text>
    </div>
  )
}

function WorkingIndicator({ label }: { readonly label: string }) {
  const [bright, setBright] = useState(false)
  useEffect(() => {
    const timer = setInterval(() => setBright((value) => !value), 800)
    return () => clearInterval(timer)
  }, [])
  return (
    <div role="progressbar" aria-label={label} aria-valuetext={label} testId="update-progress" style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8 }}>
      <div motion={{ initial: { opacity: 0.35 }, animate: { opacity: bright ? 1 : 0.35 }, transition: { duration: 0.7 } }} style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: "#38bdf8" }} />
      <text style={{ color: "#7dd3fc", fontSize: 11 }}>{label}</text>
    </div>
  )
}

export function UpdatePanel({ info, theme, onInstall, onRestart, onCheck, onDownload, onDismiss }: UpdatePanelProps) {
  const busy = isUpdateBusy(info.status)
  const working = info.status === "downloading" || info.status === "installing"
  const ready = info.status === "ready-to-restart"
  const restarting = info.status === "restarting"
  const manual = info.status === "manual-download"
  const title = manual ? "Continue with the DMG"
    : restarting ? "Restarting Blackboard…"
    : ready ? "Your update is installed"
      : working ? "Updating Blackboard…"
        : info.status === "checking" ? "Checking for updates…"
          : info.status === "error" ? "The update needs your attention"
            : info.hasUpdate ? `Blackboard ${info.latestVersion} is ready`
              : info.status === "up-to-date" ? "You're up to date"
                : "Keep Blackboard up to date"
  const description = manual ? "Your browser is opening the download. Open the DMG, drag Blackboard to Applications, and reopen it."
    : restarting ? "Opening the updated application."
    : ready ? `Restart when you're ready to use version ${info.latestVersion}.`
      : working ? `Downloading, verifying, and installing version ${info.latestVersion}. Keep Blackboard open.`
        : info.status === "checking" ? "Looking for the latest signed macOS release."
          : info.status === "error" ? "Try again, or use the DMG download to update manually."
            : info.hasUpdate ? (info.canInstallAutomatically
              ? `You're using ${info.currentVersion}. Install the new version, then choose when to restart.`
              : info.installHint ?? "Download the DMG and drag Blackboard to Applications.")
              : info.status === "up-to-date" ? `Blackboard ${info.currentVersion} is the latest version.`
                : "Check for the latest improvements and fixes."
  const primaryLabel = manual ? "Open download again"
    : restarting ? "Restarting…"
    : ready ? "Restart now"
      : working ? "Updating…"
        : info.status === "checking" ? "Checking…"
          : info.status === "error" ? (info.hasUpdate && !info.canInstallAutomatically ? "Download DMG" : "Try again")
            : info.hasUpdate ? (info.canInstallAutomatically ? "Download and install" : "Download DMG")
              : "Check again"
  const primaryAction = manual ? onDownload
    : ready ? onRestart
    : info.hasUpdate ? (info.canInstallAutomatically ? onInstall : onDownload)
      : onCheck

  return (
    <div role="region" aria-label="Software update" testId="update-panel" style={{ display: "flex", flexDirection: "column", flexShrink: 0, gap: 13, padding: 16, borderRadius: 12, borderWidth: 1, borderColor: ready ? "#047857" : "#164e63", backgroundColor: theme.cardBg }}>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 12 }}>
        <div style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: ready ? "#064e3b" : "#082f49", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <text style={{ color: ready ? "#6ee7b7" : "#7dd3fc", fontSize: 21 }}>{ready ? "✓" : "↓"}</text>
        </div>
        <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, gap: 4 }}>
          <text role="heading" aria-level={2} style={{ color: theme.textPrimary, fontSize: 15, fontWeight: "bold" }}>{title}</text>
          <text style={{ color: theme.textSecondary, fontSize: 12 }}>{description}</text>
        </div>
      </div>
      {(info.hasUpdate || working || ready || restarting) && (
        <div style={{ display: "flex", flexDirection: "row", gap: 8 }}>
          {["Available", "Download & verify", "Restart"].map((label, index) => {
            const reached = index === 0 || (index === 1 && (working || ready || restarting)) || (index === 2 && (ready || restarting))
            return <div key={label} style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 7, flexGrow: 1, borderRadius: 6, padding: 8, backgroundColor: reached ? "#082f49" : theme.background }}>
              <text style={{ color: reached ? "#7dd3fc" : theme.textSecondary, fontSize: 11 }}>{`${index + 1}  ${label}`}</text>
            </div>
          })}
        </div>
      )}
      {info.errorMessage && <text role="alert" testId="update-error" style={{ color: "#fca5a5", fontSize: 12 }}>{info.errorMessage}</text>}
      {busy && <WorkingIndicator label={working ? "Working securely — you'll be asked to restart when it's ready." : restarting ? "Restarting the app…" : "Contacting GitHub Releases…"} />}
      <div style={{ display: "flex", flexDirection: "row", gap: 8, alignItems: "center" }}>
        <Action label={primaryLabel} testId={manual ? "update-download" : ready || restarting ? "update-restart" : info.hasUpdate ? (info.canInstallAutomatically ? "update-install" : "update-download") : "update-check"} onClick={primaryAction} primary disabled={busy} theme={theme} />
        {!busy && !ready && !manual && (!info.hasUpdate || info.canInstallAutomatically) && <Action label={info.hasUpdate ? "Download DMG" : "Download latest"} testId="update-download" onClick={onDownload} theme={theme} />}
        {!busy && <Action label={ready ? "Restart later" : "Later"} testId="update-dismiss" onClick={onDismiss} theme={theme} />}
        {info.hasUpdate && !busy && !ready && <text style={{ color: theme.textSecondary, fontSize: 10 }}>macOS · Apple Silicon · signed update</text>}
      </div>
    </div>
  )
}
