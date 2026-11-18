// Starts bin/daymaker-mcp.mjs over stdio with a placeholder key and checks it
// answers initialize and tools/list. Makes no HTTP call to Daymaker.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const child = spawn(process.execPath, [fileURLToPath(new URL("../bin/daymaker-mcp.mjs", import.meta.url))], {
  env: { ...process.env, DAYMAKER_KEY: "dmk_live_placeholder" },
  stdio: ["pipe", "pipe", "inherit"],
});
const send = (m) => child.stdin.write(JSON.stringify(m) + "\n");
let buf = "";
const timer = setTimeout(() => { console.error("smoke: timed out"); child.kill(); process.exit(1); }, 10_000);
child.stdout.on("data", (c) => {
  buf += c;
  for (const line of buf.split("\n").slice(0, -1)) {
    const msg = JSON.parse(line);
    if (msg.id === 1) {
      if (msg.result?.serverInfo?.name !== "daymaker-api") {
        console.error(`smoke: the server calls itself ${msg.result?.serverInfo?.name}`);
        child.kill();
        process.exit(1);
      }
      send({ jsonrpc: "2.0", method: "notifications/initialized" });
      send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    }
    if (msg.id === 2) {
      clearTimeout(timer);
      console.log(`smoke: ${msg.result.tools.length} tools over stdio`);
      child.kill();
      process.exit(msg.result.tools.length > 0 ? 0 : 1);
    }
  }
  buf = buf.slice(buf.lastIndexOf("\n") + 1);
});
send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "0" } } });
