# pika

pika is the [pi](https://github.com/badlogic/pi-mono) coding agent with Claude Code's slash commands built in: subagents, a task list, permission rules, hooks, code review and more. They are implemented natively on pi's extension API, so pika does not need Claude Code installed and works with any provider pi supports.

pika is a fork of pi, currently based on pi 1.5.0. It keeps pi's terminal UI, providers, sessions, extensions, skills, and SDK.

## Install

pika requires Node.js 22.19 or newer. Download the tarball from the [latest release](https://github.com/agentiker/pi-claude/releases) and install it with npm:

```bash
gh release download pika-v0.0.1 -R agentiker/pi-claude -p 'pika-*.tgz'
npm install -g --ignore-scripts ./pika-0.0.1.tgz
```

This repository is private, so the download needs a GitHub login with access to it.

## Get started

Start pika in the directory where you want it to work:

```bash
cd /path/to/project
pika
```

Run `/login` to connect a provider, or configure one in `~/.pika/agent/models.json` ([format](packages/coding-agent/docs/models.md)). Then give pika a task. `/help` lists every command, and `/doctor` checks your setup.

To run a single prompt and exit:

```bash
pika -p "Summarize this repository" </dev/null
```

`-p` reads stdin until it closes, so piped input can be part of the prompt. When a script or another program runs pika, add `</dev/null` as above, or pika waits for as long as stdin stays open.

pika keeps its settings, credentials, and sessions in `~/.pika/agent`, and project files in `.pika/`. An installed pi uses `~/.pi` and is not affected. The docs in this repository still use pi's names, so read `pi` as `pika` and `.pi` as `.pika` there. Set `PIKA_CODING_AGENT_DIR` to use a different config directory.

## Commands added to pi

See [slash commands](packages/coding-agent/docs/slash-commands.md) for arguments and details.

| Purpose | Commands |
|---|---|
| Inspect the session | `/help`, `/status`, `/context`, `/doctor`, `/skills`, `/usage` |
| Hand a task to the agent | `/init`, `/review`, `/security-review`, `/simplify`, `/pr-comments` |
| Organize work | `/todos`, `/agents`, `/loop`, `/btw`, `/memory`, `/add-dir` |
| Configure | `/permissions`, `/hooks`, `/output-style`, `/theme`, `/keybindings`, `/vim`, `/statusline`, `/terminal-setup`, `/plugin` |

Output from the inspection commands and `/btw` stays out of the model's context.

Claude Code's names also work for commands pi already has:

| Claude Code name | Runs |
|---|---|
| `/clear` | `/new` |
| `/exit` | `/quit` |
| `/config` | `/settings` |
| `/effort` | `/thinking` |
| `/rename` | `/name` |
| `/cost` | `/session` |
| `/release-notes` | `/changelog` |
| `/rewind` | `/tree` (conversation only; files are not restored) |

Agent files use Claude Code's format, and hook files use the format of its `hooks` setting. Hook matchers and the JSON a hook receives use pi's tool names and fields, so scripts that read Claude Code's fields need adjusting.

## Permissions

By default pika runs every tool call without asking, like pi. `/permissions` adds allow, ask, and deny rules:

```text
/permissions deny read(.env)
/permissions allow bash(npm test:*)
/permissions mode ask
```

Rules guard against mistakes; they are not a security boundary. They match tool arguments and command text, so an allowed program can still do anything it is able to. Project rules and hooks load only after you trust the project with `/trust`. For real isolation, run pika in a container or sandbox ([options](packages/coding-agent/docs/containerization.md)).

## Known limitations

- `/help`, `/status`, and the other report commands print nothing in `-p` mode. Use them interactively.
- `/upgrade` and `pika update --self` do not update pika. Install a newer release instead.
- Help text and docs still say pi in places.

## Development

```bash
git clone git@github.com:agentiker/pi-claude.git
cd pi-claude
npm install --ignore-scripts
npm run hydrate:model-data   # download model data (needs network)
npm run build:offline        # build all packages
npm run check                # lint, format, and type check
./test.sh                    # run tests that need no API keys
./pi-test.sh                 # run from source, from any directory
```

Running from source uses pi's names: the `pi` config directory `~/.pi/agent` unless `PI_CODING_AGENT_DIR` is set, and `.pi/` in projects.

Most of pika's code is in [`packages/coding-agent/src/extensions/claude-commands/`](packages/coding-agent/src/extensions/claude-commands), with few changes to pi's core, so that upstream updates merge cleanly. See [AGENTS.md](AGENTS.md) for the repository's code and testing rules.

To build a release tarball in `.artifacts/pika/`:

```bash
node scripts/release-pika.mjs --version 0.0.2
```

To merge upstream pi:

```bash
git remote add upstream https://github.com/badlogic/pi-mono   # first time only
git fetch upstream
git merge upstream/main
```

Upstream's version tags, such as `v0.0.1`, are separate from pika's, so pika's releases are tagged `pika-v<version>`.

## License

MIT, the same as pi. See [LICENSE](LICENSE). pi is created by Mario Zechner and contributors.
