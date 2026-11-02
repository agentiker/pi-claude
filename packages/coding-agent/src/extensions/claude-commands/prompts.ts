/**
 * Prompts behind the Claude Code style commands that hand a task to the agent (/init, /review, ...).
 * Each builder takes the command arguments and returns the full instruction sent as the turn's user content.
 */

/** /init: write or improve the project context file that future sessions load. */
export function buildInitPrompt(args: string): string {
	return `Analyze this codebase and write a project context file that future agent sessions will load automatically.

Where to write it:
- Pi loads one context file per directory, the first that exists of AGENTS.override.md, AGENTS.md, CLAUDE.md.
- If one of those already exists in the project root, improve that file instead of creating another one.
- Otherwise create AGENTS.md in the project root.

What to include:
1. Commands used to build, lint, type check and test, including how to run a single test.
2. High-level architecture: the big-picture structure that takes reading several files to understand.
3. Project-specific rules from existing sources: README, CONTRIBUTING, .cursorrules, .cursor/rules/, .github/copilot-instructions.md.

What to leave out:
- Generic advice (write tests, handle errors, keep secrets out of code).
- File listings that a directory listing already shows.
- Anything you did not verify in the repository. Do not invent commands or conventions.

Keep it concise and start the file with a one-line description of the project.${formatExtra(args)}`;
}

/** /review: review a pull request, a branch, or the local changes. */
export function buildReviewPrompt(args: string): string {
	const target = args.trim();
	const scope = target
		? `Review target: ${target}. It may be a pull request number or URL (use \`gh pr view\` and \`gh pr diff\`), a branch or commit range (use \`git diff\`), or a path.`
		: "No target was given. Review the uncommitted changes plus the commits on the current branch that are not on the default branch. If there are none, run `gh pr list` and ask which pull request to review.";
	return `Act as an expert code reviewer.

${scope}

Steps:
1. Collect the diff and read the surrounding code of every changed hunk; do not judge a hunk in isolation.
2. Look for correctness bugs, broken edge cases, races, resource leaks, security problems, missing error handling at trust boundaries, and behavior changes the author likely did not intend.
3. Check that tests cover the changed behavior.
4. Verify each finding against the code before reporting it. Drop anything you cannot back with a concrete failure scenario.

Report:
- Findings ordered by severity. For each: file:line, what is wrong, a concrete input or state that triggers it, and a suggested fix.
- Then at most a few short notes on simplification or readability, only where they matter.
- Skip style nits a formatter or linter would catch. If you find nothing significant, say so plainly.

Do not modify any files.`;
}

/** /security-review: security-focused review of the pending changes. */
export function buildSecurityReviewPrompt(args: string): string {
	return `Perform a security review of the pending changes on the current branch: uncommitted changes plus commits not on the default branch.

Steps:
1. Collect the diff with git and read enough surrounding code to understand how data flows into and out of each change.
2. Identify the trust boundaries the changes touch: user input, network input, files, environment, subprocesses, databases, authentication and authorization checks.
3. Look for exploitable vulnerabilities introduced by these changes, for example: injection (SQL, command, path, template), authentication or authorization bypass, insecure deserialization, secrets committed to code or logs, unsafe cryptography, SSRF, XSS, path traversal, and unsafe handling of untrusted archives or URLs.
4. For each candidate, trace a concrete attack: who controls the input, how it reaches the sink, what the attacker gains.

Report only high-confidence findings. Exclude denial of service, rate limiting, missing hardening without an exploit path, and issues outside the changed code.

For each finding: severity, file:line, the attack scenario, and a fix. If there are no high-confidence findings, say so.

Do not modify any files.${formatExtra(args)}`;
}

/** /simplify: clean up the changed code without changing behavior. */
export function buildSimplifyPrompt(args: string): string {
	return `Review the code changed on the current branch (uncommitted changes plus commits not on the default branch) for quality, then apply the improvements.

Look for:
- Reuse: new code that duplicates an existing helper or pattern in the codebase.
- Simplification: needless indirection, dead code, overly defensive checks, logic that can be expressed more directly.
- Efficiency: repeated work, needless copies or allocations on hot paths.
- Consistency: naming, comments and idioms that differ from the surrounding code.

Rules:
- Do not change behavior. This is not a bug hunt.
- Keep each change small and explain it in one line.
- After editing, run the project's lint, type check and relevant tests, and fix what you broke.${formatExtra(args)}`;
}

/** /pr-comments: fetch and summarize review comments on a pull request. */
export function buildPrCommentsPrompt(args: string): string {
	const target = args.trim() || "the pull request of the current branch (find it with `gh pr view --json number,url`)";
	return `Show the review comments on ${target}.

Steps:
1. Use the GitHub CLI: \`gh pr view <number> --json number,title,url,author\`, \`gh api repos/{owner}/{repo}/pulls/<number>/comments\` for inline comments, and \`gh api repos/{owner}/{repo}/issues/<number>/comments\` for conversation comments.
2. For each inline comment, show the author, file:line, the diff hunk it refers to, and the comment text. Keep reply threads together.
3. Summarize what each reviewer asks for, and mark which requests look already addressed by the current code.

Do not modify any files and do not post anything to GitHub.`;
}

function formatExtra(args: string): string {
	const extra = args.trim();
	return extra ? `\n\nAdditional instructions from the user:\n${extra}` : "";
}
