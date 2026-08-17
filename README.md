# LightSource for Claude Cowork

Run your sourcing workflows from a Cowork conversation: create RFQs, add parts from a spreadsheet you drop into the chat, assign suppliers, run AI award optimization, and keep your parts and supplier records up to date — without opening the LightSource UI or writing a line of code.

## Prerequisites

- The [Claude desktop app](https://claude.ai/download) (macOS, Windows, or Linux beta), signed in, with the **Cowork** tab open
- A LightSource account with an API key — get one at **Settings → API Keys** in the app

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

Copy a key from **Settings → API Keys** in the LightSource app, then paste these four commands into a terminal — Terminal on macOS, Git Bash on Windows. Paste the key at the prompt; it stays hidden as you type.

```bash
mkdir -p ~/.config/lightsource
printf 'LightSource API key: '; read -rs LS_KEY; echo
(umask 077; printf '{"api_key": "%s"}\n' "$LS_KEY" > ~/.config/lightsource/credentials.json)
chmod 600 ~/.config/lightsource/credentials.json; unset LS_KEY
```

That writes the key to a file — it sets no environment variable, so there is nothing to add to your shell profile. To keep credentials elsewhere, point `$LIGHTSOURCE_CREDENTIALS_FILE` at your own JSON file with an `api_key` field.

**Step 5 — Confirm it works**:

Send this in a Cowork conversation:

```
/lightsource:whoami
```

It reports your LightSource user and active team. If the key is missing or rejected, the plugin says so and repeats the setup command.

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

## Notes and limitations

- **API access may need admin approval.** Every skill reaches LightSource by running the plugin's `lightsource-graphql` command, which posts to `https://api.lightsource.ai/graphql`. If your organization restricts tool permissions or network egress through managed settings, those requests are blocked or prompt for approval on each call. Ask your administrator to allow the Bash tool to run `lightsource-graphql` and `curl`, and to allowlist `api.lightsource.ai` — plus the storage host that presigned upload URLs point to, if you attach files. Symptoms of a missing allowance are repeated permission prompts, or connection and proxy errors while the LightSource web app works fine in your browser.
- **Where the API key lives.** Claude reads it from `~/.config/lightsource/credentials.json` (or `$LIGHTSOURCE_API_KEY`, which takes precedence). It is never stored in a conversation, and the skills are instructed never to print it or ask you to paste it into the chat. Rotating a key means re-running the Step 4 commands.
- **Team and Enterprise plans.** Organizations can restrict which marketplaces members may add. If **Add marketplace** is missing or rejects the URL, your administrator needs to allow it or distribute the marketplace for everyone via **Organization settings → Plugins** on claude.ai.
- **Cloud sessions** (Claude Code on the web, mobile web, routines) don't use the desktop plugin browser. To use the plugin there, declare it under `enabledPlugins` in a repository's `.claude/settings.json` so it installs at session start.
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
