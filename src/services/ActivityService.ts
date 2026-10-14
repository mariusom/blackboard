import { Context, DateTime, Effect, Layer, Ref } from "effect"
import type { TelemetryEvent } from "../domain/models"

export interface ActivityServiceShape {
  readonly record: (
    action: string,
    details: string,
    level?: "info" | "success" | "warn"
  ) => Effect.Effect<TelemetryEvent>
  readonly getHistory: Effect.Effect<readonly TelemetryEvent[]>
  readonly clear: Effect.Effect<void>
}

export class ActivityService extends Context.Service<
  ActivityService,
  ActivityServiceShape
>()("blackboard/ActivityService") {
  static readonly layer = Layer.effect(
    ActivityService,
    Effect.gen(function* () {
      const initNow = yield* DateTime.now
      const initTimestamp = DateTime.formatLocal(initNow, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })

      const historyRef = yield* Ref.make<readonly TelemetryEvent[]>([
        {
          id: 1,
          timestamp: initTimestamp,
          action: "App Initialized",
          details: "GPUIX runtime & Effect v4 services ready",
          level: "info",
        },
      ])
      const nextIdRef = yield* Ref.make(2)

      const record = Effect.fn("ActivityService.record")(function* (
        action: string,
        details: string,
        level: "info" | "success" | "warn" = "info"
      ) {
        const id = yield* Ref.updateAndGet(nextIdRef, (n) => n + 1)
        const currentNow = yield* DateTime.now
        const timestamp = DateTime.formatLocal(currentNow, {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })
        const event: TelemetryEvent = {
          id,
          timestamp,
          action,
          details,
          level,
        }
        yield* Ref.update(historyRef, (hist) => [event, ...hist].slice(0, 8))
        return event
      })

      const getHistory = Ref.get(historyRef)

      const clear = Ref.set(historyRef, [])

      return ActivityService.of({
        record,
        getHistory,
        clear,
      })
    })
  )
}
