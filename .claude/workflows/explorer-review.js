export const meta = {
  name: 'explorer-review',
  description: 'Review the diff with explorer-reviewer, one lens per agent, then try to refute every finding before it is reported; a finding whose refuter returned nothing or could not locate it in the reviewed tree comes back unresolved, never refuted, and a lens whose review returned nothing comes back in unresolvedLenses',
  whenToUse: 'After the checks and the proof are green. args: { module: "ServiceBusExplorer.Core", lenses: ["invariants","api-surface"], dispatch: "<reviewer dispatch template, filled>", range?: "HEAD" }',
  phases: [
    { title: 'Review', detail: 'one explorer-reviewer per lens; opus on api-surface and secrets and message-safety, sonnet on the others' },
    { title: 'Refute', detail: 'an independent reviewer tries to refute each finding' },
  ],
}

const module = (args && args.module) || '<unnamed module>'
const dispatch = (args && args.dispatch) || ''
const range = (args && args.range) || 'HEAD'
const dispatchLines = dispatch.trimStart().split('\n')
const locationEnd = dispatchLines.findIndex(line => line.trim() === '' || /^\s*lenses:/i.test(line))
const reviewedTree = (locationEnd < 0 ? dispatchLines : dispatchLines.slice(0, locationEnd)).slice(0, 3).join('\n').trim().slice(0, 600)

// `invariants` always runs; the pipeline's table of sensitive changes adds the others.
// `performance` is explorer-optimizer's, never a lens here.
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
          cites: { type: 'string', description: 'the context page, decision or rule the finding breaks' },
          why: { type: 'string' },
          fix: { type: 'string' },
        },
        required: ['file', 'line', 'severity', 'cites', 'why', 'fix'],
      },
    },
    checked: { type: 'array', items: { type: 'string' }, description: 'pages, decisions and rules checked and clean' },
    uncited: { type: 'array', items: { type: 'string' }, description: 'non-blocking observations, max 3' },
  },
  required: ['findings', 'checked', 'uncited'],
}

const VERDICT = {
  type: 'object',
  properties: {
    located: { type: 'boolean', description: 'true only when the cited file, read in the reviewed tree, holds at the cited line what the finding describes' },
    refuted: { type: 'boolean' },
    reason: { type: 'string' },
  },
  required: ['located', 'refuted', 'reason'],
}

function reviewPrompt(lens) {
  const scope = lens === 'invariants'
    ? 'Lens: invariants. It also checks the proof of each requirement (in proportion to the risk, per ADR 0005: a mutation for a row under the API, provider, secret, message-safety or external-call rules or a new guard, a failing spec first for other new behaviour, the behaviour lock for a visual refactor), the test and comment rules, and general correctness.'
    : `Lens: ${lens}. Check only this lens; another agent covers the invariants and the proof.`
  return `Review the working-tree diff (\`git diff ${range}\` + \`git status --porcelain\`, read untracked files) for module: ${module}.
${scope}

The session's dispatch (the requirement table, the proof recorded for each row, the test-quality results):
${dispatch}

Give each finding's file as its path relative to the reviewed tree's root, the way \`git diff\` prints it. Follow your procedure. Read the project's rules file under \`.claude/rules/\` for each changed file. Return findings ONLY where you verified the cited line in the actual code and a context page, a decision or a rule in AGENTS.md backs it. At most five findings, most severe first. An empty findings list on a sound diff is correct.`
}

function refutePrompt(f, lens) {
  return `An independent review (lens: ${lens}) of the working-tree diff for module ${module} reported this finding.

The reviewed tree, from the session's dispatch:
${reviewedTree || `working tree, \`git diff ${range}\``}${range !== 'HEAD' ? `\nRange: \`${range}\`` : ''}

Read the cited file in THAT tree: an absolute path as given, a relative path relative to that tree's root, and with a range, at that range's tip; never in the session's working directory, which may be another checkout on another commit. If the file at the cited line does not hold what the finding describes, answer located=false and say what you found; never refuted=true for a finding you could not locate.

  ${f.file}:${f.line} | ${f.severity} | violates ${f.cites}
  why: ${f.why}
  fix: ${f.fix}

Try to REFUTE it. Open the file at the cited line, read the context page, decision or rule it cites, and decide whether the code as written actually violates it in a way that changes correctness, lets a request reach the API without the key, leaks a secret, loses or silently resends a message, lets a vendor type out of its provider, or leaves a requirement without the proof its risk calls for. Default to refuted=true if the violation is stylistic, speculative, already handled elsewhere in the diff, or not backed by the cited page. Read-only.`
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
const usable = f => f.verdict && f.verdict.located === true && typeof f.verdict.refuted === 'boolean'
const confirmed = all.filter(f => usable(f) && f.verdict.refuted === false)
const refuted = all.filter(f => usable(f) && f.verdict.refuted === true)
const unresolved = all.filter(f => !usable(f))

log(`${confirmed.length} confirmed, ${refuted.length} refuted, ${unresolved.length} unresolved (refuter returned nothing or could not locate the finding), ${unresolvedLenses.length} lens(es) failed to return${unresolvedLenses.length ? `: ${unresolvedLenses.join(', ')}` : ''}`)

return {
  module,
  lensesRun: lensResults.map(r => r.lens),
  confirmed: confirmed.map(({ verdict, ...f }) => f),
  refuted: refuted.map(f => ({ file: f.file, line: f.line, cites: f.cites, reason: f.verdict.reason })),
  unresolved: unresolved.map(({ verdict, ...f }) => (verdict && verdict.reason ? { ...f, reason: verdict.reason } : f)),
  unresolvedLenses,
  checked: [...new Set(lensResults.flatMap(r => r.checked))],
  uncited: lensResults.flatMap(r => r.uncited).slice(0, 3),
}
