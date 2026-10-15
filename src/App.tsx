import React, { useEffect, useState, useCallback, useRef } from "react"
import { Effect, Schedule, Stream } from "effect"
import { appRuntime } from "./services/AppRuntime"
import { GreetingService } from "./services/GreetingService"
import { CounterService } from "./services/CounterService"
import { ActivityService } from "./services/ActivityService"
import { ThemeService } from "./services/ThemeService"
import { UpdateService } from "./services/UpdateService"
import { CanvasService } from "./services/CanvasService"
import { UpdatePanel } from "./components/UpdatePanel"
import { BrowserCanvas } from "./components/BrowserCanvas"
import {
  APP_THEMES,
  APP_VERSION,
  INITIAL_UPDATE_INFO,
  isUpdateBusy,
  INITIAL_GREETINGS,
  type AppThemeConfig,
  type TelemetryEvent,
  type UpdateInfo,
} from "./domain/models"
import {
  CANVAS_MCP_RESOURCE_URI,
  INITIAL_CANVAS_ELEMENTS,
  type CanvasElement,
} from "./domain/canvas"
import { CanvasMcpProtocols } from "./mcp/server"

const CANVAS_URL = "canvas://blackboard/home"

export function App({ runtime = appRuntime }: { readonly runtime?: typeof appRuntime } = {}) {
  const [theme, setTheme] = useState<AppThemeConfig>(APP_THEMES.charcoal)
  const [greetingLabel, setGreetingLabel] = useState<string>(`${INITIAL_GREETINGS[0].greeting} · ${INITIAL_GREETINGS[0].language}`)
  const [count, setCount] = useState<number>(0)
  const [counterError, setCounterError] = useState<string | null>(null)
  const [history, setHistory] = useState<readonly TelemetryEvent[]>([])
  const [canvasElements, setCanvasElements] = useState<readonly CanvasElement[]>(INITIAL_CANVAS_ELEMENTS)
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo>(INITIAL_UPDATE_INFO)
  const [showUpdates, setShowUpdates] = useState(false)
  const dismissedVersion = useRef<string | null>(null)

  const refreshState = useCallback(() => {
    runtime
      .runPromise(
        Effect.gen(function* () {
          const greetingSvc = yield* GreetingService
          const counterSvc = yield* CounterService
          const activitySvc = yield* ActivityService
          const themeSvc = yield* ThemeService
          const canvasSvc = yield* CanvasService

          const currentTheme = yield* themeSvc.getTheme
          const currentGreeting = yield* greetingSvc.getCurrentGreeting
          const currentCount = yield* counterSvc.getCount
          const currentHistory = yield* activitySvc.getHistory
          const elements = yield* canvasSvc.listElements

          return {
            theme: currentTheme,
            greeting: currentGreeting,
            count: currentCount,
            history: currentHistory,
            elements,
          }
        }),
      )
      .then((state) => {
        setTheme(state.theme)
        setGreetingLabel(`${state.greeting.greeting} · ${state.greeting.language}`)
        setCount(state.count)
        setHistory(state.history)
        setCanvasElements(state.elements)
      })
  }, [runtime])

  const handleCheckUpdates = useCallback(() => {
    runtime
      .runPromise(
        Effect.gen(function* () {
          const updateSvc = yield* UpdateService
          const activitySvc = yield* ActivityService
          const previous = yield* updateSvc.getUpdateState
          const result = yield* updateSvc.checkForUpdates.pipe(
            Effect.map((info) => ({ info, error: null as string | null })),
            Effect.catchTag("UpdateError", (err) =>
              Effect.succeed({ info: null as UpdateInfo | null, error: err.message as string | null }),
            ),
          )
          if (result.error) {
            yield* activitySvc.record("Update Check", `Update check failed: ${result.error}`, "warn")
          } else if (result.info && result.info.hasUpdate && (previous.latestVersion !== result.info.latestVersion || !previous.hasUpdate)) {
            yield* activitySvc.record(
              "Update Check",
              `New update v${result.info.latestVersion} is available`,
              "success",
            )
          } else if (result.info && !result.info.hasUpdate && previous.status !== "up-to-date") {
            yield* activitySvc.record(
              "Update Check",
              `App is up to date (v${result.info.currentVersion})`,
              "info",
            )
          }
          return yield* activitySvc.getHistory
        }),
      )
      .then(setHistory)
  }, [runtime])

  useEffect(() => {
    const controller = new AbortController()
    runtime.runPromise(Effect.gen(function* () {
      const updates = yield* UpdateService
      yield* Stream.runForEach(updates.stateChanges, (info) => Effect.sync(() => {
        setUpdateInfo(info)
        if (info.status === "error" || info.status === "ready-to-restart" ||
          (info.hasUpdate && info.latestVersion !== dismissedVersion.current)) setShowUpdates(true)
      }))
    }), { signal: controller.signal }).catch((error) => {
      if (!controller.signal.aborted) console.error("Could not observe update status", error)
    })
    return () => controller.abort()
  }, [runtime])

  useEffect(() => {
    refreshState()
    const controller = new AbortController()
    runtime.runPromise(
      Effect.sync(handleCheckUpdates).pipe(Effect.repeat(Schedule.spaced("6 hours"))),
      { signal: controller.signal },
    ).catch((error) => {
      if (!controller.signal.aborted) console.error("Could not schedule update checks", error)
    })
    return () => controller.abort()
  }, [refreshState, handleCheckUpdates])

  const handleUpdateAction = useCallback(() => {
    if (isUpdateBusy(updateInfo.status)) return
    runtime.runPromise(Effect.gen(function* () {
      const updates = yield* UpdateService
      const activity = yield* ActivityService
      const restarting = (yield* updates.getUpdateState).status === "ready-to-restart"
      yield* (restarting ? updates.restartApp : updates.installUpdate).pipe(
        Effect.tap(() => activity.record("App Update", restarting ? "Restarting Blackboard" : "Update installed. Restart when you're ready.", "success")),
        Effect.catchTag("UpdateError", (error) => activity.record("App Update", error.message, "warn")),
      )
      return yield* activity.getHistory
    })).then(setHistory)
  }, [runtime, updateInfo.status])

  const handleDownloadUpdate = useCallback(() => {
    runtime.runPromise(Effect.gen(function* () {
      const updates = yield* UpdateService
      yield* updates.openDownloadPage.pipe(Effect.catchTag("UpdateError", () => Effect.void))
    }))
  }, [runtime])

  const handleOpenUpdates = () => {
    setShowUpdates(true)
    if (!updateInfo.hasUpdate && !isUpdateBusy(updateInfo.status)) handleCheckUpdates()
  }

  const handleDismissUpdates = () => {
    dismissedVersion.current = updateInfo.latestVersion
    setShowUpdates(false)
  }

  const handleRemoveElement = (id: string) => {
    runtime
      .runPromise(
        Effect.gen(function* () {
          const canvasSvc = yield* CanvasService
          const activitySvc = yield* ActivityService
          yield* canvasSvc.removeElement(id)
          yield* activitySvc.record("Canvas Edit", `Removed element '${id}'`, "info")
          const elements = yield* canvasSvc.listElements
          const hist = yield* activitySvc.getHistory
          return { elements, hist }
        }),
      )
      .then(({ elements, hist }) => {
        setCanvasElements(elements)
        setHistory(hist)
      })
  }

  const handleClearCanvas = () => {
    runtime
      .runPromise(
        Effect.gen(function* () {
          const canvasSvc = yield* CanvasService
          const activitySvc = yield* ActivityService
          yield* canvasSvc.clearElements
          yield* activitySvc.record("Canvas Edit", "Cleared all canvas elements", "warn")
          const hist = yield* activitySvc.getHistory
          return { hist }
        }),
      )
      .then(({ hist }) => {
        setCanvasElements([])
        setHistory(hist)
      })
  }

  const handleAddSample = () => {
    runtime
      .runPromise(
        Effect.gen(function* () {
          const canvasSvc = yield* CanvasService
          const activitySvc = yield* ActivityService
          yield* canvasSvc.createElement({
            tag: "card",
            text: "Shipped via CanvasService",
            subtitle: "Same path the MCP tools use — tag + text + css.",
            glyph: "✦",
            style: { background: "#f9fafb", borderRadius: 10, padding: 12 },
          })
          yield* activitySvc.record("Canvas Edit", "Added sample card element", "success")
          const elements = yield* canvasSvc.listElements
          const hist = yield* activitySvc.getHistory
          return { elements, hist }
        }),
      )
      .then(({ elements, hist }) => {
        setCanvasElements(elements)
        setHistory(hist)
      })
  }

  const handleIncrement = (delta: number) => {
    setCounterError(null)
    runtime
      .runPromise(
        Effect.gen(function* () {
          const counterSvc = yield* CounterService
          const activitySvc = yield* ActivityService
          const updated = yield* counterSvc.increment(delta)
          yield* activitySvc.record("Counter Increment", `Count increased by ${delta} to ${updated}`, "success")
          const hist = yield* activitySvc.getHistory
          return { updated, hist }
        }),
      )
      .then(({ updated, hist }) => {
        setCount(updated)
        setHistory(hist)
      })
  }

  const handleNextGreeting = () => {
    runtime
      .runPromise(
        Effect.gen(function* () {
          const greetingSvc = yield* GreetingService
          const activitySvc = yield* ActivityService
          const next = yield* greetingSvc.nextGreeting
          yield* activitySvc.record("Greeting Cycled", `Advanced to ${next.language}`, "info")
          const hist = yield* activitySvc.getHistory
          return { next, hist }
        }),
      )
      .then(({ next, hist }) => {
        setGreetingLabel(`${next.greeting} · ${next.language}`)
        setHistory(hist)
      })
  }

  const handleCycleTheme = () => {
    runtime
      .runPromise(
        Effect.gen(function* () {
          const themeSvc = yield* ThemeService
          const activitySvc = yield* ActivityService
          const nextTheme = yield* themeSvc.cycleTheme
          yield* activitySvc.record("Theme Changed", `Theme switched to ${nextTheme.name}`, "info")
          const hist = yield* activitySvc.getHistory
          return { nextTheme, hist }
        }),
      )
      .then(({ nextTheme, hist }) => {
        setTheme(nextTheme)
        setHistory(hist)
      })
  }

  const handleClearHistory = () => {
    runtime.runPromise(
      Effect.gen(function* () {
        const activitySvc = yield* ActivityService
        yield* activitySvc.clear
      }),
    ).then(() => {
      setHistory([])
    })
  }

  const updateLabel = updateInfo.status === "restarting" ? "Restarting…"
    : updateInfo.status === "ready-to-restart" ? "Restart to update"
      : updateInfo.status === "downloading" || updateInfo.status === "installing" ? "Updating…"
        : updateInfo.status === "checking" ? "Checking…"
          : updateInfo.hasUpdate ? "Update available" : "Updates"

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        backgroundColor: theme.background,
        padding: 16,
        gap: 12,
      }}
    >
      {/* Slim top bar */}
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 30,
              height: 30,
              borderRadius: 7,
              backgroundColor: "#d97706",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <text style={{ color: "#ffffff", fontSize: 16, fontWeight: "bold" }}>B</text>
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <text style={{ color: theme.textPrimary, fontSize: 15, fontWeight: "bold" }}>
              Blackboard
            </text>
            <text style={{ color: theme.textSecondary, fontSize: 11 }}>
              {`v${APP_VERSION} · browser canvas · MCP ${CanvasMcpProtocols[0]}`}
            </text>
          </div>
          <div
            style={{
              paddingTop: 3,
              paddingBottom: 3,
              paddingLeft: 8,
              paddingRight: 8,
              borderRadius: 5,
              backgroundColor: "#059669",
            }}
          >
            <text style={{ color: "#ffffff", fontSize: 10, fontWeight: "bold" }}>
              ● MCP canvas live
            </text>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "row", gap: 8, alignItems: "center" }}>
          <div
            onClick={handleCycleTheme}
            style={{
              paddingTop: 6,
              paddingBottom: 6,
              paddingLeft: 12,
              paddingRight: 12,
              borderRadius: 6,
              backgroundColor: theme.buttonBg,
              cursor: "pointer",
            }}
          >
            <text style={{ color: theme.textPrimary, fontSize: 12, fontWeight: "bold" }}>
              Theme: {theme.name}
            </text>
          </div>
          <div
            role="button"
            aria-label={updateLabel}
            testId="update-menu"
            tabIndex={0}
            onClick={handleOpenUpdates}
            onKeyDown={(event) => { if (event.key === "enter" || event.key === "space") handleOpenUpdates() }}
            style={{
              paddingTop: 6,
              paddingBottom: 6,
              paddingLeft: 12,
              paddingRight: 12,
              borderRadius: 6,
              backgroundColor: updateInfo.hasUpdate ? "#059669" : theme.buttonBg,
              cursor: "pointer",
            }}
          >
            <text
              style={{
                color: updateInfo.hasUpdate ? "#ffffff" : theme.textPrimary,
                fontSize: 12,
                fontWeight: "bold",
              }}
            >
              {updateLabel}
            </text>
          </div>
        </div>
      </div>

      {showUpdates && <UpdatePanel info={updateInfo} theme={theme}
        onInstall={handleUpdateAction} onRestart={handleUpdateAction}
        onCheck={handleCheckUpdates} onDownload={handleDownloadUpdate} onDismiss={handleDismissUpdates} />}

      {/* Main: browser canvas hero + slim sidebar */}
      <div style={{ display: "flex", flexDirection: "row", gap: 12, flexGrow: 1, minHeight: 0 }}>
        <BrowserCanvas
          elements={canvasElements}
          theme={theme}
          url={CANVAS_URL}
          onRemoveElement={handleRemoveElement}
        />

        {/* Sidebar */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, width: 264, minHeight: 0, overflow: "scroll" }}>
          {/* Canvas controls */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              backgroundColor: theme.cardBg,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: theme.cardBorder,
              padding: 12,
            }}
          >
            <text style={{ color: theme.textPrimary, fontSize: 13, fontWeight: "bold" }}>
              Canvas · {canvasElements.length} {canvasElements.length === 1 ? "node" : "nodes"}
            </text>
            <text style={{ color: theme.textSecondary, fontSize: 11 }}>
              {"Populate via MCP tools: canvas_set_page, canvas_create_element, canvas_update_element."}
            </text>
            <text style={{ color: theme.textSecondary, fontSize: 11 }}>
              {`Resource: ${CANVAS_MCP_RESOURCE_URI}`}
            </text>
            <div style={{ display: "flex", flexDirection: "row", gap: 6 }}>
              <div
                onClick={handleAddSample}
                style={{
                  paddingTop: 6,
                  paddingBottom: 6,
                  paddingLeft: 10,
                  paddingRight: 10,
                  borderRadius: 6,
                  backgroundColor: "#2563eb",
                  cursor: "pointer",
                }}
              >
                <text style={{ color: "#ffffff", fontSize: 11, fontWeight: "bold" }}>+ Sample</text>
              </div>
              <div
                onClick={handleClearCanvas}
                style={{
                  paddingTop: 6,
                  paddingBottom: 6,
                  paddingLeft: 10,
                  paddingRight: 10,
                  borderRadius: 6,
                  backgroundColor: theme.buttonBg,
                  cursor: "pointer",
                }}
              >
                <text style={{ color: theme.textPrimary, fontSize: 11 }}>Clear</text>
              </div>
            </div>
            <text style={{ color: theme.textSecondary, fontSize: 10 }}>
              {"MCP stdio: bun src/mcp-main.ts"}
            </text>
          </div>

          {/* Labs: counter + greeting condensed */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              backgroundColor: theme.cardBg,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: theme.cardBorder,
              padding: 12,
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <text style={{ color: theme.textPrimary, fontSize: 13, fontWeight: "bold" }}>
                Counter · {count}
              </text>
              <div onClick={() => handleIncrement(1)} style={{ cursor: "pointer" }}>
                <text style={{ color: "#38bdf8", fontSize: 12, fontWeight: "bold" }}>+1</text>
              </div>
            </div>
            {counterError ? (
              <text style={{ color: "#fca5a5", fontSize: 11 }}>⚠ {counterError}</text>
            ) : null}
            <div
              style={{
                display: "flex",
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <text style={{ color: theme.textSecondary, fontSize: 11 }}>{greetingLabel}</text>
              <div onClick={handleNextGreeting} style={{ cursor: "pointer" }}>
                <text style={{ color: theme.textPrimary, fontSize: 11, fontWeight: "bold" }}>Next ▶</text>
              </div>
            </div>
          </div>

          {/* Activity */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              backgroundColor: theme.cardBg,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: theme.cardBorder,
              padding: 12,
              flexGrow: 1,
              overflow: "scroll",
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <text style={{ color: theme.textPrimary, fontSize: 13, fontWeight: "bold" }}>
                Activity
              </text>
              <div onClick={handleClearHistory} style={{ cursor: "pointer" }}>
                <text style={{ color: theme.textSecondary, fontSize: 11 }}>Clear</text>
              </div>
            </div>
            {history.length === 0 ? (
              <text style={{ color: theme.textSecondary, fontSize: 11 }}>No recent activity.</text>
            ) : (
              history.slice(0, 6).map((item) => (
                <div
                  key={item.id}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 2,
                    padding: 6,
                    borderRadius: 6,
                    backgroundColor: theme.background,
                  }}
                >
                  <text style={{ color: theme.textPrimary, fontSize: 11, fontWeight: "bold" }}>
                    {item.action}
                  </text>
                  <text style={{ color: theme.textSecondary, fontSize: 10 }}>{item.details}</text>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Slim footer */}
      <div
        testId="app-footer"
        style={{
          display: "flex",
          flexDirection: "row",
          flexShrink: 0,
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <text style={{ color: theme.textSecondary, fontSize: 11 }}>
          {`canvas://blackboard · Effect v4 MCP · ${CanvasMcpProtocols.join(" / ")}`}
        </text>
        <text style={{ color: theme.textSecondary, fontSize: 11 }}>
          GPUIX & Effect v4
        </text>
      </div>
    </div>
  )
}
