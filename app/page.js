import { ScoutProvider } from '@/components/ScoutProvider';
import Shell from '@/components/Shell';

export const dynamic = 'force-dynamic';   // rendered per request so the Content-Security-Policy nonce can be applied

export default function Page() {
  return (
    <ScoutProvider>
      <Shell />
    </ScoutProvider>
  );
}
