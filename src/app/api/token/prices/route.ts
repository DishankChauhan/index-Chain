import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import prisma from '@/lib/prisma';
import { DatabaseService } from '@/lib/services/databaseService';
import { logError, logInfo } from '@/lib/utils/serverLogger';
import { Pool } from 'pg';

interface TokenPrice {
  platform: string;
  tokenSymbol: string;
  tokenName: string;
  mintAddress: string;
  price: number;
  currency: string;
  lastUpdated: Date;
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

    // Get query parameters
    const { searchParams } = new URL(request.url);
    const tokenSymbol = searchParams.get('symbol');
    const mintAddress = searchParams.get('mintAddress');
    
    if (!tokenSymbol && !mintAddress) {
      return NextResponse.json(
        { error: 'Either symbol or mintAddress parameter is required' },
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

    // Build the query
    let query = `
      SELECT 
        platform,
        token_symbol,
        token_name,
        mint_address,
        price,
        currency,
        last_updated
      FROM 
        token_prices
      WHERE 
    `;

    const params: any[] = [];
    let paramIndex = 1;

    if (mintAddress) {
      query += `mint_address = $${paramIndex}`;
      params.push(mintAddress);
      paramIndex++;
    } else if (tokenSymbol) {
      query += `LOWER(token_symbol) = LOWER($${paramIndex})`;
      params.push(tokenSymbol);
      paramIndex++;
    }

    query += `
      ORDER BY last_updated DESC
      LIMIT 50
    `;

    // Execute the query
    const result = await pool.query(query, params);

    const prices: TokenPrice[] = result.rows.map((row: any) => ({
      platform: row.platform,
      tokenSymbol: row.token_symbol,
      tokenName: row.token_name,
      mintAddress: row.mint_address,
      price: parseFloat(row.price),
      currency: row.currency,
      lastUpdated: row.last_updated
    }));

    // Calculate statistics
    let stats = null;
    if (prices.length > 0) {
      const priceValues = prices.map(p => p.price);
      stats = {
        minPrice: Math.min(...priceValues),
        maxPrice: Math.max(...priceValues),
        avgPrice: priceValues.reduce((a: number, b: number) => a + b, 0) / priceValues.length,
        totalPlatforms: Array.from(new Set(prices.map(p => p.platform))).length
      };
    }

    const identifier = mintAddress || tokenSymbol;
    logInfo(`Retrieved ${prices.length} token prices for ${identifier}`, {
      component: 'TokenPricesAPI',
      action: 'GET',
      userId: session.user.id
    });

    return NextResponse.json({
      token: {
        symbol: prices.length > 0 ? prices[0].tokenSymbol : tokenSymbol,
        name: prices.length > 0 ? prices[0].tokenName : null,
        mintAddress: prices.length > 0 ? prices[0].mintAddress : mintAddress
      },
      prices,
      stats
    });
  } catch (error) {
    logError('Error retrieving token prices:', error as Error, {
      component: 'TokenPricesAPI',
      action: 'GET'
    });
    
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to retrieve token prices' },
      { status: 500 }
    );
  }
} 