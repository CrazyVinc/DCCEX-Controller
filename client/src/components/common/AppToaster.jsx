import { Toaster } from 'sonner';

export function AppToaster() {
  return (
    <Toaster
      position="bottom-right"
      theme="dark"
      closeButton
      duration={4000}
      richColors
    />
  );
}
