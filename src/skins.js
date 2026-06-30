// skins.js — catálogo central de skins disponíveis na loja.
//
// Skins gratuitas (paletas de cor, times, países) não precisam estar
// aqui — essas são só cosméticas e não tocam Circoins nem efeitos de
// jogo, então o cliente pode aplicá-las livremente sem checagem do
// servidor. Este catálogo é só para skins PAGAS com efeito de gameplay,
// que precisam ser validadas no servidor (preço, posse, efeito real).

const SKIN_CATALOG = {
    electric: {
        id: 'electric',
        name: 'Skin Elétrica',
        price: 500,
        description: 'Invulnerabilidade permanente a vírus.',
        effect: 'virus_immunity' // usado no server.js pra checar o efeito
    }
    // Futuras skins pagas (mesmo padrão de preço/patamar, conforme você
    // mencionou) entram aqui, cada uma com seu próprio "effect" único,
    // que precisa ser tratado explicitamente em updatePhysics() — um
    // efeito listado aqui sem tratamento correspondente não faz nada.
};

function getSkin(skinId) {
    return SKIN_CATALOG[skinId] || null;
}

function getAllSkins() {
    return Object.values(SKIN_CATALOG);
}

module.exports = {
    SKIN_CATALOG,
    getSkin,
    getAllSkins
};