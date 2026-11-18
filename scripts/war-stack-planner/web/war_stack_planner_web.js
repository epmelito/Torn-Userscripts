// ==UserScript==
// @name         Likidy's War Stack Planner
// @namespace    local.torn.warstack.web
// @version      0.3.6
// @license      MIT
// @description  Desktop war stack planner with per-war tracking, Xanax logs and conservative scheduling.
// @match        https://www.torn.com/*
// @match        https://torn.com/*
// @connect      api.torn.com
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @run-at       document-idle
// ==/UserScript==
 
(() => {
  'use strict';
 
  const HOUR = 3600000;
  const MINUTE = 60000;
  const COOLDOWN = 8 * HOUR;
  const FRESH_MS = 5 * MINUTE;
  const SETTINGS_KEY = 'likidy-warstack-web-settings-v1';
  const POSITION_KEY = 'likidy-warstack-web-position-v1';
  const TRACK_KEY = 'likidy-warstack-web-tracker-v1';
  const OBS_KEY = 'likidy-warstack-web-last-observation-v1';
  const LOG_KEY = 'likidy-warstack-web-dose-logs-v1';
  const API_KEY_KEY = 'likidy-warstack-web-api-key-v1';
  const PANEL_ID = 'likidy-warstack-web';
  const defaults = {
    targetEnergy: 1000,
    offsetHours: 0,
    sleepStart: '02:00',
    sleepEnd: '08:00',
    manualWar: ''
  };
 
  function parseClock(value) {
    const match = /^(\d\d):(\d\d)$/.exec(value);
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
  }
 
  function validSettings(s) {
    return !!s && Number.isInteger(s.targetEnergy) &&
      s.targetEnergy >= 1 && s.targetEnergy <= 1000 &&
      Number.isFinite(s.offsetHours) && s.offsetHours >= -168 &&
      s.offsetHours <= 168 && parseClock(s.sleepStart) !== null &&
      parseClock(s.sleepEnd) !== null && typeof s.manualWar === 'string' &&
      (!s.manualWar || Number.isFinite(new Date(s.manualWar).getTime()));
  }
 
  function minuteOfDay(ms) {
    const d = new Date(ms);
    return d.getHours() * 60 + d.getMinutes();
  }
 
  function localClock(ms, minutes, days = 0) {
    const d = new Date(ms);
    d.setDate(d.getDate() + days);
    d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
    return d.getTime();
  }
 
  function asleep(ms, sleep) {
    if (sleep.start === sleep.end) return false;
    const m = minuteOfDay(ms);
    return sleep.start < sleep.end
      ? m >= sleep.start && m < sleep.end
      : m >= sleep.start || m < sleep.end;
  }
 
  function awakeAfter(ms, sleep) {
    const t = Math.ceil(ms / MINUTE) * MINUTE;
    if (!asleep(t, sleep)) return t;
    const tomorrow = sleep.start > sleep.end && minuteOfDay(t) >= sleep.start;
    return localClock(t, sleep.end, tomorrow ? 1 : 0);
  }
 
  function awakeBefore(ms, sleep) {
    const t = Math.floor(ms / MINUTE) * MINUTE;
    if (!asleep(t, sleep)) return t;
    const yesterday = sleep.start > sleep.end && minuteOfDay(t) < sleep.end;
    return localClock(t, sleep.start, yesterday ? -1 : 0) - MINUTE;
  }
 
  function sleepFrom(cfg) {
    return { start: parseClock(cfg.sleepStart), end: parseClock(cfg.sleepEnd) };
  }
 
  function futureDoses(first, count, sleep) {
    if (count <= 0) return [];
    const doses = [awakeAfter(first, sleep)];
    while (doses.length < count) {
      doses.push(awakeAfter(doses[doses.length - 1] + COOLDOWN, sleep));
    }
    return doses;
  }
 
  function preStackPlan(now, warAt, cfg, cooldownSec) {
    const sleep = sleepFrom(cfg);
    const deadline = warAt + cfg.offsetHours * HOUR;
    const count = Math.ceil(cfg.targetEnergy / 250);
    const latest = Array(count);
    let bound = deadline - COOLDOWN;
    for (let i = count - 1; i >= 0; i--) {
      latest[i] = awakeBefore(bound, sleep);
      bound = latest[i] - COOLDOWN;
    }
    const eligible = awakeAfter(now + cooldownSec * 1000, sleep);
    const doses = futureDoses(Math.max(eligible, latest[0]), count, sleep);
    const ready = doses[count - 1] + COOLDOWN;
    return {
      kind: 'pre', deadline, latestStart: latest[0],
      lastRegular: awakeBefore(latest[0] - COOLDOWN, sleep),
      doses, ready, remaining: count, projectedEnergy: count * 250,
      feasible: eligible <= latest[0] && ready <= deadline, sleep
    };
  }
 
  function activePlan(now, warAt, cfg, energy, cooldownSec) {
    const sleep = sleepFrom(cfg);
    const deadline = warAt + cfg.offsetHours * HOUR;
    const remaining = Math.ceil(Math.max(0, cfg.targetEnergy - energy) / 250);
    const available = remaining
      ? awakeAfter(now + cooldownSec * 1000, sleep)
      : null;
 
    // Work backwards for the latest safe dose time. Only the current cooldown
    // is known. Every cooldown after a future dose is conservatively 8h.
    const backwards = Array(remaining);
    let bound = deadline - COOLDOWN;
    for (let i = remaining - 1; i >= 0; i--) {
      backwards[i] = awakeBefore(bound, sleep);
      bound = backwards[i] - COOLDOWN;
    }
 
    const latestSafe = remaining ? backwards[0] : null;
    const windowFeasible = remaining === 0 || available <= latestSafe;
    const first = remaining
      ? windowFeasible ? latestSafe : available
      : null;
    const doses = remaining ? futureDoses(first, remaining, sleep) : [];
    const ready = remaining
      ? doses[remaining - 1] + COOLDOWN
      : now + cooldownSec * 1000;
    const earliestDoses = remaining
      ? futureDoses(available, remaining, sleep)
      : [];
    const earliestReady = remaining
      ? earliestDoses[remaining - 1] + COOLDOWN
      : ready;
 
    return {
      kind: 'active', deadline, doses, ready, earliestReady,
      remaining, sleep,
      window: remaining ? { available, latestSafe } : null,
      projectedEnergy: Math.min(1000, energy + remaining * 250),
      feasible: windowFeasible && ready <= deadline
    };
  }
 
  function windowCrossesSleep(start, end, sleep) {
    if (sleep.start === sleep.end || end <= start) return false;
    const day = new Date(start);
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() - 1);
    for (let i = 0; i < 18 && day.getTime() <= end; i++) {
      const from = localClock(day.getTime(), sleep.start);
      const to = localClock(
        day.getTime(), sleep.end,
        sleep.end < sleep.start ? 1 : 0
      );
      if (from < end && to > start) return true;
      day.setDate(day.getDate() + 1);
    }
    return false;
  }
 
  function nearSleep(ms, sleep) {
    if (sleep.start === sleep.end) return null;
    let next = localClock(ms, sleep.start);
    if (next <= ms) next = localClock(ms, sleep.start, 1);
    const gap = next - ms;
    return gap <= 30 * MINUTE ? Math.max(1, Math.ceil(gap / MINUTE)) : null;
  }
 
  function validSnapshot(s) {
    return !!s && Number.isInteger(s.xanax) && s.xanax >= 0 &&
      Number.isInteger(s.overdoses) && s.overdoses >= 0 &&
      Number.isFinite(s.energy) && s.energy >= 0 &&
      Number.isFinite(s.max) && s.max > 0 &&
      Number.isFinite(s.cooldown) && s.cooldown >= 0 &&
      Number.isFinite(s.at) && s.at > 0;
  }
 
  function validTracker(t) {
    return !!t && t.v === 1 &&
      ['armed', 'active', 'disrupted'].includes(t.status) &&
      validSnapshot(t.last) && Array.isArray(t.events) &&
      Number.isInteger(t.uses) && t.uses >= 0 &&
      Number.isFinite(t.startedAt) &&
      typeof t.uncertain === 'boolean';
  }
 
  function beginTracker(s, war, adopt = false) {
    if (!validSnapshot(s)) throw new Error('Fresh complete API data required');
    if (!adopt && (s.energy !== 0 || s.cooldown !== 0)) {
      throw new Error('Require 0 E and clear drug cooldown to arm');
    }
    return {
      v: 1, status: adopt ? 'active' : 'armed',
      startedAt: s.at, last: { ...s }, uses: 0,
      uncertain: adopt, firstZeroObserved: !adopt,
      warId: war?.id ?? null, warAt: war?.at ?? null,
      events: [{
        kind: adopt ? 'adopt' : 'arm', at: s.at,
        note: adopt
          ? 'Adopted current energy; earlier doses cannot be verified.'
          : 'Zero energy and clear cooldown observed; awaiting first dose.'
      }]
    };
  }
 
  function reconcile(previous, s) {
    if (!validTracker(previous) || !validSnapshot(s)) {
      throw new Error('Invalid tracking state or API snapshot');
    }
    if (s.at <= previous.last.at) return previous;
 
    const t = { ...previous, events: previous.events.slice() };
    const old = previous.last;
    const uses = s.xanax - old.xanax;
    const ods = s.overdoses - old.overdoses;
 
    if (uses < 0 || ods < 0) {
      t.uncertain = true;
      t.status = 'disrupted';
      t.events.push({ kind: 'warning', at: s.at,
        note: 'API counters decreased. Tracking is not reconciled.' });
      // Keep the old baseline so a transient API regression cannot erase doses.
      t.events = t.events.slice(-20);
      return t;
    }
 
    if (uses > 0) {
      const previousUses = t.uses;
      t.uses += uses;
      const longGap = s.at - old.at > 10 * MINUTE;
      const gain = s.energy - old.energy;
      const consistent = uses === 1 && ods === 0 &&
        gain >= 200 && gain <= 300 && !longGap;
 
      if (uses > 1 || longGap || ods > 0 || !consistent) {
        t.uncertain = true;
      }
      if (previous.status === 'armed' && previousUses === 0 &&
          (old.energy !== 0 || s.at - old.at > 2 * MINUTE)) {
        t.firstZeroObserved = false;
        t.uncertain = true;
      }
      t.events.push({
        kind: 'use', at: s.at, since: old.at, count: uses,
        note: consistent
          ? 'Xanax counter increased; energy change supports a successful dose.'
          : 'Xanax use observed; precise dose time or outcome is unverified.'
      });
      if (t.status === 'armed') t.status = 'active';
    }
 
    if (ods > 0) {
      t.uncertain = true;
      t.status = 'disrupted';
      t.events.push({ kind: 'od', at: s.at, count: ods,
        note: 'Overdose counter increased; attribution to Xanax is not certain.' });
    } else if (uses === 0 && s.energy < old.energy &&
               previous.status !== 'armed') {
      t.events.push({ kind: 'energy', at: s.at,
        note: `Energy decreased from ${old.energy} to ${s.energy} E; plan recalculated.` });
    }
 
    if (t.status === 'armed') {
      // The most recent pre-dose reading, not the original arming value, matters.
      t.firstZeroObserved = s.energy === 0 && s.cooldown === 0;
    }
 
    t.last = { ...s };
    t.events = t.events.slice(-20);
    return t;
  }
 
  // A new installation may have no pre-dose baseline. Elevated energy
  // permits planning from current bars, but is NOT proof of Xanax use.
  function inferStack(previous, current, war) {
    if (!war || !validSnapshot(current)) return null;
    const prior = validSnapshot(previous) && previous.at < current.at
      ? previous : null;
    const increase = prior ? current.xanax - prior.xanax : 0;
    const odIncrease = prior ? current.overdoses - prior.overdoses : 0;
    const gap = prior ? current.at - prior.at : Infinity;
    const gain = prior ? current.energy - prior.energy : null;
    const elevated = current.energy > current.max;
    const observedDose = increase === 1 && odIncrease === 0 &&
      prior.energy === 0 && gain >= 200 && gain <= 300 &&
      current.cooldown > 0 && gap <= 10 * MINUTE;
    if (!elevated && !observedDose) return null;
 
    // Only a very recent zero-energy observation supports the first-dose
    // preparation rule. Do not invent a precise ingestion timestamp.
    const recentZero = !!prior && prior.energy === 0 &&
      gap <= 2 * MINUTE;
    const corroborated = observedDose && recentZero;
    const note = corroborated
      ? 'Xanax counter and energy increase support first dose; zero energy was recently observed.'
      : increase > 0
        ? 'Xanax counter rose, but the exact first dose or outcome cannot be verified.'
        : 'Energy above natural maximum suggests a stack. Its source and first dose are unverified.';
    return {
      v: 1,
      status: odIncrease > 0 ? 'disrupted' : 'active',
      startedAt: prior?.at ?? current.at,
      last: { ...current },
      uses: increase > 0 ? increase : 0,
      uncertain: !corroborated || odIncrease > 0,
      firstZeroObserved: corroborated,
      warId: war.id ?? null,
      warAt: war.at,
      detection: corroborated ? 'counter-and-bars' :
        increase > 0 ? 'counter-inferred' : 'elevated-energy',
      events: [{
        kind: 'inferred',
        at: current.at,
        since: prior?.at ?? null,
        count: increase > 0 ? increase : 0,
        note
      }]
    };
  }
 
 
  // Store only IDs, event types and timestamps. Do not store complete activity logs.
  function parseDrugLogs(response, fromMs, now) {
    if (!Array.isArray(response?.log)) {
      throw new Error('Unexpected user/log response shape');
    }
    const byId = new Map();
    for (const item of response.log) {
      const id = String(item?.id ?? '');
      const kind = Number(item?.details?.id);
      const timestamp = Number(item?.timestamp) * 1000;
      if (!id || ![2290, 2291].includes(kind) ||
          !Number.isFinite(timestamp) ||
          timestamp < fromMs || timestamp > now + MINUTE) continue;
      byId.set(id, {
        id,
        at: timestamp,
        kind: kind === 2290 ? 'use' : 'od'
      });
    }
    return {
      records: [...byId.values()].sort((a, b) => a.at - b.at),
      fetchedAt: now,
      capped: response.log.length >= 100
    };
  }
 
  function validLogCache(cache) {
    return !!cache && cache.v === 1 &&
      Array.isArray(cache.records) &&
      Number.isFinite(cache.fetchedAt) &&
      typeof cache.capped === 'boolean' &&
      cache.records.every(r =>
        !!r && typeof r.id === 'string' && r.id.length > 0 &&
        ['use', 'od'].includes(r.kind) &&
        Number.isFinite(r.at)
      );
  }
 
  function mergeDrugLogs(previous, incoming) {
    const items = new Map();
    if (validLogCache(previous)) {
      for (const r of previous.records) items.set(r.id, r);
    }
    for (const r of incoming.records) items.set(r.id, r);
    const earliest = incoming.fetchedAt - 7 * 24 * HOUR;
    return {
      v: 1,
      fetchedAt: incoming.fetchedAt,
      capped: incoming.capped,
      records: [...items.values()]
        .filter(r => r.at >= earliest)
        .sort((a, b) => a.at - b.at)
        .slice(-120)
    };
  }
 
  // Logs are evidence for an explicitly tracked stack, not a record of
  // every ordinary Xanax taken since a guessed pre-war cutoff.
  function sameWar(tracked, war) {
    if (!tracked || !war || !Number.isFinite(tracked.warAt) ||
        !Number.isFinite(war.at) ||
        Math.abs(tracked.warAt - war.at) > MINUTE) return false;
    if (tracked.warId != null && war.id != null &&
        String(tracked.warId) !== String(war.id)) return false;
    return true;
  }
 
  function completedWar(war) {
    const winner = war?.winner;
    return Number(war?.end) > 0 ||
      (winner != null && winner !== 0 && winner !== '0' && winner !== '');
  }
 
  function selectFactionWar(wars, now) {
    if (!Array.isArray(wars)) return null;
    const eligible = wars.filter(w =>
      Number.isFinite(Number(w?.start)) && Number(w.start) > 0 &&
      !completedWar(w));
    const upcoming = eligible.filter(w => Number(w.start) * 1000 > now)
      .sort((a, b) => Number(a.start) - Number(b.start));
    const next = upcoming[0];
    if (next) return { at: Number(next.start) * 1000, id: next.id ?? next.war_id ?? null,
      source: 'Upcoming faction war' };
 
    // No new war announced: show an *actually ongoing* war, but never
    // resurrect an arbitrarily old record whose end field remained zero.
    const ongoing = eligible.filter(w => Number(w.start) * 1000 <= now &&
      now - Number(w.start) * 1000 <= 6 * 24 * HOUR)
      .sort((a, b) => Number(b.start) - Number(a.start));
    const live = ongoing[0];
    return live ? { at: Number(live.start) * 1000, id: live.id ?? live.war_id ?? null,
      source: 'Current faction war' } : null;
  }
 
  function mayInferStack(now, war, cfg) {
    if (!war || !Number.isFinite(war.at) || war.at <= now) return false;
    const plan = preStackPlan(now, war.at, cfg, 0);
    // Ordinary post-war use must never create a stack for a newly
    // announced war days away. Earlier stacks can be adopted manually.
    return now >= plan.latestStart && now < plan.deadline;
  }
 
  function stackDrugLogs(cache, warAt, cfg, now, currentTracker = null,
    warId = null) {
    if (!validLogCache(cache) ||
        !sameWar(currentTracker, { at: warAt, id: warId }) ||
        currentTracker.status === 'armed') {
      return { uses: [], overdoses: [], cutoff: null };
    }
    const cutoff = currentTracker.startedAt - MINUTE;
    const deadline = warAt + cfg.offsetHours * HOUR;
    const records = cache.records.filter(r =>
      r.at >= cutoff && r.at <= Math.min(now + MINUTE, deadline));
    const uses = records.filter(r => r.kind === 'use');
    const overdoses = records.filter(r => r.kind === 'od');
    return { uses, overdoses, cutoff };
  }
 
  // Pure calculations are executable in Node without a browser.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      preStackPlan, activePlan, parseClock, asleep, awakeAfter, awakeBefore,
      nearSleep, windowCrossesSleep, beginTracker, reconcile, inferStack, validSnapshot, validTracker,
      parseDrugLogs, mergeDrugLogs, validLogCache, stackDrugLogs,
      sameWar, completedWar, selectFactionWar, mayInferStack
    };
    return;
  }
 
  if (typeof window === 'undefined' || typeof document === 'undefined' ||
      window.top !== window.self ||
      window.__likidyWarStackV033 || window.__likidyWarStackV034 ||
      window.__likidyWarStackWebV034 || window.__likidyWarStackWebV035 ||
      document.getElementById(PANEL_ID) ||
      document.getElementById('likidy-warstack-preview')) return;
  window.__likidyWarStackWebV035 = true;
 
  // Script-specific Tampermonkey storage, isolated from Torn page scripts.
  function load(key, fallback) {
    try {
      const value = GM_getValue(key, null);
      return value == null ? fallback : JSON.parse(value) ?? fallback;
    } catch (_) { return fallback; }
  }
  function save(key, value) {
    try { GM_setValue(key, JSON.stringify(value)); return true; }
    catch (_) { return false; }
  }
  function remove(key) {
    try { GM_deleteValue(key); return true; }
    catch (_) { return false; }
  }
  function validApiKey(key) {
    return /^[a-z0-9]{16}$/i.test(key);
  }
  let apiKey = '';
  try { apiKey = GM_getValue(API_KEY_KEY, '') || ''; } catch (_) {}
 
  function esc(value) {
    return String(value).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }
  function fmt(ms) {
    return new Date(ms).toLocaleString(undefined, {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  }
  function short(ms) {
    return new Date(ms).toLocaleString(undefined, {
      weekday: 'short', hour: '2-digit', minute: '2-digit'
    });
  }
  function precise(ms) {
    return new Date(ms).toLocaleString(undefined, {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
  }
  function shortPrecise(ms) {
    return new Date(ms).toLocaleString(undefined, {
      weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
  }
  function tct(ms) {
    return new Date(ms).toLocaleString('en-GB', {
      timeZone: 'UTC', weekday: 'short', hour: '2-digit', minute: '2-digit',
      hour12: false
    }) + ' TCT';
  }
  function duration(ms) {
    if (ms <= 0) return 'Now';
    const m = Math.ceil(ms / MINUTE);
    return [Math.floor(m / 1440) ? `${Math.floor(m / 1440)}d` : '',
      Math.floor((m % 1440) / 60) ? `${Math.floor((m % 1440) / 60)}h` : '',
      `${m % 60}m`].filter(Boolean).join(' ');
  }
  function row(label, value) {
    return `<div class="lws-row"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
  }
  function field(label, value) {
    return `<div class="lws-field"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
  }
  function caution(message) {
    return `<div class="lws-warning">${esc(message)}</div>`;
  }
 
  let settings = load(SETTINGS_KEY, defaults);
  if (!validSettings(settings)) settings = { ...defaults };
  let position = load(POSITION_KEY, { x: 0.88, y: 0.72 });
  if (!Number.isFinite(position?.x) || !Number.isFinite(position?.y)) {
    position = { x: 0.88, y: 0.72 };
  }
  let tracker = load(TRACK_KEY, null);
  let observation = load(OBS_KEY, null);
  let drugLogs = load(LOG_KEY, null);
  if (!validLogCache(drugLogs)) drugLogs = null;
  if (!validSnapshot(observation)) observation = null;
  let storageError = false;
  if (tracker && !validTracker(tracker)) {
    tracker = null;
    storageError = true;
  }
  const state = {
    snapshot: null, updatedAt: 0, warList: null, warAt: 0,
    errors: [], busy: false, trackerStale: false, logError: null
  };
  let tab = 'overview';
  let isOpen = false;
 
  async function api(path) {
    if (!validApiKey(apiKey)) throw Error('Torn API key not configured');
    const reply = await new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url: `https://api.torn.com/v2${path}`,
        headers: { Authorization: `ApiKey ${apiKey}` },
        timeout: 12000,
        onload: response => resolve(response),
        onerror: () => reject(Error('Network request failed')),
        ontimeout: () => reject(Error('API request timed out'))
      });
    });
    if (Number(reply?.status) !== 200) {
      throw Error('HTTP ' + String(reply?.status ?? '?'));
    }
    let value;
    try { value = JSON.parse(reply.responseText); }
    catch (_) { throw Error('Invalid JSON from Torn API'); }
    if (value?.error) throw Error('API ' + String(value.error.code));
    return value;
  }
 
  function chooseWar(now) {
    if (settings.manualWar) {
      const at = new Date(settings.manualWar).getTime();
      return Number.isFinite(at) && at > now
        ? { at, id: null, source: 'Manual override' }
        : null;
    }
    // Only the latest verified API war list can select a war.
    // In particular, a tracking session cannot select its own old war.
    return selectFactionWar(state.warList, now);
  }
 
  function discardTracker() {
    try {
      GM_deleteValue(TRACK_KEY);
      tracker = null;
      return true;
    } catch (_) {
      storageError = true;
      state.trackerStale = true;
      return false;
    }
  }
 
  function remainingCooldown(now) {
    if (!state.snapshot) return null;
    return Math.max(0, state.snapshot.cooldown -
      Math.floor((now - state.snapshot.at) / 1000));
  }
 
  function snapshotFrom(bars, cd, stats, at) {
    const s = {
      energy: bars?.bars?.energy?.current,
      max: bars?.bars?.energy?.maximum,
      cooldown: cd?.cooldowns?.drug,
      xanax: stats?.personalstats?.drugs?.xanax,
      overdoses: stats?.personalstats?.drugs?.overdoses,
      at
    };
    return validSnapshot(s) ? s : null;
  }
 
  async function refresh() {
    if (state.busy || document.hidden) return;
    if (!validApiKey(apiKey)) {
      state.errors = ['Enter your Torn API key under Settings.'];
      state.snapshot = null;
      state.warList = null;
      state.updatedAt = 0;
      render();
      return;
    }
    state.busy = true;
    render();
    const paths = ['/user/bars', '/user/cooldowns',
      '/user/personalstats?cat=drugs', '/faction/rankedwars?sort=DESC'];
    const settled = await Promise.all(paths.map(path =>
      api(path).then(value => ({ value }), error => ({ error }))
    ));
    state.errors = settled.flatMap((r, i) => r.error
      ? [`${paths[i]}: ${r.error.message || 'request failed'}`] : []);
    const values = settled.map(r => r.value ?? null);
    const at = Date.now();
    if (Array.isArray(values[3]?.rankedwars)) {
      state.warList = values[3].rankedwars;
      state.warAt = at;
    } else {
      // Fail closed. Cached data must not silently drive a new stack.
      state.warList = null;
      state.warAt = 0;
      if (!settled[3]?.error) {
        state.errors.push('Unexpected ranked wars API response');
      }
    }
    const fresh = snapshotFrom(values[0], values[1], values[2], at);
    if (fresh) {
      state.snapshot = fresh;
      state.updatedAt = at;
      state.trackerStale = false;
 
      const regressed = !!observation &&
        (fresh.xanax < observation.xanax ||
         fresh.overdoses < observation.overdoses);
      if (regressed) {
        state.trackerStale = true;
        state.errors.push('Drug counters regressed; previous baseline preserved');
      } else {
        try {
          const war = chooseWar(at);
          // Change of war means a new lifecycle, not another dose in the
          // previous war. Do not reset on an API failure or unknown list.
          const warVerified = !!settings.manualWar ||
            Array.isArray(state.warList);
          if (tracker && warVerified &&
              (!sameWar(tracker, war) ||
               (war && at >= war.at + settings.offsetHours * HOUR))) {
            if (!discardTracker()) {
              throw new Error('Could not discard expired stack session');
            }
          }
          const next = tracker
            ? reconcile(tracker, fresh)
            : mayInferStack(at, war, settings) &&
              fresh.energy >= Math.min(settings.targetEnergy, 500)
              ? inferStack(observation, fresh, war)
              : null;
          if (next) {
            if (save(TRACK_KEY, next)) tracker = next;
            else { storageError = true; state.trackerStale = true; }
          }
          // Keep a passive baseline even before the first stacking dose.
          if (save(OBS_KEY, fresh)) observation = fresh;
          else { storageError = true; state.trackerStale = true; }
        } catch (_) {
          state.trackerStale = true;
          state.errors.push('Tracker reconciliation failed');
        }
      }
    } else {
      state.trackerStale = true;
      if (!state.errors.length) state.errors.push('Incomplete user API fields');
    }
    // Log access is optional. A failed log request cannot erase the last
    // successful log history or prevent live energy/cooldown scheduling.
    try {
      const logFrom = at - 96 * HOUR;
      const path = '/user/log?log=2290,2291&from=' +
        Math.floor(logFrom / 1000) + '&limit=100&comment=LikidyWarStack';
      const response = await api(path);
      const parsed = parseDrugLogs(response, logFrom, Date.now());
      const merged = mergeDrugLogs(drugLogs, parsed);
      if (save(LOG_KEY, merged)) {
        drugLogs = merged;
        state.logError = parsed.capped
          ? 'Log response reached 100 entries; history may be incomplete.'
          : null;
      } else {
        storageError = true;
        state.logError = 'Log timestamps could not be saved.';
      }
    } catch (_) {
      state.logError = 'Precise log times temporarily unavailable; counter tracking remains active.';
    }
    state.busy = false;
    render();
  }
 
  const root = document.createElement('div');
  root.id = PANEL_ID;
  root.innerHTML = `
    <button id="lws-launch" aria-label="War Stack Planner" type="button">WS</button>
    <section id="lws-panel" hidden aria-label="War Stack Planner">
      <header><strong>Likidy's War Stack</strong>
        <button type="button" id="lws-close" aria-label="Close">×</button></header>
      <nav><button type="button" id="lws-overview">Overview</button>
        <button type="button" id="lws-schedule">Schedule</button></nav>
      <div id="lws-content"></div>
      <details id="lws-settings"><summary>Settings</summary>
        <div id="lws-api-settings">
          <label for="lws-api-key">Torn API key
            <input id="lws-api-key" type="password" autocomplete="off"
                   spellcheck="false" placeholder="16-character Torn API key">
          </label>
          <small id="lws-key-status"></small>
          <div class="lws-key-actions">
            <button type="button" id="lws-key-save">Save API key</button>
            <button type="button" id="lws-key-clear">Clear key and data</button>
          </div>
          <small>Saved privately in Tampermonkey. Requires access to your user bars,
          cooldowns, drug stats, faction ranked wars and user logs.</small>
        </div>
        <form id="lws-form">
          <label>Energy target (E)<input name="targetEnergy" type="number" min="1" max="1000" step="1"></label>
          <label>Final cooldown offset (hours)<input name="offsetHours" type="number" min="-168" max="168" step="0.5"></label>
          <label>Sleep starts<input name="sleepStart" type="time"></label>
          <label>Wake at<input name="sleepEnd" type="time"></label>
          <label>Manual war start (local)<input name="manualWar" type="datetime-local"></label>
          <small>Leave war start blank to use your faction's API.</small>
          <button type="submit">Save settings</button>
          <span id="lws-form-error" role="status"></span>
        </form>
      </details>
      <footer><button id="lws-refresh" type="button">Refresh API</button>
        <span id="lws-stamp"></span></footer>
    </section>`;
  const css = document.createElement('style');
  css.textContent = `
    #${PANEL_ID},#${PANEL_ID} *{box-sizing:border-box}
    #${PANEL_ID}{font:13px/1.4 Arial,sans-serif;color:#f3e8ff}
    #lws-launch{position:fixed;z-index:2147483000;width:44px;height:44px;border-radius:50%;border:2px solid #a855f7;background:#27143e;color:#f5eaff;box-shadow:0 2px 12px #000b;font-weight:800;font-size:13px;touch-action:none;user-select:none}
    #lws-launch.lws-risk{border-color:#f87171;color:#fecaca}
    #lws-launch.lws-due{border-color:#fbbf24;color:#fde68a}
    #lws-launch.lws-ready{border-color:#4ade80;color:#dcfce7}
    #lws-panel{position:fixed;z-index:2147483001;left:50%;top:50%;transform:translate(-50%,-50%);width:min(540px,calc(100vw - 24px));max-width:calc(100vw - 24px);max-height:84dvh;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;background:#160e23;border:1px solid #7e3cc1;border-radius:12px;box-shadow:0 7px 40px #000d;padding:16px}
    #lws-panel[hidden]{display:none}
    #lws-panel header,#lws-panel nav,#lws-panel footer{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0}
    #lws-panel header{font-size:16px;margin-bottom:12px}
    #lws-panel button{background:#392050;color:#f4eaff;border:1px solid #75518f;border-radius:6px;padding:8px;cursor:pointer}
    #lws-close{min-width:32px}
    #lws-panel nav{margin-bottom:12px}
    #lws-panel nav button{flex:1;min-width:0}
    #lws-panel nav button.current{background:#6733a1;border-color:#bb86fc}
    #lws-content{display:grid;gap:10px;min-width:0;width:100%}
    #lws-content>*{min-width:0;max-width:100%}
    .lws-priority{border:1px solid #9052ce;background:#261637;padding:12px;border-radius:8px;display:grid;gap:5px;min-width:0}
    .lws-priority strong{font-size:16px;overflow-wrap:anywhere}
    .lws-muted,.lws-field span,#lws-stamp{color:#b8a7c9;font-size:11px}
    .lws-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;min-width:0}
    .lws-field{background:#241531;border:1px solid #382346;border-radius:8px;padding:9px;min-width:0;display:grid;gap:3px;overflow-wrap:anywhere}
    .lws-field strong{font-size:13px;overflow-wrap:anywhere}
    .lws-row{display:flex;align-items:baseline;justify-content:space-between;gap:10px;border-bottom:1px solid #332140;padding:5px 0;min-width:0}
    .lws-row span{color:#b8a7c9;font-size:12px;min-width:0}
    .lws-row strong{text-align:right;overflow-wrap:anywhere;min-width:0}
    .lws-warning{border:1px solid #c8714b;border-radius:7px;padding:9px;background:#35201f;color:#ffe1d0;overflow-wrap:anywhere}
    .lws-event{border-left:2px solid #9c5edd;padding:5px 2px 7px 10px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;min-width:0}
    .lws-event-main{display:grid;gap:2px;min-width:0;overflow-wrap:anywhere}
    .lws-event-main small{font-size:11px;color:#b8a7c9}
    .lws-event-when{text-align:right;white-space:nowrap;font-size:11px;color:#c6aedc}
    .lws-event.sleep{border-left-color:#655573}
    .lws-event.near{border-left-color:#fbbf24}
    .lws-event.observed{border-left-color:#4ade80}
    #lws-actions{display:flex;flex-wrap:wrap;gap:8px;min-width:0}
    #lws-actions button{flex:1 1 120px;min-width:0}
    #lws-actions .danger{border-color:#b56c6c}
    #lws-settings{border-top:1px solid #39284a;padding-top:10px;margin-top:14px;min-width:0}
    #lws-settings summary{cursor:pointer;font-weight:600}
    #lws-form,#lws-form label,#lws-api-settings,#lws-api-settings label{display:grid;grid-template-columns:minmax(0,1fr);width:100%;min-width:0;max-width:100%;gap:8px}
    #lws-form{margin-top:14px;border-top:1px solid #39284a;padding-top:12px}
    #lws-form label,#lws-api-settings label{gap:3px}
    #lws-form input,#lws-api-key{display:block;width:100%;min-width:0;max-width:100%;margin:0;background:#21152e;color:#fff;border:1px solid #624275;border-radius:5px;padding:7px;font-size:16px}
    #lws-form small,#lws-api-settings small{color:#b5a8c7}
    #lws-api-settings{padding-top:12px}
    #lws-key-status{color:#b8a7c9}
    .lws-key-actions{display:flex;flex-wrap:wrap;gap:8px}
    .lws-key-actions button{flex:1 1 170px}
    #lws-form-error{color:#fda4af}
    #lws-panel footer{margin-top:12px;padding-top:9px;border-top:1px solid #39284a}
    @media(max-width:365px){#lws-panel{padding:9px}.lws-grid{gap:6px}.lws-field{padding:7px}}
  `;
  document.head.appendChild(css);
  document.body.appendChild(root);
  const launcher = root.querySelector('#lws-launch');
  const panel = root.querySelector('#lws-panel');
  const content = root.querySelector('#lws-content');
  const form = root.querySelector('#lws-form');
  const stamp = root.querySelector('#lws-stamp');
  const keyInput = root.querySelector('#lws-api-key');
  const keyStatus = root.querySelector('#lws-key-status');
 
  function eventHtml(title, detail, when, className = '') {
    return `<div class="lws-event ${className}">
      <div class="lws-event-main"><strong>${esc(title)}</strong><small>${esc(detail)}</small></div>
      <div class="lws-event-when">${esc(when)}</div></div>`;
  }
 
  function timeline(plan, tracked, stackLogs) {
    const events = [];
    if (plan.kind === 'pre') {
      events.push({ at: plan.lastRegular, title: 'Last regular Xanax',
        detail: 'Latest conservative cutoff' });
    } else {
      const uses = stackLogs?.uses ?? [];
      const overdoses = stackLogs?.overdoses ?? [];
      uses.forEach((e, i) => events.push({
        at: e.at,
        title: `Xanax use logged #${i + 1}`,
        detail: 'Exact Torn log timestamp. Successful energy gain is assessed separately.',
        observed: true,
        precise: true
      }));
      overdoses.forEach(e => events.push({
        at: e.at,
        title: 'Overdose logged during stack window',
        detail: 'Verify effects and current energy; timestamp from Torn log.',
        near: true,
        precise: true
      }));
      if (tracked) {
        for (const e of tracked.events) {
          if (e.kind === 'energy') {
            events.push({ at: e.at, title: 'Energy changed',
              detail: e.note, observed: true });
          } else if (e.kind === 'use' && !uses.some(log =>
            log.at >= (e.since ?? 0) - MINUTE &&
            log.at <= e.at + MINUTE)) {
            events.push({ at: e.at, title: `${e.count} Xanax use(s) observed`,
              detail: `${e.note} Exact time not verified.`, observed: true });
          } else if (e.kind === 'inferred' && uses.length === 0) {
            events.push({ at: e.at, title: 'Stack recognized (inferred)',
              detail: e.note, observed: true });
          } else if (e.kind === 'od' && !overdoses.some(log =>
            log.at >= (e.since ?? 0) - MINUTE &&
            log.at <= e.at + MINUTE)) {
            events.push({ at: e.at, title: 'Overdose counter changed',
              detail: e.note, near: true });
          }
        }
      }
    }
    for (let i = 0; i < plan.doses.length; i++) {
      const doseTime = plan.doses[i];
      const close = nearSleep(doseTime, plan.sleep);
      const label = plan.kind === 'pre' && i === 0
        ? 'Train to 0 E · Xanax #1'
        : plan.kind === 'pre' ? `Xanax #${i + 1}`
        : i === 0 ? 'Next Xanax · take by'
        : `Remaining dose ${i + 1} · latest plan`;
      let detail;
      if (plan.kind === 'active' && i === 0) {
        detail = `Available from ${fmt(plan.window.available)}. Take only while awake.`;
      } else if (plan.kind === 'active') {
        detail = 'Latest conservative estimate; recalculates after the next dose.';
      } else {
        detail = `${(i + 1) * 250} E projected`;
      }
      if (close) detail += ` · ${close}m before sleep`;
      events.push({ at: doseTime, title: label, detail, near: !!close });
    }
 
    events.push({ at: plan.ready, title: 'Final cooldown clear',
      detail: `${plan.projectedEnergy} E projected if future doses succeed` });
    events.push({ at: plan.deadline, title: 'Readiness deadline',
      detail: 'War start plus signed offset' });
    if (plan.sleep.start !== plan.sleep.end) {
      let anchor = Math.min(plan.doses[0] ?? plan.ready, plan.deadline);
      if (plan.kind === 'pre') anchor = Math.min(anchor, plan.lastRegular);
      if (tracked) anchor = Math.min(anchor, Date.now());
      const day = new Date(anchor);
      day.setHours(0, 0, 0, 0);
      day.setDate(day.getDate() - 1);
      for (let i = 0; i < 12 && day.getTime() <= plan.deadline; i++) {
        const start = localClock(day.getTime(), plan.sleep.start);
        const end = localClock(day.getTime(), plan.sleep.end,
          plan.sleep.end < plan.sleep.start ? 1 : 0);
        if (end >= anchor && start <= plan.deadline) {
          events.push({ at: start, title: 'Sleep',
            detail: `${short(start)}–${short(end)} · no planned doses`, sleep: true });
        }
        day.setDate(day.getDate() + 1);
      }
    }
    events.sort((a, b) => a.at - b.at);
    return events.map(e => eventHtml(e.title, e.detail, e.precise ? shortPrecise(e.at) : short(e.at),
      e.sleep ? 'sleep' : e.near ? 'near' : e.observed ? 'observed' : '')).join('');
  }
 
  function render() {
    const now = Date.now();
    const war = chooseWar(now);
    const tracked = sameWar(tracker, war) ? tracker : null;
    const s = state.snapshot;
    const cd = remainingCooldown(now);
    const stale = !s || now - s.at > FRESH_MS || state.trackerStale;
    launcher.classList.remove('lws-risk', 'lws-due', 'lws-ready');
    if (!validApiKey(apiKey)) {
      content.innerHTML = '<div class="lws-priority"><span class="lws-muted">SETUP NEEDED</span>' +
        '<strong>Enter your Torn API key in Settings to load your war and dosing schedule.</strong></div>' +
        '<p class="lws-muted">All actions are read-only. No Xanax or training is automated.</p>';
      stamp.textContent = 'API key needed';
      return;
    }
    let html = '';
    if (storageError) html += caution('Tracker storage failed or was invalid. Do not rely on persistence.');
    if (stale) html += caution('API readings are stale or incomplete. Refresh before acting.');
    if (state.errors.length) html += caution('API request error: ' + state.errors.join('; '));
    if (state.logError) html += '<p class="lws-muted">' + esc(state.logError) + '</p>';
 
    if (!war) {
      html += caution(settings.manualWar && new Date(settings.manualWar).getTime() <= now
        ? 'Manual war start has passed. Clear the override in Settings to use the faction API.'
        : 'No upcoming or ongoing war verified. Set a manual war start if needed.');
    } else if (now >= war.at + settings.offsetHours * HOUR) {
      html += `<div class="lws-priority"><span class="lws-muted">${now >= war.at ? 'WAR UNDERWAY' : 'STACK DEADLINE PASSED'}</span>
        <strong>Stacking deadline has passed. No further pre-war doses are scheduled.</strong></div>` +
        field('War start', `${fmt(war.at)} · ${tct(war.at)}`);
    } else if (!s || cd === null) {
      html += field('War starts', fmt(war.at));
    } else {
      const stackLogs = stackDrugLogs(drugLogs, war.at, settings, now, tracked, war.id);
      const plan = (tracked && tracked.status !== 'armed') ||
        (!tracked && mayInferStack(now, war, settings) && s.energy >= Math.min(settings.targetEnergy, 500))
        ? activePlan(now, war.at, settings, s.energy, cd)
        : tracked && tracked.status === 'armed'
          ? activePlan(now, war.at, settings, 0, cd)
          : preStackPlan(now, war.at, settings, cd);
      const possibleStack = !tracked && mayInferStack(now, war, settings) && s.energy >= Math.min(settings.targetEnergy, 500); // Only before a successful refresh.
      const futureDue = plan.kind === 'active' && plan.window
        ? now >= plan.window.available
        : plan.doses[0] && plan.doses[0] <= now + MINUTE;
      const ready = !!tracked && tracked.status !== 'armed' &&
        s.energy >= settings.targetEnergy && cd === 0 && !stale;
      const risk = !plan.feasible || tracked?.status === 'disrupted';
      if (risk || stale) launcher.classList.add('lws-risk');
      else if (ready) launcher.classList.add('lws-ready');
      else if (futureDue || (plan.kind === 'pre' && now >= plan.latestStart)) {
        launcher.classList.add('lws-due');
      }
 
      let stage, action;
      if (possibleStack) {
        stage = 'POSSIBLE STACK · INFERRED';
        action = 'Current energy indicates an existing stack; refresh to establish tracking';
      } else if (!tracked) {
        stage = risk ? 'AT RISK' : now >= plan.latestStart ? 'PREPARE' : 'NORMAL TRAINING';
        action = risk ? 'Deadline is not feasible with current constraints'
          : now < plan.latestStart
            ? `Train normally until ${fmt(plan.latestStart)}`
            : cd > 0 ? `Wait for drug cooldown: ${duration(cd * 1000)}`
              : s.energy !== 0 ? 'Train to 0 E before Xanax #1'
                : '0 E observed. Take Xanax #1, then refresh API';
      } else if (tracked.status === 'armed') {
        stage = risk ? 'AT RISK · ARMED' : 'AWAITING FIRST XANAX';
        action = s.energy !== 0 ? 'Energy no longer 0 E. Train down before Xanax #1'
          : cd > 0 ? `Wait for cooldown: ${duration(cd * 1000)}`
            : 'Take Xanax #1, then refresh to reconcile';
      } else if (ready) {
        stage = 'READY · VERIFIED BARS';
        action = 'Energy target reached, drug cooldown clear';
      } else {
        stage = risk ? 'AT RISK' : stackLogs.uses.length ? 'STACKING · LOGGED USES' : tracked?.uncertain ? 'STACKING · INFERRED' : 'STACKING ACTIVE';
        if (stale) {
          action = 'Refresh API to confirm the next-dose window';
        } else if (plan.remaining === 0) {
          action = `Target reached. Cooldown clears in ${duration(cd * 1000)}`;
        } else if (!plan.feasible) {
          action = `Latest safe window missed. Next eligible: ${fmt(plan.window.available)}`;
        } else if (futureDue) {
          action = `Next Xanax available now · take by ${fmt(plan.window.latestSafe)}`;
        } else {
          action = `Next Xanax window: ${fmt(plan.window.available)} to ${fmt(plan.window.latestSafe)}`;
        }
      }
      if (risk) launcher.classList.add('lws-risk');
 
      const warnings = [];
      if (risk) warnings.push('Current constraints do not meet the configured readiness deadline.');
      if (plan.kind === 'active' && plan.window) {
        if (plan.window.available > plan.window.latestSafe) {
          warnings.push('The conservative dose window has closed. Earliest projected cooldown clearance: ' + fmt(plan.earliestReady) + '.');
        } else if (windowCrossesSleep(
          plan.window.available, plan.window.latestSafe, plan.sleep
        )) {
          warnings.push('This dosing window spans sleep hours. Only take Xanax while awake.');
        } else if (now >= plan.window.latestSafe - 30 * MINUTE) {
          warnings.push('Less than 30 minutes remain before the latest safe dose time.');
        }
      }
      if (tracked?.uncertain && stackLogs.uses.length === 0) warnings.push(
        'Earlier dose details are inferred. Current energy and cooldown drive the remaining plan.');
      if (tracked?.status === 'disrupted') warnings.push(
        'Overdose or counter anomaly detected. The stack is not automatically abandoned.');
      if (stackLogs.overdoses.length) warnings.push(
        `${stackLogs.overdoses.length} overdose event(s) logged within this stacking period. Confirm current bars and review the plan.`);
      if (possibleStack) warnings.push(
        'Energy above natural maximum indicates a possible stack, not proof of Xanax use. Refresh to persist a baseline.');
      if (war.source.startsWith('Saved')) warnings.push(
        'Using saved war time because current war record is unavailable.');
      const warningsHtml = warnings.map(caution).join('');
 
      if (tab === 'overview') {
        html += `<div class="lws-priority"><span class="lws-muted">${esc(stage)} · NEXT ACTION</span>
          <strong>${esc(action)}</strong></div>` + warningsHtml +
          `<div class="lws-grid">${field('War start', `${fmt(war.at)} · ${tct(war.at)}`)}
          ${field('War countdown', war.at <= now ? 'War started' : duration(war.at - now))}</div>
          <div class="lws-grid">${field('Energy', `${s.energy} / ${settings.targetEnergy} E`)}
          ${field('Drug cooldown', duration(cd * 1000))}</div>`;
        if (!tracked && now < plan.latestStart) {
          html += field('Last safe regular Xanax', fmt(plan.lastRegular));
        }
        html += row('Remaining doses', String(plan.remaining));
        if (plan.kind === 'active' && plan.window) {
          html += `<div class="lws-grid">${field('Next dose available', fmt(plan.window.available))}
            ${field('Latest safe dose time', fmt(plan.window.latestSafe))}</div>`;
        }
        html += (settings.offsetHours !== 0
            ? row('Final cooldown target', fmt(plan.deadline)) : '') +
          row('Projected cooldown clear', fmt(plan.ready));
        if (stackLogs.uses.length) {
          html += row('Xanax use log entries', String(stackLogs.uses.length));
          stackLogs.uses.forEach((e, i) => {
            html += row(`Logged Xanax #${i + 1}`, precise(e.at));
          });
        }
        if (tracked?.uses > 0) html += row('Counter increases since tracking', String(tracked.uses));
        if (stackLogs.uses.length && tracked?.firstZeroObserved === false) {
          html += '<p class="lws-muted">First-dose zero-energy preparation was not independently captured. Log timestamps confirm use, not starting energy.</p>';
        }
        if (tracked?.detection) html += row('Initial stack evidence',
          stackLogs.uses.length ? 'Xanax use logged · initial zero E unverified' :
          tracked.detection === 'counter-and-bars' ? 'Counter + energy · corroborated' :
          tracked.detection === 'counter-inferred' ? 'Counter change · inferred' :
          'Elevated energy · inferred');
        const close = plan.doses.map((t, i) => ({ i, m: nearSleep(t, plan.sleep) }))
          .find(x => x.m !== null);
        if (close) html += caution(`A future dose is ${close.m} minute(s) before sleep.`);
        html += `<div id="lws-actions">`;
        if (tracked) {
          html += `<button type="button" class="danger" data-act="end">Stop tracking</button>`;
        } else if (!stale && now < war.at) {
          if (s.energy === 0 && cd === 0) {
            html += `<button type="button" data-act="start">Start stack tracking (0 E)</button>`;
          } else if (s.energy > s.max) {
            html += `<button type="button" data-act="adopt">Adopt existing stack (unverified)</button>`;
          }
        }
        html += `</div>`;
      } else {
        html += '<strong>Stacking timeline</strong>' +
          warningsHtml + (possibleStack ? '' : timeline(plan, tracked, stackLogs));
      }
    }
    content.innerHTML = html;
    for (const key of ['overview', 'schedule']) {
      root.querySelector('#lws-' + key).classList.toggle('current', tab === key);
    }
    stamp.textContent = 'v0.3.6 · ' + (state.busy ? 'Updating…' :
      state.updatedAt ? `Read ${short(state.updatedAt)}` : 'Not refreshed');
  }
 
  content.addEventListener('click', event => {
    const action = event.target.closest?.('button[data-act]')?.dataset.act;
    if (action === 'end' && window.confirm(
      'Stop this war stack session? Your historical Torn drug logs will be preserved. Future untracked stacks may be inferred from sufficiently elevated energy near the stacking window.'
    )) {
      discardTracker();
      render();
      return;
    }
    if (action !== 'start' && action !== 'adopt') return;
    const now = Date.now();
    const war = chooseWar(now);
    const s = state.snapshot;
    if (!war || war.at <= now || !s ||
        now - s.at > 90000 || state.trackerStale) {
      window.alert('Refresh the API and verify a future war before starting tracking.');
      return;
    }
    if (action === 'start' && (s.energy !== 0 || s.cooldown !== 0)) {
      window.alert('Start tracking requires 0 energy and no drug cooldown.');
      return;
    }
    if (action === 'adopt' && s.energy <= s.max) {
      window.alert('Existing stack is not established from the energy bar.');
      return;
    }
    if (action === 'adopt' && !window.confirm(
      'Adopt current energy as an unverified stack? Earlier doses and the first zero-energy condition cannot be proven.'
    )) return;
    try {
      const next = beginTracker(s, war, action === 'adopt');
      if (save(TRACK_KEY, next)) tracker = next;
      else storageError = true;
    } catch (error) {
      window.alert(error.message);
    }
    render();
  });
 
  function fillForm() {
    for (const key of Object.keys(defaults)) {
      form.elements.namedItem(key).value = String(settings[key]);
    }
  }
  form.addEventListener('submit', event => {
    event.preventDefault();
    const candidate = {
      targetEnergy: Number(form.elements.namedItem('targetEnergy').value),
      offsetHours: Number(form.elements.namedItem('offsetHours').value),
      sleepStart: form.elements.namedItem('sleepStart').value,
      sleepEnd: form.elements.namedItem('sleepEnd').value,
      manualWar: form.elements.namedItem('manualWar').value
    };
    if (!validSettings(candidate)) {
      root.querySelector('#lws-form-error').textContent = 'Invalid settings';
      return;
    }
    if (!save(SETTINGS_KEY, candidate)) {
      root.querySelector('#lws-form-error').textContent = 'Settings could not be saved';
      return;
    }
    settings = candidate;
    root.querySelector('#lws-form-error').textContent = '';
    root.querySelector('#lws-settings').open = false;
    render();
  });
 
  function updateKeyStatus() {
    keyStatus.textContent = validApiKey(apiKey)
      ? 'API key saved in Tampermonkey. Enter a new one to replace it.'
      : 'No API key configured.';
    keyInput.value = '';
  }
 
  function clearAccountData() {
    const keys = [TRACK_KEY, OBS_KEY, LOG_KEY];
    if (!keys.every(remove)) {
      storageError = true;
      return false;
    }
    tracker = null;
    observation = null;
    drugLogs = null;
    state.snapshot = null;
    state.updatedAt = 0;
    state.warList = null;
    state.warAt = 0;
    state.errors = [];
    state.logError = null;
    state.trackerStale = false;
    return true;
  }
 
  root.querySelector('#lws-key-save').addEventListener('click', () => {
    const candidate = keyInput.value.trim();
    if (!validApiKey(candidate)) {
      keyStatus.textContent = 'API key must be 16 letters or numbers.';
      return;
    }
    if (state.busy) {
      keyStatus.textContent = 'API refresh in progress. Try again when complete.';
      return;
    }
    if (apiKey && apiKey !== candidate &&
        !window.confirm("Changing accounts clears this browser's saved stack and drug log history. Continue?")) {
      return;
    }
    try {
      if (apiKey !== candidate && !clearAccountData()) {
        keyStatus.textContent = 'Could not clear previous account data. Key unchanged.';
        return;
      }
      GM_setValue(API_KEY_KEY, candidate);
      apiKey = candidate;
      updateKeyStatus();
      refresh();
    } catch (_) {
      keyStatus.textContent = 'Could not save API key in Tampermonkey.';
    }
  });
 
  root.querySelector('#lws-key-clear').addEventListener('click', () => {
    if (state.busy) {
      keyStatus.textContent = 'API refresh in progress. Try again when complete.';
      return;
    }
    if (!window.confirm('Clear your API key and locally saved stack history?')) return;
    if (!clearAccountData()) {
      keyStatus.textContent = 'Could not clear tracking data. Key retained.';
      return;
    }
    try {
      GM_deleteValue(API_KEY_KEY);
      apiKey = '';
      updateKeyStatus();
      render();
    } catch (_) {
      keyStatus.textContent = 'Could not clear the API key.';
    }
  });
 
  function setPosition(x, y, persist = false) {
    const left = Math.min(Math.max(8, innerWidth - 52), Math.max(8, x));
    const top = Math.min(Math.max(8, innerHeight - 52), Math.max(8, y));
    launcher.style.left = left + 'px';
    launcher.style.top = top + 'px';
    if (persist) {
      position = { x: left / innerWidth, y: top / innerHeight };
      save(POSITION_KEY, position);
    }
  }
  function restorePosition() {
    setPosition(position.x * innerWidth, position.y * innerHeight);
  }
  let gesture = null;
  launcher.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    gesture = { id: event.pointerId, x: event.clientX, y: event.clientY,
      left: launcher.offsetLeft, top: launcher.offsetTop, moved: false };
    launcher.setPointerCapture?.(event.pointerId);
  });
  launcher.addEventListener('pointermove', event => {
    if (!gesture || event.pointerId !== gesture.id) return;
    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;
    if (Math.hypot(dx, dy) > 7) gesture.moved = true;
    if (gesture.moved) setPosition(gesture.left + dx, gesture.top + dy);
  });
  launcher.addEventListener('pointerup', event => {
    if (!gesture || event.pointerId !== gesture.id) return;
    const moved = gesture.moved;
    gesture = null;
    if (moved) setPosition(launcher.offsetLeft, launcher.offsetTop, true);
    else {
      isOpen = !isOpen;
      panel.hidden = !isOpen;
      if (isOpen && Date.now() - state.updatedAt > 90000) refresh();
      else render();
    }
  });
  launcher.addEventListener('pointercancel', () => { gesture = null; });
  window.addEventListener('resize', restorePosition);
  restorePosition();
  root.querySelector('#lws-close').addEventListener('click', () => {
    isOpen = false;
    panel.hidden = true;
  });
  for (const name of ['overview', 'schedule']) {
    root.querySelector('#lws-' + name).addEventListener('click', () => {
      tab = name;
      render();
    });
  }
  root.querySelector('#lws-refresh').addEventListener('click', refresh);
  fillForm();
  updateKeyStatus();
  render();
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - state.updatedAt > 90000) refresh();
  });
  setInterval(() => {
    if (document.hidden) return;
    if (Date.now() - state.updatedAt > 90000) refresh();
    else if (isOpen) render();
  }, 30000);
  refresh();
})();