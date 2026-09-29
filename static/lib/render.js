'use strict';

// Menü görünümünü HTML olarak üretir. Aynı dosya sunucuda (ilk çizim) ve tarayıcıda (gün değişince) çalışır.
(function (factory) {
	const api = factory();
	if (typeof module === 'object' && module.exports) {
		module.exports = api;
	}
	if (typeof window !== 'undefined') {
		window.Yemekhane = api;
	}
}(function () {
	const TZ = 'Europe/Istanbul';
	const MEALS = ['kahvalti', 'ogle', 'aksam'];
	const MEAL_KEY = { kahvalti: 'breakfast', ogle: 'lunch', aksam: 'dinner' };
	// Öğün saatleri (İstanbul saati). Varsayılanlar Yaşar Üniversitesi 2025-2026 Öğrenci El Kitabı'ndan;
	// yönetim sayfasından değiştirilebilir.
	const DEFAULT_HOURS = {
		kahvalti: { from: '07:00', to: '10:00' },
		ogle: { from: '12:00', to: '14:00' },
		aksam: { from: '18:30', to: '20:30' },
	};
	const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
	const MAX_DISTANCE = 62;

	const svg = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
	// Lucide ikonları (ISC lisansı)
	const ICON = {
		kahvalti: svg('<path d="M10 2v2"/><path d="M14 2v2"/><path d="M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1"/><path d="M6 2v2"/>'),
		ogle: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>'),
		aksam: svg('<path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"/>'),
		prev: svg('<path d="m15 18-6-6 6-6"/>'),
		down: svg('<path d="m6 9 6 6 6-6"/>'),
		next: svg('<path d="m9 18 6-6-6-6"/>'),
		out: svg('<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3"/>'),
	};

	const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' };
	const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ESC[c]);
	const fmt = (str, ...args) => String(str || '').replace(/%(\d)/g, (m, i) => (args[i - 1] !== undefined ? args[i - 1] : m));
	const toDate = iso => new Date(`${iso}T12:00:00Z`);

	function addDays(iso, n) {
		const d = toDate(iso);
		d.setUTCDate(d.getUTCDate() + n);
		return d.toISOString().slice(0, 10);
	}

	const daysBetween = (a, b) => Math.round((toDate(b) - toDate(a)) / 864e5);

	const minutes = hhmm => (Number(hhmm.slice(0, 2)) * 60) + Number(hhmm.slice(3, 5));

	// Eksik ya da bozuk saatler varsayılana döner
	function normalizeHours(hours) {
		const out = {};
		MEALS.forEach((m) => {
			const h = hours && hours[m];
			out[m] = h && HHMM.test(h.from) && HHMM.test(h.to) && minutes(h.from) < minutes(h.to) ?
				{ from: h.from, to: h.to } : Object.assign({}, DEFAULT_HOURS[m]);
		});
		return out;
	}

	// İstanbul saatine göre bugün ve sıradaki öğün. Öğün verilirken durum "now", öncesinde "next";
	// günün son öğünü bitince yarının kahvaltısı sıradakidir.
	function slotNow(now, hours) {
		const h = normalizeHours(hours);
		const parts = new Intl.DateTimeFormat('en-CA', {
			timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
		}).formatToParts(now || new Date());
		const get = type => parts.find(p => p.type === type).value;
		const today = `${get('year')}-${get('month')}-${get('day')}`;
		const min = (Number(get('hour')) * 60) + Number(get('minute'));
		const meal = MEALS.find(m => min < minutes(h[m].to));
		if (!meal) {
			return { today, date: addDays(today, 1), meal: MEALS[0], status: 'next' };
		}
		return { today, date: today, meal, status: min >= minutes(h[meal].from) ? 'now' : 'next' };
	}

	const visibleMeals = opts => MEALS.filter(m => !(m === 'kahvalti' && opts && opts.hideBreakfast));

	function defaultMeal(st) {
		const meals = visibleMeals(st.opts);
		return meals.includes(st.slot.meal) ? st.slot.meal : meals[0];
	}

	// Başka bir güne geçince hangi öğün açılsın: kullanıcı sekme seçtiyse o kalır;
	// seçmediyse ileri günlerde ilk öğün (sıradaki yemek kahvaltı), bugün ve geçmişte şimdiki öğün
	function mealFor(st, date) {
		const meals = visibleMeals(st.opts);
		if (date === st.slot.date) {
			return defaultMeal(st);
		}
		if (st.userMeal && meals.includes(st.userMeal)) {
			return st.userMeal;
		}
		return date > st.slot.date ? meals[0] : defaultMeal(st);
	}

	function formatter(lang, options) {
		try {
			return new Intl.DateTimeFormat(lang, Object.assign({ timeZone: 'UTC' }, options));
		} catch (err) {
			return new Intl.DateTimeFormat('en-GB', Object.assign({ timeZone: 'UTC' }, options));
		}
	}

	function monthName(st, iso) {
		const name = formatter(st.lang, { month: 'long' }).format(toDate(iso));
		return name.charAt(0).toLocaleUpperCase(st.lang) + name.slice(1);
	}

	function dayState(st, iso) {
		const ay = iso.slice(0, 7);
		const month = st.months[ay];
		if (month && month.gunler && month.gunler[iso]) {
			return 'ok';
		}
		// Sayfaya ayın sadece yakın günleri gömülür (partial); gerisi okla gidilince getirilir
		if ((month === undefined || (month && month.partial)) && st.available.includes(ay)) {
			return 'loading';
		}
		return 'none';
	}

	function canGo(st, dir) {
		const target = addDays(st.date, dir);
		if (Math.abs(daysBetween(st.slot.date, target)) > MAX_DISTANCE) {
			return false;
		}
		// Boş bir güne gelindiyse aynı yönde daha ileri gidilmez
		const side = Math.sign(daysBetween(st.slot.date, st.date));
		return !(dayState(st, st.date) === 'none' && side === dir);
	}

	function dayLabelHTML(st) {
		const text = formatter(st.lang, { day: 'numeric', month: 'long', weekday: 'long' }).format(toDate(st.date));
		const today = st.slot.today;
		const rel = {
			[today]: st.t.today,
			[addDays(today, 1)]: st.t.tomorrow,
			[addDays(today, -1)]: st.t.yesterday,
		}[st.date];
		return rel ? `<b>${esc(rel)}</b><span> · ${esc(text)}</span>` : `<span>${esc(text)}</span>`;
	}

	function tabsHTML(st) {
		return visibleMeals(st.opts).map((m) => {
			const on = m === st.meal;
			return `<button type="button" class="ymk-tab" role="tab" id="${st.id}-t-${m}" aria-controls="${st.id}-p-${m}" aria-selected="${on}" tabindex="${on ? 0 : -1}" data-meal="${m}">${esc(st.t[MEAL_KEY[m]])}</button>`;
		}).join('');
	}

	// Bu öğüne rozet düşer mi: bakılan gün sıradaki günse ve öğün sıradaki (gizli kahvaltı yerine öğle) ise
	function pillFor(st, m) {
		if (st.date !== st.slot.date || m !== defaultMeal(st)) {
			return null;
		}
		return m === st.slot.meal ? st.slot.status : 'next';
	}

	// 07:00 → 07.00 (Türkçede saat noktayla yazılır)
	function clock(st, hhmm) {
		return /^tr\b/i.test(st.lang || '') ? hhmm.replace(':', '.') : hhmm;
	}

	function mealHTML(st, m, items, tag) {
		const status = pillFor(st, m);
		const isNow = !!status;
		const hours = normalizeHours(st.hours)[m];
		const main = items.filter(i => i.tur !== 'sabit');
		const side = items.filter(i => i.tur === 'sabit').map(i => i.ad);
		const pill = status ? `<span class="ymk-now${status === 'next' ? ' is-next' : ''}">${esc(status === 'now' ? st.t.now : st.t['next-meal'])}</span>` : '';
		const list = main.length ?
			`<ul class="ymk-list">${main.map(i => `<li class="is-${esc(i.tur)}"><span class="ymk-name">${esc(i.ad)}</span>${i.kcal != null ? `<span class="ymk-kcal">${esc(fmt(st.t.kcal, i.kcal))}</span>` : ''}</li>`).join('')}</ul>` :
			`<p class="ymk-side">${esc(st.t['no-meal'])}</p>`;
		return `<article class="ymk-meal${isNow ? ' is-now' : ''}${m === st.meal ? ' is-shown' : ''}" id="${st.id}-p-${m}" role="tabpanel" aria-labelledby="${st.id}-t-${m}">
			<div class="ymk-meal-head">${ICON[m]}<span class="ymk-meal-name">${esc(st.t[MEAL_KEY[m]])}</span>${tag ? `<span class="ymk-tag">${esc(tag)}</span>` : ''}<span class="ymk-hours">${esc(clock(st, hours.from))}–${esc(clock(st, hours.to))}</span>${pill}</div>
			${list}
			${side.length ? `<p class="ymk-side">${esc(fmt(st.t.side, side.join(', ')))}</p>` : ''}
		</article>`;
	}

	function mealsHTML(st) {
		const ay = st.date.slice(0, 7);
		const state = dayState(st, st.date);
		if (state === 'loading') {
			return `<p class="ymk-empty">${esc(st.t.loading)}</p>`;
		}
		if (state === 'none') {
			const latest = st.available[st.available.length - 1];
			const later = !latest || ay > latest;
			return `<p class="ymk-empty">${esc(later ? fmt(st.t['not-uploaded'], monthName(st, st.date)) : st.t['no-day'])}</p>`;
		}
		const month = st.months[ay];
		const day = month.gunler[st.date];
		const tags = month.etiketler || {};
		return visibleMeals(st.opts).map(m => mealHTML(st, m, day[m] || [], tags[m])).join('');
	}

	function priceHTML(st, f) {
		if (!f || !f.set) {
			return '';
		}
		const [num, ...unit] = String(f.set).split(' ');
		const list = Array.isArray(f.liste) ? f.liste : [];
		const notes = Array.isArray(f.notlar) ? f.notlar : [];
		const open = !!st.pricesOpen;
		return `<div class="ymk-price${open ? ' is-open' : ''}">
			<div class="ymk-set">
				<span>${esc(st.t['set-menu'])}</span>
				<strong>${esc(num)}${unit.length ? `<small>${esc(unit.join(' '))}</small>` : ''}</strong>
				${f.cesit ? `<span>${esc(fmt(st.t['set-choice'], f.cesit))}</span>` : ''}
			</div>
			${list.length ? `<button type="button" class="ymk-alc-toggle" aria-expanded="${open}" aria-controls="${st.id}-alc">${esc(st.t['a-la-carte-prices'])}${ICON.down}</button>
			<div class="ymk-alc" id="${st.id}-alc">
				<p class="ymk-alc-title">${esc(st.t['a-la-carte'])}</p>
				<dl>${list.map(([ad, tl]) => `<div><dt>${esc(ad)}</dt><i></i><dd>${esc(tl)}</dd></div>`).join('')}</dl>
				${notes.length ? `<p class="ymk-notes">${notes.map(esc).join(' ')}</p>` : ''}
			</div>` : ''}
		</div>`;
	}

	// Fiyat ve kaynak: bakılan günün ayı, yoksa bugünün ayı
	function extraHTML(st) {
		const info = st.months[st.date.slice(0, 7)] || st.months[st.slot.date.slice(0, 7)];
		if (!info) {
			return '';
		}
		const source = /^https?:\/\//i.test(info.kaynak || '') ? info.kaynak : '';
		return `${st.opts && st.opts.hidePrices ? '' : priceHTML(st, info.fiyat)}
			<div class="ymk-foot">
				<span>${esc(st.t.allergens)}</span>
				${source ? `<a href="${esc(source)}" target="_blank" rel="noopener noreferrer">${esc(st.t['monthly-pdf'])}${ICON.out}</a>` : ''}
			</div>`;
	}

	// Tarayıcıya giden durum: </script> ile kapanmasın diye < kaçırılır
	function stateJSON(st) {
		return JSON.stringify({
			t: st.t, lang: st.lang, opts: st.opts, hours: st.hours, available: st.available, months: st.months,
		}).replace(/</g, '\\u003c');
	}

	function section(st) {
		const back = st.date !== st.slot.date;
		return `<section class="ymk" id="${st.id}" aria-labelledby="${st.id}-h" data-ymk${st.hideCategories ? ' data-hide-categories' : ''}>
			<script type="application/json" class="ymk-state">${stateJSON(st)}</script>
			<div class="ymk-head">
				<h2 id="${st.id}-h">${esc(st.title || st.t.title)}</h2>
				<span class="ymk-day" aria-live="polite">${dayLabelHTML(st)}</span>
				<span class="ymk-spacer"></span>
				<button type="button" class="ymk-today"${back ? '' : ' hidden'}>${esc(st.slot.date === st.slot.today ? st.t.today : st.t.tomorrow)}</button>
				<div class="ymk-nav">
					<button type="button" class="ymk-arrow" data-dir="-1" aria-label="${esc(st.t['prev-day'])}"${canGo(st, -1) ? '' : ' disabled'}>${ICON.prev}</button>
					<button type="button" class="ymk-arrow" data-dir="1" aria-label="${esc(st.t['next-day'])}"${canGo(st, 1) ? '' : ' disabled'}>${ICON.next}</button>
				</div>
			</div>
			<div class="ymk-tabs" role="tablist" aria-label="${esc(st.t.meals)}">${tabsHTML(st)}</div>
			<div class="ymk-meals" style="--ymk-cols: ${visibleMeals(st.opts).length}">${mealsHTML(st)}</div>
			<div class="ymk-extra">${extraHTML(st)}</div>
		</section>`;
	}

	// Bugünün iki gün öncesinden altı gün sonrasına kadarki günler; ayın geri kalanı istenince yüklenir
	function nearDays(month, date) {
		const from = addDays(date, -2);
		const to = addDays(date, 6);
		const all = Object.keys(month.gunler || {});
		const keep = all.filter(d => d >= from && d <= to);
		const gunler = {};
		keep.forEach((d) => {
			gunler[d] = month.gunler[d];
		});
		return Object.assign({}, month, { gunler }, keep.length < all.length ? { partial: true } : {});
	}

	return {
		MEALS, DEFAULT_HOURS, normalizeHours, addDays, slotNow, nearDays,
		defaultMeal, mealFor, visibleMeals, dayState, canGo,
		dayLabelHTML, tabsHTML, mealsHTML, extraHTML, section,
	};
}));
