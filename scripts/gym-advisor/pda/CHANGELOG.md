# Gym Advisor PDA changelog

## 0.6.0

- Read current happiness from Torn's resource UI, including outside the gym, and automatically recalculate recommendations and gain estimates when it changes.
- Use an explicit 5,025 happiness estimate only when live happiness is unavailable, with a warning that clears when live readings return.
- Reset completed training batches after gradual energy regeneration reaches the existing new-batch threshold.
- Prevent reuse of stale cached allocations during incomplete stat or energy readings; recalculate on recovery while preserving manual edits.
- Correct the compact information layout: title and Settings share the first row, followed by separate left-aligned gym/energy, target ratio, and perk rows at every viewport width.

## 0.5.0

- Baseline at changelog creation, matching the current script version. Earlier changes are not documented here.
