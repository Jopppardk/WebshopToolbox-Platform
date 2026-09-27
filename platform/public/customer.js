// Customer presentation only; data access stays in the scoped platform API.
export const customerPages = [
 ['dashboard','Dashboard','grid',''],
 ['orders','Salg','box','Bogføring'],
 ['refunds','Tilbagebetalinger','undo',''],
 ['payouts','Udbetalinger','wallet',''],
 ['inventory','Lager','box',''],
 ['packaging','Emballage','box',''],
 ['invoices','Fakturaer','file','Dokumenter'],
 ['documents','Udbetalingsrapporter','file',''],
 ['insights','Indsigt','activity','System'],
 ['integrations','Integrationer','link',''],
 ['tickets','Support','file',''],
 ['settings','Indstillinger','settings',''],
];
function node(tag,text,cls){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;}
export function icon(key){
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
 for(const [k,v] of Object.entries({viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':'1.7','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true'}))svg.setAttribute(k,v);
 const paths={grid:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',box:'m3 7 9-4 9 4v10l-9 4-9-4z M3 7l9 5 9-5 M12 12v9',undo:'M3 10h11a6 6 0 0 1 0 12 M3 10l5-5 M3 10l5 5',wallet:'M3 5h16v15H3z M3 5V3h13 M15 10h6v5h-6z',file:'M5 3h9l5 5v13H5z M14 3v6h5 M8 13h8 M8 17h6',activity:'M2 12h5l3-8 4 16 3-8h5',link:'m9 15 6-6 M8 16l-2 2a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0 M16 8l2-2a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0',settings:'M12 3v3 M12 18v3 M3 12h3 M18 12h3 M5.6 5.6l2 2 M16.4 16.4l2 2 M5.6 18.4l2-2 M16.4 7.6l2-2 M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0'};
 const p=document.createElementNS(svg.namespaceURI,'path');p.setAttribute('d',paths[key]||paths.grid);svg.append(p);return svg;
}
export function customerShell(company,actor){
 document.querySelector('#customer-topbar')?.remove();
 const bar=node('div',undefined,'customer-topbar');bar.id='customer-topbar';
 const menu=node('button','☰','secondary mobile-menu');menu.type='button';menu.setAttribute('aria-label','Åbn menu');menu.setAttribute('aria-expanded','false');
 menu.onclick=()=>{const open=document.body.classList.toggle('menu-open');menu.setAttribute('aria-expanded',String(open));menu.setAttribute('aria-label',open?'Luk menu':'Åbn menu');};
 const name=node('span',company.name,'workspace-name');
 const identity=node('div',undefined,'top-identity');identity.append(node('strong',actor.fullName||actor.email),node('small',actor.platformAdmin?'Toolbox-administrator':company.role==='admin'?'Virksomhedsadministrator':'Medlem'));
 const avatar=node('span',(actor.fullName||actor.email).split(/\s+/).map(s=>s[0]).slice(0,2).join('').toUpperCase(),'avatar');
 const brand=node('a',undefined,'top-brand');brand.href=location.pathname.startsWith('/admin')?'/admin/':'/';brand.setAttribute('aria-label','WebshopToolbox – startside');
 const mark=node('img');mark.src='/favicon.png?v=transparent-1';mark.alt='';mark.width=36;mark.height=36;brand.append(mark);
 bar.append(menu,brand,name,identity,avatar);document.querySelector('main').prepend(bar);
}
function metric(title,value,note,cls=''){const m=node('article',undefined,'customer-metric '+cls);m.append(node('h3',title),node('strong',value),node('p',note));return m;}
export function customerDashboard(content,open,{accounting,shops,manage,connection,activity:summary,finance}){
 const setup=node('section',undefined,'connection-notice');
 setup.setAttribute('aria-label','Forbind dine integrationer');
 setup.append(node('h2','Kom godt i gang'),node('p','Forbind regnskabsprogram og webshop for at samle virksomhedens data.'));
 const cards=node('div',undefined,'connection-cards');
 // Saved configuration is not a verified connection. Live adapters are not enabled yet.
 for(const [target,title,description] of [
  ['accounting','Regnskabsprogram er ikke forbundet',accounting?'Dit regnskabsvalg er gemt og afventer tilslutning.':'Du har endnu ikke valgt et regnskabsprogram.'],
  ['webshops','Webshop er ikke forbundet',shops.some(s=>s.credentials_saved)?'Webshopopsætning er gemt og afventer tilslutning.':shops.length?'Din webshop er oprettet, men forbindelsen mangler opsætning.':'Du har endnu ikke tilføjet en webshop.']
 ]){
  if(target==='accounting'&&connection?.verifiedAt||target==='webshops'&&shops.some(s=>s.status==='active'&&s.verified_at))continue;
  const card=node('article',undefined,'connection-card');
  card.append(node('span','Ikke forbundet','connection-status'),node('h3',title),node('p',description));
  if(!manage)card.append(node('p','Kontakt virksomhedens administrator for at forbinde.'));
  const link=node('a',manage?(target==='accounting'?'Gå til regnskabsopsætning →':'Gå til webshopopsætning →'):'Se opsætning →');
  link.href='#integration-'+target;
  link.onclick=e=>{e.preventDefault();open('integrations',target);};card.append(link);cards.append(card);
 }
 setup.append(cards,node('p','Data hentes fra de enkelte sider. Bogføring er blokeret i dev.','dashboard-note'));if(!cards.childElementCount)setup.hidden=true;
 const activity=node('div',undefined,'panel activity-panel');
 for(const title of ['Salg','Udbetalinger']){
  const row=node('div',undefined,'activity-row');const titleBox=node('div',undefined,'activity-title');titleBox.append(icon(title==='Salg'?'box':'wallet'),node('strong',title),node('small','Importerede data'));row.append(titleBox);
  const data=summary.modules.find(m=>m.module===(title==='Salg'?'orders':'payouts'));
  row.append(metric('Importeret',String(data?.count||0),'Gemte registreringer'),metric('Bogføring','Blokeret','Testmiljø'),metric('Senest hentet',data?.importedAt?new Date(data.importedAt).toLocaleDateString('da-DK'):'—',''));activity.append(row);
 }
 const updates=node('div',undefined,'update-grid');
 for(const [label,key] of [['Salg','orders'],['Tilbagebetalinger','refunds'],['Lager','inventory']]){const data=summary.modules.find(m=>m.module===key);updates.append(metric(label,data?.importedAt?new Date(data.importedAt).toLocaleString('da-DK'):'Ikke hentet','Senest opdateret'));}
 for(const [label,key,value] of [['Fejlede kørsler','insights',String(summary.failedRuns)],['Integrationer','integrations','Se dine forbindelser']]){
  const b=node('button',undefined,'update-link');b.type='button';b.append(metric(label,value,'Åbn oversigt'));b.onclick=()=>open(key);updates.append(b);
 }
 activity.append(node('h2','Drift og status','section-heading'),updates,node('p','Tallene viser importerede data fra webshops, du har adgang til. Se detaljer og hentningshistorik på de enkelte sider.','dashboard-note'));
 const f=finance?.ready?finance.data:null,money=value=>value===null||value===undefined?'—':new Intl.NumberFormat('da-DK',{style:'currency',currency:'DKK',maximumFractionDigits:0}).format(value/100);
 const finances=node('section');finances.append(node('h2','Økonomi','section-heading'));
 const revenue=node('div',undefined,'revenue-grid');revenue.append(metric('Omsætning MTD',money(f?.revenueMtd),'Denne måned · sammenligning med samme dato sidste år'),metric('Omsætning YTD',money(f?.revenueYtd),'Året til dato · sammenligning med samme dato sidste år','accent'));finances.append(revenue);
 const other=node('div',undefined,'metric-grid');other.append(metric('Overskud MTD',money(f?.profitMtd),'Denne måned · før skat'),metric('Overskud YTD',money(f?.profitYtd),'Året til dato · før skat'),metric('Lagerværdi',money(f?.inventory),'Bogført saldo på lagerkontoen'));finances.append(other,node('p',(finance?.message||'Regnskabstal er tilgængelige for virksomhedsadministratoren.')+' Omsætning er ekskl. moms, overskud før skat.','dashboard-note'));
 content.replaceChildren(setup,activity,finances);
}
const modules={
 orders:{description:'Realiserede salg og bogføring samlet ét sted.',columns:['Ordre','Dato','Betalingsudbyder','Afsendelse','Beløb','Realiseret','Bogføring'],tabs:['Alle','Afventer','Bogført'],empty:'Ingen salg importeret endnu.'},
 refunds:{description:'Tilbagebetalinger fra dine webshops og betalingsudbydere.',columns:['Ordre','Dato','Udbyder','Beløb','Status','Bogføring'],tabs:['Alle','Afventer','Bogført'],empty:'Ingen tilbagebetalinger importeret endnu.'},
 payouts:{description:'Alle udbydere samlet · nyeste først · fælles historik.',columns:['Udbyder','Udbetalings-ID','Dato','Beløb','Udbetalingsstatus','Bogføringsstatus'],tabs:['Alle','Kommende','Afventer','Bogført'],empty:'Ingen udbetalinger importeret endnu.'},
 inventory:{description:'Lagerstatus og kontrolleret optælling baseret på fysisk antal og kostpris.',columns:['Vare','SKU','Antal','Kostpris','Lagerværdi'],tabs:['Lagerstatus','Optællinger'],empty:'Ingen lagerdata importeret endnu.'},
 packaging:{description:'Emballageforbrug og indberetning fordelt på husholdning og erhverv.',columns:['Periode','Materiale','Husholdning','Erhverv','Status'],tabs:['Overblik','Indberetning'],empty:'Ingen emballagedata importeret endnu.'},
 invoices:{description:'Fakturaer og dokumentation for dine ordrer.',columns:['Ordrenummer','Ordredato','Beløb','Fakturastatus'],tabs:['Alle','Oprettet','Sendt'],empty:'Ingen fakturaer oprettet endnu.'},
 documents:{description:'Afregningsrapporter og dokumentation for udbetalinger.',columns:['Udbyder','Periode','Udbetaling','Rapport','Status'],tabs:['Alle rapporter'],empty:'Ingen udbetalingsrapporter oprettet endnu.'},
 insights:{description:'Automatiske jobs, deres seneste resultat og den fulde kørselslog.',columns:['Job','Start','Varighed','Status','Besked'],tabs:['Alle','Gennemført','Afventer','Fejlet'],empty:'Ingen kørsler registreret endnu.'},
};
export function customerModule(key,content,heading,company,open){
 const config=modules[key];if(!config)return false;
 const page=customerPages.find(p=>p[0]===key);heading(page[1],config.description,company.name+' / '+page[1]);
 const notice=node('div',undefined,'module-notice');notice.append(node('span','Virksomhedens dataimport er endnu ikke aktiveret.'));
 const link=node('button','Åbn integrationer','secondary small');link.onclick=()=>open('integrations');notice.append(link);
 const panel=node('section',undefined,'panel');const tabs=node('div',undefined,'customer-tabs');tabs.setAttribute('role','tablist');
 const table=node('table');const head=node('thead');const tr=node('tr');config.columns.forEach(c=>tr.append(node('th',c)));head.append(tr);table.append(head);
 const body=node('tbody');const empty=node('td',config.empty,'empty');empty.colSpan=config.columns.length;const row=node('tr');row.append(empty);body.append(row);table.append(body);
 for(const [i,title] of config.tabs.entries()){const tab=node('button',title,i===0?'active':'');tab.type='button';tab.setAttribute('role','tab');tab.setAttribute('aria-selected',String(i===0));tab.onclick=()=>{tabs.querySelectorAll('button').forEach(b=>{b.classList.toggle('active',b===tab);b.setAttribute('aria-selected',String(b===tab));});empty.textContent=config.empty+(i?' Filter: '+title+'.':'');};tabs.append(tab);}
 const wrap=node('div',undefined,'table-wrap');wrap.append(table);panel.append(tabs,wrap);content.replaceChildren(notice,panel);return true;
}
