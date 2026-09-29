// Shared presentation helpers for the admin portal. The customer view itself lives in Tier 1.
// Same date style as the customer portal: "29. sep. 2026" and "29. sep. 2026 kl. 10.56", Danish time.
const dayFormat=new Intl.DateTimeFormat('da-DK',{day:'numeric',month:'short',year:'numeric',timeZone:'Europe/Copenhagen'}),clockFormat=new Intl.DateTimeFormat('da-DK',{hour:'2-digit',minute:'2-digit',timeZone:'Europe/Copenhagen'});
function parseWhen(v){if(v===null||v===undefined||v==='')return null;const d=typeof v==='number'||v instanceof Date?new Date(v):new Date(/^\d{4}-\d{2}-\d{2}$/.test(v)?v+'T12:00:00Z':/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(v)?v.replace(' ','T')+'Z':v);return Number.isNaN(d.getTime())?null:d;}
export const fmtDate=v=>{const d=parseWhen(v);return d?dayFormat.format(d):'—';};
export const fmtDateTime=v=>{const d=parseWhen(v);return d?dayFormat.format(d)+' kl. '+clockFormat.format(d):'—';};
