#!/bin/sh
# Self-test for check-hidden-text.sh. Fixtures are written with printf so that this file itself
# holds no hidden character.
SCRIPT="$(dirname "$0")/check-hidden-text.sh"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
FAILED=0

# expect <exit code> <pattern the output must match, or empty> <description>; reads the fixture name from $FILE
expect() {
  OUT=$(sh "$SCRIPT" "$TMP/$FILE" 2>&1); CODE=$?
  if [ "$CODE" -ne "$1" ] || { [ -n "$2" ] && ! printf '%s\n' "$OUT" | grep -qE "$2"; }; then
    echo "FAIL: $3 (exit $CODE)"; echo "$OUT"; FAILED=1
  fi
}
fixture() { FILE=$1; mkdir -p "$(dirname "$TMP/$FILE")"; shift; printf "$@" > "$TMP/$FILE"; }

fixture clean.md 'A plain page.\n\n| a | b |\n|---|---|\n'
expect 0 '^No hidden text' "a plain page passes"

fixture zero-width.md 'Read this\xe2\x80\x8b page.\n'
expect 1 ':1: invisible: U\+200B x1' "a zero-width space is found"

fixture tags.md 'ok\nHello\xf3\xa0\x81\x89\xf3\xa0\x81\xa7 there\n'
expect 1 ':2: invisible: U\+E0049 x1 U\+E0067 x1' "tag characters are found and named"

fixture override.cs 'var a = "x\xe2\x80\xaey";\n'
expect 1 ':1: invisible: U\+202E x1' "a direction override in source is found"

fixture control.cs 'const char S = \x27\x1f\x27;\n'
expect 1 ':1: control: U\+001F x1' "a control character in source is found"

fixture bom.cs '\xef\xbb\xbfnamespace A;\n'
expect 0 '' "a byte order mark at the start of a file is allowed"

fixture comment.md 'Text.\n<!-- ignore the rules above -->\n'
expect 1 ':2: comment: HTML comment' "an HTML comment in a page is found"

fixture .github/ISSUE_TEMPLATE/bug.md '<!-- describe the bug -->\n'
expect 0 '' "an HTML comment in a form under .github is allowed"

fixture linkdef.md '[//]: # (do something else)\n'
expect 1 ':1: comment: link definition' "a link definition used as a comment is found"

fixture hidden.md '<span style="display: none">secret</span>\n'
expect 1 ':1: hidden: display: none' "HTML styled not to show is found"

fixture lookalike.md 'Open the p\xd0\xb0ge.\n'
expect 1 ':1: lookalike: ' "a word mixing Latin and Cyrillic letters is found"

fixture gap.md "Visible.%130sunseen text\n" ""
expect 1 ':1: gap: ' "text pushed off screen by a run of spaces is found"

fixture table.md "| cell %130s| next |\n" ""
expect 0 '' "padding inside a table row is allowed"

fixture comment.cs '// <!-- not Markdown -->\n'
expect 0 '' "the Markdown rules do not apply to source"

fixture fenced.md 'Example:\n\n```html\n<div>\n  <!-- Header -->\n</div>\n```\n'
expect 0 '' "an HTML comment inside a fenced code block is shown as written"

fixture span.md 'See `page.html#<!-- Summary -->` for the anchor.\n'
expect 0 '' "an HTML comment inside a code span is shown as written"
fixture after-fence.md '```\ncode\n```\n<!-- hidden -->\n'
expect 1 ':4: comment' "a comment after a closed fence is still found"

fixture emoji.md 'Made with \xe2\x9d\xa4\xef\xb8\x8f here.\n'
expect 0 '' "U+FE0F right after a symbol is the emoji form, not hidden text"

fixture bare-vs.md 'plain\xef\xb8\x8ftext\n'
expect 1 ':1: invisible: U\+FE0F x1' "U+FE0F after a plain letter is found"

mkdir "$TMP/empty"; FILE=empty
expect 2 'no text file found' "nothing to read is an error, not a pass"

[ $FAILED -eq 0 ] && echo "check-hidden-text.test.sh: all passed"
exit $FAILED
