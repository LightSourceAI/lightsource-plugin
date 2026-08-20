---
name: graphql-request
description: Executes a GraphQL query or mutation against the LightSource API. Handles endpoint selection and authentication. All other skills should delegate API calls through this skill.
---

## Goal

Send a GraphQL request to the LightSource API and return the response.

## Execution

The plugin ships an MCP server that makes the request for you. Call its
`graphql_request` tool with the operation and its variables:

```
graphql_request
  query:     "query WhoAmI { session { currentUser { display } } }"
  variables: { "id": "abc123" }     # omit for operations with no variables
```

The tool appears in the tool list under the `lightsource` MCP server. When the
plugin is installed from the marketplace it is named
`mcp__plugin_lightsource_lightsource__graphql_request`; the prefix depends on how
the plugin was installed, so use whatever the tool list actually shows.

The server runs as a normal process on the user's machine, so it reads the
credentials file from the real home directory and reaches `api.lightsource.ai`
directly. That is what makes this work in Cowork, where the Bash tool runs in a
sandbox with neither the home directory nor egress to the API.

Two rules that still matter:

Pass user-supplied text through `variables` rather than interpolating it into
`query`, so quotes, newlines, and pasted content cannot corrupt the operation.

Never read, print, or ask for the API key. The server resolves it internally and
redacts it from its own output; nothing else should touch it.

The server also exposes `upload_file` (see below) and `credential_status`, which
reports whether a key was found and where it came from without revealing it or
calling the API — useful when authentication is failing and you want to separate
"no key" from "key rejected".

## Reading the result

On success the tool returns the raw JSON response; use the `data` payload.

On failure it returns an error result whose text names the cause, already
classified. You do not need to re-derive any of this:

| What the tool says                             | Meaning                                                                                                          | What to do                                                                                                                  |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `No API key found` / `No usable API key found` | Nothing to authenticate with; no request was made                                                                | Relay the setup instructions in the tool output. Never ask the user to paste a key into the conversation                    |
| `The stored LightSource API key was rejected`  | A key was found but the API refused it, whether by HTTP 401/403, a null `session`, or an `UNAUTHENTICATED` error | Say the stored key was rejected rather than missing — it was probably revoked or rotated — and relay the setup instructions |
| `GraphQL reported errors`                      | The request reached the API and failed on its own terms, usually a schema or input problem                       | Report the errors. Do not proceed as if the call worked, and do not blame the credentials                                   |
| `The API returned HTTP <code>`                 | Server-side or gateway failure                                                                                   | Report it; retry if it looks transient                                                                                      |
| `Could not reach ...` / `timed out`            | The host process could not complete the connection                                                               | Report it. Check the user's network and any corporate proxy. This is about the user's machine, not the sandbox              |

To confirm the stored key works before running a real workflow, call
`graphql_request` with this operation and no variables — it exercises credential
resolution end to end:

```graphql
query CredentialCheck {
  session {
    currentUser {
      display
      emailAddress
    }
    currentTeam {
      displayName
      namespace
    }
  }
}
```

## Authentication

The MCP server is the single definition of how credentials are found. It tries, in
order: `$LIGHTSOURCE_API_KEY`, then the plugin's own `api_key` option (delivered
as `$CLAUDE_PLUGIN_OPTION_API_KEY` and held in the OS keychain), then `api_key`
from `~/.config/lightsource/credentials.json` — path overridable with
`$LIGHTSOURCE_CREDENTIALS_FILE`. No skill should restate, duplicate, or
reimplement that lookup. All sources are re-read on every call, so a newly stored
key takes effect without restarting anything.

`credential_status` reports which of those sources supplied the key, which is the
quickest way to tell whether a value entered in the plugin's settings is actually
reaching the server.

When the key is missing or rejected, the tool output includes the setup commands
verbatim — relay them and let the user run them in a terminal themselves. Do not
run them, and do not accept a key typed into the conversation.

Keys come from **Settings → API Keys** in the LightSource app.

## Fallback: direct request from Bash

Use this only where the MCP server is unavailable — the Claude Code CLI with the
MCP server disabled, CI, or debugging the server itself. It cannot work in
Cowork: the sandbox has no access to the credentials file and no egress to
`api.lightsource.ai`. If the MCP tool is present, use it instead.

```bash
set -uo pipefail

QUERY='query Foo($id: ID!) { ... }'
VARIABLES='{"id": "abc123"}'   # leave as '' for operations with no variables

KEY_FILE="${LIGHTSOURCE_CREDENTIALS_FILE:-${XDG_CONFIG_HOME:-$HOME/.config}/lightsource/credentials.json}"
API_KEY="${LIGHTSOURCE_API_KEY:-$(jq -r '.api_key // empty' "$KEY_FILE" 2>/dev/null)}"
if [ -z "$API_KEY" ]; then
  printf 'No LightSource API key found (checked $LIGHTSOURCE_API_KEY and %s).\n' "$KEY_FILE" >&2
  exit 2
fi

BODY=$(jq -n --arg q "$QUERY" --argjson v "${VARIABLES:-null}" \
  'if $v == null then {query: $q} else {query: $q, variables: $v} end')

RESPONSE=$(printf '%s' "$BODY" | curl -sS -X POST \
  "${LIGHTSOURCE_API_ENDPOINT:-https://api.lightsource.ai/graphql}" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $API_KEY" \
  -w '\n%{http_code}' --data-binary @-)

printf '%s\n' "${RESPONSE%$'\n'*}"
printf 'http_status=%s\n' "${RESPONSE##*$'\n'}"
```

This prints the JSON response followed by `http_status=<code>`. Interpret them
together, using the same classification as the table above — in particular, a
rejected key can still arrive as `http_status=200` with a top-level `errors`
array and a null `session`.

For long queries, build `QUERY` from a quoted heredoc instead of a single-quoted
string:

```bash
QUERY=$(cat <<'GQL'
mutation Foo($id: ID!) {
  ...
}
GQL
)
```

## How to use from another skill

Instead of hardcoding a request, describe the GraphQL operation needed and note:
Instead of hardcoding a request, describe the GraphQL operation needed and note:

> "Execute this via the graphql-request skill."

## Common lookups

### Resolve an RFQ name → ID

Used by any skill that accepts an RFQ name or ID. If given a name, run this first and use the returned `id` for all subsequent calls. Pick the closest match by title if multiple results are returned; confirm with the user if ambiguous.

```graphql
{
  sourcingProjectSearch(query: "<name>", first: 5) {
    edges {
      node {
        id
        latestRevision {
          title
        }
      }
    }
  }
}
```

## File upload procedure

Used whenever a file must be uploaded to LightSource before being attached to an
item, ingestion batch, or sync transaction.

Call the `upload_file` tool with a path on the user's machine. It runs the whole
prepare → PUT → finalize sequence and returns the `userFileId` that other
mutations reference:

```
upload_file
  path:        "/Users/you/Downloads/parts.csv"
  fileName:    "Q3 parts"            # optional, defaults to the file's basename
  mimeType:    "text/csv"            # optional, inferred from the extension
  accessLevel: "PRIVATE"             # PRIVATE | PUBLIC_LIGHTSOURCE | PUBLIC_INTERNET
```

`accessLevel` defaults to `PRIVATE` (team-only); `PUBLIC_LIGHTSOURCE` is visible
to connected teams. The tool fails loudly rather than returning an id if the
upload does not finalize as `COMPLETE`.

Pass a host path, not a sandbox path. Files the user attaches to a Cowork
conversation are visible to the Bash tool under `/sessions/.../mnt/uploads`, but
the MCP server runs outside that sandbox and cannot see those paths; it needs the
location on the user's own filesystem.

### Doing it by hand

Only relevant when using the Bash fallback above. Three steps: `userFilePrepareUpload`
with the `mimeType` returns an `uploadUrl` and `pendingUpload.id`; a plain `PUT`
of the file bytes to that URL follows, with a `Content-Type` header and no
`Authorization` header, since the signature is in the URL and a bearer token can
invalidate it; then `userFileFinalizeUpload` with the `fileId`, `fileName`, and
`accessLevel` returns `pendingUpload.status` and `userFile.id`. Store the URL in
a shell variable as soon as step 1 returns it and reference the variable —
copy-pasting mangles the special characters in the signature. If `status` is not
`COMPLETE`, report the error and stop.

```graphql
mutation Prepare($input: UserFilePrepareUploadInput!) {
  userFilePrepareUpload(input: $input) {
    uploadUrl
    pendingUpload {
      id
    }
  }
}

mutation Finalize($input: UserFileFinalizeUploadInput!) {
  userFileFinalizeUpload(input: $input) {
    pendingUpload {
      status
      userFile {
        id
      }
    }
  }
}
```
