#!/usr/bin/env bash
# Case matrix for explorer-review.js: runs the real workflow script under node with stub agent, pipeline, parallel and log,
# where the review lens reports three findings and their refuters answer nothing, refuted, and upheld; then a run where
# the api-surface lens returns nothing; then the refute prompt carries the reviewed tree from the dispatch, and a refuter that
# cannot locate a finding leaves it unresolved.
WORKFLOW="${1:-$(cd "$(dirname "$0")" && pwd)/explorer-review.js}"
command -v node >/dev/null || { echo "FAIL node is needed to run explorer-review.js"; exit 1; }
WORKFLOW="$WORKFLOW" node --input-type=module <<'JS'
import { readFileSync } from 'node:fs'
const source = readFileSync(process.env.WORKFLOW, 'utf8').replace(/^export const meta/m, 'const meta')
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const run = new AsyncFunction('args', 'agent', 'pipeline', 'parallel', 'log', source)
const finding = (file, line) => ({ file, line, severity: 'P1', cites: 'Rule A', why: 'why', fix: 'fix' })
const findings = [finding('silent.cs', 1), finding('refuted.cs', 2), finding('upheld.cs', 3), finding('elsewhere.cs', 4)]
const verdicts = {
  'refute:silent.cs:1': null,
  'refute:refuted.cs:2': { refuted: true, located: true, reason: 'not backed by the cited page' },
  'refute:upheld.cs:3': { refuted: false, located: true, reason: 'the cited line breaks the rule' },
  'refute:elsewhere.cs:4': { refuted: true, located: false, reason: 'the cited line does not hold what the finding quotes' },
}
const agent = async (_prompt, { label }) =>
  label.startsWith('review:') ? { findings, checked: ['Rule A'], uncited: [] } : verdicts[label]
const pipeline = (items, review, refute) => Promise.all(items.map(async item => refute(await review(item), item)))
const parallel = thunks => Promise.all(thunks.map(thunk => thunk()))
let fail = 0
let out
try {
  out = await run({ module: 'ServiceBusExplorer.X', lenses: [] }, agent, pipeline, parallel, () => {})
} catch (error) {
  console.log(`FAIL the workflow threw: ${error.message}`)
  process.exit(1)
}
const files = list => (list || []).map(f => f.file).join(',')
const expect = (name, got, want) => {
  if (got !== want) { console.log(`FAIL ${name}: got '${got}', want '${want}'`); fail = 1 }
}
expect('a finding whose refuter returned nothing, or could not locate it, comes back unresolved', files(out.unresolved), 'silent.cs,elsewhere.cs')
expect('a finding whose refuter returned nothing is never counted as refuted', files(out.refuted), 'refuted.cs')
expect('confirmed holds only the finding its refuter upheld', files(out.confirmed), 'upheld.cs')
expect('a refuted finding keeps the refuter reason', (out.refuted || [])[0]?.reason, 'not backed by the cited page')
expect('every lens returned, so none is unresolved', (out.unresolvedLenses || []).join(','), '')
const silentLens = async (prompt, options) => (options.label === 'review:api-surface' ? null : agent(prompt, options))
let partial
try {
  partial = await run({ module: 'ServiceBusExplorer.X', lenses: ['api-surface'] }, silentLens, pipeline, parallel, () => {})
} catch (error) {
  console.log(`FAIL the workflow threw when a lens returned nothing: ${error.message}`)
  process.exit(1)
}
expect('a lens whose review returned nothing comes back in unresolvedLenses', (partial.unresolvedLenses || []).join(','), 'api-surface')
expect('a lens whose review returned nothing is not listed as run', (partial.lensesRun || []).join(','), 'invariants')
const models = {}
const recording = async (prompt, options) => {
  if (options.label.startsWith('review:')) models[options.label] = options.model
  return agent(prompt, options)
}
try {
  await run({ module: 'ServiceBusExplorer.X', lenses: ['api-surface', 'secrets', 'message-safety', 'boundaries'] }, recording, pipeline, parallel, () => {})
} catch (error) {
  console.log(`FAIL the workflow threw when every lens ran: ${error.message}`)
  process.exit(1)
}
expect('the api-surface lens is reviewed on opus', models['review:api-surface'], 'opus')
expect('the secrets lens is reviewed on opus', models['review:secrets'], 'opus')
expect('the message-safety lens is reviewed on opus', models['review:message-safety'], 'opus')
expect('the invariants lens is reviewed on sonnet', models['review:invariants'], 'sonnet')
expect('the boundaries lens is reviewed on sonnet', models['review:boundaries'], 'sonnet')
const prompts = {}
const capturing = async (prompt, options) => {
  prompts[options.label] = prompt
  return agent(prompt, options)
}
const location = 'Project: ServiceBusExplorer.X   Diff: working tree of /work/trees/feature-x'
const dispatch = `${location}\nLenses: invariants\nMap: the reviewer's framing`
try {
  await run({ module: 'ServiceBusExplorer.X', lenses: [], dispatch }, capturing, pipeline, parallel, () => {})
} catch (error) {
  console.log(`FAIL the workflow threw when the prompts were captured: ${error.message}`)
  process.exit(1)
}
const refute = prompts['refute:upheld.cs:3'] || ''
expect('the refute prompt names the tree the reviewer reviewed', refute.includes(location), true)
expect('the refute prompt says to read the cited file in that tree, not the session directory', refute.includes("never in the session's working directory"), true)
expect('the refute prompt does not carry the rest of the dispatch', refute.includes("the reviewer's framing"), false)
expect('the refute prompt opens in the refute mode the reviewer agent defines', refute.startsWith('Refute one finding.'), true)
expect('the refute prompt checks the page of decisions that look like defects', refute.includes('decisions-that-look-like-defects'), true)
expect('the review prompt leaves the lens procedure to the reviewer agent', (prompts['review:invariants'] || '').includes('general correctness'), false)
expect('the review prompt asks for paths relative to the reviewed tree root', (prompts['review:invariants'] || '').includes("relative to the reviewed tree's root"), true)
expect('an unresolved finding keeps the reason its refuter gave', (out.unresolved || []).find(f => f.file === 'elsewhere.cs')?.reason, 'the cited line does not hold what the finding quotes')
const refuteFor = async runArgs => {
  const seen = {}
  await run(runArgs, async (prompt, options) => { seen[options.label] = prompt; return agent(prompt, options) }, pipeline, parallel, () => {})
  return seen['refute:upheld.cs:3'] || ''
}
let ranged, lowercase, unshaped, longLine
try {
  ranged = await refuteFor({ module: 'ServiceBusExplorer.X', lenses: [], range: 'abc123..def456', dispatch: 'Project: ServiceBusExplorer.X   Diff: the range below\nLenses: invariants' })
  lowercase = await refuteFor({ module: 'ServiceBusExplorer.X', lenses: [], dispatch: `${location}\n  lenses: invariants\nMap: the reviewer's framing` })
  unshaped = await refuteFor({ module: 'ServiceBusExplorer.X', lenses: [], dispatch: `${location}\nline two\nline three\nMap: the reviewer's framing\nProof: the proofs` })
  longLine = await refuteFor({ module: 'ServiceBusExplorer.X', lenses: [], dispatch: 'x'.repeat(1000) })
} catch (error) {
  console.log(`FAIL the workflow threw when the refute prompts were built: ${error.message}`)
  process.exit(1)
}
expect('with a range other than HEAD the refute prompt names the range', ranged.includes('abc123..def456'), true)
expect('a Lenses line in any case and indentation ends the reviewed-tree lines', lowercase.includes("the reviewer's framing"), false)
expect('a dispatch with no blank or Lenses line gives the refuter at most its first three lines', unshaped.includes("the reviewer's framing"), false)
expect('the first lines still reach the refuter when the dispatch has another shape', unshaped.includes('line three'), true)
expect('the refuter gets at most 600 characters of the dispatch', longLine.includes('x'.repeat(601)), false)
if (!fail) console.log('ALL CASES PASS')
process.exit(fail)
JS
