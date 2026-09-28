'use client';
import {useState} from 'react';
import {BookOpen} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {integrationGuides} from '@/lib/integration-guides';

export function IntegrationGuide({provider}:{provider:string}) {
  const [open,setOpen]=useState(false);
  const guide=integrationGuides[provider];
  if(!guide)return null;
  return <>
    <Button type="button" variant="outline" onClick={()=>setOpen(true)}><BookOpen/>Guide til API-adgang · {provider}</Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>{guide.title}</DialogTitle><DialogDescription>{guide.needs}</DialogDescription></DialogHeader>
        {guide.note&&<p className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">{guide.note}</p>}
        <ol className="list-decimal space-y-4 pl-5 text-sm leading-relaxed">{guide.steps.map((step,index)=><li key={index}>{step}</li>)}</ol>
        <div className="space-y-2 border-t pt-4 text-sm"><h3 className="font-semibold">Hvis forbindelsen ikke virker</h3><p>{guide.troubleshoot}</p></div>
        <p className="text-sm text-muted-foreground">Indsæt kun hemmeligheder i portalens forbindelsesfelter. Del dem ikke i mail, chat eller skærmbilleder. Gem en sikker kopi, hvis leverandøren kun viser værdien én gang.</p>
        <div className="space-y-2 border-t pt-4 text-sm"><h3 className="font-semibold">Officielle vejledninger</h3>{guide.sources.map(source=><a key={source.url} className="block underline underline-offset-4" href={source.url} target="_blank" rel="noreferrer">{source.label} ↗</a>)}<p className="text-xs text-muted-foreground">Kilder kontrolleret 28. september 2026. Leverandørens menunavne kan ændre sig.</p></div>
      </DialogContent>
    </Dialog>
  </>;
}
