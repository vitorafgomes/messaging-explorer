export const meta = {
  name: 'explorer-review',
  description: 'Pipeline gate 6: review the working-tree diff with explorer-reviewer, one lens per agent, then try to refute every finding before it is reported; a finding whose refuter returned nothing comes back unresolved, never refuted, and a lens whose review returned nothing comes back in unresolvedLenses',
  whenToUse: 'After gates 4-5 are green. args: { module: "ServiceBusExplorer.Core", lenses: ["invariants","message-safety"], dispatch: "<reviewer dispatch template, filled>", range?: "HEAD" }',
  phases: [
    { title: 'Review', detail: 'one explorer-reviewer per lens; opus on api-surface, secrets and message-safety; sonnet on invariants and boundaries' },
    { title: 'Refute', detail: 'an independent reviewer tries to refute each finding' },
  ],
}

const module = (args && args.module) || '<unnamed module>'
const dispatch = (args && args.dispatch) || ''
const range = (args && args.range) || 'HEAD'

// `invariants` always runs; the gate 6 table adds the others. `performance` is explorer-optimizer's,
// never a lens here.
const requested = ((args && args.lenses) || []).filter(l => l !== 'performance' && l !== 'invariants')
const LENSES = ['invariants', ...new Set(requested)]
const OPUS_LENSES = new Set(['api-surface', 'secrets', 'message-safety'])

const FINDINGS = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          line: { type: 'integer' },
          severity: { type: 'string', enum: ['P1', 'P2'] },
          cites: { type: 'string', description: 'the vault page, ADR or root Rule letter the finding violates' },
          why: { type: 'string' },
          fix: { type: 'string' },
        },
        required: ['file', 'line', 'severity', 'cites', 'why', 'fix'],
      },
    },
    checked: { type: 'array', items: { type: 'string' }, description: 'pages, ADRs and Rules checked and clean' },
    uncited: { type: 'array', items: { type: 'string' }, description: 'non-blocking observations, max 3' },
  },
  required: ['findings', 'checked', 'uncited'],
}

const VERDICT = {
  type: 'object',
  properties: {
    refuted: { type: 'boolean' },
    reason: { type: 'string' },
  },
  required: ['refuted', 'reason'],
}

function reviewPrompt(lens) {
  const scope = lens === 'invariants'
    ? 'Lens: invariants. This lens also owns regression coverage (the map and the gate 5 evidence), Rules I and J, and the generic correctness lens.'
    : `Lens: ${lens}. Check only this lens; another agent covers invariants and regression coverage.`
  return `Review the working-tree diff (\`git diff ${range}\` + \`git status --porcelain\`, read untracked files) for module: ${module}.
${scope}

Dispatch from the manager (map, gate 5 evidence, skill results):
${dispatch}

Follow your procedure. Return findings ONLY where you verified the cited line in the actual code and a vault page, ADR or root Rule backs it. At most five findings, most severe first. An empty findings list on a sound diff is correct.`
}

function refutePrompt(f, lens) {
  return `An independent review (lens: ${lens}) of the working-tree diff for module ${module} reported this finding:

  ${f.file}:${f.line} | ${f.severity} | violates ${f.cites}
  why: ${f.why}
  fix: ${f.fix}

Try to REFUTE it. Open the file at the cited line, read the vault page, ADR or Rule it cites, and decide whether the code as written actually violates it in a way that changes correctness, opens the API beyond loopback and the API key, leaks a secret, loses or silently duplicates a message, lets a vendor type out of its provider, or leaves a requirement unproven. Default to refuted=true if the violation is stylistic, speculative, already handled elsewhere in the diff, or not backed by the cited page. Read-only.`
}

const results = await pipeline(
  LENSES,
  lens => agent(reviewPrompt(lens), {
    label: `review:${lens}`,
    phase: 'Review',
    agentType: 'explorer-reviewer',
    schema: FINDINGS,
    model: OPUS_LENSES.has(lens) ? 'opus' : 'sonnet',
    effort: 'high',
  }),
  (review, lens) => {
    if (!review) return null
    return parallel(review.findings.map(f => () =>
      agent(refutePrompt(f, lens), {
        label: `refute:${f.file.split(/[\\/]/).pop()}:${f.line}`,
        phase: 'Refute',
        agentType: 'explorer-reviewer',
        schema: VERDICT,
        model: 'sonnet',
        effort: 'high',
      }).then(v => ({ ...f, lens, verdict: v }))
    )).then(verified => ({ lens, checked: review.checked, uncited: review.uncited, verified: verified.filter(Boolean) }))
  },
)

const lensResults = results.filter(r => r && Array.isArray(r.verified))
const returned = new Set(lensResults.map(r => r.lens))
const unresolvedLenses = LENSES.filter(lens => !returned.has(lens))
const all = lensResults.flatMap(r => r.verified)
const confirmed = all.filter(f => f.verdict && f.verdict.refuted === false)
const refuted = all.filter(f => f.verdict && f.verdict.refuted === true)
const unresolved = all.filter(f => !f.verdict || typeof f.verdict.refuted !== 'boolean')

log(`${confirmed.length} confirmed, ${refuted.length} refuted, ${unresolved.length} unresolved (refuter returned nothing), ${unresolvedLenses.length} lens(es) failed to return${unresolvedLenses.length ? `: ${unresolvedLenses.join(', ')}` : ''}`)

return {
  module,
  lensesRun: lensResults.map(r => r.lens),
  confirmed: confirmed.map(({ verdict, ...f }) => f),
  refuted: refuted.map(f => ({ file: f.file, line: f.line, cites: f.cites, reason: f.verdict.reason })),
  unresolved: unresolved.map(({ verdict, ...f }) => f),
  unresolvedLenses,
  checked: [...new Set(lensResults.flatMap(r => r.checked))],
  uncited: lensResults.flatMap(r => r.uncited).slice(0, 3),
}
