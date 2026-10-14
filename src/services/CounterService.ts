import { Context, Effect, Layer, Ref } from "effect"
import { CounterError } from "../domain/models"

export interface CounterServiceShape {
  readonly getCount: Effect.Effect<number>
  readonly increment: (delta?: number) => Effect.Effect<number>
  readonly decrement: (delta?: number) => Effect.Effect<number, CounterError>
  readonly reset: Effect.Effect<number>
}

export class CounterService extends Context.Service<
  CounterService,
  CounterServiceShape
>()("blackboard/CounterService") {
  static readonly layer = Layer.effect(
    CounterService,
    Effect.gen(function* () {
      const countRef = yield* Ref.make(0)

      const getCount = Ref.get(countRef)

      const increment = Effect.fn("CounterService.increment")(function* (delta = 1) {
        const next = yield* Ref.updateAndGet(countRef, (n) => n + delta)
        yield* Effect.logInfo(`Counter incremented by ${delta} to ${next}`)
        return next
      })

      const decrement = Effect.fn("CounterService.decrement")(function* (delta = 1) {
        const current = yield* Ref.get(countRef)
        if (current - delta < 0) {
          return yield* new CounterError({
            message: "Counter cannot be decremented below 0",
            current,
          })
        }
        const next = yield* Ref.updateAndGet(countRef, (n) => n - delta)
        yield* Effect.logInfo(`Counter decremented by ${delta} to ${next}`)
        return next
      })

      const reset = Effect.gen(function* () {
        yield* Ref.set(countRef, 0)
        yield* Effect.logInfo("Counter reset to 0")
        return 0
      })

      return CounterService.of({
        getCount,
        increment,
        decrement,
        reset,
      })
    })
  )
}
