import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import prisma from '@/lib/prisma';
import serverLogger from '@/lib/utils/serverLogger';
import { logError, logInfo } from '@/lib/utils/serverLogger';

export async function GET() {
  try {
    const session = await auth();
    // console.log('Session state:', session?.user?.id);
    logInfo('Dashboard request received', { userId: session?.user?.id });
    
    if (!session?.user?.id) {
      return new NextResponse('Unauthorized', { status: 401 });
    }

    const userData = await prisma.user.findUnique({
      where: { id: session.user.id },
      include: {
        dbConnections: {
          select: {
            id: true,
            database: true,
            host: true,
            status: true,
            lastConnectedAt: true
          }
        },
        indexingJobs: {
          select: {
            id: true,
            type: true,
            status: true,
            progress: true,
            config: true,
            createdAt: true,
            updatedAt: true
          },
          orderBy: {
            createdAt: 'desc'
          }
        }
      }
    });

    if (!userData) {
      return NextResponse.json({ 
        data: {
          user: null,
          connections: [],
          jobs: [],
          notifications: []
        }
      });
    }

    // Get unread notifications
    const notifications = await prisma.notification.findMany({
      where: {
        userId: session.user.id,
        status: 'unread'
      },
      select: {
        id: true,
        message: true,
        type: true,
        createdAt: true
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: 5
    });

    const dashboardData = {
      data: {
        user: {
          id: userData.id,
          email: userData.email,
          name: userData.name
        },
        connections: userData.dbConnections,
        jobs: userData.indexingJobs,
        notifications: notifications
      }
    };

    // Log user data state for debugging
    // console.log('User data state:', { 
    //   found: !!userData,
    //   hasConnections: userData?.dbConnections?.length ?? 0 > 0,
    //   hasJobs: userData?.indexingJobs?.length ?? 0 > 0
    // });
    
    logInfo('Dashboard data retrieved successfully', { 
      userId: session.user.id,
      hasConnections: userData.dbConnections.length > 0,
      hasJobs: userData.indexingJobs.length > 0,
      notificationCount: notifications.length
    });

    return NextResponse.json(dashboardData);
  } catch (error) {
    logError('Failed to fetch dashboard data', error as Error, {
      component: 'DashboardAPI',
      action: 'GET'
    });
    return NextResponse.json({ 
      data: null,
      error: 'Failed to fetch dashboard data'
    }, { 
      status: 500 
    });
  }
} 