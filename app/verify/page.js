import AuthFrame from '@/components/AuthFrame';
import LinkPanel from '@/components/LinkPanel';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Confirm your email — Scout', robots: { index: false } };

export default async function Verify({ searchParams }) {
  const { token } = await searchParams;
  return <AuthFrame><LinkPanel kind="verify" token={typeof token === 'string' ? token.slice(0, 80) : ''} /></AuthFrame>;
}
