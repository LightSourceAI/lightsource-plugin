#!/usr/bin/env node
/**
 * LightSource MCP server (stdio).
 *
 * Runs host-side as a normal process on the user's machine, so it can read the
 * credentials file in the real home directory and reach api.lightsource.ai
 * directly. This is what makes the plugin usable from Cowork, where the Bash
 * tool runs in a sandbox that has neither the home directory nor egress to the
 * API.
 *
 * Zero dependencies on purpose: no install step, no lockfile, no supply chain.
 * Requires Node 18+ for global fetch.
 *
 * Protocol: JSON-RPC 2.0 over newline-delimited JSON on stdin/stdout.
 * stdout carries protocol traffic only — all diagnostics go to stderr.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const SERVER_NAME = 'lightsource';
const SERVER_VERSION = '0.4.0';
const SUPPORTED_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const DEFAULT_PROTOCOL = '2025-06-18';
const DEFAULT_ENDPOINT = 'https://api.lightsource.ai/graphql';
const DEFAULT_TIMEOUT_MS = 60000;

const SETUP_INSTRUCTIONS = [
  'Ask the user to run this in a terminal (Terminal on macOS, Git Bash on Windows).',
  'Do not run it yourself, and never accept an API key pasted into the conversation:',
  '',
  '  mkdir -p ~/.config/lightsource',
  "  printf 'LightSource API key: '; read -rs LS_KEY; echo",
  '  (umask 077; printf \'{"api_key": "%s"}\\n\' "$LS_KEY" > ~/.config/lightsource/credentials.json)',
  '  chmod 600 ~/.config/lightsource/credentials.json; unset LS_KEY',
  '',
  'Keys come from Settings -> API Keys in the LightSource app.',
  'The MCP server picks up a newly written key on the next call - no restart needed.',
].join('\n');

/* ------------------------------------------------------------------ *
 * logging
 * ------------------------------------------------------------------ */

const DEBUG = truthy(process.env.LIGHTSOURCE_MCP_DEBUG);

function truthy(value) {
  return typeof value === 'string' && /^(1|true|yes|on)$/i.test(value.trim());
}

function debug(...args) {
  if (DEBUG) process.stderr.write(`[lightsource-mcp] ${args.join(' ')}\n`);
}

/* ------------------------------------------------------------------ *
 * credentials
 * ------------------------------------------------------------------ */

/**
 * A value counts as absent when it is empty, whitespace, or an unsubstituted
 * template placeholder. The last case matters: if a plugin manifest references
 * ${user_config.api_key} and the host does not substitute it, the literal
 * string arrives here and must not be sent as a bearer token.
 */
function presentEnv(name) {
  const raw = process.env[name];
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (!value) return null;
  if (value.startsWith('${') || value.startsWith('{{')) {
    debug(`ignoring unsubstituted placeholder in $${name}`);
    return null;
  }
  return value;
}

function credentialsFilePath() {
  const override = presentEnv('LIGHTSOURCE_CREDENTIALS_FILE');
  if (override) return override;
  const configHome = presentEnv('XDG_CONFIG_HOME') || path.join(os.homedir(), '.config');
  return path.join(configHome, 'lightsource', 'credentials.json');
}

/**
 * Sources are tried in this order. CLAUDE_PLUGIN_OPTION_API_KEY is how a value
 * declared under `userConfig` in the plugin manifest reaches a child process:
 * the user enters it once in the plugin's config and the host stores it in the
 * OS keychain, so no plaintext file is involved.
 *
 * That variable is documented for hook processes; whether MCP servers also
 * receive it is not, so it is read opportunistically rather than relied on, and
 * the manifest deliberately avoids a ${user_config.api_key} reference in the
 * server's `env` block. An unset reference there can abort the spawn, which
 * would take the working credentials-file path down with it.
 */
const KEY_ENV_VARS = [
  ['LIGHTSOURCE_API_KEY', 'environment ($LIGHTSOURCE_API_KEY)'],
  ['CLAUDE_PLUGIN_OPTION_API_KEY', 'plugin option (api_key, stored by the host)'],
];

/**
 * Resolve the API key. Read fresh on every call so a rotated key takes effect
 * without restarting the server. Returns { key, source } or { key: null, ... }.
 */
function resolveApiKey() {
  const file = credentialsFilePath();
  for (const [name, source] of KEY_ENV_VARS) {
    const value = presentEnv(name);
    if (value) return { key: value, source, file };
  }

  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    return { key: null, file, reason: err.code === 'ENOENT' ? 'missing' : `unreadable (${err.code})` };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { key: null, file, reason: 'not valid JSON' };
  }

  const key = typeof parsed.api_key === 'string' ? parsed.api_key.trim() : '';
  if (!key) return { key: null, file, reason: 'no non-empty "api_key" field' };
  return { key, source: `credentials file (${file})`, file };
}

/**
 * Belt and braces: strip the key from anything we are about to hand back to the
 * model, in case an upstream error message echoes the Authorization header.
 */
function redact(text, key) {
  if (!key || typeof text !== 'string') return text;
  return text.split(key).join('[redacted]');
}

/* ------------------------------------------------------------------ *
 * HTTP
 * ------------------------------------------------------------------ */

function endpoint() {
  return presentEnv('LIGHTSOURCE_API_ENDPOINT') || DEFAULT_ENDPOINT;
}

function timeoutMs() {
  const raw = presentEnv('LIGHTSOURCE_TIMEOUT_MS');
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

async function httpRequest(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs());
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const body = await response.text();
    return { status: response.status, body };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Turn a thrown fetch error into an explanation that names the likely cause.
 * The failure we most want to be unambiguous is "this process cannot reach the
 * API", since that is what silently broke the old sandboxed curl approach.
 */
function describeTransportError(err, url) {
  const cause = err && err.cause ? err.cause : {};
  const code = cause.code || err.code;
  const host = safeHost(url);
  if (err && err.name === 'AbortError') {
    return `Request to ${host} timed out after ${timeoutMs()}ms. The API may be slow or unreachable; retry, or raise $LIGHTSOURCE_TIMEOUT_MS.`;
  }
  switch (code) {
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return `DNS lookup for ${host} failed (${code}). Check the host's network connection and $LIGHTSOURCE_API_ENDPOINT.`;
    case 'ECONNREFUSED':
      return `Connection to ${host} was refused (${code}).`;
    case 'CERT_HAS_EXPIRED':
    case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
    case 'SELF_SIGNED_CERT_IN_CHAIN':
      return `TLS verification failed for ${host} (${code}). A corporate proxy may be intercepting HTTPS.`;
    default:
      return `Could not reach ${host}${code ? ` (${code})` : ''}: ${err && err.message}`;
  }
}

function safeHost(url) {
  try {
    return new URL(url).host;
  } catch {
    return String(url);
  }
}

/* ------------------------------------------------------------------ *
 * tool results
 * ------------------------------------------------------------------ */

function textResult(text, isError) {
  return { content: [{ type: 'text', text }], isError: Boolean(isError) };
}

function checkedSources(resolution) {
  return [
    ...KEY_ENV_VARS.map(([name]) => `$${name}`),
    `${resolution.file} (${resolution.reason === 'missing' ? 'file does not exist' : resolution.reason})`,
  ].join(', ');
}

function missingKeyResult(resolution) {
  return textResult(
    `No usable API key found. Checked ${checkedSources(resolution)}.\n\n${SETUP_INSTRUCTIONS}`,
    true,
  );
}

/* ------------------------------------------------------------------ *
 * tools
 * ------------------------------------------------------------------ */

const TOOLS = [
  {
    name: 'graphql_request',
    description:
      'Execute a GraphQL query or mutation against the LightSource API. Authentication, endpoint selection, and error classification are handled here. Pass user-supplied text through `variables` rather than interpolating it into `query`.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The GraphQL document to execute (query or mutation).',
        },
        variables: {
          type: 'object',
          description: 'Variables for the operation. Omit for operations that take none.',
          additionalProperties: true,
        },
        operationName: {
          type: 'string',
          description: 'Operation to run when the document defines more than one.',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'upload_file',
    description:
      'Upload a local file to LightSource and return its userFile id, for use by mutations that attach files (item attachments, AI ingestion batches, sync transactions). Runs the full prepare -> PUT -> finalize sequence, including the presigned upload that carries no API key. Reads the file from the host filesystem, so pass a real path on the user\'s machine.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Absolute path to the file on the host filesystem.',
        },
        fileName: {
          type: 'string',
          description: 'Display name in LightSource. Defaults to the basename of `path`.',
        },
        mimeType: {
          type: 'string',
          description: 'MIME type. Inferred from the file extension when omitted.',
        },
        accessLevel: {
          type: 'string',
          enum: ['PRIVATE', 'PUBLIC_LIGHTSOURCE', 'PUBLIC_INTERNET'],
          description: 'Defaults to PRIVATE (team-only).',
        },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'credential_status',
    description:
      'Report whether a LightSource API key can be found and which source it came from, without making an API call and without revealing the key. Use this to diagnose authentication problems; use graphql_request with a session query to confirm the key is actually accepted.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

const MIME_TYPES = {
  '.csv': 'text/csv',
  '.tsv': 'text/tab-separated-values',
  '.txt': 'text/plain',
  '.json': 'application/json',
  '.pdf': 'application/pdf',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.zip': 'application/zip',
  '.step': 'model/step',
  '.stp': 'model/step',
  '.iges': 'model/iges',
  '.igs': 'model/iges',
  '.stl': 'model/stl',
  '.dxf': 'image/vnd.dxf',
  '.dwg': 'image/vnd.dwg',
};

function guessMimeType(filePath) {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

/**
 * Core GraphQL call. Returns { ok, status, json, body } and never throws for
 * HTTP-level or GraphQL-level failures — callers decide how to present them.
 */
async function callGraphQL({ query, variables, operationName, key }) {
  const payload = { query };
  if (variables && Object.keys(variables).length > 0) payload.variables = variables;
  if (operationName) payload.operationName = operationName;

  const url = endpoint();
  const { status, body } = await httpRequest(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
      'User-Agent': `lightsource-mcp/${SERVER_VERSION}`,
    },
    body: JSON.stringify(payload),
  });

  let json = null;
  try {
    json = JSON.parse(body);
  } catch {
    /* non-JSON response; body is reported as-is */
  }
  return { status, body, json };
}

/**
 * Classify a completed request. A rejected key does not reliably produce an
 * HTTP error on this API — it can come back as 200 with a top-level errors
 * array and a null session — so status alone is not enough.
 */
function classify(result) {
  const { status, json } = result;
  const errors = json && Array.isArray(json.errors) ? json.errors : null;
  const sessionIsNull =
    json && json.data && Object.prototype.hasOwnProperty.call(json.data, 'session') && json.data.session === null;

  if (status === 401 || status === 403) return 'unauthorized';
  if (errors && (sessionIsNull || looksAuthy(errors))) return 'unauthorized';
  if (status < 200 || status >= 300) return 'http_error';
  if (errors) return 'graphql_errors';
  return 'ok';
}

function looksAuthy(errors) {
  return errors.some((e) => {
    const code = e && e.extensions && (e.extensions.code || e.extensions.errorCode);
    const haystack = `${code || ''} ${(e && e.message) || ''}`.toLowerCase();
    if (/unauthenticated|unauthorized|forbidden|invalid api key|expired key|permission denied/.test(haystack)) {
      return true;
    }
    // A bare status-code message with no field path, e.g. "400: Bad Request".
    // The API emits this when the auth layer refuses a credential, and it is
    // the one failure most easily mistaken for a schema error: real schema
    // errors name the offending field and carry a path.
    return Boolean(e) && !e.path && /^(400|401|403):\s/.test(String(e.message || ''));
  });
}

async function toolGraphqlRequest(args) {
  if (!args || typeof args.query !== 'string' || !args.query.trim()) {
    return textResult('graphql_request requires a non-empty "query" string.', true);
  }
  if (args.variables != null && (typeof args.variables !== 'object' || Array.isArray(args.variables))) {
    return textResult('"variables" must be a JSON object when provided.', true);
  }

  const resolution = resolveApiKey();
  if (!resolution.key) return missingKeyResult(resolution);

  let result;
  try {
    result = await callGraphQL({
      query: args.query,
      variables: args.variables,
      operationName: args.operationName,
      key: resolution.key,
    });
  } catch (err) {
    return textResult(redact(describeTransportError(err, endpoint()), resolution.key), true);
  }

  const kind = classify(result);
  const pretty = result.json ? JSON.stringify(result.json, null, 2) : result.body;
  const payload = redact(pretty, resolution.key);

  switch (kind) {
    case 'ok':
      return textResult(payload, false);
    case 'unauthorized':
      return textResult(
        `The stored LightSource API key was rejected (HTTP ${result.status}). It was read from ${resolution.source}.\n\n` +
          `${payload}\n\nThe key exists but is not valid — it may have been revoked or rotated. ` +
          `Ask the user to store a fresh key; do not ask them to paste it into the conversation.\n\n${SETUP_INSTRUCTIONS}`,
        true,
      );
    case 'http_error':
      return textResult(`The API returned HTTP ${result.status}.\n\n${payload}`, true);
    case 'graphql_errors':
      return textResult(
        `The request reached the API but GraphQL reported errors (HTTP ${result.status}). ` +
          `Do not treat this as success.\n\n${payload}`,
        true,
      );
    default:
      return textResult(payload, true);
  }
}

async function toolUploadFile(args) {
  if (!args || typeof args.path !== 'string' || !args.path.trim()) {
    return textResult('upload_file requires a "path" string.', true);
  }

  const filePath = args.path;
  let contents;
  try {
    contents = fs.readFileSync(filePath);
  } catch (err) {
    return textResult(
      `Could not read ${filePath} (${err.code}). Pass an absolute path on the host filesystem. ` +
        `Paths inside the Cowork sandbox (for example /sessions/...) are not visible to this server; ` +
        `use the corresponding path on the user's machine instead.`,
      true,
    );
  }
  if (contents.length === 0) return textResult(`${filePath} is empty; nothing to upload.`, true);

  const resolution = resolveApiKey();
  if (!resolution.key) return missingKeyResult(resolution);

  const mimeType = (args.mimeType && String(args.mimeType)) || guessMimeType(filePath);
  const fileName = (args.fileName && String(args.fileName)) || path.basename(filePath);
  const accessLevel = args.accessLevel || 'PRIVATE';
  const key = resolution.key;

  // Step 1 - prepare
  let prepared;
  try {
    prepared = await callGraphQL({
      query:
        'mutation PrepareUpload($input: UserFilePrepareUploadInput!) {' +
        ' userFilePrepareUpload(input: $input) { uploadUrl pendingUpload { id } } }',
      variables: { input: { mimeType } },
      key,
    });
  } catch (err) {
    return textResult(redact(describeTransportError(err, endpoint()), key), true);
  }
  if (classify(prepared) !== 'ok') {
    return textResult(
      `Upload failed at step 1 (prepare). HTTP ${prepared.status}.\n\n` +
        redact(prepared.json ? JSON.stringify(prepared.json, null, 2) : prepared.body, key),
      true,
    );
  }

  const prep = prepared.json && prepared.json.data && prepared.json.data.userFilePrepareUpload;
  const uploadUrl = prep && prep.uploadUrl;
  const fileId = prep && prep.pendingUpload && prep.pendingUpload.id;
  if (!uploadUrl || !fileId) {
    return textResult(
      `Upload failed at step 1 (prepare): response did not include uploadUrl and pendingUpload.id.\n\n` +
        redact(JSON.stringify(prepared.json, null, 2), key),
      true,
    );
  }

  // Step 2 - presigned PUT. Deliberately no Authorization header: the
  // signature is in the URL and adding a bearer token can invalidate it.
  try {
    const put = await httpRequest(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': mimeType, 'Content-Length': String(contents.length) },
      body: contents,
    });
    if (put.status < 200 || put.status >= 300) {
      return textResult(
        `Upload failed at step 2 (PUT to storage): HTTP ${put.status}.\n\n${redact(put.body, key)}\n\n` +
          `The presigned URL points at ${safeHost(uploadUrl)}; a proxy or firewall blocking that host would produce this.`,
        true,
      );
    }
  } catch (err) {
    return textResult(redact(describeTransportError(err, uploadUrl), key), true);
  }

  // Step 3 - finalize
  let finalized;
  try {
    finalized = await callGraphQL({
      query:
        'mutation FinalizeUpload($input: UserFileFinalizeUploadInput!) {' +
        ' userFileFinalizeUpload(input: $input) { pendingUpload { status userFile { id } } } }',
      variables: { input: { fileId, fileName, accessLevel } },
      key,
    });
  } catch (err) {
    return textResult(redact(describeTransportError(err, endpoint()), key), true);
  }
  if (classify(finalized) !== 'ok') {
    return textResult(
      `Upload failed at step 3 (finalize). HTTP ${finalized.status}.\n\n` +
        redact(finalized.json ? JSON.stringify(finalized.json, null, 2) : finalized.body, key),
      true,
    );
  }

  const pending =
    finalized.json && finalized.json.data && finalized.json.data.userFileFinalizeUpload
      ? finalized.json.data.userFileFinalizeUpload.pendingUpload
      : null;
  const status = pending && pending.status;
  const userFileId = pending && pending.userFile && pending.userFile.id;

  if (status !== 'COMPLETE' || !userFileId) {
    return textResult(
      `Upload finalized with status ${status || 'unknown'} instead of COMPLETE. Do not use this file id.\n\n` +
        redact(JSON.stringify(finalized.json, null, 2), key),
      true,
    );
  }

  return textResult(
    JSON.stringify(
      { userFileId, fileName, mimeType, accessLevel, bytes: contents.length, status },
      null,
      2,
    ),
    false,
  );
}

async function toolCredentialStatus() {
  const resolution = resolveApiKey();
  const lines = [
    `endpoint: ${endpoint()}`,
    `sources checked, in order: ${KEY_ENV_VARS.map(([n]) => `$${n}`).join(', ')}, ${resolution.file}`,
  ];
  if (resolution.key) {
    lines.push(
      `api key: found via ${resolution.source}`,
      `key length: ${resolution.key.length} characters (value not shown)`,
      '',
      'A key was found but has not been validated. Run graphql_request with a session query to confirm the API accepts it.',
    );
    return textResult(lines.join('\n'), false);
  }
  lines.push(`api key: not found (credentials file ${resolution.reason})`, '', SETUP_INSTRUCTIONS);
  return textResult(lines.join('\n'), true);
}

async function dispatchTool(name, args) {
  switch (name) {
    case 'graphql_request':
      return toolGraphqlRequest(args);
    case 'upload_file':
      return toolUploadFile(args);
    case 'credential_status':
      return toolCredentialStatus();
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ *
 * JSON-RPC plumbing
 * ------------------------------------------------------------------ */

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function sendResult(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function sendError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

async function handleMessage(message) {
  const { id, method, params } = message;
  const isNotification = id === undefined || id === null;

  switch (method) {
    case 'initialize': {
      const requested = params && params.protocolVersion;
      const protocolVersion =
        requested && SUPPORTED_PROTOCOLS.includes(requested) ? requested : DEFAULT_PROTOCOL;
      debug(`initialize (client requested ${requested || 'nothing'}, using ${protocolVersion})`);
      return sendResult(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      });
    }

    case 'notifications/initialized':
    case 'initialized':
      return;

    case 'ping':
      return sendResult(id, {});

    case 'tools/list':
      return sendResult(id, { tools: TOOLS });

    case 'tools/call': {
      const name = params && params.name;
      const args = (params && params.arguments) || {};
      debug(`tools/call ${name}`);
      let result;
      try {
        result = await dispatchTool(name, args);
      } catch (err) {
        // An unexpected throw is a bug in this server; surface it as a tool
        // error rather than a protocol error so the model can report it.
        debug(`unhandled error in ${name}: ${err && err.stack}`);
        return sendResult(id, textResult(`Unexpected error in ${name}: ${err && err.message}`, true));
      }
      if (result === null) return sendError(id, -32602, `Unknown tool: ${name}`);
      return sendResult(id, result);
    }

    default:
      if (isNotification) return;
      return sendError(id, -32601, `Method not found: ${method}`);
  }
}

function main() {
  const major = Number.parseInt(process.versions.node.split('.')[0], 10);
  if (!Number.isFinite(major) || major < 18) {
    process.stderr.write(
      `[lightsource-mcp] Node 18 or newer is required (found ${process.versions.node}); ` +
        'this server uses the built-in fetch API.\n',
    );
    process.exit(1);
  }

  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        debug('ignoring unparseable line');
        sendError(null, -32700, 'Parse error');
        continue;
      }
      // Fire and forget: requests are independent, and serialising them would
      // stall long polling workflows behind each other.
      Promise.resolve(handleMessage(message)).catch((err) => {
        debug(`handler rejected: ${err && err.stack}`);
      });
    }
  });
  process.stdin.on('end', () => process.exit(0));
  debug(`started (node ${process.versions.node}, endpoint ${endpoint()})`);
}

main();
