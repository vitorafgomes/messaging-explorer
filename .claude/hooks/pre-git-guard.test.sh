#!/usr/bin/env bash
# Case matrix for pre-git-guard.sh: ASK = must be blocked for approval, PASS = must go through.
HOOK="${1:-$(dirname "$0")/pre-git-guard.sh}"
fail=0
check() {
  want=$1; cmd=$2
  got=$(printf '{"tool_input":{"command":%s}}' "$(jq -Rn --arg c "$cmd" '$c')" | bash "$HOOK" | grep -c permissionDecision)
  [ "$got" = "1" ] && actual=ASK || actual=PASS
  if [ "$actual" != "$want" ]; then echo "FAIL want=$want got=$actual :: $cmd"; fail=1; fi
}
# must ASK
for c in "git commit -m x" "git push origin main" "git merge feat/x" "git rebase main" \
         "git revert HEAD" "git cherry-pick abc1234" "git pull" "git reset --hard" \
         "git reset --soft HEAD~1" "git reset HEAD~2" "git tag v1.0" "git tag -d v1.0" \
         "git branch -D old" "git branch -m a b" "git config alias.ci commit" \
         "gh pr create --fill" "gh pr merge 12" "git am patch.diff" "git update-ref HEAD abc" \
         "npm test && git push" "gh release create v1.0.0 --notes x" "gh release upload v1.0.0 a.AppImage --clobber" \
         "gh release edit v1.0.0 --draft=false" "gh release delete v1.0.0 --cleanup-tag --yes" \
         "gh release delete-asset v1.0.0 a.AppImage" "gh workflow run release.yml --ref main -f kind=release" \
         "bash scripts/next-version.sh release && gh release create v1.0.0" \
         "git stash" "git stash push -m wip" "git stash save wip" "git stash pop" "git stash apply stash@{0}" \
         "git stash drop" "git stash clear" "git stash branch tmp" "git stash -u" "git -C /x stash pop" \
         "git stash; npm test"; do check ASK "$c"; done
# GitHub writes through gh must ASK: issue, pull request, release, repo, label, secret, variable, workflow, run and gist writes, and a gh api call that writes or may write
for c in "gh issue create --title x --body y" "gh issue comment 12 --body x" "gh issue edit 12 --add-label bug" \
         "gh issue close 12" "gh issue reopen 12" "gh issue delete 12 --yes" "gh issue lock 12" "gh issue unlock 12" \
         "gh issue pin 12" "gh issue unpin 12" "gh issue transfer 12 o/r" "gh issue develop 12" \
         "gh issue comment 12 --repo o/r --body x" "gh issue --repo o/r comment 12 -b x" "gh issue -R o/r close 12" \
         "gh pr comment 12 --body x" "gh pr review 12 --approve" "gh pr edit 12 --title x" "gh pr close 12" \
         "gh pr reopen 12" "gh pr merge 12 --squash" "gh pr ready 12" "gh pr lock 12" "gh pr update-branch 12" \
         "gh pr --repo o/r review 12 -r -b x" \
         "gh repo create o/r --private" "gh repo new o/r --private" "gh repo autolink create JIRA- https://x/<num>" "gh repo delete o/r --yes" "gh repo edit o/r --visibility public" "gh repo fork o/r" \
         "gh repo rename new" "gh repo archive o/r --yes" "gh repo unarchive o/r" "gh repo sync o/r" \
         "gh repo deploy-key add k.pub" "gh repo deploy-key delete 1" \
         "gh label create bug" "gh label edit bug --color ff0000" "gh label delete bug --yes" "gh label clone o/r" \
         "gh secret set TOKEN --body x" "gh secret delete TOKEN" "gh variable set V --body x" "gh variable delete V" \
         "gh workflow run ci.yml" "gh workflow enable ci.yml" "gh workflow disable ci.yml" \
         "gh run rerun 123" "gh run cancel 123" "gh run delete 123" \
         "gh gist create f.txt" "gh gist edit abc" "gh gist delete abc" "gh gist rename abc a b" \
         "gh api -X POST repos/o/r/issues -f title=x" "gh api --method PATCH repos/o/r/issues/1 -f state=closed" \
         "gh api --method=DELETE repos/o/r/labels/x" "gh api -XPUT repos/o/r/subscription" "gh api -X 'POST' repos/o/r/issues" \
         "gh api repos/o/r/issues/1/comments -f body=hello" "gh api repos/o/r/issues -F title=x" \
         "gh api repos/o/r/issues --raw-field body=x" "gh api repos/o/r/issues --field title=x" "gh api repos/o/r/issues --input body.json" \
         "gh api repos/o/r/issues -fbody=x" "gh api repos/o/r/issues --jq '.a | .b' -f title=x" \
         "gh api graphql -f query='mutation { addComment(input: {subjectId: \"x\", body: \"y\"}) { clientMutationId } }'" \
         "gh api graphql -F query=@q.graphql" "gh api graphql -f query=\"\$Q\"" "gh api graphql --input q.json" \
         "bash -lc \"gh issue comment 12 --body x\"" "cd /tmp/x && gh pr comment 12 --body x" \
         "for n in 1 2; do gh issue close \$n; done" "GH_REPO=o/r gh issue create -t x -b y" \
         "gh issue view 12 && gh issue comment 12 -b x" "(gh api repos/o/r/issues -f title=x)"; do check ASK "$c"; done
# must PASS
for c in "git status" "git diff HEAD" "git log --grep=commit" "git show HEAD" "git blame f.ts" \
         "git tag -l" "git tag --list" "git merge --abort" "git branch" "git branch -a" \
         "gh pr view 12" "gh pr list" "ng test --no-watch" "git log --oneline -5" \
         "git config user.name" "git stash list" "git stash list --stat" "git stash show -p stash@{0}" "gh release list --limit 1" "gh release view v0.2.0" \
         "gh release download v0.2.0" "gh workflow list" "gh workflow view release.yml" "gh run list --workflow release.yml" \
         "gh run watch 123"; do check PASS "$c"; done
# GitHub reads through gh must PASS
for c in "gh issue view 229 --repo o/r" "gh issue list --state open" "gh issue status" "gh issue -R o/r view 12" \
         "gh issue view 229 --repo o/r --json title,body --jq '.title + .body'" \
         "gh pr view 12 --comments" "gh pr list --state merged" "gh pr diff 12" "gh pr checks 12" "gh pr status" \
         "gh pr checkout 12" "gh pr --repo o/r view 12" "gh repo view o/r" "gh repo list" "gh repo clone o/r" "gh search issues bug" \
         "gh run view 123 --log" "gh run list" "gh run download 123" "gh label list" "gh secret list" "gh variable list" \
         "gh variable get V" "gh gist list" "gh gist view abc" \
         "gh issue ls" "gh pr ls" "gh release ls" "gh repo ls" "gh label ls" "gh run ls" "gh workflow ls" "gh gist ls" \
         "gh repo set-default o/r" "gh repo deploy-key list" "gh repo autolink list" "gh repo autolink view 1" "gh repo gitignore view Node" \
         "gh api repos/o/r/issues" "gh api repos/o/r/pulls --paginate --jq '.[].number'" "gh api -X GET repos/o/r/issues" \
         "gh api --method GET search/issues -f q=repo:o/r" "gh api --method=GET search/issues -F per_page=5" \
         "gh api graphql -f query='query { viewer { login } }'" \
         "gh api graphql -f query='query(\$o: String!) { repositoryOwner(login: \$o) { id } }' -F o=x"; do check PASS "$c"; done
# a gh command is judged on its own words, up to the next unquoted |, &&, ||, ;, newline or subshell end
for c in "gh api repos/o/r/issues -f title=x | cut -f2" "gh issue list | xargs -n1 gh issue close" \
         "echo x | gh issue comment 1 --body-file -" "gh api -X DELETE repos/o/r/issues/comments/1 2>&1 | tail -1" \
         "gh issue comment 1 --body \"a | b; c\"" "gh api repos/o/r/issues --jq '.[] | .number' -f title=x" \
         "gh issue view 1; gh issue close 1" "gh issue view 1 || gh issue reopen 1" "\$(gh issue close 1)" \
         "gh cache delete 123" "gh project create --owner o --title x" "gh project edit 1 --owner o --title y" \
         "gh project close 1 --owner o" "gh project delete 1 --owner o" "gh project item-add 1 --owner o --url u" \
         "gh project item-create 1 --owner o --title t" "gh project item-edit --id i --project-id p" "gh project item-delete 1 --owner o --id i" \
         "gh project item-archive 1 --owner o --id i" "gh project field-create 1 --owner o --name f --data-type TEXT" \
         "gh project field-delete --id f" "gh project link 1 --owner o --repo r" "gh project unlink 1 --owner o --repo r" \
         "gh project copy 1 --source-owner o --target-owner p --title t" "gh project mark-template 1 --owner o" \
         "gh codespace create -r o/r" "gh codespace delete -c x" "gh codespace stop -c x" "gh codespace rebuild -c x" \
         "gh codespace edit -c x -m large" "gh codespace cp a remote:b" "gh cs delete -c x" \
         "gh ssh-key add k.pub" "gh ssh-key delete 1" "gh gpg-key add k.asc" "gh gpg-key delete ABC" \
         "gh extension install o/gh-x" "gh extension upgrade --all" "gh extension remove x" "gh ext install o/gh-x" \
         "gh alias set pv 'pr view'" "gh alias delete pv" "gh alias import a.yml" "gh config set editor vim" \
         "gh newthing do-it" "cd /tmp/x && gh newthing" "GH_REPO=o/r gh newthing" \
         "bash -lc \"gh issue list | xargs -n1 gh issue close\"" "bash -lc 'gh api repos/o/r/issues -f title=x | cut -f2'"; do check ASK "$c"; done
for c in "gh api repos/o/r/issues --jq '.[].number' | cut -f2" "gh api repos/o/r/pulls/1/comments --paginate | grep -c x" \
         "gh issue list --json number | jq -r '.[]|.number' | head -5" "gh pr view 1 --json body --jq .body | cut -c1-200" \
         "gh api graphql -f query='query{viewer{login}}' | cut -f1" "for n in 1 2; do gh issue view \$n; done" \
         "gh api repos/o/r/issues --jq '.[] | .title' | sort -u" "gh issue view 1 2>&1 | tail -f" "gh pr list && rm -f x.txt" \
         "gh project list --owner o" "gh project view 1 --owner o" "gh project item-list 1 --owner o" "gh cache list" \
         "gh codespace list" "gh cs ls" "gh ssh-key list" "gh gpg-key list" "gh extension list" "gh alias list" "gh config get editor" \
         "gh --version" "gh version" "gh help" "gh help issue" "gh status" "gh auth status" "gh search repos explorer" "gh browse" \
         "gh co 12" "gh ruleset list" "gh org list" "which gh" "gh" \
         "bash -lc \"gh api repos/o/r/issues | cut -f2\"" "bash -lc \"cd /tmp/x && gh issue list | head -3\""; do check PASS "$c"; done
reason() { printf '{"tool_input":{"command":%s}}' "$(jq -Rn --arg c "$1" '$c')" | bash "$HOOK" | jq -r '.hookSpecificOutput.permissionDecisionReason // ""'; }
reason "gh newthing do-it" | grep -q "not a command this guard knows" || { echo "FAIL reason does not say unknown :: gh newthing do-it"; fail=1; }
reason "gh issue close 1" | grep -q "not a command this guard knows" && { echo "FAIL reason says unknown :: gh issue close 1"; fail=1; }
[ $fail = 0 ] && echo "ALL CASES PASS"
exit $fail
