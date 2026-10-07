import { ScoutProvider } from '@/components/ScoutProvider';
import Shell from '@/components/Shell';

export default function Page() {
  return (
    <ScoutProvider>
      <Shell />
    </ScoutProvider>
  );
}
