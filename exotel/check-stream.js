#!/usr/bin/env node
// Test that the public Exotel websocket endpoint accepts connections.
import "dotenv/config";
import { WebSocket } from "ws";

const host = process.env.PUBLIC_HOST || "agent.snapecab.com";
const secret = process.env.EXOTEL_STREAM_SECRET || "";
const url = secret
  ? `wss://${host}/exotel-stream/${secret}`
  : `wss://${host}/exotel-stream`;

console.log(`Testing ${url} ...`);

const ws = new WebSocket(url);
const t = setTimeout(() => {
  console.error("TIMEOUT — no connection in 10s. Check Nginx/Caddy WSS proxy and firewall.");
  ws.terminate();
  process.exit(1);
}, 10000);

ws.on("open", () => {
  clearTimeout(t);
  console.log("OK — websocket connected. Exotel should be able to reach your server.");
  ws.send(JSON.stringify({ event: "connected" }));
  ws.close();
  process.exit(0);
});

ws.on("unexpected-response", (_req, res) => {
  clearTimeout(t);
  console.error(`FAILED — HTTP ${res.statusCode}. ${res.statusCode === 401 ? "Token mismatch — fix EXOTEL_STREAM_SECRET or Exotel applet URL." : "Check reverse proxy / TLS."}`);
  process.exit(1);
});

ws.on("error", (e) => {
  clearTimeout(t);
  console.error("FAILED —", e.message);
  process.exit(1);
});
