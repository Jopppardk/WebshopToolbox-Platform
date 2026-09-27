const platformRoot=location.pathname==='/admin'||location.pathname.startsWith('/admin/')?'/admin':'';
import {customerPages,customerShell,customerDashboard,customerModule,icon} from './customer.js';
document.querySelector('.logout-form').onsubmit=async event=>{
 event.preventDefault();const button=document.querySelector('#logout');button.disabled=true;
 try{
  const response=await fetch(platformRoot+'/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',redirect:'manual'});
  if(response.type!=='opaqueredirect'&&response.status!==303)throw Error('Du kunne ikke logges ud. Prøv igen.');
  location.replace(platformRoot?(['localhost','127.0.0.1','[::1]'].includes(location.hostname)?'/local-login':'/cdn-cgi/access/logout'):'/login');
 }catch(error){showError(error);button.disabled=false;}
};
function invitationNotice(result) {
  clear();
  message.textContent=result.delivery==='sent' ? 'Invitationen er sendt.' : result.delivery==='preview' ? 'Lokal mailvisning: ' : 'Invitationen er oprettet, men leveringen kunne ikke bekræftes. Kontrollér modtagerens indbakke før du sender en ny invitation.';
  if(result.previewLink) {const link=el('a','Åbn testinvitation');link.href=result.previewLink;message.append(link);}
}
function userStatus(u) {
  if(u.invitation_state==='revoked') return el('span','Invitation tilbagekaldt','badge inactive');
  if(u.invitation_state==='pending') return el('span',u.expires_at*1000<Date.now() ? 'Invitation udløbet' : 'Inviteret','badge');
  return badge(u.status);
}
function invitationControls(u,base,refresh) {
  return actions(button('Send ny invitation',()=>edit('Send ny invitation',[],async()=>{
    const result=await api(base+'/'+u.id+'/invitation','POST',{}); await refresh(); invitationNotice(result);
  },'Det tidligere link bliver ugyldigt. Der sendes en ny invitationsmail.')),
  button('Tilbagekald',async()=>{await api(base+'/'+u.id+'/invitation','DELETE',{});await refresh();}));
}
async function completeProfile() {
  heading('Din profil','Udfyld dit navn, før du åbner administrationen.');
  content.replaceChildren(); $('#new-company').hidden=true;
  $('#companies-tab').hidden=true;$('#settings-tab').hidden=true;$('#catalog-tab').hidden=true;
  const form=el('form');
  for(const [name,label,required] of [['name','Fulde navn',true],['phone','Telefonnummer (valgfrit)',false]]) {
    const row=el('label',label),input=el('input'); input.name=name; input.required=required;input.maxLength=name==='name'?120:40;row.append(input);form.append(row);
  }
  const submit=el('button','Gem og fortsæt');submit.type='submit';form.append(submit);
  form.onsubmit=async e=>{e.preventDefault();submit.disabled=true;try{await api('/profile','POST',Object.fromEntries(new FormData(form)));location.reload();}catch(error){showError(error);submit.disabled=false;}};
  content.append(form);
}
const $ = (s) => document.querySelector(s);
const content = $('#content'),
  message = $('#message');
let actor,
  companies = [],
  selected = null,
  saveEditor;
let customerCompany = null, customerSection = 'dashboard';
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
  const res = await fetch(platformRoot+'/api/platform' + path, {
    method,
    headers: { ...(data ? { 'Content-Type': 'application/json' } : {}), ...(actor && path!=='/support' ? {'X-Platform-Actor':actor.id+':'+(actor.support?.sessionId||'')} : {}) },
    body: data ? JSON.stringify(data) : undefined,
  });
  if(res.status===401&&!platformRoot){location.replace('/login');throw Error('Log ind igen.');}
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
    } else if(f.type==='textarea') {
      input=el('textarea');input.rows=10;input.maxLength=f.max||2500;
    } else {
      input = el('input');
      input.type = f.type || 'text';
      if(input.type==='password') input.autocomplete='new-password';
      input.maxLength = f.max || 120;
    }
    input.name = f.name;
    input.required = f.required !== false;
    if (f.value !== undefined) input.value = f.value;
    if(f.whenProvider) label.dataset.provider=f.whenProvider;
    label.append(input);
    container.append(label);
  }
  const provider=container.querySelector('[name="provider"]');
  if(provider) {
    const update=()=>container.querySelectorAll('[data-provider]').forEach(label=>{const visible=label.dataset.provider===provider.value;label.hidden=!visible;label.querySelectorAll('input,select').forEach(input=>input.disabled=!visible);});
    provider.addEventListener('change',update);update();
  }
  saveEditor = save;
  $('#editor').showModal();
}
$('#editor').addEventListener('close',()=>{$('#editor-fields').replaceChildren();saveEditor=null;});
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
  if (!actor.platformAdmin) return customerHome();
  customerCompany=null; document.body.classList.remove('customer','menu-open');
  $('#customer-topbar')?.remove();
  document.querySelectorAll('.customer-group').forEach(n=>n.remove());
  document.querySelectorAll('.customer-nav').forEach(n=>n.remove());
  $('#tickets-tab').hidden=false; $('#companies-tab').hidden=false; $('#settings-tab').hidden=false; $('#catalog-tab').hidden=false; $('#catalog-tab').classList.remove('active');
  $('aside .eyebrow').textContent='Tier 0 · Administration';
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
async function refreshCompany(c) {
  if(customerCompany) await customerView(customerSection); else await company(c);
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
  const inCustomer=!!customerCompany;
  const canManage = actor.platformAdmin || c.role === 'admin';
  const canManageShops = inCustomer && !actor.platformAdmin && !actor.support && c.role === 'admin';
  const [shopData, memberData] = await Promise.all([
    api(`/companies/${c.id}/webshops`),
    canManage
      ? api(`/companies/${c.id}/members`)
      : Promise.resolve({ members: [], grants: [] }),
  ]);
  const shops = shopData.webshops;
  content.replaceChildren();
  if(!inCustomer) content.append(button('← Alle virksomheder',listCompanies,'secondary back'),button('Åbn kundeportal',()=>customerHome(c),'secondary back'));
  if (actor.platformAdmin && !inCustomer)
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
  const newShop = canManageShops ? button('Tilføj webshop',()=>shopEditor(c)) : null;
  const box = panel('Webshop', newShop);
  box.id='integration-webshops'; box.tabIndex=-1;
  if(!inCustomer)box.append(el('p','Virksomhedens administrator opretter og opsætter webshops i Tier 1. Her vises de til orientering.','hint'));
  table(
    box,
    ['Webshop', 'Platform', 'Webadresse', 'Status', ''],
    shops.map((s) => [
      s.name,
      s.provider==='shopify'?'Shopify':'Ikke valgt',
      s.domain,
      s.credentials_saved?'Opsætning gemt · afventer tilslutning':badge(s.status),
      canManageShops
        ? actions(button('Opsætning',()=>shopEditor(c,s)),button('Redigér', () =>
            edit(
              'Redigér webshop',
              [
                { name: 'name', label: 'Navn', value: s.name },
                { name: 'domain', label: 'Domæne', value: s.domain, max: 253 },
                statusField(s.status),
              ],
              async (data) => {
                await api(`/companies/${c.id}/webshops/${s.id}`, 'PATCH', data);
                await refreshCompany(c);
              },
            ),
          ))
        : el('span', 'Kun visning'),
    ]),
  );
  if(!inCustomer || customerSection==='integrations') content.append(box);
  if (canManage && (!inCustomer || customerSection==='settings')) {
    const members = panel('Brugere', button('Invitér bruger', () => edit(
      'Invitér bruger til ' + c.name,
      [ {name:'email',label:'Mailadresse',type:'email',max:254},
        {name:'role',label:'Rolle',options:[['member','Medlem'],['admin','Virksomhedsadministrator']]} ],
      async data => { const result=await api(`/companies/${c.id}/users`,'POST',data); await refreshCompany(c); invitationNotice(result); },
      'Den første bruger bliver automatisk virksomhedsadministrator. Brugeren får en mail med et link til at oprette sin profil.'
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
        const controls = u.invitation_state && u.invitation_state !== 'accepted'
          ? invitationControls(u, `/companies/${c.id}/users`, () => refreshCompany(c)) : actions(access);
        if ((!u.invitation_state || u.invitation_state==='accepted') && u.id !== actor.id) controls.append(button(u.status === 'active' ? 'Deaktivér' : 'Aktivér', async () => {
          await api(`/companies/${c.id}/users/${u.id}`, 'PATCH', {status: u.status === 'active' ? 'inactive' : 'active'});
          await refreshCompany(c);
        }));
        if ((!u.invitation_state || u.invitation_state==='accepted') && u.id !== actor.id) controls.append(button('Redigér rolle', () => edit('Virksomhedsrolle', [
          {name:'role', label:'Rolle', value:u.role, options:[['member','Medlem'],['admin','Virksomhedsadministrator']]}
        ], async data => { await api(`/companies/${c.id}/members`, 'POST', {userId:u.id,...data}); await refreshCompany(c); })));
        if(actor.platformAdmin && u.status==='active' && (!u.invitation_state || u.invitation_state==='accepted')) controls.append(button('Log ind som bruger',()=>edit('Supportadgang: '+u.email,[{name:'reason',label:'Kort årsag til supportadgang'}],async data=>{
          await api('/support','POST',{companyId:c.id,userId:u.id,reason:data.reason});location.reload();
        },'Du åbner virksomheden med denne brugers rettigheder i op til 30 minutter. Handlinger registreres med din administratoridentitet.')));
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
        new Date(e.created_at.replace(' ', 'T') + 'Z').toLocaleString('da-DK'),
        ({
          'invitation.created':'Bruger inviteret',
          'invitation.accepted':'Invitation accepteret',
          'invitation.revoked':'Invitation tilbagekaldt',
          'invitation.renewed':'Ny invitation sendt',
          'support.started':'Supportadgang startet',
          'support.stopped':'Supportadgang afsluttet',
          'profile.saved':'Profil gemt',
          'accounting.configured':'Regnskabsvalg gemt',
          'integration.selected':'Integration valgt',
          'integration.removed':'Integration fravalgt',
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
        e.actor_email+(JSON.parse(e.details_json||'{}').supportSession?' (support som '+(memberData.members.find(u=>u.id===JSON.parse(e.details_json).impersonatedUser)?.email||JSON.parse(e.details_json).impersonatedUser)+')':''),
      ]),
    );
    content.append(history);
  }
}
async function customerHome(preview) {
  customerCompany = preview || (await api('/workspace')).company;
  document.body.classList.add('customer');
  document.title = customerCompany.name + ' · WebshopToolbox';
  $('#tickets-tab').hidden=true; $('#companies-tab').hidden = true; $('#settings-tab').hidden = true; $('#catalog-tab').hidden=true;
  $('#new-company').hidden = true;
  $('aside .eyebrow').textContent = customerCompany.name;
  document.querySelectorAll('.customer-nav').forEach(n=>n.remove());
  customerShell(customerCompany,actor);
  document.querySelectorAll('.customer-group').forEach(n=>n.remove());
  for (const [key,label,glyph,group] of customerPages) {
    if(group) $('nav').append(el('p',group,'customer-group'));
    const nav=button(label,()=>customerView(key),'nav customer-nav');
    nav.prepend(icon(glyph)); nav.dataset.section=key; $('nav').append(nav);
  }
  if(actor.platformAdmin) $('nav').append(button('← Tier 0 · Administration',listCompanies,'nav customer-nav'));
  await customerView('dashboard');
}
async function customerView(section,target) {
  customerSection=section; clear();
  const fromMenu=document.body.classList.contains('menu-open');
  document.body.classList.remove('menu-open');
  $('.mobile-menu')?.setAttribute('aria-expanded','false');
  $('.mobile-menu')?.setAttribute('aria-label','Åbn menu');
  if(fromMenu) $('.mobile-menu')?.focus();
  window.scrollTo({top:0});
  const c=customerCompany, manage=actor.platformAdmin || c.role==='admin';
  document.querySelectorAll('.customer-nav').forEach(n=>n.classList.toggle('active',n.dataset.section===section));
  if(section==='settings') {
    if(target==='invoices') {content.replaceChildren();heading('Indstillinger','Fakturaoplysninger, mailskabelon og afsender.',c.name+' / Indstillinger / Fakturaer');await customerInvoiceSettings(c,manage);settingsTabs('invoices');return;}
    if(manage) await company(c); else content.replaceChildren();
    heading('Indstillinger','Din profil og virksomhedens brugere.',c.name+' / Indstillinger');
    if(!actor.support) {
    const profile=panel('Din profil',button('Redigér profil',()=>edit('Din profil',[
      {name:'name',label:'Fulde navn',value:actor.fullName},
      {name:'phone',label:'Telefonnummer (valgfrit)',value:actor.phone||'',required:false,max:40}
    ],async data=>{await api('/profile','POST',data);actor=(await api('/me')).user;await customerView('settings');})));
    profile.append(el('p',actor.fullName+' · '+actor.email,'empty'));content.prepend(profile);
    }
    settingsTabs('general');
    if(!manage) content.append(el('p','Din virksomhedsadministrator administrerer brugere og adgang.','intro'));
    return;
  }
  if(section==='documents'){await documentView(c,manage);return;}
  if(section==='packaging'){await packagingView(c,manage);return;}
  if(section==='tickets'){await ticketList(c);return;}
  if(section==='invoices'){content.replaceChildren();await customerInvoices(c,manage);return;}
  if(section==='inventory'){await stocktakeView(c,manage);return;}
  if(['orders','refunds','payouts','insights'].includes(section)){await operationView(c,section,manage);return;}
  if(customerModule(section,content,heading,c,customerView)) return;
  const accounting=(await api(`/companies/${c.id}/accounting`)).accounting;
  if(section==='integrations') {
    await company(c);
    heading('Integrationer','Ét regnskab for virksomheden. Tilføj de webshops, der skal bruge det.',c.name+' / Integrationer');
    const box=panel('Regnskabsprogram',manage ? button(accounting?'Redigér regnskab':'Vælg regnskabsprogram',()=>edit('Virksomhedens regnskab',[
      {name:'provider',label:'Regnskabsprogram',value:accounting?.provider||'dinero',options:[['dinero','Dinero'],...(accounting?.provider==='e-conomic' ? [['e-conomic','e-conomic (tidligere valg · planlagt)']] : [])]},
      {name:'accountName',label:'Regnskabets navn',value:accounting?.account_name||c.name}
    ],async data=>{await api(`/companies/${c.id}/accounting`,'PUT',data);await customerView('integrations');},'Valget gælder alle virksomhedens webshops. Opsæt og kontrollér forbindelsen i Dinero-sektionen nedenfor.')) : null);
    box.id='integration-accounting'; box.tabIndex=-1;
    box.append(el('p',accounting ? `${accounting.provider==='dinero'?'Dinero':'e-conomic'} · ${accounting.account_name} — se forbindelsesstatus nedenfor` : 'Intet regnskabsprogram valgt endnu.','empty'));
    content.prepend(box,el('p','Dine webshops og dit regnskab tilhører kun denne virksomhed. Forbind Dinero og test webshopforbindelsen nedenfor.','intro'));
    await accountingConnection(c,manage);
    if(manage&&!actor.support){const shops=(await api(`/companies/${c.id}/webshops`)).webshops;const tests=panel('Kontrollér webshopforbindelser');for(const shop of shops.filter(s=>s.credentials_saved)){tests.append(el('p',shop.name+(shop.verified_at?' · senest kontrolleret '+new Date(shop.verified_at).toLocaleString('da-DK'):'')),button('Test forbindelse',async()=>{const result=await api(`/companies/${c.id}/webshops/${shop.id}/data/connection-test`,'POST',{});await customerView('integrations');message.textContent='Forbindelse til '+result.name+' kontrolleret.';}));}content.append(tests);}
    await customerStore(c,manage);
    if(target){const destination=document.getElementById('integration-'+target);destination?.focus({preventScroll:true});destination?.scrollIntoView({block:'start'});}
    return;
  }
  heading('Dashboard','Din økonomi og drift, samlet ét sted.',c.name+' / Overblik');
  const {webshops:shops}=await api(`/companies/${c.id}/webshops`);
  if(customerSection!==section)return;
  const connection=await api(`/companies/${c.id}/accounting/connection`);const activity=await api(`/companies/${c.id}/dashboard`);const finance=manage?await api(`/companies/${c.id}/finance`):null;customerDashboard(content,customerView,{accounting,shops,manage,connection,activity,finance});if(manage&&!actor.support){const sync=button('Opdatér regnskabstal',async()=>{const result=await api(`/companies/${c.id}/finance`,'POST',{});await customerView('dashboard');message.textContent=result.message;});content.append(sync);}
}
function shopEditor(c,shop) {
  if(actor.platformAdmin||actor.support)throw new Error('Webshopopsætning foregår hos virksomhedens administrator i Tier 1.');
  const providerFields=[
    {name:'provider',label:'Webshopplatform',value:shop?.provider||'',options:[['','Vælg webshopplatform…'],['shopify','Shopify']]},
    ...(!shop?[
      {name:'name',label:'Webshoppens navn',whenProvider:'shopify'},
      {name:'domain',label:'Offentlig webadresse (fx https://minbutik.dk)',max:300,whenProvider:'shopify'},
    ]:[]),
    {name:'shopDomain',label:'Shopify-domæne (navn.myshopify.com)',value:shop?.shop_domain||'',max:300,whenProvider:'shopify'},
    {name:'clientId',label:'Client ID',max:256,whenProvider:'shopify'},
    {name:'clientSecret',label:'Client secret',type:'password',max:2048,whenProvider:'shopify'},
  ];
  edit(shop?'Webshopopsætning: '+shop.name:'Tilføj webshop',providerFields,async data=>{
    await api(`/companies/${c.id}/webshops`+(shop?`/${shop.id}/connection`:''),shop?'PUT':'POST',data);
    await refreshCompany(c);
  },'Vælg en platform for at vise opsætningen. Adgangsoplysninger gemmes krypteret og vises aldrig igen. Ved ændring indtastes begge appoplysninger på ny. Brug Test forbindelse efter lagring. Data hentes fra de enkelte sider.');
}
async function customerStore(c,manage) {
  const [data,selection]=await Promise.all([api('/catalog'),api(`/companies/${c.id}/integrations`)]);
  for(const [title,payment] of [['Indløsere og betalingsgateways',true],['Øvrige Integrationer',false]]) {
    const box=panel(title);
    box.append(el('p','Vælg virksomhedens integrationer. Betalingsforbindelser opsættes pr. webshop nedenfor.','empty'));
    const items=data.integrations.filter(i=>!['Webshop','Regnskab'].includes(i.category)&&(payment?i.category==='Betaling':i.category!=='Betaling'));
    table(box,['Integration','Funktion','Dit valg',''],items.map(i=>{
      const chosen=selection.selected.some(s=>s.integration_id===i.id);
      return [i.name,i.description,chosen?'Valgt':'Ikke valgt',manage?button(chosen?'Fjern valg':'Vælg',async()=>{
        await api(`/companies/${c.id}/integrations`,chosen?'DELETE':'POST',{integrationId:i.id});await customerView('integrations');
      }):'Kun visning'];
    }));content.append(box);
    if(payment)await paymentConnections(c,manage,selection.selected.map(s=>s.integration_id));
  }
}
let catalogExpiry;
async function integrationCatalog() {
  clearTimeout(catalogExpiry); clear(); content.replaceChildren(el('p','Kontrollerer udbydernes API-status…','empty'));
  $('#new-company').hidden=true;
  $('#companies-tab').classList.remove('active');$('#settings-tab').classList.remove('active');$('#catalog-tab').classList.add('active');
  heading('Integrationer','Fælles katalog for WebshopToolbox. Virksomhederne vælger selv deres integrationer.');
  const data=await api('/catalog/status');
  const box=panel('Integrationskatalog',button('Kontrollér status igen',integrationCatalog));
  box.append(el('p','API-status kommer fra udbyderens offentlige statuskilde. Den bekræfter ikke kundens adgang eller forbindelse. Integrationerne vedligeholdes i projektet.','empty'));
  table(box,['Integration','Kategori','API-status','Kontrolleret','Statuskilde'],data.integrations.map(i=>{
    const state=el('span',i.api.state==='available'?'● Tilgængelig':i.api.state==='disrupted'?'● Driftsforstyrrelse':'● Ukendt','api-status '+i.api.state);
    state.title=i.api.detail;
    const source=i.api.source?el('a','Udbyderens status'):'Ingen offentlig kontrol';
    if(i.api.source){source.href=i.api.source;source.target='_blank';source.rel='noopener noreferrer';}
    return [i.name,i.category,state,i.api.checkedAt?new Date(i.api.checkedAt).toLocaleString('da-DK'):'Ikke kontrolleret',source];
  }));
  const hint=el('p','Grøn: udbyderen melder API i drift. Rød: udbyderen melder forstyrrelse. Grå: status kan ikke bekræftes. Kontrollen gælder i fem minutter.','intro');
  content.replaceChildren(box,hint);
  catalogExpiry=setTimeout(()=>{if(!$('#catalog-tab').classList.contains('active'))return;document.querySelectorAll('.api-status').forEach(n=>{n.className='api-status unknown';n.textContent='● Forældet · kontrollér igen';});},300000);
}
$('#catalog-tab').onclick=()=>integrationCatalog().catch(showError);
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
  const box = panel(
    'Portaladministratorer',
    button('Opret portaladministrator', () =>
      edit(
        'Opret portaladministrator',
        [
          { name: 'email', label: 'Email', type: 'email', max: 254 },

        ],
        async (data) => {
          const result=await api('/settings/admins', 'POST', data);
          await portalSettings(); invitationNotice(result);
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
      u.invitation_state && u.invitation_state!=='accepted' ? invitationControls(u,'/settings/admins',portalSettings) : u.id === actor.id
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
  const supportStatus=await api('/support');
  if(supportStatus.active) {
    const banner=el('div',undefined,'support-banner');banner.id='support-banner';banner.setAttribute('role','status');
    banner.append(el('span','Supportadgang aktiv · gælder alle faner'),button('Afslut supportadgang',async()=>{await api('/support','DELETE',{});location.reload();}));
    document.querySelector('main').prepend(banner);
  }
  actor = (await api('/me')).user;
  if(actor.support) {
    $('#support-banner span').textContent='Du arbejder som '+actor.email+' · udløber '+new Date(actor.support.expiresAt*1000).toLocaleTimeString('da-DK',{hour:'2-digit',minute:'2-digit'});
    setTimeout(()=>location.reload(),Math.max(0,actor.support.expiresAt*1000-Date.now()+1000));
  }
  $('#identity').textContent = actor.email;
  $('#tickets-tab').hidden = !actor.platformAdmin;
  $('#settings-tab').hidden = !actor.platformAdmin;
  $('#catalog-tab').hidden = !actor.platformAdmin;
  if(!actor.fullName) await completeProfile(); else if(actor.platformAdmin) await listCompanies(); else await customerHome();
} catch (error) {
  content.replaceChildren(
    el('p', 'Administrationen kunne ikke åbnes.', 'empty'),
  );
  showError(error);
}

async function customerMail(c,manage){
 const base=`/companies/${c.id}/mail`,m=await api(base);
 const editable=manage&&!actor.support;
 const box=panel('Mailafsender',editable?button('Redigér mailopsætning',()=>edit('Mailafsender',[
  {name:'senderName',label:'Afsendernavn',value:m.senderName},
  {name:'replyTo',label:'Svaradresse (kundens kontaktmail)',type:'email',value:m.replyTo,required:false,max:254},
  {name:'customFrom',label:'Egen fakturaadresse (valgfri)',type:'email',value:m.customFrom,required:false,max:254},
  {name:'accountId',label:'Cloudflare Account ID (kun ved egen afsender)',value:m.accountId,required:false,max:32},
  {name:'apiToken',label:m.credentialsSaved?'Cloudflare API-token (lad stå tomt for at bevare)':'Cloudflare API-token (kun ved egen afsender)',type:'password',required:false,max:256}
 ],async data=>{await api(base,'PUT',data);await customerView('settings','invoices');},'Uden egen adresse bruges standardafsenderen. Eget domæne skal bruge Cloudflare DNS og være aktiveret under Email Sending. Brug et API-token med Email Sending: Edit til kundens konto. Tokenet lagres krypteret.')):null);
 box.append(el('p',`Aktuel afsender: ${m.senderName} <${m.effectiveFrom}>`,'intro'),el('p',`Standardafsender: ${m.standardFrom}`),el('p',m.replyTo?`Svar sendes til: ${m.replyTo}`:'Ingen særskilt svaradresse angivet.'));
 if(m.customFrom){box.append(el('p',m.status==='verified'?`Egen afsender kontrolleret: ${m.customFrom}`:`Egen afsender afventer kontrol: ${m.customFrom}. Standardafsenderen bruges indtil da.`,m.status==='verified'?'intro':'module-notice'));}
 const guide=el('details');guide.append(el('summary','Sådan tilknytter du din egen afsender'));
 guide.append(el('p','1. Aktivér dit domæne i Cloudflare → Email Service → Email Sending. Gennemgå de DNS-poster, Cloudflare foreslår, og bevar din eksisterende mailopsætning.'),el('p','2. Gem fakturaadresse, Account ID og et API-token med Email Sending: Edit ovenfor. Du kan få din IT-leverandør til at hjælpe.'),el('p','3. Vælg Kontrollér egen afsender. Der sendes en testmail til din loginadresse; ved godkendt afsendelse bruges din egen adresse fremover.'));
 box.append(guide);
 const status=el('p');status.setAttribute('role','status');
 if(editable){
  const send=mode=>{const requestId=crypto.randomUUID();return edit(mode==='custom'?'Kontrollér egen afsender':'Send testmail',[],async()=>{
   const result=await api(base+'/test','POST',{mode,requestId});
   await customerView('settings','invoices');
   const resultBox=document.getElementById('mail-test-result');
   resultBox.textContent=result.status==='accepted'?`Cloudflare har accepteret testmailen til ${result.recipient}. Kontrollér din indbakke og eventuelt spam.`:result.status==='preview'?'Lokal forhåndsvisning – ingen mail er sendt.':'Afsendelsen kunne ikke bekræftes og kan være gennemført. Kontrollér mailudbyderen, før du starter en ny test. Ingen automatisk genafsendelse.';
   if(result.preview)resultBox.append(el('pre',JSON.stringify(result.preview,null,2)));
  },`Testmailen sendes til din loginadresse: ${m.testRecipient}. Der vedhæftes ingen faktura.`);};
  const test=button('Send testmail',()=>send(m.status==='verified'?'custom':'standard'));test.disabled=!m.testEnabled;
  box.append(test);
  if(m.customFrom&&m.status!=='verified'){const verify=button('Kontrollér egen afsender og send testmail',()=>send('custom'));verify.disabled=!m.testEnabled;box.append(verify);}
 }
 status.id='mail-test-result';box.append(status,el('p',m.localPreview?'Lokal test: mail vises uden afsendelse.':`Testmail er begrænset til godkendte loginadresser. Almindelige kundemails er fortsat blokeret.`,'hint'));
 content.append(box);
}
function settingsTabs(active){
 const nav=el('div',undefined,'actions settings-tabs');nav.setAttribute('aria-label','Indstillinger');
 for(const [key,title] of [['general','Generelt'],['invoices','Fakturaer']]){const b=button(title,()=>customerView('settings',key),active===key?'primary':'secondary');b.setAttribute('aria-current',String(active===key));nav.append(b);}content.prepend(nav);
}
async function customerInvoiceSettings(c,manage){
 const base=`/companies/${c.id}/invoices`,s=await api(base+'/settings'),editable=manage&&!actor.support;
 const box=panel('Fakturaoplysninger',editable?button('Redigér fakturaopsætning',()=>edit('Fakturaopsætning',[
  {name:'name',label:'Virksomhedens juridiske navn',value:s.name},
  {name:'address',label:'Adresse, postnummer og by',value:s.address,max:180},
  {name:'cvr',label:'CVR / virksomhedsnummer',value:s.cvr,max:30},
  {name:'contact',label:'Kontaktoplysninger på fakturaen',value:s.contact,max:100},
  {name:'months',label:'Historik (antal måneder, 1–120)',type:'number',value:s.months}
 ],async data=>{await api(base+'/settings','PUT',{...s,...data});await customerView('settings','invoices');},'Brug {{kundenavn}}, {{fakturanummer}}, {{ordrenummer}} og {{virksomhedsnavn}} i mailen. Nye oplysninger bruges på nye fakturaer; allerede gemte PDF’er bevares.')):null);
 box.append(el('p',s.name),el('p',s.address||'Adresse mangler'),el('p',s.cvr?'CVR: '+s.cvr:'CVR / virksomhedsnummer mangler'),el('p',s.contact||'Kontaktoplysninger mangler'),el('p',`Historik: ${s.months} måneder`));
 if(editable){const label=el('label',s.hasLogo?'Udskift fakturalogo (PNG, maks. 300 KB)':'Tilføj fakturalogo (PNG, maks. 300 KB)'),input=el('input');input.type='file';input.accept='image/png';
 input.onchange=async()=>{const file=input.files[0];if(!file)return;input.disabled=true;try{if(file.size>300000)throw Error('Logoet må højst fylde 300 KB.');const response=await fetch(platformRoot+'/api/platform'+base+'/logo',{method:'PUT',headers:{'Content-Type':'image/png','X-Platform-Actor':actor.id+':'+(actor.support?.sessionId||'')},body:file});if(!response.ok)throw Error((await response.json()).error);await customerView('settings','invoices');}catch(e){showError(e);input.disabled=false;}};label.append(input);box.append(label);}
 content.append(box);
 const email=panel('Faktura-mail'),form=el('form'),subject=el('input'),body=el('textarea');subject.value=s.subject;subject.maxLength=200;subject.required=true;body.value=s.body;body.maxLength=4000;body.required=true;body.rows=12;
 const subjectLabel=el('label','Emne (maks. 200 tegn)'),bodyLabel=el('label','Mailtekst (maks. 4.000 tegn)');subjectLabel.append(subject);bodyLabel.append(body);form.append(subjectLabel,bodyLabel,el('p','Brug {{kundenavn}}, {{fakturanummer}}, {{ordrenummer}} og {{virksomhedsnavn}}.','hint'));
 const preview=panel('Forhåndsvisning med eksempeldata'),previewSubject=el('h3'),previewBody=el('pre',undefined,'mail-preview');preview.append(previewSubject,previewBody);
 const render=value=>value.replace(/{{\s*([a-zæøå]+)\s*}}/gi,(all,key)=>({kundenavn:'Anna Jensen',fakturanummer:'1001',ordrenummer:'#1001',virksomhedsnavn:s.name}[key.toLowerCase()]??all));
 const redraw=()=>{previewSubject.textContent=render(subject.value);previewBody.textContent=render(body.value);};subject.oninput=redraw;body.oninput=redraw;redraw();
 subject.disabled=body.disabled=!editable;
 if(editable){const save=el('button','Gem mailskabelon');save.type='submit';form.append(save);form.onsubmit=async e=>{e.preventDefault();save.disabled=true;try{await api(base+'/settings','PUT',{...s,subject:subject.value,body:body.value});await customerView('settings','invoices');message.textContent='Mailskabelonen er gemt.';}catch(error){showError(error);save.disabled=false;}};}
 email.append(form,preview,el('p','Automatisk afsendelse til kunder er blokeret i dev.','module-notice'));
 if(editable)email.append(button('Send seneste faktura som test',async()=>{const m=await api(`/companies/${c.id}/mail`);if(!m.testEnabled)throw Error('Din loginadresse er ikke godkendt til testmail.');const requestId=crypto.randomUUID();edit('Test af seneste faktura',[],async()=>{const result=await api(base+'/test-latest','POST',{requestId,mode:m.status==='verified'?'custom':'standard'});message.textContent=result.status==='accepted'?`Testmail med PDF er accepteret til ${result.recipient}.`:result.status==='preview'?'Lokal forhåndsvisning – ingen mail sendt.':'Uafklaret afsendelse. Kontrollér indbakken før en ny test.';},`Den senest genererede faktura vedhæftes og kontrolleres mod webshoppen. Den gemte mailskabelon bruges. Testmodtager: ${m.testRecipient}.`);}));
 content.append(email);await customerMail(c,manage);
}
async function customerInvoices(c,manage,offset=0){
 content.replaceChildren();heading('Fakturaer','Generér og hent fakturaer fra virksomhedens webshopordrer.',c.name+' / Fakturaer');
 const base=`/companies/${c.id}/invoices`,editable=manage&&!actor.support;
 const [data,shopData]=await Promise.all([api(base+'?offset='+offset),api(`/companies/${c.id}/webshops`)]);
 const shops=shopData.webshops||[],box=panel('Fakturaer',button('Fakturaopsætning',()=>customerView('settings','invoices')));
 box.append(el('p','Kundemail og bogføring er endnu ikke aktiveret. Testmail med PDF kan kun sendes til din godkendte loginadresse.','module-notice'));
 if(!data.ready)box.append(button('Udfyld fakturaoplysninger før generering',()=>customerView('settings','invoices')));
 const shopSelect=el('select');shopSelect.setAttribute('aria-label','Vælg webshop');for(const s of shops){const o=el('option',s.name);o.value=s.id;shopSelect.append(o);}
 const progress=el('p');progress.setAttribute('role','status');let after=null,importShop=null;
 const sync=button('Hent ordrer fra webshop',async()=>{if(!shopSelect.value)return;sync.disabled=true;try{if(importShop!==shopSelect.value)after=null;importShop=shopSelect.value;const result=await api(base+'/sync','POST',{webshopId:importShop,after});after=result.hasNextPage?result.endCursor:null;progress.textContent=`${result.count} ordrer hentet. `+(after?'Klik Hent flere ordrer for at fortsætte.':'Alle tilgængelige ordrer i historikken er hentet.');sync.textContent=after?'Hent flere ordrer':'Hent ordrer fra webshop';await reloadRows();}finally{sync.disabled=false;}});
 sync.disabled=!shops.length;shopSelect.onchange=()=>{after=null;sync.textContent='Hent ordrer fra webshop';};
 if(editable)box.append(actions(shopSelect,sync));
 const search=el('input');search.placeholder='Søg efter ordrenummer eller webshop';search.setAttribute('aria-label',search.placeholder);
 const filter=el('select');for(const [v,t] of [['','Alle'],['generated','PDF klar'],['pending','Mangler PDF'],['generating','Kræver kontrol / i gang']]){const o=el('option',t);o.value=v;filter.append(o);}filter.setAttribute('aria-label','Fakturastatus');
 const rows=el('div');let orders=data.orders,busy=false;
 const run=async(action,row)=>api(base+'/'+action,'POST',{webshopId:row.webshop_id,externalId:row.external_id});
 const format=(amount,currency)=>new Intl.NumberFormat('da-DK',{style:'currency',currency}).format(amount/(10**new Intl.NumberFormat('en',{style:'currency',currency}).resolvedOptions().maximumFractionDigits));
 const view=async row=>{const {invoice:i}=await run('check',row);edit('Kontrol af faktura '+i.number,[],async()=>{},'Kontrolleret mod friske ordredata fra webshoppen.');const p=$('#editor-fields');p.append(el('p',i.customer.name+' · '+i.customer.address1+' · '+i.customer.zip+' '+i.customer.city));table(p,['Beskrivelse','Antal','Ekskl. moms','Moms','I alt'],i.lines.map(l=>[l.title,l.quantity,format(l.net,i.currency),format(l.tax,i.currency),format(l.gross,i.currency)]));p.append(el('p','I alt: '+format(i.gross,i.currency)));};
 const testMail=async row=>{const m=await api(`/companies/${c.id}/mail`),requestId=crypto.randomUUID();if(!m.testEnabled)throw Error('Din loginadresse er ikke godkendt til testmail.');edit('Send testmail med faktura',[],async()=>{const result=await api(base+'/test','POST',{webshopId:row.webshop_id,externalId:row.external_id,mode:m.status==='verified'?'custom':'standard',requestId});progress.textContent=result.status==='accepted'?`Testmail med PDF accepteret til ${result.recipient}. Kontrollér indbakken.`:result.status==='preview'?'Lokal forhåndsvisning – ingen mail sendt.':'Afsendelsen kunne ikke bekræftes. Kontrollér indbakke og mailudbyder før en ny test.';},`Faktura ${row.name} vedhæftes. Mailen sendes til ${m.testRecipient}.`);};
 function visible(){return orders.filter(r=>(!filter.value||(r.status||'pending')===filter.value)&&(r.name+' '+r.webshop_name).toLowerCase().includes(search.value.toLowerCase()));}
 function draw(){rows.replaceChildren();table(rows,['Ordre','Webshop','Ordredato','Status','Handlinger'],visible().map(row=>{const controls=[];if(editable){const check=button('Kontrollér',()=>view(row));check.disabled=busy;controls.push(check);if(!row.status){const gen=button('Generér PDF',async()=>{busy=true;draw();try{await run('generate',row);await reloadRows();}finally{busy=false;draw();}});gen.disabled=busy||!data.ready;controls.push(gen);}}if(row.status==='generated'){const link=el('a','Hent PDF','secondary small');link.href=platformRoot+'/api/platform'+base+'/pdf?'+new URLSearchParams({webshopId:row.webshop_id,externalId:row.external_id});controls.push(link);if(editable){const test=button('Send testmail',()=>testMail(row));test.disabled=busy;controls.push(test);}}return [row.name,row.webshop_name,new Date(row.created_at).toLocaleDateString('da-DK'),row.status==='generated'?'PDF klar':row.status==='generating'?'I gang / kræver kontrol':'Mangler PDF',actions(...controls)];}));}
 async function reloadRows(){orders=(await api(base+'?offset='+offset)).orders;draw();}
 if(editable){const batch=button('Generér op til 5 manglende PDF’er',async()=>{busy=true;batch.disabled=true;draw();let ok=0;const errors=[];try{for(const row of visible().filter(r=>!r.status).slice(0,5)){try{await run('generate',row);ok++;}catch(e){errors.push(row.name+': '+e.message);}}await reloadRows();progress.textContent=`${ok} PDF’er genereret.`+(errors.length?' '+errors.join(' '):'');}finally{busy=false;batch.disabled=!data.ready;draw();}});batch.disabled=!data.ready;box.append(batch);}
 search.oninput=draw;filter.onchange=draw;box.append(actions(search,filter),progress,rows);draw();const paging=actions();if(offset)paging.append(button('Forrige side',()=>customerInvoices(c,manage,Math.max(0,offset-100))));if(data.hasMore)paging.append(button('Næste side',()=>customerInvoices(c,manage,offset+100)));box.append(paging,el('p',`Viser op til 100 ordrer pr. side fra de seneste ${data.months} måneder.`,'hint'));content.append(box);
}

const ticketStates={open:'Afventer support',waiting_customer:'Afventer dit svar',resolved:'Løst'};
async function ticketList(c=null,status='',offset=0){
 clear();$('#new-company').hidden=true;
 heading('Support',c?'Opret en sag, og følg svarene her i portalen.':'Supportsager fra alle virksomheder',c?c.name+' / Support':'Tier 0 / Support');
 const base=c?`/companies/${c.id}/tickets`:'/tickets';
 const data=await api(base+'?'+new URLSearchParams({status,offset}));
 const create=c&&!actor.support?button('Opret supportsag',()=>edit('Ny supportsag',[
  {name:'subject',label:'Emne',max:160},{name:'message',label:'Beskriv problemet – undlad adgangskoder og API-nøgler',type:'textarea',max:6000}
 ],async input=>{const result=await api(base,'POST',input);await ticketDetail(c,result.id);},'Sagen deles med virksomhedens brugere og Toolbox-support. Svar vises her i portalen.')):null;
 const box=panel(c?'Virksomhedens supportsager':'Supportindbakke',create),filter=el('select');filter.setAttribute('aria-label','Filtrér supportsager');
 for(const [key,label] of [['','Alle sager'],...Object.entries(ticketStates)]){const option=el('option',!c&&key==='waiting_customer'?'Afventer kunde':label);option.value=key;filter.append(option);}filter.value=status;filter.onchange=()=>ticketList(c,filter.value).catch(showError);box.append(actions(filter,button('Opdatér',()=>ticketList(c,status,offset))));
 table(box,['Emne',...(!c?['Virksomhed']:[]),'Status','Prioritet','Opdateret'],data.tickets.map(t=>[button(t.subject,()=>ticketDetail(c,t.id),'link'),...(!c?[t.company_name]:[]),!c&&t.status==='waiting_customer'?'Afventer kunde':ticketStates[t.status],t.priority==='high'?'Høj':'Normal',new Date(t.updated_at).toLocaleString('da-DK')]));
 const paging=actions();if(offset)paging.append(button('Forrige',()=>ticketList(c,status,Math.max(0,offset-50))));if(data.hasMore)paging.append(button('Næste',()=>ticketList(c,status,offset+50)));box.append(paging);content.replaceChildren(box);
}
async function ticketDetail(c,id){
 clear();const base=(c?`/companies/${c.id}/tickets`:'/tickets')+'/'+id,{ticket:t,messages}=await api(base);
 heading(t.subject,'Supportsag · '+id.slice(0,8),c?c.name+' / Support':'Tier 0 / Support');
 const box=panel('Samtale',button('← Alle sager',()=>ticketList(c)));box.append(el('p',(ticketStates[t.status]||t.status)+' · '+(t.priority==='high'?'Høj prioritet':'Normal prioritet')));
 for(const m of messages){const item=el('article',undefined,'ticket-message '+m.author_kind);item.append(el('strong',(m.author_kind==='support'?'Toolbox-support':'Kunde')+' · '+(m.author_name||'Bruger')),el('small',new Date(m.created_at).toLocaleString('da-DK')),el('p',m.body));box.append(item);}
 if(!actor.support){
  const form=el('form'),label=el('label','Dit svar'),input=el('textarea');input.name='message';input.required=true;input.maxLength=6000;input.rows=6;label.append(input);const send=el('button','Send svar');send.type='submit';form.append(label,send);
  form.onsubmit=async e=>{e.preventDefault();send.disabled=true;try{await api(base,'PATCH',{message:input.value,version:t.version});await ticketDetail(c,id);}catch(error){showError(error);send.disabled=false;}};box.append(form);
  const controls=actions(button(t.status==='resolved'?'Genåbn sag':'Markér som løst',async()=>{await api(base,'PATCH',{status:t.status==='resolved'?'open':'resolved',version:t.version});await ticketDetail(c,id);}));
  if(actor.platformAdmin)controls.append(button('Status og prioritet',()=>edit('Behandl supportsag',[
   {name:'status',label:'Status',value:t.status,options:[['open','Afventer support'],['waiting_customer','Afventer kunde'],['resolved','Løst']]},
   {name:'priority',label:'Prioritet',value:t.priority,options:[['normal','Normal'],['high','Høj']]}
  ],async data=>{await api(base,'PATCH',{...data,version:t.version});await ticketDetail(c,id);})));box.append(controls);
 }
 content.replaceChildren(box);
}
$('#tickets-tab').onclick=()=>ticketList().catch(showError);

async function operationView(c,module,manage,shopId='',offset=0){
 const title=customerPages.find(p=>p[0]===module)[1];heading(title,'Virksomhedens data fra Shopify',c.name+' / '+title);
 const shops=(await api(`/companies/${c.id}/webshops`)).webshops;
 const select=el('select');select.setAttribute('aria-label','Webshop');for(const shop of shops){const o=el('option',shop.name);o.value=shop.id;select.append(o);}if(shopId)select.value=shopId;
 const box=panel(title),rows=el('div'),status=el('p');status.setAttribute('role','status');let after=null;
 box.append(actions(select),el('p',module==='insights'?'Historik over manuelle datahentninger. Automatiske jobs er ikke aktive i dev.':'Data læses fra Shopify. Bogføring og ændring af lager i Shopify er blokeret i dev.','module-notice'),status,rows);content.replaceChildren(box);
 if(!shops.length){rows.append(el('p','Tilføj en webshop under Integrationer.','empty'));return;}
 const base=()=>`/companies/${c.id}/webshops/${select.value}/data/${module}`;
 const format=m=>m?new Intl.NumberFormat('da-DK',{style:'currency',currency:m.currencyCode}).format(Number(m.amount)):'Ikke oplyst';
 const date=v=>new Date(v).toLocaleString('da-DK');
 const payment=names=>Array.isArray(names)?names.map(n=>({shopify_payments:'Shopify Payments',flatpay:'Flatpay',viabill:'ViaBill',paypal:'PayPal',manual:'Manuel betaling'}[n]||n)).join(', '):'Ikke oplyst';
 const detail=n=>{edit('Detaljer',[],async()=>{});const details=el('pre',JSON.stringify(n,null,2),'mail-preview');$('#editor-fields').append(details);};
 const search=el('input');search.type='search';search.placeholder='Søg i data';search.setAttribute('aria-label','Søg i data');
 let data;
 async function load(){data=await api(base()+'?'+new URLSearchParams({offset,search:search.value}));draw();}
 function draw(){rows.replaceChildren();
  if(module==='insights'){table(rows,['Job','Start','Slut','Status','Antal','Besked'],data.runs.map(r=>[r.module,date(r.started_at),r.finished_at?date(r.finished_at):'—',{running:'I gang',success:'Gennemført',failed:'Fejlet'}[r.status],r.count,r.message]));return;}
  if(module==='orders')table(rows,['Ordre','Dato','Betalingsudbyder','Afsendelse','Beløb','Bogføring',''],data.rows.map(n=>[n.name,date(n.createdAt),payment(n.paymentGatewayNames),n.cancelledAt?'Annulleret':n.displayFulfillmentStatus,format(n.currentTotalPriceSet.shopMoney),'Blokeret i dev',actions(button('Detaljer',()=>detail(n)),button('Bogføringsforslag',async()=>{const result=await api(`/companies/${c.id}/webshops/${select.value}/data/sales-preview`,'POST',{externalId:n.id});edit('Bogføringsforslag '+n.name,[],async()=>{},'Kun forhåndsvisning. Bogføring er blokeret i dev.');const target=$('#editor-fields');table(target,['Linje','Konto','Moms','Netto','Momsbeløb','Brutto'],result.draft.lines.map(l=>[l.title,l.account||'Mangler',l.vatCode||'Ingen',l.net/100,l.tax/100,l.gross/100]));result.draft.blockers.forEach(b=>target.append(el('p',b,'module-notice')));} ))]));
  if(module==='refunds')table(rows,['Ordre','Dato','Udbyder','Beløb','Gebyr','Netto','Bogføring'],data.rows.map(n=>[n.associatedOrder?.name||'—',date(n.transactionDate),'Shopify Payments',format(n.amount),format(n.fee),format(n.net),'Blokeret i dev']));
  if(module==='payouts')table(rows,['Udbyder','Udbetalings-ID','Dato','Beløb','Status','Bogføring',''],data.rows.map(n=>['Shopify Payments',n.id.split('/').pop(),date(n.issuedAt),format(n.net),n.status,'Blokeret i dev',actions(button('Detaljer',()=>detail(n)),...(manage&&!actor.support&&n.status==='PAID'?[button('Generér rapport',async()=>{await api(`/companies/${c.id}/webshops/${select.value}/documents`,'POST',{externalId:n.id});await customerView('documents');})]:[]))]));
  if(module==='inventory')table(rows,['Vare','SKU','Lokation','Antal','Kostpris','Lagerværdi'],data.rows.flatMap(n=>(n.tracked?n.inventoryLevels.nodes:[]).filter(l=>l.location.isActive).map(l=>{const quantity=l.quantities.find(q=>q.name==='on_hand').quantity;return[(n.variant?.product.title||'Ukendt vare')+' · '+(n.variant?.title||''),n.variant?.sku||'',l.location.name,quantity,format(n.unitCost),n.unitCost?format({...n.unitCost,amount:String(Math.max(0,quantity)*Number(n.unitCost.amount))}):'Kostpris mangler'];})));
  const paging=actions();if(offset)paging.append(button('Forrige',()=>operationView(c,module,manage,select.value,Math.max(0,offset-100))));if(data.hasMore)paging.append(button('Næste',()=>operationView(c,module,manage,select.value,offset+100)));rows.append(paging);
  if(data.rows.length)rows.append(el('p','Gemte data · seneste hentning på denne side: '+date(data.rows.map(n=>n.importedAt).sort().at(-1)),'hint'));
 }
 select.onchange=()=>operationView(c,module,manage,select.value).catch(showError);
 if(module!=='insights')box.prepend(actions(search,button('Søg',async()=>{offset=0;await load();})));
 if(manage&&!actor.support&&module!=='insights'){
  const sync=button('Hent data fra Shopify',async()=>{sync.disabled=true;try{const result=await api(base(),'POST',{after});after=result.hasNextPage?result.endCursor:null;status.textContent=result.count+' registreringer hentet. '+(after?'Der er flere sider – fortsæt hentningen.':'Hentningen er afsluttet.');sync.textContent=after?'Hent næste side':'Hent data fra Shopify';await load();}finally{sync.disabled=false;}});box.prepend(actions(sync));
 }
 await load();
}

async function accountingConnection(c,manage){
 const base=`/companies/${c.id}/accounting`,info=await api(base+'/connection'),editable=manage&&!actor.support;
 const box=panel('Dinero-forbindelse',editable?button(info.verifiedAt?'Test og opdatér forbindelse':'Forbind Dinero',()=>edit('Forbind Dinero',[
  {name:'organizationId',label:'Organisation-ID',value:info.organizationId,max:20},
  {name:'clientId',label:'Client ID',max:2048},{name:'clientSecret',label:'Client secret',type:'password',max:2048},
  {name:'apiKey',label:'API-nøgle',type:'password',max:2048}
 ],async data=>{await api(base+'/connection','PUT',data);await customerView('integrations');},'Forbindelsen kontrolleres ved at læse kontoplanen. Adgangsoplysninger gemmes krypteret. Der bogføres ikke i dev.')):null);
 box.append(el('p',info.verifiedAt?'Kontoplan hentet '+new Date(info.verifiedAt).toLocaleString('da-DK')+' · Organisation '+info.organizationId:'Ingen kontrolleret Dinero-forbindelse endnu.'));
 if(info.verifiedAt){
 const labels={vatCode:'Momskode for salg',noVatCode:'Momskode uden moms',goodsVat:'Varer med moms',goodsNoVat:'Varer uden moms',shippingVat:'Fragt med moms',shippingNoVat:'Fragt uden moms',servicesVat:'Ydelser med moms',servicesNoVat:'Ydelser uden moms',refundGoodsVat:'Returvarer med moms',refundGoodsNoVat:'Returvarer uden moms',refundShippingVat:'Returfragt med moms',refundShippingNoVat:'Returfragt uden moms',refundServicesVat:'Returydelser med moms',refundServicesNoVat:'Returydelser uden moms',fees:'Gebyrer',clearing:'Mellemregning',bank:'Bank',shopifyPaymentsClearing:'Shopify Payments mellemregning',viaBillClearing:'ViaBill mellemregning',flatpayClearing:'Flatpay mellemregning',inventory:'Varebeholdning',inventoryAdjustment:'Lagerregulering'};
 if(editable)box.append(button('Redigér kontotilknytninger',()=>edit('Kontotilknytninger',Object.entries(labels).map(([key,label])=>({name:key,label,value:info.mapping[key]||'',required:false,options:[['','Ikke valgt'],...(key==='vatCode'?[['U25','U25 – 25 % salgsmoms']]:key==='noVatCode'?[['NONE','Ingen moms']]:info.accounts.filter(a=>!a.hidden).map(a=>[a.number+' - '+a.name,a.number+' - '+a.name+(a.vatCode?' ('+a.vatCode+')':'')]))]})),async mapping=>{await api(base+'/mapping','PUT',{revision:info.revision,mapping});await customerView('integrations');})));
 const details=el('details');details.append(el('summary','Kontoplan og tilknytninger'));table(details,['Anvendelse','Konto'],Object.entries(labels).map(([key,label])=>[label,info.mapping[key]||'Ikke valgt']));table(details,['Konto','Navn','Momskode','Type'],info.accounts.map(a=>[a.number,a.name,a.vatCode||'Ingen moms',a.kind]));box.append(details);
 }
 content.append(box);
}

async function packagingView(c,manage,shopId='',from='',to=''){
 heading('Emballage','Registreringer, fordeling og prisoverslag',c.name+' / Emballage');
 const shops=(await api(`/companies/${c.id}/webshops`)).webshops,select=el('select');select.setAttribute('aria-label','Webshop');for(const s of shops){const o=el('option',s.name);o.value=s.id;select.append(o);}if(shopId)select.value=shopId;
 const box=panel('Emballage');content.replaceChildren(box);if(!shops.length){box.append(el('p','Tilføj en webshop under Integrationer.'));return;}
 const base=`/companies/${c.id}/webshops/${select.value}/packaging`,params=new URLSearchParams();if(from)params.set('from',from);if(to)params.set('to',to);const data=await api(base+'?'+params),p=data.period;
 const start=el('input'),end=el('input');start.type=end.type='date';start.value=p.start;end.value=p.end;start.setAttribute('aria-label','Fra dato');end.setAttribute('aria-label','Til dato');select.onchange=()=>packagingView(c,manage,select.value,start.value,end.value).catch(showError);
 box.append(actions(select,start,end,button('Vis periode',()=>packagingView(c,manage,select.value,start.value,end.value))),el('p','Emballage fra leverede Shopify-ordrer og manuelle registreringer. Kendte historiske vægte bevares ved genimport.','module-notice'));
 const refresh=()=>packagingView(c,manage,select.value,start.value,end.value);
 if(manage&&!actor.support)box.append(button('Hent leveringshistorik',async()=>{await api(base,'POST',{action:'sync',start:start.value,end:end.value});await refresh();}));
 if(data.sync)box.append(el('p','Seneste komplette hentning: '+data.sync.coverage_start+' – '+data.sync.coverage_end+' · '+new Date(data.sync.synced_at).toLocaleString('da-DK'),'hint'));
 table(box,['Produkt','Leveret antal','Samlet emballage','Indberetningspligtigt'],p.products.map(r=>[r.product,r.quantity,r.grams/1000+' kg',r.reportableGrams/1000+' kg']));

 const editor=item=>edit(item?'Redigér registrering':'Tilføj emballage',[
  {name:'date',label:'Dato',type:'date',value:item?.date||new Date().toISOString().slice(0,10)},
  {name:'description',label:'Beskrivelse',max:200,value:item?.description||''},
  {name:'supplier',label:'Leverandør',max:200,value:item?.supplier||'',required:false},
  {name:'supplierCountry',label:'Leverandørland',max:100,value:item?.supplierCountry||'DK'},
  {name:'supplierCvr',label:'Leverandør CVR',max:50,value:item?.supplierCvr||'',required:false},
  {name:'weightGrams',label:'Vægt i gram',type:'number',value:item?.weightGrams||0},
  {name:'audience',label:'Målgruppe',value:item?.audience||'household',options:[['household','Husholdning'],['commercial','Erhverv']]},
  {name:'reportable',label:'Indberetningspligtig',value:item?.reportable||'unknown',options:[['unknown','Ikke afklaret'],['yes','Ja'],['no','Nej']]}
 ],async value=>{await api(base,'POST',{...value,action:'save',...(item?{id:item.id,version:item.version}:{})});await refresh();});
 if(manage&&!actor.support)box.append(actions(button('Tilføj registrering',()=>editor()),button('Pris pr. kg',()=>edit('Prisoverslag',[
  {name:'household',label:'Husholdning, kr. pr. kg',value:data.prices.household},
  {name:'commercial',label:'Erhverv, kr. pr. kg (valgfri)',value:data.prices.commercial??'',required:false}
 ],async values=>{await api(base,'POST',{action:'prices',household:Number(values.household.replace(',','.')),commercial:values.commercial===''?null:Number(values.commercial.replace(',','.'))});await refresh();}))));
 table(box,['Indberetningspligtigt, husholdning','Indberetningspligtigt, erhverv','Uafklarede poster','Prisoverslag'],[[p.householdGrams/1000+' kg',p.commercialGrams/1000+' kg',p.unresolved,data.estimate===null?'Erhvervspris mangler':new Intl.NumberFormat('da-DK',{style:'currency',currency:'DKK'}).format(data.estimate)]]);
 table(box,['Dato','Beskrivelse','Leverandør','Gram','Målgruppe','Indberettes',''],p.manualEntries.map(e=>[e.date,e.description,e.supplier,e.weightGrams,e.audience==='commercial'?'Erhverv':'Husholdning',{yes:'Ja',no:'Nej',unknown:'Uafklaret'}[e.reportable],manage&&!actor.support?button('Redigér',()=>editor(e)):'']));
}

async function documentView(c,manage,shopId=''){
 heading('Udbetalingsrapporter','Kontrollerede rapporter med transaktionsspecifikation',c.name+' / Udbetalingsrapporter');
 const shops=(await api(`/companies/${c.id}/webshops`)).webshops,select=el('select');select.setAttribute('aria-label','Webshop');for(const shop of shops){const o=el('option',shop.name);o.value=shop.id;select.append(o);}if(shopId)select.value=shopId;
 const box=panel('Gemte rapporter',button('Åbn udbetalinger',()=>customerView('payouts')));content.replaceChildren(box);if(!shops.length){box.append(el('p','Tilføj en webshop under Integrationer.'));return;}box.append(select);select.onchange=()=>documentView(c,manage,select.value).catch(showError);
 const base=`/companies/${c.id}/webshops/${select.value}/documents`,data=await api(base);
 table(box,['Udbetaling','Oprettet','Status',''],data.documents.map(d=>{const link=el('a','Hent PDF','secondary small');link.href=platformRoot+'/api/platform'+base+'?id='+encodeURIComponent(d.id);return[d.external_id.split('/').pop(),new Date(d.created_at).toLocaleString('da-DK'),d.status==='generated'?'PDF klar':'Kræver kontrol',d.status==='generated'?link:''];}));box.append(el('p','Rapporter genereres fra Udbetalinger. Eksisterende PDF’er bevares. Viser seneste 100 rapporter.','hint'));
}

async function paymentConnections(c,manage,selected){
 const shops=(await api(`/companies/${c.id}/webshops`)).webshops;
 for(const shop of shops)for(const provider of ['flatpay','viabill']){
  const base=`/companies/${c.id}/webshops/${shop.id}/payments/${provider}`,{connection:saved}=await api(base+'/connection'),name=provider==='flatpay'?'Flatpay':'ViaBill';
  if(!saved&&!selected.includes(provider))continue;
  const box=panel(name+' · '+shop.name);
  box.append(el('p',saved?'Forbundet · '+(saved.agreementNumber||saved.accountId)+' · historik fra '+saved.startDate:'Ingen forbindelse endnu.'));
  if(manage&&!actor.support)box.append(button(saved?'Opdatér forbindelse':'Forbind '+name,()=>{
   const credentials=provider==='flatpay'?[{name:'username',label:'API-brugernavn'},{name:'password',label:'API-adgangskode',type:'password',max:2048}]:[{name:'apiKey',label:'API key',max:2048},{name:'secret',label:'Secret',type:'password',max:2048}];
   edit('Forbind '+name,credentials,async keys=>{
    let accounts=[];try{accounts=(await api(base+'/connection','POST',{...keys,action:'discover'})).accounts;}catch(error){if(provider==='flatpay')throw error;}
    const fields=provider==='flatpay'?[{name:'agreementNumber',label:'Aftale',value:saved?.agreementNumber,options:accounts.map(a=>[a.agreementNumber,a.agreementNumber+' · '+a.currency])}]:[{name:'accountId',label:'Merchant Account ID',value:saved?.accountId,...(accounts.length?{options:accounts.map(a=>[a.id,a.name])}:{})},{name:'name',label:'Forbindelsens navn',value:saved?.name||'ViaBill'}];
    // Open after the credential dialog has closed; the keys stay only in memory.
    setTimeout(()=>edit(name+' – vælg aftale',[...fields,{name:'startDate',label:'Historik fra',type:'date',value:saved?.startDate||new Date().toISOString().slice(0,10)}],async data=>{await api(base+'/connection','PUT',{...keys,...data,revision:saved?.revision});await customerView('integrations');}),0);
   },'Adgangsoplysninger krypteres. Vi kontrollerer kun læseadgang hos udbyderen.');
  }));
  if(saved)box.append(button('Åbn betalinger og udbetalinger',()=>paymentView(c,shop,provider,manage)));
  content.append(box);
 }
}
async function paymentView(c,shop,provider,manage,kind='',offset=0,range){
 const name=provider==='flatpay'?'Flatpay':'ViaBill',base=`/companies/${c.id}/webshops/${shop.id}/payments/${provider}`,{connection}=await api(base+'/connection');
 heading(name+' · '+shop.name,'Betalinger, afregninger og udbetalinger',c.name+' / Betalinger');
 const box=panel(name,button('Tilbage til integrationer',()=>customerView('integrations')));content.replaceChildren(box);
 const select=el('select');select.setAttribute('aria-label','Datatype');for(const [value,label] of (provider==='flatpay'?[['payments','Udbetalinger'],['transactions','Betalinger og refunderinger'],['settlements','Afregninger']]:[['payout','Udbetalinger'],['payment','Betalinger']])){const option=el('option',label);option.value=value;select.append(option);}if(kind)select.value=kind;
 const start=el('input'),end=el('input');start.type=end.type='date';start.setAttribute('aria-label','Fra dato');end.setAttribute('aria-label','Til dato');end.value=range?.end||new Date().toISOString().slice(0,10);start.value=range?.start||[connection.startDate,new Date(Date.now()-30*86400000).toISOString().slice(0,10)].sort().at(-1);
 const rows=el('div'),status=el('p',''),search=el('input');search.placeholder='Søg';search.setAttribute('aria-label','Søg betalinger');let cursor=null;
 async function load(){const params=new URLSearchParams({kind:select.value,offset,from:start.value,to:end.value,search:search.value});const data=await api(base+'/records?'+params);rows.replaceChildren();table(rows,['Post','Dato','Beløb','Status','Detaljer'],data.rows.map(r=>{
  const details=el('details');details.append(el('summary','Vis'),el('pre',JSON.stringify(r,null,2)));
  return[r.paymentID||r.transactionID||r.settlementNumber||r.entryUUID,r.paidDate||r.scheduledDate||r.purchaseDate||r.createdDate||r.date,(r.amountMinor!==undefined?r.amountMinor/100:r.payoutAmount??r.grossAmount??r.payout)+' '+r.currency,r.reconciled===false?'Afvigelse i afregning':r.scheduledDate&&!r.paidDate?'Kommende':'Importeret',details];
 }));const paging=actions();if(offset)paging.append(button('Forrige',()=>{offset=Math.max(0,offset-50);return load();}));if(data.hasMore)paging.append(button('Næste',()=>{offset+=50;return load();}));rows.append(paging);}
 const sync=button('Hent data',async()=>{sync.disabled=true;try{const result=await api(base+'/records','POST',{kind:select.value,start:start.value,end:end.value,cursor});cursor=result.next;status.textContent=result.count+' poster hentet.'+(cursor?' Der er flere sider.':'');sync.textContent=cursor?'Hent næste side':'Hent data';await load();}finally{sync.disabled=false;}});
 for(const input of [select,start,end])input.onchange=()=>{cursor=null;offset=0;sync.textContent='Hent data';load().catch(showError);};
 box.append(actions(select,start,end,search,button('Søg',()=>{offset=0;return load();}),...(manage&&!actor.support?[sync]:[])),el('p','Dev: Data læses hos udbyderen. Ingen bogføring eller tilbagebetaling udføres.','hint'),status,rows);await load();
}

async function stocktakeView(c,manage,shopId=''){
 heading('Lagerstatus og optælling','Aktuelle antal, kostpriser og kontrolleret reguleringsforslag',c.name+' / Lager');
 const shops=(await api(`/companies/${c.id}/webshops`)).webshops,select=el('select');select.setAttribute('aria-label','Webshop');for(const shop of shops){const o=el('option',shop.name);o.value=shop.id;select.append(o);}if(shopId)select.value=shopId;
 const box=panel('Lagerstatus');content.replaceChildren(box);if(!shops.length){box.append(el('p','Tilføj en webshop under Integrationer.'));return;}box.append(select);select.onchange=()=>stocktakeView(c,manage,select.value).catch(showError);
 const base=`/companies/${c.id}/webshops/${select.value}/stocktake`,rows=el('div'),result=el('div');box.append(rows,result);let data=null;const changes=new Map();
 const load=async()=>{data=await api(base);rows.replaceChildren();changes.clear();table(rows,['Vare','Variant','SKU','Lokation','Antal','Kostpris','Optalt'],data.rows.map(r=>{
 const count=el('input');count.type='number';count.min='0';count.max='10000000';count.value=r.quantity;count.disabled=!manage||Boolean(actor.support);count.setAttribute('aria-label','Optalt antal for '+r.product+' '+r.variant);count.onchange=()=>{const key=r.inventoryItemId+':'+r.locationId;if(Number(count.value)===r.quantity)changes.delete(key);else changes.set(key,{inventoryItemId:r.inventoryItemId,locationId:r.locationId,compareQuantity:r.quantity,quantity:Number(count.value)});};
 return[r.product,r.variant,r.sku,data.locations.find(l=>l.id===r.locationId)?.name||r.locationId,r.quantity,r.unitCostMinor/100+' '+r.currency,count];}));rows.append(el('p','Samlet positiv lagerværdi: '+data.totalValueMinor/100+' · Hentet '+new Date(data.fetchedAt).toLocaleString('da-DK'),'hint'));};
 box.prepend(actions(button('Hent aktuel lagerstatus',load),...(manage&&!actor.support?[button('Forbered optælling',async()=>{
 const prepared=await api(base,'POST',{action:'prepare',changes:[...changes.values()]});result.replaceChildren(el('h3','Kontrollér lagerreguleringen'),el('p','Værdiændring: '+prepared.adjustmentMinor/100+' DKK'),el('pre',JSON.stringify(prepared.voucher,null,2)),el('p','Dev-simulering: Shopify og Dinero ændres ikke.','module-notice'),actions(button('Godkend simulering',async()=>{await api(base,'POST',{action:'simulate',id:prepared.id,version:prepared.version,confirmation:true});result.replaceChildren(el('p','Simulering gennemført. Aktuelle antal og kostpriser blev kontrolleret igen. Ingen eksterne ændringer.'));}),button('Annullér forslag',async()=>{await api(base,'POST',{action:'cancel',id:prepared.id,version:prepared.version});result.replaceChildren();})));
 })]:[])));
 const history=await api(base+'?history=1');if(history.rows.length){const details=el('details');details.append(el('summary','Tidligere optællinger'));table(details,['Oprettet','Status','Værdiændring'],history.rows.map(r=>[new Date(r.created_at).toLocaleString('da-DK'),{prepared:'Afventer godkendelse',simulated:'Simuleret · ingen eksterne ændringer',cancelled:'Annulleret'}[r.phase],JSON.parse(r.payload_json).adjustmentMinor/100+' DKK']));box.append(details);}
}
