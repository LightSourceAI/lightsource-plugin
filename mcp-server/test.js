#!/usr/bin/env node
/**
 * Self-contained tests for the LightSource MCP server.
 *
 * Spins up a stub HTTP server that impersonates the LightSource API, drives the
 * real server over stdio, and asserts on the JSON-RPC responses. No network
 * access and no dependencies required.
 *
 *   node mcp-server/test.js
 */

'use strict';

const assert = require('assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const SERVER = path.join(__dirname, 'index.js');
const TEST_KEY = 'ls_test_key_do_not_use_1234567890';

/* ------------------------------------------------------------------ *
 * stub API
 * ------------------------------------------------------------------ */

let mode = 'ok';
let lastAuthHeader = null;
let putBodies = [];

function startStub() {
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);

      if (req.method === 'PUT') {
        putBodies.push({ url: req.url, auth: req.headers.authorization || null, body });
        if (mode === 'put_fails') {
          res.writeHead(403).end('AccessDenied');
          return;
        }
        res.writeHead(200).end('');
        return;
      }

      lastAuthHeader = req.headers.authorization || null;
      const parsed = JSON.parse(body.toString('utf8') || '{}');
      const query = parsed.query || '';
      const json = (status, payload) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
      };

      if (mode === 'http_401') return json(401, { errors: [{ message: 'Unauthorized' }] });
      if (mode === 'session_null') {
        return json(200, { data: { session: null }, errors: [{ message: 'Not authenticated' }] });
      }
      if (mode === 'authy_error') {
        return json(200, { data: null, errors: [{ message: 'Invalid API key', extensions: { code: 'UNAUTHENTICATED' } }] });
      }
      if (mode === 'bare_400_data_null') {
        return json(200, { data: null, errors: [{ message: '400: Bad Request' }] });
      }
      if (mode === 'graphql_errors') {
        return json(200, {
          data: null,
          errors: [{ message: 'Cannot query field "nope" on type "Query".', path: ['query'] }],
        });
      }
      if (mode === 'http_500') return json(500, { message: 'boom' });
      if (mode === 'leaky_error') {
        // Worst case: the API echoes the Authorization header back at us.
        return json(200, { data: null, errors: [{ message: `bad token: ${lastAuthHeader}` }] });
      }

      if (query.includes('userFilePrepareUpload')) {
        const port = server.address().port;
        return json(200, {
          data: {
            userFilePrepareUpload: {
              uploadUrl: `http://127.0.0.1:${port}/presigned?sig=abc%2Fdef`,
              pendingUpload: { id: 'pending_1' },
            },
          },
        });
      }
      if (query.includes('userFileFinalizeUpload')) {
        const status = mode === 'finalize_incomplete' ? 'PENDING' : 'COMPLETE';
        return json(200, {
          data: {
            userFileFinalizeUpload: {
              pendingUpload: { status, userFile: status === 'COMPLETE' ? { id: 'file_42' } : null },
            },
          },
        });
      }

      return json(200, {
        data: {
          session: {
            currentUser: { display: 'Test User', emailAddress: 'test@example.com' },
            currentTeam: { displayName: 'Test Team', namespace: 'test' },
          },
        },
        received: { variables: parsed.variables || null, operationName: parsed.operationName || null },
      });
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

/* ------------------------------------------------------------------ *
 * client harness
 * ------------------------------------------------------------------ */

function createClient(env) {
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const pending = new Map();
  let buffer = '';
  let stderr = '';

  child.stderr.on('data', (c) => {
    stderr += c.toString();
  });
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let nl;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      const resolver = pending.get(msg.id);
      if (resolver) {
        pending.delete(msg.id);
        resolver(msg);
      }
    }
  });

  let nextId = 1;
  return {
    request(method, params) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, resolve);
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
        setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), 15000).unref();
      });
    },
    notify(method, params) {
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
    },
    stderr: () => stderr,
    close() {
      child.stdin.end();
      child.kill();
    },
  };
}

const text = (response) => response.result.content.map((c) => c.text).join('\n');

/* ------------------------------------------------------------------ *
 * tests
 * ------------------------------------------------------------------ */

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

let endpointUrl;
let tmpDir;
let keyFile;
let noKeyFile;

function envWithKey(extra) {
  return { LIGHTSOURCE_API_ENDPOINT: endpointUrl, LIGHTSOURCE_CREDENTIALS_FILE: keyFile, ...extra };
}
function envWithoutKey(extra) {
  return { LIGHTSOURCE_API_ENDPOINT: endpointUrl, LIGHTSOURCE_CREDENTIALS_FILE: noKeyFile, ...extra };
}

test('initialize returns serverInfo and echoes a supported protocol', async () => {
  const client = createClient(envWithKey());
  try {
    const res = await client.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test', version: '0' },
    });
    assert.strictEqual(res.result.protocolVersion, '2024-11-05');
    assert.strictEqual(res.result.serverInfo.name, 'lightsource');
    assert.ok(res.result.capabilities.tools);
  } finally {
    client.close();
  }
});

test('initialize falls back to default for an unknown protocol', async () => {
  const client = createClient(envWithKey());
  try {
    const res = await client.request('initialize', { protocolVersion: '1999-01-01' });
    assert.strictEqual(res.result.protocolVersion, '2025-06-18');
  } finally {
    client.close();
  }
});

test('tools/list advertises the three tools with schemas', async () => {
  const client = createClient(envWithKey());
  try {
    const res = await client.request('tools/list', {});
    const names = res.result.tools.map((t) => t.name).sort();
    assert.deepStrictEqual(names, ['credential_status', 'graphql_request', 'upload_file']);
    for (const tool of res.result.tools) {
      assert.ok(tool.description, `${tool.name} has a description`);
      assert.strictEqual(tool.inputSchema.type, 'object');
    }
  } finally {
    client.close();
  }
});

test('unknown method returns a JSON-RPC error, notification does not', async () => {
  const client = createClient(envWithKey());
  try {
    const res = await client.request('nonsense/method', {});
    assert.strictEqual(res.error.code, -32601);
    client.notify('notifications/initialized', {});
    const ping = await client.request('ping', {});
    assert.deepStrictEqual(ping.result, {});
  } finally {
    client.close();
  }
});

test('graphql_request succeeds and sends the bearer token', async () => {
  mode = 'ok';
  const client = createClient(envWithKey());
  try {
    const res = await client.request('tools/call', {
      name: 'graphql_request',
      arguments: { query: 'query WhoAmI { session { currentUser { display } } }' },
    });
    assert.strictEqual(res.result.isError, false);
    assert.ok(text(res).includes('test@example.com'));
    assert.strictEqual(lastAuthHeader, `Bearer ${TEST_KEY}`);
  } finally {
    client.close();
  }
});

test('graphql_request forwards variables and operationName', async () => {
  mode = 'ok';
  const client = createClient(envWithKey());
  try {
    const res = await client.request('tools/call', {
      name: 'graphql_request',
      arguments: {
        query: 'query A($id: ID!) { node(id: $id) { id } } query B { x }',
        variables: { id: 'abc"quoted\'\n newline' },
        operationName: 'A',
      },
    });
    const body = JSON.parse(text(res));
    assert.strictEqual(body.received.operationName, 'A');
    assert.strictEqual(body.received.variables.id, 'abc"quoted\'\n newline');
  } finally {
    client.close();
  }
});

test('missing key is reported with setup instructions and no API call', async () => {
  mode = 'ok';
  lastAuthHeader = null;
  const client = createClient(envWithoutKey());
  try {
    const res = await client.request('tools/call', {
      name: 'graphql_request',
      arguments: { query: '{ session { currentUser { display } } }' },
    });
    assert.strictEqual(res.result.isError, true);
    const out = text(res);
    assert.ok(/No usable API key found/.test(out));
    assert.ok(out.includes('credentials.json'));
    assert.strictEqual(lastAuthHeader, null, 'must not call the API without a key');
  } finally {
    client.close();
  }
});

test('an unsubstituted ${user_config} placeholder is not used as a key', async () => {
  const client = createClient(envWithoutKey({ LIGHTSOURCE_API_KEY: '${user_config.api_key}' }));
  try {
    const res = await client.request('tools/call', { name: 'credential_status', arguments: {} });
    assert.strictEqual(res.result.isError, true);
    assert.ok(/not found/.test(text(res)));
  } finally {
    client.close();
  }
});

test('environment key takes precedence over the credentials file', async () => {
  mode = 'ok';
  const client = createClient(envWithKey({ LIGHTSOURCE_API_KEY: 'env_key_wins' }));
  try {
    await client.request('tools/call', {
      name: 'graphql_request',
      arguments: { query: '{ session { currentUser { display } } }' },
    });
    assert.strictEqual(lastAuthHeader, 'Bearer env_key_wins');
  } finally {
    client.close();
  }
});

test('a plugin option supplies the key when no file exists', async () => {
  mode = 'ok';
  const client = createClient(envWithoutKey({ CLAUDE_PLUGIN_OPTION_API_KEY: 'from_keychain' }));
  try {
    const status = await client.request('tools/call', { name: 'credential_status', arguments: {} });
    assert.strictEqual(status.result.isError, false);
    assert.ok(/found via plugin option/.test(text(status)));

    await client.request('tools/call', {
      name: 'graphql_request',
      arguments: { query: '{ session { currentUser { display } } }' },
    });
    assert.strictEqual(lastAuthHeader, 'Bearer from_keychain');
  } finally {
    client.close();
  }
});

test('key source precedence is env, then plugin option, then file', async () => {
  mode = 'ok';
  const both = createClient(
    envWithKey({ LIGHTSOURCE_API_KEY: 'env_key', CLAUDE_PLUGIN_OPTION_API_KEY: 'option_key' }),
  );
  try {
    await both.request('tools/call', { name: 'graphql_request', arguments: { query: '{ x }' } });
    assert.strictEqual(lastAuthHeader, 'Bearer env_key', 'explicit env var must win');
  } finally {
    both.close();
  }

  const optionAndFile = createClient(envWithKey({ CLAUDE_PLUGIN_OPTION_API_KEY: 'option_key' }));
  try {
    await optionAndFile.request('tools/call', { name: 'graphql_request', arguments: { query: '{ x }' } });
    assert.strictEqual(lastAuthHeader, 'Bearer option_key', 'plugin option must beat the file');
  } finally {
    optionAndFile.close();
  }
});

test('an unsubstituted plugin option falls back to the credentials file', async () => {
  mode = 'ok';
  const client = createClient(envWithKey({ CLAUDE_PLUGIN_OPTION_API_KEY: '${user_config.api_key}' }));
  try {
    await client.request('tools/call', { name: 'graphql_request', arguments: { query: '{ x }' } });
    assert.strictEqual(lastAuthHeader, `Bearer ${TEST_KEY}`);
  } finally {
    client.close();
  }
});

test('the missing-key message names every source that was checked', async () => {
  const client = createClient(envWithoutKey());
  try {
    const res = await client.request('tools/call', { name: 'credential_status', arguments: {} });
    const out = text(res);
    assert.ok(out.includes('$LIGHTSOURCE_API_KEY'));
    assert.ok(out.includes('$CLAUDE_PLUGIN_OPTION_API_KEY'));
    assert.ok(out.includes('credentials.json'));
  } finally {
    client.close();
  }
});

test('HTTP 401 is classified as a rejected key', async () => {
  mode = 'http_401';
  const client = createClient(envWithKey());
  try {
    const res = await client.request('tools/call', {
      name: 'graphql_request',
      arguments: { query: '{ session { currentUser { display } } }' },
    });
    assert.strictEqual(res.result.isError, true);
    assert.ok(/was rejected/.test(text(res)));
  } finally {
    client.close();
  }
});

test('HTTP 200 with null session is classified as a rejected key', async () => {
  mode = 'session_null';
  const client = createClient(envWithKey());
  try {
    const res = await client.request('tools/call', {
      name: 'graphql_request',
      arguments: { query: '{ session { currentUser { display } } }' },
    });
    assert.strictEqual(res.result.isError, true);
    assert.ok(/was rejected/.test(text(res)), 'a 200 with a null session must not read as success');
  } finally {
    client.close();
  }
});

test('an UNAUTHENTICATED extension code is classified as a rejected key', async () => {
  mode = 'authy_error';
  const client = createClient(envWithKey());
  try {
    const res = await client.request('tools/call', {
      name: 'graphql_request',
      arguments: { query: '{ anything }' },
    });
    assert.ok(/was rejected/.test(text(res)));
  } finally {
    client.close();
  }
});

test('a bare "400: Bad Request" reads as an auth failure, not a schema error', async () => {
  // Both response shapes the API produced for one revoked key: session nulled
  // inside data, and data nulled outright. They must tell the same story.
  for (const shape of ['session_null', 'bare_400_data_null']) {
    mode = shape;
    const client = createClient(envWithKey());
    try {
      const res = await client.request('tools/call', {
        name: 'graphql_request',
        arguments: { query: '{ sourcingProjectSearch(query: "", first: 1) { edges { node { id } } } }' },
      });
      assert.strictEqual(res.result.isError, true, shape);
      assert.ok(/was rejected/.test(text(res)), `${shape} should read as a credential failure`);
    } finally {
      client.close();
    }
  }
});

test('ordinary GraphQL errors are surfaced as errors, not success', async () => {
  mode = 'graphql_errors';
  const client = createClient(envWithKey());
  try {
    const res = await client.request('tools/call', {
      name: 'graphql_request',
      arguments: { query: '{ nope }' },
    });
    assert.strictEqual(res.result.isError, true);
    const out = text(res);
    assert.ok(/GraphQL reported errors/.test(out));
    assert.ok(/Cannot query field/.test(out));
    assert.ok(!/was rejected/.test(out), 'schema errors must not be blamed on the key');
  } finally {
    client.close();
  }
});

test('HTTP 500 is reported as a status error', async () => {
  mode = 'http_500';
  const client = createClient(envWithKey());
  try {
    const res = await client.request('tools/call', {
      name: 'graphql_request',
      arguments: { query: '{ x }' },
    });
    assert.strictEqual(res.result.isError, true);
    assert.ok(/HTTP 500/.test(text(res)));
  } finally {
    client.close();
  }
});

test('an unreachable endpoint produces a transport diagnosis', async () => {
  mode = 'ok';
  const client = createClient({
    LIGHTSOURCE_CREDENTIALS_FILE: keyFile,
    LIGHTSOURCE_API_ENDPOINT: 'http://127.0.0.1:1/graphql',
  });
  try {
    const res = await client.request('tools/call', {
      name: 'graphql_request',
      arguments: { query: '{ x }' },
    });
    assert.strictEqual(res.result.isError, true);
    assert.ok(/Could not reach|refused/i.test(text(res)));
  } finally {
    client.close();
  }
});

test('the API key never appears in output, even if the API echoes it', async () => {
  mode = 'leaky_error';
  const client = createClient(envWithKey());
  try {
    const res = await client.request('tools/call', {
      name: 'graphql_request',
      arguments: { query: '{ x }' },
    });
    const out = text(res);
    assert.ok(!out.includes(TEST_KEY), 'key leaked into tool output');
    assert.ok(out.includes('[redacted]'));
  } finally {
    client.close();
  }
});

test('credential_status reports the source without revealing the key', async () => {
  const client = createClient(envWithKey());
  try {
    const res = await client.request('tools/call', { name: 'credential_status', arguments: {} });
    assert.strictEqual(res.result.isError, false);
    const out = text(res);
    assert.ok(/found via credentials file/.test(out));
    assert.ok(out.includes(`${TEST_KEY.length} characters`));
    assert.ok(!out.includes(TEST_KEY), 'credential_status leaked the key');
  } finally {
    client.close();
  }
});

test('upload_file runs prepare, PUT, finalize and returns the file id', async () => {
  mode = 'ok';
  putBodies = [];
  const filePath = path.join(tmpDir, 'parts.csv');
  fs.writeFileSync(filePath, 'part_number,qty\nABC-1,10\n');
  const client = createClient(envWithKey());
  try {
    const res = await client.request('tools/call', {
      name: 'upload_file',
      arguments: { path: filePath },
    });
    assert.strictEqual(res.result.isError, false);
    const out = JSON.parse(text(res));
    assert.strictEqual(out.userFileId, 'file_42');
    assert.strictEqual(out.mimeType, 'text/csv', 'mime type inferred from extension');
    assert.strictEqual(out.fileName, 'parts.csv');
    assert.strictEqual(putBodies.length, 1);
    assert.strictEqual(putBodies[0].auth, null, 'presigned PUT must not carry the API key');
    assert.ok(putBodies[0].body.toString().includes('ABC-1'));
    assert.ok(putBodies[0].url.includes('sig=abc%2Fdef'), 'presigned signature must survive intact');
  } finally {
    client.close();
  }
});

test('upload_file reports a non-COMPLETE finalize instead of returning an id', async () => {
  mode = 'finalize_incomplete';
  const filePath = path.join(tmpDir, 'parts2.csv');
  fs.writeFileSync(filePath, 'x\n');
  const client = createClient(envWithKey());
  try {
    const res = await client.request('tools/call', {
      name: 'upload_file',
      arguments: { path: filePath },
    });
    assert.strictEqual(res.result.isError, true);
    assert.ok(/status PENDING/.test(text(res)));
  } finally {
    client.close();
  }
});

test('upload_file reports a failed storage PUT with the storage host', async () => {
  mode = 'put_fails';
  const filePath = path.join(tmpDir, 'parts3.csv');
  fs.writeFileSync(filePath, 'x\n');
  const client = createClient(envWithKey());
  try {
    const res = await client.request('tools/call', {
      name: 'upload_file',
      arguments: { path: filePath },
    });
    assert.strictEqual(res.result.isError, true);
    const out = text(res);
    assert.ok(/step 2/.test(out));
    assert.ok(/127\.0\.0\.1/.test(out));
  } finally {
    client.close();
  }
});

test('upload_file explains sandbox paths it cannot see', async () => {
  mode = 'ok';
  const client = createClient(envWithKey());
  try {
    const res = await client.request('tools/call', {
      name: 'upload_file',
      arguments: { path: '/sessions/somewhere/mnt/outputs/nope.csv' },
    });
    assert.strictEqual(res.result.isError, true);
    assert.ok(/Cowork sandbox/.test(text(res)));
  } finally {
    client.close();
  }
});

test('bad arguments are rejected without calling the API', async () => {
  mode = 'ok';
  lastAuthHeader = null;
  const client = createClient(envWithKey());
  try {
    const empty = await client.request('tools/call', {
      name: 'graphql_request',
      arguments: { query: '   ' },
    });
    assert.strictEqual(empty.result.isError, true);

    const badVars = await client.request('tools/call', {
      name: 'graphql_request',
      arguments: { query: '{ x }', variables: ['not', 'an', 'object'] },
    });
    assert.strictEqual(badVars.result.isError, true);
    assert.ok(/must be a JSON object/.test(text(badVars)));

    const unknown = await client.request('tools/call', { name: 'no_such_tool', arguments: {} });
    assert.strictEqual(unknown.error.code, -32602);
    assert.strictEqual(lastAuthHeader, null);
  } finally {
    client.close();
  }
});

test('a malformed credentials file is diagnosed precisely', async () => {
  const badFile = path.join(tmpDir, 'bad.json');
  fs.writeFileSync(badFile, '{ not json');
  const client = createClient({
    LIGHTSOURCE_API_ENDPOINT: endpointUrl,
    LIGHTSOURCE_CREDENTIALS_FILE: badFile,
  });
  try {
    const res = await client.request('tools/call', { name: 'credential_status', arguments: {} });
    assert.ok(/not valid JSON/.test(text(res)));
  } finally {
    client.close();
  }

  const emptyKey = path.join(tmpDir, 'empty.json');
  fs.writeFileSync(emptyKey, '{"api_key": "  "}');
  const client2 = createClient({
    LIGHTSOURCE_API_ENDPOINT: endpointUrl,
    LIGHTSOURCE_CREDENTIALS_FILE: emptyKey,
  });
  try {
    const res = await client2.request('tools/call', { name: 'credential_status', arguments: {} });
    assert.ok(/no non-empty/.test(text(res)));
  } finally {
    client2.close();
  }
});

/* ------------------------------------------------------------------ *
 * runner
 * ------------------------------------------------------------------ */

(async () => {
  const stub = await startStub();
  endpointUrl = `http://127.0.0.1:${stub.address().port}/graphql`;
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lightsource-mcp-test-'));
  keyFile = path.join(tmpDir, 'credentials.json');
  noKeyFile = path.join(tmpDir, 'absent', 'credentials.json');
  fs.writeFileSync(keyFile, JSON.stringify({ api_key: TEST_KEY }));

  let failed = 0;
  for (const { name, fn } of tests) {
    try {
      await fn();
      process.stdout.write(`  ok    ${name}\n`);
    } catch (err) {
      failed++;
      process.stdout.write(`  FAIL  ${name}\n        ${err.message}\n`);
    }
  }

  stub.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  process.stdout.write(`\n${tests.length - failed}/${tests.length} passed\n`);
  process.exit(failed === 0 ? 0 : 1);
})();
