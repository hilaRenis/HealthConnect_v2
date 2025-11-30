const express = require('express');
const {createProxyMiddleware} = require('http-proxy-middleware');
const jwt = require('jsonwebtoken');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const { register, metricsMiddleware } = require('./metrics');

const app = express();

// CORS Configuration
const corsOptions = {
    origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps or curl)
        if (!origin) return callback(null, true);

        const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3002').split(',');

        console.log(`[CORS DEBUG] Received origin: "${origin}"`);
        console.log(`[CORS DEBUG] Allowed origins: ${JSON.stringify(allowedOrigins)}`);

        if (allowedOrigins.indexOf(origin) !== -1) {
            console.log(`[CORS DEBUG] Origin ALLOWED: ${origin}`);
            callback(null, true);
        } else {
            console.log(`[SECURITY] CORS blocked origin: ${origin}`);
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400 // 24 hours
};

app.use(cors(corsOptions));

// Security middleware
app.use(helmet({
    contentSecurityPolicy: false, // Disable CSP for API Gateway (proxy only)
    hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true
    }
}));

// NOTE: Do NOT parse request bodies in the API Gateway
// The proxy middleware needs the raw body stream to forward to backend services
// Body parsing happens in the individual microservices

// Note: xss-clean not needed on API Gateway since we're just proxying requests
// XSS protection is applied at the individual service level

const JWT_SECRET = process.env.JWT_SECRET || 'devsecret';

// Check if rate limiting should be disabled (test/loadtest mode)
const disableRateLimit = process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'loadtest' || process.env.DISABLE_RATE_LIMIT === 'true';

// Rate limiters
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 login attempts per 15 minutes
    message: { error: 'Too many login attempts, please try again after 15 minutes' },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => disableRateLimit || req.path !== '/api/auth/login'
});

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // 100 requests per 15 minutes per IP
    message: { error: 'Too many requests from this IP, please try again later' },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => disableRateLimit || req.path === '/health' || req.path === '/metrics'
});

const map = {
    '/api/patients': process.env.PATIENT_URL,
    '/api/doctors': process.env.DOCTOR_URL,
    '/api/appointments': process.env.APPT_URL,
    '/api/pharmacies': process.env.PHARMACY_URL,
    '/api/admin': process.env.ADMIN_URL,
    '/api/auth': process.env.AUTH_URL
};

function isPublic(req) {
    return req.method === 'POST' && req.path === '/api/auth/login';
}

function authGuard(req, res, next) {
    if (isPublic(req)) return next();
    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer ')) {
        console.log(`[SECURITY] Unauthorized access attempt to ${req.path} from IP: ${req.ip}`);
        return res.status(401).json({error: 'No token'});
    }
    try {
        req.user = jwt.verify(auth.slice(7), JWT_SECRET);
        req.headers['x-user'] = JSON.stringify(req.user);
        next();
    } catch (e) {
        console.log(`[SECURITY] Invalid token for ${req.path} from IP: ${req.ip}`);
        return res.status(401).json({error: 'Invalid token'});
    }
}

app.use(metricsMiddleware('api-gateway'));

app.get('/health', (req, res) => res.json({gateway: true, ok: true}));
app.get('/metrics', async (req, res) => {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
});

// Apply rate limiters
app.use(loginLimiter);
app.use(apiLimiter);

app.use(authGuard);

// Optional coarse role guard example
app.use((req, res, next) => {
    if (req.path.startsWith('/api/doctors') && req.user?.role !== 'doctor' && req.user?.role !== 'admin') {
        console.log(`[SECURITY] Forbidden access attempt: user ${req.user?.sub} (${req.user?.role}) tried to access ${req.path}`);
        return res.status(403).json({error: 'Forbidden'});
    }
    next();
});

for (const [prefix, target] of Object.entries(map)) {
    if (!target) continue;
    let pathRewrite = {[`^${prefix}`]: ''};
    if (prefix === '/api/auth') {
        pathRewrite = (path, req) => req.originalUrl.replace(/^\/api\/auth/, '/auth');
    }
    app.use(prefix, createProxyMiddleware({
        target,
        changeOrigin: true,
        pathRewrite,
        onProxyReq(proxyReq, req) {
            // forward decoded user payload to downstream services
            if (req.user) {
                proxyReq.setHeader('x-user', JSON.stringify(req.user));
            }
        }
    }));
}

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`api-gateway on ${PORT}`));
