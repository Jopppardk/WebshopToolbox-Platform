'use client';
import { tier1Fetch as fetch, tier1Url } from '@/platform/transport';
import { useEffect,useState,type ReactNode } from 'react';
import { ArrowDownRight,ArrowUpRight,ArrowRight,BarChart3,Boxes,RefreshCw,Wallet,Package,Activity,Clock3,Link2,TriangleAlert,Landmark,ShoppingBag,CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { danishDate } from '@/lib/history-policy';
import { percentageChange,type calculateFinance } from '@/lib/dashboard-finance';

type Finance={ready:boolean;data:ReturnType<typeof calculateFinance>|null;message?:string;checkedAt?:string;through?:string;stale?:boolean};
type ActivityCount={total:number;synced:number;failed:number;pending:number};
type Platform={inactive:number;activity:{today:string;orders:ActivityCount;payouts:ActivityCount;updated:{sales:string|null;refunds:string|null;packaging:string|null}};connected:number;failed:number;succeeded:number;skipped:number;running:number;successRate:number|null;checkedAt:string;providers:Array<{key:string;name:string;connected:boolean;health:string;checkedAt:string|null}>};
const money=(value:number|null|undefined)=>value==null?'—':new Intl.NumberFormat('da-DK',{style:'currency',currency:'DKK',maximumFractionDigits:0}).format(value/100);
const date=(value:string)=>new Intl.DateTimeFormat('da-DK',{dateStyle:'short',timeZone:'Europe/Copenhagen'}).format(new Date(value));
const timestamp=(value:string)=>new Intl.DateTimeFormat('da-DK',{dateStyle:'short',timeStyle:'short',timeZone:'Europe/Copenhagen'}).format(new Date(value));
type DashboardProps={onIntegrations:(provider?:'dinero'|'shopify')=>void};
export function Dashboard(props:DashboardProps) {
  const [connections,setConnections]=useState<Set<string>|null>(null);
  const [error,setError]=useState('');
  const [revision,setRevision]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();
    setError('');setConnections(null);
    fetch('/api/integrations',{cache:'no-store',signal:controller.signal})
      .then(async response=>{
        const data=await response.json() as {integrations?:Array<{provider:string}>;error?:string};
        if(!response.ok || !Array.isArray(data.integrations))throw new Error(data.error || 'Forbindelsesstatus kunne ikke hentes.');
        if(!controller.signal.aborted)setConnections(new Set(data.integrations.map(item=>item.provider)));
      }).catch(error=>{if(!controller.signal.aborted)setError(error instanceof Error?error.message:'Forbindelsesstatus kunne ikke hentes.');});
    return ()=>controller.abort();
  },[revision]);
  if(error)return <div role="alert" className="rounded-2xl border bg-white p-8"><p>{error}</p><Button className="mt-4" variant="outline" onClick={()=>setRevision(value=>value+1)}>Prøv igen</Button></div>;
  if(!connections)return <p role="status" className="p-8 text-muted-foreground">Kontrollerer dine forbindelser…</p>;
  if(connections.has('dinero') && connections.has('shopify'))return <ConnectedDashboard {...props} onIntegrations={()=>props.onIntegrations()}/>;
  return <section aria-labelledby="connect-heading" className="mx-auto max-w-4xl py-8 sm:py-14">
    <div className="mb-8 text-center"><h2 id="connect-heading" className="text-2xl font-semibold">Forbind din virksomhed</h2><p className="mt-3 text-muted-foreground">Forbind Dinero og din webshop for at komme i gang. Herefter vises dit dashboard her.</p></div>
    <div className="grid gap-6 sm:grid-cols-2">
      {([{provider:'dinero',name:'Dinero',description:'Dit regnskabsprogram',Icon:Landmark},{provider:'shopify',name:'Webshop',description:'Forbind din Shopify-butik',Icon:ShoppingBag}] as const).map(({provider,name,description,Icon})=>{
        const connected=connections.has(provider);
        return <button key={provider} type="button" onClick={()=>props.onIntegrations(provider)} className="group flex min-h-72 flex-col items-center justify-center rounded-2xl border border-[#e9e2d7] bg-white p-8 text-center transition hover:border-[#c09960] hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">
          <span className={`mb-5 grid size-24 place-items-center rounded-3xl ${connected?'bg-emerald-50 text-emerald-700':'bg-[#f4eadb] text-[#9a7440]'}`}><Icon className="size-12" aria-hidden="true"/></span>
          <span className="text-xl font-semibold">{name}</span><span className="mt-2 text-sm text-muted-foreground">{description}</span>
          <span className={`mt-6 flex items-center gap-2 text-sm font-medium ${connected?'text-emerald-700':'text-[#9a7440]'}`}>{connected?<><CheckCircle2 className="size-4"/>Forbundet · Se integration</>:<>Forbind {name}<ArrowRight className="size-4"/></>}</span>
        </button>;
      })}
    </div>
  </section>;
}
function ConnectedDashboard({onIntegrations}:{onIntegrations:()=>void}) {
  const [finance,setFinance]=useState<Finance|null>(null),[platform,setPlatform]=useState<Platform|null>(null);
  const [errors,setErrors]=useState<Record<string,string>>({}),[revision,setRevision]=useState(0),[loading,setLoading]=useState(true);
  useEffect(()=>{
    const controller=new AbortController();
    let active=true;
    const load=async()=>{
      setLoading(true);
      await Promise.all(['finance','platform'].map(async kind=>{
        try {
          const response=await fetch('/api/dashboard/'+kind,{cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(90000)])});
          const value=await response.json() as Finance & Platform & {error?:string};
          if (!response.ok) throw new Error(value.error || 'Data kunne ikke hentes.');
          if (!active) return;
          if (kind==='finance') setFinance(value); else setPlatform(value);
          setErrors(current=>({...current,[kind]:''}));
        } catch(error) {if(active) setErrors(current=>({...current,[kind]:error instanceof Error?error.message:'Data kunne ikke hentes.'}));}
      }));
      if(active) setLoading(false);
    };
    let running=false;
    const refresh=async()=>{if(running)return;running=true;try{await load();}finally{running=false;}};
    const initial=window.setTimeout(()=>{void refresh();},0);
    const timer=window.setInterval(()=>{if(!document.hidden)void refresh();},60000);
    return()=>{active=false;controller.abort();window.clearTimeout(initial);window.clearInterval(timer);};
  },[revision]);
  const data=errors.finance?null:finance?.data, stats=errors.platform?null:platform;
  return <div className="mx-auto max-w-[1440px] px-5 py-7 md:px-8 md:py-9">
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div><p className="eyebrow">WebshopToolbox · Overblik</p><h1 className="page-title">Dashboard</h1><p className="mt-2 text-sm text-muted-foreground">Din økonomi og drift, samlet ét sted.</p></div>
      <Button variant="outline" disabled={loading} onClick={()=>setRevision(v=>v+1)}><RefreshCw className={loading?'animate-spin':''}/>{loading?'Opdaterer…':'Opdatér'}</Button>
    </header>
    <section aria-label="Dagens aktivitet og systemstatus" className="mb-8 overflow-hidden rounded-2xl border border-[#e3d8c7] bg-white shadow-[0_8px_30px_rgba(70,50,20,0.05)]">
      {errors.platform && <p role="alert" className="border-b bg-red-50 p-4 text-sm text-red-700">{errors.platform}</p>}
      <ActivityRow icon={<Package className="size-5"/>} label="Salg" counts={stats?.activity.orders}/>
      <ActivityRow icon={<Wallet className="size-5"/>} label="Udbetalinger" counts={stats?.activity.payouts}/>
      <div className="border-t border-[#e9e2d7] bg-[#faf8f5] p-4 md:p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 className="flex items-center gap-2 text-sm font-semibold"><Activity className="size-4 text-[#9b7742]"/>Systemstatus</h2><span className="text-[11px] text-muted-foreground">Seneste gennemførte opdateringer</span></div>
        <div className="grid grid-cols-1 gap-2.5 min-[400px]:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
          <Update label="Salg" value={stats?.activity.updated.sales}/>
          <Update label="Tilbagebetalinger" value={stats?.activity.updated.refunds}/>
          <Update label="Lagerværdi" value={!errors.finance && finance?.data?.inventory != null ? finance.checkedAt : null}/>
          <Update label="Emballage" value={stats?.activity.updated.packaging}/>
          <button onClick={onIntegrations} className="group rounded-xl border border-[#e9e2d7] bg-white p-3.5 text-left transition hover:border-[#c09960] hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"><div className="mb-3 flex items-center justify-between"><Link2 className="size-4 text-[#9b7742]"/><ArrowRight className="size-3.5 text-stone-400 transition group-hover:translate-x-0.5"/></div><p className="text-xs text-muted-foreground">Integrationer</p><p className="mt-1 text-sm font-semibold">{stats?stats.connected+' aktive / '+stats.inactive+' inaktive':'—'}</p><p className="mt-1 text-[10px] text-muted-foreground">Aktive = tilsluttede</p></button>
        </div>
      </div>
      <p className="border-t px-5 py-3 text-[11px] text-muted-foreground">I dag: {stats?date(stats.activity.today):'—'} · Registrerede ordrer og udbetalinger fra alle betalingsudbydere med dagens dato i dansk tid. Synkroniseret = kladde eller bogført i Dinero. Afventer = endnu ikke overført, inkl. igangværende overførsler. Fejlede inkluderer overførsler, der kræver kontrol.</p>
    </section>
    <section aria-labelledby="finance-heading">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><h2 id="finance-heading" className="text-lg font-semibold">Økonomi</h2><span className="rounded-full border bg-white px-3 py-1 text-xs text-muted-foreground">Dinero · Omsætning ekskl. moms</span></div>
      {(errors.finance || finance?.message) && <p role={errors.finance?'alert':undefined} className="mb-4 text-sm text-muted-foreground">{errors.finance || finance?.message}</p>}
      <div className="grid gap-4 lg:grid-cols-2">
        <Revenue label="Omsætning MTD" subtitle="Denne måned" current={data?.revenueMtd ?? null} previous={data?.previousMtd ?? null} period={data?date(data.periods.monthStart)+' – '+date(data.periods.today):undefined} priorPeriod={data?date(data.periods.priorMonthStart)+' – '+date(data.periods.previous):undefined}/>
        <Revenue label="Omsætning YTD" subtitle="Året til dato" current={data?.revenueYtd ?? null} previous={data?.previousYtd ?? null} period={data?date(data.periods.yearStart)+' – '+date(data.periods.today):undefined} priorPeriod={data?date(data.periods.priorYearStart)+' – '+date(data.periods.previous):undefined} accent/>
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <Metric icon={<Wallet/>} label="Overskud MTD" value={money(data?.profitMtd)} note="Denne måned · før skat"/>
        <Metric icon={<BarChart3/>} label="Overskud YTD" value={money(data?.profitYtd)} note="Året til dato · før skat"/>
        <Metric icon={<Boxes/>} label="Lagerværdi" value={money(data?.inventory)} note="Bogført saldo på lagerkontoen"/>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">{finance?.checkedAt?'Senest hentet '+timestamp(finance.checkedAt)+'. ':''}{finance?.stale?'Data er forsinkede; opdatering afventes. ':''}Omsætning er ekskl. moms. Overskud er før skat og efter bogførte omkostninger; ikke-fradragsberettiget moms kan indgå i omkostningerne. Lagerværdi følger den bogførte saldo på lagerkontoen. MTD/YTD følger kalenderåret til og med dags dato. — betyder, at datagrundlaget mangler eller ikke kan beregnes sikkert.</p>
    </section>

  </div>;
}
function Revenue({label,subtitle,current,previous,period,priorPeriod,accent=false}:{label:string;subtitle:string;current:number|null;previous:number|null;period?:string;priorPeriod?:string;accent?:boolean}) {
  const change=percentageChange(current,previous);
  return <article className={'rounded-2xl border p-6 shadow-sm md:p-7 '+(accent?'border-[#d9c4a2] bg-[#f7efe3]':'bg-white')}>
    <div className="flex items-start justify-between gap-3"><div><h3 className="text-sm font-semibold">{label}</h3><p className="mt-1 text-xs text-muted-foreground">{subtitle}{period?' · '+period:''}</p></div><BarChart3 className="size-5 text-[#9b7742]"/></div>
    <p className="mt-6 text-4xl font-semibold tracking-[-.04em] tabular-nums md:text-5xl">{money(current)}</p>
    <div className="mt-5 flex flex-wrap items-center gap-2">{change!==null?<span className={'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold '+(change>=0?'bg-emerald-100 text-emerald-800':'bg-red-100 text-red-800')}>{change>=0?<ArrowUpRight className="size-3.5"/>:<ArrowDownRight className="size-3.5"/>}{change>0?'+':''}{change.toLocaleString('da-DK',{maximumFractionDigits:1})} %</span>:<span className="text-xs text-muted-foreground">Ingen beregnelig %-sammenligning</span>}<span className="text-xs text-muted-foreground">ift. samme periode sidste år</span></div>
    <div className="mt-5 flex flex-wrap justify-between gap-2 border-t border-black/10 pt-4 text-xs text-muted-foreground"><span>{priorPeriod || 'Samme dato sidste år'}</span><span className="font-medium tabular-nums">{money(previous)}</span></div>
  </article>;
}
function Metric({icon,label,value,note}:{icon:ReactNode;label:string;value:string;note:string}) { return <article className="rounded-2xl border bg-white p-5 shadow-sm"><div className="flex items-center justify-between gap-2"><h3 className="text-sm text-muted-foreground">{label}</h3><span className="text-[#9b7742] [&_svg]:size-5">{icon}</span></div><p className="mt-4 text-3xl font-semibold tracking-tight tabular-nums">{value}</p><p className="mt-2 text-xs text-muted-foreground">{note}</p></article>; }

function ActivityRow({label,counts,icon}:{label:string;counts?:ActivityCount;icon:ReactNode}) {
  return <div className="grid grid-cols-2 items-center gap-3 border-b border-[#eee8df] px-4 py-5 md:px-6 lg:grid-cols-[minmax(150px,0.9fr)_repeat(4,minmax(0,1fr))]">
    <div className="col-span-2 flex items-center gap-3 lg:col-span-1"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#f4eadc] text-[#8a6636]">{icon}</span><div><h2 className="text-sm font-semibold">{label}</h2><span className="text-[11px] text-muted-foreground">Dagens aktivitet</span></div></div>
    <div className="rounded-xl bg-stone-50 px-3 py-3 text-center"><p className="text-[10px] font-medium text-muted-foreground sm:text-[11px]">Antal i dag</p><p className="mt-1.5 text-3xl font-semibold tracking-tight tabular-nums">{counts?.total ?? '—'}</p></div>
    <div className="rounded-xl bg-emerald-50/70 px-3 py-3 text-center"><p className="text-[10px] font-medium text-emerald-800 sm:text-[11px]">Synkroniseret til Dinero</p><p className="mt-1.5 text-3xl font-semibold tracking-tight tabular-nums text-emerald-800">{counts?.synced ?? '—'}</p></div>
    <div className="rounded-xl bg-amber-50/70 px-3 py-3 text-center"><p className="text-[10px] font-medium text-amber-800 sm:text-[11px]">Afventer</p><p className="mt-1.5 text-3xl font-semibold tracking-tight tabular-nums text-amber-800">{counts?.pending ?? '—'}</p></div>
    <div className={'rounded-xl px-3 py-3 text-center '+(counts?.failed?'bg-red-50':'bg-stone-50')}><p className="text-[10px] font-medium text-muted-foreground sm:text-[11px]">Fejlede</p><p className={'mt-1.5 text-3xl font-semibold tracking-tight tabular-nums '+(counts?.failed?'text-red-700':'text-stone-500')}>{counts?.failed ?? '—'}</p></div>
  </div>;
}
function Update({label,value}:{label:string;value?:string|null}) {
  const today=Boolean(value && danishDate(new Date(value)) === danishDate());
  const time=value?new Intl.DateTimeFormat('da-DK',{timeStyle:'short',timeZone:'Europe/Copenhagen'}).format(new Date(value)):null;
  return <div className="rounded-xl border border-[#e9e2d7] bg-white p-3.5"><div className="mb-3 flex items-center justify-between"><Clock3 className="size-4 text-[#9b7742]"/>{today && <span className="rounded-full bg-[#f4eadc] px-2 py-0.5 text-[10px] font-semibold text-[#765523]">I dag</span>}</div><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-sm font-semibold tabular-nums">{value?(today?'kl. '+time:date(value)+' · '+time):'Ikke registreret'}</p><p className="mt-1 text-[10px] text-muted-foreground">Senest opdateret</p></div>;
}
