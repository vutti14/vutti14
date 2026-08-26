import express from 'express';
import path from 'node:path';
import { ROOT, migrate } from './db.js';
import { attachUser } from './auth.js';
import authRoutes from './routes/auth.js';
import masterRoutes from './routes/master.js';
import requestRoutes from './routes/requests.js';
import paymentRoutes from './routes/payments.js';
import documentRoutes from './routes/documents.js';
import financeRoutes from './routes/finance.js';
import reportRoutes from './routes/reports.js';
import adminRoutes from './routes/admin.js';
import lineRoutes from './routes/line.js';

migrate();

const app = express();
const PORT = process.env.PORT || 3000;

// Webhook ของไลน์ต้องอ่าน body ดิบก่อน parser ตัวอื่น เพราะลายเซ็นคำนวณจากไบต์ที่ส่งมาจริง
app.use('/api/line', express.raw({ type: '*/*', limit: '1mb' }), lineRoutes);

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// อ่านคุกกี้เอง — ไม่ต้องพึ่ง cookie-parser
app.use((req, _res, next) => {
  req.cookies = Object.fromEntries(
    (req.headers.cookie || '').split(';').filter(Boolean).map((c) => {
      const i = c.indexOf('=');
      return [decodeURIComponent(c.slice(0, i).trim()), decodeURIComponent(c.slice(i + 1))];
    }));
  next();
});
app.use(attachUser);

app.use('/api/auth', authRoutes);
app.use('/api', masterRoutes);
app.use('/api', requestRoutes);
app.use('/api', paymentRoutes);
app.use('/api', documentRoutes);
app.use('/api', financeRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/admin', adminRoutes);

app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'] }));

// SPA fallback
app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(ROOT, 'public', 'index.html')));

app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message || 'เกิดข้อผิดพลาดภายในระบบ' });
});

app.listen(PORT, () => {
  console.log(`RABBiZBuild Mini ERP — http://localhost:${PORT}`);
});
