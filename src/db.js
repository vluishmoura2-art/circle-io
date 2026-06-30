// db.js — conexão com PostgreSQL e funções de acesso a dados.
//
// Esperamos uma variável de ambiente DATABASE_URL (o Render Postgres já
// fornece isso automaticamente quando você cria o banco e conecta ao seu
// Web Service). Localmente, você precisa definir essa variável você mesmo
// apontando pra um Postgres local, ou simplesmente não testar login em
// localhost ainda — o resto do jogo continua funcionando sem banco.

const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
    console.warn('[db] AVISO: variável DATABASE_URL não definida. Login/Circoins não vão funcionar até você configurar o Postgres.');
}

const pool = DATABASE_URL
    ? new Pool({
        connectionString: DATABASE_URL,
        // O Postgres do Render exige SSL; em desenvolvimento local geralmente não.
        ssl: DATABASE_URL.includes('render.com') ? { rejectUnauthorized: false } : false
    })
    : null;

// ==========================================
// SCHEMA — cria as tabelas se não existirem ainda
// ==========================================
async function initSchema() {
    if (!pool) return;

    await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            username VARCHAR(20) UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            circoins INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMP NOT NULL DEFAULT NOW()
        );
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS user_skins (
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            skin_id VARCHAR(30) NOT NULL,
            purchased_at TIMESTAMP NOT NULL DEFAULT NOW(),
            PRIMARY KEY (user_id, skin_id)
        );
    `);

    console.log('[db] schema verificado/criado com sucesso.');
}

// ==========================================
// FUNÇÕES DE USUÁRIO
// ==========================================
async function createUser(username, passwordHash) {
    const result = await pool.query(
        `INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username, circoins`,
        [username, passwordHash]
    );
    return result.rows[0];
}

async function findUserByUsername(username) {
    const result = await pool.query(
        `SELECT id, username, password_hash, circoins FROM users WHERE username = $1`,
        [username]
    );
    return result.rows[0] || null;
}

async function findUserById(userId) {
    const result = await pool.query(
        `SELECT id, username, circoins FROM users WHERE id = $1`,
        [userId]
    );
    return result.rows[0] || null;
}

// Soma (ou subtrai, se amount for negativo) Circoins ao saldo do usuário.
// Retorna o novo saldo. Uso de transação simples via UPDATE...RETURNING
// evita problema de leitura-depois-escrita com múltiplas conexões.
async function addCircoins(userId, amount) {
    const result = await pool.query(
        `UPDATE users SET circoins = circoins + $1 WHERE id = $2 RETURNING circoins`,
        [amount, userId]
    );
    return result.rows[0] ? result.rows[0].circoins : null;
}

// ==========================================
// FUNÇÕES DE SKINS
// ==========================================
async function getUserSkins(userId) {
    const result = await pool.query(
        `SELECT skin_id FROM user_skins WHERE user_id = $1`,
        [userId]
    );
    return result.rows.map((row) => row.skin_id);
}

async function userOwnsSkin(userId, skinId) {
    const result = await pool.query(
        `SELECT 1 FROM user_skins WHERE user_id = $1 AND skin_id = $2`,
        [userId, skinId]
    );
    return result.rows.length > 0;
}

// Compra uma skin de forma segura: debita Circoins e registra a posse
// dentro de uma transação — se faltar saldo, nada é gravado.
async function purchaseSkin(userId, skinId, price) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const userResult = await client.query(
            `SELECT circoins FROM users WHERE id = $1 FOR UPDATE`,
            [userId]
        );
        const currentCoins = userResult.rows[0] ? userResult.rows[0].circoins : 0;

        if (currentCoins < price) {
            await client.query('ROLLBACK');
            return { success: false, reason: 'insufficient_funds', circoins: currentCoins };
        }

        const alreadyOwns = await client.query(
            `SELECT 1 FROM user_skins WHERE user_id = $1 AND skin_id = $2`,
            [userId, skinId]
        );
        if (alreadyOwns.rows.length > 0) {
            await client.query('ROLLBACK');
            return { success: false, reason: 'already_owned', circoins: currentCoins };
        }

        const updateResult = await client.query(
            `UPDATE users SET circoins = circoins - $1 WHERE id = $2 RETURNING circoins`,
            [price, userId]
        );

        await client.query(
            `INSERT INTO user_skins (user_id, skin_id) VALUES ($1, $2)`,
            [userId, skinId]
        );

        await client.query('COMMIT');
        return { success: true, circoins: updateResult.rows[0].circoins };
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

module.exports = {
    pool,
    initSchema,
    createUser,
    findUserByUsername,
    findUserById,
    addCircoins,
    getUserSkins,
    userOwnsSkin,
    purchaseSkin
};