import { mkdirSync } from "node:fs"
import { execFileSync } from "node:child_process"
mkdirSync("dist", { recursive: true })
execFileSync("/usr/bin/swiftc", ["native/Blackboard.swift", "-o", "dist/blackboard-webkit", "-framework", "AppKit", "-framework", "WebKit"], { stdio: "inherit" })
const child = Bun.spawn([process.execPath, "src/main.ts", ...process.argv.slice(2)], { stdio: ["inherit", "inherit", "inherit"] })
process.once("SIGINT", () => child.kill("SIGINT"))
process.once("SIGTERM", () => child.kill("SIGTERM"))
process.exit(await child.exited)
