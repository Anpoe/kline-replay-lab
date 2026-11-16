import assert from 'node:assert/strict';
import test from 'node:test';
import net from 'node:net';
import { deflateSync } from 'node:zlib';
import { setTimeout as wait } from 'node:timers/promises';
import { TdxCorporateActionsClient } from '../local-data/tdx-corporate-actions-client.mjs';

const body = Buffer.from('010039283501b4b6015414e401a032004911e1114e', 'hex');

async function fixture(t, onDaily) {
  const sockets = new Set();
  let connections = 0;
  let requests = 0;
  const send = async (socket, data, compressed = false) => {
    const payload = compressed ? deflateSync(data) : data;
    const header = Buffer.alloc(16);
    header.writeUInt16LE(payload.length, 12);
    header.writeUInt16LE(data.length, 14);
    // Exercise the real stream reader with a fragmented header and body.
    const response = Buffer.concat([header, payload]);
    for (const [start, end] of [[0, 7], [7, 19], [19, response.length]]) {
      if (socket.destroyed) return;
      socket.write(response.subarray(start, end));
      await wait(2);
    }
  };
  const server = net.createServer(socket => {
    connections += 1;
    sockets.add(socket);
    socket.on('error', () => {});
    socket.on('close', () => sockets.delete(socket));
    let incoming = Buffer.alloc(0);
    socket.on('data', chunk => {
      incoming = Buffer.concat([incoming, chunk]);
      while (incoming.length >= 10) {
        const length = incoming.readUInt16LE(6) + 10;
        if (incoming.length < length) return;
        const packet = incoming.subarray(0, length);
        incoming = incoming.subarray(length);
        if (packet.length === 38) {
          requests += 1;
          void onDaily({ socket, packet, requests, send });
        } else {
          void send(socket, Buffer.alloc(2));
        }
      }
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const client = new TdxCorporateActionsClient({ hosts: [['127.0.0.1', server.address().port]], timeoutMs: 150, retryDelayMs: 1 });
  t.after(async () => {
    client.close();
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
  });
  return { client, connections: () => connections, requests: () => requests };
}

test('native TDX TCP disconnect automatically reconnects and decodes fragmented compressed daily bars', async t => {
  const f = await fixture(t, async ({ socket, requests, send }) => {
    if (requests === 1) { socket.destroy(); return; }
    await send(socket, body, true);
  });
  const retries = [];
  const rows = await f.client.fetchDailyBars('000001.SZ', { onRetry: state => retries.push(state) });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].close, 11.68);
  assert.equal(rows[0].timestamp, Date.UTC(2026, 8, 21));
  assert.equal(f.connections(), 2);
  assert.equal(f.requests(), 2);
  assert.equal(retries.length, 1);
});

test('native TDX response timeout reconnects without publishing incomplete data', async t => {
  const f = await fixture(t, async ({ socket, requests, send }) => {
    if (requests === 1) return;
    await send(socket, body);
  });
  const rows = await f.client.fetchDailyBars('000001.SZ');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].close, 11.68);
  assert.equal(f.connections(), 2);
  assert.equal(f.requests(), 2);
});

test('native TDX abort closes an in-flight response and releases the queue for the next request', async t => {
  let received;
  const firstReceived = new Promise(resolve => { received = resolve; });
  const f = await fixture(t, async ({ socket, requests, send }) => {
    if (requests === 1) { received(); return; }
    await send(socket, body);
  });
  const controller = new AbortController();
  const pending = assert.rejects(f.client.fetchDailyBars('000001.SZ', { signal: controller.signal }), { name: 'AbortError' });
  await firstReceived;
  controller.abort();
  await pending;
  assert.equal((await f.client.fetchDailyBars('000002.SZ'))[0].instrumentId, '000002.SZ');
  assert.equal(f.connections(), 2);
  assert.equal(f.requests(), 2);
});
