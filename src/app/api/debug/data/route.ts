import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import prisma from '@/lib/prisma';
import { logError, logInfo } from '@/lib/utils/serverLogger';
import { DatabaseService } from '@/lib/services/databaseService';

/**
 * Debug endpoint to view raw data from the database tables
 * Only accessible to authenticated users
 * Returns the first 10 records from the requested table
 */
export async function GET(request: NextRequest) {
  try {
    // Verify user is authenticated
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get query parameters
    const { searchParams } = new URL(request.url);
    const table = searchParams.get('table');
    const limit = parseInt(searchParams.get('limit') || '10');

    // Validate table
    const validTables = ['nft_bids', 'nft_prices', 'token_prices', 'lending_rates', 'processed_data'];
    if (!table || !validTables.includes(table)) {
      return NextResponse.json({
        error: 'Invalid table',
        validTables
      }, { status: 400 });
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

    // Query the database
    let query = `SELECT * FROM ${table} ORDER BY created_at DESC LIMIT $1`;
    const result = await pool.query(query, [limit]);

    // Get count of total records in table
    const countResult = await pool.query(`SELECT COUNT(*) FROM ${table}`);
    const totalRecords = parseInt(countResult.rows[0].count);

    logInfo(`Retrieved ${result.rowCount} records from ${table}`, {
      component: 'DebugAPI',
      action: 'getData',
      userId: session.user.id,
      table
    });

    return NextResponse.json({
      table,
      totalRecords,
      limit,
      recordsReturned: result.rowCount,
      data: result.rows
    });
  } catch (error) {
    logError('Error retrieving debug data:', error as Error, {
      component: 'DebugAPI',
      action: 'getData'
    });
    
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to retrieve data' },
      { status: 500 }
    );
  }
} 