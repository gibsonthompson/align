// The installed app polls this to learn when a newer deploy is live.
export const dynamic = 'force-dynamic';

export function GET() {
  const version =
    process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_DEPLOYMENT_ID || process.env.NEXT_PUBLIC_BUILD_ID || 'dev';
  return Response.json({ version }, { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' } });
}
