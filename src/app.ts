import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import hpp from 'hpp';
import cookieParser from 'cookie-parser'; // ← add this
import env from './config/env';
import pool from './config/db';
import { globalErrorHandler } from './middleware/errorMiddleware';
import { notFound } from './middleware/notFound';
import authRoutes from "./routes/authRoutes";
import kidRoutes from "./routes/kidRoutes";
import enrollmentRoutes from './routes/enrollmentRoutes';
import paymentRoutes from './routes/paymentRoutes';
import mpesaRoutes from './routes/mpesaRoutes';
import paystackRoutes from './routes/paystackRoutes';
import courseRoutes from "./routes/courseRoutes"
import trialRoutes from "./routes/trialRoutes"
import blogRoutes from "./routes/blogRoutes"
import testimonialRoutes from "./routes/testimonialRoutes"
import kidLearningRoutes from "./routes/kidLearningRoutes"
import pricingRoutes from './routes/pricingRoutes';
import userRoutes from "./routes/userRoutes"
import submissionRoutes from './routes/submissionRoutes';
import kidCalendarRoutes from './routes/kidCalendarRoutes';
import { kidProjectRoutes, adminProjectRoutes } from './routes/projectRoutes';
import { apiLimiter } from './middleware/rateLimiters';

const app: Application = express();

// Behind a reverse proxy (Render, Railway, Nginx...) set TRUST_PROXY=1 so req.ip is the real client.
app.set('trust proxy', env.TRUST_PROXY);
app.disable('x-powered-by');

app.use(helmet());

// Strict allow-list. A request with no Origin header (server-to-server, e.g. Safaricom, curl) is not a browser CORS request.
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || env.ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    return cb(null, false);
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Parent-Gate'],
}));

app.use(hpp());
app.use(cookieParser()); // ← add this, must be before routes
// Body size limits. The default is small; only routes that really carry big text get more.
// (A parser mounted first wins: later ones skip a request whose body is already read.)
// Paystack signs the EXACT bytes it sends, so its webhook is read raw (the signature is checked in the controller).
app.use('/api/v1/paystack/webhook', express.raw({ type: '*/*', limit: '64kb' }));
app.use(['/api/v1/blog', '/api/v1/courses'], express.json({ limit: '512kb' })); // admin lesson notes, blog posts
app.use('/api/v1/kid/projects', express.json({ limit: '2mb' })); // a child's HTML + CSS + JS, or blocks with painted pictures (each part is also capped in the validator)
app.use(['/api/v1/learning', '/api/v1/kids/courses', '/api/v1/submissions'], express.json({ limit: '64kb' })); // code a child types
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// Render/uptime checks. Reveals nothing about the setup; /health also proves the database answers.
app.get('/', (_req, res) => {
  res.status(200).json({ status: 'success', message: 'AkiliCode API' });
});
app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.status(200).json({ status: 'ok' });
  } catch {
    res.status(503).json({ status: 'unavailable' });
  }
});

app.use('/api', apiLimiter);
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/admin/users', userRoutes);
app.use('/api/v1/kids', kidRoutes);
app.use('/api/v1/enrollments', enrollmentRoutes);
app.use('/api/v1/payments', paymentRoutes);
app.use('/api/v1/mpesa', mpesaRoutes);
app.use('/api/v1/paystack', paystackRoutes);
app.use('/api/v1/courses', courseRoutes)
app.use('/api/v1/trials', trialRoutes)
app.use('/api/v1/blog', blogRoutes)
app.use('/api/v1/testimonials', testimonialRoutes)
app.use("/api/v1/learning", kidLearningRoutes)
app.use('/api/v1/pricing', pricingRoutes);
app.use('/api/v1/submissions', submissionRoutes);
app.use('/api/v1/kid/calendar', kidCalendarRoutes);
app.use('/api/v1/kid/projects', kidProjectRoutes);
app.use('/api/v1/admin/projects', adminProjectRoutes);

app.use(notFound);
app.use(globalErrorHandler);

export default app;