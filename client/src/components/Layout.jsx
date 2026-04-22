import { Link } from 'react-router-dom';

export function Layout({ children }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="top-0 z-40 border-b-2 border-[#854d0e] bg-[var(--surface)]/90">
        <nav
          aria-label="Main navigation"
          className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8"
        >
          <div className="flex min-w-0 items-center gap-3">
            <Link to="/" className="truncate text-sm font-semibold tracking-tight text-[var(--page-fg)] sm:text-base">
              DCC controller
            </Link>
          </div>
          <div className="flex shrink-0 items-center gap-4">
            <Link to="/rollingstock" className="truncate text-sm font-semibold tracking-tight text-[var(--page-fg)] transition-colors hover:text-[var(--accent)] sm:text-base">
              Rolling Stock
            </Link>
            <Link to="/settings" className="truncate text-sm font-semibold tracking-tight text-[var(--page-fg)] transition-colors hover:text-[var(--accent)] sm:text-base">
              Settings
            </Link>
          </div>
        </nav>
      </header>
      {children}
      <footer className="mt-auto border-t border-[var(--surface-border)] bg-[var(--surface)]">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 text-sm text-[var(--muted)] sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <p className="order-2 sm:order-1">Model railway DCC control</p>
          <p className="order-1 font-medium text-[var(--page-fg)] sm:order-2">new-dcc-controller</p>
        </div>
      </footer>
    </div>
  );
}
