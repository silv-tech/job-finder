import { NextRequest, NextResponse } from 'next/server';
import { verifyExtensionAuth } from '@/lib/auth-api';

export const dynamic = 'force-dynamic';

// Returns config + verifies auth for the extension
// Called without auth for connection check, with auth for full config
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');

  // If no auth header, just return connection status (for popup connection check)
  if (!authHeader) {
    return NextResponse.json({ status: 'ok', authenticated: false });
  }

  // If auth header present, verify it
  const auth = await verifyExtensionAuth(req);
  if (auth instanceof NextResponse) return auth;

  return NextResponse.json({
    status: 'ok',
    authenticated: true,
    user: { id: auth.userId, email: auth.email },
    supported_sites: [
      {
        id: 'onlinejobs_ph',
        name: 'OnlineJobs.ph',
        domain: 'onlinejobs.ph',
        enabled: true,
      },
    ],
  });
}
