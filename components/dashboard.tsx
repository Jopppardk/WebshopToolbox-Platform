'use client';
import { useEffect,useState,type ReactNode } from 'react';
import { ArrowDownRight,ArrowUpRight,ArrowRight,BarChart3,Boxes,CheckCircle2,Link2,RefreshCw,TriangleAlert,Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { percentageChange,type calculateFinance } from '@/lib/dashboard-finance';

type Finance={ready:boolean;data:ReturnType<typeof calculateFinance>|null;message?:string;checkedAt?:string;through?:string;stale?:boolean};
type Platform={connected:number;failed:number;succeeded:number;skipped:number;running:number;successRate:number|null;checkedAt:string;providers:Array<{key:string;name:string;connected:boolean;health:string;checkedAt:string|null}>};
const money=(value:number|null|undefined)=>value==null?'—':new Intl.NumberFormat('da-DK',{style:'currency',currency:'DKK',maximumFractionDigits:0}).format(value/100);
const date=(value:string)=>new Intl.DateTimeFormat('da-DK',{dateStyle:'short',timeZone:'Europe/Copenhagen'}).format(new Date(value));
const timestamp=(value:string)=>new Intl.DateTimeFormat('da-DK',{dateStyle:'short',timeStyle:'short',timeZone:'Europe/Copenhagen'}).format(new Date(value));
export function Dashboard({onJobs,onIntegrations}:{onJobs:(status:string)=>void;onIntegrations:()=>void}) {
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
      <div><p className="eyebrow">Sablen · Overblik</p><h1 className="mt-1 text-3xl font-semibold tracking-[-.035em] md:text-4xl">Dashboard</h1><p className="mt-2 text-sm text-muted-foreground">Din økonomi og drift, samlet ét sted.</p></div>
      <Button variant="outline" disabled={loading} onClick={()=>setRevision(v=>v+1)}><RefreshCw className={loading?'animate-spin':''}/>{loading?'Opdaterer…':'Opdatér'}</Button>
    </header>
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
    <section aria-labelledby="platform-heading" className="mt-10">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><h2 id="platform-heading" className="text-lg font-semibold">Platformstatus</h2><span className="text-xs text-muted-foreground">Kørsler · Seneste 24 timer</span></div>
      {errors.platform && <p role="alert" className="mb-4 text-sm text-red-700">{errors.platform}</p>}
      <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <div className="mb-5 flex items-center justify-between gap-3"><div className="flex items-center gap-3"><span className="rounded-xl bg-[#f1e7d7] p-2.5 text-[#6d5430]"><Link2 className="size-5"/></span><div><h3 className="font-semibold">Integrationer</h3><p className="text-sm text-muted-foreground">{stats?stats.connected+' tilsluttede':'Henter status…'}</p></div></div><button className="text-sm font-medium text-[#765523] hover:underline" onClick={onIntegrations}>Administrér</button></div>
          <div className="divide-y">{stats?.providers.map(p=><div key={p.key} className="flex flex-wrap items-center justify-between gap-3 py-4"><div><p className="font-medium">{p.name}</p><p className="mt-1 text-xs text-muted-foreground">{p.checkedAt?'Seneste aktivitet '+timestamp(p.checkedAt):p.connected?'Ingen automatisk kørsel bekræftet':'Forbind under Indstillinger'}</p></div><Health value={p.health}/></div>)}</div>
          <p className="mt-3 text-xs text-muted-foreground">Status bygger på seneste registrerede kørsler, ikke leverandørens generelle oppetid.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <button onClick={()=>onJobs('failed')} className="group rounded-2xl border bg-white p-5 text-left shadow-sm transition hover:border-red-300 focus-visible:outline-2 focus-visible:outline-offset-4"><span className="inline-flex rounded-xl bg-red-50 p-2.5 text-red-700"><TriangleAlert className="size-5"/></span><p className="mt-5 text-sm text-muted-foreground">Fejlede kørsler</p><p className="mt-1 text-4xl font-semibold tracking-tight">{stats?.failed ?? '—'}</p><p className="mt-5 flex items-center gap-2 text-xs font-medium">Se fejlede kørsler <ArrowRight className="size-4 transition group-hover:translate-x-1"/></p></button>
          <button onClick={()=>onJobs('succeeded')} className="group rounded-2xl border bg-white p-5 text-left shadow-sm transition hover:border-emerald-300 focus-visible:outline-2 focus-visible:outline-offset-4"><span className="inline-flex rounded-xl bg-emerald-50 p-2.5 text-emerald-700"><CheckCircle2 className="size-5"/></span><p className="mt-5 text-sm text-muted-foreground">Succesrate</p><p className="mt-1 text-4xl font-semibold tracking-tight">{stats?.successRate==null?'—':stats.successRate.toLocaleString('da-DK',{maximumFractionDigits:1})+' %'}</p><p className="mt-5 text-xs text-muted-foreground">{stats?stats.succeeded+' gennemført · '+stats.failed+' fejlet':'Af afsluttede kørsler'}</p><p className="mt-2 text-xs text-muted-foreground">Oversprungne og igangværende tælles ikke med.</p></button>
          <button onClick={()=>onJobs('')} className="flex items-center justify-between rounded-xl border bg-[#f3f1ee] px-5 py-3 text-sm sm:col-span-2"><span>{stats?stats.running+' i gang · '+stats.skipped+' sprunget over':'Se jobhistorik'}</span><ArrowRight className="size-4"/></button>
        </div>
      </div>
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
function Health({value}:{value:string}) {
  const labels:Record<string,string>={healthy:'I drift',attention:'Kræver kontrol',running:'Kører',stale:'Ingen nylig aktivitet',unknown:'Ikke bekræftet',disconnected:'Ikke forbundet'};
  const color=value==='healthy'?'bg-emerald-50 text-emerald-800':value==='attention'?'bg-red-50 text-red-800':value==='running'?'bg-blue-50 text-blue-800':'bg-stone-100 text-stone-700';
  return <span className={'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium '+color}><span className="size-1.5 rounded-full bg-current"/>{labels[value] || labels.unknown}</span>;
}
