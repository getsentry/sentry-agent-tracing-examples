// flue-blueprint: tooling/sentry@1
//
// The whole Sentry setup for this harness — the agent code makes no Sentry
// calls. README.md > "The Sentry bridge" says what each part is for.

import {
	type ContentOption,
	createOpenTelemetryInstrumentation,
	type GenAIContentType,
	truncateContent,
} from '@flue/opentelemetry';
import { type FlueObservation, instrument } from '@flue/runtime';
import * as Sentry from '@sentry/node';
import * as v from 'valibot';

type OperationEvent = Extract<FlueObservation, { type: 'operation' }>;
type RecoveryEvent = Extract<FlueObservation, { type: 'submission_recovery' }>;
type LogEvent = Extract<FlueObservation, { type: 'log' }>;
type SettlementEvent = Extract<FlueObservation, { type: 'submission_settled' }>;

// Flue's classified failure detail. `@flue/runtime` does not export the type,
// so it is read off the observation contract that owns it. `type` is the
// discriminator (for example `delegation_depth_exceeded`); `name` is the JS
// class name and is optional.
type FlueErrorInfo = NonNullable<OperationEvent['errorInfo']>;

// Issue and log tag keys, spelled exactly as `@flue/opentelemetry` spells the
// matching span attributes (`identifiers()` in its dist bundle), so one search
// term pivots across a run's spans, logs, and issues. `gen_ai.conversation.id`
// is the root conversation — the same value `beforeSendSpan` writes onto every
// span of the run — so an issue links back to Explore > Conversations.
type CorrelationTags = {
	'flue.instance.id'?: string;
	'flue.agent.name'?: string;
	'gen_ai.conversation.id'?: string;
	'flue.conversation.id'?: string;
	'flue.submission.id'?: string;
	'flue.harness.name'?: string;
	'flue.session.name'?: string;
	'flue.parent_session.name'?: string;
	'flue.operation.id'?: string;
	'flue.task.id'?: string;
};

type IncidentContext = {
	durationMs: number;
	operationKind: OperationEvent['operationKind'];
};

type LogAttribute = string | number | boolean;

type FlueLogAttributes = CorrelationTags & { [key: `flue.log.${string}`]: LogAttribute };

type RecoveryLogAttributes = CorrelationTags & {
	'flue.recovery.operation'?: RecoveryEvent['operation'];
	'flue.recovery.outcome'?: RecoveryEvent['outcome'];
	'flue.recovery.attempt_count'?: number;
	'flue.recovery.max_attempts'?: number;
	'error.type'?: string;
};

// Same spellings the other two demos accept, so one documented value turns a
// direction off in every app. Declared here rather than beside envFlag because
// the flags below are read while this module initialises.
const DISABLED_FLAG_VALUES = new Set(['false', '0', 'no', 'off']);

// One pair of switches for two consumers that never see each other's config:
// the SDK's own `dataCollection.genAI` policy below, and flue's OTel adapter,
// which reads no Sentry option and is told the same values in contentPolicy().
// On unless explicitly disabled — this demo exists to show prompts and
// responses in Sentry's AI views.
const recordInputs = envFlag('SENTRY_AI_RECORD_INPUTS', true);
const recordOutputs = envFlag('SENTRY_AI_RECORD_OUTPUTS', true);
const DEFAULT_TRACES_SAMPLE_RATE = 1;
const tracesSampleRate = resolveSampleRate(process.env.SENTRY_TRACES_SAMPLE_RATE);

// Sentry ships integrations that patch AI provider SDKs directly. Flue's
// instrumentation already emits one `chat` span per model turn, so those
// integrations would double-count every model call.
const SENTRY_AI_PROVIDER_INTEGRATIONS = new Set([
	'Anthropic_AI',
	'OpenAI',
	'Google_GenAI',
	'LangChain',
	'LangGraph',
	'VercelAI',
	'WorkersAI',
]);

// One `flue run` is one submission, but a delegation opens a *child*
// conversation with its own id, and the adapter emits that child id as
// `gen_ai.conversation.id`. Sentry's Conversations view groups strictly by
// that attribute, so one review splits into three rows — lead, correctness
// reviewer, style reviewer. Flue records the parent link durably
// (`ensureChildConversation`) but never puts it on the span, so rebuild it
// here: the first conversation observed for a submission is its root.
const rootConversationBySubmission = new Map<string, string>();

// Child conversation id → the subagent that owns it. The envelope's
// `agentName` is the top-level agent, so a subagent's `chat` span arrives
// labelled with the lead's name; only `task_start` knows the real one.
const subagentByConversation = new Map<string, string>();

// Submission id → the failures already raised as issues for it, keyed by
// failure rather than by submission. A submission runs many nested operations
// (a lead prompt, a task per subagent, a prompt inside each subagent), so one
// terminal error surfaces as several `operation` failures as it unwinds, and a
// failure the agent recovers from must not silence a later, unrelated one.
// Matching on the failure collapses the unwind into one issue and leaves an
// unrelated settlement free to raise its own. The `operation` event is the
// preferred source because its live `errorInfo` carries the throw-site stack,
// which the durable settlement record never does; the settlement also collapses
// non-Flue causes to a generic payload, so its fingerprint can miss even for the
// same failure — the run then raises a second issue rather than losing the
// terminal one.
const capturedFailuresBySubmission = new Map<string, Set<string>>();

// `beforeSendSpan` reads the correlation maps when a span *ends*, which can be
// after the submission that filled them has settled, so entries age out instead
// of being deleted on settlement.
const MAX_CORRELATION_ENTRIES = 256;

const UNCLASSIFIED_FAILURE: FlueErrorInfo = { type: 'flue_failure_without_error_info' };

const SENSITIVE_KEY = /api[-_]?key|authorization|cookie|dsn|password|secret|token/i;

// Span attributes arrive untyped; the correlation rewrite below branches on
// these two, so they are parsed once at that boundary.
const spanCorrelationSchema = v.object({
	'gen_ai.conversation.id': v.optional(v.string()),
	'flue.submission.id': v.optional(v.string()),
});

// Redaction runs inside `JSON.stringify` rather than over a hand-walked tree:
// the replacer sees every key, and valibot turns the `TypeError` a circular
// structure throws into a parse issue. Two consequences accepted on purpose — a
// circular payload is dropped whole instead of being marked in place, and there
// is no depth cap, so `truncateContent`'s byte budget is the only size limit.
const redactedJsonSchema = v.pipe(
	v.unknown(),
	v.stringifyJson({
		replacer: (key: string, value) => {
			if (SENSITIVE_KEY.test(key)) return '[redacted]';
			return value instanceof Error ? { name: value.name, message: value.message } : value;
		},
	}),
);

// Same redaction, parsed back so the payload keeps its shape. Shape matters:
// the adapter routes an object-shaped tool payload to `gen_ai.tool.call.*` and
// anything else to the vendor fallback key.
const redactedContentSchema = v.pipe(redactedJsonSchema, v.parseJson());

const logAttributeSchema = v.union([v.string(), v.number(), v.boolean()]);

// A thrown primitive carries its whole payload in its text.
const thrownPrimitiveSchema = v.pipe(
	v.union([v.string(), v.number(), v.boolean()]),
	v.transform((value) => String(value)),
);

const failureInfoSchema = v.object({
	type: v.optional(v.string()),
	name: v.optional(v.string()),
	code: v.optional(v.string()),
	message: v.optional(v.string()),
	stack: v.optional(v.string()),
});

Sentry.init({
	dsn: process.env.SENTRY_DSN,
	enabled: Boolean(process.env.SENTRY_DSN),
	environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
	release: process.env.SENTRY_RELEASE,
	tracesSampleRate,
	// Only the categories to switch off; the rest stay on. Inbound request
	// bodies also need httpIntegration's maxIncomingRequestBodySize.
	// https://docs.sentry.io/platforms/javascript/guides/node/configuration/options/#dataCollection
	// https://docs.sentry.io/platforms/javascript/guides/node/configuration/integrations/http/#maxincomingrequestbodysize
	dataCollection: {
		genAI: { inputs: recordInputs, outputs: recordOutputs },
		httpHeaders: { request: false, response: false },
		httpBodies: [],
		cookies: false,
		urlQueryParams: false,
		graphQL: { document: false, variables: false },
		stackFrameVariables: false,
	},
	// Only streamed spans reach the ingest pipeline that derives `gen_ai.*` ops
	// from span attributes.
	// https://docs.sentry.io/platforms/javascript/guides/node/configuration/options/#tracelifecycle
	traceLifecycle: 'stream',
	// The adapter parks non-object tool payloads on vendor `flue.tool.call.*`
	// attributes, which Sentry's AI views don't read (withastro/flue#568).
	//
	// withStreamedSpan is required — a bare callback silently downgrades
	// traceLifecycle to 'static'.
	beforeSendSpan: Sentry.withStreamedSpan((span) => {
		const attributes = span.attributes;
		if (attributes) {
			for (const kind of ['arguments', 'result'] as const) {
				const raw = attributes[`flue.tool.call.${kind}`];
				if (raw !== undefined) {
					if (attributes[`gen_ai.tool.call.${kind}`] === undefined) {
						attributes[`gen_ai.tool.call.${kind}`] = raw;
					}
					delete attributes[`flue.tool.call.${kind}`];
				}
			}

			const correlation = v.safeParse(spanCorrelationSchema, attributes);
			const ownConversation = correlation.success
				? correlation.output['gen_ai.conversation.id']
				: undefined;
			if (ownConversation !== undefined) {
				const subagent = subagentByConversation.get(ownConversation);
				if (subagent !== undefined) attributes['gen_ai.agent.name'] = subagent;

				const submissionId = correlation.success
					? correlation.output['flue.submission.id']
					: undefined;
				const root =
					submissionId === undefined
						? undefined
						: rootConversationBySubmission.get(submissionId);
				if (root !== undefined && root !== ownConversation) {
					// Keep the child id — it is flue's real conversation record.
					attributes['flue.conversation.id'] = ownConversation;
					attributes['gen_ai.conversation.id'] = root;
				}
			}
		}
		return span;
	}),
	enableLogs: true,
	integrations: (defaults) =>
		defaults.filter((integration) => !SENTRY_AI_PROVIDER_INTEGRATIONS.has(integration.name)),
});

// Explore > Conversations takes its User column from the span's scope. In CI
// the actor is the GitHub identity that triggered the run; every local run
// shows as 'local'.
const actor = process.env.GITHUB_ACTOR ?? 'local';
Sentry.setUser({ id: actor, username: actor });

// Registered before the OpenTelemetry adapter so it is disposed *after* it.
// The runtime disposes owners in reverse registration order, and the adapter's
// dispose is synchronous — it ends every still-open span as `interrupted`
// before this bridge's flush is even called. The other order flushes first and
// strands those spans in the client's buffer on an abort, interrupt, or crash.
instrument({
	key: Symbol.for('flue.sentry.bridge'),
	observe(event) {
		// Runs before the branches below so the maps are populated while the
		// spans they describe are still open; `beforeSendSpan` reads them when
		// each span ends.
		if (event.submissionId && event.conversationId) {
			if (!rootConversationBySubmission.has(event.submissionId)) {
				rememberCorrelation(rootConversationBySubmission, event.submissionId, event.conversationId);
			}
			if (event.type === 'task_start' && event.agent) {
				rememberCorrelation(subagentByConversation, event.conversationId, event.agent);
			}
		}
		if (event.type === 'operation' && event.isError) {
			const failure = event.errorInfo ?? parseFailure(event.error) ?? UNCLASSIFIED_FAILURE;
			const fingerprint = failureFingerprint(failure);
			if (event.submissionId !== undefined) {
				if (capturedFailuresBySubmission.get(event.submissionId)?.has(fingerprint)) return;
				rememberCapturedFailure(event.submissionId, fingerprint);
			}
			captureTerminalFailure(failure, correlationTags(event), {
				durationMs: event.durationMs,
				operationKind: event.operationKind,
			});
			return;
		}
		if (event.type === 'submission_settled') {
			const captured = capturedFailuresBySubmission.get(event.submissionId);
			capturedFailuresBySubmission.delete(event.submissionId);
			if (event.outcome === 'failed') {
				const failure = event.errorInfo ?? settledFailure(event.error) ?? UNCLASSIFIED_FAILURE;
				if (captured?.has(failureFingerprint(failure)) !== true) {
					captureTerminalFailure(failure, correlationTags(event));
				}
			}
			return;
		}
		if (event.type === 'submission_recovery') {
			recordRecoveryLog(event);
			return;
		}
		if (event.type === 'log') {
			Sentry.logger[event.level](event.message, logAttributes(event));
		}
	},
	interceptor: (_operation, _ctx, next) => next(),
	async dispose() {
		await Sentry.flush(2000);
	},
});

// `Sentry.init` registered Sentry as the global OTel tracer provider, so
// Flue's spans flow to Sentry without further wiring. Only that tracer seam is
// wired: @sentry/node registers no global OTel *meter* provider, so the
// adapter's `gen_ai.client.token.usage` and `*.duration` instruments are API
// no-ops and their metrics are dropped — token usage still reaches Sentry as
// span attributes. The `logger` seam below is wired, so the adapter's
// `gen_ai.client.operation.exception` records (a model call that failed and was
// retried) land in Sentry Logs. Content capture is on by default in the
// adapter; `contentPolicy()` narrows it per direction and redacts.
if (tracesSampleRate > 0) {
	instrument(
		createOpenTelemetryInstrumentation({
			content: contentPolicy(),
			logger: {
				emit: (record) => {
					// The adapter emits its own `flue.submission_recovery` record for
					// every recovery event. `recordRecoveryLog` already reports those
					// with the full correlation tags, the attempt counts, and an error
					// level for 'terminated', so the adapter's copy is a strict subset.
					if (record.eventName === 'flue.submission_recovery') return;
					// OTel severity numbers: the ERROR band starts at 17, WARN at 13.
					const severity = record.severityNumber ?? 0;
					const level = severity >= 17 ? 'error' : severity >= 13 ? 'warn' : 'info';
					Sentry.logger[level](record.eventName, record.attributes);
				},
			},
		}),
	);
}

// A coordinator retrying or reconciling a stuck submission — not yet a
// terminal outcome, and 'deferred'/'agent_unavailable' recur on every retry
// wake, so each wake records a leveled log rather than an issue. The one
// terminal outcome, 'terminated', always co-occurs with a `submission_settled`
// outcome:'failed' event that the branch above already captures; the log
// complements that issue without duplicating it.
function recordRecoveryLog(event: RecoveryEvent): void {
	const level = event.outcome === 'terminated' ? 'error' : 'warn';
	const attributes: RecoveryLogAttributes = correlationTags(event);
	attributes['flue.recovery.operation'] = event.operation;
	attributes['flue.recovery.outcome'] = event.outcome;
	if (event.attemptCount !== undefined) {
		attributes['flue.recovery.attempt_count'] = event.attemptCount;
	}
	if (event.maxAttempts !== undefined) {
		attributes['flue.recovery.max_attempts'] = event.maxAttempts;
	}
	if (event.errorInfo) attributes['error.type'] = event.errorInfo.type;
	Sentry.logger[level](`Submission recovery — ${event.operation}: ${event.outcome}`, attributes);
}

function captureTerminalFailure(
	failure: Error | FlueErrorInfo,
	tags: CorrelationTags,
	context?: IncidentContext,
): void {
	Sentry.withScope((scope) => {
		scope.setTags(tags);
		scope.setLevel('error');
		scope.setTag('error.type', failureType(failure));
		if (context) scope.setContext('flue.incident', context);
		Sentry.captureException(toError(failure));
	});
}

function correlationTags(event: FlueObservation): CorrelationTags {
	const tags: CorrelationTags = {};
	if (event.instanceId) tags['flue.instance.id'] = event.instanceId;
	if (event.agentName) tags['flue.agent.name'] = event.agentName;
	if (event.conversationId) tags['flue.conversation.id'] = event.conversationId;
	const root = event.submissionId ? rootConversationBySubmission.get(event.submissionId) : undefined;
	const conversation = root ?? event.conversationId;
	if (conversation) tags['gen_ai.conversation.id'] = conversation;
	if (event.submissionId) tags['flue.submission.id'] = event.submissionId;
	if (event.harness) tags['flue.harness.name'] = event.harness;
	if (event.session) tags['flue.session.name'] = event.session;
	if (event.parentSession) tags['flue.parent_session.name'] = event.parentSession;
	if (event.operationId) tags['flue.operation.id'] = event.operationId;
	if (event.taskId) tags['flue.task.id'] = event.taskId;
	return tags;
}

function logAttributes(event: LogEvent): FlueLogAttributes {
	const attributes: FlueLogAttributes = correlationTags(event);
	for (const [key, value] of Object.entries(event.attributes ?? {})) {
		const primitive = v.safeParse(logAttributeSchema, value);
		if (primitive.success) {
			attributes[`flue.log.${key}`] = primitive.output;
			continue;
		}
		const serialized = v.safeParse(redactedJsonSchema, value);
		attributes[`flue.log.${key}`] = serialized.success ? serialized.output : String(value);
	}
	return attributes;
}

function rememberCorrelation<TValue>(map: Map<string, TValue>, key: string, value: TValue): void {
	if (!map.has(key) && map.size >= MAX_CORRELATION_ENTRIES) {
		const oldest = map.keys().next();
		if (!oldest.done) map.delete(oldest.value);
	}
	map.set(key, value);
}

function rememberCapturedFailure(submissionId: string, fingerprint: string): void {
	const captured = capturedFailuresBySubmission.get(submissionId) ?? new Set<string>();
	captured.add(fingerprint);
	rememberCorrelation(capturedFailuresBySubmission, submissionId, captured);
}

// The adapter's own switch, kept in step with `dataCollection.genAI`: a
// direction disabled there must not reach a span from here either. The 16 KiB
// cap tightens the adapter's own 56 KiB per-attribute budget.
function contentPolicy(): ContentOption {
	if (!recordInputs && !recordOutputs) return false;
	return {
		transform(content, scope) {
			if (isInputContent(scope.contentType) && !recordInputs) return undefined;
			if (isOutputContent(scope.contentType) && !recordOutputs) return undefined;
			const redacted = v.safeParse(redactedContentSchema, content);
			if (!redacted.success) return undefined;
			return truncateContent(redacted.output, { maxBytes: 16_384 });
		},
	};
}

function isInputContent(contentType: GenAIContentType): boolean {
	return (
		contentType === 'input_messages' ||
		contentType === 'system_instructions' ||
		contentType === 'tool_definitions' ||
		contentType === 'tool_description' ||
		contentType === 'tool_arguments'
	);
}

function isOutputContent(contentType: GenAIContentType): boolean {
	return (
		contentType === 'output_messages' ||
		contentType === 'tool_result' ||
		contentType === 'exception_message' ||
		contentType === 'exception_stacktrace'
	);
}

// The boundary for `operation` failures: flue types `event.error` as unknown
// because it is whatever the operation threw. Parse it here into the classified
// shape the rest of this file branches on.
function parseFailure(cause: unknown): Error | FlueErrorInfo | undefined {
	if (cause instanceof Error) return cause;
	const primitive = v.safeParse(thrownPrimitiveSchema, cause);
	if (primitive.success) return { type: UNCLASSIFIED_FAILURE.type, message: primitive.output };
	const parsed = v.safeParse(failureInfoSchema, cause);
	if (!parsed.success) return undefined;
	return { ...parsed.output, type: parsed.output.type ?? UNCLASSIFIED_FAILURE.type };
}

// The settlement's durable error is already a domain value; it only lacks the
// required discriminator, which is optional on the durable serializer.
function settledFailure(error: SettlementEvent['error']): FlueErrorInfo | undefined {
	if (error === undefined) return undefined;
	return { ...error, type: error.type ?? UNCLASSIFIED_FAILURE.type };
}

// Flue's semantic classifier, not the JS class name: `name` is optional on
// `FlueErrorInfo`, `type` is not, and `type` is what distinguishes (say) a
// `delegation_depth_exceeded` from any other `Error`.
function failureType(failure: Error | FlueErrorInfo): string {
	return failure instanceof Error ? failure.name : failure.type;
}

// Groups the issues raised for one submission. Nested operations re-report the
// same failure as it unwinds; identical type and message means one issue.
function failureFingerprint(failure: Error | FlueErrorInfo): string {
	return `${failureType(failure)}: ${failure.message ?? ''}`;
}

function toError(failure: Error | FlueErrorInfo): Error {
	if (failure instanceof Error) return failure;
	const error = new Error(failure.message ?? failure.type);
	error.name = failure.name ?? failure.type;
	if (failure.stack !== undefined) error.stack = failure.stack;
	return error;
}

function envFlag(name: string, fallback: boolean): boolean {
	const value = process.env[name];
	if (value === undefined || value.trim() === '') return fallback;
	return !DISABLED_FLAG_VALUES.has(value.trim().toLowerCase());
}

function resolveSampleRate(value: string | undefined): number {
	if (value === undefined) return DEFAULT_TRACES_SAMPLE_RATE;
	const parsed = Number(value);
	if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) return parsed;
	console.warn(
		`SENTRY_TRACES_SAMPLE_RATE="${value}" is not a rate between 0 and 1; using ${DEFAULT_TRACES_SAMPLE_RATE}.`,
	);
	return DEFAULT_TRACES_SAMPLE_RATE;
}
