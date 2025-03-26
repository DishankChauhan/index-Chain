const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkTables() {
  try {
    // Check for users
    const users = await prisma.user.findMany();
    console.log('Users:', users.length);
    
    // Check for database connections
    const connections = await prisma.databaseConnection.findMany();
    console.log('Database Connections:', connections.length);
    
    // Check for jobs
    const jobs = await prisma.indexingJob.findMany();
    console.log('Jobs:', jobs.length);
    console.log('Job details:', JSON.stringify(jobs, null, 2));
    
    // Check for webhooks
    const webhooks = await prisma.webhook.findMany();
    console.log('Webhooks:', webhooks.length);
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkTables(); 