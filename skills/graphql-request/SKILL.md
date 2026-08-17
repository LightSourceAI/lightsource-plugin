---
name: graphql-request
description: Executes a GraphQL query or mutation against the LightSource API. Handles endpoint selection and authentication. All other skills should delegate API calls through this skill.
---

## Goal

Send a GraphQL request to the LightSource API and return the response.

## Execution

Every request goes through the `lightsource-graphql` command, which the plugin puts on the Bash tool's `PATH`. It owns the endpoint, credential lookup, and JSON encoding, so never build a `curl` call to the API by hand and never read the API key yourself.

Pass the query as the first argument and, when the operation takes variables, a JSON object as the second. Use variables instead of string interpolation so quotes, newlines, and user-supplied text can't corrupt the payload:

```bash
lightsource-graphql 'mutation Foo($id: ID!) { ... }' '{"id": "abc123"}'
```

For long queries, pass them on stdin instead:

```bash
lightsource-graphql --variables '{"id": "abc123"}' <<'GQL'
mutation Foo($id: ID!) {
  ...
}
GQL
```

The command prints the raw JSON response on stdout and signals what happened with its exit code:

| Exit | Meaning | What to do |
| ---- | ------- | ---------- |
| `0` | Success | Use the `data` payload |
| `2` | API key missing or rejected | Show the setup instructions the command printed on stderr. Never ask the user to paste their key into the conversation, and never print a key |
| `3` | Request succeeded, response contains a top-level `errors` array | Report the errors; do not proceed as if the call worked |
| `1` | Usage or transport error, e.g. no network access to the API | Report it. Repeated permission prompts or connection failures usually mean the Bash tool isn't allowed to reach `api.lightsource.ai` |

Run `lightsource-graphql --check` to confirm the stored key works — it queries the current user and team and exits `2` if the key is missing or rejected. This is the fastest way to diagnose a setup problem before running a real workflow.

## Authentication

`lightsource-graphql` is the single definition of how credentials are found. It reads `$LIGHTSOURCE_API_KEY` if set, otherwise `api_key` from `~/.config/lightsource/credentials.json` (override the path with `$LIGHTSOURCE_CREDENTIALS_FILE`). No other skill, script, or document should restate, duplicate, or reimplement that lookup — delegate here instead.

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

This is the one request that doesn't go through `lightsource-graphql`: the URL is presigned, so it carries no `Authorization` header and no API key. Store the URL in a shell variable as soon as Step 1 returns it and reference the variable — copy-pasting it mangles the special characters in the signature.

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
