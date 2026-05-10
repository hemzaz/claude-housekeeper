# Kill Criteria

Kill criteria protect the product from becoming broad, unsafe, or unnecessary.

## 1. Stop Or Narrow If

- false positives dominate early reports
- users cannot understand stance language
- users think diagnose changed files
- loader semantics are too unstable across versions
- safe mode cannot avoid side effects
- plugin installation is not trusted enough to diagnose plugin problems
- `/doctor` covers the first wedge well enough that Housekeeper adds little
- report output overwhelms users under stress
- rollback cannot be made trustworthy
- Housekeeper state starts becoming its own mess

## 2. Pivot Options

If the broad product is too risky, narrow to:

- hook path diagnostics only
- plugin cache map only
- read-only `.claude` report generator
- redacted support bundle generator
- fixture/test suite for Claude plugin authors

## 3. Continue Criteria

Continue if:

- users understand "no files changed"
- first reports identify real causes
- protected findings are trusted
- stance language reduces anxiety
- false positives can be captured as allowances
- `/doctor` and Housekeeper feel complementary
- safe mode works when Claude startup is broken

