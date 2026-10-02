/** Installed only into the disposable test copy, never imported by the application. */
export function makeClient(origin, session = 'on', mode = 'normal') {
  const send = (path, payload) => fetch(`${origin}/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...payload, session, mode }) }).then(r => r.json());
  const denied = () => { throw Error('R03 inert boundary denies this effect'); };
  const auth = { getClaims: () => send('claims', {}), signOut: async () => ({ error: null }), signInWithPassword: denied };
  return { auth, rpc: (name, args) => send('rpc', { name, args }), from(table) {
    const call = { table, operations: [] };
    const query = new Proxy({}, { get(_target, key) {
      if (key === 'then') return (resolve, reject) => send('read', call).then(resolve, reject);
      if (['insert','update','delete','upsert'].includes(key)) return denied;
      return (...args) => { call.operations.push([key, ...args]); return query; };
    }}); return query;
  }, storage: { from() { return { createSignedUrls: paths => Promise.resolve({ data: paths.map(path => ({ path, signedUrl: null })), error: null }), download: denied, upload: denied, remove: denied }; } } };
}
