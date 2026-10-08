export function App() {
  return (
    <main className="page">
      <header className="brand">
        <div aria-hidden="true" className="mark">
          <i />
          <i />
          <i />
        </div>
        <p className="eyebrow">FLORIDA HOME DASHBOARD</p>
      </header>
      <section aria-labelledby="welcome-title" className="welcome">
        <p className="sample-label">Sample data — not real listings</p>
        <h1 id="welcome-title">
          Your next place,
          <br />
          <span>thought through.</span>
        </h1>
        <p className="copy">
          The local workspace is ready. Search, compare, and rank Florida homes with your own
          numbers and notes.
        </p>
        <div className="status">
          <span aria-hidden="true" className="status-dot" /> Scaffold online{' '}
          <span className="status-divider">·</span> local only
        </div>
      </section>
      <footer>
        Personal Florida home finder <span>Built for one person, on this computer.</span>
      </footer>
    </main>
  );
}
