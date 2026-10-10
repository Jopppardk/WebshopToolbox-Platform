import { useEffect, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import Home from './app/page';
import './app/globals.css';
import './fonts/fonts.css';
import {
  platformApi,
  portalRoot,
  selectWebshop,
  setActor,
  tier1Fetch,
} from './platform/transport';
import { DemoBanner } from './platform/demo-banner';
import { WorkspaceProvider, type Workspace } from './platform/workspace';
import { SupportBanner } from './platform/support-banner';
function App() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [error, setError] = useState('');
  const [needsProfile, setNeedsProfile] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let active = true;
    void (async () => {
      const { user } = await platformApi<{ user: Workspace['user'] }>(
        '/api/platform/me',
      );
      if (user.platformAdmin)
        throw new Error('Tier 1 kræver en virksomhedsbruger.');
      setActor(user);
      if (!user.fullName && !user.support) {
        if (active) setNeedsProfile(true);
        return;
      }
      const { company } = await platformApi<{ company: Workspace['company'] }>(
        '/api/platform/workspace',
      );
      const { webshops } = await platformApi<{
        webshops: Workspace['webshops'];
      }>(`/api/platform/companies/${company.id}/webshops`);
      const shops = webshops.filter((shop) => shop.status === 'active');
      const preferred = sessionStorage.getItem('toolbox-selected-shop');
      const selected =
        shops.find((shop) => shop.id === preferred)?.id || shops[0]?.id || null;
      selectWebshop(selected);
      const demo = selected
        ? await tier1Fetch('/api/runtime')
            .then((r) => (r.ok ? r.json() : {}))
            .then((v: { demo?: boolean }) => !!v.demo)
            .catch(() => false)
        : false;
      if (active)
        setWorkspace({
          user,
          company,
          webshops: shops,
          webshopId: selected,
          demo,
          choose: () => {},
        });
    })().catch((error) => {
      if (active) setError(error.message);
    });
    return () => {
      active = false;
    };
  }, []);
  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setSaving(true);
    setError('');
    try {
      await platformApi('/api/platform/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: values.get('name'),
          phone: values.get('phone'),
        }),
      });
      window.location.reload();
    } catch (error) {
      setError((error as Error).message);
      setSaving(false);
    }
  }
  if (needsProfile)
    return (
      <main className="mx-auto max-w-xl p-8">
        <h1 className="text-xl font-semibold">Velkommen til WebshopToolbox</h1>
        <p className="my-4">Udfyld din profil for at fortsætte.</p>
        {error && <p role="alert">{error}</p>}
        <form className="space-y-4" onSubmit={saveProfile}>
          <label className="block">
            Navn
            <input
              className="block w-full rounded border bg-white p-2"
              name="name"
              required
              maxLength={120}
            />
          </label>
          <label className="block">
            Telefon
            <input
              className="block w-full rounded border bg-white p-2"
              name="phone"
              type="tel"
              maxLength={40}
            />
          </label>
          <button
            className="rounded bg-primary px-4 py-2 text-white"
            disabled={saving}
          >
            {saving ? 'Gemmer…' : 'Gem og fortsæt'}
          </button>
        </form>
      </main>
    );
  if (error)
    return (
      <main className="mx-auto max-w-xl p-8">
        <h1 className="text-xl font-semibold">WebshopToolbox</h1>
        <p role="alert" className="my-4">
          {error}
        </p>
        <a className="underline" href={portalRoot + '/'}>
          {portalRoot ? 'Til administrationen' : 'Til kundeportalen'}
        </a>
      </main>
    );
  if (!workspace)
    return (
      <p className="p-8" role="status">
        Henter din virksomhed…
      </p>
    );
  const choose = (id: string) => {
    if (id !== '' && !workspace.webshops.some((shop) => shop.id === id)) return;
    if (id === '' && workspace.company.role !== 'admin') return;
    // "Fortryd" while adding a webshop returns to the one the user came from.
    if (id === '' && workspace.webshopId)
      sessionStorage.setItem('toolbox-previous-shop', workspace.webshopId);
    sessionStorage.setItem('toolbox-selected-shop', id);
    selectWebshop(id || null);
    setWorkspace({ ...workspace, webshopId: id || null });
  };
  return (
    <WorkspaceProvider value={{ ...workspace, choose }}>
      <SupportBanner user={workspace.user} />
      {workspace.demo && <DemoBanner />}
      <Home key={workspace.webshopId || 'none'} />
    </WorkspaceProvider>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
