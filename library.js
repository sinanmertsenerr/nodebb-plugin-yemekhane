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

plugin.init = async function (params) {
	app = params.app;
	routeHelpers.setupAdminPageRoute(params.router, '/admin/plugins/yemekhane', renderAdminPage);
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
	const available = await menu.listMonths();
	if (!available.length) {
		return null;
	}

	const slot = Yemekhane.slotNow();
	const ay = slot.date.slice(0, 7);
	const month = await menu.getMonth(ay);
	const lang = getLang(widget);
	seq = (seq + 1) % 1e6;

	const st = {
		id: `ymk-${seq}`,
		t: await getStrings(lang),
		lang,
		title: widget.data.title || '',
		slot,
		date: slot.date,
		opts: {
			hideBreakfast: widget.data.hideBreakfast === 'on',
			hidePrices: widget.data.hidePrices === 'on',
		},
		available,
		months: month ? { [ay]: publicMonth(month) } : {},
		hideCategories: home && widget.data.hideCategories === 'on',
	};
	st.meal = Yemekhane.defaultMeal(st);
	widget.html = Yemekhane.section(st);
	return widget;
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

	res.render('admin/plugins/yemekhane', {
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
