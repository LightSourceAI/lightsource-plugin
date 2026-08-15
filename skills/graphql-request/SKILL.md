---
name: graphql-request
description: Executes a GraphQL query or mutation against the LightSource API. Handles endpoint selection and authentication. All other skills should delegate API calls through this skill.
---

## Goal

Send a GraphQL request to the LightSource API and return the response.

## Execution

The plugin ships no wrapper command — this skill is the single definition of how a
request is made. Copy the block below verbatim into one Bash invocation and change
only `QUERY` and `VARIABLES`. Never assemble a different `curl` call to the API, and
never read or print the API key outside this block.

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

Pass user-supplied text through `VARIABLES` rather than interpolating it into
`QUERY`, so quotes, newlines, and pasted content can't corrupt the payload. `jq -n`
does the JSON encoding; if `jq` is unavailable, replace the `BODY=` line with:

```bash
BODY=$(QUERY="$QUERY" VARIABLES="$VARIABLES" python3 -c '
import json, os
body = {"query": os.environ["QUERY"]}
raw = os.environ.get("VARIABLES") or ""
if raw.strip():
    body["variables"] = json.loads(raw)
print(json.dumps(body))
')
```

and read the key with:

```bash
API_KEY="${LIGHTSOURCE_API_KEY:-$(KEY_FILE="$KEY_FILE" python3 -c \
  'import json, os; print(json.load(open(os.environ["KEY_FILE"])).get("api_key", ""))' 2>/dev/null)}"
```

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

## Reading the result

The block prints the raw JSON response followed by `http_status=<code>`. Interpret
them together — a bad key does not produce an HTTP error:

| What you see | Meaning | What to do |
| ------------ | ------- | ---------- |
| `http_status=2xx`, no top-level `errors` | Success | Use the `data` payload |
| Exit code 2, "No LightSource API key found" | Key missing | Show the setup instructions below. Never ask the user to paste their key into the conversation, and never print a key |
| `http_status=401` or `403`, or a top-level `errors` array with `"session": null` | Key present but rejected | Same setup instructions, but say the stored key was rejected rather than missing |
| `http_status=2xx` with a top-level `errors` array | Request went through, GraphQL reported errors | Report the errors; do not proceed as if the call worked |
| Any other non-2xx status, or `http_status=000` with a `curl` error | Usage or transport error | Report it. Repeated permission prompts or connection failures usually mean the Bash tool isn't allowed to reach `api.lightsource.ai` |

To confirm the stored key works before running a real workflow, run the block with
this query and no variables — it exercises credential resolution end to end:

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

This skill is the single definition of how credentials are found: `$LIGHTSOURCE_API_KEY`
if set, otherwise `api_key` from `~/.config/lightsource/credentials.json` (override the
path with `$LIGHTSOURCE_CREDENTIALS_FILE`). No other skill or document should restate,
duplicate, or reimplement that lookup — delegate here instead.

When the key is missing or rejected, print these instructions for the user to run in a
terminal themselves. Do not run them, and do not accept a key typed into the
conversation:

```bash
mkdir -p ~/.config/lightsource
printf 'LightSource API key: '; read -rs LS_KEY; echo
(umask 077; printf '{"api_key": "%s"}\n' "$LS_KEY" > ~/.config/lightsource/credentials.json)
chmod 600 ~/.config/lightsource/credentials.json; unset LS_KEY
```

Keys come from **Settings → API Keys** in the LightSource app. For CI or scripted runs,
`export LIGHTSOURCE_API_KEY` instead — it takes precedence over the file.

## How to use from another skill

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

Used whenever a file must be uploaded to LightSource before being attached to an item, ingestion batch, or sync transaction.

### Step 1 — Prepare upload

```graphql
mutation {
  userFilePrepareUpload(input: { mimeType: "<mime-type>" }) {
    uploadUrl
    pendingUpload {
      id
    }
  }
}
```

Capture `uploadUrl` and `pendingUpload.id`.

### Step 2 — PUT file to upload URL

```bash
curl -s -X PUT "<uploadUrl>" \
  -H "Content-Type: <mime-type>" \
  --data-binary @"<local-file-path>"
```

This is the one request that skips the block above: the URL is presigned, so it carries no `Authorization` header and no API key. Store the URL in a shell variable as soon as Step 1 returns it and reference the variable — copy-pasting it mangles the special characters in the signature.

### Step 3 — Finalize upload

```graphql
mutation {
  userFileFinalizeUpload(
    input: {
      fileId: "<pendingUpload.id>"
      fileName: "<display-name>"
      accessLevel: PRIVATE
    }
  ) {
    pendingUpload {
      status
      userFile {
        id
      }
    }
  }
}
```

`accessLevel` options: `PRIVATE` (team-only), `PUBLIC_LIGHTSOURCE` (visible to connected teams), `PUBLIC_INTERNET`. Check `status` — if not `COMPLETE`, report the error and stop. The returned `userFile.id` is used by other mutations to reference the uploaded file.
