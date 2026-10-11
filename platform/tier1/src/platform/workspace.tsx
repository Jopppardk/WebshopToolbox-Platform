import { createContext, useContext, type ReactNode } from 'react';
import { Menu } from '@base-ui/react/menu';
import { Check, ChevronsUpDown, Plus, Store } from 'lucide-react';
export type Workspace = {
  user: {
    id: string;
    email: string;
    fullName?: string;
    platformAdmin: boolean;
    support?: {
      sessionId: string;
      adminEmail: string;
      expiresAt: number;
    } | null;
  };
  company: { id: string; name: string; role: string };
  webshops: Array<{ id: string; name: string; status: string }>;
  webshopId: string | null;
  demo?: boolean;
  choose: (id: string) => void;
};
const Context = createContext<Workspace | null>(null);
export function WorkspaceProvider({
  value,
  children,
}: {
  value: Workspace;
  children: ReactNode;
}) {
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useWorkspace() {
  const value = useContext(Context);
  if (!value) throw new Error('Virksomheden er ikke indlæst.');
  return value;
}
export function WebshopSelector() {
  const { company, webshops, webshopId, choose } = useWorkspace();
  const current = webshops.find((shop) => shop.id === webshopId);
  const admin = company.role === 'admin';
  if (!webshops.length)
    return (
      <span className="text-sm text-muted-foreground">{company.name}</span>
    );
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={`Webshop: ${current?.name || 'Ny webshop'}`}
        className="group flex max-w-72 items-center gap-3 rounded-xl border border-[#e9e2d7] bg-white py-1.5 pr-2.5 pl-1.5 text-left text-foreground shadow-[0_1px_2px_rgba(70,50,20,0.05)] transition hover:border-[#c09960] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring data-[popup-open]:border-[#c09960]"
      >
        <ShopBadge id={current?.id} name={current?.name} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[11px] leading-4 text-muted-foreground">
            {company.name}
          </span>
          <span className="block truncate text-sm leading-5 font-semibold">
            {current?.name || 'Ny webshop'}
          </span>
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-stone-400 group-hover:text-[#9a7440]" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner className="z-50" sideOffset={6} align="start">
          <Menu.Popup className="min-w-64 rounded-xl border border-[#e9e2d7] bg-white p-1.5 text-foreground shadow-[0_12px_40px_rgba(23,31,27,.14)] outline-none">
            <Menu.Group>
              <Menu.GroupLabel className="px-2.5 pt-1.5 pb-1 text-[11px] font-medium text-muted-foreground">
                Webshops i {company.name}
              </Menu.GroupLabel>
              {webshops.map((shop) => (
                <Menu.Item
                  key={shop.id}
                  onClick={() => choose(shop.id)}
                  className="flex cursor-default items-center gap-3 rounded-lg px-1.5 py-1.5 text-sm outline-none select-none data-[highlighted]:bg-[#f7efe3]"
                >
                  <ShopBadge id={shop.id} name={shop.name} small />
                  <span className="flex-1 truncate font-medium">
                    {shop.name}
                  </span>
                  {shop.id === webshopId && (
                    <Check
                      aria-label="Valgt"
                      className="size-4 text-[#9a7440]"
                    />
                  )}
                </Menu.Item>
              ))}
            </Menu.Group>
            {admin && (
              <>
                <Menu.Separator className="mx-1 my-1.5 h-px bg-[#eee8df]" />
                <Menu.Item
                  onClick={() => choose('')}
                  className="flex cursor-default items-center gap-3 rounded-lg px-1.5 py-1.5 text-sm text-[#9a7440] outline-none select-none data-[highlighted]:bg-[#f7efe3]"
                >
                  <span className="grid size-7 place-items-center rounded-lg border border-dashed border-[#d9c4a2]">
                    <Plus className="size-4" />
                  </span>
                  Tilføj webshop
                </Menu.Item>
              </>
            )}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
// A webshop's initial on a tone of its own, so webshops with the same initial (Sablen.dk, Sabeln.se) differ.
const badgeTones = [
  'bg-[#f4eadb] text-[#9a7440]',
  'bg-[#e3eee8] text-[#2f6b4f]',
  'bg-[#e6ebf4] text-[#3d5a8a]',
  'bg-[#f4e4df] text-[#a14e3c]',
];
export function ShopBadge({
  id,
  name,
  small,
}: {
  id?: string;
  name?: string;
  small?: boolean;
}) {
  const { webshops } = useWorkspace();
  const index = Math.max(
    0,
    webshops.findIndex((shop) => shop.id === id),
  );
  return (
    <span
      aria-hidden="true"
      className={`grid shrink-0 place-items-center rounded-lg font-semibold ${badgeTones[index % badgeTones.length]} ${small ? 'size-7 text-xs' : 'size-9 text-sm'}`}
    >
      {name ? (
        name.trim().charAt(0).toUpperCase()
      ) : (
        <Store className="size-4" />
      )}
    </span>
  );
}
// The selected webshop's name, when the company has a webshop chosen.
export function useWebshopName() {
  const { webshops, webshopId } = useWorkspace();
  return webshops.find((shop) => shop.id === webshopId)?.name ?? null;
}
// Page headings name the webshop they show, e.g. "Produktfeeds for Sablen.dk".
export function useShopTitle(title: string) {
  const name = useWebshopName();
  return name ? `${title} for ${name}` : title;
}
// No webshop chosen while the company already has one: an administrator is adding another webshop.
export function useAddingWebshop() {
  const { webshops, webshopId } = useWorkspace();
  return webshopId === null && webshops.length > 0;
}
export function CustomerIdentity() {
  const { user, company } = useWorkspace();
  return (
    <div className="text-right">
      <p className="text-sm font-medium">{user.fullName || user.email}</p>
      <p className="text-xs text-muted-foreground">
        {company.role === 'admin' ? 'Administrator' : 'Bruger'}
      </p>
      {!user.support && (
        <form action="/logout" method="post">
          <button className="text-xs underline" type="submit">
            Log ud
          </button>
        </form>
      )}
    </div>
  );
}
export function PageTitle({ title }: { title: string }) {
  return <h1 className="page-title">{useShopTitle(title)}</h1>;
}
