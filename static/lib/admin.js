'use strict';

// Yönetim sayfası: JSON seç, özetini gör, kaydet; yüklü ayları sil
define('admin/plugins/yemekhane', ['api', 'alerts', 'translator', 'bootbox'], function (api, alerts, translator, bootbox) {
	const Admin = {};
	let pending = null;

	const tr = str => translator.translate(str);
	// [[...]] içinde virgül ve köşeli parantez ayırıcı sayılır
	const arg = value => String(value).replace(/[,[\]]/g, ' ');

	function monthLabel(ay) {
		const lang = (window.config && (config.acpLang || config.userLang)) || 'en-GB';
		try {
			return new Intl.DateTimeFormat(lang, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${ay}-15T12:00:00Z`));
		} catch (err) {
			return ay;
		}
	}

	Admin.init = function () {
		const page = document.querySelector('.yemekhane-admin');
		const input = document.getElementById('yemekhane-file');
		const saveBtn = document.getElementById('yemekhane-save');
		if (!page || !input || !saveBtn) {
			return;
		}

		input.addEventListener('change', () => onFile(input));
		saveBtn.addEventListener('click', () => save(saveBtn));
		const hoursForm = document.getElementById('yemekhane-hours');
		if (hoursForm) {
			hoursForm.addEventListener('submit', (e) => {
				e.preventDefault();
				saveHours(hoursForm);
			});
		}
		page.addEventListener('click', (e) => {
			const btn = e.target.closest('[data-action="delete"]');
			if (btn) {
				confirmDelete(btn.closest('[data-ay]'));
			}
		});
	};

	async function onFile(input) {
		pending = null;
		showPreview(null);
		const file = input.files && input.files[0];
		if (!file) {
			return;
		}
		let data;
		try {
			data = JSON.parse(await file.text());
		} catch (err) {
			input.value = '';
			return alerts.error(await tr('[[yemekhane:admin.bad-json]]'));
		}
		if (!data || typeof data !== 'object' || !/^\d{4}-\d{2}$/.test(data.ay || '')) {
			input.value = '';
			return alerts.error(await tr('[[yemekhane:admin.no-month-field]]'));
		}
		pending = data;
		showPreview(data);
	}

	async function showPreview(data) {
		const box = document.getElementById('yemekhane-preview');
		if (!data) {
			box.hidden = true;
			return;
		}
		const days = Object.keys(data.gunler || {}).length;
		const row = document.querySelector(`tr[data-ay="${data.ay}"]`);
		const label = row ? row.dataset.label : monthLabel(data.ay);
		box.querySelector('[data-field="summary"]').textContent = await tr(`[[yemekhane:admin.preview, ${arg(label)}, ${days}]]`);
		box.querySelector('[data-field="overwrite"]').hidden = !row;
		box.hidden = false;
	}

	async function save(btn) {
		if (!pending) {
			return;
		}
		btn.disabled = true;
		try {
			await api.put(`/plugins/yemekhane/aylar/${encodeURIComponent(pending.ay)}`, pending);
			alerts.success(await tr('[[yemekhane:admin.saved]]'));
			ajaxify.refresh();
		} catch (err) {
			alerts.error(await tr(err.message || String(err)));
		} finally {
			btn.disabled = false;
		}
	}

	async function saveHours(form) {
		const hours = {};
		form.querySelectorAll('[data-meal]').forEach((row) => {
			hours[row.dataset.meal] = {
				from: row.querySelector('[name="from"]').value,
				to: row.querySelector('[name="to"]').value,
			};
		});
		const btn = form.querySelector('[type="submit"]');
		btn.disabled = true;
		try {
			await api.put('/plugins/yemekhane/saatler', hours);
			alerts.success(await tr('[[yemekhane:admin.hours-saved]]'));
		} catch (err) {
			alerts.error(await tr(err.message || String(err)));
		} finally {
			btn.disabled = false;
		}
	}

	async function confirmDelete(row) {
		if (!row) {
			return;
		}
		const message = await tr(`[[yemekhane:admin.confirm-delete, ${arg(row.dataset.label)}]]`);
		bootbox.confirm(message, async (ok) => {
			if (!ok) {
				return;
			}
			try {
				await api.del(`/plugins/yemekhane/aylar/${encodeURIComponent(row.dataset.ay)}`);
				alerts.success(await tr('[[yemekhane:admin.deleted]]'));
				ajaxify.refresh();
			} catch (err) {
				alerts.error(await tr(err.message || String(err)));
			}
		});
	}

	return Admin;
});
