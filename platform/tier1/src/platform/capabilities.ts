import {useEffect,useState} from 'react';
import {tier1Fetch} from './transport';
export function useCapabilities(){
 const [value,setValue]=useState({production:false,bookkeeping:false,customerEmail:false});
 useEffect(()=>{let active=true;tier1Fetch('/api/runtime').then(async r=>{if(!r.ok)throw Error();return r.json() as Promise<{production?:boolean;bookkeeping?:boolean;customerEmail?:boolean}>;}).then(v=>{if(active)setValue({production:v.production===true,bookkeeping:v.bookkeeping===true,customerEmail:v.customerEmail===true});}).catch(()=>{});return()=>{active=false;};},[]);
 return value;
}
