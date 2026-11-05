import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import OpenAI from 'openai';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 3000);
const MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';

if (!process.env.OPENAI_API_KEY) {
  console.warn('WARNING: OPENAI_API_KEY is missing. Set it in your hosting environment.');
}
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || 'missing-key' });

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '1mb' }));
app.use('/api/', rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: true, legacyHeaders: false }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Unsupported image type. Please upload JPG, PNG, WEBP, or GIF.'));
  }
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'KRD MATH LAB AI Teacher', model: MODEL, configured: Boolean(process.env.OPENAI_API_KEY) });
});

app.post('/api/solve', upload.single('image'), async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(503).json({ error: 'AI backend is not configured. Add OPENAI_API_KEY to the server environment.' });
    }
    const question = String(req.body.question || '').trim();
    if (!question && !req.file) {
      return res.status(400).json({ error: 'Write a mathematics question or upload an image.' });
    }
    if (question.length > 6000) {
      return res.status(413).json({ error: 'The question is too long. Please keep it under 6,000 characters.' });
    }

    const prompt = [
      'You are KRD MATH LAB AI Teacher, an expert and patient mathematics tutor for Grade 12 Scientific students.',
      'Teach in clear, correct English unless the student explicitly requests another language.',
      'Prioritize the Grade 12 mathematics curriculum: functions, graph transformations, limits, continuity, derivatives, applications of derivatives, domain and range, and trigonometry.',
      'For every solution: (1) identify what is given and what is required, (2) state the relevant rule/formula, (3) solve step by step with mathematically valid notation, (4) clearly state the final answer, and (5) add a short check or learning tip when useful.',
      'For an uploaded image, carefully read the mathematical expression, graph, labels, and answer choices. If any part is unclear, say exactly what is unreadable and ask for a clearer image rather than guessing.',
      'Do not invent missing values or silently change the question. If the problem has multiple interpretations, explain the ambiguity.',
      'Use readable plain text and Unicode math symbols. Keep explanations student-friendly but mathematically rigorous.'
    ].join('\n');

    const content = [{ type: 'input_text', text: question || 'Please read the mathematics problem in the uploaded image and solve it step by step.' }];
    if (req.file) {
      const base64 = req.file.buffer.toString('base64');
      content.push({
        type: 'input_image',
        image_url: `data:${req.file.mimetype};base64,${base64}`,
        detail: 'high'
      });
    }

    const response = await openai.responses.create({
      model: MODEL,
      instructions: prompt,
      input: [{ role: 'user', content }],
      max_output_tokens: 1800
    });
    const answer = (response.output_text || '').trim();
    if (!answer) return res.status(502).json({ error: 'The AI model returned an empty response. Please try again.' });
    return res.json({ answer, model: MODEL });
  } catch (error) {
    console.error('AI request failed:', error?.message || error);
    const status = error?.status && Number.isInteger(error.status) ? error.status : 500;
    return res.status(status >= 400 && status < 600 ? status : 500).json({
      error: status === 429 ? 'AI usage limit reached. Please wait and try again.' : 'The AI service could not complete the request. Please try again later.'
    });
  }
});

app.use(express.static(path.join(__dirname, 'public')));
app.get(/.*/, (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    return res.status(413).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Image must be smaller than 10 MB.' : 'Upload limit exceeded.' });
  }
  if (err) return res.status(400).json({ error: err.message || 'Invalid request.' });
  return res.status(500).json({ error: 'Unexpected server error.' });
});

app.listen(PORT, () => console.log(`KRD MATH LAB AI backend running on port ${PORT}`));
