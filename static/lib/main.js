'use strict';

// Sunucunun çizdiği menüyü canlandırır: gün okları, öğün sekmeleri, başka ayın menüsünü getirme
(function () {
	const instances = new Set();

	function monthURL(ay) {
		const base = (window.config && window.config.relative_path) || '';
		return `${base}/api/v3/plugins/yemekhane/aylar/${encodeURIComponent(ay)}`;
	}

	function mount(root) {
		const Y = window.Yemekhane;
		const stateEl = root.querySelector('.ymk-state');
		if (!Y || !stateEl) {
			return;
		}
		let saved;
		try {
			saved = JSON.parse(stateEl.textContent);
		} catch (err) {
			return;
		}
		root.dataset.mounted = '1';

		const st = Object.assign(saved, { id: root.id, slot: Y.slotNow() });
		st.date = st.slot.date;
		st.meal = Y.defaultMeal(st);
		const $ = sel => root.querySelector(sel);
		const meals = $('.ymk-meals');

		function update() {
			$('.ymk-day').innerHTML = Y.dayLabelHTML(st);
			$('.ymk-arrow[data-dir="-1"]').disabled = !Y.canGo(st, -1);
			$('.ymk-arrow[data-dir="1"]').disabled = !Y.canGo(st, 1);
			const back = $('.ymk-today');
			back.hidden = st.date === st.slot.date;
			back.textContent = st.slot.date === st.slot.today ? st.t.today : st.t.tomorrow;
			$('.ymk-tabs').innerHTML = Y.tabsHTML(st);
			meals.innerHTML = Y.mealsHTML(st);
			$('.ymk-extra').innerHTML = Y.extraHTML(st);
		}

		// Ayın tamamını bir kez getirir; aynı anda gelen istekler tek isteği bekler
		const pending = {};
		function loadMonth(ay) {
			const current = st.months[ay];
			if (!st.available.includes(ay) || (current !== undefined && !(current && current.partial))) {
				return Promise.resolve();
			}
			if (!pending[ay]) {
				pending[ay] = fetch(monthURL(ay), { credentials: 'same-origin', headers: { accept: 'application/json' } })
					.then(res => (res.ok ? res.json() : null))
					.then((body) => {
						st.months[ay] = body && body.response ? body.response : failed(current);
					})
					.catch(() => {
						st.months[ay] = failed(current);
					})
					.finally(() => {
						delete pending[ay];
					});
			}
			return pending[ay];
		}

		// Getirme başarısızsa eldeki günlerle devam edilir, sonsuz "getiriliyor" kalmaz
		function failed(current) {
			return current ? Object.assign({}, current, { partial: false }) : null;
		}

		// Kısa bir soluklaşma ile yeni günü çizer; başka ayın verisi gerekiyorsa önce onu getirir
		async function go(date) {
			st.date = date;
			st.meal = Y.mealFor(st, date);
			meals.classList.add('is-busy');
			update();
			const ay = date.slice(0, 7);
			if (Y.dayState(st, date) === 'loading') {
				await loadMonth(ay);
				if (st.date.slice(0, 7) === ay) {
					update();
				}
			}
			requestAnimationFrame(() => meals.classList.remove('is-busy'));
		}

		function refreshSlot() {
			const slot = Y.slotNow();
			if (slot.date === st.slot.date && slot.meal === st.slot.meal) {
				return;
			}
			const wasDefault = st.date === st.slot.date;
			st.slot = slot;
			if (wasDefault) {
				go(slot.date);
			} else {
				update();
			}
		}

		root.addEventListener('click', (e) => {
			const arrow = e.target.closest('.ymk-arrow');
			const tab = e.target.closest('.ymk-tab');
			const prices = e.target.closest('.ymk-alc-toggle');
			if (prices) {
				st.pricesOpen = !st.pricesOpen;
				prices.setAttribute('aria-expanded', st.pricesOpen);
				prices.closest('.ymk-price').classList.toggle('is-open', st.pricesOpen);
			} else if (arrow && !arrow.disabled) {
				go(Y.addDays(st.date, Number(arrow.dataset.dir)));
			} else if (e.target.closest('.ymk-today')) {
				st.userMeal = null;
				go(st.slot.date);
			} else if (tab) {
				st.meal = tab.dataset.meal;
				st.userMeal = st.meal;
				update();
			}
		});

		// Oklara yaklaşınca ayın tamamı önceden gelsin, tıklayınca beklemek gerekmesin
		const nav = $('.ymk-nav');
		const prefetch = () => loadMonth(st.date.slice(0, 7));
		nav.addEventListener('pointerenter', prefetch, { once: true });
		nav.addEventListener('focusin', prefetch, { once: true });

		// Sekmelerde ok tuşlarıyla gezinme (WAI-ARIA sekme kalıbı)
		root.addEventListener('keydown', (e) => {
			if (!e.target.closest('.ymk-tab') || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) {
				return;
			}
			const list = Y.visibleMeals(st.opts);
			const i = list.indexOf(st.meal);
			st.meal = list[(i + (e.key === 'ArrowRight' ? 1 : list.length - 1)) % list.length];
			st.userMeal = st.meal;
			update();
			$(`#${st.id}-t-${st.meal}`).focus();
		});

		// Sunucu başka saatte çizmiş olabilir (önbellek, geri tuşu): tarayıcı saatiyle yeniden çiz
		update();
		instances.add({ root, refreshSlot });
	}

	function mountAll() {
		document.querySelectorAll('.ymk[data-ymk]:not([data-mounted])').forEach(mount);
	}

	// Sekme uzun süre açık kaldıysa geri gelince "Şimdi" doğru öğünü göstersin
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState !== 'visible') {
			return;
		}
		instances.forEach((inst) => {
			if (!inst.root.isConnected) {
				instances.delete(inst);
			} else {
				inst.refreshSlot();
			}
		});
	});

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', mountAll);
	} else {
		mountAll();
	}
	if (window.jQuery) {
		window.jQuery(window).on('action:ajaxify.end', mountAll);
	}
}());
