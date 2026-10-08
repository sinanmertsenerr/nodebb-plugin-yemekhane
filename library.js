'use strict';

const nconf = nodebb.require('nconf');
const winston = nodebb.require('winston');
const meta = nodebb.require('./src/meta');
const user = nodebb.require('./src/user');
const languages = nodebb.require('./src/languages');
const routeHelpers = nodebb.require('./src/routes/helpers');

const menu = require('./lib/menu');
const Yemekhane = require('./static/lib/render');

const plugin = module.exports;
const strings = new Map();
let app;
let seq = 0;

// Menünün kendi sayfası: arama motorları "yemekhane menüsü" aramasında bu adresi bulur.
// Bileşenin başlığı buraya bağlanır.
const PAGE_PATH = '/yemekhane';
const WEEK_DAYS = 6;
const HTML_ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' };
const escapeHtml = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => HTML_ESC[c]);

plugin.init = async function (params) {
	app = params.app;
	routeHelpers.setupAdminPageRoute(params.router, '/admin/plugins/yemekhane', renderAdminPage);
	routeHelpers.setupPageRoute(params.router, PAGE_PATH, [], (req, res, next) => renderPage(req, res).catch(next));
};

// /api/v3/plugins/yemekhane/aylar/:ay — okuma herkese açık, yazma ve silme sadece yöneticiye
plugin.addApiRoutes = async function ({ router, middleware, helpers }) {
	const adminOnly = [middleware.ensureLoggedIn, requireAdmin(helpers)];

	routeHelpers.setupApiRoute(router, 'get', '/yemekhane/aylar/:ay', [], async (req, res) => {
		const data = await menu.getMonth(req.params.ay);
		if (!data) {
			return helpers.formatApiResponse(404, res);
		}
		helpers.formatApiResponse(200, res, publicMonth(data));
	});

	routeHelpers.setupApiRoute(router, 'put', '/yemekhane/aylar/:ay', adminOnly, async (req, res) => {
		const summary = await menu.saveMonth(req.params.ay, req.body, req.uid);
		winston.info(`[plugin/yemekhane] uid ${req.uid} saved ${summary.ay} (${summary.gunSayisi} days)`);
		helpers.formatApiResponse(200, res, summary);
	});

	routeHelpers.setupApiRoute(router, 'put', '/yemekhane/saatler', adminOnly, async (req, res) => {
		const hours = await menu.saveHours(req.body);
		winston.info(`[plugin/yemekhane] uid ${req.uid} saved meal hours`);
		helpers.formatApiResponse(200, res, hours);
	});

	routeHelpers.setupApiRoute(router, 'delete', '/yemekhane/aylar/:ay', adminOnly, async (req, res) => {
		await menu.deleteMonth(req.params.ay);
		winston.info(`[plugin/yemekhane] uid ${req.uid} deleted ${req.params.ay}`);
		helpers.formatApiResponse(200, res);
	});
};

plugin.addAdminNavigation = async function (header) {
	header.plugins.push({
		route: '/plugins/yemekhane',
		icon: 'fa-utensils',
		name: 'Yemekhane',
	});
	return header;
};

plugin.defineWidgets = async function (widgets) {
	const lang = meta.config.defaultLang || 'en-GB';
	const t = await getStrings(lang);
	widgets.push({
		widget: 'yemekhane',
		name: t['widget.name'],
		description: t['widget.description'],
		content: await app.renderAsync('admin/plugins/yemekhane/widget', { _i18n: languages.getFull(lang) }),
	});
	return widgets;
};

plugin.renderWidget = async function (widget) {
	const home = isHomeRequest(widget.req);
	if (widget.data.onlyHome === 'on' && !home) {
		return null;
	}
	const st = await buildState({
		lang: getLang(widget),
		title: widget.data.title || '',
		opts: {
			hideBreakfast: widget.data.hideBreakfast === 'on',
			hidePrices: widget.data.hidePrices === 'on',
		},
		hideCategories: home && widget.data.hideCategories === 'on',
		pageUrl: `${nconf.get('relative_path')}${PAGE_PATH}`,
	});
	if (!st) {
		return null;
	}
	widget.html = Yemekhane.section(st);
	return widget;
};

// Bileşenin ve sayfanın ilk görünümü: sıradaki öğünün günü ve çevresindeki günler. Menü yüklenmediyse null.
async function buildState({ lang, title, opts, hideCategories, pageUrl }) {
	const available = await menu.listMonths();
	if (!available.length) {
		return null;
	}
	const hours = Yemekhane.normalizeHours(await menu.getHours());
	const slot = Yemekhane.slotNow(null, hours);
	const ay = slot.date.slice(0, 7);
	const month = await menu.getMonth(ay);
	seq = (seq + 1) % 1e6;
	const st = {
		id: `ymk-${seq}`,
		t: await getStrings(lang),
		lang,
		title,
		slot,
		hours,
		date: slot.date,
		opts,
		available,
		months: month ? { [ay]: Yemekhane.nearDays(publicMonth(month), slot.date) } : {},
		hideCategories,
		pageUrl,
	};
	st.meal = Yemekhane.defaultMeal(st);
	return st;
}

// /yemekhane: günün menüsü (bileşenle aynı, canlı, başlığı sayfanın h1'i) ve altında sonraki günler düz yazı olarak.
async function renderPage(req, res) {
	const lang = (res.locals.config && res.locals.config.userLang) || meta.config.defaultLang || 'en-GB';
	const t = await getStrings(lang);
	const st = await buildState({ lang, title: t.title, opts: {}, hideCategories: false, pageUrl: '' });
	if (st) {
		st.h1 = true;
	}
	const description = t['page.description'];
	res.locals.metaTags = [
		{ name: 'description', content: description },
		{ property: 'og:description', content: description },
		{ property: 'og:type', content: 'website' },
	];
	res.locals.linkTags = [{ rel: 'canonical', href: `${nconf.get('url')}${PAGE_PATH}` }];
	res.render('yemekhane', {
		title: t['page.title'],
		sectionHtml: st ? Yemekhane.section(st) : `<p class="ymk-empty">${escapeHtml(t['page.empty'])}</p>`,
		weekHtml: st ? await weekHtml(st) : '',
	});
}

// Üstte gösterilen günden sonraki altı gün; her öğünün ana yemekleri (her gün çıkanlar hariç)
async function weekHtml(st) {
	const dates = Array.from({ length: WEEK_DAYS }, (_, i) => Yemekhane.addDays(st.slot.date, i + 1));
	const ays = [...new Set(dates.map(d => d.slice(0, 7)))].filter(ay => st.available.includes(ay));
	const months = new Map(await Promise.all(ays.map(async ay => [ay, await menu.getMonth(ay)])));
	const days = dates.map((date) => {
		const month = months.get(date.slice(0, 7));
		return { date, day: month && month.gunler && month.gunler[date] };
	}).filter(x => x.day);
	if (!days.length) {
		return '';
	}
	const meals = Yemekhane.visibleMeals(st.opts);
	const mealName = { kahvalti: st.t.breakfast, ogle: st.t.lunch, aksam: st.t.dinner };
	const label = (iso) => {
		try {
			return new Intl.DateTimeFormat(st.lang, { day: 'numeric', month: 'long', weekday: 'long', timeZone: 'UTC' }).format(new Date(`${iso}T12:00:00Z`));
		} catch (err) {
			return iso;
		}
	};
	return `<section class="ymk-week" aria-labelledby="ymk-week-h">
		<h2 id="ymk-week-h">${escapeHtml(st.t['page.week'])}</h2>
		<div class="ymk-week-days">${days.map(({ date, day }) => `<article class="ymk-week-day">
			<h3><time datetime="${date}">${escapeHtml(label(date))}</time></h3>
			<dl>${meals.map((m) => {
				const items = (day[m] || []).filter(item => item.tur !== 'sabit').map(item => item.ad);
				return items.length ? `<div><dt>${escapeHtml(mealName[m])}</dt><dd>${escapeHtml(items.join(', '))}</dd></div>` : '';
			}).join('')}</dl>
		</article>`).join('')}</div>
	</section>`;
}

// ACP > Navigasyon'da "Yemekhane" seçilebilsin
plugin.addNavigation = async function (items) {
	items.push({
		route: PAGE_PATH,
		title: 'Yemekhane',
		enabled: false,
		iconClass: 'fa-utensils',
		textClass: '',
		text: 'Yemekhane',
	});
	return items;
};

async function renderAdminPage(req, res) {
	const lang = meta.config.defaultLang || 'en-GB';
	const available = await menu.listMonths();
	const months = (await Promise.all(available.map(menu.getMonth)))
		.filter(Boolean)
		.map(menu.summary)
		.reverse()
		.map(row => Object.assign(row, {
			label: monthLabel(row.ay, lang),
			updated: row.guncelleme ? dateTimeLabel(row.guncelleme, lang) : '',
		}));
	const current = Yemekhane.slotNow().today.slice(0, 7);
	const hours = Yemekhane.normalizeHours(await menu.getHours());

	res.render('admin/plugins/yemekhane', {
		hours: Yemekhane.MEALS.map(meal => ({ meal, label: `yemekhane:${{ kahvalti: 'breakfast', ogle: 'lunch', aksam: 'dinner' }[meal]}`, from: hours[meal].from, to: hours[meal].to })),
		title: 'yemekhane:admin.title',
		hideSave: true,
		months,
		currentMissing: !available.includes(current),
		currentLabel: monthLabel(current, lang),
	});
}

function requireAdmin(helpers) {
	return async function (req, res, next) {
		try {
			if (await user.isAdministrator(req.uid)) {
				return next();
			}
			helpers.formatApiResponse(403, res);
		} catch (err) {
			next(err);
		}
	};
}

// Kimin yüklediği dışarı verilmez
function publicMonth(data) {
	const copy = Object.assign({}, data);
	delete copy.guncelleyen;
	return copy;
}

// Ana sayfa isteği mi? NodeBB "/" adresini içeride /categories'e çevirir, asıl adres originalUrl'de kalır
function isHomeRequest(req) {
	if (!req) {
		return false;
	}
	const relativePath = nconf.get('relative_path') || '';
	let path = String(req.originalUrl || '').split('?')[0];
	if (relativePath && path.startsWith(relativePath)) {
		path = path.slice(relativePath.length);
	}
	path = path.replace(/^\/api(?=\/|$)/, '');
	return path === '' || path === '/';
}

function getLang(widget) {
	const config = (widget.templateData && widget.templateData.config) || {};
	return config.userLang || meta.config.defaultLang || 'en-GB';
}

async function getStrings(lang) {
	if (!strings.has(lang)) {
		let t;
		try {
			t = await languages.get(lang, 'yemekhane');
		} catch (err) {
			t = null;
		}
		if (!t || !Object.keys(t).length) {
			t = lang === 'en-GB' ? {} : await getStrings('en-GB');
		}
		strings.set(lang, t);
	}
	return strings.get(lang);
}

function monthLabel(ay, lang) {
	const date = new Date(`${ay}-15T12:00:00Z`);
	try {
		return new Intl.DateTimeFormat(lang, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
	} catch (err) {
		return ay;
	}
}

function dateTimeLabel(ms, lang) {
	try {
		return new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Istanbul' }).format(new Date(ms));
	} catch (err) {
		return new Date(ms).toISOString();
	}
}
