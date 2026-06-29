// menu.js — lógica da tela inicial do ball.io
// Responsabilidade única: validar o nome digitado e levar o jogador pro
// index.html (o jogo de verdade), passando o nome pela URL.

const playForm = document.getElementById('playForm');
const nameInput = document.getElementById('nameInput');
const errorMessage = document.getElementById('errorMessage');

// Foca automaticamente no campo de nome ao carregar a página, pra o
// jogador já poder digitar sem precisar clicar primeiro
nameInput.focus();

playForm.addEventListener('submit', (event) => {
    event.preventDefault();

    const rawName = nameInput.value.trim();

    // Validação no cliente (o servidor também valida/corta o nome por
    // segurança, mas aqui damos feedback imediato pro jogador)
    if (rawName.length === 0) {
        showError('Digite um nome pra jogar.');
        return;
    }

    if (rawName.length > 16) {
        showError('Nome muito longo (máximo 16 caracteres).');
        return;
    }

    // Leva o nome pro jogo via parâmetro de URL. encodeURIComponent evita
    // que caracteres especiais (espaços, acentos, &, etc.) quebrem a URL.
    const encodedName = encodeURIComponent(rawName);
    window.location.href = `index.html?name=${encodedName}`;
});

function showError(message) {
    errorMessage.textContent = message;
    nameInput.focus();
}
// ===================================================
// LÓGICA DO SELETOR DE CORES (INTEGRAÇÃO COM O CLIENT)
// ===================================================
document.addEventListener("DOMContentLoaded", () => {
    const colorInput = document.getElementById("playerColor");
    const colorHex = document.getElementById("colorHex");
    
    if (colorInput && colorHex) {
        // Atualiza a exibição do texto Hex e a cor dele dinamicamente
        colorInput.addEventListener("input", (e) => {
            const selectedColor = e.target.value;
            colorHex.innerText = selectedColor.toUpperCase();
            colorHex.style.color = selectedColor;
        });
    }

    // Intercepta o envio do formulário ou clique do botão para injetar a cor na URL
    const menuForm = document.querySelector("form") || document.getElementById("menuForm");
    
    if (menuForm) {
        menuForm.addEventListener("submit", (e) => {
            // Se o formulário original muda a página via action nativa, 
            // precisamos anexar o parâmetro de cor antes de ir para o index.html
            e.preventDefault();
            
            const nameInput = document.querySelector('input[name="name"]') || document.getElementById("nameInput");
            const name = nameInput ? nameInput.value.trim() : "";
            const color = colorInput ? encodeURIComponent(colorInput.value) : "%2300ffcc";

            if (name.length > 0) {
                // Redireciona levando tanto o Nome quanto a Cor escolhida
                window.location.href = `index.html?name=${encodeURIComponent(name)}&color=${color}`;
            }
        });
    }
});