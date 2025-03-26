import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import prisma from '@/lib/prisma';
import { DatabaseService } from '@/lib/services/databaseService';
import { NFTBidService } from '@/lib/services/nftBidService';
import { logError, logInfo } from '@/lib/utils/serverLogger';

export async function GET(request: Request) {
  try {
    // Get user session and verify auth
    const session = await auth();
    if (!session?.user?.id) {
      return new NextResponse('Unauthorized', { status: 401 });
    }

    // Extract query parameters
    const { searchParams } = new URL(request.url);
    const mintAddress = searchParams.get('mintAddress');

    if (!mintAddress) {
      return NextResponse.json(
        { error: 'Missing required parameter: mintAddress' },
        { status: 400 }
      );
    }

    // Get the user's active database connection
    const dbConnection = await prisma.databaseConnection.findFirst({
      where: {
        userId: session.user.id,
        status: 'active'
      }
    });

    if (!dbConnection) {
      return NextResponse.json(
        { error: 'No active database connection found' },
        { status: 400 }
      );
    }

    // Get database pool
    const dbService = DatabaseService.getInstance();
    const pool = await dbService.getPoolForApi({
      host: dbConnection.host,
      port: dbConnection.port,
      database: dbConnection.database,
      username: dbConnection.username,
      password: dbConnection.password,
      name: ''
    });

    // Get NFT bids
    const nftBidService = NFTBidService.getInstance();
    const bids = await nftBidService.getActiveBids(mintAddress, pool);

    logInfo('Successfully retrieved NFT bids', {
      component: 'NFTBidsAPI',
      action: 'GET',
      userId: session.user.id,
      mintAddress,
      bidCount: bids.length
    });

    return NextResponse.json({
      mintAddress,
      bids,
      totalMarketplaces: bids.length,
      totalBids: bids.reduce((sum, market) => sum + market.totalBids, 0)
    });
  } catch (error) {
    logError('Failed to get NFT bids', error as Error, {
      component: 'NFTBidsAPI',
      action: 'GET'
    });
    
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get NFT bids' },
      { status: 500 }
    );
  }
} 