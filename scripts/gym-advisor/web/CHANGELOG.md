# Gym Advisor Web changelog

## 0.6.0

- Read current happiness from Torn's resource UI, including outside the gym, and automatically recalculate recommendations and gain estimates when it changes.
- Use an explicit 5,025 happiness estimate only when live happiness is unavailable, with a warning that clears when live readings return.
- Reset completed training batches after gradual energy regeneration reaches the existing new-batch threshold.
- Prevent reuse of stale cached allocations during incomplete stat or energy readings; recalculate on recovery while preserving manual edits.

## 0.4.9

- Baseline at changelog creation, matching the current script version. Earlier changes are not documented here.
