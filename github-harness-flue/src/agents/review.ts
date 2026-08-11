'use agent';

// `flue run` loads only this module and its imports — never app.ts — so the
// Sentry + OTel instrumentation must be registered from here.
import '../sentry.ts';

import { readFile, writeFile } from 'node:fs/promises';
import { useMcpConnection, useModel, useSubagent, useTool } from '@flue/runtime';
import * as v from 'valibot';

// Delegate agents stay unexported: every exported capitalized function in a
// 'use agent' module would register as a top-level agent in the Vite build.
function CorrectnessReviewer() {
	return (
		'You review a unified diff for correctness. The full diff arrives in your task message. ' +
		'Report only real defects: logic errors, off-by-one mistakes, dropped error handling, ' +
		'unhandled edge cases, and unintended behavior changes. For each finding give the file, ' +
		'the relevant added line, and why it is wrong. Reply with a Markdown bullet list, or ' +
		'"No correctness issues found." when the diff is clean.'
	);
}

function StyleReviewer() {
	return (
		'You review a unified diff for style and maintainability. The full diff arrives in your ' +
		'task message. Flag naming problems, outdated constructs, dead code, inconsistent ' +
		'formatting, and missing clarity — never correctness bugs. For each finding give the file, ' +
		'the relevant added line, and a concrete suggestion. Reply with a Markdown bullet list, or ' +
		'"No style issues found." when the diff is clean.'
	);
}

export function ReviewLead() {
	useModel('openrouter/x-ai/grok-4.5', { thinkingLevel: 'low' });

	const sentryOrg = process.env.SENTRY_ORG_SLUG;
	const sentryAppProject = process.env.SENTRY_APP_PROJECT_SLUG;
	const sentryIssuesEnabled = Boolean(
		process.env.SENTRY_ACCESS_TOKEN && sentryOrg && sentryAppProject,
	);

	// Subagent renders cannot mount MCP connections, so the lead owns the
	// Sentry tools and runs the issue-impact step itself.
	if (sentryIssuesEnabled) {
		useMcpConnection({
			name: 'sentry',
			url: 'https://mcp.sentry.dev/mcp',
			// The hosted Sentry MCP accepts API tokens via the nonstandard
			// `Sentry-Bearer` scheme; the standard `auth` field would send
			// `Bearer` and trigger the OAuth flow instead.
			headers: { authorization: `Sentry-Bearer ${process.env.SENTRY_ACCESS_TOKEN}` },
			// Allowlist must match what the DEPLOYED server exposes (probe with
			// createMcpConnection when in doubt) — an unknown name rejects the
			// whole connection, and `optional` then degrades it to zero tools.
			tools: ['search_issues', 'get_sentry_resource', 'update_issue'],
			optional: true,
		});
	}

	useSubagent({
		name: 'correctness-reviewer',
		description: 'Reviews a unified diff for logic errors, edge cases, and behavioral regressions.',
		agent: CorrectnessReviewer,
		model: 'openrouter/anthropic/claude-haiku-4.5',
	});

	useSubagent({
		name: 'style-reviewer',
		description: 'Reviews a unified diff for naming, clarity, dead code, and consistency.',
		agent: StyleReviewer,
		model: 'openrouter/anthropic/claude-haiku-4.5',
	});

	useTool({
		name: 'read_diff',
		description: 'Read a unified diff from a file path relative to the working directory.',
		input: v.object({ path: v.string() }),
		async run({ data, log }) {
			const diff = await readFile(data.path, 'utf8');
			log.info('diff loaded', { path: data.path, bytes: diff.length });
			return diff;
		},
	});

	useTool({
		name: 'post_review',
		description: 'Publish the finished review. Call exactly once with the complete Markdown review.',
		input: v.object({ review: v.string() }),
		async run({ data, log }) {
			if (process.env.POST_TO_GITHUB === 'true') {
				const { GITHUB_REPOSITORY, PR_NUMBER, GITHUB_TOKEN } = process.env;
				const response = await fetch(
					`https://api.github.com/repos/${GITHUB_REPOSITORY}/issues/${PR_NUMBER}/comments`,
					{
						method: 'POST',
						headers: {
							authorization: `Bearer ${GITHUB_TOKEN}`,
							accept: 'application/vnd.github+json',
						},
						body: JSON.stringify({ body: data.review }),
					},
				);
				if (!response.ok) {
					throw new Error(`GitHub comment failed: ${response.status} ${await response.text()}`);
				}
				log.info('review posted to GitHub', {
					repository: GITHUB_REPOSITORY ?? '',
					pr: PR_NUMBER ?? '',
				});
				return `Review posted as a comment on ${GITHUB_REPOSITORY}#${PR_NUMBER}.`;
			}
			await writeFile('review.md', data.review);
			log.info('review written to disk', { path: 'review.md', bytes: data.review.length });
			return 'Review written to review.md (demo mode — set POST_TO_GITHUB=true to comment on the PR).';
		},
	});

	const prRef =
		process.env.GITHUB_REPOSITORY && process.env.PR_NUMBER
			? `${process.env.GITHUB_REPOSITORY}#${process.env.PR_NUMBER}`
			: 'a local demo run';
	const prDescription = [process.env.PR_TITLE, process.env.PR_BODY]
		.filter(Boolean)
		.join('\n\n');

	const sentryStep = sentryIssuesEnabled
		? `3. Sentry impact check. The application this repository ships reports errors to Sentry
   project "${sentryAppProject}" in org "${sentryOrg}". Determine whether this diff fixes any
   currently open issue there:
   - If the PR description below already references a Sentry issue ID (a short code like
     ABC-123), verify that exact issue with mcp__sentry__get_sentry_resource.
   - Otherwise, find unresolved issues with mcp__sentry__search_issues (for example:
     "unresolved issues in ${sentryAppProject}") and inspect plausible matches with
     mcp__sentry__get_sentry_resource.
   - Compare each issue's stack trace and filenames against the diff. Claim a fix only when
     the changed lines directly address the failing frames — never on topic similarity alone.
   - For every issue this diff genuinely fixes, resolve it with mcp__sentry__update_issue
     (status resolved), noting in your review that ${prRef} fixes it. Never resolve an
     issue the diff does not clearly fix.
   - If the Sentry tools are unavailable this run, skip this step and say so in the review.
4.`
		: '3.';

	return `You are the lead reviewer of a pull request. Work through these steps in order:

1. Load the diff with the read_diff tool, using the file path given in the user message.
2. Delegate two review passes: one task to correctness-reviewer, one task to style-reviewer.
   Issue both tasks in a single batch so they run in parallel, and include the complete diff
   text in each task message — subagents cannot see this conversation.
${sentryStep} Synthesize everything into one review: a one-line verdict, findings ordered by
   severity (correctness before style), then a "Sentry impact" section listing each open
   issue this diff fixes (ID, title, and what you did about it) — or stating that no open
   Sentry issues are affected.${sentryIssuesEnabled ? '' : ' Note that the Sentry check was not configured for this run.'}
${sentryIssuesEnabled ? '5.' : '4.'} Publish the review with the post_review tool, exactly once.

${prDescription ? `PR description:\n---\n${prDescription}\n---\n\n` : ''}Finish by replying with the verdict line only.`;
}
