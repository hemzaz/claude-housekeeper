# Feedback Templates

These templates shape field research and early user feedback.

## 1. False Positive Report

```md
## Finding

## Why it was wrong or intentional

## Expected classification

## Was it protected, allowed, or hidden?

## Claude Code version / OS

## Redacted report snippet
```

## 2. Unclear Output Report

```md
## Which line was unclear?

## What did you think Housekeeper meant?

## What should it have said?

## Were you afraid it changed files?

## Did the next step feel safe?
```

## 3. Damaged Environment Report

This should exist before mutation is released.

```md
## What command was run?

## What changed unexpectedly?

## Was a Housekeeper operation id printed?

## Was rollback attempted?

## What rollback output appeared?

## Claude Code version / OS

## Redacted operation manifest
```

## 4. Missing Detector Request

```md
## What went wrong in your Claude home?

## How did you discover it?

## What file/path/surface was involved?

## What should Housekeeper have reported?

## Can you share a redacted structural snippet?
```

