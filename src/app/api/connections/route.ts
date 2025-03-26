import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { DatabaseService } from '@/lib/services/databaseService';
import { AppError } from '@/lib/utils/errorHandling';
import { logError, logInfo } from '@/lib/utils/serverLogger';
import prisma from '@/lib/db';
import { Prisma } from '@prisma/client';
import { DatabaseConnection } from '@/types';
import { NextRequest } from 'next/server';
import { handleError } from '@/lib/utils/errorHandling';
import { DatabaseConnectionInput } from '@/lib/types';

export async function GET(request: Request) {
  try {
    const session = await auth();
    
    if (!session?.user?.id) {
      return new NextResponse('Unauthorized', { status: 401 });
    }

    const connections = await prisma.databaseConnection.findMany({
      where: {
        userId: session.user.id
      },
      select: {
        id: true,
        host: true,
        port: true,
        database: true,
        username: true,
        status: true,
        createdAt: true,
        updatedAt: true
      }
    });

    logInfo('Successfully fetched database connections', {
      component: 'ConnectionsAPI',
      action: 'GET',
      userId: session.user.id,
      connectionCount: connections.length
    });

    return NextResponse.json({ data: connections });
  } catch (error) {
    logError('Failed to fetch database connections', error as Error, {
      component: 'ConnectionsAPI',
      action: 'GET'
    });
    return NextResponse.json(
      { error: 'Failed to fetch connections' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { host, port, database, username, password, metadata } = body;

    // Validate required fields
    if (!host || !port || !database || !username || !password) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    const connectionDetails: DatabaseConnectionInput = {
      host,
      port: Number(port),
      database,
      username,
      password,
      metadata: metadata || {}
    };

    const databaseService = DatabaseService.getInstance();
    const connection = await databaseService.saveConnection(connectionDetails);

    return NextResponse.json(connection);
  } catch (error) {
    const appError = handleError(error);
    return NextResponse.json(
      { error: appError.message },
      { status: appError.statusCode }
    );
  }
}