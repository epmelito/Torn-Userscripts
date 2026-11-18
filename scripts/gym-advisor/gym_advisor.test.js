const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

// Small UI fixtures: run the real reader, renderer and autofill without a DOM dependency.
function loadAdvisor(edition) {
  const fixture = { energy: 100, happyText: 'Happy: 5,025 / 5,025', bars: [], writes: [] };
  class Input {
    constructor(key) { this.key = key; this.type = 'number'; this._value = '0'; }
    get value() { return this._value; }
    set value(value) { this._value = value; }
    closest(selector) { return selector.startsWith('li[') ? tiles[this.key] : null; }
    dispatchEvent(event) {
      fixture.writes.push({ key: this.key, value: this.value });
      listeners.get(event.type)?.({ target: this });
    }
  }
  const listeners = new Map();
  const tiles = Object.fromEntries(['strength', 'defense', 'speed', 'dexterity'].map((key, i) => {
    const input = new Input(key);
    return [key, {
      input, value: [300, 100, 300, 400][i], className: `${key}___fixture`,
      classList: { toggle() {} }, attributes: new Map(),
      querySelector(selector) {
        return selector.includes('propertyValue') ? { textContent: this.value === null ? '' : String(this.value) } : null;
      },
      querySelectorAll: selector => selector === 'input' ? [input] : [],
      setAttribute(name, value) { this.attributes.set(name, value); },
      removeAttribute(name) { this.attributes.delete(name); }
    }];
  }));
  const nodes = new Map();
  const panel = { querySelector(selector) {
    if (!nodes.has(selector)) nodes.set(selector, {
      textContent: '', style: { setProperty() {} },
      set innerHTML(html) { this.textContent = html.replace(/<[^>]*>/g, ''); },
      insertAdjacentText(_position, text) { this.textContent += text; }
    });
    return nodes.get(selector);
  } };
  const gym = {
    get innerText() {
      return `Welcome to George's!\nYou have ${fixture.energy ?? '?'} / 150 energy available`;
    },
    querySelectorAll: () => []
  };
  const document = {
    hidden: false, activeElement: null,
    body: { get innerText() { return `${gym.innerText}\n${fixture.happyText}`; } },
    getElementById: () => panel,
    querySelector(selector) {
      if (selector === '#gymroot') return gym;
      return Object.entries(tiles).find(([key]) => selector.includes(`${key}___`))?.[1] ?? null;
    },
    querySelectorAll: selector => selector.startsWith('#barHappy') ? fixture.bars : [],
    addEventListener: (type, handler) => listeners.set(type, handler)
  };
  const source = readFileSync(join(__dirname, edition, `gym_advisor_${edition}.js`), 'utf8');
  // Expose closure state only in this VM; stop before mounting styles, observers or timers.
  const hooks = `globalThis.advisor = {
    readCurrentPage, refresh, trackTrainingCompletion, updateNativeCounts, pageContext,
    completedThisBatch, pendingTraining, manualEdits, autoAttempts,
    get nativeData() { return lastNativeData; },
    get nativePlan() { return lastNativePlan; },
    get nativePicks() { return lastNativePicks; }
  }; return;`;
  const context = { document, window: {}, module: { exports: {} },
    localStorage: { getItem: () => null }, HTMLInputElement: Input,
    Event: class { constructor(type) { this.type = type; } } };
  vm.runInNewContext(source.replace("  const style = document.createElement('style');", hooks), context);
  return { fixture, advisor: context.advisor, panel, tiles, document, listeners };
}

function resourceBar(text, attributes = {}) {
  return {
    textContent: text, closest: () => null,
    matches: selector => selector === '[aria-valuenow]' && 'aria-valuenow' in attributes,
    querySelector: () => null,
    getAttribute: name => attributes[name] ?? null
  };
}

for (const edition of ['web', 'pda']) {
  for (const current of ['5,025', '99,999', '0']) {
    test(`${edition}: current happiness ${current} outside gymroot, not maximum`, () => {
      const { fixture, advisor } = loadAdvisor(edition);
      fixture.happyText = '';
      fixture.bars = [resourceBar(`${current} / 10,000`)];
      const page = advisor.readCurrentPage();
      assert.equal(page.happy, Number(current.replaceAll(',', '')));
      assert.equal(page.happyEstimated, false);
    });
  }

  test(`${edition}: labelled sidebar text and resource attributes use current values`, () => {
    const { fixture, advisor } = loadAdvisor(edition);
    fixture.happyText = 'Happiness\n99,999 / 5,025';
    assert.equal(advisor.readCurrentPage().happy, 99999);
    fixture.bars = [resourceBar('5,025', { 'aria-valuenow': '1234', 'aria-valuemax': '5025' })];
    assert.equal(advisor.readCurrentPage().happy, 1234);
    fixture.bars = [resourceBar('', { title: 'Happy: 2,000 / 5,025' })];
    assert.equal(advisor.readCurrentPage().happy, 2000);
    fixture.bars = [resourceBar('99,999 / 5,025', { 'aria-valuenow': '100', 'aria-valuemax': '100' })];
    assert.equal(advisor.readCurrentPage().happy, 99999);
    fixture.happyText = '';
    fixture.bars = [resourceBar('', { 'aria-valuenow': '100', 'aria-valuemax': '100' })];
    assert.equal(advisor.readCurrentPage().happyEstimated, true);
  });

  test(`${edition}: fallback gives recommendations; warning disappears on recovery`, () => {
    const { fixture, advisor, panel } = loadAdvisor(edition);
    fixture.happyText = '';
    fixture.bars = [resourceBar('Maximum happiness: 5,025')];
    advisor.refresh();
    assert.equal(advisor.nativeData.happy, 5025);
    assert.equal(advisor.nativeData.happyEstimated, true);
    assert.ok(advisor.nativePlan.used > 0);
    assert.match(panel.querySelector('.tga-meta').textContent, /Happy unavailable · estimating at 5,025/);
    fixture.happyText = 'Happy: 5,025 / 5,025';
    advisor.refresh();
    assert.equal(advisor.nativeData.happyEstimated, false);
    assert.doesNotMatch(panel.querySelector('.tga-meta').textContent, /Happy|estimating/);
  });

  test(`${edition}: happiness changes recalculate plans and gain previews`, () => {
    const { fixture, advisor, tiles } = loadAdvisor(edition);
    advisor.refresh();
    const plan = advisor.nativePlan;
    // Hold a user-entered train count fixed so the preview change measures happiness.
    tiles.strength.input.value = '1';
    advisor.manualEdits.set('strength', advisor.pageContext(advisor.nativeData));
    advisor.refresh();
    const gain = tiles.strength.attributes.get('data-tga-gain');
    fixture.happyText = 'Happy: 99,999 / 5,025';
    advisor.refresh();
    assert.equal(advisor.nativeData.happy, 99999);
    assert.notEqual(advisor.nativePlan, plan);
    assert.notEqual(tiles.strength.attributes.get('data-tga-gain'), gain);
    advisor.refresh();
    assert.equal(advisor.nativeData.happy, 99999);
  });

  test(`${edition}: gradual regeneration resets a batch only after meaningful net gain`, () => {
    const { advisor } = loadAdvisor(edition);
    const page = energy => ({ energy, gym: { energy: 10 }, stats: {} });
    advisor.trackTrainingCompletion(page(0));
    advisor.completedThisBatch.add('strength');
    for (const energy of [0, 5, 5, 10, 15, 15]) {
      advisor.trackTrainingCompletion(page(energy));
      assert.ok(advisor.completedThisBatch.has('strength'));
    }
    advisor.trackTrainingCompletion(page(null));
    assert.ok(advisor.completedThisBatch.has('strength'));
    advisor.trackTrainingCompletion(page(20));
    assert.equal(advisor.completedThisBatch.size, 0);
  });

  test(`${edition}: energy spending restarts accumulation; large replenishment resets`, () => {
    const { advisor } = loadAdvisor(edition);
    const page = energy => ({ energy, gym: { energy: 10 }, stats: {} });
    advisor.trackTrainingCompletion(page(0));
    advisor.completedThisBatch.add('strength');
    for (const energy of [15, 10, 20, 25]) advisor.trackTrainingCompletion(page(energy));
    assert.ok(advisor.completedThisBatch.has('strength'));
    advisor.trackTrainingCompletion(page(30));
    assert.equal(advisor.completedThisBatch.size, 0);
    advisor.completedThisBatch.add('strength');
    advisor.trackTrainingCompletion(page(130));
    assert.equal(advisor.completedThisBatch.size, 0);
  });

  test(`${edition}: recommendations resume after a regenerated batch`, () => {
    const { fixture, advisor } = loadAdvisor(edition);
    advisor.refresh();
    for (const key of ['strength', 'speed', 'dexterity']) advisor.completedThisBatch.add(key);
    advisor.refresh();
    assert.equal(advisor.nativePlan.used, 0);
    for (const energy of [105, 110, 115]) {
      fixture.energy = energy;
      advisor.refresh();
      assert.equal(advisor.nativePlan.used, 0);
    }
    fixture.energy = 120;
    advisor.refresh();
    assert.ok(advisor.nativePlan.used > 0);
  });

  test(`${edition}: only confirmed energy-and-stat changes complete training`, () => {
    const { advisor } = loadAdvisor(edition);
    const before = { energy: 100, gym: { energy: 10 }, stats: { strength: 300 } };
    advisor.trackTrainingCompletion(before);
    advisor.pendingTraining.set('strength', { before, at: Date.now() });
    advisor.trackTrainingCompletion({ ...before, energy: 90 });
    assert.equal(advisor.completedThisBatch.size, 0);
    advisor.trackTrainingCompletion({ ...before, energy: 90, stats: { strength: 301 } });
    assert.ok(advisor.completedThisBatch.has('strength'));
    assert.equal(advisor.pendingTraining.size, 0);
    advisor.trackTrainingCompletion({ ...before, energy: 90, stats: { strength: 301 } });
    assert.ok(advisor.completedThisBatch.has('strength'));
  });

  for (const missing of ['stats', 'energy']) {
    test(`${edition}: missing ${missing} invalidates autofill and recovers safely`, () => {
      const { fixture, advisor, tiles } = loadAdvisor(edition);
      advisor.refresh();
      const originalPlan = advisor.nativePlan;
      const manualValue = tiles.strength.input.value;
      advisor.manualEdits.set('strength', advisor.pageContext(advisor.nativeData));
      if (missing === 'stats') tiles.speed.value = null;
      else fixture.energy = null;
      fixture.writes.length = 0;
      advisor.refresh();
      assert.equal(advisor.nativePlan, null);
      assert.equal(advisor.nativeData, null);
      assert.equal(advisor.nativePicks, null);
      assert.equal(advisor.autoAttempts.size, 0);
      assert.ok(advisor.manualEdits.has('strength'));
      advisor.refresh(); // Previously this reused the old allocation.
      assert.equal(fixture.writes.length, 0);
      assert.equal(tiles.strength.attributes.has('data-tga-gain'), false);
      tiles.speed.value = 300;
      fixture.energy = 100;
      tiles.speed.input.value = '0';
      advisor.refresh();
      assert.ok(advisor.nativePlan.used > 0);
      assert.notEqual(advisor.nativePlan, originalPlan);
      assert.equal(tiles.strength.input.value, manualValue);
      assert.ok(advisor.manualEdits.has('strength'));
      assert.ok(fixture.writes.some(write => write.key === 'speed'));
    });
  }

  test(`${edition}: manual edits during incomplete readings survive recovery`, () => {
    const { fixture, advisor, tiles, listeners } = loadAdvisor(edition);
    advisor.refresh();
    fixture.energy = null;
    advisor.refresh();
    tiles.strength.input.value = '7';
    listeners.get('input')({ target: tiles.strength.input });
    advisor.refresh();
    fixture.energy = 100;
    advisor.refresh();
    assert.equal(tiles.strength.input.value, '7');
    assert.equal(advisor.manualEdits.get('strength'), advisor.pageContext(advisor.nativeData));
  });
}
