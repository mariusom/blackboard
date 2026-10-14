import { Context, Effect, Layer, Ref } from "effect"
import { GreetingError, type GreetingItem, INITIAL_GREETINGS } from "../domain/models"

export interface GreetingServiceShape {
  readonly getCurrentGreeting: Effect.Effect<GreetingItem>
  readonly getGreetingIndex: Effect.Effect<number>
  readonly nextGreeting: Effect.Effect<GreetingItem>
  readonly previousGreeting: Effect.Effect<GreetingItem>
  readonly selectGreetingById: (id: string) => Effect.Effect<GreetingItem, GreetingError>
  readonly getAllGreetings: Effect.Effect<readonly GreetingItem[]>
}

export class GreetingService extends Context.Service<
  GreetingService,
  GreetingServiceShape
>()("blackboard/GreetingService") {
  static readonly layer = Layer.effect(
    GreetingService,
    Effect.gen(function* () {
      const greetings = INITIAL_GREETINGS
      const currentIndexRef = yield* Ref.make(0)

      const getCurrentGreeting = Effect.gen(function* () {
        const index = yield* Ref.get(currentIndexRef)
        return greetings[index] ?? greetings[0]
      })

      const getGreetingIndex = Ref.get(currentIndexRef)

      const nextGreeting = Effect.gen(function* () {
        const nextIdx = yield* Ref.updateAndGet(currentIndexRef, (i) => (i + 1) % greetings.length)
        yield* Effect.logInfo(`GreetingService: cycled next to index ${nextIdx}`)
        return greetings[nextIdx]
      })

      const previousGreeting = Effect.gen(function* () {
        const prevIdx = yield* Ref.updateAndGet(currentIndexRef, (i) => (i - 1 + greetings.length) % greetings.length)
        yield* Effect.logInfo(`GreetingService: cycled previous to index ${prevIdx}`)
        return greetings[prevIdx]
      })

      const selectGreetingById = Effect.fn("GreetingService.selectGreetingById")(function* (id: string) {
        const foundIndex = greetings.findIndex((g) => g.id === id)
        if (foundIndex === -1) {
          return yield* new GreetingError({
            message: `Greeting with id '${id}' not found.`,
          })
        }
        yield* Ref.set(currentIndexRef, foundIndex)
        return greetings[foundIndex]
      })

      const getAllGreetings = Effect.succeed(greetings)

      return GreetingService.of({
        getCurrentGreeting,
        getGreetingIndex,
        nextGreeting,
        previousGreeting,
        selectGreetingById,
        getAllGreetings,
      })
    })
  )
}
