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
  const res = await fetch('/api/platform' + path, {
    method,
    headers: data ? { 'Content-Type': 'application/json' } : {},
    body: data ? JSON.stringify(data) : undefined,
  });
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
    } else {
      input = el('input');
      input.type = f.type || 'text';
      input.maxLength = f.max || 120;
    }
    input.name = f.name;
    input.required = true;
    if (f.value !== undefined) input.value = f.value;
    label.append(input);
    container.append(label);
  }
  saveEditor = save;
  $('#editor').showModal();
}
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
      button(c.name, () => company(c), 'link'),
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
  content.replaceChildren(
    button('← Alle virksomheder', listCompanies, 'secondary back'),
  );
  if (actor.platformAdmin)
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
  const newShop = canManage
    ? button('Opret webshop', () =>
        edit(
          'Opret webshop',
          [
            { name: 'name', label: 'Navn' },
            { name: 'domain', label: 'Domæne', max: 253 },
          ],
          async (data) => {
            await api(`/companies/${c.id}/webshops`, 'POST', data);
            await company(c);
          },
        ),
      )
    : null;
  const box = panel('Webshops', newShop);
  table(
    box,
    ['Webshop', 'Domæne', 'Status', ''],
    shops.map((s) => [
      s.name,
      s.domain,
      badge(s.status),
      canManage
        ? button('Redigér', () =>
            edit(
              'Redigér webshop',
              [
                { name: 'name', label: 'Navn', value: s.name },
                { name: 'domain', label: 'Domæne', value: s.domain, max: 253 },
                statusField(s.status),
              ],
              async (data) => {
                await api(`/companies/${c.id}/webshops/${s.id}`, 'PATCH', data);
                await company(c);
              },
            ),
          )
        : el('span', 'Kun visning'),
    ]),
  );
  content.append(box);
  if (canManage) {
    const members = panel('Brugere', button('Opret bruger', () => edit(
      'Opret bruger i ' + c.name,
      [
        { name: 'email', label: 'Email', type: 'email', max: 254 },
        { name: 'issuer', label: 'Identitetsudsteder', max: 250 },
        { name: 'subject', label: 'Brugerens identitets-ID', max: 250 },
        { name: 'role', label: 'Virksomhedsrolle', options: actor.platformAdmin ? [['member','Medlem'],['admin','Virksomhedsadministrator']] : [['member','Medlem']] },
      ],
      async data => { await api(`/companies/${c.id}/users`, 'POST', data); await company(c); },
      'Brugeren tilhører kun denne virksomhed. Brug den verificerede loginidentitet. Ingen invitation sendes.'
    )));
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
              await company(c);
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
              await company(c);
            },
          ),
        );
        const controls = actions(access);
        if (u.id !== actor.id) controls.append(button(u.status === 'active' ? 'Deaktivér' : 'Aktivér', async () => {
          await api(`/companies/${c.id}/users/${u.id}`, 'PATCH', {status: u.status === 'active' ? 'inactive' : 'active'});
          await company(c);
        }));
        if (actor.platformAdmin) controls.append(button('Redigér rolle', () => edit('Virksomhedsrolle', [
          {name:'role', label:'Rolle', value:u.role, options:[['member','Medlem'],['admin','Virksomhedsadministrator']]}
        ], async data => { await api(`/companies/${c.id}/members`, 'POST', {userId:u.id,...data}); await company(c); })));
        return [
          u.email,
          badge(u.status),
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
      ['Tidspunkt', 'Handling', 'Ressource'],
      events.map((e) => [
        new Date(e.created_at.replace(' ', 'T') + 'Z').toLocaleString('da-DK'),
        ({
          'company.created': 'Virksomhed oprettet',
          'company.updated': 'Virksomhed ændret',
          'webshop.created': 'Webshop oprettet',
          'webshop.updated': 'Webshop ændret',
          'membership.saved': 'Virksomhedsadgang gemt',
          'membership.removed': 'Virksomhedsadgang fjernet',
          'grant.saved': 'Webshopadgang gemt',
          'grant.removed': 'Webshopadgang fjernet',
        })[e.action] || e.action,
        shops.find((s) => s.id === e.resource_id)?.name ||
          memberData.members.find((u) => u.id === e.resource_id)?.email ||
          (e.resource_id === c.id ? c.name : 'Tidligere registrering'),
      ]),
    );
    content.append(history);
  }
}
async function portalSettings() {
  clear();
  $('#new-company').hidden = true;
  $('#companies-tab').classList.remove('active');
  $('#settings-tab').classList.add('active');
  heading(
    'Portalindstillinger',
    'Administrér adgangen til selve Toolbox-administrationen.',
  );
  const users = (await api('/settings/admins')).users;
  content.replaceChildren();
  const box = panel(
    'Portaladministratorer',
    button('Opret portaladministrator', () =>
      edit(
        'Opret portaladministrator',
        [
          { name: 'email', label: 'Email', type: 'email', max: 254 },
          { name: 'issuer', label: 'Identitetsudsteder', max: 250 },
          { name: 'subject', label: 'Brugerens identitets-ID', max: 250 },
        ],
        async (data) => {
          await api('/settings/admins', 'POST', data);
          await portalSettings();
        },
        'Portaladministratorer kan administrere alle virksomheder. Virksomhedsbrugere oprettes inde i virksomheden. Brug den verificerede loginidentitet.',
      ),
    ),
  );
  table(
    box,
    ['Bruger', 'Status', ''],
    users.map((u) => [
      u.email,
      badge(u.status),
      u.id === actor.id
        ? 'Din bruger'
        : button(u.status === 'active' ? 'Deaktivér' : 'Aktivér', async () => {
            await api(`/settings/admins/${u.id}`, 'PATCH', {
              status: u.status === 'active' ? 'inactive' : 'active',
            });
            await portalSettings();
          }),
    ]),
  );
  content.append(box);
}
$('#companies-tab').onclick = () => listCompanies().catch(showError);
$('#settings-tab').onclick = () => portalSettings().catch(showError);
try {
  actor = (await api('/me')).user;
  $('#identity').textContent = actor.email;
  $('#settings-tab').hidden = !actor.platformAdmin;
  await listCompanies();
} catch (error) {
  content.replaceChildren(
    el('p', 'Administrationen kunne ikke åbnes.', 'empty'),
  );
  showError(error);
}
