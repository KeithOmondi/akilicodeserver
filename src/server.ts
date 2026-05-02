import app from './app';
import env from './config/env';
import pool from './config/db';
import cron from 'node-cron';
import { sendPaymentReminders } from './utils/sendPaymentReminders';

/**
 * Safety Net: Handle Uncaught Exceptions
 * Must be registered at the top level, before anything else runs.
 */
process.on('uncaughtException', (err: Error) => {
  console.error('UNCAUGHT EXCEPTION! 💥');
  console.error(`${err.name}: ${err.message}`);
  process.exit(1);
});

const startCronJobs = () => {
  // Run every day at 8:00 AM Nairobi time
  cron.schedule(
    '0 8 * * *',
    async () => {
      console.log('⏰ Running payment reminder job...');
      await sendPaymentReminders();
    },
    { timezone: 'Africa/Nairobi' }
  );

  console.log('⏰ Cron jobs scheduled');
};

const startServer = async () => {
  try {
    // 1. Test Database Connection
    const client = await pool.connect();
    console.log('🐘 Database connection verified');
    client.release();

    // 2. Start Listening
    const server = app.listen(env.PORT, () => {
      console.log(`🚀 Server locked and loaded on port ${env.PORT}`);
      console.log(`🛡️  Mode: ${env.NODE_ENV}`);
    });

    /**
     * Safety Net: Handle Unhandled Rejections
     */
    process.on('unhandledRejection', (err: Error) => {
      console.error('UNHANDLED REJECTION! 💥');
      console.error(`${err.name}: ${err.message}`);
      server.close(() => process.exit(1));
    });
  } catch (error) {
    console.error('❌ Failed to start server due to DB connection error:', error);
    process.exit(1);
  }
};

startServer();
startCronJobs();