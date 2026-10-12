import { useEffect, useState, type ComponentType } from 'react';
import { AppWindow } from 'lucide-react';
import { tier1Fetch as fetch } from '@/platform/transport';

// Custom apps (platform/custom-apps.ts): apps built for one company. The server says which apps the company has; the
// menu "Custom apps" is shown only when there is at least one. A new app's page is added to customAppViews.
export type CustomApp = { id: string; name: string; description: string };

function ExampleApp() {
  const [status, setStatus] = useState('Kontrollerer forbindelsen…');
  useEffect(() => {
    fetch('/api/custom-apps/eksempel/status', { cache: 'no-store' })
      .then(async (response) => {
        const data = (await response.json()) as { error?: string };
        setStatus(
          response.ok
            ? 'Forbindelsen til appen virker.'
            : data.error || 'Appen svarede ikke.',
        );
      })
      .catch(() => setStatus('Appen svarede ikke.'));
  }, []);
  return <p className="text-sm">{status}</p>;
}

const customAppViews: Record<string, ComponentType<{ app: CustomApp }>> = {
  eksempel: ExampleApp,
};

export function useCustomApps() {
  const [apps, setApps] = useState<CustomApp[]>([]);
  useEffect(() => {
    fetch('/api/custom-apps', { cache: 'no-store' })
      .then(async (response) => {
        const data = (await response.json()) as { apps?: CustomApp[] };
        if (response.ok && Array.isArray(data.apps)) setApps(data.apps);
      })
      // Without the list the menu is simply not shown; the rest of the portal works as before.
      .catch(() => undefined);
  }, []);
  return apps;
}

export function CustomAppsNav({
  apps,
  active,
  onOpen,
}: {
  apps: CustomApp[];
  active: string | null;
  onOpen: (id: string) => void;
}) {
  if (!apps.length) return null;
  return (
    <>
      <p className="nav-label mt-7">Custom apps</p>
      {apps.map((app) => (
        <button
          key={app.id}
          className={`nav-item w-full ${active === app.id ? 'active' : ''}`}
          onClick={() => onOpen(app.id)}
        >
          <AppWindow />
          {app.name}
        </button>
      ))}
    </>
  );
}

export function CustomAppPage({ app }: { app: CustomApp }) {
  const View = customAppViews[app.id];
  return (
    <div className="mx-auto max-w-[1440px] px-5 py-7 md:px-8 md:py-9">
      <header className="mb-6">
        <p className="eyebrow">Custom apps</p>
        <h1 className="page-title">{app.name}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{app.description}</p>
      </header>
      {View ? (
        <View app={app} />
      ) : (
        <p className="text-sm text-muted-foreground">
          Appen er slået til, men har endnu ingen side i portalen.
        </p>
      )}
    </div>
  );
}
