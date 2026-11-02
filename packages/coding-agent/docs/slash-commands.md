# Slash commands

Type `/` in Pi's terminal editor to search the commands available in the current session. This page lists the built-in commands in the current Pi release.

Extensions, prompt templates, and skills can add commands. The command menu in Pi is therefore the exact reference for the resources loaded in your session.

## Models and settings

| Command | Description |
|---|---|
| `/settings` | Open settings |
| `/model [provider/model]` | Select a model |
| `/thinking [level]` | Set the thinking level |
| `/scoped-models` | Configure the models used by interactive cycling |
| `/login [provider]` | Add provider authentication |
| `/logout` | Remove provider authentication |
| `/llama` | Manage models on the configured llama.cpp router |

## Sessions and context

| Command | Description |
|---|---|
| `/new` | Start a new session |
| `/resume` | Resume another session |
| `/name [name]` | Set the session display name, or show the current name when omitted |
| `/session` | Show current session information and statistics |
| `/tree` | Navigate the session tree |
| `/fork` | Create a new session from an earlier user message |
| `/clone` | Duplicate the current session at its current position |
| `/compact [instructions]` | Compact the current context, optionally with custom instructions |
| `/import <path>` | Import a JSONL session, preserving its ID and working directory |

## Export and share

| Command | Description |
|---|---|
| `/copy` | Copy the last assistant message |
| `/export [path]` | Export the session as HTML or JSONL |
| `/share` | Upload the session and return a viewer link |
| `/bug [description]` | Prepare a private bug report for the Pi developers |

Review a session before exporting or sharing it. Sessions can contain prompts, tool arguments, command output, file contents, and credentials exposed during the conversation.

## Runtime and project

| Command | Description |
|---|---|
| `/trust` | Save a project trust decision for future Pi processes |
| `/mcp` | Manage MCP servers: sign in, reconnect, enable or disable, and change exposure |
| `/reload` | Reload keybindings, extensions, skills, templates, themes, and context files |
| `/hotkeys` | Show active keyboard shortcuts |
| `/changelog` | Show changelog entries |
| `/quit` | Quit Pi |

## Claude Code commands

The built-in `claude-commands` extension adds the commands of Claude Code that fit Pi's model.

Inspect the session. The output is shown in the transcript and never sent to the model:

| Command | Description |
|---|---|
| `/help` | List built-in commands with their aliases, extension commands, prompt templates, and skills |
| `/status` | Show version, working directory, session, model, context usage, and loaded resources |
| `/context` | Show context window usage, with an estimated split into system prompt, context files, skills, tool definitions, and messages |
| `/doctor` | Check Node.js, model and credentials, git, `rg`, `fd`, and project trust |
| `/skills` | List loaded skills |
| `/btw <question>` | Ask a side question about the conversation; the answer is not added to the context |
| `/memory [note]` | Edit the project or user context file; with a note, append it to the project context file |

Hand a task to the agent. The transcript shows the command; expand it to see the full prompt:

| Command | Description |
|---|---|
| `/init [instructions]` | Write or improve the project's `AGENTS.md` (or the existing `CLAUDE.md`) from the codebase |
| `/review [pr\|branch\|path]` | Review a pull request, a branch, or the local changes |
| `/security-review` | Security review of the pending changes on the current branch |
| `/simplify [focus]` | Clean up the changed code without changing behavior |
| `/pr-comments [pr]` | Show the review comments on a GitHub pull request |

Workflow and configuration:

| Command | Description |
|---|---|
| `/todos` | Show the task list the model keeps with its `todo_write` tool; open tasks also show above the editor |
| `/loop [interval] <prompt>` | Run a prompt or command every interval (default `10m`, minimum `10s`) while the session is open; `/loop` lists loops, `/loop stop [id\|all]` stops them. A run that comes due while the agent works waits until it is idle |
| `/add-dir [path]` | Add a working directory; the model is told about it and its `AGENTS.md`/`CLAUDE.md` is loaded. Without a path, list them; `--remove <path>` removes one |
| `/output-style [name]` | Choose how answers are written: `default`, `explanatory`, `learning`, or a custom style from `output-styles/*.md` in the agent dir or `.pi/` |
| `/permissions` | Show or change rules that allow, ask about, or deny tool calls (see below) |
| `/hooks` | Show shell-command hooks; `/hooks edit [user\|project]` edits them (see below) |
| `/theme [name]` | Change the color theme |
| `/keybindings` | Edit `keybindings.json` and reload it |
| `/agents` | List subagents; `/agents create <name> [--user]` and `/agents edit <name>` change them (see below) |
| `/plugin [list\|install\|remove\|update] [source]` | Manage Pi packages by running `pi install`, `pi remove`, `pi update` and `pi list`, then reload |
| `/upgrade` | Update Pi itself (`pi update --self`) |
| `/vim` | Toggle vim-style modal editing in the prompt editor; the choice is remembered |
| `/statusline [command\|off]` | Show the first output line of a shell command in the footer. The command receives the session state as JSON on stdin |
| `/terminal-setup` | Detect the terminal, point to its setup notes, and inside tmux offer to enable extended keys for `Shift+Enter` |
| `/usage` | Tokens and estimated cost across all local sessions, for today, the last 7 days and all time, per model |

### Subagents

The `agent` tool lets the model hand a self-contained task to a separate Pi process with its own context window; only the final answer comes back. Use it for broad searches and research that would fill the main context, or for independent tasks the model can run in parallel.

Agent definitions are Markdown files in `agents/` in the agent dir or `.pi/agents/` (trusted projects only), in the same format as Claude Code agents:

```markdown
---
name: code-reviewer
description: Reviews a diff for bugs. Use after making changes.
tools: read, grep, find, ls
model: anthropic/claude-sonnet-4-5
---
You are a careful code reviewer. Report findings with file:line.
```

`tools` and `model` are optional; by default a subagent has the normal tools and the main agent's model and thinking level. The built-in `general-purpose` agent is always available. Subagents cannot start subagents of their own, and they load the same settings, hooks and permission rules; with no user to ask, rules that ask block the call instead.

### Permissions

Rules live in `permissions.json` in the agent dir (all projects) and in `.pi/permissions.json` (trusted projects only):

```json
{ "defaultMode": "ask", "allow": ["bash(npm test:*)", "edit(src/**)"], "ask": ["bash(git push:*)"], "deny": ["read(.env)"] }
```

- A rule is `tool` or `tool(pattern)`. Tool names are case-insensitive, and an `edit` rule also covers `write`.
- For `bash`, the pattern matches the command with `*` wildcards; a trailing `:*` means the command with any arguments. Chained commands (`&&`, `||`, `;`, `|`) are checked part by part: an allow rule must cover every part, and a deny or ask rule applies if it matches any part. Commands with `$(...)` or backticks are only allowed by a plain `bash` rule.
- For file tools, the pattern is a glob over the path, relative to the working directory.
- `deny` beats `ask` beats `allow`. Calls no rule matches follow `defaultMode`: `allow` (the default, Pi's normal behavior) or `ask`, which asks before every tool except read-only ones.
- When asked, you can allow once, for the rest of the session, or always for the project.

Change rules with `/permissions allow|ask|deny <rule>`, `/permissions remove <rule>`, and `/permissions mode allow|ask`. These edit the project file; add `--user` to edit the file in the agent dir.

### Hooks

Hooks run shell commands on agent events. They live in `hooks.json` in the agent dir and in `.pi/hooks.json` (trusted projects only), in the format of the `hooks` object of Claude Code settings:

```json
{ "hooks": { "PostToolUse": [{ "matcher": "edit|write", "hooks": [{ "type": "command", "command": "npm run lint", "timeout": 60 }] }] } }
```

- **Events:** `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `Stop`, `SessionStart`, `SessionEnd`, `PreCompact`.
- **Matcher:** a case-insensitive regular expression over Pi's tool name (`bash`, `read`, `edit`, `write`, ...).
- **Input:** each command receives the event as JSON on stdin and runs in the working directory, with `PI_PROJECT_DIR` set.
- **Exit code 2** blocks, with stderr as the reason:
  - `PreToolUse` blocks the tool call.
  - `PostToolUse` sends the reason to the model.
  - `Stop` makes the agent continue with the reason, at most 5 times in a row.
  - `UserPromptSubmit` drops the prompt.
- **Exit code 0:** stdout may be JSON with `"decision": "block"` and a `"reason"`. Plain stdout from `UserPromptSubmit` and `SessionStart` is added to the context.
- **Other exit codes** are shown as warnings.

Claude Code names for built-in commands are aliases:

| Alias | Command |
|---|---|
| `/clear` | `/new` |
| `/exit` | `/quit` |
| `/config` | `/settings` |
| `/effort [level]` | `/thinking [level]` |
| `/rename [name]` | `/name [name]` |
| `/cost` | `/session` |
| `/rewind` | `/tree` (rewinds the conversation only; files are not restored) |
| `/release-notes` | `/changelog` |

## Commands added by resources

- Extensions can register commands with their own arguments and completion behavior.
- Each prompt template is available under its template name.
- Skills are available as `/skill:name` when skill commands are enabled.

Use `/reload` after adding or changing a discovered command resource. See [Extensions](extensions.md), [Prompt Templates](prompt-templates.md), and [Skills](skills.md) for their loading and naming rules.
