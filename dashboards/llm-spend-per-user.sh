#!/usr/bin/env bash
# Builds an "LLM Spend per User" dashboard, plus two spend alerts, from the
# gen_ai spans any of these demos send. Nothing here is demo-specific: the
# widgets read the standard AI agent attributes, so the script works against any
# Sentry project that sends them.
#
#   ./dashboards/llm-spend-per-user.sh <org-slug> <project-slug>
#
# Needs the Sentry CLI (https://docs.sentry.io/cli/) and `sentry login`.
#
# Optional, to say who hears the alerts. Without them the detectors still open
# issues, but tell nobody:
#   WORKFLOW_ID=<id>       an existing workflow (Alerts > Automations)
#   OWNER=user:<id>        or team:<id>
#
# gen_ai.cost.total_tokens is US dollars, despite the name. Sentry derives it
# server-side from the token counts and the model price list, so the SDK never
# sends a cost.

set -euo pipefail

ORG="${1:-}"
PROJECT="${2:-}"
if [ -z "$ORG" ] || [ -z "$PROJECT" ]; then
  echo "usage: $0 <org-slug> <project-slug>" >&2
  exit 2
fi
TITLE="${TITLE:-LLM Spend per User}"

# One turn writes cost twice: on the model call, and again on the invoke_agent
# span above it. This filter keeps the model calls only. Sentry's own prebuilt
# AI dashboards use the same one on every cost and token widget.
AI="gen_ai.operation.type:ai_client"

# `has:` also matches an attribute that is present but empty, which puts a blank
# row in every group-by. The pair excludes it.
present() { echo "has:$1 !$1:\"\""; }

STATIC_DETECTOR="LLM spend rate high"
ANOMALY_DETECTOR="LLM spend anomaly"

# A detector is created under its project, but listed and deleted under the
# organisation, which selects projects by numeric id rather than by slug.
PROJECT_ID=$(sentry api "/api/0/projects/$ORG/$PROJECT/" |
  python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')
DETECTORS="/api/0/organizations/$ORG/detectors/"

# Every call below creates rather than updates, so a second run would leave a
# duplicate dashboard and a second pair of detectors alerting on the same spend.
named() {
  NEEDLE="$1" python3 -c '
import json, os, sys
key = sys.argv[1]
body = json.load(sys.stdin)
rows = body if isinstance(body, list) else body.get("data", [])
print("\n".join(str(r["id"]) for r in rows if r.get(key) == os.environ["NEEDLE"]))
' "$2"
}

clashes=$(sentry api "/api/0/organizations/$ORG/dashboards/" | named "$TITLE" title)
for name in "$STATIC_DETECTOR" "$ANOMALY_DETECTOR"; do
  clashes="$clashes$(sentry api "$DETECTORS?project=$PROJECT_ID" | named "$name" name)"
done
if [ -n "$clashes" ]; then
  echo "$ORG/$PROJECT already has these; delete them or set TITLE= and rename the detectors:" >&2
  echo "  dashboard \"$TITLE\", detectors \"$STATIC_DETECTOR\" / \"$ANOMALY_DETECTOR\"" >&2
  exit 1
fi

# Widgets and detectors are separate calls, so a failure part way through would
# otherwise leave a half-built dashboard behind.
CREATED=()
rollback() {
  echo "==> failed; removing what this run created" >&2
  for ((i = ${#CREATED[@]} - 1; i >= 0; i--)); do
    sentry api "${CREATED[i]}" --method DELETE >/dev/null 2>&1 ||
      echo "    could not delete ${CREATED[i]}" >&2
  done
}
trap rollback ERR

echo "==> creating dashboard on $ORG/$PROJECT"
DASHBOARD_ID=$(sentry dashboard create "$ORG/$PROJECT" "$TITLE" --json |
  python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')
CREATED+=("/api/0/organizations/$ORG/dashboards/$DASHBOARD_ID/")
echo "    id $DASHBOARD_ID"

echo "==> adding widgets"
sentry dashboard widget add "$DASHBOARD_ID" "Total LLM Spend" \
  --display big_number -q sum:gen_ai.cost.total_tokens -w "$AI"

sentry dashboard widget add "$DASHBOARD_ID" "Total Tokens" \
  --display big_number -q sum:gen_ai.usage.total_tokens -w "$AI"

sentry dashboard widget add "$DASHBOARD_ID" "Active AI Users" \
  --display big_number -q count_unique:user.id -w "$AI"

sentry dashboard widget add "$DASHBOARD_ID" "Spend Over Time by User" \
  --display area -q sum:gen_ai.cost.total_tokens -w "$AI $(present user.id)" \
  -g user.id --sort=-sum:gen_ai.cost.total_tokens

sentry dashboard widget add "$DASHBOARD_ID" "Spend Over Time by Model" \
  --display area -q sum:gen_ai.cost.total_tokens -w "$AI $(present gen_ai.response.model)" \
  -g gen_ai.response.model --sort=-sum:gen_ai.cost.total_tokens

sentry dashboard widget add "$DASHBOARD_ID" "Top Spenders" \
  --display table -q sum:gen_ai.cost.total_tokens -q sum:gen_ai.usage.total_tokens -q count \
  -w "$AI $(present user.id) $(present user.username)" \
  -g user.id -g user.username --sort=-sum:gen_ai.cost.total_tokens

sentry dashboard widget add "$DASHBOARD_ID" "Cost by Model" \
  --display table -q sum:gen_ai.cost.total_tokens -q sum:gen_ai.usage.total_tokens \
  -q count_unique:user.id -q count \
  -w "$AI $(present gen_ai.response.model)" \
  -g gen_ai.response.model --sort=-sum:gen_ai.cost.total_tokens

sentry dashboard widget add "$DASHBOARD_ID" "Most Expensive Conversations" \
  --display table -q sum:gen_ai.cost.total_tokens -q sum:gen_ai.usage.total_tokens -q count \
  -w "$AI $(present gen_ai.conversation.id) $(present user.username)" \
  -g gen_ai.conversation.id -g user.username --sort=-sum:gen_ai.cost.total_tokens

echo "==> https://$ORG.sentry.io/dashboard/$DASHBOARD_ID/"

routing=$(WORKFLOW_ID="${WORKFLOW_ID:-}" OWNER="${OWNER:-}" python3 -c '
import json, os
out = {}
if os.environ["WORKFLOW_ID"]: out["workflowIds"] = [os.environ["WORKFLOW_ID"]]
if os.environ["OWNER"]: out["owner"] = os.environ["OWNER"]
print("," + json.dumps(out)[1:-1] if out else "")
')

# Alerts on spans go through the detector API. `sentry alert metrics create`
# still builds the older alert-rule payload, which newer orgs reject.
# conditionResult is the issue priority: 75 critical, 50 warning, 0 resolved.
echo "==> creating static spend detector"
DETECTOR_ID=$(sentry api "/api/0/organizations/$ORG/projects/$PROJECT/detectors/" --method POST --data '{
  "name": "'"$STATIC_DETECTOR"'",
  "type": "metric_issue",
  "dataSources": [{
    "type": "snuba_query_subscription",
    "dataset": "events_analytics_platform",
    "eventTypes": ["trace_item_span"],
    "query": "'"$AI"'",
    "aggregate": "sum(gen_ai.cost.total_tokens)",
    "timeWindow": 3600,
    "environment": null
  }],
  "conditionGroup": {
    "logicType": "any",
    "conditions": [
      {"type": "gt", "comparison": 1.5, "conditionResult": 75},
      {"type": "gt", "comparison": 0.75, "conditionResult": 50},
      {"type": "lte", "comparison": 0.75, "conditionResult": 0}
    ]
  },
  "config": {"detectionType": "static"}'"$routing"'
}' | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')
CREATED+=("$DETECTORS$DETECTOR_ID/")
echo "    id $DETECTOR_ID  $STATIC_DETECTOR"

# Same query, no thresholds: Sentry learns the normal shape of the hour and
# opens an issue when spend leaves it.
echo "==> creating anomaly spend detector"
DETECTOR_ID=$(sentry api "/api/0/organizations/$ORG/projects/$PROJECT/detectors/" --method POST --data '{
  "name": "'"$ANOMALY_DETECTOR"'",
  "type": "metric_issue",
  "dataSources": [{
    "type": "snuba_query_subscription",
    "dataset": "events_analytics_platform",
    "eventTypes": ["trace_item_span"],
    "query": "'"$AI"'",
    "aggregate": "sum(gen_ai.cost.total_tokens)",
    "timeWindow": 3600,
    "environment": null
  }],
  "conditionGroup": {
    "logicType": "any",
    "conditions": [
      {"type": "anomaly_detection", "comparison": {"sensitivity": "medium", "seasonality": "auto", "thresholdType": 0}, "conditionResult": 75}
    ]
  },
  "config": {"detectionType": "dynamic"}'"$routing"'
}' | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')
CREATED+=("$DETECTORS$DETECTOR_ID/")
echo "    id $DETECTOR_ID  $ANOMALY_DETECTOR"

trap - ERR
