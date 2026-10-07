import AuthFrame from '@/components/AuthFrame';
import LinkPanel from '@/components/LinkPanel';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Reset your password — Scout', robots: { index: false } };

export default async function Reset({ searchParams }) {
  const { token } = await searchParams;
  return <AuthFrame><LinkPanel kind="reset" token={typeof token === 'string' ? token.slice(0, 80) : ''} /></AuthFrame>;
}
