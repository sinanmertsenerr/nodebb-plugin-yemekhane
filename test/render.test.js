'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const Y = require('../static/lib/render');
const example = require('../examples/2026-09.json');
const t = require('../languages/tr/yemekhane.json');

// İstanbul UTC+3: 07:29Z = 10:29
const at = iso => new Date(iso);

test('öğün saatleri ve durum (varsayılan: el kitabı saatleri)', () => {
	const slot = iso => Y.slotNow(at(iso));
	assert.deepEqual(slot('2026-09-26T03:59:00Z'), { today: '2026-09-26', date: '2026-09-26', meal: 'kahvalti', status: 'next' });
	assert.equal(slot('2026-09-26T04:00:00Z').status, 'now');
	assert.deepEqual([slot('2026-09-26T07:00:00Z').meal, slot('2026-09-26T07:00:00Z').status], ['ogle', 'next']);
	assert.deepEqual([slot('2026-09-26T09:00:00Z').meal, slot('2026-09-26T09:00:00Z').status], ['ogle', 'now']);
	assert.deepEqual([slot('2026-09-26T11:00:00Z').meal, slot('2026-09-26T11:00:00Z').status], ['aksam', 'next']);
	assert.deepEqual([slot('2026-09-26T15:30:00Z').meal, slot('2026-09-26T15:30:00Z').status], ['aksam', 'now']);
	assert.equal(slot('2026-09-26T17:29:00Z').status, 'now');
	assert.deepEqual(slot('2026-09-26T17:30:00Z'), { today: '2026-09-26', date: '2026-09-27', meal: 'kahvalti', status: 'next' });
	assert.deepEqual(slot('2026-09-30T21:30:00Z'), { today: '2026-10-01', date: '2026-10-01', meal: 'kahvalti', status: 'next' });
});

test('özel saatler, eksik ya da bozuk olanlar varsayılana döner', () => {
	const hours = { ogle: { from: '11:30', to: '14:30' }, aksam: { from: '21:00', to: '20:00' } };
	assert.deepEqual(Y.normalizeHours(hours), {
		kahvalti: { from: '07:00', to: '10:00' },
		ogle: { from: '11:30', to: '14:30' },
		aksam: { from: '18:30', to: '20:30' },
	});
	assert.deepEqual(Y.slotNow(at('2026-09-26T08:30:00Z'), hours), { today: '2026-09-26', date: '2026-09-26', meal: 'ogle', status: 'now' });
});

function state(slot, extra) {
	return Object.assign({
		id: 'ymk-1', t, lang: 'tr', slot: Object.assign({ status: 'now' }, slot), date: slot.date, meal: slot.meal, opts: {},
		available: ['2026-09'], months: { '2026-09': example },
	}, extra);
}

test('hafta içi öğlen: üç öğün, ana yemek ve Şimdi rozeti', () => {
	const st = state({ today: '2026-09-24', date: '2026-09-24', meal: 'ogle' });
	const html = Y.section(st);
	assert.equal((html.match(/<article class="ymk-meal/g) || []).length, 3);
	assert.match(html, /class="is-ana"><span class="ymk-name">Et Döner \+ Patates Kızartması/);
	assert.match(html, /<span class="ymk-hours">12\.00–14\.00<\/span><span class="ymk-now">Şimdi<\/span>/);
	assert.match(html, /<b>Bugün<\/b><span> · 24 Eylül <span class="ymk-wd">Perşembe<\/span><\/span>/);
	// Gün, onu değiştiren iki okun arasında
	assert.match(html, /<div class="ymk-nav">\s*<button[^>]*data-dir="-1"[\s\S]*?<\/button>\s*<span class="ymk-day"[^>]*>[\s\S]*?<\/span><\/span><\/span>\s*<button[^>]*data-dir="1"/);
	assert.match(html, /Yanında: Yoğurt\/Ayran, Mevsim Salatası, Mevsim Meyvesi \(2 Çeşit\)/);
	assert.match(html, /202,50<small>TL<\/small>/);
});

test('kahvaltı gizlenince iki sütun kalır', () => {
	const st = state({ today: '2026-09-24', date: '2026-09-24', meal: 'kahvalti' }, { opts: { hideBreakfast: true } });
	st.meal = Y.defaultMeal(st);
	const html = Y.section(st);
	assert.equal(st.meal, 'ogle');
	assert.equal((html.match(/<article class="ymk-meal/g) || []).length, 2);
	assert.match(html, /--ymk-cols: 2/);
});

test('yüklenmemiş ay: mesaj ve ileri ok kapalı', () => {
	const st = state({ today: '2026-10-01', date: '2026-10-01', meal: 'ogle' });
	assert.match(Y.mealsHTML(st), /Ekim menüsü henüz yüklenmedi\./);
	assert.equal(Y.canGo(st, -1), true);
	st.date = '2026-10-02';
	assert.equal(Y.canGo(st, 1), false);
});

test('yemek adları ve durum JSON kaçırılır', () => {
	const evil = JSON.parse(JSON.stringify(example));
	evil.gunler['2026-09-24'].ogle[1].ad = '<img src=x onerror=alert(1)>';
	evil.kaynak = 'https://example.com/"><script>';
	const html = Y.section(state({ today: '2026-09-24', date: '2026-09-24', meal: 'ogle' }, { months: { '2026-09': evil } }));
	assert.doesNotMatch(html, /<img src=x/);
	assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
	const json = html.match(/<script type="application\/json" class="ymk-state">([\s\S]*?)<\/script>/)[1];
	assert.doesNotMatch(json, /</);
	assert.equal(JSON.parse(json).months['2026-09'].gunler['2026-09-24'].ogle[1].ad, '<img src=x onerror=alert(1)>');
});

test('tek tek fiyatlar düğmesi kapalı başlar, açık durum korunur', () => {
	const st = state({ today: '2026-09-24', date: '2026-09-24', meal: 'ogle' });
	assert.match(Y.extraHTML(st), /<div class="ymk-price">[\s\S]*aria-expanded="false"[\s\S]*Tek tek fiyatlar/);
	st.pricesOpen = true;
	assert.match(Y.extraHTML(st), /<div class="ymk-price is-open">[\s\S]*aria-expanded="true"/);
	assert.doesNotMatch(Y.extraHTML(Object.assign(st, { opts: { hidePrices: true } })), /ymk-price/);
});

test('sayfaya yakın günler gömülür, uzak gün istenince getirilir', () => {
	const near = Y.nearDays(example, '2026-09-26');
	assert.deepEqual(Object.keys(near.gunler), ['2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30']);
	assert.equal(near.partial, true);
	assert.deepEqual(near.fiyat, example.fiyat);
	const st = state({ today: '2026-09-26', date: '2026-09-26', meal: 'ogle' }, { months: { '2026-09': near } });
	assert.equal(Y.dayState(st, '2026-09-26'), 'ok');
	assert.equal(Y.dayState(st, '2026-09-10'), 'loading');
	assert.equal(Y.canGo(st, -1), true);
	assert.equal(Y.nearDays(example, '2026-09-26').gunler['2026-09-23'], undefined);
	assert.equal(Y.nearDays({ gunler: { '2026-09-26': {} } }, '2026-09-26').partial, undefined);
});

test('gün değişince açılan öğün', () => {
	const st = state({ today: '2026-09-26', date: '2026-09-26', meal: 'aksam' });
	assert.equal(Y.mealFor(st, '2026-09-27'), 'kahvalti');
	assert.equal(Y.mealFor(st, '2026-09-25'), 'aksam');
	assert.equal(Y.mealFor(st, '2026-09-26'), 'aksam');
	st.userMeal = 'ogle';
	assert.equal(Y.mealFor(st, '2026-09-27'), 'ogle');
	assert.equal(Y.mealFor(st, '2026-09-26'), 'aksam');
	st.userMeal = null;
	st.opts = { hideBreakfast: true };
	assert.equal(Y.mealFor(st, '2026-09-27'), 'ogle');
});

test('rozet: sıradaki öğün, gizli kahvaltıda öğle', () => {
	const st = state({ today: '2026-09-26', date: '2026-09-27', meal: 'kahvalti', status: 'next' });
	let html = Y.mealsHTML(Object.assign(st, { date: '2026-09-27' }));
	assert.match(html, /id="ymk-1-p-kahvalti"[\s\S]*?<span class="ymk-now is-next">Sıradaki<\/span>/);
	assert.equal((html.match(/ymk-now/g) || []).length, 1);
	st.opts = { hideBreakfast: true };
	st.meal = Y.defaultMeal(st);
	html = Y.mealsHTML(st);
	assert.match(html, /id="ymk-1-p-ogle"[\s\S]*?<span class="ymk-now is-next">Sıradaki<\/span>/);
	st.date = '2026-09-28';
	assert.doesNotMatch(Y.mealsHTML(st), /ymk-now/);
	assert.match(Y.mealsHTML(Object.assign(st, { lang: 'en-GB' })), /<span class="ymk-hours">12:00–14:00<\/span>/);
});

test('gün adı ayrı parçada, dilin sırasıyla', () => {
	const tr = state({ today: '2026-10-04', date: '2026-10-07', meal: 'ogle' });
	assert.equal(Y.dayLabelHTML(tr), '<span>7 Ekim <span class="ymk-wd">Çarşamba</span></span>');
	const en = Object.assign(state({ today: '2026-10-04', date: '2026-10-07', meal: 'ogle' }), { lang: 'en-GB', t: require('../languages/en-GB/yemekhane.json') });
	assert.equal(Y.dayLabelHTML(en), '<span><span class="ymk-wd">Wednesday</span> 7 October</span>');
});
