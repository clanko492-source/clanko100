// A tiny stand-in for the PeerJS cloud broker, used to test online racing offline.
// node tools/mock-signal.mjs [port]
import { createServer } from "node:http";
import { createHash, randomUUID } from "node:crypto";

const port = +(process.argv[2] || 9000);
const peers = new Map(); // id -> socket

function accept(req, socket) {
  const key = req.headers["sec-websocket-key"];
  const accept = createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
  socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + accept + "\r\n\r\n");
}
function frame(data) {
  const buf = Buffer.from(data);
  const len = buf.length;
  let head;
  if (len < 126) head = Buffer.from([0x81, len]);
  else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x81; head[1] = 126; head.writeUInt16BE(len, 2); }
  else { head = Buffer.alloc(10); head[0] = 0x81; head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
  return Buffer.concat([head, buf]);
}
function parse(buf, onMsg) {
  let o = 0;
  while (o + 2 <= buf.length) {
    const op = buf[o] & 0x0f, masked = buf[o + 1] & 0x80;
    let len = buf[o + 1] & 0x7f, p = o + 2;
    if (len === 126) { len = buf.readUInt16BE(p); p += 2; }
    else if (len === 127) { len = Number(buf.readBigUInt64BE(p)); p += 8; }
    let mask;
    if (masked) { mask = buf.slice(p, p + 4); p += 4; }
    if (p + len > buf.length) return buf.slice(o);
    const data = buf.slice(p, p + len);
    if (masked) for (let i = 0; i < data.length; i++) data[i] ^= mask[i % 4];
    if (op === 8) onMsg(null);
    else if (op === 1) onMsg(data.toString("utf8"));
    o = p + len;
  }
  return Buffer.alloc(0);
}

const server = createServer((req, res) => { res.writeHead(200); res.end("mock signal"); });
server.on("upgrade", (req, socket) => {
  const url = new URL(req.url, "http://x");
  const id = url.searchParams.get("id") || randomUUID();
  accept(req, socket);
  if (peers.has(id)) { socket.write(frame(JSON.stringify({ type: "ID-TAKEN" }))); socket.end(); return; }
  peers.set(id, socket);
  socket.write(frame(JSON.stringify({ type: "OPEN" })));
  let rest = Buffer.alloc(0);
  socket.on("data", (chunk) => {
    rest = parse(Buffer.concat([rest, chunk]), (text) => {
      if (text == null) { peers.delete(id); socket.end(); return; }
      let m; try { m = JSON.parse(text); } catch { return; }
      if (m.type === "HEARTBEAT") return;
      const dst = peers.get(m.dst);
      if (!dst) { socket.write(frame(JSON.stringify({ type: "EXPIRE", src: m.dst }))); return; }
      dst.write(frame(JSON.stringify({ type: m.type, src: id, dst: m.dst, payload: m.payload })));
    });
  });
  socket.on("close", () => { peers.delete(id); for (const [pid, s] of peers) s.write(frame(JSON.stringify({ type: "LEAVE", src: id }))); });
  socket.on("error", () => peers.delete(id));
});
server.listen(port, () => console.log("mock signalling broker on ws://localhost:" + port));
