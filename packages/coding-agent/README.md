# pika

pika is the [pi](https://github.com/badlogic/pi-mono) coding agent with Claude Code's slash commands built in: subagents, a task list, permission rules, hooks, code review and more. They are implemented natively on pi's extension API, so pika does not need Claude Code installed and works with any provider pi supports.

## Install

pika requires Node.js 22.19 or newer. Download the tarball from the [latest release](https://github.com/agentiker/pi-claude/releases) and install it with npm:

```bash
npm install -g --ignore-scripts ./pika-<version>.tgz
```

To update pika, install a newer release. `/upgrade` and `pika update --self` do not update it.

## Get started

Start pika in the directory where you want it to work:

```bash
cd /path/to/project
pika
```

Run `/login` to connect a provider, or configure one in `~/.pika/agent/models.json` ([format](docs/models.md)). Then give pika a task. `/help` lists every command, and `/doctor` checks your setup.

To run a single prompt and exit, use `pika -p "<prompt>"`. `-p` reads stdin until it closes, so when a script or another program runs pika, add `</dev/null`, or pika waits for as long as stdin stays open.

pika keeps its settings, credentials, and sessions in `~/.pika/agent`, and project files in `.pika/`. Set `PIKA_CODING_AGENT_DIR` to use a different config directory. The docs below come from pi and use its names, so read `pi` as `pika` and `.pi` as `.pika`.

## Documentation

- [Documentation index](docs/index.md)
- [Slash commands](docs/slash-commands.md), including the commands pika adds, permissions, hooks, and subagents
- [Usage](docs/usage.md) and [CLI](docs/cli.md)
- [Providers](docs/providers.md) and [models](docs/models.md)
- [Extensions](docs/extensions.md), [skills](docs/skills.md), [prompt templates](docs/prompt-templates.md), [themes](docs/themes.md), and [packages](docs/packages.md)
- [RPC](docs/rpc.md) and [SDK](docs/sdk.md)

## Development

See the [repository README](https://github.com/agentiker/pi-claude#development).

## License

MIT, the same as pi. pi is created by Mario Zechner and contributors.
