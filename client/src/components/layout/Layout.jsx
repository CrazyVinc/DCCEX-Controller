import { Link } from 'react-router-dom';
import { Icon } from '@iconify/react';
import { EmergencyStopButton } from './EmergencyStopButton.jsx';
import { FloatingNavigation } from './FloatingNavigation.jsx';

export function Layout({ children }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="top-0 z-40 border-b-2 border-[#854d0e] bg-(--surface)/90">
        <nav
          aria-label="Main navigation"
          className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8"
        >
          <div className="flex min-w-0 items-center gap-3">
            <Link to="/" className="flex items-center gap-2 truncate text-sm font-semibold tracking-tight text-(--page-fg) sm:text-base">
              <Icon icon="material-symbols:train" className="h-5 w-5 shrink-0" aria-hidden="true" />
              <span className="truncate">DCC controller</span>
            </Link>
          </div>
          <div className="flex shrink-0 items-center gap-4">
            <Link to="/rollingstock" className="flex items-center gap-2 truncate text-sm font-semibold tracking-tight text-(--page-fg) transition-colors hover:text-(--accent) sm:text-base">
              <Icon icon="material-symbols:train-outline-rounded" className="h-5 w-5 shrink-0" aria-hidden="true" />
              <span className="truncate">Rolling Stock</span>
            </Link>
            <Link to="/settings" className="flex items-center gap-2 truncate text-sm font-semibold tracking-tight text-(--page-fg) transition-colors hover:text-(--accent) sm:text-base">
              <Icon icon="material-symbols:settings" className="h-5 w-5 shrink-0" aria-hidden="true" />
              <span className="truncate">Settings</span>
            </Link>
          </div>
        </nav>
      </header>
      <EmergencyStopButton />
      <FloatingNavigation />
      {children}
      <footer className="mt-auto border-t border-(--surface-border) bg-(--surface)">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 text-sm text-(--muted) sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <p className="order-2 sm:order-1">Model railway DCC control</p>
          <p className="order-1 font-medium text-(--page-fg) sm:order-2">new-dcc-controller</p>
        </div>
      </footer>
    </div>
  );
}
