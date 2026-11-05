// Headless smoke test: drives a scripted candidate conversation through the real
// Deepgram pipeline and prints the transcript plus every recorded field.
import { WebSocket } from "ws";

const SCRIPT = [
  "Yes, please go ahead.",
  "Mera naam Ramesh Kumar hai.",
  "Haan, main job change karne ke liye open hoon.",
  "Diploma kiya hai.",
  "Electronics and communication branch.",
  "Abhi main Field Engineer hoon.",
  "Total saat saal ka experience hai, teen mahine extra.",
  "BTS aur RAN mein paanch saal.",
  "4G mein chaar saal.",
  "3G mein do saal.",
  "Microwave alignment mein teen saal.",
  "RSL rectification mein do saal.",
  "Battery bank mein chaar saal, SMPS mein teen saal, DG mein do saal.",
  "Airtel ke liye teen saal kaam kiya, service partner ke through, partner ka naam Indus Towers tha.",
  "Jio ke liye do saal, direct employment.",
  "Aur koi operator nahi hai.",
  "Abhi take-home pachhees hazaar rupaye milte hain.",
  "Haan sahi hai.",
  "Haan, two-wheeler hai aur licence bhi valid hai.",
  "Hometown Patna hai, district Patna, state Bihar.",
  "Patna aur Ranchi dono mein kaam kar sakta hoon.",
  "Ranchi ke liye kam se kam tees hazaar chahiye.",
  "Patna ke liye attaees hazaar.",
  "Haan, attaees hazaar se kam nahi lunga.",
  "Pandrah din ka notice period hai.",
  "Abhi Bharti Infratel mein hoon, Patna mein kaam kar raha hoon.",
  "Haan, work at height training hai, tower climbing training.",
  "Expiry March 2027 hai.",
];

const ws = new WebSocket("ws://localhost:3000/agent");
let i = 0, tools = [];

const next = () => {
  if (i >= SCRIPT.length) return setTimeout(finish, 8000);
  const line = SCRIPT[i++];
  console.log(`\n\x1b[36m[candidate]\x1b[0m ${line}`);
  ws.send(JSON.stringify({ type: "InjectUserMessage", content: line }));
};

function finish() {
  console.log(`\n--- tools called: ${tools.length} ---`);
  const counts = tools.reduce((a, t) => ((a[t] = (a[t] || 0) + 1), a), {});
  for (const [k, v] of Object.entries(counts)) console.log(`  ${k}: ${v}`);
  ws.close();
  process.exit(0);
}

ws.on("open", () => console.log("connected"));
ws.on("message", (data, isBinary) => {
  if (isBinary) return;
  const m = JSON.parse(data.toString());
  if (m.type === "Welcome") setTimeout(next, 1500);
  if (m.type === "ConversationText" && m.role === "assistant")
    console.log(`\x1b[33m[bot]\x1b[0m ${m.content}`);
  if (m.type === "ToolCall") {
    tools.push(m.name);
    console.log(`\x1b[32m[tool]\x1b[0m ${m.name}(${m.args})`);
  }
  if (m.type === "AgentAudioDone") setTimeout(next, 500);
  if (m.type === "Error") console.log(`\x1b[31m[Error]\x1b[0m`, m.description);
});
ws.on("close", () => process.exit(0));
setTimeout(finish, 240000);
