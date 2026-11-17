// ==UserScript==
// @name         Likidy's Gym Advisor
// @namespace    local.torn.gym.ratio
// @version      0.4.9
// @license      MIT
// @description  Ratio advisor with perk-adjusted gain previews and safe native train-count autofill.
// @match        https://www.torn.com/gym.php*
// @match        https://www.torn.com/loader.php?sid=gym*
// @connect      api.torn.com
// @grant        GM_xmlhttpRequest
// @run-at       document-idle
// ==/UserScript==
 
(() => {
  'use strict';
 
  const ALL_STATS = ['strength', 'defense', 'speed', 'dexterity'];
  const DEFAULT_TARGET = { strength: 30, defense: 0, speed: 30, dexterity: 40 };
  const TARGET_KEY = 'likidy-gym-targets-v1';
  const UNLOCK_KEY = 'likidy-gym-unlocked-v1';
  const ADVISOR_UNLOCK_KEY = 'likidy-gym-allow-any-training-v1';
  const PANEL_ID = 'torn-ratio-advisor';
  const API_KEY_KEY = 'likidy-gym-advisor-api-key-v1';
  const PDA_KEY = '###PDA-APIKEY###';
  const PERK_REFRESH_MS = 15 * 60 * 1000;
  const ZERO_PERKS = Object.freeze({ strength: 1, defense: 1, speed: 1, dexterity: 1 });
  const COLORS = { strength: '#74a1e1', defense: '#65bf88', speed: '#edbd63', dexterity: '#65bf88' };
  const ABBR = { strength: 'STR', defense: 'DEF', speed: 'SPD', dexterity: 'DEX' };
 
  // Torn gym dots, ordered as STR, SPD, DEF, DEX. Zero means unavailable.
  const GYMS = [
    ['Premier Fitness', 5, 2, 2, 2, 2],
    ['Average Joes', 5, 2.4, 2.4, 2.8, 2.4],
    ["Woody's Workout", 5, 2.8, 3.2, 3, 2.8],
    ['Beach Bods', 5, 3.2, 3.2, 3.2, 0],
    ['Silver Gym', 5, 3.4, 3.6, 3.4, 3.2],
    ['Pour Femme', 5, 3.4, 3.6, 3.6, 3.8],
    ['Davies Den', 5, 3.7, 0, 3.7, 3.7],
    ['Global Gym', 5, 4, 4, 4, 4],
    ['Knuckle Heads', 10, 4.8, 4.4, 4, 4.2],
    ['Pioneer Fitness', 10, 4.4, 4.5, 4.8, 4.4],
    ['Anabolic Anomalies', 10, 5, 4.5, 5.2, 4.5],
    ['Core', 10, 5, 5.2, 5, 5],
    ['Racing Fitness', 10, 5, 5.4, 4.8, 5.2],
    ['Complete Cardio', 10, 5.5, 5.8, 5.5, 5.2],
    ['Legs, Bums and Tums', 10, 0, 5.6, 5.6, 5.8],
    ['Deep Burn', 10, 6, 6, 6, 6],
    ['Apollo Gym', 10, 6, 6.2, 6.4, 6.2],
    ['Gun Shop', 10, 6.6, 6.4, 6.2, 6.2],
    ['Force Training', 10, 6.4, 6.6, 6.4, 6.8],
    ["Cha Cha's", 10, 6.4, 6.4, 6.8, 7],
    ['Atlas', 10, 7, 6.4, 6.4, 6.6],
    ['Last Round', 10, 6.8, 6.6, 7, 6.6],
    ['The Edge', 10, 6.8, 7, 7, 6.8],
    ["George's", 10, 7.3, 7.3, 7.3, 7.3],
    ['Frontline Fitness', 25, 7.5, 7.5, 0, 0],
    ['Balboas Gym', 25, 0, 0, 7.5, 7.5],
    ['Gym 3000', 50, 8, 0, 0, 0],
    ['Mr. Isoyamas', 50, 0, 0, 8, 0],
    ['Total Rebound', 50, 0, 8, 0, 0],
    ['Elites', 50, 0, 0, 0, 8],
    ['The Sports Science Lab', 25, 9, 9, 9, 9],
    ['Fight Club', 10, 10, 10, 10, 10],
    ['Jail Gym', 5, 3.4, 3.4, 4.5, 0]
  ];
  const GYM_BY_NAME = new Map(GYMS.map(([name, energy, strength, speed, defense, dexterity], i) => [
    name.toLowerCase(), { id: i + 1, name, energy, dots: { strength, speed, defense, dexterity } }
  ]));
  const GYM_BY_ID = new Map(Array.from(GYM_BY_NAME.values()).map(gym => [gym.id, gym]));
  GYM_BY_NAME.set('the elites', GYM_BY_NAME.get('elites'));
  GYM_BY_NAME.set("balboa's gym", GYM_BY_NAME.get('balboas gym'));
  GYM_BY_NAME.set('crims gym', GYM_BY_NAME.get('jail gym'));
 
  function validTarget(target) {
    if (!target || typeof target !== 'object') return false;
    const values = ALL_STATS.map(k => target[k]);
    return values.every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100) &&
      values.some(n => n > 0) && Math.abs(values.reduce((a, b) => a + b, 0) - 100) < 1e-7;
  }
 
  function loadTarget() {
    try {
      const saved = JSON.parse(localStorage.getItem(TARGET_KEY));
      if (validTarget(saved)) return Object.fromEntries(ALL_STATS.map(k => [k, saved[k]]));
    } catch (_) { /* First installation. */ }
    return { ...DEFAULT_TARGET };
  }
  let target = loadTarget();
  let allowAnyTraining = false;
  try { allowAnyTraining = localStorage.getItem(ADVISOR_UNLOCK_KEY) === 'true'; } catch (_) {}
  const selected = () => ALL_STATS.filter(k => target[k] > 0);
 
  function parseNumber(text) {
    if (typeof text !== 'string') return null;
    const cleaned = text.trim().replace(/,/g, '');
    return /^\d+(?:\.\d+)?$/.test(cleaned) ? Number(cleaned) : null;
  }
 
  function proportions(stats, keys = selected()) {
    const total = keys.reduce((sum, key) => sum + stats[key], 0);
    return Object.fromEntries(keys.map(key => [key, total ? stats[key] / total : 0]));
  }
 
  function estimatedGain(stat, happy, dots, energy) {
    const h = happy + 250;
    return Math.max(0, dots * energy * (((3.480061091e-7 * Math.log(h) + 3.091619094e-6) * stat) +
      6.82775184551527e-5 * h - 0.0301431777));
  }
 
  // Perks in API v2 are nested under { perks: { faction: [...], ... } }.
  // A perk applies multiplicatively, and can be specific to a battle stat.
  function parseGymPerks(payload) {
    const entries = payload?.perks;
    if (!entries || typeof entries !== 'object' ||
        !Object.values(entries).some(Array.isArray)) {
      throw new Error('Unexpected user/perks response format');
    }
    const factors = { ...ZERO_PERKS };
    const recognized = [];
    const unknown = [];
    const statWords = {
      strength: /\bstrength\b/i,
      defense: /\bdefen[cs]e\b/i,
      speed: /\bspeed\b/i,
      dexterity: /\bdexterity\b/i
    };
    for (const [source, items] of Object.entries(entries)) {
      if (!Array.isArray(items)) continue;
      for (const item of items) {
        if (typeof item !== 'string') continue;
        if (!/\bgym\s+(?:gains?|training\s+gains?)\b|\btraining\s+gains?\b/i.test(item)) continue;
        const matches = [...item.matchAll(/([+-]?\d+(?:\.\d+)?)\s*%/g)];
        if (matches.length !== 1) {
          unknown.push(`${source}: ${item}`);
          continue;
        }
        let percent = Number(matches[0][1]);
        if (/\b(?:decreas|reduc)(?:es|ed|ing)?\b/i.test(item) && percent > 0) {
          percent = -percent;
        }
        if (!Number.isFinite(percent) || percent <= -100 || percent > 500) {
          unknown.push(`${source}: ${item}`);
          continue;
        }
        const targets = ALL_STATS.filter(k => statWords[k].test(item));
        // If no specific stat is named, assume the perk applies to all gym gains.
        const affected = targets.length ? targets : ALL_STATS;
        for (const key of affected) factors[key] *= 1 + percent / 100;
        recognized.push({ source, text: item, percent, stats: affected });
      }
    }
    return { factors, recognized, unknown };
  }
 
  // Retain the original Torn gym formula, adding the relevant perk multiplier.
  // Happiness falls by approximately 50% of energy spent per train.
  function previewGain(stat, happy, gym, key, count, factors = ZERO_PERKS) {
    if (!gym || !Number.isFinite(stat) || !Number.isFinite(happy) ||
        !Number.isInteger(count) || count < 0 || count > 1500 || gym.dots[key] <= 0) return null;
    let current = stat;
    let currentHappy = happy;
    const multiplier = factors[key] ?? 1;
    for (let i = 0; i < count; i++) {
      current += estimatedGain(current, currentHappy, gym.dots[key], gym.energy) * multiplier;
      currentHappy = Math.max(0, currentHappy - gym.energy * 0.5);
    }
    return Math.max(0, current - stat);
  }
 
  function formatGain(value) {
    return value === 0 ? '0' : value < 1 ? value.toFixed(2) :
      value < 100 ? value.toFixed(1) :
      Math.round(value).toLocaleString('en-US');
  }
 
  function bestGyms(unlocked) {
    const best = {};
    for (const key of ALL_STATS) {
      const matches = [...unlocked].map(id => GYM_BY_ID.get(id))
        .filter(gym => gym && gym.dots[key] > 0)
        .sort((a, b) => b.dots[key] - a.dots[key] || a.energy - b.energy || b.id - a.id);
      best[key] = matches[0] || null;
    }
    return best;
  }
 
  // Only standard gyms 1-24 are sequential. Specialist gyms require explicit evidence.
  function scanUnlocked(current) {
    if (!current) return { verified: false, gyms: new Set() };
    let fromPage = new Set();
    let sawLocked = false;
    const root = document.querySelector('#gymroot');
    if (root) for (const element of root.querySelectorAll('[class*="gym-"]')) {
      const id = Number((element.className?.toString() || '').match(/(?:^|\s)gym-(\d+)(?:\s|$)/)?.[1]);
      if (!GYM_BY_ID.has(id)) continue;
      const classes = [...(element.parentElement?.classList || [])];
      if (classes.some(c => /^locked/i.test(c))) { sawLocked = true; continue; }
      if (classes.some(c => /^(available|active|purchased)/i.test(c))) fromPage.add(id);
    }
    // Active gym proves earlier standard gyms were already purchased.
    let known = new Set();
    if (current.id <= 24) for (let i = 1; i <= current.id; i++) known.add(i);
    if (fromPage.has(current.id) && (fromPage.size >= 2 || sawLocked)) {
      for (const id of fromPage) known.add(id);
    } else {
      // Only reuse already observed gyms. Never infer that a future gym is unlocked.
      try {
        const saved = JSON.parse(localStorage.getItem(UNLOCK_KEY));
        if (Array.isArray(saved)) for (const id of saved) if (GYM_BY_ID.has(id)) known.add(id);
      } catch (_) { /* No prior observations. */ }
    }
    known.add(current.id);
    if (known.size && current.id <= 24) {
      try { localStorage.setItem(UNLOCK_KEY, JSON.stringify([...known])); } catch (_) {}
    }
    return { verified: current.id <= 24 || fromPage.has(current.id), gyms: known };
  }
 
  // Train recommendations can span gyms, so the ratio stays balanced without bad-gym trains.
  function planTrains(stats, happy, energy, gymByStat, factors = ZERO_PERKS, completed = new Set()) {
    const keys = selected();
    if (!keys.length || !Number.isFinite(energy) || !Number.isFinite(happy)) return null;
    if (keys.some(k => !gymByStat[k])) return null;
    const eligible = keys.map((k, i) => completed.has(k) ? -1 : i).filter(i => i >= 0);
    const minEnergy = eligible.length ? Math.min(...eligible.map(i => gymByStat[keys[i]].energy)) : Infinity;
    if (!Number.isInteger(energy) || energy < 0 || (eligible.length && energy / minEnergy > 1500)) return null;
    const averageHappy = eligible.length
      ? Math.max(0, happy - Math.floor(energy / minEnergy) * minEnergy * 0.25)
      : happy;
    const projections = keys.map(k => {
      const gym = gymByStat[k];
      const values = [stats[k]];
      for (let n = 1; n <= (completed.has(k) ? 0 : Math.floor(energy / gym.energy)); n++) {
        values.push(values[n - 1] + estimatedGain(values[n - 1], averageHappy, gym.dots[k], gym.energy) * (factors[k] ?? 1));
      }
      return values;
    });
    const costs = keys.map(k => gymByStat[k].energy);
    const evaluate = counts => {
      const values = counts.map((n, i) => projections[i][n]);
      const sum = values.reduce((a, b) => a + b, 0);
      return sum ? values.reduce((err, v, i) => err + (v / sum - target[keys[i]] / 100) ** 2, 0) : Infinity;
    };
    let best = null;
    const consider = counts => {
      const spent = counts.reduce((sum, count, i) => sum + count * costs[i], 0);
      if (spent > energy) return;
      const error = evaluate(counts);
      if (!best || spent > best.spent ||
          (spent === best.spent && error < best.error - 1e-12)) {
        best = { counts: counts.slice(), error, spent };
      }
    };
 
    // Completed stats stay in the ratio calculation, but receive zero more trains.
    const zeros = () => keys.map(() => 0);
    if (eligible.length === 0) {
      consider(zeros());
    } else if (eligible.length === 1) {
      const counts = zeros();
      const i = eligible[0];
      counts[i] = Math.floor(energy / costs[i]);
      consider(counts);
    } else if (eligible.length === 2) {
      const [i, j] = eligible;
      for (let a = 0; a <= Math.floor(energy / costs[i]); a++) {
        const counts = zeros();
        counts[i] = a;
        counts[j] = Math.floor((energy - a * costs[i]) / costs[j]);
        consider(counts);
      }
    } else if (eligible.length === 3) {
      const [i, j, k] = eligible;
      for (let a = 0; a <= Math.floor(energy / costs[i]); a++) {
        for (let b = 0; b <= Math.floor((energy - a * costs[i]) / costs[j]); b++) {
          const counts = zeros();
          counts[i] = a;
          counts[j] = b;
          counts[k] = Math.floor((energy - a * costs[i] - b * costs[j]) / costs[k]);
          consider(counts);
        }
      }
    } else {
      // Four-stat targets: greedy allocation with local improvements.
      const counts = zeros();
      let spent = 0;
      while (spent + minEnergy <= energy) {
        let choice = -1, choiceError = Infinity;
        for (const i of eligible) {
          if (spent + costs[i] > energy) continue;
          counts[i]++;
          const error = evaluate(counts);
          counts[i]--;
          if (error < choiceError) { choiceError = error; choice = i; }
        }
        if (choice < 0) break;
        counts[choice]++;
        spent += costs[choice];
      }
      consider(counts);
    }
    return best ? { keys, counts: best.counts, used: best.spent, unused: energy - best.spent,
      gyms: gymByStat } : null;
  }
 
  function confirmedTraining(before, after, key) {
    return before && after &&
      Number.isFinite(before.energy) && Number.isFinite(after.energy) &&
      Number.isFinite(before.stats?.[key]) && Number.isFinite(after.stats?.[key]) &&
      after.energy < before.energy && after.stats[key] > before.stats[key] + 1e-6;
  }
 
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { validTarget, proportions, estimatedGain, bestGyms, planTrains, GYM_BY_NAME, scanUnlocked, parseGymPerks, previewGain, confirmedTraining, ALL_STATS };
  }
  if (typeof document === 'undefined') return;
 
  let apiKey = '';
  try { apiKey = localStorage.getItem(API_KEY_KEY) || ''; } catch (_) {}
  let perks = null;
  let perkUpdatedAt = 0;
  let perkBusy = false;
  let perkError = '';
 
  function activeKey() {
    const pdaAvailable = /^[a-z0-9]{16}$/i.test(PDA_KEY);
    return pdaAvailable ? PDA_KEY : apiKey;
  }
 
  async function loadPerks(force = false) {
    const key = activeKey();
    if (!/^[a-z0-9]{16}$/i.test(key)) {
      perkError = 'Perks unavailable: API key not connected';
      refresh();
      return;
    }
    if (perkBusy || (!force && perks && Date.now() - perkUpdatedAt < PERK_REFRESH_MS)) return;
    perkBusy = true;
    perkError = '';
    const url = 'https://api.torn.com/v2/user/perks?comment=LikidyGym';
    try {
      let payload;
      if (typeof PDA_httpGet === 'function') {
        const reply = await PDA_httpGet(url, { Authorization: `ApiKey ${key}` });
        if (Number(reply?.status) !== 200) throw Error(`HTTP ${reply?.status ?? '?'}`);
        payload = JSON.parse(reply.responseText);
      } else if (typeof GM_xmlhttpRequest === 'function') {
        payload = await new Promise((resolve, reject) => {
          GM_xmlhttpRequest({
            method: 'GET', url,
            headers: { Authorization: `ApiKey ${key}` },
            timeout: 12000,
            onload: reply => {
              if (reply.status !== 200) return reject(Error(`HTTP ${reply.status}`));
              try { resolve(JSON.parse(reply.responseText)); }
              catch (_) { reject(Error('Invalid API JSON')); }
            },
            onerror: () => reject(Error('Network request failed')),
            ontimeout: () => reject(Error('Request timed out'))
          });
        });
      } else {
        const reply = await fetch(url, { headers: { Authorization: `ApiKey ${key}` } });
        if (!reply.ok) throw Error(`HTTP ${reply.status}`);
        payload = await reply.json();
      }
      if (payload?.error) throw Error(`Torn API ${payload.error.code ?? 'error'}`);
      perks = parseGymPerks(payload);
      perkUpdatedAt = Date.now();
      perkError = perks.unknown.length
        ? `${perks.unknown.length} gym perk(s) could not be parsed; estimates are partial`
        : '';
      previousSignature = '';
    } catch (error) {
      perkError = `Perks unavailable: ${error.message}`;
      perks = null;
      perkUpdatedAt = 0;
      previousSignature = '';
    } finally {
      perkBusy = false;
      refresh();
    }
  }
 
  function readStat(key) {
    const tile = document.querySelector(`li[class*="${key}___"]`);
    const value = tile?.querySelector('[class*="propertyValue"], .stat-value');
    if (value) return parseNumber(value.textContent);
    for (const block of document.querySelectorAll('[class*="propertyTitle"]')) {
      if (block.querySelector('h3')?.textContent.trim().toLowerCase() !== key) continue;
      return parseNumber(block.parentElement?.querySelector('[class*="propertyValue"]')?.textContent);
    }
    return null;
  }
 
  function readCurrentPage() {
    const stats = Object.fromEntries(ALL_STATS.map(key => [key, readStat(key)]));
    // Exclude our own UI from the body text so messages cannot be mistaken for game data.
    const text = document.body.innerText || '';
    const energyText = text.match(/\byou have\s+([\d,]+)\s*\/\s*([\d,]+)\s+energy available\b/i);
    const fallbackEnergy = text.match(/\bEnergy\s*:\s*([\d,]+)\s*\/\s*([\d,]+)/i);
    const happyText = text.match(/\bHapp(?:y|iness)\s*:?\s*([\d,]+)\s*\/\s*([\d,]+)/i);
    const gymText = text.match(/\bWelcome to\s+([^!\n]{2,60})!/i);
    const gymName = gymText?.[1]?.trim().toLowerCase() || '';
    const gym = GYM_BY_NAME.get(gymName) || null;
    return { stats, energy: parseNumber((energyText || fallbackEnergy)?.[1]),
      happy: parseNumber(happyText?.[1]), gym, gymName };
  }
 
  function createPanel() {
    let panel = document.getElementById(PANEL_ID);
    if (panel) return panel;
    const row = document.querySelector('li[class*="strength___"]');
    const list = row?.closest('ul');
    if (!list) return null;
    panel = document.createElement('section');
    panel.id = PANEL_ID;
    panel.setAttribute('aria-label', "Likidy's Gym Advisor");
    panel.innerHTML = `
      <div class="tga-head">
        <strong>Likidy's Gym Advisor</strong>
        <div class="tga-meta"></div>
        <details class="tga-settings"><summary>Settings</summary><div class="tga-form"></div></details>
      </div>
      <div class="tga-summary"><div class="tga-targets"></div><div class="tga-perks"></div></div>
      <div class="tga-grid"></div><div class="tga-alloc"></div>`;
    const next = list.nextElementSibling;
    const isResult = next && next.textContent.trim().length < 300 &&
      /what would you like to train|you gained/i.test(next.textContent);
    (isResult ? next : list).insertAdjacentElement('afterend', panel);
    buildSettings(panel);
    return panel;
  }
 
  function buildSettings(panel) {
    const form = panel.querySelector('.tga-form');
    form.innerHTML = `<div class="tga-fields">${ALL_STATS.map(k => `
      <label class="tga-field"><input type="checkbox" data-stat="${k}" ${target[k] > 0 ? 'checked' : ''}>
      <span>${k[0].toUpperCase() + k.slice(1)}</span>
      <input type="number" data-percent="${k}" min="0" max="100" step="1" value="${target[k]}"><span>%</span></label>`).join('')}</div>
      <label class="tga-override"><input type="checkbox" class="tga-allow-any" ${allowAnyTraining ? 'checked' : ''}>
        Unlock all stats / gyms</label>
      <small class="tga-override-note">Applies immediately. Allows manual training in any owned gym; only Advisor restrictions are lifted. Torn and TornTools restrictions remain.</small>
      <div class="tga-key-row"><label>Torn API key for perk estimates<br><input type="password" class="tga-api-key" autocomplete="off" placeholder="16-character key" value=""></label>
      <button type="button" class="tga-perks-refresh">Load perks</button><button type="button" class="tga-key-clear">Clear key</button></div>
      <div class="tga-actions"><button type="button" class="tga-save">Save</button><span role="status" class="tga-error"></span></div>`;
    const keyInput = form.querySelector('.tga-api-key');
    if (/^[a-z0-9]{16}$/i.test(PDA_KEY)) {
      keyInput.placeholder = 'Using PDA API key';
      keyInput.disabled = true;
    } else if (apiKey) {
      keyInput.placeholder = 'Key saved; enter a new key to replace';
    }
    form.querySelector('.tga-allow-any').addEventListener('change', event => {
      allowAnyTraining = event.target.checked;
      if (!allowAnyTraining) manualEdits.clear();
      try { localStorage.setItem(ADVISOR_UNLOCK_KEY, String(allowAnyTraining)); } catch (_) {}
      previousSignature = '';
      refresh();
    });
    form.querySelector('.tga-perks-refresh').addEventListener('click', () => {
      const typed = keyInput.value.trim();
      if (typed) {
        if (!/^[a-z0-9]{16}$/i.test(typed)) {
          form.querySelector('.tga-error').textContent = 'API key must be 16 characters.';
          return;
        }
        apiKey = typed;
        try { localStorage.setItem(API_KEY_KEY, apiKey); } catch (_) {}
        perks = null;
        perkUpdatedAt = 0;
        keyInput.value = '';
        keyInput.placeholder = 'Key saved; enter a new key to replace';
      }
      form.querySelector('.tga-error').textContent = '';
      loadPerks(true);
    });
    form.querySelector('.tga-key-clear').addEventListener('click', () => {
      apiKey = '';
      perks = null;
      perkUpdatedAt = 0;
      perkError = 'Perks unavailable: API key not connected';
      keyInput.value = '';
      try { localStorage.removeItem(API_KEY_KEY); } catch (_) {}
      previousSignature = '';
      refresh();
    });
    form.querySelector('.tga-save').addEventListener('click', () => {
      const candidate = {};
      for (const key of ALL_STATS) {
        const on = form.querySelector(`[data-stat="${key}"]`).checked;
        const input = form.querySelector(`[data-percent="${key}"]`);
        const value = Number(input.value);
        candidate[key] = on && input.value.trim() ? value : 0;
      }
      const error = form.querySelector('.tga-error');
      if (!validTarget(candidate) || ALL_STATS.some(k =>
        form.querySelector(`[data-stat="${k}"]`).checked && candidate[k] <= 0)) {
        error.textContent = 'Selected percentages must total 100%.';
        return;
      }
      target = candidate;
      // Changing the ratio starts a new recommendation batch.
      completedThisBatch.clear();
      pendingTraining.clear();
      autoAttempts.clear();
      manualEdits.clear();
      try { localStorage.setItem(TARGET_KEY, JSON.stringify(target)); } catch (_) {}
      error.textContent = '';
      panel.querySelector('.tga-settings').open = false;
      buildSettings(panel);
      previousSignature = '';
      refresh();
    });
    for (const key of ALL_STATS) {
      const check = form.querySelector(`[data-stat="${key}"]`);
      const amount = form.querySelector(`[data-percent="${key}"]`);
      check.addEventListener('change', () => {
        if (check.checked && Number(amount.value) === 0) amount.value = '1';
        if (!check.checked) amount.value = '0';
      });
    }
  }
 
  // Native Torn gym counts are separate from Advisor settings inputs.
  const nativeCounts = new WeakMap();
  const autoAttempts = new Map();
  const manualEdits = new Map();
  const completedThisBatch = new Set();
  const pendingTraining = new Map();
  let lastObservedEnergy = null;
  let updatingNative = false;
  let lastNativeData = null;
  let lastNativePlan = null;
  let lastNativePicks = null;
 
  function pageContext(page) {
    return JSON.stringify({ gym: page.gym?.id, energy: page.energy,
      happy: page.happy, stats: page.stats });
  }
 
  function statTile(key) {
    return document.querySelector(`#gymroot ul[class*="properties_"] > li[class*="${key}___"]`) ||
      document.querySelector(`#gymroot li[class*="${key}___"]`);
  }
 
  function findNativeCount(tile) {
    if (!tile) return null;
    const inputs = [...tile.querySelectorAll('input')].filter(el =>
      !el.disabled && !el.readOnly &&
      ['number', 'text', 'tel'].includes(el.type) &&
      !el.closest(`#${PANEL_ID}`));
    // If Torn changes to multiple count fields, do not risk populating the wrong one.
    return inputs.length === 1 ? inputs[0] : null;
  }
 
  function nativeCountValue(input) {
    const text = input?.value?.trim();
    if (!text || !/^\d+$/.test(text)) return null;
    const count = Number(text);
    return Number.isSafeInteger(count) && count <= 1500 ? count : null;
  }
 
  function fillCount(input, value) {
    // React-controlled input: use the native setter so its input handler can observe it.
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (!setter) return false;
    updatingNative = true;
    try {
      setter.call(input, String(value));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      // No click, submit, train request or change of gym.
      return input.value === String(value);
    } finally {
      updatingNative = false;
    }
  }
 
  function trackTrainingCompletion(page) {
    // A meaningful energy gain begins a new batch. Ignore single-E regeneration.
    if (Number.isFinite(lastObservedEnergy) && Number.isFinite(page.energy) &&
        page.energy - lastObservedEnergy >= Math.max(20, 2 * (page.gym?.energy ?? 10))) {
      completedThisBatch.clear();
      pendingTraining.clear();
      autoAttempts.clear();
      manualEdits.clear();
    }
    if (Number.isFinite(page.energy)) lastObservedEnergy = page.energy;
 
    for (const [key, intent] of pendingTraining) {
      if (Date.now() - intent.at > 30000) {
        pendingTraining.delete(key);
      } else if (confirmedTraining(intent.before, page, key)) {
        completedThisBatch.add(key);
        pendingTraining.delete(key);
        autoAttempts.delete(key);
        manualEdits.delete(key);
      }
    }
  }
 
  function updateGainLabel(key, page) {
    const tile = statTile(key);
    if (!tile) return;
    const input = findNativeCount(tile);
    const count = nativeCountValue(input);
    const gain = count === null ? null : previewGain(
      page.stats[key], page.happy, page.gym, key, count, perks?.factors ?? ZERO_PERKS);
    if (gain === null) {
      tile.removeAttribute('data-tga-gain');
      return;
    }
    const cost = count * page.gym.energy;
    const shortfall = cost > page.energy ? ' · exceeds available E' : '';
    tile.setAttribute('data-tga-gain',
      `Est. +${formatGain(gain)} ${ABBR[key]}${shortfall}`);
  }
 
  function updateNativeCounts(page, plan, picks) {
    lastNativeData = page;
    lastNativePlan = plan;
    lastNativePicks = picks;
    const scene = pageContext(page);
    for (const key of ALL_STATS) {
      const tile = statTile(key);
      const input = findNativeCount(tile);
      if (!input) {
        if (tile) tile.removeAttribute('data-tga-gain');
        continue;
      }
      const index = plan?.keys.indexOf(key) ?? -1;
      const suggested = index >= 0 ? plan.counts[index] : 0;
      const currentGymIsBest = !!page.gym && picks?.[key]?.id === page.gym.id;
      const mayFill = !completedThisBatch.has(key) && !pendingTraining.has(key) &&
        suggested > 0 && currentGymIsBest &&
        !restricted.has(key) && !input.disabled && !input.readOnly;
      // Zero is a valid recommendation. Torn can retain manually entered counts
      // across page loads, so reset stale inputs when the plan recommends zero.
      // The manualEdits guard below preserves edits made in this page session.
      const shouldZero = ((!allowAnyTraining && target[key] === 0) ||
        (completedThisBatch.has(key) && !(allowAnyTraining && manualEdits.has(key))) ||
        (plan && suggested === 0)) &&
        !input.disabled && !input.readOnly;
      const context = JSON.stringify({
        scene, target, suggested, allowed: mayFill, zeroExcluded: shouldZero,
        completed: completedThisBatch.has(key),
        factors: perks?.factors ?? ZERO_PERKS
      });
      if (!allowAnyTraining && manualEdits.get(key) && manualEdits.get(key) !== scene) {
        manualEdits.delete(key);
      }
      let history = nativeCounts.get(input);
      if (!history) {
        history = { context: null, manual: document.activeElement === input };
        nativeCounts.set(input, history);
      }
      if (history.context !== context || (shouldZero && nativeCountValue(input) !== 0)) {
        const recent = autoAttempts.get(key);
        const recentlyTried = recent?.context === context &&
          Date.now() - recent.at < 10000;
        const alreadyTried = recentlyTried &&
          (recent.input === input || recent.count >= 3);
        const activelyEditing = document.activeElement === input;
        if (!activelyEditing && !alreadyTried && !manualEdits.has(key) &&
            (shouldZero || mayFill)) {
          const nextCount = shouldZero ? 0 : suggested;
          if (nativeCountValue(input) !== nextCount) {
            autoAttempts.set(key, { context, at: Date.now(), input,
              count: recentlyTried ? recent.count + 1 : 1 });
            fillCount(input, nextCount);
            history.manual = false;
          }
        }
        history.context = context;
      }
      updateGainLabel(key, page);
    }
  }
 
  document.addEventListener('input', event => {
    if (updatingNative || !(event.target instanceof HTMLInputElement)) return;
    const tile = event.target.closest('li[class*="strength___"], li[class*="defense___"], li[class*="speed___"], li[class*="dexterity___"]');
    if (!tile || findNativeCount(tile) !== event.target) return;
    const key = ALL_STATS.find(k => tile.className.includes(`${k}___`));
    if (!key) return;
    const history = nativeCounts.get(event.target);
    if (history) history.manual = true;
    if (lastNativeData) {
      manualEdits.set(key, pageContext(lastNativeData));
      updateGainLabel(key, lastNativeData);
    }
  }, true);
 
  let previousSignature = '';
  let refreshHandle = null;
  let restricted = new Set();
  // Keep ownership separate from Torn and TornTools so their own disabled states survive.
  const buttonsDisabledByAdvisor = new WeakMap();
 
  function protectTrainControls(page, best, canVerify) {
    restricted = new Set();
    for (const key of ALL_STATS) {
      const tile = document.querySelector(`#gymroot ul[class*="properties_"] > li[class*="${key}___"]`) ||
        document.querySelector(`#gymroot li[class*="${key}___"]`);
      if (!tile) continue;
      const excluded = target[key] === 0;
      const betterElsewhere = canVerify && page.gym && best[key] &&
        best[key].dots[key] > page.gym.dots[key] + 0.00001;
      const block = !allowAnyTraining && !!(excluded || betterElsewhere);
      tile.classList.toggle('tga-blocked', block);
      if (block) restricted.add(key);
 
      // TornTools uses a real disabled button, not just a grey overlay. Do the same.
      // Leave TornTools' checkbox and saved preferences entirely under TornTools' control.
      const button = tile.querySelector('button.torn-btn') ||
        [...tile.querySelectorAll('button')].find(el => /^train$/i.test(el.textContent.trim()));
      if (!button) continue;
      if (block) {
        if (!buttonsDisabledByAdvisor.has(button)) {
          buttonsDisabledByAdvisor.set(button, { wasDisabled: button.disabled });
        }
        if (!button.disabled) button.disabled = true;
      } else if (buttonsDisabledByAdvisor.has(button)) {
        const { wasDisabled } = buttonsDisabledByAdvisor.get(button);
        buttonsDisabledByAdvisor.delete(button);
        const ttLocked = tile.classList.contains('tt-gym-locked') ||
          tile.querySelector('.tt-stat-checkbox')?.checked === true;
        const nativeLocked = [...tile.classList].some(name => /^locked___/.test(name));
        const canTrain = page.gym && page.gym.dots[key] > 0 &&
          Number.isFinite(page.energy) && page.energy >= page.gym.energy;
        // Restore only buttons that were enabled before *we* disabled them.
        if (!wasDisabled && !ttLocked && !nativeLocked && canTrain && button.disabled) {
          button.disabled = false;
        }
      }
    }
  }
 
  // Defense in depth for controls rebuilt during a Torn redraw. Do not intercept
  // TornTools' own checkbox, which remains independently user-controlled.
  document.addEventListener('click', event => {
    const control = event.target.closest?.('button, [role="button"]');
    const tile = control?.closest('li[class*="strength___"],li[class*="speed___"],li[class*="defense___"],li[class*="dexterity___"]');
    if (!tile) return;
    const key = ALL_STATS.find(stat => tile.className.includes(`${stat}___`));
    if (!key) return;
    if (restricted.has(key)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    // Only clicking an enabled Train button creates a candidate completion.
    // Neither a click nor a success banner is enough without E and stat changes.
    if (control?.tagName === 'BUTTON' && !control.disabled &&
        /^train$/i.test(control.textContent.trim())) {
      const before = readCurrentPage();
      if (Number.isFinite(before.energy) && Number.isFinite(before.stats[key])) {
        pendingTraining.set(key, { before, at: Date.now() });
      }
    }
  }, true);
 
  function paint(panel, data, best, verified) {
    const { stats, energy, happy, gym } = data;
    const keys = selected();
    panel.querySelector('.tga-meta').innerHTML = `${gym ? `${gym.name} · ${gym.energy} E/train` : 'Gym not recognized'} · <b>${Number.isFinite(energy) ? energy : '?'} E available</b>`;
    panel.querySelector('.tga-targets').textContent = keys.map(k => `${target[k]}% ${ABBR[k]}`).join(' · ');
    panel.querySelector('.tga-perks').textContent =
      (perks ? 'Perks: ' + keys.map(k => `${ABBR[k]} ×${perks.factors[k].toFixed(3)}`).join(' ') :
        'Perks not loaded') + (perkError ? ' · ' + perkError : '');
    const present = keys.every(k => Number.isFinite(stats[k])) && Number.isFinite(energy);
    const grid = panel.querySelector('.tga-grid');
    grid.style.setProperty('--tga-columns', String(keys.length));
    const alloc = panel.querySelector('.tga-alloc');
    if (!present) {
      grid.textContent = '';
      alloc.textContent = 'Waiting for visible battle stats and energy.';
      for (const key of ALL_STATS) statTile(key)?.removeAttribute('data-tga-gain');
      return;
    }
    const shares = proportions(stats, keys);
    grid.innerHTML = keys.map(k => {
      const pct = shares[k] * 100;
      return `<div class="tga-stat"><div>${k[0].toUpperCase() + k.slice(1)}</div>
        <strong>${pct.toFixed(2)}%</strong><div class="tga-track"><div style="background:${COLORS[k]};width:${Math.min(100, pct / target[k] * 100)}%"></div></div></div>`;
    }).join('');
    if (!gym || !Number.isFinite(happy)) {
      alloc.textContent = 'Training recommendation unavailable.';
      updateNativeCounts(data, null, null);
      return;
    }
    const picks = Object.fromEntries(keys.map(k => [k, verified ? best[k] : gym.dots[k] > 0 ? gym : null]));
    const plan = planTrains(stats, happy, energy, picks, perks?.factors ?? ZERO_PERKS, completedThisBatch);
    if (!plan) { alloc.textContent = 'Training allocation unavailable.'; updateNativeCounts(data, null, null); return; }
    if (!plan.used) {
      alloc.textContent = keys.every(k => completedThisBatch.has(k))
        ? 'Suggested trains completed. Waiting for new energy.'
        : 'Not enough energy to train.';
      updateNativeCounts(data, plan, picks);
      return;
    }
    alloc.innerHTML = plan.keys.map((k, i) => {
      const count = plan.counts[i];
      const where = verified && picks[k]?.id !== gym.id && count > 0 ? ` <small>(${picks[k].name})</small>` : '';
      const done = completedThisBatch.has(k) ? ' <small>(done)</small>' : '';
      return `<span>${ABBR[k]} <b>${count} trains</b>${where}${done}</span>`;
    }).join('') + (plan.unused ? `<small>${plan.unused} E unused</small>` : '');
    updateNativeCounts(data, plan, picks);
  }
 
  function refresh() {
    if (document.hidden) return;
    const panel = createPanel();
    if (!panel) return;
    const data = readCurrentPage();
    trackTrainingCompletion(data);
    const scan = scanUnlocked(data.gym);
    const best = scan.verified ? bestGyms(scan.gyms) : {};
    const signature = JSON.stringify({ data, target,
      perkFactors: perks?.factors ?? null, perkError,
      completed: [...completedThisBatch].sort(), allowAnyTraining,
      unlocked: scan.verified ? [...scan.gyms].sort((a,b) => a-b) : null });
    protectTrainControls(data, best, scan.verified);
    if (signature === previousSignature && panel.querySelector('.tga-targets').textContent) {
      updateNativeCounts(data, lastNativePlan, lastNativePicks);
      return;
    }
    previousSignature = signature;
    paint(panel, data, best, scan.verified);
  }
 
  function scheduleRefresh() {
    if (refreshHandle) return;
    refreshHandle = setTimeout(() => { refreshHandle = null; refresh(); }, 120);
  }
 
  const style = document.createElement('style');
  style.textContent = `
    #${PANEL_ID}{box-sizing:border-box;background:#202224;color:#ececec;border:1px solid #3a3d40;
      border-radius:5px;padding:9px 12px;margin:7px 0;font:13px/1.4 Arial,sans-serif}
    #${PANEL_ID} *{box-sizing:border-box}
    #${PANEL_ID} .tga-head{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);align-items:center;gap:8px}
    #${PANEL_ID} .tga-head strong{font-size:13px;min-width:0}
    #${PANEL_ID} .tga-head .tga-meta{text-align:center;white-space:nowrap;margin:0}
    #${PANEL_ID} .tga-settings{position:relative;justify-self:end}
    #${PANEL_ID} .tga-settings summary{cursor:pointer;color:#b5bcc5;font-size:12px;list-style:none;user-select:none}
    #${PANEL_ID} .tga-settings summary::before{content:'⚙ ';font-size:12px}
    #${PANEL_ID} .tga-settings summary::-webkit-details-marker{display:none}
    #${PANEL_ID} .tga-form{position:absolute;right:0;top:25px;width:270px;max-width:80vw;z-index:10;
      background:#24272a;border:1px solid #656d76;border-radius:5px;padding:10px;box-shadow:0 7px 24px #0009}
    #${PANEL_ID} .tga-fields{display:grid;gap:6px}
    #${PANEL_ID} .tga-field{display:grid;grid-template-columns:17px 1fr 57px 12px;align-items:center;gap:7px;cursor:pointer}
    #${PANEL_ID} .tga-field input[type=number]{width:100%;background:#181a1c;color:#f5f5f5;border:1px solid #59626b;border-radius:3px;padding:4px}
    #${PANEL_ID} .tga-override{display:flex;align-items:center;gap:7px;margin-top:10px;cursor:pointer;font-size:12px}
    #${PANEL_ID} .tga-override input{cursor:pointer}
    #${PANEL_ID} .tga-override-note{display:block;font-size:10px;color:#aeb8c2;margin:3px 0 6px}
    #${PANEL_ID} .tga-key-row{display:flex;flex-wrap:wrap;align-items:end;gap:5px;margin-top:10px}
    #${PANEL_ID} .tga-key-row label{flex:1 1 100%;font-size:11px;color:#b5bcc5}
    #${PANEL_ID} .tga-api-key{background:#181a1c;color:#fff;padding:5px;width:100%;margin-top:3px;border:1px solid #59626b}
    #${PANEL_ID} .tga-key-row button{background:#373f49;color:#fff;border:1px solid #657180;border-radius:4px;padding:4px 8px;cursor:pointer}
    #${PANEL_ID} .tga-actions{display:flex;align-items:center;gap:8px;margin-top:10px}
    #${PANEL_ID} .tga-save{background:#373f49;color:white;border:1px solid #657180;border-radius:4px;padding:4px 13px;cursor:pointer}
    #${PANEL_ID} .tga-error{color:#ff8d8d;font-size:11px}
    #${PANEL_ID} .tga-meta,#${PANEL_ID} .tga-targets,#${PANEL_ID} .tga-perks{color:#b5bcc5;font-size:12px}
    #${PANEL_ID} .tga-summary{display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:3px 16px;margin:5px 0 8px}
    #${PANEL_ID} .tga-targets{flex:0 1 auto}
    #${PANEL_ID} .tga-perks{flex:0 1 auto;margin-left:auto;text-align:right}
    #${PANEL_ID} .tga-grid{display:grid;grid-template-columns:repeat(var(--tga-columns,3),minmax(0,1fr));gap:10px;margin-bottom:7px}
    #${PANEL_ID} .tga-stat strong{font-size:17px}
    #${PANEL_ID} .tga-track{height:5px;background:#42464a;border-radius:5px;overflow:hidden;margin-top:5px}
    #${PANEL_ID} .tga-track>div{height:100%;border-radius:5px}
    #${PANEL_ID} .tga-alloc{display:flex;flex-wrap:wrap;gap:5px 16px;border-top:1px solid #3a3d40;padding-top:8px}
    #${PANEL_ID} .tga-alloc small{font-size:11px;color:#a9b2bd}
    /* CSS-generated previews avoid replacing any React-managed gym children. */
    #gymroot li[data-tga-gain]{position:relative;padding-bottom:23px!important}
    #gymroot li[data-tga-gain]::after{
      content:attr(data-tga-gain);position:absolute;left:9px;right:9px;bottom:4px;
      color:#b2dfba;font:11px/1.3 Arial,sans-serif;text-align:center;pointer-events:none;
      white-space:nowrap;overflow:hidden;text-overflow:ellipsis
    }
    /* Dim the entire stat tile while disabling its real Train button. */
    #gymroot li.tga-blocked{filter:grayscale(1)!important;opacity:.38!important;cursor:not-allowed}
    #gymroot li.tga-blocked button{cursor:not-allowed!important}
    #gymroot li.tga-blocked input.tt-stat-checkbox{cursor:pointer!important}
    @media(max-width:620px){
      #${PANEL_ID} .tga-head{grid-template-columns:minmax(0,1fr) auto}
      #${PANEL_ID} .tga-head .tga-meta{grid-column:1 / -1;grid-row:2;text-align:center;white-space:normal}
      #${PANEL_ID} .tga-grid{gap:5px}
      #${PANEL_ID} .tga-stat strong{font-size:14px}
    }
  `;
  document.head.appendChild(style);
  refresh();
  if (/^[a-z0-9]{16}$/i.test(activeKey())) loadPerks();
  else { perkError = 'Perks unavailable: API key not connected'; refresh(); }
  setInterval(() => {
    if (!document.hidden && /^[a-z0-9]{16}$/i.test(activeKey())) loadPerks();
  }, PERK_REFRESH_MS);
  new MutationObserver(records => {
    if (records.some(record => {
      const node = record.target.nodeType === 1 ? record.target : record.target.parentElement;
      return !node?.closest?.(`#${PANEL_ID}`);
    })) scheduleRefresh();
  }).observe(document.body, { childList: true, characterData: true, subtree: true });
  document.addEventListener('visibilitychange', scheduleRefresh);
})();