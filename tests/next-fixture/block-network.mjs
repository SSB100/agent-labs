// Applied only to disposable fixture Next processes, never to the application.
import net from 'node:net';
import fs from 'node:fs';
const deny = host => {
  if (process.env.R03_NETWORK_LOG) fs.appendFileSync(process.env.R03_NETWORK_LOG, JSON.stringify({ host: String(host), at: new Date().toISOString() }) + '\n');
  throw new Error('R03 isolated fixture blocked non-loopback network');
};
const local = host => ['localhost', '127.0.0.1', '::1', '[::1]'].includes(String(host));
const original = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  let options = Array.isArray(args[0]) ? args[0][0] : args[0];
  if (typeof options === 'object' && options && !options.path && options.host && !local(options.host)) deny(options.host);
  if (typeof options === 'number' && typeof args[1] === 'string' && !local(args[1])) deny(args[1]);
  return original.apply(this, args);
};
const originalFetch = globalThis.fetch;
globalThis.fetch = function (input, init) {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (!local(url.hostname)) deny(url.hostname);
  return originalFetch(input, init);
};
