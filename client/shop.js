// shop.js — busca saldo/skins do jogador logado e processa compras.

const token = localStorage.getItem('ballio_token');
const shopBalance = document.getElementById('shopBalance');
const shopGrid = document.getElementById('shopGrid');
const shopMessage = document.getElementById('shopMessage');

// Sem token, não tem como acessar a loja — manda de volta pro menu pra
// fazer login. (Convidados não têm Circoins nem skins pagas.)
if (!token) {
    window.location.href = 'menu.html';
}

async function loadShop() {
    try {
        const response = await fetch('/api/me', {
            headers: { Authorization: `Bearer ${token}` }
        });

        if (!response.ok) {
            // Token inválido/expirado — manda de volta pro login
            localStorage.removeItem('ballio_token');
            window.location.href = 'menu.html';
            return;
        }

        const data = await response.json();
        renderShop(data);
    } catch (err) {
        shopMessage.textContent = 'Erro de conexão ao carregar a loja.';
    }
}

function renderShop(data) {
    shopBalance.textContent = `Saldo: ${data.user.circoins} Circoins`;
    shopGrid.innerHTML = '';

    data.availableSkins.forEach((skin) => {
        const owned = data.ownedSkins.includes(skin.id);
        const canAfford = data.user.circoins >= skin.price;

        const item = document.createElement('div');
        item.className = 'shop-item';

        const info = document.createElement('div');
        info.className = 'shop-item-info';
        info.innerHTML = `<h3>${skin.name}</h3><p>${skin.description}</p>`;

        const price = document.createElement('div');
        price.className = 'shop-item-price';
        price.textContent = `${skin.price} 🪙`;

        const button = document.createElement('button');
        button.className = 'shop-buy-btn';

        if (owned) {
            button.textContent = 'Adquirida';
            button.classList.add('owned');
            button.disabled = true;
        } else if (!canAfford) {
            button.textContent = 'Saldo insuficiente';
            button.disabled = true;
        } else {
            button.textContent = 'Comprar';
            button.addEventListener('click', () => purchaseSkin(skin.id));
        }

        item.appendChild(info);
        item.appendChild(price);
        item.appendChild(button);
        shopGrid.appendChild(item);
    });
}

async function purchaseSkin(skinId) {
    shopMessage.textContent = '';

    try {
        const response = await fetch('/api/shop/purchase', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`
            },
            body: JSON.stringify({ skinId })
        });
        const data = await response.json();

        if (!response.ok) {
            shopMessage.textContent = data.error || 'Não foi possível comprar.';
            return;
        }

        // Recarrega a loja pra refletir o novo saldo e a skin adquirida
        loadShop();
    } catch (err) {
        shopMessage.textContent = 'Erro de conexão ao processar a compra.';
    }
}

loadShop();