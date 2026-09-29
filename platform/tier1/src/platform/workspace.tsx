import { createContext, useContext, type ReactNode } from 'react';
export type Workspace = {
  user: {id:string;email:string;fullName?:string;platformAdmin:boolean;support?:{sessionId:string;adminEmail:string;expiresAt:number}|null};
  company: {id:string;name:string;role:string};
  webshops: Array<{id:string;name:string;status:string}>;
  webshopId: string|null;
  choose: (id:string)=>void;
};
const Context = createContext<Workspace|null>(null);
export function WorkspaceProvider({value,children}:{value:Workspace;children:ReactNode}) {
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useWorkspace() {
  const value = useContext(Context);
  if (!value) throw new Error('Virksomheden er ikke indlæst.');
  return value;
}
export function WebshopSelector() {
  const {company,webshops,webshopId,choose} = useWorkspace();
  return <label className="flex flex-wrap items-center gap-2"><span>{company.name}</span>{webshops.length > 0 && <select aria-label="Webshop" className="rounded border bg-white px-2 py-1" value={webshopId || ''} onChange={event=>choose(event.target.value)}>{company.role==='admin'&&<option value="">Tilføj webshop…</option>}{webshops.map(shop=><option key={shop.id} value={shop.id}>{shop.name}</option>)}</select>}</label>;
}
export function CustomerIdentity() {
  const {user,company} = useWorkspace();
  return <div className="text-right"><p className="text-sm font-medium">{user.fullName || user.email}</p><p className="text-xs text-muted-foreground">{company.role==='admin'?'Administrator':'Bruger'}</p>{!user.support&&<form action="/logout" method="post"><button className="text-xs underline" type="submit">Log ud</button></form>}</div>;
}
