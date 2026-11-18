# Likidy's Gym Advisor

A gym training assistant for Torn that helps maintain your preferred battle stat ratios while using your available energy efficiently.

Set target percentages for Strength, Defense, Speed, and Dexterity. Gym Advisor calculates recommended training allocations, estimates stat gains, and helps identify the best available gyms for each stat.

### Features

- **Custom stat ratios:** Select the stats to train and configure your preferred percentages.
- **Automatic train suggestions:** Calculates and fills recommended train counts directly into Torn's gym interface.
- **Best gym recommendations:** Identifies efficient gyms for each stat based on observed unlock information.
- **Training protection:** Prevents training excluded stats or training in a less efficient gym when a better unlocked gym is identified.
- **Estimated stat gains:** Previews expected gains and updates estimates when train counts change.
- **Live happiness support:** Uses current happiness for training estimates, including during happy jumps. If unavailable, uses an explicitly labeled 5,025 happiness estimate.
- **Perk support:** Uses the Torn API to account for active gym training bonuses.
- **Smart input management:** Updates recommendations as energy becomes available and clears stale or completed training allocations.
- **Manual override:** Bypasses Gym Advisor's training restrictions when you want to train freely; remains enabled until you turn it off.
- **Saved preferences:** Remembers target ratios and settings between sessions.

### Getting started

Install through Tampermonkey, open Torn's gym, and configure your preferred stat ratios under **Settings**.

Enter your Torn API key in Settings to enable perk-adjusted estimates.

**Note:** Gym Advisor provides recommendations and estimates only. It never automatically performs training. All Train actions remain manual.

**Torn PDA edition:** https://greasyfork.org/en/scripts/604775-likidy-s-gym-advisor-pda
