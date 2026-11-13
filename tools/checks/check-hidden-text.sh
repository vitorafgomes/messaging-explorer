#!/bin/sh
# Finds text a person does not see on screen but a model still reads.
#
#   tools/checks/check-hidden-text.sh [file-or-directory ...]
#
# With no argument it scans the text files of the repo. Give it paths to check something else,
# for example a file from outside before a model is asked to read it.
#
# Every text file is checked for:
#   invisible   zero-width and formatting code points, direction overrides, tag characters,
#               variation selectors, filler letters, soft hyphens
#   control     control characters other than tab, line feed and carriage return
# Markdown files are also checked for:
#   comment     an HTML comment, or a link definition used as one; neither is rendered
#               (what sits inside a code block or a code span is shown as written, and is skipped)
#   hidden      HTML that is styled or marked not to show
#   lookalike   a word that mixes Latin letters with Cyrillic or Greek ones
#   gap         a long run of spaces in the middle of a line, which pushes text off screen
#
# Prints one line per finding, file:line: kind: detail, and exits 1 when there is any, 0 when
# there is none, 2 when it cannot run. A byte order mark at the start of a file is allowed.
# The issue and pull request forms under .github may carry HTML comments: they are notes to
# the person filling in the form.

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
command -v perl >/dev/null 2>&1 || { echo "check-hidden-text: perl is required" >&2; exit 2; }
[ $# -gt 0 ] || set -- "$ROOT"

find "$@" \( -name node_modules -o -name bin -o -name obj -o -name dist -o -name .git \
    -o -name .idea -o -name graphify-out -o -name out -o -name .angular \) -prune -o -type f \
  \( -name '*.md' -o -name '*.cs' -o -name '*.ts' -o -name '*.js' -o -name '*.json' -o -name '*.sh' \
    -o -name '*.yml' -o -name '*.yaml' -o -name '*.html' -o -name '*.scss' -o -name '*.css' \
    -o -name '*.proto' -o -name '*.props' -o -name '*.csproj' -o -name '*.slnx' -o -name '*.txt' \
    -o -name '*.toml' -o -name '.editorconfig' \) -print0 2>/dev/null |
perl -0 -e '
  use strict; use warnings;
  binmode(STDOUT, ":utf8");
  my $invisible = qr/[\x{00AD}\x{061C}\x{115F}\x{1160}\x{180E}\x{200B}-\x{200F}\x{202A}-\x{202E}\x{2060}-\x{2064}\x{2066}-\x{2069}\x{3164}\x{FE00}-\x{FE0E}\x{FEFF}\x{FFA0}\x{E0000}-\x{E007F}\x{E0100}-\x{E01EF}]/;
  # U+FE0F asks for the emoji form of the symbol before it; it is hidden only when nothing visible
  # that has an emoji form comes before it.
  my $emoji_base = qr/[\x{00A9}\x{00AE}\x{203C}\x{2049}\x{2122}\x{2139}\x{2190}-\x{2BFF}\x{3030}\x{303D}\x{3297}\x{3299}\x{1F000}-\x{1FAFF}0-9#*]/;
  my $control = qr/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\x{0080}-\x{009F}]/;
  my ($found, $files) = (0, 0);
  sub report { my ($file, $line, $kind, $detail) = @_; $found++; print "$file:$line: $kind: $detail\n"; }
  while (my $file = <STDIN>) {
    chomp $file;
    open(my $in, "<:encoding(UTF-8)", $file) or next;
    $files++;
    my $markdown = $file =~ /\.md$/i;
    my $fenced = 0;
    my $form = $file =~ m{(^|/)\.github/.*(TEMPLATE|template)};
    no warnings "utf8";
    local $/ = "\n";
    while (my $text = <$in>) {
      $text =~ s/^\x{FEFF}// if $. == 1;
      $text =~ s/[\r\n]+$//;
      my %seen;
      while ($text =~ /($invisible)/g) { $seen{sprintf("U+%04X", ord($1))}++; }
      while ($text =~ /(?<!$emoji_base)\x{FE0F}/g) { $seen{"U+FE0F"}++; }
      report($file, $., "invisible", join(" ", map { "$_ x$seen{$_}" } sort keys %seen)) if %seen;
      %seen = ();
      while ($text =~ /($control)/g) { $seen{sprintf("U+%04X", ord($1))}++; }
      report($file, $., "control", join(" ", map { "$_ x$seen{$_}" } sort keys %seen)) if %seen;
      next unless $markdown;
      # Code in Markdown is shown as written, so what is inside a fenced block or a code span is
      # visible on screen and is not checked by the rules below.
      if ($text =~ /^\s*(```|~~~)/) { $fenced = !$fenced; next; }
      next if $fenced;
      $text =~ s/(`+)(?:(?!\1).)+?\1//g;
      report($file, $., "comment", "HTML comment") if !$form && $text =~ /<!--/;
      report($file, $., "comment", "link definition used as a comment") if $text =~ /^\s*\[[^\]]*\]:\s*(#|<>)/;
      report($file, $., "hidden", $1) if $text =~ /(display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0(?![.\d])|opacity\s*:\s*0(?![.\d])|<[a-z][^>]*\shidden[\s>=])/i;
      report($file, $., "lookalike", $1) if $text =~ /\b((?=\w*[A-Za-z])(?=\w*[\p{Cyrillic}\p{Greek}])\w+)/;
      report($file, $., "gap", "a run of spaces inside the line") if $text =~ /\S[ \t]{120,}[^|\s]/;
    }
    close($in);
  }
  if ($files == 0) { print STDERR "check-hidden-text: no text file found\n"; exit 2; }
  print $found ? "$found finding(s) in $files file(s) read.\n" : "No hidden text in $files file(s).\n";
  exit($found ? 1 : 0);
'
