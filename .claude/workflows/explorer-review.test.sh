#!/usr/bin/env bash
# Case matrix for explorer-review.js: runs the real workflow script under node with stub agent, pipeline, parallel and log,
# where the review lens reports three findings and their refuters answer nothing, refuted, and upheld; then a run where
# the secrets lens returns nothing.
WORKFLOW="${1:-$(cd "$(dirname "$0")" && pwd)/explorer-review.js}"
command -v node >/dev/null || { echo "FAIL node is needed to run explorer-review.js"; exit 1; }
WORKFLOW="$WORKFLOW" node --input-type=module <<'JS'
import { readFileSync } from 'node:fs'
const source = readFileSync(process.env.WORKFLOW, 'utf8').replace(/^export const meta/m, 'const meta')
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const run = new AsyncFunction('args', 'agent', 'pipeline', 'parallel', 'log', source)
const finding = (file, line) => ({ file, line, severity: 'P1', cites: 'Rule A', why: 'why', fix: 'fix' })
const findings = [finding('silent.cs', 1), finding('refuted.cs', 2), finding('upheld.cs', 3)]
const verdicts = {
  'refute:silent.cs:1': null,
  'refute:refuted.cs:2': { refuted: true, reason: 'not backed by the cited page' },
  'refute:upheld.cs:3': { refuted: false, reason: 'the cited line breaks the rule' },
}
const agent = async (_prompt, { label }) =>
  label.startsWith('review:') ? { findings, checked: ['Rule A'], uncited: [] } : verdicts[label]
const pipeline = (items, review, refute) => Promise.all(items.map(async item => refute(await review(item), item)))
const parallel = thunks => Promise.all(thunks.map(thunk => thunk()))
let fail = 0
let out
try {
  out = await run({ module: 'ServiceBusExplorer.Core', lenses: [] }, agent, pipeline, parallel, () => {})
} catch (error) {
  console.log(`FAIL the workflow threw: ${error.message}`)
  process.exit(1)
}
const files = list => (list || []).map(f => f.file).join(',')
const expect = (name, got, want) => {
  if (got !== want) { console.log(`FAIL ${name}: got '${got}', want '${want}'`); fail = 1 }
}
expect('a finding whose refuter returned nothing comes back unresolved', files(out.unresolved), 'silent.cs')
expect('a finding whose refuter returned nothing is never counted as refuted', files(out.refuted), 'refuted.cs')
expect('confirmed holds only the finding its refuter upheld', files(out.confirmed), 'upheld.cs')
expect('a refuted finding keeps the refuter reason', (out.refuted || [])[0]?.reason, 'not backed by the cited page')
expect('every lens returned, so none is unresolved', (out.unresolvedLenses || []).join(','), '')
const silentLens = async (prompt, options) => (options.label === 'review:secrets' ? null : agent(prompt, options))
let partial
try {
  partial = await run({ module: 'ServiceBusExplorer.Core', lenses: ['secrets'] }, silentLens, pipeline, parallel, () => {})
} catch (error) {
  console.log(`FAIL the workflow threw when a lens returned nothing: ${error.message}`)
  process.exit(1)
}
expect('a lens whose review returned nothing comes back in unresolvedLenses', (partial.unresolvedLenses || []).join(','), 'secrets')
expect('a lens whose review returned nothing is not listed as run', (partial.lensesRun || []).join(','), 'invariants')
const models = {}
const recording = async (prompt, options) => {
  if (options.label.startsWith('review:')) models[options.label] = options.model
  return agent(prompt, options)
}
try {
  await run({ module: 'ServiceBusExplorer.Core', lenses: ['api-surface', 'secrets', 'message-safety', 'boundaries'] }, recording, pipeline, parallel, () => {})
} catch (error) {
  console.log(`FAIL the workflow threw when every lens ran: ${error.message}`)
  process.exit(1)
}
expect('the api-surface lens, which judges who can reach the API, is reviewed on opus', models['review:api-surface'], 'opus')
expect('the message-safety lens, which judges message loss, is reviewed on opus', models['review:message-safety'], 'opus')
expect('the secrets lens is reviewed on opus', models['review:secrets'], 'opus')
expect('the invariants lens is reviewed on sonnet', models['review:invariants'], 'sonnet')
expect('the boundaries lens is reviewed on sonnet', models['review:boundaries'], 'sonnet')
if (!fail) console.log('ALL CASES PASS')
process.exit(fail)
JS
