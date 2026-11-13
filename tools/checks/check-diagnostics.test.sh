#!/usr/bin/env bash
# Case matrix for check-diagnostics.sh in stdin mode (-), so no build runs: PASS = exit 0, FAIL = exit 1.
SCRIPT="$(cd "$(dirname "$0")" && pwd)/check-diagnostics.sh"
fail=0
run() { want=$1; name=$2; log=$3; expect=${4:-}; minsev=${5:-}
  out=$(printf '%s\n' "$log" | sh "$SCRIPT" - $minsev 2>&1); rc=$?
  [ "$rc" = "0" ] && actual=PASS || actual=FAIL
  if [ "$actual" != "$want" ]; then echo "FAIL want=$want got=$actual :: $name"; echo "$out" | sed 's/^/    /'; fail=1; fi
  if [ -n "$expect" ] && ! printf '%s' "$out" | grep -q -- "$expect"; then echo "FAIL output lacks '$expect' :: $name"; echo "$out" | sed 's/^/    /'; fail=1; fi
}
summary='Build succeeded.
    0 Warning(s)
    0 Error(s)

Time Elapsed 00:00:12.34
                   NoWarn = CS1591;NU1603
                   /warnaserror+:NU1605'

run FAIL "a diagnostic without file coordinates counts" \
  "/repo/src/A/A.csproj : warning NU1603: A depends on B (>= 1.0.0) but B 1.0.0 was not found.
$summary" "NU1603 warning, 1 occurrence(s), first in A.csproj, no line"
run FAIL "a project-level error without coordinates counts" \
  "MSBUILD : error MSB1009: Project file does not exist." "MSB1009"
run FAIL "a diagnostic with file coordinates still counts" \
  "/repo/src/A/Thing.cs(12,5): warning CA1822: Member does not access instance data [/repo/src/A/A.csproj]" \
  "CA1822 warning, 1 occurrence(s), first in Thing.cs:12"
run FAIL "the repeated summary copy of a coordinate-less diagnostic counts once" \
  "/repo/src/A/A.csproj : warning NU1603: B was not found.
$summary
    /repo/src/A/A.csproj : warning NU1603: B was not found." "1 distinct diagnostic(s)"
run FAIL "an error with file coordinates counts" \
  "/repo/src/A/Thing.cs(3,9): error CS0103: The name 'x' does not exist in the current context [/repo/src/A/A.csproj]" \
  "CS0103 error, 1 occurrence(s), first in Thing.cs:3"
run FAIL "an info with file coordinates counts at the default severity" \
  "/repo/src/A/Thing.cs(1,1): info IDE0005: Using directive is unnecessary. [/repo/src/A/A.csproj]" \
  "IDE0005 info, 1 occurrence(s), first in Thing.cs:1"
run FAIL "an info without file coordinates counts at the default severity" \
  "CSC : info IDE0005: Using directive is unnecessary. [/repo/src/A/A.csproj]" \
  "IDE0005 info, 1 occurrence(s), first in CSC, no line"
run FAIL "a message without file coordinates counts at the default severity" \
  "/repo/src/A/A.csproj : message NETSDK1057: You are using a preview version of .NET." \
  "NETSDK1057 info, 1 occurrence(s), first in A.csproj, no line"
run PASS "an info without file coordinates is reported but does not fail at warning" \
  "CSC : info IDE0005: Using directive is unnecessary. [/repo/src/A/A.csproj]" \
  "IDE0005 info, 1 occurrence(s), first in CSC, no line" warning
run PASS "a severity word after a colon with no diagnostic code is not a diagnostic" \
  "  Target : message text from a build step
  Restore : warning about nothing in particular
  Notes : error handling is described elsewhere" "holds no compiler or analyzer diagnostic"
run PASS "build summary lines, a NoWarn dump and a compiler switch are not diagnostics" "$summary" \
  "holds no compiler or analyzer diagnostic"

[ $fail = 0 ] && echo "ALL CASES PASS"
exit $fail
