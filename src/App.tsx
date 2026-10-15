import React, { useEffect, useState, useCallback } from "react"
import { Effect, Schedule } from "effect"
import { appRuntime } from "./services/AppRuntime"
import { GreetingService } from "./services/GreetingService"
import { CounterService } from "./services/CounterService"
import { ActivityService } from "./services/ActivityService"
import { ThemeService } from "./services/ThemeService"
import { UpdateService } from "./services/UpdateService"
import { CanvasService } from "./services/CanvasService"
import { BrowserCanvas } from "./components/BrowserCanvas"
import {
  APP_THEMES,
  APP_VERSION,
  GITHUB_REPO,
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

export function App() {
  const [theme, setTheme] = useState<AppThemeConfig>(APP_THEMES.charcoal)
  const [greetingLabel, setGreetingLabel] = useState<string>(`${INITIAL_GREETINGS[0].greeting} · ${INITIAL_GREETINGS[0].language}`)
  const [count, setCount] = useState<number>(0)
  const [counterError, setCounterError] = useState<string | null>(null)
  const [history, setHistory] = useState<readonly TelemetryEvent[]>([])
  const [canvasElements, setCanvasElements] = useState<readonly CanvasElement[]>(INITIAL_CANVAS_ELEMENTS)
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo>({
    currentVersion: APP_VERSION,
    latestVersion: APP_VERSION,
    hasUpdate: false,
    downloadUrl: null,
    releaseUrl: `https://github.com/${GITHUB_REPO}/releases`,
    status: "idle",
    errorMessage: null,
  })

  const refreshState = useCallback(() => {
    appRuntime
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
  }, [])

  const handleCheckUpdates = useCallback(() => {
    setUpdateInfo((prev) => ({ ...prev, status: "checking", errorMessage: null }))
    appRuntime
      .runPromise(
        Effect.gen(function* () {
          const updateSvc = yield* UpdateService
          const activitySvc = yield* ActivityService
          const result = yield* updateSvc.checkForUpdates.pipe(
            Effect.map((info) => ({ info, error: null as string | null })),
            Effect.catchTag("UpdateError", (err) =>
              Effect.succeed({ info: null as UpdateInfo | null, error: err.message as string | null }),
            ),
          )
          if (result.error) {
            yield* activitySvc.record("Update Check", `Update check failed: ${result.error}`, "warn")
          } else if (result.info && result.info.hasUpdate) {
            yield* activitySvc.record(
              "Update Check",
              `New update v${result.info.latestVersion} is available`,
              "success",
            )
          } else if (result.info) {
            yield* activitySvc.record(
              "Update Check",
              `App is up to date (v${result.info.currentVersion})`,
              "info",
            )
          }
          const hist = yield* activitySvc.getHistory
          const state = yield* updateSvc.getUpdateState
          return { hist, state }
        }),
      )
      .then(({ hist, state }) => {
        setHistory(hist)
        setUpdateInfo(state)
      })
  }, [])

  useEffect(() => {
    refreshState()
    const controller = new AbortController()
    appRuntime.runPromise(
      Effect.sync(handleCheckUpdates).pipe(Effect.repeat(Schedule.spaced("6 hours"))),
      { signal: controller.signal },
    ).catch(() => { /* Unmount interrupts the polling schedule. */ })
    return () => controller.abort()
  }, [refreshState, handleCheckUpdates])

  const handleUpdateAction = useCallback(() => {
    if (["checking", "downloading", "installing"].includes(updateInfo.status)) return
    if (updateInfo.status !== "ready-to-restart" && !updateInfo.hasUpdate) {
      handleCheckUpdates()
      return
    }
    const restarting = updateInfo.status === "ready-to-restart"
    if (!restarting) setUpdateInfo((info) => ({ ...info, status: "downloading", errorMessage: null }))
    appRuntime.runPromise(Effect.gen(function* () {
      const updates = yield* UpdateService
      yield* (restarting ? updates.restartApp : updates.installUpdate).pipe(
        Effect.catchTag("UpdateError", () => Effect.void),
      )
      return yield* updates.getUpdateState
    })).then(setUpdateInfo)
  }, [updateInfo.status, updateInfo.hasUpdate, handleCheckUpdates])

  const handleRemoveElement = (id: string) => {
    appRuntime
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
    appRuntime
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
    appRuntime
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
    appRuntime
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
    appRuntime
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
    appRuntime
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
    appRuntime.runPromise(
      Effect.gen(function* () {
        const activitySvc = yield* ActivityService
        yield* activitySvc.clear
      }),
    ).then(() => {
      setHistory([])
    })
  }

  const updateLabel =
    updateInfo.status === "downloading" || updateInfo.status === "installing"
      ? "Downloading & verifying…"
      : updateInfo.status === "checking"
        ? "Checking..."
        : updateInfo.status === "ready-to-restart"
          ? `↻ Restart to v${updateInfo.latestVersion}`
          : updateInfo.hasUpdate
            ? `⬇ Update to v${updateInfo.latestVersion}`
            : updateInfo.status === "up-to-date"
              ? "Up to date"
              : "Check Updates"

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
            onClick={handleUpdateAction}
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
          {updateInfo.errorMessage && (
            <text style={{ color: "#fca5a5", fontSize: 11 }}>{updateInfo.errorMessage}</text>
          )}
        </div>
      </div>

      {/* Main: browser canvas hero + slim sidebar */}
      <div style={{ display: "flex", flexDirection: "row", gap: 12, flexGrow: 1 }}>
        <BrowserCanvas
          elements={canvasElements}
          theme={theme}
          url={CANVAS_URL}
          onRemoveElement={handleRemoveElement}
        />

        {/* Sidebar */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, width: 264 }}>
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
        style={{
          display: "flex",
          flexDirection: "row",
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
