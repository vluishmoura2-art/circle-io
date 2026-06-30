// auth.js — registro, login e validação de tokens JWT.

const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('./db');

// IMPORTANTE: defina JWT_SECRET como variável de ambiente em produção
// (no painel do Render, em Environment). Sem isso, qualquer um que veja
// este código poderia forjar tokens. O valor abaixo é só um fallback pra
// não quebrar em desenvolvimento local.
const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-change-this-in-production';
const TOKEN_EXPIRY = '30d'; // tokens válidos por 30 dias

const BCRYPT_ROUNDS = 10;

const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,20}$/; // 3-20 caracteres, letras/números/underline

function validateUsername(username) {
    if (typeof username !== 'string') return false;
    return USERNAME_REGEX.test(username);
}

function validatePassword(password) {
    return typeof password === 'string' && password.length >= 6 && password.length <= 100;
}

// ==========================================
// REGISTRO
// ==========================================
async function register(username, password) {
    if (!validateUsername(username)) {
        return { success: false, error: 'Nome de usuário inválido (3-20 caracteres, letras/números/_).' };
    }
    if (!validatePassword(password)) {
        return { success: false, error: 'Senha precisa ter entre 6 e 100 caracteres.' };
    }

    const existing = await db.findUserByUsername(username);
    if (existing) {
        return { success: false, error: 'Esse nome de usuário já está em uso.' };
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const user = await db.createUser(username, passwordHash);

    const token = generateToken(user.id, user.username);
    return { success: true, token, user: { id: user.id, username: user.username, circoins: user.circoins } };
}

// ==========================================
// LOGIN
// ==========================================
async function login(username, password) {
    if (!validateUsername(username) || !validatePassword(password)) {
        return { success: false, error: 'Usuário ou senha inválidos.' };
    }

    const user = await db.findUserByUsername(username);
    if (!user) {
        return { success: false, error: 'Usuário ou senha incorretos.' };
    }

    const passwordMatches = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatches) {
        return { success: false, error: 'Usuário ou senha incorretos.' };
    }

    const token = generateToken(user.id, user.username);
    return { success: true, token, user: { id: user.id, username: user.username, circoins: user.circoins } };
}

// ==========================================
// JWT
// ==========================================
function generateToken(userId, username) {
    return jwt.sign({ userId, username }, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
}

function verifyToken(token) {
    try {
        return jwt.verify(token, JWT_SECRET);
    } catch (err) {
        return null;
    }
}

module.exports = {
    register,
    login,
    verifyToken
};