export type Severity='warning'|'alarm';
export type IncidentMailSettings={enabled:boolean;warnings:boolean;alarms:boolean;email:string};
export function incidentMailSettings(value?:string):IncidentMailSettings{
 try{const p=JSON.parse(value||'{}');const warnings=typeof p.warnings==='boolean'?p.warnings:p.enabled===true,alarms=typeof p.alarms==='boolean'?p.alarms:p.enabled===true;return {enabled:warnings||alarms,warnings,alarms,email:typeof p.email==='string'?p.email:''};}
 catch{return {enabled:false,warnings:false,alarms:false,email:''};}
}
// Only explicitly recoverable pre-write failures are warnings. Unknown outcomes
// and configuration errors require review, even if a scheduler runs again.
export function flatpayIncident(cause:string,phase?:string):{severity:Severity;action:string}{
 const retry=(!phase||phase==='prepared')&&(/Afregningerne stemmer ikke med bankudbetalingen|Flatpay svarede ikke efter tre læseforsøg|Flatpay-læsningen fejlede \(HTTP (429|5\d\d)\)|Udbetalingen er ændret hos Flatpay/.test(cause));
 return retry?{severity:'warning',action:'Systemet forsøger automatisk igen ved næste aktiverede udbetalingskørsel. Du skal ikke bogføre manuelt. Beskeden lukkes automatisk, når bogføringen er bekræftet.'}:{severity:'alarm',action:'Kontrollér udbetalingens log, afregningsgrundlag og Dinero. Ret eventuelle konto- eller adgangsfejl. Ved usikker status: kontrollér, om bilaget findes i Dinero, før du bruger Bogfør manuelt.'};
}
