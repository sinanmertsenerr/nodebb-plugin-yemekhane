'use strict';

const db = nodebb.require('./src/database');
const pubsub = nodebb.require('./src/pubsub');

const SET_KEY = 'yemekhane:aylar';
const HOURS_KEY = 'yemekhane:saatler';
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const monthKey = ay => `yemekhane:ay:${ay}`;

const AY = /^\d{4}-(0[1-9]|1[0-2])$/;
const GUN = /^\d{4}-\d{2}-\d{2}$/;
const KCAL = /^\d{1,4}(\/\d{1,4})?$/;
const MEALS = ['kahvalti', 'ogle', 'aksam'];
const TYPES = ['corba', 'ana', 'yan', 'tatli', 'salata', 'sabit'];

const LIMITS = { days: 31, items: 40, name: 120, tag: 30, source: 500, priceRows: 30, notes: 10, note: 200 };

// Aynı ay her sayfa açılışında veritabanından okunmasın; kaydedince bütün süreçlerde temizlenir
const cache = new Map();
pubsub.on('yemekhane:reset', (ay) => {
	cache.delete(ay);
	cache.delete('aylar');
	cache.delete('saatler');
});

const menu = module.exports;

menu.isMonth = ay => AY.test(String(ay || ''));

menu.listMonths = async function () {
	if (!cache.has('aylar')) {
		cache.set('aylar', await db.getSortedSetRange(SET_KEY, 0, -1));
	}
	return cache.get('aylar');
};

menu.getMonth = async function (ay) {
	if (!menu.isMonth(ay)) {
		return null;
	}
	if (!cache.has(ay)) {
		const raw = await db.get(monthKey(ay));
		cache.set(ay, raw ? JSON.parse(raw) : null);
	}
	return cache.get(ay);
};

menu.saveMonth = async function (ay, input, uid) {
	const data = menu.validate(ay, input);
	data.guncelleme = Date.now();
	data.guncelleyen = parseInt(uid, 10) || 0;
	await db.set(monthKey(ay), JSON.stringify(data));
	await db.sortedSetAdd(SET_KEY, Number(ay.replace('-', '')), ay);
	pubsub.publish('yemekhane:reset', ay);
	return menu.summary(data);
};

menu.deleteMonth = async function (ay) {
	if (!menu.isMonth(ay)) {
		throw new Error('[[yemekhane:error.invalid-month]]');
	}
	await db.delete(monthKey(ay));
	await db.sortedSetRemove(SET_KEY, ay);
	pubsub.publish('yemekhane:reset', ay);
};

menu.summary = function (data) {
	return {
		ay: data.ay,
		gunSayisi: Object.keys(data.gunler).length,
		guncelleme: data.guncelleme || 0,
	};
};

function fail(key, ...args) {
	const params = args.map(a => String(a).replace(/[,[\]]/g, ' ')).join(', ');
	throw new Error(`[[yemekhane:error.${key}${params ? `, ${params}` : ''}]]`);
}

function text(value, max, where) {
	if (typeof value !== 'string') {
		fail('not-text', where);
	}
	const clean = value.replace(/\s+/g, ' ').trim();
	if (!clean || clean.length > max) {
		fail('bad-length', where, max);
	}
	return clean;
}

function validItem(item, where) {
	if (!item || typeof item !== 'object') {
		fail('bad-item', where);
	}
	let kcal = item.kcal == null || item.kcal === '' ? null : item.kcal;
	if (typeof kcal === 'number') {
		if (!Number.isInteger(kcal) || kcal < 0 || kcal > 9999) {
			fail('bad-kcal', where);
		}
	} else if (kcal !== null) {
		kcal = String(kcal).trim();
		if (!KCAL.test(kcal)) {
			fail('bad-kcal', where);
		}
	}
	return {
		ad: text(item.ad, LIMITS.name, where),
		kcal,
		tur: TYPES.includes(item.tur) ? item.tur : 'yan',
	};
}

function validPrices(f) {
	if (f == null) {
		return undefined;
	}
	if (typeof f !== 'object') {
		fail('bad-prices');
	}
	const out = { set: text(f.set, 30, 'fiyat.set') };
	if (f.cesit != null) {
		const n = parseInt(f.cesit, 10);
		if (!(n >= 1 && n <= 20)) {
			fail('bad-prices');
		}
		out.cesit = n;
	}
	const list = f.liste == null ? [] : f.liste;
	if (!Array.isArray(list) || list.length > LIMITS.priceRows) {
		fail('bad-prices');
	}
	out.liste = list.map((row, i) => {
		if (!Array.isArray(row) || row.length !== 2) {
			fail('bad-prices');
		}
		return [text(row[0], 60, `fiyat.liste.${i}`), text(row[1], 30, `fiyat.liste.${i}`)];
	});
	const notes = f.notlar == null ? [] : f.notlar;
	if (!Array.isArray(notes) || notes.length > LIMITS.notes) {
		fail('bad-prices');
	}
	out.notlar = notes.map((n, i) => text(n, LIMITS.note, `fiyat.notlar.${i}`));
	return out;
}

// Yüklenen JSON'u denetler ve sadece bilinen alanları geri verir
menu.validate = function (ay, input) {
	if (!menu.isMonth(ay)) {
		fail('invalid-month');
	}
	if (!input || typeof input !== 'object' || Array.isArray(input)) {
		fail('not-object');
	}
	if (input.ay != null && input.ay !== ay) {
		fail('month-mismatch', input.ay, ay);
	}
	const days = input.gunler;
	if (!days || typeof days !== 'object' || Array.isArray(days)) {
		fail('no-days');
	}
	const keys = Object.keys(days).sort();
	if (!keys.length || keys.length > LIMITS.days) {
		fail('no-days');
	}

	const gunler = {};
	keys.forEach((gun) => {
		const date = new Date(`${gun}T12:00:00Z`);
		if (!GUN.test(gun) || !gun.startsWith(`${ay}-`) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== gun) {
			fail('bad-day', gun);
		}
		const day = days[gun];
		if (!day || typeof day !== 'object') {
			fail('bad-day', gun);
		}
		gunler[gun] = {};
		MEALS.forEach((meal) => {
			const items = day[meal] == null ? [] : day[meal];
			if (!Array.isArray(items) || items.length > LIMITS.items) {
				fail('bad-meal', `${gun} ${meal}`);
			}
			gunler[gun][meal] = items.map((item, i) => validItem(item, `${gun} ${meal} ${i + 1}`));
		});
	});

	const out = { ay, gunler };
	if (input.kaynak) {
		const source = text(input.kaynak, LIMITS.source, 'kaynak');
		if (!/^https?:\/\//i.test(source)) {
			fail('bad-source');
		}
		out.kaynak = source;
	}
	if (input.etiketler && typeof input.etiketler === 'object') {
		out.etiketler = {};
		MEALS.forEach((meal) => {
			if (input.etiketler[meal]) {
				out.etiketler[meal] = text(input.etiketler[meal], LIMITS.tag, `etiketler.${meal}`);
			}
		});
	}
	const prices = validPrices(input.fiyat);
	if (prices) {
		out.fiyat = prices;
	}
	return out;
};

// Öğün saatleri: { kahvalti: { from: '07:00', to: '10:00' }, ... }; kayıt yoksa null (varsayılan kullanılır)
menu.getHours = async function () {
	if (!cache.has('saatler')) {
		const raw = await db.get(HOURS_KEY);
		cache.set('saatler', raw ? JSON.parse(raw) : null);
	}
	return cache.get('saatler');
};

menu.saveHours = async function (input) {
	const hours = menu.validateHours(input);
	await db.set(HOURS_KEY, JSON.stringify(hours));
	pubsub.publish('yemekhane:reset', 'saatler');
	return hours;
};

const toMin = hhmm => (Number(hhmm.slice(0, 2)) * 60) + Number(hhmm.slice(3, 5));

// Her öğün için başlangıç bitişten önce olmalı, öğünler sırayla ve çakışmadan gelmeli
menu.validateHours = function (input) {
	if (!input || typeof input !== 'object') {
		fail('bad-hours', '-');
	}
	const out = {};
	let last = -1;
	MEALS.forEach((meal) => {
		const h = input[meal] || {};
		const from = String(h.from || '').trim();
		const to = String(h.to || '').trim();
		if (!HHMM.test(from) || !HHMM.test(to) || toMin(from) >= toMin(to) || toMin(from) < last) {
			fail('bad-hours', meal);
		}
		last = toMin(to);
		out[meal] = { from, to };
	});
	return out;
};
