const platformRoot =
  location.pathname === '/admin' || location.pathname.startsWith('/admin/')
    ? '/admin'
    : '';
import { fmtDate, fmtDateTime } from './customer.js';
document.querySelector('.logout-form').onsubmit = async (event) => {
  event.preventDefault();
  const button = document.querySelector('#logout');
  button.disabled = true;
  try {
    const response = await fetch(platformRoot + '/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      redirect: 'manual',
    });
    if (response.type !== 'opaqueredirect' && response.status !== 303)
      throw Error('Du kunne ikke logges ud. Prøv igen.');
    location.replace(
      platformRoot
        ? ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)
          ? '/local-login'
          : '/cdn-cgi/access/logout'
        : '/login',
    );
  } catch (error) {
    showError(error);
    button.disabled = false;
  }
};
function invitationNotice(result) {
  clear();
  message.textContent =
    result.delivery === 'sent'
      ? 'Invitationen er sendt.'
      : result.delivery === 'preview'
        ? 'Lokal mailvisning: '
        : 'Invitationen er oprettet, men leveringen kunne ikke bekræftes. Kontrollér modtagerens indbakke før du sender en ny invitation.';
  if (result.previewLink) {
    const link = el('a', 'Åbn testinvitation');
    link.href = result.previewLink;
    message.append(link);
  }
}
function userStatus(u) {
  if (u.invitation_state === 'revoked')
    return el('span', 'Invitation tilbagekaldt', 'badge inactive');
  if (u.invitation_state === 'pending')
    return el(
      'span',
      u.expires_at * 1000 < Date.now() ? 'Invitation udløbet' : 'Inviteret',
      'badge',
    );
  return badge(u.status);
}
function invitationControls(u, base, refresh) {
  return actions(
    button('Send ny invitation', () =>
      edit(
        'Send ny invitation',
        [],
        async () => {
          const result = await api(
            base + '/' + u.id + '/invitation',
            'POST',
            {},
          );
          await refresh();
          invitationNotice(result);
        },
        'Det tidligere link bliver ugyldigt. Der sendes en ny invitationsmail.',
      ),
    ),
    button('Tilbagekald', async () => {
      await api(base + '/' + u.id + '/invitation', 'DELETE', {});
      await refresh();
    }),
  );
}
async function completeProfile() {
  heading('Din profil', 'Udfyld dit navn, før du åbner administrationen.');
  content.replaceChildren();
  $('#new-company').hidden = true;
  $('#insights-tab').hidden = true;
  $('#companies-tab').hidden = true;
  $('#settings-tab').hidden = true;
  $('#catalog-tab').hidden = true;
  const form = el('form');
  for (const [name, label, required] of [
    ['name', 'Fulde navn', true],
    ['phone', 'Telefonnummer (valgfrit)', false],
  ]) {
    const row = el('label', label),
      input = el('input');
    input.name = name;
    input.required = required;
    input.maxLength = name === 'name' ? 120 : 40;
    row.append(input);
    form.append(row);
  }
  const submit = el('button', 'Gem og fortsæt');
  submit.type = 'submit';
  form.append(submit);
  form.onsubmit = async (e) => {
    e.preventDefault();
    submit.disabled = true;
    try {
      await api('/profile', 'POST', Object.fromEntries(new FormData(form)));
      location.reload();
    } catch (error) {
      showError(error);
      submit.disabled = false;
    }
  };
  content.append(form);
}
const $ = (s) => document.querySelector(s);
const content = $('#content'),
  message = $('#message');
let actor,
  companies = [],
  selected = null,
  saveEditor;
const roles = {
  admin: 'Virksomhedsadministrator',
  member: 'Medlem',
  operator: 'Operatør',
  reader: 'Læser',
};
function el(tag, value, cls) {
  const node = document.createElement(tag);
  if (value !== undefined) node.textContent = value;
  if (cls) node.className = cls;
  return node;
}
function button(label, fn, cls = 'secondary small') {
  const b = el('button', label, cls);
  b.type = 'button';
  b.onclick = () => Promise.resolve(fn()).catch(showError);
  return b;
}
function showError(error) {
  message.className = 'error';
  message.textContent = error.message;
}
function clear() {
  message.textContent = '';
  message.className = '';
}
async function api(path, method = 'GET', data) {
  const res = await fetch(platformRoot + '/api/platform' + path, {
    method,
    headers: {
      ...(data ? { 'Content-Type': 'application/json' } : {}),
      ...(actor && path !== '/support'
        ? {
            'X-Platform-Actor':
              actor.id + ':' + (actor.support?.sessionId || ''),
          }
        : {}),
    },
    body: data ? JSON.stringify(data) : undefined,
  });
  if (res.status === 401 && !platformRoot) {
    location.replace('/login');
    throw Error('Log ind igen.');
  }
  const value = await res.json();
  if (!res.ok) throw Error(value.error || 'Handlingen mislykkedes.');
  return value;
}
function heading(title, subtitle, crumb = title) {
  $('#title').textContent = title;
  $('#subtitle').textContent = subtitle;
  $('#breadcrumb').textContent = crumb;
}
function panel(title, action) {
  const box = el('div', undefined, 'panel'),
    head = el('div', undefined, 'panel-head');
  head.append(el('h2', title));
  if (action) head.append(action);
  box.append(head);
  return box;
}
function table(box, columns, rows) {
  if (!rows.length) {
    box.append(el('p', 'Ingen registreringer endnu.', 'empty'));
    return;
  }
  const wrap = el('div', undefined, 'table-wrap'),
    t = el('table'),
    head = el('tr');
  columns.forEach((c) => head.append(el('th', c)));
  const thead = el('thead');
  thead.append(head);
  t.append(thead);
  const tbody = el('tbody');
  rows.forEach((row) => {
    const tr = el('tr');
    row.forEach((value) => {
      const cell = el('td');
      cell.append(
        value instanceof Node ? value : document.createTextNode(value ?? ''),
      );
      tr.append(cell);
    });
    tbody.append(tr);
  });
  t.append(tbody);
  wrap.append(t);
  box.append(wrap);
}
function badge(status) {
  return el(
    'span',
    status === 'active' ? 'Aktiv' : 'Deaktiveret',
    'badge ' + (status === 'active' ? '' : 'inactive'),
  );
}
function actions(...buttons) {
  const a = el('div', undefined, 'actions');
  a.append(...buttons);
  return a;
}
function edit(title, fields, save, hint) {
  $('#editor-title').textContent = title;
  $('#editor-error').textContent = '';
  const container = $('#editor-fields');
  container.replaceChildren();
  if (hint) container.append(el('p', hint, 'hint'));
  for (const f of fields) {
    const label = el('label', f.label);
    let input;
    if (f.options) {
      input = el('select');
      for (const [value, text] of f.options) {
        const o = el('option', text);
        o.value = value;
        input.append(o);
      }
    } else if (f.type === 'textarea') {
      input = el('textarea');
      input.rows = 10;
      input.maxLength = f.max || 2500;
    } else {
      input = el('input');
      input.type = f.type || 'text';
      if (input.type === 'password') input.autocomplete = 'new-password';
      input.maxLength = f.max || 120;
    }
    input.name = f.name;
    input.required = f.required !== false;
    if (f.value !== undefined) input.value = f.value;
    if (f.whenProvider) label.dataset.provider = f.whenProvider;
    label.append(input);
    container.append(label);
  }
  const provider = container.querySelector('[name="provider"]');
  if (provider) {
    const update = () =>
      container.querySelectorAll('[data-provider]').forEach((label) => {
        const visible = label.dataset.provider === provider.value;
        label.hidden = !visible;
        label
          .querySelectorAll('input,select')
          .forEach((input) => (input.disabled = !visible));
      });
    provider.addEventListener('change', update);
    update();
  }
  saveEditor = save;
  $('#editor').showModal();
}
$('#editor').addEventListener('close', () => {
  $('#editor-fields').replaceChildren();
  saveEditor = null;
});
$('#cancel').onclick = () => $('#editor').close();
$('#editor-form').onsubmit = async (e) => {
  e.preventDefault();
  $('#save').disabled = true;
  try {
    await saveEditor(Object.fromEntries(new FormData(e.target)));
    $('#editor').close();
  } catch (error) {
    $('#editor-error').textContent = error.message;
  } finally {
    $('#save').disabled = false;
  }
};
const statusField = (value) => ({
  name: 'status',
  label: 'Status',
  value,
  options: [
    ['active', 'Aktiv'],
    ['inactive', 'Deaktiveret'],
  ],
});
async function listCompanies() {
  if (!actor.platformAdmin) return supportHome();
  document.body.classList.remove('menu-open');
  $('#tickets-tab').hidden = false;
  $('#companies-tab').hidden = false;
  $('#settings-tab').hidden = false;
  $('#catalog-tab').hidden = false;
  $('#catalog-tab').classList.remove('active');
  $('aside .eyebrow').textContent = 'Tier 0 · Administration';
  clear();
  selected = null;
  companies = (await api('/companies')).companies;
  heading(
    'Virksomheder',
    'Administrér virksomheder, webshops og adgang ét sted.',
  );
  $('#new-company').hidden = !actor.platformAdmin;
  $('#companies-tab').classList.add('active');
  $('#settings-tab').classList.remove('active');
  content.replaceChildren();
  const stats = el('div', undefined, 'stats');
  for (const [label, value] of [
    ['Virksomheder', companies.length],
    ['Aktive', companies.filter((c) => c.status === 'active').length],
  ]) {
    const s = el('div', undefined, 'stat');
    s.append(el('span', label), el('strong', String(value)));
    stats.append(s);
  }
  content.append(stats);
  const box = panel('Virksomheder du har adgang til');
  table(
    box,
    ['Virksomhed', 'Status', 'Adgang', ''],
    companies.map((c) => [
      c.demo
        ? actions(
            button(c.name, () => company(c), 'link'),
            el('span', 'Demokonto', 'badge demo'),
          )
        : button(c.name, () => company(c), 'link'),
      badge(c.status),
      actor.platformAdmin ? 'Platformadministrator' : roles[c.role],
      button('Åbn →', () => company(c)),
    ]),
  );
  content.append(box);
}
$('#new-company').onclick = () =>
  edit(
    'Opret virksomhed',
    [{ name: 'name', label: 'Virksomhedsnavn' }],
    async (data) => {
      await api('/companies', 'POST', data);
      await listCompanies();
    },
  );
function startSupport(c, users) {
  edit(
    'Åbn kundeportal · ' + c.name,
    [
      ...(users.length > 1
        ? [
            {
              name: 'userId',
              label: 'Se portalen som',
              value: users.find((u) => u.role === 'admin')?.id || users[0].id,
              options: users.map((u) => [
                u.id,
                (u.full_name || u.email) + ' · ' + u.email,
              ]),
            },
          ]
        : []),
      { name: 'reason', label: 'Kort årsag til supportadgang' },
    ],
    async (data) => {
      await api('/support', 'POST', {
        companyId: c.id,
        userId: data.userId || users[0].id,
        reason: data.reason,
      });
      location.assign(platformRoot + '/kundeportal/');
    },
    'Kundeportalen åbnes med brugerens adgang i op til 30 minutter og kan kun ses, ikke ændres. Adgangen registreres med din administratoridentitet.',
  );
}
async function supportHome() {
  clear();
  if (!actor.support) {
    location.assign('/');
    return;
  }
  heading(
    'Supportadgang aktiv',
    'Du ser kundeportalen som ' + actor.email + '.',
    'Supportadgang',
  );
  content.replaceChildren(
    el(
      'p',
      'Supportadgangen gælder alle faner, indtil den afsluttes eller udløber.',
      'intro',
    ),
    actions(
      button(
        'Åbn kundeportal',
        () => location.assign(platformRoot + '/kundeportal/'),
        'primary',
      ),
      button('Afslut supportadgang', async () => {
        await api('/support', 'DELETE', {});
        location.reload();
      }),
    ),
  );
}
async function refreshCompany(c) {
  await company(c);
}
async function company(c) {
  clear();
  selected = c;
  $('#new-company').hidden = true;
  heading(
    c.name,
    'Webshops og adgang for den valgte virksomhed.',
    'Virksomheder / ' + c.name,
  );
  const canManage = actor.platformAdmin || c.role === 'admin';
  const [shopData, memberData] = await Promise.all([
    api(`/companies/${c.id}/webshops`),
    canManage
      ? api(`/companies/${c.id}/members`)
      : Promise.resolve({ members: [], grants: [] }),
  ]);
  const shops = shopData.webshops;
  content.replaceChildren();
  const portalUsers = memberData.members.filter(
    (u) =>
      u.status === 'active' &&
      (!u.invitation_state || u.invitation_state === 'accepted'),
  );
  content.append(
    button('← Alle virksomheder', listCompanies, 'secondary back'),
    ...(actor.platformAdmin && portalUsers.length
      ? [
          button(
            'Åbn kundeportal',
            () => startSupport(c, portalUsers),
            'secondary back',
          ),
        ]
      : []),
  );
  if (c.demo)
    content.append(
      el(
        'p',
        'Demokonto · Alle data er fiktive og nulstilles automatisk hver nat. Demokontoen kan ikke redigeres, slettes eller deaktiveres. Brug Åbn kundeportal for at se den som kunden.',
        'demo-notice',
      ),
    );
  if (actor.platformAdmin && !c.demo)
    content.append(
      button(
        'Redigér virksomhed',
        () =>
          edit(
            'Redigér virksomhed',
            [
              { name: 'name', label: 'Navn', value: c.name },
              statusField(c.status),
            ],
            async (data) => {
              await api(`/companies/${c.id}`, 'PATCH', data);
              await listCompanies();
            },
          ),
        'secondary back',
      ),
    );
  const box = panel('Webshop');
  box.id = 'integration-webshops';
  box.tabIndex = -1;
  box.append(
    el(
      'p',
      'Virksomhedens administrator opretter og opsætter webshops i Tier 1. Her vises de til orientering.',
      'hint',
    ),
  );
  table(
    box,
    ['Webshop', 'Platform', 'Webadresse', 'Status', ''],
    shops.map((s) => [
      s.name,
      s.provider === 'shopify' ? 'Shopify' : 'Ikke valgt',
      s.domain,
      s.credentials_saved
        ? 'Opsætning gemt · afventer tilslutning'
        : badge(s.status),
      el('span', 'Kun visning'),
    ]),
  );
  content.append(box);
  if (actor.platformAdmin && !c.demo) content.append(await customAppsPanel(c));
  if (canManage) {
    const members = panel(
      'Brugere',
      c.demo
        ? null
        : button('Invitér bruger', () =>
            edit(
              'Invitér bruger til ' + c.name,
              [
                {
                  name: 'email',
                  label: 'Mailadresse',
                  type: 'email',
                  max: 254,
                },
                {
                  name: 'role',
                  label: 'Rolle',
                  options: [
                    ['member', 'Medlem'],
                    ['admin', 'Virksomhedsadministrator'],
                  ],
                },
              ],
              async (data) => {
                const result = await api(
                  `/companies/${c.id}/users`,
                  'POST',
                  data,
                );
                await refreshCompany(c);
                invitationNotice(result);
              },
              'Den første bruger bliver automatisk virksomhedsadministrator. Brugeren får en mail med et link til at oprette sin profil.',
            ),
          ),
    );
    table(
      members,
      ['Bruger', 'Status', 'Virksomhedsrolle', 'Webshopadgang', ''],
      memberData.members.map((u) => {
        const grants = el('div', undefined, 'grant');
        for (const g of memberData.grants.filter((g) => g.user_id === u.id)) {
          const line = el(
            'div',
            `${shops.find((s) => s.id === g.webshop_id)?.name || g.webshop_id}: ${roles[g.role]} `,
          );
          line.append(
            button('Fjern', async () => {
              await api(
                `/companies/${c.id}/webshops/${g.webshop_id}/grants`,
                'DELETE',
                { userId: u.id },
              );
              await refreshCompany(c);
            }),
          );
          grants.append(line);
        }
        const access = button('Tildel webshop', () =>
          edit(
            'Webshopadgang',
            [
              {
                name: 'webshopId',
                label: 'Webshop',
                options: shops.map((s) => [s.id, s.name]),
              },
              {
                name: 'role',
                label: 'Rolle',
                options: [
                  ['reader', 'Læser'],
                  ['operator', 'Operatør'],
                ],
              },
            ],
            async (data) => {
              await api(
                `/companies/${c.id}/webshops/${data.webshopId}/grants`,
                'POST',
                { userId: u.id, role: data.role },
              );
              await refreshCompany(c);
            },
          ),
        );
        const controls = c.demo
          ? actions()
          : u.invitation_state && u.invitation_state !== 'accepted'
            ? invitationControls(u, `/companies/${c.id}/users`, () =>
                refreshCompany(c),
              )
            : actions(access);
        if (
          !c.demo &&
          (!u.invitation_state || u.invitation_state === 'accepted') &&
          u.id !== actor.id
        )
          controls.append(
            button(
              u.status === 'active' ? 'Deaktivér' : 'Aktivér',
              async () => {
                await api(`/companies/${c.id}/users/${u.id}`, 'PATCH', {
                  status: u.status === 'active' ? 'inactive' : 'active',
                });
                await refreshCompany(c);
              },
            ),
          );
        if (
          !c.demo &&
          (!u.invitation_state || u.invitation_state === 'accepted') &&
          u.id !== actor.id
        )
          controls.append(
            button('Redigér rolle', () =>
              edit(
                'Virksomhedsrolle',
                [
                  {
                    name: 'role',
                    label: 'Rolle',
                    value: u.role,
                    options: [
                      ['member', 'Medlem'],
                      ['admin', 'Virksomhedsadministrator'],
                    ],
                  },
                ],
                async (data) => {
                  await api(`/companies/${c.id}/members`, 'POST', {
                    userId: u.id,
                    ...data,
                  });
                  await refreshCompany(c);
                },
              ),
            ),
          );
        if (
          actor.platformAdmin &&
          u.status === 'active' &&
          (!u.invitation_state || u.invitation_state === 'accepted')
        )
          controls.append(
            button('Log ind som bruger', () => startSupport(c, [u])),
          );
        return [
          u.email,
          userStatus(u),
          roles[u.role],
          u.role === 'admin' ? 'Alle virksomhedens webshops' : grants,
          controls,
        ];
      }),
    );
    content.append(members);
    const history = panel('Seneste administrative handlinger');
    const events = (await api(`/companies/${c.id}/audit`)).events;
    table(
      history,
      ['Tidspunkt', 'Handling', 'Ressource', 'Udført af'],
      events.map((e) => [
        fmtDateTime(e.created_at),
        {
          'invitation.created': 'Bruger inviteret',
          'invitation.accepted': 'Invitation accepteret',
          'invitation.revoked': 'Invitation tilbagekaldt',
          'invitation.renewed': 'Ny invitation sendt',
          'support.started': 'Supportadgang startet',
          'support.stopped': 'Supportadgang afsluttet',
          'profile.saved': 'Profil gemt',
          'accounting.configured': 'Regnskabsvalg gemt',
          'integration.selected': 'Integration valgt',
          'integration.removed': 'Integration fravalgt',
          'company.created': 'Virksomhed oprettet',
          'company.updated': 'Virksomhed ændret',
          'webshop.created': 'Webshop oprettet',
          'webshop.updated': 'Webshop ændret',
          'membership.saved': 'Virksomhedsadgang gemt',
          'membership.removed': 'Virksomhedsadgang fjernet',
          'grant.saved': 'Webshopadgang gemt',
          'grant.removed': 'Webshopadgang fjernet',
          'custom_app.enabled': 'Custom app slået til',
          'custom_app.disabled': 'Custom app slået fra',
        }[e.action] || e.action,
        shops.find((s) => s.id === e.resource_id)?.name ||
          memberData.members.find((u) => u.id === e.resource_id)?.email ||
          (e.resource_id === c.id ? c.name : 'Tidligere registrering'),
        e.actor_email +
          (JSON.parse(e.details_json || '{}').supportSession
            ? ' (support som ' +
              (memberData.members.find(
                (u) => u.id === JSON.parse(e.details_json).impersonatedUser,
              )?.email || JSON.parse(e.details_json).impersonatedUser) +
              ')'
            : ''),
      ]),
    );
    content.append(history);
  }
}
// Custom apps are built for one customer; each can be on for exactly one company (platform/custom-apps.ts).
async function customAppsPanel(c) {
  const box = panel('Custom apps');
  box.append(
    el(
      'p',
      'Apps udviklet til én kunde. Slås en app til, får virksomheden menuen Custom apps i portalen. En app kan kun være slået til for én virksomhed ad gangen.',
      'hint',
    ),
  );
  const apps = (await api(`/companies/${c.id}/custom-apps`)).apps;
  table(
    box,
    ['App', 'Beskrivelse', 'Status', ''],
    apps.map((a) => {
      const mine = a.companyId === c.id;
      return [
        a.name,
        a.description,
        mine
          ? 'Slået til siden ' + fmtDateTime(a.enabledAt)
          : a.companyId
            ? 'Bruges af ' + a.companyName
            : 'Ikke slået til',
        a.companyId && !mine
          ? el('span', '')
          : actions(
              button(mine ? 'Slå fra' : 'Slå til', async () => {
                await api(
                  `/companies/${c.id}/custom-apps/${a.id}`,
                  mine ? 'DELETE' : 'PUT',
                  {},
                );
                await refreshCompany(c);
              }),
            ),
      ];
    }),
  );
  return box;
}
let catalogExpiry;
async function integrationCatalog() {
  clearTimeout(catalogExpiry);
  clear();
  content.replaceChildren(
    el('p', 'Tester forbindelsen til udbydernes API…', 'empty'),
  );
  $('#new-company').hidden = true;
  $('#companies-tab').classList.remove('active');
  $('#settings-tab').classList.remove('active');
  $('#catalog-tab').classList.add('active');
  heading(
    'Integrationer',
    'Fælles katalog for WebshopToolbox. Virksomhederne vælger selv deres integrationer.',
  );
  const data = await api('/catalog/status');
  const box = panel(
    'Integrationskatalog',
    button('Test forbindelser igen', integrationCatalog),
  );
  box.append(
    el(
      'p',
      'Hver integration testes ved at kalde udbyderens API fra platformen. Testen bruger ingen kundedata og bekræfter ikke den enkelte kundes adgang.',
      'hint',
    ),
  );
  table(
    box,
    ['Integration', 'Kategori', 'Virksomheder', 'Forbindelse fra platformen'],
    data.integrations.map((i) => {
      const c = i.connectivity || { state: 'unknown' };
      const link = el(
        'span',
        c.state === 'reachable'
          ? '● Svarer'
          : c.state === 'provider_error'
            ? '● Fejl hos udbyderen'
            : c.state === 'unreachable'
              ? '● Kan ikke nås'
              : '● Ikke testet',
        'api-status ' +
          ({
            reachable: 'available',
            provider_error: 'disrupted',
            unreachable: 'disrupted',
          }[c.state] || 'unknown'),
      );
      link.title = c.url ? `Testet ${c.url} uden adgangsoplysninger` : '';
      const detail = el(
        'small',
        c.state === 'unreachable'
          ? `Intet svar inden for 5 sek. · ${c.ms} ms`
          : c.httpStatus
            ? `HTTP ${c.httpStatus} · ${c.ms} ms`
            : '',
      );
      const connection = el('div');
      connection.append(link, detail);
      const u = i.usage || { connected: 0, selected: 0 },
        usage = el('div');
      usage.append(el('strong', u.connected + ' forbundet'));
      usage.title = 'Aktive virksomheder med en gemt forbindelse';
      if (u.selected > u.connected)
        usage.append(
          el('small', u.selected - u.connected + ' valgt uden forbindelse'),
        );
      return [i.name, i.category, usage, connection];
    }),
  );
  const checked = data.integrations[0]?.connectivity?.checkedAt;
  const hint = el(
    'p',
    `Forbindelse fra platformen: platformen kalder udbyderens API-adresse uden adgangsoplysninger. "Svarer" betyder, at API'et kan nås – også når det svarer med "ikke logget ind". Det bekræfter ikke den enkelte kundes forbindelse. Virksomheder tæller aktive virksomheder med en gemt forbindelse til integrationen.${checked ? 'Kontrolleret ' + fmtDateTime(checked) + '. ' : ''}Kontrollen gælder i fem minutter.`,
    'intro',
  );
  content.replaceChildren(box, hint);
  catalogExpiry = setTimeout(() => {
    if (!$('#catalog-tab').classList.contains('active')) return;
    document.querySelectorAll('.api-status').forEach((n) => {
      n.className = 'api-status unknown';
      n.textContent = '● Forældet · kontrollér igen';
    });
  }, 300000);
}
$('#catalog-tab').onclick = () => integrationCatalog().catch(showError);
async function signupPanel() {
  const { signups } = await api('/settings/signups'),
    box = panel('Tilmeldinger og gratis prøveperioder');
  box.append(
    el(
      'p',
      'Kontakt virksomhederne senest 14 dage før udløb. Kontakt sker manuelt; markér den først, når I har kontaktet virksomheden. Ingen automatisk betaling.',
    ),
  );
  const date = (value) =>
    value ? fmtDate(value * 1000) : 'Afventer aktivering';
  table(
    box,
    [
      'Virksomhed / CVR',
      'Kontakt',
      'Velkomstmail',
      'Prøveperiode udløber',
      'Opfølgning',
    ],
    signups.map((s) => [
      s.name + ' · ' + s.cvr,
      s.email,
      {
        sent: 'Accepteret af mailtjenesten',
        uncertain: 'Levering skal undersøges',
        pending: 'Afventer afsendelse',
        preview: 'Lokal test',
      }[s.delivery] || s.delivery,
      date(s.trial_ends_at),
      s.contacted_at
        ? 'Kontaktet ' + date(s.contacted_at)
        : s.contact_due_at
          ? actions(
              el(
                'span',
                (s.contact_due_at * 1000 <= Date.now()
                  ? 'Kontakt nu · '
                  : 'Kontakt senest ') + date(s.contact_due_at),
              ),
              button('Markér kontaktet', async () => {
                await api('/settings/signups', 'POST', {
                  companyId: s.company_id,
                });
                await portalSettings();
              }),
            )
          : el('span', 'Afventer aktivering'),
    ]),
  );
  content.append(box);
}
async function portalSettings() {
  clear();
  $('#new-company').hidden = true;
  $('#companies-tab').classList.remove('active');
  $('#settings-tab').classList.add('active');
  $('#catalog-tab').classList.remove('active');
  heading(
    'Portalindstillinger',
    'Administrér adgangen til selve Toolbox-administrationen.',
  );
  const users = (await api('/settings/admins')).users;
  content.replaceChildren();
  const welcome = await api('/settings/welcome');
  const welcomeBox = panel('Velkomstmail til nye virksomheder');
  welcomeBox.append(
    el(
      'p',
      'Sendes ved tilmelding. Brug {{name}}, {{company}} og {{link}}. Linket skal være med. Ændringer gælder fremtidige mails.',
    ),
    el('strong', welcome.subject),
    el('pre', welcome.body, 'welcome-preview'),
    button('Redigér velkomstmail', () =>
      edit(
        'Velkomstmail',
        [
          { name: 'subject', label: 'Emne', max: 160, value: welcome.subject },
          {
            name: 'body',
            label: 'Mailtekst',
            type: 'textarea',
            max: 6000,
            value: welcome.body,
          },
        ],
        async (data) => {
          await api('/settings/welcome', 'PUT', {
            ...data,
            version: welcome.version,
          });
          await portalSettings();
        },
      ),
    ),
  );
  content.append(welcomeBox);
  await signupPanel();
  const box = panel(
    'Portaladministratorer',
    button('Opret portaladministrator', () =>
      edit(
        'Opret portaladministrator',
        [{ name: 'email', label: 'Email', type: 'email', max: 254 }],
        async (data) => {
          const result = await api('/settings/admins', 'POST', data);
          await portalSettings();
          invitationNotice(result);
        },
        'Portaladministratorer kan administrere alle virksomheder. Virksomhedsbrugere oprettes inde i virksomheden. Der sendes en invitation til mailadressen.',
      ),
    ),
  );
  table(
    box,
    ['Bruger', 'Status', ''],
    users.map((u) => [
      u.email,
      userStatus(u),
      u.invitation_state && u.invitation_state !== 'accepted'
        ? invitationControls(u, '/settings/admins', portalSettings)
        : u.id === actor.id
          ? 'Din bruger'
          : button(
              u.status === 'active' ? 'Deaktivér' : 'Aktivér',
              async () => {
                await api(`/settings/admins/${u.id}`, 'PATCH', {
                  status: u.status === 'active' ? 'inactive' : 'active',
                });
                await portalSettings();
              },
            ),
    ]),
  );
  content.append(box);
}
$('#companies-tab').onclick = () => listCompanies().catch(showError);
$('#settings-tab').onclick = () => portalSettings().catch(showError);
try {
  const supportStatus = await api('/support');
  if (supportStatus.active) {
    const banner = el('div', undefined, 'support-banner');
    banner.id = 'support-banner';
    banner.setAttribute('role', 'status');
    banner.append(
      el('span', 'Supportadgang aktiv · gælder alle faner'),
      button('Afslut supportadgang', async () => {
        await api('/support', 'DELETE', {});
        location.reload();
      }),
    );
    document.querySelector('main').prepend(banner);
  }
  actor = (await api('/me')).user;
  if (actor.support) {
    $('#support-banner span').textContent =
      'Du arbejder som ' +
      actor.email +
      ' · udløber ' +
      new Date(actor.support.expiresAt * 1000).toLocaleTimeString('da-DK', {
        hour: '2-digit',
        minute: '2-digit',
      });
    setTimeout(
      () => location.reload(),
      Math.max(0, actor.support.expiresAt * 1000 - Date.now() + 1000),
    );
  }
  $('#identity').textContent = actor.email;
  $('#insights-tab').hidden = !actor.platformAdmin || !!actor.support;
  $('#tickets-tab').hidden = !actor.platformAdmin;
  $('#settings-tab').hidden = !actor.platformAdmin;
  $('#catalog-tab').hidden = !actor.platformAdmin;
  if (!actor.fullName) await completeProfile();
  else if (actor.platformAdmin) await listCompanies();
  else await supportHome();
} catch (error) {
  content.replaceChildren(
    el('p', 'Administrationen kunne ikke åbnes.', 'empty'),
  );
  showError(error);
}

const ticketStates = {
  open: 'Afventer support',
  waiting_customer: 'Afventer dit svar',
  resolved: 'Løst',
};
async function ticketList(c = null, status = '', offset = 0) {
  clear();
  $('#new-company').hidden = true;
  heading(
    'Support',
    c
      ? 'Opret en sag, og følg svarene her i portalen.'
      : 'Supportsager fra alle virksomheder',
    c ? c.name + ' / Support' : 'Tier 0 / Support',
  );
  const base = c ? `/companies/${c.id}/tickets` : '/tickets';
  const data = await api(base + '?' + new URLSearchParams({ status, offset }));
  const create =
    c && !actor.support
      ? button('Opret supportsag', () =>
          edit(
            'Ny supportsag',
            [
              { name: 'subject', label: 'Emne', max: 160 },
              {
                name: 'message',
                label: 'Beskriv problemet – undlad adgangskoder og API-nøgler',
                type: 'textarea',
                max: 6000,
              },
            ],
            async (input) => {
              const result = await api(base, 'POST', input);
              await ticketDetail(c, result.id);
            },
            'Sagen deles med virksomhedens brugere og Toolbox-support. Svar vises her i portalen.',
          ),
        )
      : null;
  const box = panel(
      c ? 'Virksomhedens supportsager' : 'Supportindbakke',
      create,
    ),
    filter = el('select');
  filter.setAttribute('aria-label', 'Filtrér supportsager');
  for (const [key, label] of [
    ['', 'Alle sager'],
    ...Object.entries(ticketStates),
  ]) {
    const option = el(
      'option',
      !c && key === 'waiting_customer' ? 'Afventer kunde' : label,
    );
    option.value = key;
    filter.append(option);
  }
  filter.value = status;
  filter.onchange = () => ticketList(c, filter.value).catch(showError);
  box.append(
    actions(
      filter,
      button('Opdatér', () => ticketList(c, status, offset)),
    ),
  );
  table(
    box,
    ['Emne', ...(!c ? ['Virksomhed'] : []), 'Status', 'Prioritet', 'Opdateret'],
    data.tickets.map((t) => [
      button(t.subject, () => ticketDetail(c, t.id), 'link'),
      ...(!c ? [t.company_name] : []),
      !c && t.status === 'waiting_customer'
        ? 'Afventer kunde'
        : ticketStates[t.status],
      t.priority === 'high' ? 'Høj' : 'Normal',
      fmtDateTime(t.updated_at),
    ]),
  );
  const paging = actions();
  if (offset)
    paging.append(
      button('Forrige', () => ticketList(c, status, Math.max(0, offset - 50))),
    );
  if (data.hasMore)
    paging.append(button('Næste', () => ticketList(c, status, offset + 50)));
  box.append(paging);
  content.replaceChildren(box);
}
async function ticketDetail(c, id) {
  clear();
  const base = (c ? `/companies/${c.id}/tickets` : '/tickets') + '/' + id,
    { ticket: t, messages } = await api(base);
  heading(
    t.subject,
    'Supportsag · ' + id.slice(0, 8),
    c ? c.name + ' / Support' : 'Tier 0 / Support',
  );
  const box = panel(
    'Samtale',
    button('← Alle sager', () => ticketList(c)),
  );
  box.append(
    el(
      'p',
      (ticketStates[t.status] || t.status) +
        ' · ' +
        (t.priority === 'high' ? 'Høj prioritet' : 'Normal prioritet'),
    ),
  );
  for (const m of messages) {
    const item = el('article', undefined, 'ticket-message ' + m.author_kind);
    item.append(
      el(
        'strong',
        (m.author_kind === 'support' ? 'Toolbox-support' : 'Kunde') +
          ' · ' +
          (m.author_name || 'Bruger'),
      ),
      el('small', fmtDateTime(m.created_at)),
      el('p', m.body),
    );
    box.append(item);
  }
  if (!actor.support) {
    const form = el('form'),
      label = el('label', 'Dit svar'),
      input = el('textarea');
    input.name = 'message';
    input.required = true;
    input.maxLength = 6000;
    input.rows = 6;
    label.append(input);
    const send = el('button', 'Send svar');
    send.type = 'submit';
    form.append(label, send);
    form.onsubmit = async (e) => {
      e.preventDefault();
      send.disabled = true;
      try {
        await api(base, 'PATCH', { message: input.value, version: t.version });
        await ticketDetail(c, id);
      } catch (error) {
        showError(error);
        send.disabled = false;
      }
    };
    box.append(form);
    const controls = actions(
      button(
        t.status === 'resolved' ? 'Genåbn sag' : 'Markér som løst',
        async () => {
          await api(base, 'PATCH', {
            status: t.status === 'resolved' ? 'open' : 'resolved',
            version: t.version,
          });
          await ticketDetail(c, id);
        },
      ),
    );
    if (actor.platformAdmin)
      controls.append(
        button('Status og prioritet', () =>
          edit(
            'Behandl supportsag',
            [
              {
                name: 'status',
                label: 'Status',
                value: t.status,
                options: [
                  ['open', 'Afventer support'],
                  ['waiting_customer', 'Afventer kunde'],
                  ['resolved', 'Løst'],
                ],
              },
              {
                name: 'priority',
                label: 'Prioritet',
                value: t.priority,
                options: [
                  ['normal', 'Normal'],
                  ['high', 'Høj'],
                ],
              },
            ],
            async (data) => {
              await api(base, 'PATCH', { ...data, version: t.version });
              await ticketDetail(c, id);
            },
          ),
        ),
      );
    box.append(controls);
  }
  content.replaceChildren(box);
}
$('#tickets-tab').onclick = () => ticketList().catch(showError);

let insightsRevision = 0;
// Driftsoverblik: the scheduler's heartbeat, open alerts (also mailed to the platform admins) and every webshop's state.
const danishTime = (value) =>
  value
    ? new Date(
        value.includes('T') ? value : value.replace(' ', 'T') + 'Z',
      ).toLocaleString('da-DK', { dateStyle: 'short', timeStyle: 'short' })
    : '—';
async function operationsPanel(revision, target) {
  const data = await api('/operations');
  if (revision !== insightsRevision) return;
  const box = panel(
    'Driftsoverblik',
    button('Opdatér', () => operationsPanel(insightsRevision, target)),
  );
  const s = data.scheduler;
  box.append(
    el(
      'p',
      !s.enabled
        ? 'Automatiske kørsler er slået fra i dette miljø.'
        : 'Seneste gennemførte automatiske kørsel: ' +
            danishTime(s.lastOkAt) +
            (s.lastError ? ' · Seneste fejl: ' + s.lastError : ''),
      'hint',
    ),
  );
  if (data.alerts.length) {
    box.append(el('h3', 'Åbne driftsproblemer'));
    table(
      box,
      ['Webshop', 'Problem', 'Siden'],
      data.alerts.map((a) => [a.label, a.message, danishTime(a.firstAt)]),
    );
  } else box.append(el('p', 'Ingen åbne driftsproblemer.', 'hint'));
  box.append(el('h3', 'Webshops'));
  table(
    box,
    [
      'Webshop',
      'Automatik',
      'Seneste gennemførte',
      'Fejl seneste døgn',
      'Venter på nyt forsøg',
      'Forsinkelse',
      '',
    ],
    data.shops.map((shop) => [
      shop.label,
      shop.scheduled ? 'Kører' : shop.reason,
      danishTime(shop.lastSuccessAt),
      String(shop.failed24h),
      String(shop.retrying),
      shop.delayMinutes > 0 ? shop.delayMinutes + ' min.' : '—',
      button('Kørselslog', () => insightsView(shop.companyId, shop.webshopId)),
    ]),
  );
  target.replaceChildren(box);
}
// A run row can stand for several quiet runs in a row (collapseRepeat in run-cleanup.ts).
function runDetails(r) {
  const parts = [];
  if (r.repeats > 1)
    parts.push(
      r.repeats +
        ' kørsler uden ændringer siden ' +
        danishTime(r.first_started_at),
    );
  if (r.message) parts.push(r.message);
  return parts.join(' · ') || '—';
}
async function insightsView(
  companyId = '',
  shopId = '',
  status = '',
  page = 1,
) {
  const revision = ++insightsRevision;
  document
    .querySelectorAll('aside .nav.active')
    .forEach((n) => n.classList.remove('active'));
  $('#insights-tab').classList.add('active');
  clear();
  heading(
    'Indsigt',
    'Driftsoverblik på tværs af kunder og kørselslog pr. webshop',
  );
  $('#new-company').hidden = true;
  const ops = el('div'),
    box = panel('Kørselslog');
  content.replaceChildren(ops, box);
  operationsPanel(revision, ops).catch(showError);
  const companySelect = el('select'),
    shopSelect = el('select'),
    statusSelect = el('select');
  companySelect.setAttribute('aria-label', 'Virksomhed');
  shopSelect.setAttribute('aria-label', 'Webshop');
  statusSelect.setAttribute('aria-label', 'Status');
  const list = (await api('/companies')).companies;
  if (revision !== insightsRevision) return;
  if (!list.length) {
    box.append(el('p', 'Ingen virksomheder endnu.'));
    return;
  }
  for (const c of list) {
    const o = el('option', c.name);
    o.value = c.id;
    companySelect.append(o);
  }
  if (companyId) companySelect.value = companyId;
  companyId = companySelect.value;
  const shops = (await api(`/companies/${companyId}/webshops`)).webshops;
  if (revision !== insightsRevision) return;
  for (const shop of shops) {
    const o = el('option', shop.name);
    o.value = shop.id;
    shopSelect.append(o);
  }
  if (shopId) shopSelect.value = shopId;
  const labels = {
    succeeded: 'Gennemført',
    failed: 'Fejlet',
    running: 'Kører',
    skipped: 'Sprunget over',
  };
  for (const [value, label] of [
    ['', 'Alle statusser'],
    ...Object.entries(labels),
  ]) {
    const o = el('option', label);
    o.value = value;
    statusSelect.append(o);
  }
  statusSelect.value = status;
  const refresh = () =>
    insightsView(companySelect.value, shopSelect.value, statusSelect.value, 1);
  companySelect.onchange = () =>
    insightsView(companySelect.value).catch(showError);
  shopSelect.onchange = () => refresh().catch(showError);
  statusSelect.onchange = () => refresh().catch(showError);
  box.append(
    actions(
      companySelect,
      shopSelect,
      statusSelect,
      button('Opdatér', refresh),
    ),
  );
  if (!shops.length) {
    box.append(el('p', 'Virksomheden har ingen webshops.'));
    return;
  }
  const data = await api(
    `/companies/${companyId}/webshops/${shopSelect.value}/insights?` +
      new URLSearchParams({ status, page }),
  );
  if (revision !== insightsRevision) return;
  box.append(
    el(
      'p',
      `${data.summary.total} kørsler · ${data.summary.failed} fejlede · ${data.summary.running} igangværende. Viser op til de seneste 1.000 kørsler.`,
      'hint',
    ),
  );
  table(
    box,
    ['Job', 'Status', 'Start', 'Slut', 'Antal', 'Detaljer'],
    data.runs.map((r) => [
      r.job_name,
      labels[r.status] || r.status,
      r.started_at,
      r.finished_at || '—',
      r.count ?? '—',
      runDetails(r),
    ]),
  );
  const nav = actions();
  if (page > 1)
    nav.append(
      button('Forrige', () =>
        insightsView(companyId, shopSelect.value, status, page - 1),
      ),
    );
  if (page * 50 < data.pagination.total)
    nav.append(
      button('Næste', () =>
        insightsView(companyId, shopSelect.value, status, page + 1),
      ),
    );
  box.append(nav);
}
$('#insights-tab').onclick = () => insightsView().catch(showError);

for (const id of [
  'companies-tab',
  'tickets-tab',
  'catalog-tab',
  'settings-tab',
])
  $('#' + id).addEventListener('click', () => {
    insightsRevision++;
    $('#insights-tab').classList.remove('active');
  });
