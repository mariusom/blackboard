import React, { useEffect, useState, useCallback } from "react"
import { Effect } from "effect"
import { appRuntime } from "./services/AppRuntime"
import { GreetingService } from "./services/GreetingService"
import { CounterService } from "./services/CounterService"
import { ActivityService } from "./services/ActivityService"
import { ThemeService } from "./services/ThemeService"
import {
  APP_THEMES,
  APP_VERSION,
  INITIAL_GREETINGS,
  type AppThemeConfig,
  type GreetingItem,
  type TelemetryEvent,
} from "./domain/models"

export function App() {
  const [theme, setTheme] = useState<AppThemeConfig>(APP_THEMES.charcoal)
  const [greeting, setGreeting] = useState<GreetingItem>(INITIAL_GREETINGS[0])
  const [greetingIndex, setGreetingIndex] = useState<number>(0)
  const [count, setCount] = useState<number>(0)
  const [counterError, setCounterError] = useState<string | null>(null)
  const [history, setHistory] = useState<readonly TelemetryEvent[]>([])
  const allGreetings = INITIAL_GREETINGS

  const refreshState = useCallback(() => {
    appRuntime.runPromise(
      Effect.gen(function* () {
        const greetingSvc = yield* GreetingService
        const counterSvc = yield* CounterService
        const activitySvc = yield* ActivityService
        const themeSvc = yield* ThemeService

        const currentTheme = yield* themeSvc.getTheme
        const currentGreeting = yield* greetingSvc.getCurrentGreeting
        const currentGreetingIdx = yield* greetingSvc.getGreetingIndex
        const currentCount = yield* counterSvc.getCount
        const currentHistory = yield* activitySvc.getHistory

        return {
          theme: currentTheme,
          greeting: currentGreeting,
          greetingIndex: currentGreetingIdx,
          count: currentCount,
          history: currentHistory,
        }
      })
    ).then((state) => {
      setTheme(state.theme)
      setGreeting(state.greeting)
      setGreetingIndex(state.greetingIndex)
      setCount(state.count)
      setHistory(state.history)
    })
  }, [])

  useEffect(() => {
    refreshState()
  }, [refreshState])

  const handleNextGreeting = () => {
    appRuntime.runPromise(
      Effect.gen(function* () {
        const greetingSvc = yield* GreetingService
        const activitySvc = yield* ActivityService
        const next = yield* greetingSvc.nextGreeting
        const idx = yield* greetingSvc.getGreetingIndex
        yield* activitySvc.record("Greeting Cycled", `Advanced to ${next.language} (${next.greeting})`, "info")
        const hist = yield* activitySvc.getHistory
        return { next, idx, hist }
      })
    ).then(({ next, idx, hist }) => {
      setGreeting(next)
      setGreetingIndex(idx)
      setHistory(hist)
    })
  }

  const handlePrevGreeting = () => {
    appRuntime.runPromise(
      Effect.gen(function* () {
        const greetingSvc = yield* GreetingService
        const activitySvc = yield* ActivityService
        const prev = yield* greetingSvc.previousGreeting
        const idx = yield* greetingSvc.getGreetingIndex
        yield* activitySvc.record("Greeting Cycled", `Returned to ${prev.language} (${prev.greeting})`, "info")
        const hist = yield* activitySvc.getHistory
        return { prev, idx, hist }
      })
    ).then(({ prev, idx, hist }) => {
      setGreeting(prev)
      setGreetingIndex(idx)
      setHistory(hist)
    })
  }

  const handleSelectGreeting = (id: string) => {
    appRuntime.runPromise(
      Effect.gen(function* () {
        const greetingSvc = yield* GreetingService
        const activitySvc = yield* ActivityService
        const selected = yield* greetingSvc.selectGreetingById(id)
        const idx = yield* greetingSvc.getGreetingIndex
        yield* activitySvc.record("Greeting Selected", `Switched directly to ${selected.language}`, "info")
        const hist = yield* activitySvc.getHistory
        return { selected, idx, hist }
      })
    ).then(({ selected, idx, hist }) => {
      setGreeting(selected)
      setGreetingIndex(idx)
      setHistory(hist)
    })
  }

  const handleIncrement = (delta: number) => {
    setCounterError(null)
    appRuntime.runPromise(
      Effect.gen(function* () {
        const counterSvc = yield* CounterService
        const activitySvc = yield* ActivityService
        const updated = yield* counterSvc.increment(delta)
        yield* activitySvc.record("Counter Increment", `Count increased by ${delta} to ${updated}`, "success")
        const hist = yield* activitySvc.getHistory
        return { updated, hist }
      })
    ).then(({ updated, hist }) => {
      setCount(updated)
      setHistory(hist)
    })
  }

  const handleDecrement = (delta: number) => {
    appRuntime.runPromise(
      Effect.gen(function* () {
        const counterSvc = yield* CounterService
        const activitySvc = yield* ActivityService
        const result = yield* counterSvc.decrement(delta).pipe(
          Effect.map((updated) => ({ error: null as string | null, updated: updated as number | null })),
          Effect.catchTag("CounterError", (err) =>
            Effect.succeed({ error: err.message as string | null, updated: null as number | null })
          )
        )
        if (result.error) {
          yield* activitySvc.record("Counter Error", result.error, "warn")
        } else if (result.updated !== null) {
          yield* activitySvc.record("Counter Decrement", `Count decreased by ${delta} to ${result.updated}`, "info")
        }
        const hist = yield* activitySvc.getHistory
        return { ...result, hist }
      })
    ).then(({ error, hist, updated }) => {
      if (error) {
        setCounterError(error)
      } else if (updated !== null) {
        setCounterError(null)
        setCount(updated)
      }
      setHistory(hist)
    })
  }

  const handleResetCounter = () => {
    setCounterError(null)
    appRuntime.runPromise(
      Effect.gen(function* () {
        const counterSvc = yield* CounterService
        const activitySvc = yield* ActivityService
        const updated = yield* counterSvc.reset
        yield* activitySvc.record("Counter Reset", "Counter value restored to 0", "warn")
        const hist = yield* activitySvc.getHistory
        return { updated, hist }
      })
    ).then(({ updated, hist }) => {
      setCount(updated)
      setHistory(hist)
    })
  }

  const handleCycleTheme = () => {
    appRuntime.runPromise(
      Effect.gen(function* () {
        const themeSvc = yield* ThemeService
        const activitySvc = yield* ActivityService
        const nextTheme = yield* themeSvc.cycleTheme
        yield* activitySvc.record("Theme Changed", `Theme switched to ${nextTheme.name}`, "info")
        const hist = yield* activitySvc.getHistory
        return { nextTheme, hist }
      })
    ).then(({ nextTheme, hist }) => {
      setTheme(nextTheme)
      setHistory(hist)
    })
  }

  const handleClearHistory = () => {
    appRuntime.runPromise(
      Effect.gen(function* () {
        const activitySvc = yield* ActivityService
        yield* activitySvc.clear
      })
    ).then(() => {
      setHistory([])
    })
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        backgroundColor: theme.background,
        padding: 20,
        gap: 16,
      }}
    >
      {/* Top Header */}
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingBottom: 12,
          borderBottomWidth: 1,
          borderColor: theme.cardBorder,
        }}
      >
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              backgroundColor: "#d97706",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <text style={{ color: "#ffffff", fontSize: 20, fontWeight: "bold" }}>B</text>
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <text style={{ color: theme.textPrimary, fontSize: 18, fontWeight: "bold" }}>
              Blackboard Desktop
            </text>
            <text style={{ color: theme.textSecondary, fontSize: 12 }}>
              GPUIX 0.10.0 • Bun • TypeScript 7 • Effect v4
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
        </div>
      </div>

      {/* Main Greeting Hero Card */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          backgroundColor: theme.cardBg,
          borderRadius: 12,
          padding: 20,
          borderWidth: 1,
          borderColor: theme.cardBorder,
          gap: 12,
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
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8 }}>
            <text style={{ color: greeting.accentColor, fontSize: 13, fontWeight: "bold" }}>
              LANGUAGE GREETING
            </text>
            <text style={{ color: theme.textSecondary, fontSize: 12 }}>
              ({greetingIndex + 1} of {allGreetings.length})
            </text>
          </div>
          <div style={{ display: "flex", flexDirection: "row", gap: 6 }}>
            <div
              onClick={handlePrevGreeting}
              style={{
                paddingTop: 4,
                paddingBottom: 4,
                paddingLeft: 10,
                paddingRight: 10,
                borderRadius: 6,
                backgroundColor: theme.buttonBg,
                cursor: "pointer",
              }}
            >
              <text style={{ color: theme.textPrimary, fontSize: 12 }}>◀ Prev</text>
            </div>
            <div
              onClick={handleNextGreeting}
              style={{
                paddingTop: 4,
                paddingBottom: 4,
                paddingLeft: 10,
                paddingRight: 10,
                borderRadius: 6,
                backgroundColor: theme.buttonBg,
                cursor: "pointer",
              }}
            >
              <text style={{ color: theme.textPrimary, fontSize: 12 }}>Next ▶</text>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 14 }}>
          <text style={{ color: greeting.accentColor, fontSize: 32 }}>{greeting.flag}</text>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <text style={{ color: greeting.accentColor, fontSize: 26, fontWeight: "bold" }}>
              {greeting.greeting}
            </text>
            <text style={{ color: theme.textSecondary, fontSize: 14 }}>
              {greeting.language} — {greeting.subtitle}
            </text>
          </div>
        </div>

        {/* Quick Language Selector Pills */}
        <div style={{ display: "flex", flexDirection: "row", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
          {allGreetings.map((g) => {
            const isSelected = g.id === greeting.id
            return (
              <div
                key={g.id}
                onClick={() => handleSelectGreeting(g.id)}
                style={{
                  paddingTop: 4,
                  paddingBottom: 4,
                  paddingLeft: 8,
                  paddingRight: 8,
                  borderRadius: 6,
                  backgroundColor: isSelected ? g.accentColor : theme.buttonBg,
                  cursor: "pointer",
                }}
              >
                <text
                  style={{
                    color: isSelected ? "#000000" : theme.textPrimary,
                    fontSize: 11,
                    fontWeight: isSelected ? "bold" : "normal",
                  }}
                >
                  {g.flag} {g.language}
                </text>
              </div>
            )
          })}
        </div>
      </div>

      {/* Two Column Layout: Counter & Activity Log */}
      <div style={{ display: "flex", flexDirection: "row", gap: 16, flexGrow: 1 }}>
        {/* Interactive Counter Card */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            width: "48%",
            backgroundColor: theme.cardBg,
            borderRadius: 12,
            padding: 16,
            borderWidth: 1,
            borderColor: theme.cardBorder,
            gap: 12,
          }}
        >
          <div style={{ display: "flex", flexDirection: "row", justifyContent: "space-between" }}>
            <text style={{ color: theme.textPrimary, fontSize: 14, fontWeight: "bold" }}>
              Interactive Counter
            </text>
            <text style={{ color: "#38bdf8", fontSize: 12, fontWeight: "bold" }}>Effect v4 Ref</text>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              paddingTop: 16,
              paddingBottom: 16,
            }}
          >
            <text style={{ color: "#38bdf8", fontSize: 44, fontWeight: "bold" }}>{count}</text>
          </div>

          {counterError && (
            <div
              style={{
                backgroundColor: "#7f1d1d",
                padding: 8,
                borderRadius: 6,
              }}
            >
              <text style={{ color: "#fca5a5", fontSize: 11 }}>⚠ {counterError}</text>
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "row", gap: 8, justifyContent: "center" }}>
            <div
              onClick={() => handleDecrement(1)}
              style={{
                paddingTop: 8,
                paddingBottom: 8,
                paddingLeft: 14,
                paddingRight: 14,
                borderRadius: 6,
                backgroundColor: theme.buttonBg,
                cursor: "pointer",
              }}
            >
              <text style={{ color: theme.textPrimary, fontSize: 13, fontWeight: "bold" }}>-1</text>
            </div>
            <div
              onClick={() => handleIncrement(1)}
              style={{
                paddingTop: 8,
                paddingBottom: 8,
                paddingLeft: 14,
                paddingRight: 14,
                borderRadius: 6,
                backgroundColor: "#2563eb",
                cursor: "pointer",
              }}
            >
              <text style={{ color: "#ffffff", fontSize: 13, fontWeight: "bold" }}>+1</text>
            </div>
            <div
              onClick={() => handleIncrement(5)}
              style={{
                paddingTop: 8,
                paddingBottom: 8,
                paddingLeft: 14,
                paddingRight: 14,
                borderRadius: 6,
                backgroundColor: "#059669",
                cursor: "pointer",
              }}
            >
              <text style={{ color: "#ffffff", fontSize: 13, fontWeight: "bold" }}>+5</text>
            </div>
            <div
              onClick={handleResetCounter}
              style={{
                paddingTop: 8,
                paddingBottom: 8,
                paddingLeft: 12,
                paddingRight: 12,
                borderRadius: 6,
                backgroundColor: theme.buttonBg,
                cursor: "pointer",
              }}
            >
              <text style={{ color: theme.textSecondary, fontSize: 13 }}>Reset</text>
            </div>
          </div>
        </div>

        {/* Activity & Telemetry Log Card */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            width: "48%",
            backgroundColor: theme.cardBg,
            borderRadius: 12,
            padding: 16,
            borderWidth: 1,
            borderColor: theme.cardBorder,
            gap: 10,
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
            <text style={{ color: theme.textPrimary, fontSize: 14, fontWeight: "bold" }}>
              Service Activity Log
            </text>
            <div onClick={handleClearHistory} style={{ cursor: "pointer" }}>
              <text style={{ color: theme.textSecondary, fontSize: 11 }}>Clear</text>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6, overflow: "scroll" }}>
            {history.length === 0 ? (
              <text style={{ color: theme.textSecondary, fontSize: 12 }}>No recent activity.</text>
            ) : (
              history.map((item) => {
                const badgeColor =
                  item.level === "success"
                    ? "#10b981"
                    : item.level === "warn"
                    ? "#f59e0b"
                    : "#38bdf8"
                return (
                  <div
                    key={item.id}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      padding: 6,
                      borderRadius: 6,
                      backgroundColor: theme.background,
                      gap: 2,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "row",
                        justifyContent: "space-between",
                      }}
                    >
                      <text style={{ color: badgeColor, fontSize: 11, fontWeight: "bold" }}>
                        {item.action}
                      </text>
                      <text style={{ color: theme.textSecondary, fontSize: 10 }}>
                        {item.timestamp}
                      </text>
                    </div>
                    <text style={{ color: theme.textSecondary, fontSize: 11 }}>
                      {item.details}
                    </text>
                  </div>
                )
              })
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          paddingTop: 8,
          borderTopWidth: 1,
          borderColor: theme.cardBorder,
        }}
      >
        <text style={{ color: theme.textSecondary, fontSize: 11 }}>
          {`v${APP_VERSION} • Blackboard App`}
        </text>
        <text style={{ color: theme.textSecondary, fontSize: 11 }}>
          Powered by GPUIX & Effect v4 • Rust Retained Tree UI
        </text>
      </div>
    </div>
  )
}
