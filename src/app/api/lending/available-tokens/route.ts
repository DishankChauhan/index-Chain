import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import prisma from '@/lib/prisma';
import { DatabaseService } from '@/lib/services/databaseService';
import { LendingService } from '@/lib/services/lendingService';
import { logError, logInfo } from '@/lib/utils/serverLogger';

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
    const protocol = searchParams.get('protocol');
    const sortBy = searchParams.get('sortBy') || 'borrow_rate';
    const sortOrder = searchParams.get('sortOrder') || 'asc';
    
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

    // Get lending service instance
    const lendingService = LendingService.getInstance();
    
    // Get available tokens
    const tokens = await lendingService.getAvailableTokens(pool, {
      protocolName: protocol || undefined,
      minLiquidity: undefined,
      maxBorrowRate: undefined
    });

    // Calculate statistics
    const stats = {
      totalProtocols: Array.from(new Set(tokens.map(t => t.protocolName))).length,
      totalPools: Array.from(new Set(tokens.map(t => t.poolName))).length,
      totalTokens: tokens.length,
      avgBorrowRate: tokens.length > 0 
        ? tokens.reduce((sum, token) => sum + parseFloat(token.borrowRate.toString()), 0) / tokens.length 
        : 0,
      avgSupplyRate: tokens.length > 0 
        ? tokens.reduce((sum, token) => sum + parseFloat(token.supplyRate.toString()), 0) / tokens.length 
        : 0
    };

    logInfo(`Retrieved ${tokens.length} available lending tokens`, {
      component: 'LendingAPI',
      action: 'getAvailableTokens',
      userId: session.user.id,
      protocol: protocol || 'all'
    });

    return NextResponse.json({
      tokens,
      stats,
      params: {
        protocol: protocol || 'all',
        sortBy,
        sortOrder
      }
    });
  } catch (error) {
    logError('Error retrieving available lending tokens:', error as Error, {
      component: 'LendingAPI',
      action: 'getAvailableTokens'
    });
    
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to retrieve available lending tokens' },
      { status: 500 }
    );
  }
} 