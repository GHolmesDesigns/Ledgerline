import { useEffect, useState } from 'react';

type Route = { title: string; eyebrow: string; path: string };

const routes: Route[] = [
  { title: 'Search', eyebrow: 'Find your next place', path: '/' },
  { title: 'Compare', eyebrow: 'Side by side', path: '/compare' },
  { title: 'Ranking & data', eyebrow: 'Make it yours', path: '/settings' },
];

function currentPage(pathname: string) {
  if (pathname === '/compare') return routes[1];
  if (pathname === '/settings') return routes[2];
  if (pathname.startsWith('/property/')) {
    return { title: 'Property detail', eyebrow: 'Home details', path: pathname };
  }
  return routes[0];
}

function BrandMark() {
  return (
    <span aria-hidden="true" className="brand-mark">
      <i />
      <i />
      <i />
    </span>
  );
}

function Navigation({ pathname }: { pathname: string }) {
  const page = currentPage(pathname);
  return (
    <nav aria-label="Main navigation" className="primary-nav">
      {routes.map((route) => (
        <a
          aria-current={page.path === route.path ? 'page' : undefined}
          className="nav-link"
          href={route.path}
          key={route.path}
        >
          {route.title}
        </a>
      ))}
    </nav>
  );
}

export function App({ initialPath }: { initialPath?: string } = {}) {
  const [pathname, setPathname] = useState(
    () => initialPath ?? (typeof window === 'undefined' ? '/' : window.location.pathname),
  );
  const page = currentPage(pathname);

  useEffect(() => {
    const syncPath = () => setPathname(window.location.pathname);
    window.addEventListener('popstate', syncPath);
    return () => window.removeEventListener('popstate', syncPath);
  }, []);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="site-header">
        <a aria-label="Ledgerline home" className="brand" href="/">
          <BrandMark />
          <span className="brand-name">Ledgerline</span>
        </a>
        <Navigation pathname={pathname} />
        <span className="header-context">Florida home dashboard</span>
      </header>

      <div className="sample-notice" role="status">
        <span className="sample-notice-dot" aria-hidden="true" />
        Sample data — not real listings
      </div>

      <main className="screen-content" id="main-content" tabIndex={-1}>
        <div className="screen-heading">
          <p className="screen-eyebrow">{page.eyebrow}</p>
          <h1>{page.title}</h1>
        </div>
        <section aria-label={`${page.title} placeholder`} className="empty-panel">
          <span aria-hidden="true" className="empty-panel-mark">
            <BrandMark />
          </span>
          <p>Screen content is coming next.</p>
        </section>
      </main>

      <footer className="site-footer">
        <span>Personal Florida home finder</span>
        <span>Built for one person, on this computer.</span>
      </footer>

      <nav aria-label="Mobile navigation" className="mobile-nav">
        {routes.map((route) => (
          <a
            aria-current={page.path === route.path ? 'page' : undefined}
            className="mobile-nav-link"
            href={route.path}
            key={route.path}
          >
            {route.title}
          </a>
        ))}
      </nav>
    </div>
  );
}
