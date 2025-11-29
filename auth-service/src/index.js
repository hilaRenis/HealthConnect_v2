const jwt = require('jsonwebtoken');
const {nanoid} = require('nanoid');
const rateLimit = require('express-rate-limit');
const {createApp} = require('./http');
const db = require('./db');
const { publishEvent } = require('./kafka');

const USER_EVENTS_TOPIC = 'user.events';

const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'devsecret';

// Rate limiters (skip in test/loadtest mode)
const isTestMode = process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'loadtest' || process.env.DISABLE_RATE_LIMIT === 'true';

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 attempts per 15 minutes
    message: { error: 'Too many login attempts, please try again after 15 minutes' },
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => isTestMode,
});

const registerLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 10, // 10 registrations per hour
    message: { error: 'Too many registration attempts, please try again later' },
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => isTestMode,
});

const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // 100 requests per 15 minutes
    message: { error: 'Too many requests, please try again later' },
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => isTestMode,
});

function issueToken(user) {
    return jwt.sign({sub: user.id, role: user.role, name: user.name, email: user.email}, JWT_SECRET, {expiresIn: '2h'});
}

function authGuard(roleOrRoles) {
    const roles = Array.isArray(roleOrRoles) ? roleOrRoles : [roleOrRoles];
    return (req, res, next) => {
        let user = req.user; // Injected from http.js
        if (!user) {
            const auth = req.headers.authorization || '';
            if (auth.startsWith('Bearer ')) {
                try {
                    user = jwt.verify(auth.slice(7), JWT_SECRET);
                    req.user = user;
                } catch (err) {
                    return res.status(401).json({error: 'Invalid token'});
                }
            }
        }
        if (user && roles.includes(user.role)) {
            next();
        } else {
            res.status(403).json({error: 'Forbidden'});
        }
    };
}

function routes(app) {
    // Apply general rate limiter to all routes
    app.use(generalLimiter);

    app.post('/auth/register-doctor', registerLimiter, authGuard('admin'), async (req, res) => {
        const {name, email, password} = req.body || {};
        if (!name || !email || !password) return res.status(400).json({error: 'Missing fields'});
        const {rows} = await db.query('SELECT * FROM users WHERE email = $1 AND deleted_at IS NULL', [email]);
        if (rows.length > 0) return res.status(409).json({error: 'Email exists'});
        const user = {id: nanoid(), role: 'doctor', name, email, passwordHash: password}; // demo only
        await db.query('INSERT INTO users (id, role, name, email, passwordHash) VALUES ($1, $2, $3, $4, $5)',
            [user.id, user.role, user.name, user.email, user.passwordHash]);
        await publishEvent(USER_EVENTS_TOPIC, {
            type: 'USER_CREATED',
            id: user.id,
            role: user.role,
            name: user.name,
            email: user.email,
        });

        res.status(201).json({id: user.id});
    });

    app.put('/auth/users/:id', authGuard('admin'), async (req, res) => {
        const { id } = req.params;
        const { name, email, password } = req.body || {};

        if (!name || !email) return res.status(400).json({ error: 'Missing fields' });

        const { rows: existingRows } = await db.query('SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL', [id]);
        const existing = existingRows[0];
        if (!existing) return res.status(404).json({ error: 'User not found' });

        if (email !== existing.email) {
            const { rows: emailRows } = await db.query('SELECT 1 FROM users WHERE email = $1 AND id <> $2 AND deleted_at IS NULL', [email, id]);
            if (emailRows.length > 0) return res.status(409).json({ error: 'Email exists' });
        }

        const updates = [];
        const params = [];

        updates.push(`name = $${params.length + 1}`);
        params.push(name);

        updates.push(`email = $${params.length + 1}`);
        params.push(email);

        if (password) {
            updates.push(`passwordHash = $${params.length + 1}`);
            params.push(password);
        }

        params.push(id);

        const { rows: updatedRows } = await db.query(
            `UPDATE users SET ${updates.join(', ')}
             WHERE id = $${params.length} AND deleted_at IS NULL
             RETURNING id, role, name, email`,
            params
        );

        if (updatedRows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        const updatedUser = updatedRows[0];

        await publishEvent(USER_EVENTS_TOPIC, {
            type: 'USER_UPDATED',
            id: updatedUser.id,
            role: updatedUser.role,
            name: updatedUser.name,
            email: updatedUser.email,
        });

        res.json(updatedUser);
    });

    app.delete('/auth/users/:id', authGuard('admin'), async (req, res) => {
        const { id } = req.params;
        const { rows } = await db.query(
            'UPDATE users SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id, role',
            [id]
        );
        if (rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        const deleted = rows[0];
        await publishEvent(USER_EVENTS_TOPIC, {
            type: 'USER_DELETED',
            id: deleted.id,
            role: deleted.role,
            deletedAt: new Date().toISOString(),
        });

        res.status(204).send();
    });

    app.post('/auth/register-patient', registerLimiter, authGuard(['doctor', 'admin']), async (req, res) => {
        const {name, email, password} = req.body || {};
        if (!name || !email || !password) return res.status(400).json({error: 'Missing fields'});
        const {rows} = await db.query('SELECT * FROM users WHERE email = $1 AND deleted_at IS NULL', [email]);
        if (rows.length > 0) return res.status(409).json({error: 'Email exists'});
        const user = {id: nanoid(), role: 'patient', name, email, passwordHash: password}; // demo only
        await db.query('INSERT INTO users (id, role, name, email, passwordHash) VALUES ($1, $2, $3, $4, $5)',
            [user.id, user.role, user.name, user.email, user.passwordHash]);
        await publishEvent(USER_EVENTS_TOPIC, {
            type: 'USER_CREATED',
            id: user.id,
            role: user.role,
            name: user.name,
            email: user.email,
        });

        res.status(201).json({id: user.id});
    });

    app.post('/auth/login', loginLimiter, async (req, res) => {
        console.log('login', req.body);
        const {email, password} = req.body || {};
        const {rows} = await db.query('SELECT * FROM users WHERE email = $1 AND passwordHash = $2 AND deleted_at IS NULL', [email, password]);
        const user = rows[0];
        if (!user) return res.status(401).json({error: 'Invalid credentials'});
        res.json({token: issueToken(user)});
    });

    app.get('/auth/me', (req, res) => {
        const auth = req.headers.authorization || '';
        const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
        if (!token) return res.status(401).json({error: 'No token'});
        try {
            const payload = jwt.verify(token, JWT_SECRET);
            res.json(payload);
        } catch {
            res.status(401).json({error: 'Invalid token'});
        }
    });
}

createApp({name: 'auth-service', routes, port: PORT});