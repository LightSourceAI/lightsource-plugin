# LightSource for Claude Cowork

Run your sourcing workflows from a Cowork conversation: create RFQs, add parts from a spreadsheet you drop into the chat, assign suppliers, run AI award optimization, and keep your parts and supplier records up to date — without opening the LightSource UI or writing a line of code.

## Prerequisites

- The [Claude desktop app](https://claude.ai/download) (macOS, Windows, or Linux beta), signed in, with the **Cowork** tab open
- A LightSource account with an API key — get one at **Settings → API Keys** in the app
- **Node.js 18 or newer** on your machine. The plugin ships a small MCP server that talks to the LightSource API, and it runs on Node. Check with `node --version`; if that command is not found, install Node from [nodejs.org](https://nodejs.org)

## Installation

Cowork loads its skills, plugins, and connectors from the desktop app's **Customize** configuration, which syncs through your claude.ai account.

LightSource is not listed in Anthropic's public plugin marketplace, so searching the plugin browser won't find it. You add the LightSource marketplace yourself first, then install the plugin from it.

**Step 1 — Open Plugins**:

In the Claude desktop app, click **Customize** in the sidebar, then open **Plugins**. You can also click the **+** button next to the prompt box in any Cowork conversation and choose **Plugins**.

**Step 2 — Add the LightSource marketplace**:

Choose **Add marketplace** and enter this GitHub URL:

```
https://github.com/LightSourceAI/lightsource-plugin
```

This registers the catalog only — no plugin is installed yet.

**Step 3 — Install the plugin**:

With the marketplace added, find **lightsource** in its listing and install it. Use **Manage plugins** later to enable, disable, or uninstall it.

**Step 4 — Store your API key**:

Copy a key from **Settings → API Keys** in the LightSource app.

If the plugin offers a **Configure options** step — in the CLI it's under `/plugin` — enter the key there as **LightSource API key** and skip the rest of this step. It goes into your operating system's keychain rather than a file, and there is nothing else to set up.

Otherwise, paste these four commands into a terminal — Terminal on macOS, Git Bash on Windows. Paste the key at the prompt; it stays hidden as you type.

```bash
mkdir -p ~/.config/lightsource
printf 'LightSource API key: '; read -rs LS_KEY; echo
(umask 077; printf '{"api_key": "%s"}\n' "$LS_KEY" > ~/.config/lightsource/credentials.json)
chmod 600 ~/.config/lightsource/credentials.json; unset LS_KEY
```

That writes the key to a file — it sets no environment variable, so there is nothing to add to your shell profile. To keep credentials elsewhere, point `$LIGHTSOURCE_CREDENTIALS_FILE` at your own JSON file with an `api_key` field.

The file is re-read on every call, so rotating a key means re-running these commands — nothing to restart.

**Step 5 — Confirm it works**:

Send this in a Cowork conversation:

```
/lightsource:whoami
```

It reports your LightSource user and active team. If the key is missing or rejected, the plugin says which and repeats the setup commands.

## Using it in Cowork

You don't need to remember skill names. Describe the outcome you want and attach any files by dragging them into the prompt box — Claude picks the right skill and asks for anything it's missing.

> "Launch an RFQ called _Q3 Machined Housings_ from this spreadsheet, assign suppliers, and add Dana as a collaborator."

> "Pull the parts out of these three supplier PDFs and add them to the _Q3 Machined Housings_ RFQ."

> "Run award optimization on _Q3 Machined Housings_ and tell me what it picked."

> "Which suppliers in our rolodex do sheet metal work, and which ones have quoted us before?"

To invoke a skill directly, type `/` in the prompt box and pick it from the list, or click **+ → Slash commands** to browse.

A few Cowork-specific things worth knowing:

- **Attachments beat file paths.** Drop a CSV, Excel file, or PDF into the conversation and refer to it in plain language. Claude uploads it to LightSource as part of the workflow.
- **Long jobs keep running.** AI ingestion and award optimization both poll for several minutes. You can leave the conversation and come back to it.
- **Dispatch works too.** Message a task from the Claude mobile app and it runs in Cowork on your machine, so "start the RFQ for the parts I emailed over" works from your phone.
- **Scheduled tasks** in the desktop app run locally and load the same plugins, which suits recurring work like a Monday morning summary of open RFQs.

## Skills

Claude selects these automatically, or you can invoke one as `/lightsource:<skill-name>`.

### Sourcing (RFQ)

| Skill                                   | Description                                                                                                                  |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `/lightsource:launch-rfq`               | Full pipeline: create an RFQ, add parts from a file, assign suppliers, add a collaborator, and post an internal team message |
| `/lightsource:add-items-to-rfq`         | Add parts to an existing RFQ from a file or by part name/number                                                              |
| `/lightsource:add-items-ai-ingestion`   | Use the AI ingestion pipeline to extract and add parts from one or more files                                                |
| `/lightsource:assign-suppliers-to-rfq`  | Assign relevant suppliers to an RFQ based on part categories                                                                 |
| `/lightsource:optimize-rfq-award`       | Trigger AI award optimization, poll until ready, then approve to create an award scenario                                    |
| `/lightsource:add-internal-rfq-message` | Post a message to the internal (team-only) thread of an RFQ                                                                  |
| `/lightsource:add-rfq-collaborator`     | Add one or more team members as collaborators on an RFQ                                                                      |

### Parts & BOMs

| Skill                       | Description                                                           |
| --------------------------- | --------------------------------------------------------------------- |
| `/lightsource:manage-items` | Search, update, archive, delete, and attach files to individual parts |

### Suppliers

| Skill                           | Description                                                               |
| ------------------------------- | ------------------------------------------------------------------------- |
| `/lightsource:manage-suppliers` | Query, update, and manage supplier companies and contacts in your rolodex |

### Account & API

| Skill                          | Description                                                              |
| ------------------------------ | ------------------------------------------------------------------------ |
| `/lightsource:whoami`          | Show the LightSource user and team tied to your API key                  |
| `/lightsource:graphql-request` | Execute a GraphQL query or mutation directly against the LightSource API |

## How it works

The plugin is a set of skills plus one small MCP server, at `mcp-server/index.js`.

Skills describe _what_ to ask the LightSource API for; the MCP server is the only thing that actually talks to it. It exposes three tools: `graphql_request` for any query or mutation, `upload_file` for the prepare → PUT → finalize upload sequence, and `credential_status` for diagnosing authentication without making a call. It has no dependencies — no `npm install`, no lockfile — and needs only Node 18+ for the built-in `fetch`.

Running on your machine rather than in Cowork's sandbox is the point: the sandbox has neither your home directory nor network access to the API, so the server is what makes the plugin work there. Your API key is never handed to the sandbox or interpolated into a shell command.

The `graphql-request` skill also documents a `curl` equivalent as a fallback for the CLI and for debugging the server. It cannot work in Cowork, for the reasons above.

To work on the server itself:

```bash
node mcp-server/test.js          # 23 tests against a stub API, no network needed
LIGHTSOURCE_MCP_DEBUG=1 ...      # log protocol traffic to stderr
LIGHTSOURCE_API_ENDPOINT=...     # point at a staging API
```

## Notes and limitations

- **Network access.** Requests to `https://api.lightsource.ai/graphql` come from your own machine, so no administrator allowance is needed for them. What can still block you is anything that blocks the LightSource web app in your browser — a corporate proxy, VPN, or firewall — plus the storage host that presigned upload URLs point to, if you attach files.
- **Desktop and CLI only.** Cowork on web and mobile does not run local MCP servers, so the skills need the desktop app or the Claude Code CLI. Installing the plugin in a cloud session won't help: the skills load, but every API call fails.
- **Where the API key lives.** The MCP server checks three sources in order: `$LIGHTSOURCE_API_KEY`, the plugin's `api_key` option (keychain-backed, entered via **Configure options**), then `~/.config/lightsource/credentials.json`. Whichever you use, the key never enters a conversation: the server does not return it, redacts it from any error text that echoes it, and the skills are instructed never to print it or ask you to paste it into the chat. Ask Claude to check the credential status to see which source it actually used.
- **Diagnosing auth problems.** Ask Claude to check the LightSource credential status. That reports whether a key was found and which source it came from, without revealing it or calling the API — enough to tell "no key stored" apart from "key stored but rejected".
- **Team and Enterprise plans.** Organizations can restrict which marketplaces members may add. If **Add marketplace** is missing or rejects the URL, your administrator needs to allow it or distribute the marketplace for everyone via **Organization settings → Plugins** on claude.ai.
- **Transmitting an RFQ to suppliers** is deliberately out of scope. The skills create and populate RFQs; sending them out stays a human step in the LightSource UI.

## Also works in the Claude Code CLI

The same plugin runs in the terminal if you prefer it. Install it separately there — CLI and Cowork installs are independent. Add the marketplace first, then install from it:

```
/plugin marketplace add https://github.com/LightSourceAI/lightsource-plugin
/plugin install lightsource@lightsource
```

Credential setup is the same — Step 4 above applies to every surface. For CI or scripted runs where writing a file isn't practical, set the key in the environment instead; it takes precedence over the credentials file:

```bash
export LIGHTSOURCE_API_KEY="your_api_key_here"
```

## Support

Questions or issues? Contact [support@lightsource.ai](mailto:support@lightsource.ai).
