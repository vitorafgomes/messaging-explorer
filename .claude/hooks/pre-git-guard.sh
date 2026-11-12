#!/bin/sh
# PreToolUse hook (Bash): surface history-writing git, every gh command that writes to GitHub, deploys and
# schema-applying EF commands as a permission ask (CLAUDE.md Rule E).
#
# "ask" (not deny) preserves the per-instance exception - "commit this for me" still works,
# it just cannot happen silently. Read-only git passes without a prompt.
#
# Fails open: bad JSON or a missing jq exits 0 with no output, so a broken hook can never
# block a tool call.

jq -c '
  def segments: [scan("(?:[^|;&\n()`\"\\x27]|\"[^\"]*\"|\\x27[^\\x27]*\\x27)+")];
  (.tool_input.command // "") as $cmd
  | (($cmd | segments) + [$cmd | scan("\"([^\"]*)\"|\\x27([^\\x27]*)\\x27") | .[] | select(. != null) | segments[]]) as $segs
  | "(?:(?:-R|--repo)(?:=|\\s+)\\S+\\s+)?" as $r
  | ("\\bgh\\s+" + $r) as $h
  | "\\bgh\\s+api\\b" as $a
  | "(?:-X\\s*|--method(?:=|\\s+))" as $m
  | "\\bgit\\s+(?:-\\S+\\s+(?:(?!-)(?:[^\\s\"\\x27]|\"[^\"]*\"|\\x27[^\\x27]*\\x27)+\\s+)?)*" as $g
  | [
      ($g + "(commit|push|rebase|revert|cherry-pick|pull|am|filter-branch|update-ref|fast-import)\\b"),
      ($g + "merge\\b(?![^|;&]{0,200}--(abort|continue|quit))"),
      ($g + "reset\\b[^|;&]{0,200}(--hard|--soft|--merge|--keep|HEAD[~^]|@[~^]|\\b[0-9a-f]{7,40}\\b)"),
      ($g + "tag\\s+(-[adfsm]\\b|--delete\\b|--force\\b|(?!\\d+\\s*>)[^-\\s|&><;)(])"),
      ($g + "branch\\b[^|;&]{0,200}\\s(-f|--force|-D|-d|--delete|-m|--move)\\b"),
      ($g + "config\\s+[^|;&]{0,100}alias\\."),
      ($g + "stash\\b(?!\\s+(list|show)\\b)"),
      "\\bdocker\\s+(push|image\\s+push)\\b",
      "\\bwrangler\\s+(deploy|publish|secret)\\b",
      "\\bdotnet\\s+ef\\s+database\\s+(update|drop)\\b"
    ] as $whole
  | [
      ([["issue", "view|list|ls|status"], ["pr", "view|list|ls|status|diff|checks|checkout"],
        ["release", "view|list|ls|download|verify"], ["workflow", "view|list|ls"], ["run", "view|list|ls|watch|download"],
        ["label", "list|ls"], ["secret", "list|ls"], ["variable", "list|ls|get"], ["gist", "view|list|ls|clone"],
        ["repo", "view|list|ls|clone|set-default|gitignore|license|deploy-key\\s+(?:list|ls)|autolink\\s+(?:list|ls|view)"],
        ["cache", "list|ls"], ["project", "view|list|ls|field-list|item-list"], ["(?:codespace|cs)", "view|list|ls|logs"],
        ["(?:ssh-key|gpg-key)", "list|ls"], ["(?:extension|extensions|ext)", "list|ls|search|browse"],
        ["alias", "list|ls"], ["config", "get|list|ls"]]
        | .[] | $h + .[0] + "\\s+" + $r + "(?!(?:" + .[1] + ")\\b)[a-z]"),
      ($a + "[\\s\\S]*?\\s" + $m + "(?![\"\\x27]?GET\\b)\\S"),
      ($a + "(?![\\s\\S]*\\s" + $m + "[\"\\x27]?GET\\b)(?![\\s\\S]*\\sgraphql\\b)[\\s\\S]*\\s(?:-f|--field\\b|--raw-field\\b|--input\\b)"),
      ($a + "(?=[\\s\\S]*\\sgraphql\\b)(?:(?=[\\s\\S]*\\bmutation\\b)|(?![\\s\\S]*=\\s*[\"\\x27]?\\s*query\\b))")
    ] as $gh
  | "^\\s*(?:[A-Za-z_][A-Za-z0-9_]*=\\S*\\s+)*(?:(?:do|then|else|exec|time|command|nohup|sudo|!)\\s+)*(?:xargs(?:\\s+-\\S+(?:\\s+\\d+)?)*\\s+)?gh\\s+(?!(?:issue|pr|release|workflow|run|label|secret|variable|gist|repo|api|cache|project|codespace|cs|ssh-key|gpg-key|extension|extensions|ext|alias|config|auth|browse|org|ruleset|rs|search|status|completion|help|version|attestation|co|actions|environment|exit-codes|formatting|mintty|reference)(?:\\s|$))[a-z]" as $unknown
  | (any($whole[]; . as $re | $cmd | test($re; "i")) or any($segs[] | select(gsub("\"[^\"]*\"|\\x27[^\\x27]*\\x27"; "") | test("\\bgh\\s"; "i")); . as $s | any($gh[]; . as $re | $s | test($re; "i")))) as $writes
  | (any($segs[]; test($unknown; "i"))) as $unknownGh
  | if $writes or $unknownGh then {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason: (if $writes
          then "Rule E (CLAUDE.md): Claude never runs history-writing git, a gh command that writes to GitHub, a deploy, or a command that applies schema to a live database - the human does. Approve only if you explicitly asked for this operation."
          else "Rule E (CLAUDE.md): this gh subcommand is not a command this guard knows, so it cannot tell whether it writes to GitHub. Approve only if you know it only reads, or you asked for it."
          end)
      }
    }
    else empty
    end
' 2>/dev/null

exit 0
