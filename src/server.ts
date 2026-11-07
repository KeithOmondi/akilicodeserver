import app from './app';
import env from './config/env';
import pool from './config/db';
import cron from 'node-cron';
import { sendPaymentReminders } from './utils/sendPaymentReminders';
import { reconcilePendingPayments } from './services/paymentService';

process.on('uncaughtException', (err: Error) => {
  console.error('UNCAUGHT EXCEPTION! 💥');
  console.error(`${err.name}: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});

const startCronJobs = () => {
  cron.schedule(
    '0 8 * * *',
    async () => {
      console.log('⏰ Running payment reminder job...');
      try {
        await sendPaymentReminders();
      } catch (error) {
        console.error('❌ Payment reminder job failed:', error);
      }
    },
    { timezone: 'Africa/Nairobi' }
  );
  // Safety net: settle STK payments whose callback never reached us.
  cron.schedule('*/2 * * * *', async () => {
    try {
      await reconcilePendingPayments();
    } catch (error) {
      console.error('❌ Payment reconcile job failed:', (error as Error).message);
    }
  });
  console.log('⏰ Cron jobs scheduled');
};

const startServer = async () => {
  let server: any = null;

  try {
    const client = await pool.connect();
    console.log('🐘 Database connection verified');
    client.release();

    server = app.listen(env.PORT, () => {
      console.log(`🚀 Server locked and loaded on port ${env.PORT}`);
      console.log(`🛡️  Mode: ${env.NODE_ENV}`);
    });

    process.on('unhandledRejection', (err: Error) => {
      console.error('UNHANDLED REJECTION! 💥');
      console.error(`${err.name}: ${err.message}`);
      console.error(err.stack);
      server?.close(() => process.exit(1));
    });

    const shutdown = (signal: string) => {
      console.log(`👋 ${signal} received. Shutting down gracefully...`);
      server?.close(() => {
        console.log('💀 Process terminated');
        process.exit(0);
      });
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    return server;

  } catch (error) {
    console.error('❌ Failed to start server:', error);
    if (server) {
      server.close(() => process.exit(1));
    } else {
      process.exit(1);
    }
  }
};

startServer();
startCronJobs();