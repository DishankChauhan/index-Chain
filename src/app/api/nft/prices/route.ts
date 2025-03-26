import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import prisma from '@/lib/prisma';
import { DatabaseService } from '@/lib/services/databaseService';
import { logError, logInfo } from '@/lib/utils/serverLogger';
import { Pool } from 'pg';

interface PriceData {
  marketplace: string;
  price: number;
  currency: string;
  lastUpdated: Date;
  isListed: boolean;
}

export async function GET(request: NextRequest) {
  try {
    // Verify user is authenticated
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Get mintAddress from query params
    const { searchParams } = new URL(request.url);
    const mintAddress = searchParams.get('mintAddress');
    
    if (!mintAddress) {
      return NextResponse.json(
        { error: 'Missing mintAddress parameter' },
        { status: 400 }
      );
    }

    // Get user's active database connection
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

    // Query for NFT prices
    const result = await pool.query(`
      SELECT 
        marketplace,
        price,
        currency,
        last_updated,
        is_listed
      FROM 
        nft_prices
      WHERE 
        mint_address = $1 AND
        is_listed = true
      ORDER BY 
        last_updated DESC
    `, [mintAddress]);

    const prices: PriceData[] = result.rows.map((row: any) => ({
      marketplace: row.marketplace,
      price: parseFloat(row.price),
      currency: row.currency,
      lastUpdated: row.last_updated,
      isListed: row.is_listed
    }));

    // Calculate statistics if prices exist
    let stats = null;
    if (prices.length > 0) {
      const priceValues = prices.map(p => p.price);
      stats = {
        minPrice: Math.min(...priceValues),
        maxPrice: Math.max(...priceValues),
        avgPrice: priceValues.reduce((a: number, b: number) => a + b, 0) / priceValues.length,
        totalListings: prices.length
      };
    }

    logInfo(`Retrieved ${prices.length} NFT prices for ${mintAddress}`, {
      component: 'NFTPricesAPI',
      action: 'GET'
    });

    return NextResponse.json({
      mintAddress,
      prices,
      stats,
      totalMarketplaces: Array.from(new Set(prices.map(p => p.marketplace))).length
    });
  } catch (error) {
    logError('Error retrieving NFT prices:', error as Error, {
      component: 'NFTPricesAPI',
      action: 'GET'
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to retrieve NFT prices' },
      { status: 500 }
    );
  }
} 