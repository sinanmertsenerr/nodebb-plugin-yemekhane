'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// NodeBB olmadan çalışsın diye veritabanı ve pubsub bellekte taklit edilir
const store = new Map();
const zsets = new Map();
const listeners = new Map();
global.nodebb = {
	require(name) {
		if (name === './src/database') {
			return {
				get: async key => (store.has(key) ? store.get(key) : null),
				set: async (key, value) => { store.set(key, value); },
				delete: async (key) => { store.delete(key); },
				sortedSetAdd: async (key, score, value) => {
					const set = zsets.get(key) || new Map();
					set.set(value, score);
					zsets.set(key, set);
				},
				sortedSetRemove: async (key, value) => { (zsets.get(key) || new Map()).delete(value); },
				getSortedSetRange: async key => [...(zsets.get(key) || new Map()).entries()]
					.sort((a, b) => a[1] - b[1]).map(e => e[0]),
			};
		}
		if (name === './src/pubsub') {
			return {
				on: (event, fn) => listeners.set(event, fn),
				publish: (event, data) => listeners.get(event)(data),
			};
		}
		throw new Error(`unexpected require ${name}`);
	},
};

const menu = require('../lib/menu');
const example = require(path.join(__dirname, '../examples/2026-09.json'));

const clone = obj => JSON.parse(JSON.stringify(obj));

beforeEach(() => {
	store.clear();
	zsets.clear();
});

test('örnek ay geçerli ve değişmeden kalır', () => {
	const out = menu.validate('2026-09', clone(example));
	assert.deepEqual(out.gunler, example.gunler);
	assert.deepEqual(out.fiyat, example.fiyat);
	assert.equal(out.etiketler.kahvalti, 'Yurt');
});

test('bilinmeyen alanlar atılır, boşluklar toparlanır', () => {
	const input = { ay: '2026-10', fazla: 1, gunler: { '2026-10-01': { ogle: [{ ad: '  Mercimek   Çorbası ', kcal: '150', tur: 'x', ekstra: true }] } } };
	const out = menu.validate('2026-10', input);
	assert.equal(out.fazla, undefined);
	assert.deepEqual(out.gunler['2026-10-01'].ogle, [{ ad: 'Mercimek Çorbası', kcal: '150', tur: 'yan' }]);
	assert.deepEqual(out.gunler['2026-10-01'].kahvalti, []);
});

test('hatalı girdiler anlaşılır hata verir', () => {
	const day = { ogle: [{ ad: 'Pilav', kcal: 250, tur: 'yan' }] };
	assert.throws(() => menu.validate('2026-13', { gunler: { '2026-13-01': day } }), /invalid-month/);
	assert.throws(() => menu.validate('2026-09', { ay: '2026-10', gunler: { '2026-09-01': day } }), /month-mismatch/);
	assert.throws(() => menu.validate('2026-09', { gunler: { '2026-09-31': day } }), /bad-day/);
	assert.throws(() => menu.validate('2026-09', { gunler: { '2026-10-01': day } }), /bad-day/);
	assert.throws(() => menu.validate('2026-09', { gunler: {} }), /no-days/);
	assert.throws(() => menu.validate('2026-09', { gunler: { '2026-09-01': { ogle: [{ ad: 'Pilav', kcal: '12a' }] } } }), /bad-kcal/);
	assert.throws(() => menu.validate('2026-09', { gunler: { '2026-09-01': { ogle: [{ ad: '' }] } } }), /bad-length/);
	assert.throws(() => menu.validate('2026-09', { kaynak: 'javascript:alert(1)', gunler: { '2026-09-01': day } }), /bad-source/);
});

test('kaydet, oku, listele, sil', async () => {
	const summary = await menu.saveMonth('2026-09', clone(example), 1);
	assert.equal(summary.gunSayisi, 30);
	assert.deepEqual(await menu.listMonths(), ['2026-09']);
	const saved = await menu.getMonth('2026-09');
	assert.equal(saved.guncelleyen, 1);
	assert.deepEqual(saved.gunler, example.gunler);
	await menu.deleteMonth('2026-09');
	assert.deepEqual(await menu.listMonths(), []);
	assert.equal(await menu.getMonth('2026-09'), null);
});
