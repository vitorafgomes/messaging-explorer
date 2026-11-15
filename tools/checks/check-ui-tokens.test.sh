#!/bin/sh
# Self-test for check-ui-tokens.sh: each case is one fixture app folder.
SCRIPT="$(dirname "$0")/check-ui-tokens.sh"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
FAILED=0

# expect <exit code> <pattern the output must match, or empty> <description>; checks the folder $CASE
expect() {
  OUT=$(sh "$SCRIPT" "$TMP/$CASE" 2>&1); CODE=$?
  if [ "$CODE" -ne "$1" ] || { [ -n "$2" ] && ! printf '%s\n' "$OUT" | grep -qE "$2"; }; then
    echo "FAIL: $3 (exit $CODE)"; echo "$OUT"; FAILED=1
  fi
}
# fixture <case> <file> <printf format>
fixture() { CASE=$1; mkdir -p "$(dirname "$TMP/$1/$2")"; printf "$3" > "$TMP/$1/$2"; }

fixture clean a.component.scss '.x {\n  color: var(--mat-sys-primary);\n}\n'
fixture clean a.component.html '<button matButton>Save</button>\n<mat-icon>add</mat-icon>\n'
expect 0 '^No literal hex colour' "theme tokens, a Material button and mat-icon pass"

fixture hex a.component.scss '.x {\n  color: #1b6b32;\n}\n'
expect 1 'a.component.scss:2: literal hex colour' "a six-digit hex colour in a style is found"

fixture short-hex a.component.ts 'styles: [`.x { border: 1px solid #fff; }`]\n'
expect 1 'a.component.ts:1: literal hex colour' "a three-digit hex colour in inline styles is found"

fixture alpha-hex a.component.css '.x { background: #00000080; }\n'
expect 1 'a.component.css:1: literal hex colour' "an eight-digit hex colour is found"

fixture entity a.component.html '<span>a&#160;b</span>\n'
expect 0 '' "an HTML entity is not a colour"

fixture not-hex a.component.html '<input #filterInput>\n<a href="#section-12">x</a>\n'
expect 0 '' "a template reference or an anchor that is not hex is not a colour"

fixture btn a.component.html '<button class="btn btn-primary">Go</button>\n'
expect 1 'a.component.html:1: Bootstrap button' "class=\"btn ...\" is found"

fixture btn-middle a.component.html '<button class="pull btn">Go</button>\n'
expect 1 'a.component.html:1: Bootstrap button' "btn anywhere in the class list is found"

fixture btn-like a.component.html '<button class="btn-row">Go</button>\n<div class="subtn">x</div>\n'
expect 0 '' "a class that only starts or ends with btn is not a Bootstrap button"

fixture fa a.component.html '<i class="fa fa-bug"></i>\n'
expect 1 'a.component.html:1: Font Awesome' "fa fa- is found"

fixture fa-solid a.component.ts 'template: `<i class="fa-solid fa-arrows-rotate"></i>`\n'
expect 1 'a.component.ts:1: Font Awesome' "fa-solid fa- is found"

fixture spec a.component.ts 'export class A {}\n'
fixture spec a.component.spec.ts 'const colour = "#ffffff";\n'
expect 0 '' "a spec is not checked"

fixture dead app.html '<router-outlet />\n'
fixture dead providers/rabbitmq/components/r.component.html '<button class="btn"><i class="fa fa-x"></i></button>\n'
expect 0 '' "the dead provider components are the listed exception"

fixture live-provider providers/rabbitmq/r.service.ts 'const c = "#ff6600";\n'
expect 1 'providers/rabbitmq/r.service.ts:1: literal hex colour' "the exception covers only the provider components folder"

mkdir -p "$TMP/empty"; CASE=empty
expect 2 'no template, style or component' "nothing to read is an error, not a pass"

CASE=missing
expect 2 'no folder' "a folder that does not exist is an error"

[ $FAILED -eq 0 ] && echo "check-ui-tokens.test.sh: all passed"
exit $FAILED
