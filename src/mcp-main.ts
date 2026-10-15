import { Layer, Logger } from "effect"
import { NodeRuntime, NodeStdio } from "@effect/platform-node"
import { CanvasMcpStdioLive } from "./mcp/server"

// The development preview can target an isolated workspace without changing
// the user's default app connection. Configuration stays at the entrypoint.
const connectionFile = process.argv.find(arg => arg.startsWith("--connection-file="))?.slice("--connection-file=".length)
if (connectionFile) process.env.BLACKBOARD_CONNECTION_FILE = connectionFile

// Logs must go to stderr — stdout is the MCP protocol channel.
const MainLive = CanvasMcpStdioLive.pipe(
  Layer.provide(NodeStdio.layer),
  Layer.provide(Layer.succeed(Logger.LogToStderr, true)),
)

Layer.launch(MainLive).pipe(NodeRuntime.runMain)
