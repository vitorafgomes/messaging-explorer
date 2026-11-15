#!/bin/sh
# Keeps the web app on one design system: fails on what the UI convention forbids and a reader can count.
#
#   tools/checks/check-ui-tokens.sh [app folder]     (web-app/src/app unless given)
#
# Finds, in the templates, styles and components of the folder (specs left out):
#   a literal hex colour            colour comes from the theme tokens
#   a Bootstrap button, class="btn" buttons are Angular Material
#   a Font Awesome icon, "fa fa-"   icons are mat-icon
# Prints <path>:<line>: <what> per finding and exits 1 on any, 0 on none, 2 when it finds nothing to check.
#
# The provider entity-details components are left out: nothing renders them (no route or template
# uses ProviderShellComponent), and they keep Bootstrap's classes until the owner decides their fate.

HERE=$(cd "$(dirname "$0")" && pwd)
APP=${1:-"$HERE/../../web-app/src/app"}
[ -d "$APP" ] || { echo "check-ui-tokens: no folder $APP" >&2; exit 2; }
cd "$APP" || exit 2

EXCEPT='^\./providers/(azure-service-bus|rabbitmq)/components/'
FILES=$(find . -type f \( -name '*.ts' -o -name '*.html' -o -name '*.scss' -o -name '*.css' \) ! -name '*.spec.ts' | grep -Ev "$EXCEPT" | sort)
[ -n "$FILES" ] || { echo "check-ui-tokens: no template, style or component under $APP" >&2; exit 2; }

# rule <description> <extended regular expression>
failed=0
rule() {
  # shellcheck disable=SC2086
  hits=$(grep -HnE "$2" $FILES)
  [ -z "$hits" ] && return
  printf '%s\n' "$hits" | sed -E "s/^\.\/([^:]*:[0-9]+):.*/\1: $1/"
  failed=1
}

# A hex colour of 3, 4, 6 or 8 digits; an HTML entity such as &#160; is not one.
rule 'literal hex colour; use a theme token'      '(^|[^&#0-9A-Za-z_])#([0-9A-Fa-f]{8}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{3,4})([^0-9A-Za-z_-]|$)'
rule 'Bootstrap button class "btn"; use a Material button' 'class="([^"]* )?btn( |")'
rule 'Font Awesome icon; use mat-icon'           '(^|[^A-Za-z0-9_-])fa(-solid|-regular|-brands|[srb])? fa-'

[ "$failed" -eq 0 ] && echo "No literal hex colour, Bootstrap button or Font Awesome icon in $(printf '%s\n' "$FILES" | wc -l) files."
exit "$failed"
