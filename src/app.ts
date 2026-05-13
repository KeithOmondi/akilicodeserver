import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import hpp from 'hpp';
import cookieParser from 'cookie-parser'; // ← add this
import env from './config/env';
import { globalErrorHandler } from './middleware/errorMiddleware';
import { notFound } from './middleware/notFound';
import authRoutes from "./routes/authRoutes";
import kidRoutes from "./routes/kidRoutes";
import enrollmentRoutes from './routes/enrollmentRoutes';
import paymentRoutes from './routes/paymentRoutes';
import mpesaRoutes from './routes/mpesaRoutes';
import courseRoutes from "./routes/courseRoutes"
import trialRoutes from "./routes/trialRoutes"
import blogRoutes from "./routes/blogRoutes"
import testimonialRoutes from "./routes/testimonialRoutes"
import kidLearningRoutes from "./routes/kidLearningRoutes"
import codePlaygroundRoutes from "./routes/CodePlaygroundRoutes"

const app: Application = express();

app.use(helmet());

app.use(cors({
  origin: env.ALLOWED_ORIGIN,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(hpp());
app.use(cookieParser()); // ← add this, must be before routes
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

app.get('/', (req, res) => {
  res.status(200).json({
    status: 'success',
    message: 'Shields are up.',
    environment: env.NODE_ENV,
  });
});

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/kids', kidRoutes);
app.use('/api/v1/enrollments', enrollmentRoutes);
app.use('/api/v1/payments', paymentRoutes);
app.use('/api/v1/mpesa', mpesaRoutes);
app.use('/api/v1/courses', courseRoutes)
app.use('/api/v1/trials', trialRoutes)
app.use('/api/v1/blog', blogRoutes)
app.use('/api/v1/testimonials', testimonialRoutes)
app.use("/api/v1/learning", kidLearningRoutes)
app.use("/api/v1/playground", codePlaygroundRoutes)

app.use(notFound);
app.use(globalErrorHandler);

export default app;