<div class="acp-page-container yemekhane-admin">
	<!-- IMPORT admin/partials/settings/header.tpl -->

	<div class="row m-0">
		<div class="col-12 col-lg-8 px-0 mb-4">
			{{{ if currentMissing }}}
			<div class="alert alert-warning mt-3">{{tx("yemekhane:admin.current-missing", currentLabel)}}</div>
			{{{ end }}}

			<h5 class="fw-bold tracking-tight settings-header">{{tx("yemekhane:admin.upload")}}</h5>
			<p class="text-secondary">{{tx("yemekhane:admin.upload-help")}}</p>
			<input type="file" class="form-control" id="yemekhane-file" accept=".json,application/json">

			<div id="yemekhane-preview" class="card card-body mt-3" hidden>
				<p class="fw-semibold mb-2" data-field="summary"></p>
				<p class="text-warning-emphasis mb-3" data-field="overwrite" hidden>{{tx("yemekhane:admin.overwrite")}}</p>
				<div>
					<button type="button" class="btn btn-primary btn-sm fw-semibold" id="yemekhane-save">{{tx("yemekhane:admin.save")}}</button>
				</div>
			</div>

			<h5 class="fw-bold tracking-tight settings-header mt-5">{{tx("yemekhane:admin.months")}}</h5>
			{{{ if months.length }}}
			<div class="table-responsive">
				<table class="table table-sm align-middle">
					<thead>
						<tr>
							<th>{{tx("yemekhane:admin.month")}}</th>
							<th class="text-end pe-4">{{tx("yemekhane:admin.days")}}</th>
							<th>{{tx("yemekhane:admin.updated")}}</th>
							<th></th>
						</tr>
					</thead>
					<tbody>
						{{{ each months }}}
						<tr data-ay="{./ay}" data-label="{./label}">
							<td class="fw-semibold">{./label}</td>
							<td class="text-end pe-4">{./gunSayisi}</td>
							<td class="text-secondary">{./updated}</td>
							<td class="text-end">
								<button type="button" class="btn btn-sm btn-outline-danger" data-action="delete">{{tx("yemekhane:admin.delete")}}</button>
							</td>
						</tr>
						{{{ end }}}
					</tbody>
				</table>
			</div>
			{{{ else }}}
			<p class="text-secondary">{{tx("yemekhane:admin.no-months")}}</p>
			{{{ end }}}
		</div>

		<div class="col-12 col-lg-4 px-0 ps-lg-4">
			<h5 class="fw-bold tracking-tight settings-header">{{tx("yemekhane:admin.how")}}</h5>
			<ol class="text-secondary ps-3">
				<li class="mb-2">{{tx("yemekhane:admin.how-1")}}</li>
				<li class="mb-2">{{tx("yemekhane:admin.how-2")}}</li>
				<li class="mb-2">{{tx("yemekhane:admin.how-3")}}</li>
				<li class="mb-2">{{tx("yemekhane:admin.how-4")}}</li>
			</ol>
			<a href="https://github.com/sinanmertsenerr/nodebb-plugin-yemekhane#readme" target="_blank" rel="noopener noreferrer">{{tx("yemekhane:admin.format")}} <i class="fa fa-external-link"></i></a>
		</div>
	</div>
</div>
